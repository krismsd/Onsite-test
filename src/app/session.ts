import type { Transport } from '../transport/types'
import type { AdapterCodec, AdapterOpenOptions, CanFrame } from '../protocol/framing'
import { decodeCanId, encodeCanId, GLOBAL_ADDRESS } from '../protocol/j1939/id'
import { PGN, ADDRESS, addressName } from '../protocol/j1939/pgn-numbers'
import { TransportProtocolReassembler, buildRequestPayload } from '../protocol/j1939/transport'
import {
  decodePgn,
  pgnLabel,
  decodeComponentId,
  decodeSoftwareId,
  decodeVin,
  decodeName,
} from '../protocol/j1939/decode'
import { decodeDiagnosticMessage, mergeDtcs } from '../protocol/j1939/dtc'
import type {
  BusNode,
  DiagnosticTroubleCode,
  EcmIdentification,
  LampStatus,
  RawFrame,
  Sample,
  SignalFrame,
  SignalKey,
} from '../model/types'

/**
 * A live datalink session.
 *
 * Owns the transport and the adapter codec, decodes everything arriving from
 * the bus into application state, and provides the request/command operations
 * a service tool needs.
 */

export interface SessionOptions extends AdapterOpenOptions {
  /** Source address this tool claims when transmitting. */
  sourceAddress: number
  /** Number of raw frames retained for the datalink monitor. */
  frameBufferSize: number
}

export const DEFAULT_SESSION_OPTIONS: SessionOptions = {
  bitrate: 250000,
  listenOnly: false,
  sourceAddress: ADDRESS.SERVICE_TOOL,
  frameBufferSize: 5000,
}

export interface SessionSnapshot {
  signals: SignalFrame
  dtcs: DiagnosticTroubleCode[]
  lamps: LampStatus
  nodes: BusNode[]
  identification: Map<number, EcmIdentification>
  frames: RawFrame[]
  stats: SessionStats
}

export interface SessionStats {
  framesReceived: number
  framesTransmitted: number
  bytesReceived: number
  decodeErrors: number
  /** Frames per second over the last second. */
  frameRate: number
  /** Rough bus load as a percentage of the configured bitrate. */
  busLoadPct: number
  connectedSince: number | null
  lastFrameAt: number | null
  pendingTpSessions: number
  pendingCodecBytes: number
}

const EMPTY_LAMPS: LampStatus = { malfunction: false, red: false, amber: false, protect: false }

/** How often coalesced state changes are pushed to the UI. */
const UI_REFRESH_MS = 100

export class DatalinkSession {
  private unsubscribers: Array<() => void> = []
  private reassembler = new TransportProtocolReassembler()
  private signals: SignalFrame = {}
  private dtcs: DiagnosticTroubleCode[] = []
  private lamps: LampStatus = { ...EMPTY_LAMPS }
  private nodes = new Map<number, BusNode>()
  private identification = new Map<number, EcmIdentification>()
  private frames: RawFrame[] = []
  private frameId = 0
  private listeners = new Set<() => void>()
  private snapshotCache: SessionSnapshot | null = null
  private dirty = false
  private uiTimer: ReturnType<typeof setInterval> | null = null
  private rateWindow: number[] = []
  private bitsWindow: number[] = []
  private stats: SessionStats = {
    framesReceived: 0,
    framesTransmitted: 0,
    bytesReceived: 0,
    decodeErrors: 0,
    frameRate: 0,
    busLoadPct: 0,
    connectedSince: null,
    lastFrameAt: null,
    pendingTpSessions: 0,
    pendingCodecBytes: 0,
  }
  private rateTimer: ReturnType<typeof setInterval> | null = null
  /** Raw bytes retained for the capture analyser. */
  private captureBuffer: number[] = []
  private capturing = false

