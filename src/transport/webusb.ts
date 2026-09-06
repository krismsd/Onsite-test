import { Emitter, TransportError } from './types'
import type { Transport, TransportInfo, TransportState } from './types'
import { configureFtdi, isFtdiDevice, stripFtdiStatusBytes, FTDI_VENDOR_ID } from './ftdi'

/**
 * WebUSB transport.
 *
 * The INLINE 7 presents a USB interface that the operating system must not
 * have claimed for a kernel-class driver, otherwise the browser cannot open
 * it (see the README for WinUSB/udev setup). This transport claims the first
 * interface exposing a bulk IN/OUT endpoint pair and runs a continuous read
 * loop against the IN endpoint.
 */

export interface WebUsbOptions {
  /** Force a specific interface number instead of auto-detecting one. */
  interfaceNumber?: number
  /** Force endpoint numbers instead of auto-detecting them. */
  endpointIn?: number
  endpointOut?: number
  /** Treat the device as an FTDI USB-serial bridge. */
  ftdi?: boolean
  /** Baud rate applied when the device is an FTDI bridge. */
  baudRate?: number
}

interface EndpointSelection {
  interfaceNumber: number
  alternateSetting: number
  endpointIn: number
  endpointOut: number
  packetSize: number
}

export function isWebUsbAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'usb' in navigator
}

/**
 * Prompt the user to pick a USB device.
 *
 * No vendor filter is applied: the INLINE 7's USB vendor and product IDs are
 * not published, so the picker lists everything and the chosen device's IDs
 * are remembered for next time.
 */
export async function requestUsbDevice(filters: USBDeviceFilter[] = []): Promise<USBDevice> {
  if (!isWebUsbAvailable()) {
    throw new TransportError(
      'WebUSB is not available. Use a Chromium-based browser (Chrome, Edge, Opera) over HTTPS or on localhost.',
    )
  }
  return navigator.usb.requestDevice({ filters })
}

/** Devices the user has already granted this origin access to. */
export async function getAuthorisedDevices(): Promise<USBDevice[]> {
  if (!isWebUsbAvailable()) return []
  return navigator.usb.getDevices()
}

export function describeUsbDevice(device: USBDevice): string {
  const name = device.productName ?? 'USB device'
  const vendor = device.manufacturerName ? `${device.manufacturerName} ` : ''
  const ids = `${hex4(device.vendorId)}:${hex4(device.productId)}`
  return `${vendor}${name} [${ids}]`
}

function hex4(value: number): string {
  return value.toString(16).toUpperCase().padStart(4, '0')
}

/**
 * Find a claimable interface with a bulk IN/OUT endpoint pair.
 * Interrupt endpoints are accepted as a fallback since some adapters use them.
 */
export function selectEndpoints(device: USBDevice, options: WebUsbOptions = {}): EndpointSelection {
  const configuration = device.configuration ?? device.configurations[0]
  if (!configuration) throw new TransportError('USB device exposes no configuration.')

  const candidates: EndpointSelection[] = []
  for (const iface of configuration.interfaces) {
    if (options.interfaceNumber !== undefined && iface.interfaceNumber !== options.interfaceNumber) continue
    for (const alternate of iface.alternates) {
      const inEndpoint = alternate.endpoints.find(
        (e) => e.direction === 'in' && (e.type === 'bulk' || e.type === 'interrupt'),
      )
      const outEndpoint = alternate.endpoints.find(
        (e) => e.direction === 'out' && (e.type === 'bulk' || e.type === 'interrupt'),
      )
      if (!inEndpoint || !outEndpoint) continue
      candidates.push({
        interfaceNumber: iface.interfaceNumber,
        alternateSetting: alternate.alternateSetting,
        endpointIn: options.endpointIn ?? inEndpoint.endpointNumber,
        endpointOut: options.endpointOut ?? outEndpoint.endpointNumber,
        packetSize: inEndpoint.packetSize,
      })
    }
  }

  // Prefer a vendor-specific interface: on composite devices the class
  // interfaces are usually claimed by the operating system.
  const vendorSpecific = candidates.find((candidate) => {
    const iface = configuration.interfaces.find((i) => i.interfaceNumber === candidate.interfaceNumber)
    return iface?.alternates.some((a) => a.interfaceClass === 0xff)
  })

  const chosen = vendorSpecific ?? candidates[0]
  if (!chosen) {
    throw new TransportError(
      'No bulk or interrupt endpoint pair found on this device. Check that the correct interface is exposed and not claimed by an operating system driver.',
    )
  }
  return chosen
}

