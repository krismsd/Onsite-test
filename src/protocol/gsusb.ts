import type { AdapterCodec, AdapterMessage, AdapterOpenOptions, CanFrame } from './framing'

/**
 * gs_usb host protocol (candleLight / CANable in candleLight firmware).
 *
 * The frame layout matches struct gs_host_frame from the Linux gs_usb driver:
 *
 *   u32 echo_id      0xFFFFFFFF for frames received from the bus
 *   u32 can_id       identifier with EFF/RTR/ERR flags in the top bits
 *   u8  can_dlc
 *   u8  channel
 *   u8  flags
 *   u8  reserved
 *   u8  data[8]
 *
 * All multi-byte fields are little-endian. Bus configuration goes over
 * vendor control transfers rather than the bulk endpoints (see setupGsUsb).
 */

export const GS_HOST_FRAME_SIZE = 20

const CAN_EFF_FLAG = 0x80000000
const CAN_RTR_FLAG = 0x40000000
const CAN_ERR_FLAG = 0x20000000
const CAN_EFF_MASK = 0x1fffffff
const CAN_SFF_MASK = 0x000007ff

const ECHO_ID_RX = 0xffffffff

export class GsUsbCodec implements AdapterCodec {
  readonly id = 'gs_usb'
  readonly name = 'gs_usb (candleLight)'
  readonly description =
    'Binary 20-byte host frames used by candleLight, CANable and other gs_usb devices.'

  private buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0)

  get pendingBytes(): number {
    return this.buffer.length
  }

  reset(): void {
    this.buffer = new Uint8Array(0)
  }

  /** Bus setup happens over control transfers, so there is nothing to send here. */
  openCommands(_options: AdapterOpenOptions): Uint8Array[] {
    return []
  }

  closeCommands(): Uint8Array[] {
    return []
  }

  decode(chunk: Uint8Array): AdapterMessage[] {
    const combined = new Uint8Array(this.buffer.length + chunk.length)
    combined.set(this.buffer, 0)
    combined.set(chunk, this.buffer.length)

    const messages: AdapterMessage[] = []
    let offset = 0
    while (combined.length - offset >= GS_HOST_FRAME_SIZE) {
      const view = new DataView(combined.buffer, combined.byteOffset + offset, GS_HOST_FRAME_SIZE)
      const echoId = view.getUint32(0, true)
      const rawId = view.getUint32(4, true)
      const dlc = Math.min(view.getUint8(8), 8)
      const channel = view.getUint8(9)
      offset += GS_HOST_FRAME_SIZE

      // Echo frames confirm our own transmissions; they are not bus traffic.
      if (echoId !== ECHO_ID_RX) continue
      if ((rawId & CAN_ERR_FLAG) !== 0) {
        messages.push({
          kind: 'status',
          text: `Bus error frame (can_id 0x${rawId.toString(16)})`,
          bytes: combined.slice(offset - GS_HOST_FRAME_SIZE, offset),
        })
        continue
      }

      const extended = (rawId & CAN_EFF_FLAG) !== 0
      const canId = extended ? rawId & CAN_EFF_MASK : rawId & CAN_SFF_MASK
      const data = combined.slice(offset - GS_HOST_FRAME_SIZE + 12, offset - GS_HOST_FRAME_SIZE + 12 + dlc)
      messages.push({
        kind: 'can',
        frame: { canId, extended, data, channel, rtr: (rawId & CAN_RTR_FLAG) !== 0 },
      })
    }

    this.buffer = combined.slice(offset)
    return messages
  }

  encode(frame: CanFrame): Uint8Array {
    const bytes = new Uint8Array(GS_HOST_FRAME_SIZE)
    const view = new DataView(bytes.buffer)
    const extended = frame.extended || frame.canId > CAN_SFF_MASK
    let rawId = frame.canId >>> 0
    if (extended) rawId = (rawId & CAN_EFF_MASK) | CAN_EFF_FLAG
    if (frame.rtr) rawId |= CAN_RTR_FLAG
    view.setUint32(0, 0, true) // echo id 0: ask the device to echo the frame back
    view.setUint32(4, rawId >>> 0, true)
    view.setUint8(8, frame.data.length)
    view.setUint8(9, frame.channel ?? 0)
    bytes.set(frame.data.subarray(0, 8), 12)
    return bytes
  }
}

/** Vendor control requests understood by a gs_usb device. */
const BREQ = {
  HOST_FORMAT: 0,
  BITTIMING: 1,
  MODE: 2,
} as const

const GS_CAN_MODE_RESET = 0
const GS_CAN_MODE_START = 1
const GS_CAN_MODE_FLAG_LISTEN_ONLY = 1 << 1

/**
 * Compute bit timing for a device clock, targeting a 87.5% sample point
 * across 16 time quanta (1 sync + 5 prop + 8 phase1 + 2 phase2).
 */
export function computeBitTiming(bitrate: number, deviceClockHz = 48_000_000) {
  const timeQuantaPerBit = 16
  const brp = Math.max(1, Math.round(deviceClockHz / (bitrate * timeQuantaPerBit)))
  return { propSeg: 5, phaseSeg1: 8, phaseSeg2: 2, sjw: 1, brp }
}

function u32le(values: number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 4)
  const view = new DataView(bytes.buffer)
  values.forEach((value, index) => view.setUint32(index * 4, value >>> 0, true))
  return bytes
}

/** Configure and start a gs_usb device over its vendor control endpoint. */
export async function setupGsUsb(
  device: USBDevice,
  interfaceNumber: number,
  options: AdapterOpenOptions,
  deviceClockHz = 48_000_000,
): Promise<void> {
  const send = async (request: number, data: Uint8Array, value = 0) => {
    const result = await device.controlTransferOut(
      { requestType: 'vendor', recipient: 'interface', request, value, index: interfaceNumber },
      data as unknown as BufferSource,
    )
    if (result.status !== 'ok') {
      throw new Error(`gs_usb control request ${request} failed: ${result.status}`)
    }
  }

  // Byte-order probe value from the Linux driver.
  await send(BREQ.HOST_FORMAT, u32le([0x0000beef]), 1)

  const timing = computeBitTiming(options.bitrate, deviceClockHz)
  await send(
    BREQ.BITTIMING,
    u32le([timing.propSeg, timing.phaseSeg1, timing.phaseSeg2, timing.sjw, timing.brp]),
  )

  await send(BREQ.MODE, u32le([GS_CAN_MODE_RESET, 0]))
  await send(
    BREQ.MODE,
    u32le([GS_CAN_MODE_START, options.listenOnly ? GS_CAN_MODE_FLAG_LISTEN_ONLY : 0]),
  )
}

/** Stop the bus before releasing the device. */
export async function stopGsUsb(device: USBDevice, interfaceNumber: number): Promise<void> {
  await device
    .controlTransferOut(
      { requestType: 'vendor', recipient: 'interface', request: BREQ.MODE, value: 0, index: interfaceNumber },
      u32le([GS_CAN_MODE_RESET, 0]) as unknown as BufferSource,
    )
    .catch(() => undefined)
}
