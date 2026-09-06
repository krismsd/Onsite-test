import { describe, it, expect } from 'vitest'
import { decodeCanId, encodeCanId } from '../protocol/j1939/id'
import { PGN } from '../protocol/j1939/pgn-numbers'
import { decodePgn } from '../protocol/j1939/decode'
import { u8, u16, scale, asciiFields } from '../protocol/j1939/scaling'
import {
  TransportProtocolReassembler,
  buildBamPackets,
  buildRequestPayload,
} from '../protocol/j1939/transport'
import {
  decodeDtc,
  encodeDtc,
  decodeDiagnosticMessage,
  encodeDiagnosticMessage,
  mergeDtcs,
  decodeLampByte,
} from '../protocol/j1939/dtc'

describe('J1939 identifiers', () => {
  it('decodes a PDU2 broadcast identifier', () => {
    // 0x0CF00400: priority 3, PGN 61444 (EEC1), source address 0.
    const header = decodeCanId(0x0cf00400)
    expect(header.priority).toBe(3)
    expect(header.pgn).toBe(PGN.EEC1)
    expect(header.sourceAddress).toBe(0x00)
    expect(header.destinationAddress).toBe(0xff)
  })

  it('decodes a PDU1 destination-specific identifier', () => {
    // 0x18EA00F9: request PGN sent from 0xF9 to 0x00.
    const header = decodeCanId(0x18ea00f9)
    expect(header.pgn).toBe(PGN.REQUEST)
    expect(header.sourceAddress).toBe(0xf9)
    expect(header.destinationAddress).toBe(0x00)
  })

  it('round-trips both PDU formats', () => {
    for (const canId of [0x0cf00400, 0x18feee00, 0x18ea00f9, 0x18eafff9, 0x1cecff00]) {
      const header = decodeCanId(canId)
      expect(encodeCanId(header)).toBe(canId)
    }
  })
})

describe('field scaling', () => {
  it('treats 0xFF and 0xFFFF as not available', () => {
    expect(u8(new Uint8Array([0xff]), 0)).toBeUndefined()
    expect(u8(new Uint8Array([0xfe]), 0)).toBeUndefined()
    expect(u16(new Uint8Array([0xff, 0xff]), 0)).toBeUndefined()
    expect(scale(undefined, 0.125)).toBeUndefined()
  })

  it('applies resolution and offset', () => {
    expect(scale(u8(new Uint8Array([90]), 0), 1, -40)).toBe(50)
  })

  it('splits asterisk-delimited identification fields', () => {
    const text = 'CUMMINS*ISX15*79451235*UNIT 4471*'
    const bytes = new Uint8Array([...text].map((c) => c.charCodeAt(0)))
    expect(asciiFields(bytes)).toEqual(['CUMMINS', 'ISX15', '79451235', 'UNIT 4471'])
  })
})

describe('PGN decoders', () => {
  it('decodes engine speed from EEC1', () => {
    // 1400 rpm at 0.125 rpm/bit = 11200 = 0x2BC0, little-endian.
    const data = new Uint8Array([0xf0, 0xc8, 0xc8, 0xc0, 0x2b, 0x00, 0xff, 0xff])
    const decoded = decodePgn(PGN.EEC1, data)
    expect(decoded.engineSpeedRpm).toBeCloseTo(1400, 5)
    expect(decoded.torquePct).toBe(75) // 200 - 125
  })

  it('decodes coolant temperature from ET1', () => {
    const data = new Uint8Array([0x7a, 0x50, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])
    const decoded = decodePgn(PGN.ET1, data)
    expect(decoded.coolantTempC).toBe(82) // 122 - 40
    expect(decoded.fuelTempC).toBe(40)
  })

  it('decodes oil pressure from EFL/P1 at 4 kPa per bit', () => {
    const data = new Uint8Array([0x64, 0xff, 0xff, 0x64, 0xff, 0xff, 0xff, 0xff])
    const decoded = decodePgn(PGN.EFL_P1, data)
    expect(decoded.oilPressureKpa).toBe(400)
    expect(decoded.fuelPressureKpa).toBe(400)
  })

  it('omits fields that are not available rather than inventing values', () => {
    const decoded = decodePgn(PGN.ET1, new Uint8Array(8).fill(0xff))
    expect(Object.keys(decoded)).toHaveLength(0)
  })

  it('returns nothing for an unknown PGN', () => {
    expect(decodePgn(0x1234, new Uint8Array(8))).toEqual({})
  })
})

