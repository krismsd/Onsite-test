import type { DiagnosticTroubleCode, LampStatus } from '../../model/types'

/**
 * SAE J1939-73 diagnostic message handling.
 *
 * DM1 carries currently active DTCs, DM2 previously active ones. Both use the
 * same layout: two lamp bytes followed by any number of 4-byte DTC records.
 */

export interface DiagnosticMessage {
  lamps: LampStatus
  flashLamps: LampStatus
  dtcs: RawDtc[]
}

export interface RawDtc {
  spn: number
  fmi: number
  occurrenceCount: number
  conversionMethod: number
}

/** Decode one 2-bit-per-lamp status byte. */
export function decodeLampByte(byte: number): LampStatus {
  const on = (shift: number) => ((byte >> shift) & 0x03) === 0x01
  return {
    protect: on(0),
    amber: on(2),
    red: on(4),
    malfunction: on(6),
  }
}

/**
 * Decode a single 4-byte DTC record.
 *
 * Version 4 (current) packing:
 *   byte 0      SPN bits 0-7
 *   byte 1      SPN bits 8-15
 *   byte 2      bits 7-5 = SPN bits 16-18, bits 4-0 = FMI
 *   byte 3      bit 7 = SPN conversion method, bits 6-0 = occurrence count
 *
 * When the conversion method bit is set the ECM is using an older or
 * manufacturer-defined packing; `decodeDtcLegacy` covers the common variant.
 */
export function decodeDtc(bytes: Uint8Array, offset = 0): RawDtc {
  const b0 = bytes[offset]
  const b1 = bytes[offset + 1]
  const b2 = bytes[offset + 2]
  const b3 = bytes[offset + 3]
  return {
    spn: b0 | (b1 << 8) | ((b2 >> 5) << 16),
    fmi: b2 & 0x1f,
    conversionMethod: (b3 >> 7) & 0x01,
    occurrenceCount: b3 & 0x7f,
  }
}

/**
 * Legacy (version 1) packing, in which the three SPN bytes are most
 * significant first. Offered as an alternate interpretation when a controller
 * reports conversion method 1 and the version 4 decode yields a nonsense SPN.
 */
export function decodeDtcLegacy(bytes: Uint8Array, offset = 0): RawDtc {
  const b0 = bytes[offset]
  const b1 = bytes[offset + 1]
  const b2 = bytes[offset + 2]
  const b3 = bytes[offset + 3]
  return {
    spn: (b0 << 11) | (b1 << 3) | (b2 >> 5),
    fmi: b2 & 0x1f,
    conversionMethod: (b3 >> 7) & 0x01,
    occurrenceCount: b3 & 0x7f,
  }
}

/**
 * A DM1 with no active faults still carries one all-zero DTC record.
 * That placeholder must not be shown as a fault.
 */
function isPlaceholder(dtc: RawDtc): boolean {
  return dtc.spn === 0 && dtc.fmi === 0
}

/** Decode a complete DM1/DM2 payload. */
export function decodeDiagnosticMessage(data: Uint8Array): DiagnosticMessage {
  const lamps = decodeLampByte(data[0] ?? 0)
  const flashLamps = decodeLampByte(data[1] ?? 0)
  const dtcs: RawDtc[] = []
  for (let offset = 2; offset + 3 < data.length; offset += 4) {
    const dtc = decodeDtc(data, offset)
    // 0xFFFFFFFF pads the tail of an 8-byte single-DTC message.
    if (dtc.spn === 0x7ffff && dtc.fmi === 0x1f) continue
    if (isPlaceholder(dtc)) continue
    dtcs.push(dtc)
  }
  return { lamps, flashLamps, dtcs }
}

/** Encode a DTC back into its 4-byte form (used by the simulator and tests). */
export function encodeDtc(dtc: RawDtc): Uint8Array {
  return new Uint8Array([
    dtc.spn & 0xff,
    (dtc.spn >> 8) & 0xff,
    (((dtc.spn >> 16) & 0x07) << 5) | (dtc.fmi & 0x1f),
    ((dtc.conversionMethod & 0x01) << 7) | (dtc.occurrenceCount & 0x7f),
  ])
}

/** Encode a lamp status byte. */
export function encodeLampByte(lamps: LampStatus): number {
  return (
    (lamps.protect ? 0x01 : 0) |
    (lamps.amber ? 0x04 : 0) |
    (lamps.red ? 0x10 : 0) |
    (lamps.malfunction ? 0x40 : 0)
  )
}

/** Build a complete DM1/DM2 payload from lamp state and a DTC list. */
export function encodeDiagnosticMessage(lamps: LampStatus, dtcs: RawDtc[]): Uint8Array {
  if (dtcs.length === 0) {
    // No faults: lamp bytes then a single zeroed DTC, padded to 8 bytes.
    return new Uint8Array([encodeLampByte(lamps), 0xff, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff])
  }
  const payload = new Uint8Array(2 + dtcs.length * 4)
  payload[0] = encodeLampByte(lamps)
  payload[1] = 0xff
  dtcs.forEach((dtc, index) => payload.set(encodeDtc(dtc), 2 + index * 4))
  return payload
}

/** Stable key used to track a DTC across DM1 broadcasts. */
export function dtcKey(sourceAddress: number, spn: number, fmi: number): string {
  return `${sourceAddress}:${spn}:${fmi}`
}

/**
 * Merge a freshly received DM1/DM2 into the tracked DTC list.
 *
 * DM1 is broadcast once a second while a fault is active, so the tracker keys
 * on SA/SPN/FMI and updates timestamps rather than appending duplicates.
 */
export function mergeDtcs(
  existing: DiagnosticTroubleCode[],
  incoming: RawDtc[],
  sourceAddress: number,
  active: boolean,
  now: number,
): DiagnosticTroubleCode[] {
  const byKey = new Map(existing.map((d) => [dtcKey(d.sourceAddress, d.spn, d.fmi), { ...d }]))

  // Any DTC previously reported active by this node but absent from this
  // broadcast has gone inactive.
  if (active) {
    const incomingKeys = new Set(incoming.map((d) => dtcKey(sourceAddress, d.spn, d.fmi)))
    for (const [key, dtc] of byKey) {
      if (dtc.sourceAddress === sourceAddress && dtc.active && !incomingKeys.has(key)) {
        dtc.active = false
        dtc.lastSeen = now
      }
    }
  }

  for (const raw of incoming) {
    const key = dtcKey(sourceAddress, raw.spn, raw.fmi)
    const found = byKey.get(key)
    if (found) {
      found.occurrenceCount = Math.max(found.occurrenceCount, raw.occurrenceCount)
      found.lastSeen = now
      found.active = active || found.active
      if (active) found.active = true
    } else {
      byKey.set(key, {
        spn: raw.spn,
        fmi: raw.fmi,
        occurrenceCount: raw.occurrenceCount,
        conversionMethod: raw.conversionMethod,
        sourceAddress,
        active,
        firstSeen: now,
        lastSeen: now,
      })
    }
  }

  return [...byKey.values()]
}
