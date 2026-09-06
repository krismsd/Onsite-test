/**
 * Byte-level transport abstraction.
 *
 * Everything above this interface works on opaque byte streams, so the same
 * adapter driver runs over WebUSB bulk endpoints, an FTDI bridge, Web Serial
 * or the built-in simulator.
 */

export type TransportState = 'closed' | 'opening' | 'open' | 'error'

export interface TransportInfo {
  /** Human-readable device name shown in the connection dialog. */
  name: string
  kind: 'webusb' | 'webusb-ftdi' | 'webserial' | 'simulator'
  vendorId?: number
  productId?: number
  serialNumber?: string
  manufacturer?: string
  /** USB interface and endpoints actually claimed, for the diagnostics pane. */
  interfaceNumber?: number
  endpointIn?: number
  endpointOut?: number
  /** Maximum packet size of the IN endpoint. */
  packetSize?: number
}

export interface Transport {
  readonly info: TransportInfo
  readonly state: TransportState
  open(): Promise<void>
  close(): Promise<void>
  /** Write raw bytes to the device. */
  write(data: Uint8Array): Promise<void>
  /** Register a listener for inbound bytes. Returns an unsubscribe function. */
  onData(listener: (data: Uint8Array) => void): () => void
  /** Register a listener for transport-level errors. */
  onError(listener: (error: Error) => void): () => void
}

export class TransportError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message)
    this.name = 'TransportError'
  }
}

/** Simple multi-listener helper shared by the transport implementations. */
export class Emitter<T> {
  private listeners = new Set<(value: T) => void>()

  add(listener: (value: T) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(value: T): void {
    for (const listener of this.listeners) {
      try {
        listener(value)
      } catch (error) {
        // A failing listener must not stop the read loop.
        console.error('transport listener threw', error)
      }
    }
  }

  clear(): void {
    this.listeners.clear()
  }
}
