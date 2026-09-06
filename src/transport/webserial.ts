import { Emitter, TransportError } from './types'
import type { Transport, TransportInfo, TransportState } from './types'

/**
 * Web Serial transport.
 *
 * If the adapter enumerates as a serial port (a CDC device, or an FTDI chip
 * with the operating system's serial driver bound) the browser exposes it
 * through the Web Serial API instead of WebUSB. This is often the easier path
 * on Windows because it does not require rebinding the device to WinUSB.
 */

export function isWebSerialAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator
}

export async function requestSerialPort(): Promise<SerialPort> {
  if (!isWebSerialAvailable()) {
    throw new TransportError('Web Serial is not available in this browser.')
  }
  return navigator.serial.requestPort()
}

export async function getAuthorisedPorts(): Promise<SerialPort[]> {
  if (!isWebSerialAvailable()) return []
  return navigator.serial.getPorts()
}

export interface WebSerialOptions {
  baudRate?: number
}

export class WebSerialTransport implements Transport {
  private port: SerialPort
  private options: WebSerialOptions
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null
  private dataEmitter = new Emitter<Uint8Array>()
  private errorEmitter = new Emitter<Error>()
  private _state: TransportState = 'closed'

  constructor(port: SerialPort, options: WebSerialOptions = {}) {
    this.port = port
    this.options = options
  }

  get state(): TransportState {
    return this._state
  }

  get info(): TransportInfo {
    const usb = this.port.getInfo?.() ?? {}
    return {
      name: usb.usbVendorId
        ? `Serial port [${hex4(usb.usbVendorId)}:${hex4(usb.usbProductId ?? 0)}]`
        : 'Serial port',
      kind: 'webserial',
      vendorId: usb.usbVendorId,
      productId: usb.usbProductId,
    }
  }

  async open(): Promise<void> {
    if (this._state === 'open') return
    this._state = 'opening'
    try {
      await this.port.open({ baudRate: this.options.baudRate ?? 500000 })
      if (!this.port.readable || !this.port.writable) {
        throw new TransportError('Serial port opened without readable/writable streams.')
      }
      this.reader = this.port.readable.getReader()
      this.writer = this.port.writable.getWriter()
      this._state = 'open'
      void this.readLoop()
    } catch (error) {
      this._state = 'error'
      throw new TransportError(error instanceof Error ? error.message : String(error), error)
    }
  }

  async close(): Promise<void> {
    try {
      await this.reader?.cancel().catch(() => undefined)
      this.reader?.releaseLock()
      await this.writer?.close().catch(() => undefined)
      this.writer?.releaseLock()
      await this.port.close().catch(() => undefined)
    } finally {
      this.reader = null
      this.writer = null
      this._state = 'closed'
    }
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.writer) throw new TransportError('Transport is not open.')
    await this.writer.write(data)
  }

  onData(listener: (data: Uint8Array) => void): () => void {
    return this.dataEmitter.add(listener)
  }

  onError(listener: (error: Error) => void): () => void {
    return this.errorEmitter.add(listener)
  }

  private async readLoop(): Promise<void> {
    const reader = this.reader
    if (!reader) return
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        if (value && value.length > 0) this.dataEmitter.emit(value)
      }
    } catch (error) {
      if (this._state === 'open') {
        this._state = 'error'
        this.errorEmitter.emit(new TransportError(error instanceof Error ? error.message : String(error), error))
      }
    }
  }
}

function hex4(value: number): string {
  return value.toString(16).toUpperCase().padStart(4, '0')
}
