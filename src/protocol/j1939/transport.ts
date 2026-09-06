import { PGN } from './pgn-numbers'
import { GLOBAL_ADDRESS } from './id'

/**
 * SAE J1939-21 transport protocol reassembly.
 *
 * Messages longer than 8 bytes are sent either as a broadcast announce
 * (BAM) followed by data-transfer packets, or as a peer-to-peer
 * RTS/CTS session. DM1 with more than one DTC, component ID and VIN all
 * arrive this way, so a service tool must reassemble them.
 */

export const TP_CONTROL = {
  RTS: 16,
  CTS: 17,
  END_OF_MSG_ACK: 19,
  BAM: 32,
  ABORT: 255,
} as const

/** Abort reasons from J1939-21 table 7. */
export const ABORT_REASON: Record<number, string> = {
  1: 'Already in one or more connection-managed sessions',
  2: 'System resources needed for another task',
  3: 'A timeout occurred',
  4: 'CTS received while transferring data',
  5: 'Maximum retransmit request limit reached',
  6: 'Unexpected data transfer packet',
  7: 'Bad sequence number',
  8: 'Duplicate sequence number',
  9: 'Total message size exceeded',
  250: 'Manufacturer-specific abort',
}

interface Session {
  key: string
  pgn: number
  sourceAddress: number
  destinationAddress: number
  totalBytes: number
  totalPackets: number
  received: Map<number, Uint8Array>
  startedAt: number
  broadcast: boolean
}

export interface ReassembledMessage {
  pgn: number
  sourceAddress: number
  destinationAddress: number
  data: Uint8Array
  /** True when reassembled from a BAM rather than an RTS/CTS session. */
  broadcast: boolean
}

/** Milliseconds a partial session is kept before being discarded (T1 = 750ms, with slack). */
const SESSION_TIMEOUT_MS = 2000

export class TransportProtocolReassembler {
  private sessions = new Map<string, Session>()

  private key(sa: number, da: number): string {
    return `${sa}:${da}`
  }

  /**
   * Feed a TP.CM or TP.DT frame.
   * Returns a reassembled message once the final packet arrives.
   */
  handle(pgn: number, sourceAddress: number, destinationAddress: number, data: Uint8Array, now: number): ReassembledMessage | null {
    this.expire(now)
    if (pgn === PGN.TP_CM) return this.handleConnectionManagement(sourceAddress, destinationAddress, data, now)
    if (pgn === PGN.TP_DT) return this.handleDataTransfer(sourceAddress, destinationAddress, data)
    return null
  }

  private handleConnectionManagement(sa: number, da: number, data: Uint8Array, now: number): null {
    if (data.length < 8) return null
    const control = data[0]
    if (control === TP_CONTROL.BAM || control === TP_CONTROL.RTS) {
      const totalBytes = data[1] | (data[2] << 8)
      const totalPackets = data[3]
      const pgn = data[5] | (data[6] << 8) | (data[7] << 16)
      // A new announce for the same pair replaces any half-finished session.
      this.sessions.set(this.key(sa, da), {
        key: this.key(sa, da),
        pgn,
        sourceAddress: sa,
        destinationAddress: da,
        totalBytes,
        totalPackets,
        received: new Map(),
        startedAt: now,
        broadcast: control === TP_CONTROL.BAM,
      })
      return null
    }
    if (control === TP_CONTROL.ABORT || control === TP_CONTROL.END_OF_MSG_ACK) {
      this.sessions.delete(this.key(sa, da))
    }
    return null
  }

  private handleDataTransfer(sa: number, da: number, data: Uint8Array): ReassembledMessage | null {
    const session = this.sessions.get(this.key(sa, da))
    if (!session || data.length < 2) return null
    const sequence = data[0]
    if (sequence < 1 || sequence > session.totalPackets) return null
    session.received.set(sequence, data.slice(1, 8))
    if (session.received.size < session.totalPackets) return null

    const assembled = new Uint8Array(session.totalBytes)
    let offset = 0
    for (let seq = 1; seq <= session.totalPackets; seq++) {
      const chunk = session.received.get(seq)
      if (!chunk) return null
      for (let i = 0; i < chunk.length && offset < session.totalBytes; i++) {
        assembled[offset++] = chunk[i]
      }
    }
    this.sessions.delete(session.key)
    return {
      pgn: session.pgn,
      sourceAddress: session.sourceAddress,
      destinationAddress: session.destinationAddress,
      data: assembled,
      broadcast: session.broadcast,
    }
  }

  private expire(now: number): void {
    for (const [key, session] of this.sessions) {
      if (now - session.startedAt > SESSION_TIMEOUT_MS) this.sessions.delete(key)
    }
  }

  /** Number of sessions currently being reassembled - surfaced in diagnostics. */
  get pendingSessions(): number {
    return this.sessions.size
  }

  reset(): void {
    this.sessions.clear()
  }
}

/**
 * Build the payload of a Request PGN (59904) message.
 * The requested PGN is carried little-endian in three bytes.
 */
export function buildRequestPayload(pgn: number): Uint8Array {
  return new Uint8Array([pgn & 0xff, (pgn >>> 8) & 0xff, (pgn >>> 16) & 0xff])
}

/** Split a long payload into BAM packets ready for transmission. */
export function buildBamPackets(pgn: number, data: Uint8Array): { control: Uint8Array; packets: Uint8Array[] } {
  const totalPackets = Math.ceil(data.length / 7)
  const control = new Uint8Array([
    TP_CONTROL.BAM,
    data.length & 0xff,
    (data.length >>> 8) & 0xff,
    totalPackets,
    0xff,
    pgn & 0xff,
    (pgn >>> 8) & 0xff,
    (pgn >>> 16) & 0xff,
  ])
  const packets: Uint8Array[] = []
  for (let i = 0; i < totalPackets; i++) {
    const packet = new Uint8Array(8).fill(0xff)
    packet[0] = i + 1
    packet.set(data.subarray(i * 7, i * 7 + 7), 1)
    packets.push(packet)
  }
  return { control, packets }
}

export { GLOBAL_ADDRESS }