  constructor(
    readonly transport: Transport,
    readonly codec: AdapterCodec,
    readonly options: SessionOptions = DEFAULT_SESSION_OPTIONS,
  ) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Mark state as changed. Bus traffic arrives far faster than a UI can
   * usefully repaint, so updates are coalesced and flushed at a fixed rate;
   * user-initiated changes flush immediately.
   */
  private notify(immediate = false): void {
    this.dirty = true
    if (immediate) this.flush()
  }

  private flush(): void {
    if (!this.dirty) return
    this.dirty = false
    this.snapshotCache = null
    for (const listener of this.listeners) listener()
  }

  async start(): Promise<void> {
    await this.transport.open()
    this.unsubscribers.push(this.transport.onData((data) => this.handleBytes(data)))
    this.unsubscribers.push(
      this.transport.onError((error) => {
        this.stats.decodeErrors++
        console.error('transport error', error)
        this.notify()
      }),
    )
    for (const command of this.codec.openCommands(this.options)) {
      await this.transport.write(command)
    }
    this.stats.connectedSince = Date.now()
    this.rateTimer = setInterval(() => this.tickRate(), 1000)
    this.uiTimer = setInterval(() => this.flush(), UI_REFRESH_MS)
    this.notify(true)
  }

  async stop(): Promise<void> {
    if (this.rateTimer) clearInterval(this.rateTimer)
    this.rateTimer = null
    if (this.uiTimer) clearInterval(this.uiTimer)
    this.uiTimer = null
    try {
      for (const command of this.codec.closeCommands()) {
        await this.transport.write(command).catch(() => undefined)
      }
    } finally {
      for (const unsubscribe of this.unsubscribers) unsubscribe()
      this.unsubscribers = []
      await this.transport.close()
      this.stats.connectedSince = null
      this.notify(true)
    }
  }

  /** Stable snapshot: the same object is returned until state changes. */
  snapshot(): SessionSnapshot {
    if (this.snapshotCache) return this.snapshotCache
    this.snapshotCache = {
      signals: this.signals,
      dtcs: this.dtcs,
      lamps: this.lamps,
      nodes: [...this.nodes.values()].sort((a, b) => a.address - b.address),
      identification: this.identification,
      frames: this.frames,
      stats: {
        ...this.stats,
        pendingTpSessions: this.reassembler.pendingSessions,
        pendingCodecBytes: this.codec.pendingBytes,
      },
    }
    return this.snapshotCache
  }

  // --- raw capture, for characterising an unknown adapter ------------------

  startCapture(): void {
    this.captureBuffer = []
    this.capturing = true
  }

  stopCapture(): Uint8Array {
    this.capturing = false
    return new Uint8Array(this.captureBuffer)
  }

  get captureSize(): number {
    return this.captureBuffer.length
  }

  get isCapturing(): boolean {
    return this.capturing
  }

  // --- inbound ------------------------------------------------------------

  private handleBytes(data: Uint8Array): void {
    this.stats.bytesReceived += data.length
    if (this.capturing) {
      // Cap the capture so a long session cannot exhaust memory.
      if (this.captureBuffer.length < 512 * 1024) {
        for (const byte of data) this.captureBuffer.push(byte)
      }
    }
    let changed = false
    for (const message of this.codec.decode(data)) {
      switch (message.kind) {
        case 'can':
          this.handleCanFrame(message.frame)
          changed = true
          break
        case 'status':
          this.pushFrame({
            id: this.frameId++,
            direction: 'rx',
            at: performance.now(),
            data: message.bytes,
            protocol: 'adapter',
            note: message.text,
          })
          changed = true
          break
        case 'unknown':
          this.stats.decodeErrors++
          this.pushFrame({
            id: this.frameId++,
            direction: 'rx',
            at: performance.now(),
            data: message.bytes,
            protocol: 'adapter',
            note: 'Undecoded bytes - check the framing profile',
          })
          changed = true
          break
        case 'j1708':
          this.pushFrame({
            id: this.frameId++,
            direction: 'rx',
            at: performance.now(),
            data: message.data,
            protocol: 'j1708',
            note: `MID ${message.mid}`,
          })
          changed = true
          break
      }
    }
    if (changed) this.notify()
  }

