/**
 * FTDI USB-serial bridge support.
 *
 * Several datalink adapters put an FTDI chip between USB and the adapter's
 * own microcontroller. When that is the case the device must be configured
 * with FTDI vendor control transfers before data flows, and every inbound USB
 * packet starts with two modem-status bytes that are not part of the stream.
 *
 * The control request numbers and the baud-rate divisor encoding below follow
 * FTDI's published application notes (AN_120 / AN_232B-05), as implemented by
 * libftdi.
 */

export const FTDI_VENDOR_ID = 0x0403

const REQUEST = {
  RESET: 0x00,
  SET_MODEM_CTRL: 0x01,
  SET_FLOW_CTRL: 0x02,
  SET_BAUDRATE: 0x03,
  SET_DATA: 0x04,
  SET_LATENCY_TIMER: 0x09,
} as const

const RESET_SIO = 0
const RESET_PURGE_RX = 1
const RESET_PURGE_TX = 2

/** 8 data bits, no parity, 1 stop bit. */
const DATA_8N1 = 0x0008

export function isFtdiDevice(device: USBDevice): boolean {
  return device.vendorId === FTDI_VENDOR_ID
}

/**
 * Encode a baud rate as an FTDI divisor.
 *
 * The divisor is expressed in eighths against a 3 MHz reference clock; the
 * fractional eighths are encoded in the top bits using FTDI's lookup order.
 */
export function encodeBaudRate(baudRate: number): { value: number; index: number } {
  if (baudRate <= 0) throw new Error('Baud rate must be positive')
  if (baudRate >= 3000000) return { value: 0, index: 0 } // 3 Mbaud
  if (baudRate >= 2000000) return { value: 1, index: 0 } // 2 Mbaud

  const fractionCode = [0, 3, 2, 4, 1, 5, 6, 7]
  // 24 MHz / baud gives the divisor in eighths of the 3 MHz clock.
  let divisor8 = Math.round(24000000 / baudRate)
  if (divisor8 < 8) divisor8 = 8
  let encoded = (divisor8 >>> 3) | (fractionCode[divisor8 & 0x07] << 14)
  if (encoded === 1) encoded = 0
  else if (encoded === 0x4001) encoded = 1
  return { value: encoded & 0xffff, index: (encoded >>> 16) & 0xffff }
}

async function vendorOut(device: USBDevice, request: number, value: number, index: number): Promise<void> {
  const result = await device.controlTransferOut({
    requestType: 'vendor',
    recipient: 'device',
    request,
    value,
    index,
  })
  if (result.status !== 'ok') {
    throw new Error(`FTDI control request 0x${request.toString(16)} failed: ${result.status}`)
  }
}

/**
 * Reset the chip, set 8N1 at the requested baud rate and drop the latency
 * timer so short frames are not held back by the chip's buffering.
 */
export async function configureFtdi(device: USBDevice, interfaceNumber: number, baudRate: number): Promise<void> {
  // FTDI indexes ports from 1; interface 0 is port 1.
  const port = interfaceNumber + 1
  await vendorOut(device, REQUEST.RESET, RESET_SIO, port)
  await vendorOut(device, REQUEST.RESET, RESET_PURGE_RX, port)
  await vendorOut(device, REQUEST.RESET, RESET_PURGE_TX, port)

  const baud = encodeBaudRate(baudRate)
  // For multi-port chips the port number occupies the low bits of the index.
  const index = baud.index === 0 && port > 1 ? port : (baud.index << 8) | port
  await vendorOut(device, REQUEST.SET_BAUDRATE, baud.value, index)
  await vendorOut(device, REQUEST.SET_DATA, DATA_8N1, port)
  // Disable flow control.
  await vendorOut(device, REQUEST.SET_FLOW_CTRL, 0, port)
  // DTR and RTS asserted - many adapters hold their MCU in reset otherwise.
  await vendorOut(device, REQUEST.SET_MODEM_CTRL, 0x0303, port)
  // 1 ms latency timer: send short frames straight through.
  await vendorOut(device, REQUEST.SET_LATENCY_TIMER, 1, port)
}

/**
 * Remove the two modem-status bytes FTDI prepends to every USB packet.
 * A transfer may contain several packets, so the split is done per packet.
 */
export function stripFtdiStatusBytes(data: Uint8Array, packetSize: number): Uint8Array {
  const size = packetSize > 2 ? packetSize : 64
  const chunks: Uint8Array[] = []
  let total = 0
  for (let offset = 0; offset < data.length; offset += size) {
    const end = Math.min(offset + size, data.length)
    if (end - offset <= 2) continue // status bytes only, no payload
    const chunk = data.subarray(offset + 2, end)
    chunks.push(chunk)
    total += chunk.length
  }
  const result = new Uint8Array(total)
  let position = 0
  for (const chunk of chunks) {
    result.set(chunk, position)
    position += chunk.length
  }
  return result
}
