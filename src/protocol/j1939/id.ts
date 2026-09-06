/**
 * SAE J1939-21 identifier handling.
 *
 * A J1939 frame uses a 29-bit extended CAN identifier laid out as:
 *
 *   bits 28..26  priority (0 = highest)
 *   bit  25      extended data page (EDP)
 *   bit  24      data page (DP)
 *   bits 23..16  PDU format (PF)
 *   bits 15..8   PDU specific (PS) - destination address when PF < 240,
 *                                    group extension when PF >= 240
 *   bits  7..0   source address (SA)
 */

export const GLOBAL_ADDRESS = 0xff
export const NULL_ADDRESS = 0xfe

export interface J1939Header {
  priority: number
  pgn: number
  sourceAddress: number
  /** 0xFF for broadcast (PDU2) messages. */
  destinationAddress: number
}

export function decodeCanId(canId: number): J1939Header {
  const id = canId >>> 0
  const priority = (id >>> 26) & 0x07
  const edp = (id >>> 25) & 0x01
  const dp = (id >>> 24) & 0x01
  const pf = (id >>> 16) & 0xff
  const ps = (id >>> 8) & 0xff
  const sourceAddress = id & 0xff

  if (pf < 240) {
    // PDU1: destination specific, PS carries the destination address.
    return {
      priority,
      pgn: (edp << 17) | (dp << 16) | (pf << 8),
      sourceAddress,
      destinationAddress: ps,
    }
  }
  // PDU2: broadcast, PS is part of the PGN.
  return {
    priority,
    pgn: (edp << 17) | (dp << 16) | (pf << 8) | ps,
    sourceAddress,
    destinationAddress: GLOBAL_ADDRESS,
  }
}

export function encodeCanId(header: J1939Header): number {
  const { priority, pgn, sourceAddress, destinationAddress } = header
  const edp = (pgn >>> 17) & 0x01
  const dp = (pgn >>> 16) & 0x01
  const pf = (pgn >>> 8) & 0xff
  const ps = pf < 240 ? destinationAddress & 0xff : pgn & 0xff
  return (
    ((priority & 0x07) << 26) |
    (edp << 25) |
    (dp << 24) |
    (pf << 16) |
    (ps << 8) |
    (sourceAddress & 0xff)
  ) >>> 0
}

/** True when the PGN is destination specific (PDU1). */
export function isPdu1(pgn: number): boolean {
  return ((pgn >>> 8) & 0xff) < 240
}

export function formatCanId(canId: number): string {
  return (canId >>> 0).toString(16).toUpperCase().padStart(8, '0')
}

export function formatPgn(pgn: number): string {
  return `${pgn} (0x${pgn.toString(16).toUpperCase().padStart(4, '0')})`
}
