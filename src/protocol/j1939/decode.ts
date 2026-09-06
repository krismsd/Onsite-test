import type { SignalKey } from '../../model/types'
import { PGN } from './pgn-numbers'
import { u8, u16, u32, scale, bits2, bitsN, asciiFields } from './scaling'

/**
 * SAE J1939-71 application layer decoders.
 *
 * Each decoder converts one PGN payload into engineering units. Resolutions
 * and offsets follow J1939-71; fields that read as "not available" are left
 * undefined rather than being scaled into a bogus value.
 */

export type DecodedSignals = Partial<Record<SignalKey, number>>

export interface PgnDecoder {
  pgn: number
  /** SAE acronym, shown in the datalink monitor. */
  acronym: string
  name: string
  /** Expected payload length in bytes; 0 for variable-length messages. */
  length: number
  decode: (data: Uint8Array) => DecodedSignals
}

const decoders: PgnDecoder[] = [
  {
    pgn: PGN.EEC1,
    acronym: 'EEC1',
    name: 'Electronic Engine Controller 1',
    length: 8,
    decode: (d) => ({
      torquePct: scale(u8(d, 2), 1, -125),
      engineSpeedRpm: scale(u16(d, 3), 0.125),
    }),
  },
  {
    pgn: PGN.EEC2,
    acronym: 'EEC2',
    name: 'Electronic Engine Controller 2',
    length: 8,
    decode: (d) => ({
      throttlePct: scale(u8(d, 1), 0.4),
      engineLoadPct: scale(u8(d, 2), 1),
    }),
  },
  {
    pgn: PGN.ET1,
    acronym: 'ET1',
    name: 'Engine Temperature 1',
    length: 8,
    decode: (d) => ({
      coolantTempC: scale(u8(d, 0), 1, -40),
      fuelTempC: scale(u8(d, 1), 1, -40),
      oilTempC: scale(u16(d, 2), 0.03125, -273),
    }),
  },
  {
    pgn: PGN.EFL_P1,
    acronym: 'EFL/P1',
    name: 'Engine Fluid Level/Pressure 1',
    length: 8,
    decode: (d) => ({
      fuelPressureKpa: scale(u8(d, 0), 4),
      oilPressureKpa: scale(u8(d, 3), 4),
      crankcasePressureKpa: scale(u16(d, 4), 1 / 128, -250),
    }),
  },
  {
    pgn: PGN.EFL_P2,
    acronym: 'EFL/P2',
    name: 'Engine Fluid Level/Pressure 2',
    length: 8,
    decode: (d) => ({
      // Injector metering rail 1 pressure, 0.1 MPa/bit => 1 bar/bit.
      fuelRailPressureBar: scale(u16(d, 0), 1),
    }),
  },
  {
    pgn: PGN.IC1,
    acronym: 'IC1',
    name: 'Inlet/Exhaust Conditions 1',
    length: 8,
    decode: (d) => ({
      intakeManifoldPressureKpa: scale(u8(d, 1), 2),
      intakeManifoldTempC: scale(u8(d, 2), 1, -40),
      exhaustTempC: scale(u16(d, 5), 0.03125, -273),
    }),
  },
  {
    pgn: PGN.VEP1,
    acronym: 'VEP1',
    name: 'Vehicle Electrical Power 1',
    length: 8,
    decode: (d) => ({
      batteryVoltage: scale(u16(d, 6), 0.05),
    }),
  },
  {
    pgn: PGN.HOURS,
    acronym: 'HOURS',
    name: 'Engine Hours, Revolutions',
    length: 8,
    decode: (d) => ({
      engineHours: scale(u32(d, 0), 0.05),
    }),
  },
  {
    pgn: PGN.LFC,
    acronym: 'LFC',
    name: 'Fuel Consumption (Liquid)',
    length: 8,
    decode: (d) => ({
      tripFuelLitres: scale(u32(d, 0), 0.5),
      totalFuelLitres: scale(u32(d, 4), 0.5),
    }),
  },
  {
    pgn: PGN.LFE,
    acronym: 'LFE',
    name: 'Fuel Economy (Liquid)',
    length: 8,
    decode: (d) => ({
      fuelRateLph: scale(u16(d, 0), 0.05),
      instantFuelEconomyKmpl: scale(u16(d, 2), 1 / 512),
      avgFuelEconomyKmpl: scale(u16(d, 4), 1 / 512),
    }),
  },
  {
    pgn: PGN.CCVS1,
    acronym: 'CCVS1',
    name: 'Cruise Control/Vehicle Speed 1',
    length: 8,
    decode: (d) => {
      const ptoState = bitsN(d, 6, 0, 5)
      return {
        vehicleSpeedKph: scale(u16(d, 1), 1 / 256),
        cruiseActive: bits2(d, 3, 0),
        brakeSwitch: bits2(d, 3, 4),
        clutchSwitch: bits2(d, 3, 6),
        // PTO governor state: 0 = off/disabled, 31 = not available.
        ptoActive: ptoState === undefined || ptoState === 31 ? undefined : ptoState > 0 ? 1 : 0,
      }
    },
  },
  {
    pgn: PGN.AMB,
    acronym: 'AMB',
    name: 'Ambient Conditions',
    length: 8,
    decode: (d) => ({
      barometricPressureKpa: scale(u8(d, 0), 0.5),
      ambientTempC: scale(u16(d, 3), 0.03125, -273),
      airInletTempC: scale(u8(d, 5), 1, -40),
    }),
  },
  {
    pgn: PGN.HRVD,
    acronym: 'HRVD',
    name: 'High Resolution Vehicle Distance',
    length: 8,
    decode: (d) => ({
      // 5 m/bit => 0.005 km/bit.
      odometerKm: scale(u32(d, 0), 0.005),
      tripDistanceKm: scale(u32(d, 4), 0.005),
    }),
  },
  {
    pgn: PGN.VD,
    acronym: 'VD',
    name: 'Vehicle Distance',
    length: 8,
    decode: (d) => ({
      tripDistanceKm: scale(u32(d, 0), 0.125),
      odometerKm: scale(u32(d, 4), 0.125),
    }),
  },
  {
    pgn: PGN.TCI1,
    acronym: 'TCI1',
    name: 'Turbocharger Information 1',
    length: 8,
    decode: (d) => ({
      turbochargerSpeedRpm: scale(u16(d, 1), 4),
    }),
  },
  {
    pgn: PGN.DPFC1,
    acronym: 'DPFC1',
    name: 'Diesel Particulate Filter Control 1',
    length: 8,
    decode: (d) => ({
      dpfSootLoadPct: scale(u8(d, 2), 0.4),
    }),
  },
  {
    pgn: PGN.AT1T1I,
    acronym: 'AT1T1I',
    name: 'Aftertreatment 1 SCR Tank Information',
    length: 8,
    decode: (d) => ({
      defLevelPct: scale(u8(d, 0), 0.4),
      defTankTempC: scale(u8(d, 1), 1, -40),
    }),
  },
]