describe('transport protocol', () => {
  it('reassembles a BAM message', () => {
    const payload = new Uint8Array(20)
    for (let i = 0; i < payload.length; i++) payload[i] = i + 1
    const { control, packets } = buildBamPackets(PGN.DM1, payload)

    const reassembler = new TransportProtocolReassembler()
    expect(reassembler.handle(PGN.TP_CM, 0x00, 0xff, control, 0)).toBeNull()
    let result = null
    for (const packet of packets) {
      result = reassembler.handle(PGN.TP_DT, 0x00, 0xff, packet, 0)
    }
    expect(result).not.toBeNull()
    expect(result?.pgn).toBe(PGN.DM1)
    expect(result?.sourceAddress).toBe(0x00)
    expect(Array.from(result!.data)).toEqual(Array.from(payload))
  })

  it('discards a session that never completes', () => {
    const reassembler = new TransportProtocolReassembler()
    const { control, packets } = buildBamPackets(PGN.DM1, new Uint8Array(20))
    reassembler.handle(PGN.TP_CM, 0x00, 0xff, control, 0)
    reassembler.handle(PGN.TP_DT, 0x00, 0xff, packets[0], 0)
    expect(reassembler.pendingSessions).toBe(1)
    // A later frame past the timeout expires the stale session.
    reassembler.handle(PGN.TP_DT, 0x01, 0xff, packets[0], 5000)
    expect(reassembler.pendingSessions).toBe(0)
  })

  it('builds a little-endian request payload', () => {
    expect(Array.from(buildRequestPayload(PGN.COMPONENT_ID))).toEqual([0xeb, 0xfe, 0x00])
  })
})

describe('diagnostic messages', () => {
  it('round-trips a DTC through its packed form', () => {
    const dtc = { spn: 3719, fmi: 16, occurrenceCount: 5, conversionMethod: 0 }
    expect(decodeDtc(encodeDtc(dtc))).toEqual(dtc)
  })

  it('handles SPNs above 65535 using the high bits of byte 2', () => {
    const dtc = { spn: 131071, fmi: 3, occurrenceCount: 1, conversionMethod: 0 }
    const encoded = encodeDtc(dtc)
    const decoded = decodeDtc(encoded)
    expect(decoded.spn).toBe(131071)
    expect(decoded.fmi).toBe(3)
  })

  it('decodes lamp status bits', () => {
    // Amber warning lamp on (bits 3-2 = 01) => 0b0000_0100.
    expect(decodeLampByte(0x04)).toEqual({ protect: false, amber: true, red: false, malfunction: false })
    expect(decodeLampByte(0x10).red).toBe(true)
  })

  it('reports no faults for an all-clear DM1', () => {
    const payload = encodeDiagnosticMessage(
      { malfunction: false, red: false, amber: false, protect: false },
      [],
    )
    expect(decodeDiagnosticMessage(payload).dtcs).toHaveLength(0)
  })

  it('decodes a multi-fault DM1', () => {
    const dtcs = [
      { spn: 100, fmi: 1, occurrenceCount: 3, conversionMethod: 0 },
      { spn: 110, fmi: 0, occurrenceCount: 1, conversionMethod: 0 },
    ]
    const payload = encodeDiagnosticMessage(
      { malfunction: false, red: true, amber: false, protect: false },
      dtcs,
    )
    const decoded = decodeDiagnosticMessage(payload)
    expect(decoded.lamps.red).toBe(true)
    expect(decoded.dtcs).toEqual(dtcs)
  })

  it('marks a fault inactive when it disappears from DM1', () => {
    const first = mergeDtcs([], [{ spn: 100, fmi: 1, occurrenceCount: 1, conversionMethod: 0 }], 0, true, 1000)
    expect(first[0].active).toBe(true)

    const second = mergeDtcs(first, [], 0, true, 2000)
    expect(second).toHaveLength(1)
    expect(second[0].active).toBe(false)
    expect(second[0].firstSeen).toBe(1000)
    expect(second[0].lastSeen).toBe(2000)
  })

  it('does not duplicate a fault repeated every second', () => {
    let tracked = mergeDtcs([], [{ spn: 110, fmi: 16, occurrenceCount: 2, conversionMethod: 0 }], 0, true, 1000)
    tracked = mergeDtcs(tracked, [{ spn: 110, fmi: 16, occurrenceCount: 2, conversionMethod: 0 }], 0, true, 2000)
    expect(tracked).toHaveLength(1)
    expect(tracked[0].lastSeen).toBe(2000)
  })

  it('keeps faults from different controllers apart', () => {
    let tracked = mergeDtcs([], [{ spn: 100, fmi: 1, occurrenceCount: 1, conversionMethod: 0 }], 0x00, true, 1000)
    tracked = mergeDtcs(tracked, [{ spn: 100, fmi: 1, occurrenceCount: 1, conversionMethod: 0 }], 0x03, true, 1000)
    expect(tracked).toHaveLength(2)
  })
})