export class WebUsbTransport implements Transport {
  private device: USBDevice
  private options: WebUsbOptions
  private selection: EndpointSelection | null = null
  private dataEmitter = new Emitter<Uint8Array>()
  private errorEmitter = new Emitter<Error>()
  private reading = false
  private _state: TransportState = 'closed'
  private ftdiMode = false

  constructor(device: USBDevice, options: WebUsbOptions = {}) {
    this.device = device
    this.options = options
    this.ftdiMode = options.ftdi ?? isFtdiDevice(device)
  }

  get state(): TransportState {
    return this._state
  }

  get info(): TransportInfo {
    return {
      name: describeUsbDevice(this.device),
      kind: this.ftdiMode ? 'webusb-ftdi' : 'webusb',
      vendorId: this.device.vendorId,
      productId: this.device.productId,
      serialNumber: this.device.serialNumber ?? undefined,
      manufacturer: this.device.manufacturerName ?? undefined,
      interfaceNumber: this.selection?.interfaceNumber,
      endpointIn: this.selection?.endpointIn,
      endpointOut: this.selection?.endpointOut,
      packetSize: this.selection?.packetSize,
    }
  }

  async open(): Promise<void> {
    if (this._state === 'open') return
    this._state = 'opening'
    try {
      await this.device.open()
      if (!this.device.configuration) {
        await this.device.selectConfiguration(1)
      }
      const selection = selectEndpoints(this.device, this.options)
      this.selection = selection
      await this.device.claimInterface(selection.interfaceNumber)
      if (selection.alternateSetting !== 0) {
        await this.device.selectAlternateInterface(selection.interfaceNumber, selection.alternateSetting)
      }
      if (this.ftdiMode) {
        await configureFtdi(this.device, selection.interfaceNumber, this.options.baudRate ?? 500000)
      }
      this._state = 'open'
      this.reading = true
      void this.readLoop()
    } catch (error) {
      this._state = 'error'
      throw new TransportError(usbErrorHint(error), error)
    }
  }

  async close(): Promise<void> {
    this.reading = false
    try {
      if (this.selection) {
        await this.device.releaseInterface(this.selection.interfaceNumber).catch(() => undefined)
      }
      await this.device.close().catch(() => undefined)
    } finally {
      this._state = 'closed'
      this.selection = null
    }
  }

  async write(data: Uint8Array): Promise<void> {
    if (this._state !== 'open' || !this.selection) {
      throw new TransportError('Transport is not open.')
    }
    const result = await this.device.transferOut(this.selection.endpointOut, data as unknown as BufferSource)
    if (result.status !== 'ok') {
      throw new TransportError(`USB write failed with status "${result.status}".`)
    }
  }

  onData(listener: (data: Uint8Array) => void): () => void {
    return this.dataEmitter.add(listener)
  }

  onError(listener: (error: Error) => void): () => void {
    return this.errorEmitter.add(listener)
  }

  private async readLoop(): Promise<void> {
    const selection = this.selection
    if (!selection) return
    // Read a whole number of packets per transfer to avoid babble errors.
    const readSize = Math.max(selection.packetSize, 64) * 4
    while (this.reading && this._state === 'open') {
      try {
        const result = await this.device.transferIn(selection.endpointIn, readSize)
        if (result.status === 'stall') {
          await this.device.clearHalt('in', selection.endpointIn)
          continue
        }
        if (result.status !== 'ok' || !result.data || result.data.byteLength === 0) continue
        let bytes = new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength)
        if (this.ftdiMode) {
          bytes = stripFtdiStatusBytes(bytes, selection.packetSize)
        }
        if (bytes.length > 0) this.dataEmitter.emit(bytes)
      } catch (error) {
        if (!this.reading) return
        this._state = 'error'
        this.errorEmitter.emit(new TransportError(usbErrorHint(error), error))
        return
      }
    }
  }
}

/** Turn opaque WebUSB DOMExceptions into something a technician can act on. */
export function usbErrorHint(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/access denied|SecurityError/i.test(message)) {
    return `${message} - the interface is claimed by an operating system driver. On Windows bind the interface to WinUSB; on Linux add a udev rule and unbind any kernel driver.`
  }
  if (/device unavailable|NetworkError/i.test(message)) {
    return `${message} - the device disconnected or another application (for example an RP1210 driver) holds it open.`
  }
  if (/not found|NotFoundError/i.test(message)) {
    return `${message} - no device was selected, or the previously granted device is no longer attached.`
  }
  return message
}

export { FTDI_VENDOR_ID }
