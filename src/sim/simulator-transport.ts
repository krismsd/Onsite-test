import { Emitter } from '../transport/types'
import type { Transport, TransportInfo, TransportState } from '../transport/types'
import type { AdapterCodec } from '../protocol/framing'
import { EcmSimulator } from './ecm-simulator'

/**
 * Bench simulator presented as a transport.
 *
 * The simulated ECM produces genuine J1939 frames which are encoded with the
 * same adapter codec the real hardware path uses, so the application decodes
 * simulated and real traffic through identical code.
 */

export interface SimulatorOptions {
  /** Model step interval in milliseconds. */
  tickMs?: number
  /** Speed multiplier for the engine model, for demonstrations. */
  timeScale?: number
}

export class SimulatorTransport implements Transport {
  readonly ecm = new EcmSimulator()
  private outboundCodec: AdapterCodec
  private inboundCodec: AdapterCodec
  private dataEmitter = new Emitter<Uint8Array>()
  private errorEmitter = new Emitter<Error>()
  private timer: ReturnType<typeof setInterval> | null = null
  private _state: TransportState = 'closed'
  private clock = 0
  private tickMs: number
  private timeScale: number

  /**
   * @param makeCodec factory producing a codec instance; two are created so
   *   the simulator's encoder and decoder keep independent buffers.
   */
  constructor(makeCodec: () => AdapterCodec, options: SimulatorOptions = {}) {
    this.outboundCodec = makeCodec()
    this.inboundCodec = makeCodec()
    this.tickMs = options.tickMs ?? 20
    this.timeScale = options.timeScale ?? 1
  }

  get state(): TransportState {
    return this._state
  }

  get info(): TransportInfo {
    return {
      name: 'Bench simulator (no hardware)',
      kind: 'simulator',
    }
  }

  async open(): Promise<void> {
    if (this._state === 'open') return
    this._state = 'open'
    this.clock = 0
    this.timer = setInterval(() => this.tick(), this.tickMs)
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this._state = 'closed'
  }

  async write(data: Uint8Array): Promise<void> {
    // Interpret what the tool sent and let the ECM answer.
    for (const message of this.inboundCodec.decode(data)) {
      if (message.kind !== 'can') continue
      const responses = this.ecm.handleIncoming(message.frame)
      for (const response of responses) {
        this.dataEmitter.emit(this.outboundCodec.encode(response))
      }
    }
  }

  onData(listener: (data: Uint8Array) => void): () => void {
    return this.dataEmitter.add(listener)
  }

  onError(listener: (error: Error) => void): () => void {
    return this.errorEmitter.add(listener)
  }

  private tick(): void {
    const dt = (this.tickMs / 1000) * this.timeScale
    this.clock += this.tickMs * this.timeScale
    try {
      const frames = this.ecm.step(dt, this.clock)
      for (const frame of frames) {
        this.dataEmitter.emit(this.outboundCodec.encode(frame))
      }
    } catch (error) {
      this.errorEmitter.emit(error instanceof Error ? error : new Error(String(error)))
    }
  }

  setTimeScale(scale: number): void {
    this.timeScale = Math.max(0, scale)
  }
}