  private handleCanFrame(frame: CanFrame): void {
    const now = performance.now()
    this.stats.framesReceived++
    this.stats.lastFrameAt = now
    this.rateWindow.push(now)
    // 29-bit frame on the wire is about 128 bits including stuffing and overhead.
    this.bitsWindow.push(frame.extended ? 128 + frame.data.length * 8 : 108 + frame.data.length * 8)

    const header = decodeCanId(frame.canId)
    this.touchNode(header.sourceAddress, now)

    this.pushFrame({
      id: this.frameId++,
      direction: 'rx',
      at: now,
      canId: frame.canId,
      pgn: header.pgn,
      sourceAddress: header.sourceAddress,
      destinationAddress: header.destinationAddress,
      priority: header.priority,
      data: frame.data,
      protocol: 'j1939',
      note: pgnLabel(header.pgn),
    })

    if (header.pgn === PGN.TP_CM || header.pgn === PGN.TP_DT) {
      const assembled = this.reassembler.handle(
        header.pgn,
        header.sourceAddress,
        header.destinationAddress,
        frame.data,
        now,
      )
      if (assembled) {
        this.dispatchMessage(assembled.pgn, assembled.sourceAddress, assembled.data, now)
      }
      return
    }

    this.dispatchMessage(header.pgn, header.sourceAddress, frame.data, now)
  }

  /** Route a complete (possibly reassembled) message to its handler. */
  private dispatchMessage(pgn: number, sourceAddress: number, data: Uint8Array, now: number): void {
    switch (pgn) {
      case PGN.DM1:
        this.handleDiagnosticMessage(data, sourceAddress, true)
        return
      case PGN.DM2:
        this.handleDiagnosticMessage(data, sourceAddress, false)
        return
      case PGN.ADDRESS_CLAIM: {
        const name = decodeName(data)
        const node = this.touchNode(sourceAddress, now)
        if (name) node.name = name
        const identity = this.identification.get(sourceAddress) ?? { sourceAddress, simulated: false }
        identity.name = name
        this.identification.set(sourceAddress, identity)
        return
      }
      case PGN.COMPONENT_ID: {
        const fields = decodeComponentId(data)
        const identity = this.identification.get(sourceAddress) ?? { sourceAddress, simulated: false }
        this.identification.set(sourceAddress, { ...identity, ...fields })
        return
      }
      case PGN.SOFTWARE_ID: {
        const identity = this.identification.get(sourceAddress) ?? { sourceAddress, simulated: false }
        identity.softwareIdentification = decodeSoftwareId(data)
        this.identification.set(sourceAddress, identity)
        return
      }
      case PGN.VIN: {
        const identity = this.identification.get(sourceAddress) ?? { sourceAddress, simulated: false }
        identity.vin = decodeVin(data)
        this.identification.set(sourceAddress, identity)
        return
      }
      default:
        break
    }

    const decoded = decodePgn(pgn, data)
    const keys = Object.keys(decoded) as SignalKey[]
    if (keys.length === 0) return
    const next: SignalFrame = { ...this.signals }
    for (const key of keys) {
      const value = decoded[key]
      if (value === undefined) continue
      const sample: Sample = { value, at: now, source: 'j1939', from: sourceAddress }
      next[key] = sample
    }
    this.signals = next
  }

  private handleDiagnosticMessage(data: Uint8Array, sourceAddress: number, active: boolean): void {
    const message = decodeDiagnosticMessage(data)
    if (active) this.lamps = message.lamps
    this.dtcs = mergeDtcs(this.dtcs, message.dtcs, sourceAddress, active, Date.now())
  }

  private touchNode(address: number, now: number): BusNode {
    const existing = this.nodes.get(address)
    if (existing) {
      existing.lastSeen = now
      existing.messageCount++
      return existing
    }
    const node: BusNode = {
      address,
      label: addressName(address),
      firstSeen: now,
      lastSeen: now,
      messageCount: 1,
    }
    this.nodes.set(address, node)
    return node
  }