const decoderByPgn = new Map(decoders.map((d) => [d.pgn, d]))

export function decoderFor(pgn: number): PgnDecoder | undefined {
  return decoderByPgn.get(pgn)
}

export function allDecoders(): PgnDecoder[] {
  return decoders
}

/** Decode a payload into engineering values; empty for unknown PGNs. */
export function decodePgn(pgn: number, data: Uint8Array): DecodedSignals {
  const decoder = decoderByPgn.get(pgn)
  if (!decoder) return {}
  const decoded = decoder.decode(data)
  // Drop undefined entries so callers can spread the result safely.
  const result: DecodedSignals = {}
  for (const [key, value] of Object.entries(decoded)) {
    if (value !== undefined && Number.isFinite(value)) {
      result[key as SignalKey] = value as number
    }
  }
  return result
}

/** Human-readable label for a PGN, falling back to the raw number. */
export function pgnLabel(pgn: number): string {
  const decoder = decoderByPgn.get(pgn)
  if (decoder) return decoder.acronym
  switch (pgn) {
    case PGN.REQUEST: return 'Request'
    case PGN.ACK: return 'ACK'
    case PGN.TP_CM: return 'TP.CM'
    case PGN.TP_DT: return 'TP.DT'
    case PGN.ADDRESS_CLAIM: return 'AddrClaim'
    case PGN.DM1: return 'DM1'
    case PGN.DM2: return 'DM2'
    case PGN.DM3: return 'DM3'
    case PGN.DM5: return 'DM5'
    case PGN.DM11: return 'DM11'
    case PGN.COMPONENT_ID: return 'CompID'
    case PGN.SOFTWARE_ID: return 'SoftID'
    case PGN.VIN: return 'VIN'
    default: return `PGN ${pgn}`
  }
}

/** Decode component identification (Make*Model*Serial*Unit). */
export function decodeComponentId(data: Uint8Array): { make?: string; model?: string; serialNumber?: string; unitNumber?: string } {
  const fields = asciiFields(data)
  return {
    make: fields[0],
    model: fields[1],
    serialNumber: fields[2],
    unitNumber: fields[3],
  }
}

/** Decode software identification: leading count byte, then '*'-delimited fields. */
export function decodeSoftwareId(data: Uint8Array): string[] {
  if (data.length === 0) return []
  return asciiFields(data, 1)
}

export function decodeVin(data: Uint8Array): string | undefined {
  const fields = asciiFields(data)
  return fields[0]
}

/** Decode the 64-bit NAME carried by an address-claim message. */
export function decodeName(data: Uint8Array) {
  if (data.length < 8) return undefined
  const identityNumber = (data[0] | (data[1] << 8) | ((data[2] & 0x1f) << 16)) >>> 0
  const manufacturerCode = ((data[2] >> 5) | (data[3] << 3)) & 0x7ff
  return {
    identityNumber,
    manufacturerCode,
    ecuInstance: data[4] & 0x07,
    functionInstance: (data[4] >> 3) & 0x1f,
    function: data[5],
    vehicleSystem: (data[6] >> 1) & 0x7f,
    vehicleSystemInstance: data[7] & 0x0f,
    industryGroup: (data[7] >> 4) & 0x07,
    arbitraryAddressCapable: (data[7] & 0x80) !== 0,
  }
}