  private pushFrame(frame: RawFrame): void {
    this.frames = [...this.frames.slice(-(this.options.frameBufferSize - 1)), frame]
  }

  private tickRate(): void {
    const cutoff = performance.now() - 1000
    this.rateWindow = this.rateWindow.filter((at) => at > cutoff)
    const bitsKept = this.bitsWindow.slice(-this.rateWindow.length)
    this.bitsWindow = bitsKept
    this.stats.frameRate = this.rateWindow.length
    const bits = bitsKept.reduce((total, value) => total + value, 0)
    this.stats.busLoadPct = Math.min(100, (bits / this.options.bitrate) * 100)
    this.notify()
  }

  // --- outbound -----------------------------------------------------------

  private async transmit(pgn: number, destination: number, data: Uint8Array, priority = 6): Promise<void> {
    if (this.options.listenOnly) {
      throw new Error('The session is in listen-only mode; enable transmit to send requests.')
    }
    const canId = encodeCanId({
      priority,
      pgn,
      sourceAddress: this.options.sourceAddress,
      destinationAddress: destination,
    })
    const frame: CanFrame = { canId, extended: true, data }
    await this.transport.write(this.codec.encode(frame))
    this.stats.framesTransmitted++
    this.pushFrame({
      id: this.frameId++,
      direction: 'tx',
      at: performance.now(),
      canId,
      pgn,
      sourceAddress: this.options.sourceAddress,
      destinationAddress: destination,
      priority,
      data,
      protocol: 'j1939',
      note: pgnLabel(pgn),
    })
    this.notify()
  }

  /** Send a Request PGN (59904) for the given PGN. */
  async request(pgn: number, destination = GLOBAL_ADDRESS): Promise<void> {
    await this.transmit(PGN.REQUEST, destination, buildRequestPayload(pgn), 6)
  }

  /** Ask every node on the bus to identify itself. */
  async requestIdentification(destination = GLOBAL_ADDRESS): Promise<void> {
    await this.request(PGN.ADDRESS_CLAIM, destination)
    await this.request(PGN.COMPONENT_ID, destination)
    await this.request(PGN.SOFTWARE_ID, destination)
    await this.request(PGN.VIN, destination)
  }

  /** Request active faults (DM1) from a controller. */
  async requestActiveFaults(destination = GLOBAL_ADDRESS): Promise<void> {
    await this.request(PGN.DM1, destination)
  }

  /** Request previously active faults (DM2) from a controller. */
  async requestInactiveFaults(destination = GLOBAL_ADDRESS): Promise<void> {
    await this.request(PGN.DM2, destination)
  }

  /**
   * DM3 - clear previously active (inactive) faults.
   * This is a standard J1939 service operation and is safe on a live vehicle.
   */
  async clearInactiveFaults(destination: number): Promise<void> {
    await this.transmit(PGN.DM3, destination, new Uint8Array(8).fill(0xff), 6)
    this.dtcs = this.dtcs.filter((dtc) => dtc.active || dtc.sourceAddress !== destination)
    this.notify(true)
  }

  /**
   * DM11 - clear active faults. A controller will refuse this while the
   * fault condition is still present, which is the correct behaviour.
   */
  async clearActiveFaults(destination: number): Promise<void> {
    await this.transmit(PGN.DM11, destination, new Uint8Array(8).fill(0xff), 6)
    this.notify(true)
  }

  /** Send an arbitrary frame - used by the datalink monitor's transmit box. */
  async sendRaw(canId: number, data: Uint8Array): Promise<void> {
    const header = decodeCanId(canId)
    await this.transmit(header.pgn, header.destinationAddress, data, header.priority)
  }

  /** Clear decoded state without dropping the connection. */
  resetDecodedState(): void {
    this.signals = {}
    this.dtcs = []
    this.lamps = { ...EMPTY_LAMPS }
    this.frames = []
    this.reassembler.reset()
    this.codec.reset()
    this.notify(true)
  }
}
