import type { CanFrame } from '../protocol/framing'
import { encodeCanId, decodeCanId, GLOBAL_ADDRESS } from '../protocol/j1939/id'
import { PGN, ADDRESS } from '../protocol/j1939/pgn-numbers'
import { buildBamPackets } from '../protocol/j1939/transport'
import { encodeDiagnosticMessage } from '../protocol/j1939/dtc'
import type { RawDtc } from '../protocol/j1939/dtc'
import type { LampStatus } from '../model/types'
import { stepEngine, sensorReadings, INITIAL_STATE, NO_FAULTS, CYLINDERS } from './engine-model'
import type { EngineInputs, EngineState, FaultInjection } from './engine-model'

/**
 * Simulated engine ECM.
 *
 * Runs the engine model and broadcasts real J1939 messages at the rates a
 * production ECM uses, so the entire decode path - framing, transport
 * protocol reassembly, PGN scaling and DM1 handling - is exercised exactly as
 * it is against real hardware.
 */

const ENGINE_ADDRESS = ADDRESS.ENGINE_1

/** Clamp and encode helpers: values outside range become "not available". */
function enc8(value: number | null, resolution: number, offset = 0): number {
  if (value === null || !Number.isFinite(value)) return 0xff
  const raw = Math.round((value - offset) / resolution)
  return raw < 0 || raw > 0xfa ? 0xff : raw
}

function enc16(value: number | null, resolution: number, offset = 0): [number, number] {
  if (value === null || !Number.isFinite(value)) return [0xff, 0xff]
  const raw = Math.round((value - offset) / resolution)
  if (raw < 0 || raw > 0xfaff) return [0xff, 0xff]
  return [raw & 0xff, (raw >> 8) & 0xff]
}

function enc32(value: number | null, resolution: number, offset = 0): [number, number, number, number] {
  if (value === null || !Number.isFinite(value)) return [0xff, 0xff, 0xff, 0xff]
  const raw = Math.round((value - offset) / resolution)
  if (raw < 0 || raw > 0xfaffffff) return [0xff, 0xff, 0xff, 0xff]
  return [raw & 0xff, (raw >>> 8) & 0xff, (raw >>> 16) & 0xff, (raw >>> 24) & 0xff]
}

function ascii(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff
  return bytes
}

export interface SimulatedEcmIdentity {
  make: string
  model: string
  serialNumber: string
  unitNumber: string
  softwareIdentification: string
  vin: string
  calibrationId: string
  ratedPowerHp: number
  ratedSpeedRpm: number
}

export const DEFAULT_IDENTITY: SimulatedEcmIdentity = {
  make: 'SIMULATED',
  model: 'BENCH ECM 15L I6',
  serialNumber: '79451235',
  unitNumber: 'UNIT 4471',
  softwareIdentification: 'SIM-CAL-4419372',
  vin: 'SIMULATOR00000001',
  calibrationId: 'BENCH_15L_4419372_01',
  ratedPowerHp: 450,
  ratedSpeedRpm: 1800,
}

interface BroadcastDefinition {
  pgn: number
  periodMs: number
  priority: number
  build: (state: EngineState, sim: EcmSimulator) => Uint8Array
}

/** J1939-71 recommended transmission rates. */
const BROADCASTS: BroadcastDefinition[] = [
  {
    pgn: PGN.EEC1, periodMs: 20, priority: 3,
    build: (s) => {
      const [rpmLo, rpmHi] = enc16(s.engineSpeedRpm, 0.125)
      return new Uint8Array([
        0xf0,
        enc8(s.torquePct, 1, -125),
        enc8(s.torquePct, 1, -125),
        rpmLo, rpmHi,
        ENGINE_ADDRESS,
        0xff, 0xff,
      ])
    },
  },
  {
    pgn: PGN.EEC2, periodMs: 50, priority: 3,
    build: (s) => new Uint8Array([
      0xfc,
      enc8(s.throttlePct, 0.4),
      enc8(s.engineLoadPct, 1),
      0xff, 0xff, 0xff, 0xff, 0xff,
    ]),
  },
  {
    pgn: PGN.ET1, periodMs: 1000, priority: 6,
    build: (s) => {
      const [oilLo, oilHi] = enc16(s.oilTempC, 0.03125, -273)
      return new Uint8Array([
        enc8(s.coolantTempC, 1, -40),
        enc8(s.fuelTempC, 1, -40),
        oilLo, oilHi,
        0xff, 0xff, 0xff, 0xff,
      ])
    },
  },
  {
    pgn: PGN.EFL_P1, periodMs: 500, priority: 6,
    build: (s) => {
      const [ccLo, ccHi] = enc16(s.crankcasePressureKpa, 1 / 128, -250)
      return new Uint8Array([
        enc8(s.fuelPressureKpa, 4),
        0xff,
        0xff,
        enc8(s.oilPressureKpa, 4),
        ccLo, ccHi,
        0xff, 0xff,
      ])
    },
  },
  {
    pgn: PGN.EFL_P2, periodMs: 500, priority: 6,
    build: (s) => {
      const [railLo, railHi] = enc16(s.fuelRailPressureBar, 1)
      return new Uint8Array([railLo, railHi, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])
    },
  },
  {
    pgn: PGN.IC1, periodMs: 500, priority: 6,
    build: (s) => {
      const [egtLo, egtHi] = enc16(s.exhaustTempC, 0.03125, -273)
      return new Uint8Array([
        0xff,
        enc8(s.boostKpa, 2),
        enc8(s.intakeManifoldTempC, 1, -40),
        0xff, 0xff,
        egtLo, egtHi,
        0xff,
      ])
    },
  },
  {
    pgn: PGN.VEP1, periodMs: 1000, priority: 6,
    build: (s) => {
      const [vLo, vHi] = enc16(s.batteryVoltage, 0.05)
      return new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, vLo, vHi])
    },
  },
  {
    pgn: PGN.HOURS, periodMs: 1000, priority: 6,
    build: (s) => new Uint8Array([...enc32(s.engineHours, 0.05), ...enc32(null, 1000)]),
  },
  {
    pgn: PGN.LFC, periodMs: 1000, priority: 6,
    build: (s) => new Uint8Array([...enc32(s.tripFuelLitres, 0.5), ...enc32(s.totalFuelLitres, 0.5)]),
  },
  {
    pgn: PGN.LFE, periodMs: 100, priority: 6,
    build: (s) => {
      const economy = s.fuelRateLph > 0.1 ? s.vehicleSpeedKph / s.fuelRateLph : 0
      const [rateLo, rateHi] = enc16(s.fuelRateLph, 0.05)
      const [instLo, instHi] = enc16(economy, 1 / 512)
      const [avgLo, avgHi] = enc16(s.totalFuelLitres > 0 ? s.odometerKm / s.totalFuelLitres : 0, 1 / 512)
      return new Uint8Array([rateLo, rateHi, instLo, instHi, avgLo, avgHi, enc8(s.throttlePct, 0.4), 0xff])
    },
  },
  {
    pgn: PGN.CCVS1, periodMs: 100, priority: 6,
    build: (s) => {
      const [spdLo, spdHi] = enc16(s.vehicleSpeedKph, 1 / 256)
      // byte 3: bits 0-1 cruise active, 4-5 brake switch, 6-7 clutch switch.
      const switches = 0x00
      return new Uint8Array([0xff, spdLo, spdHi, switches, 0xff, 0xff, 0x00, 0xff])
    },
  },
  {
    pgn: PGN.AMB, periodMs: 1000, priority: 6,
    build: (s) => {
      const [ambLo, ambHi] = enc16(s.ambientTempC, 0.03125, -273)
      return new Uint8Array([
        enc8(s.barometricPressureKpa, 0.5),
        0xff, 0xff,
        ambLo, ambHi,
        enc8(s.airInletTempC, 1, -40),
        0xff, 0xff,
      ])
    },
  },
  {
    pgn: PGN.HRVD, periodMs: 1000, priority: 6,
    build: (s) => new Uint8Array([...enc32(s.odometerKm, 0.005), ...enc32(s.tripDistanceKm, 0.005)]),
  },
  {
    pgn: PGN.TCI1, periodMs: 250, priority: 6,
    build: (s) => {
      const [tLo, tHi] = enc16(s.turbochargerSpeedRpm, 4)
      return new Uint8Array([0xff, tLo, tHi, 0xff, 0xff, 0xff, 0xff, 0xff])
    },
  },
  {
    pgn: PGN.DPFC1, periodMs: 1000, priority: 6,
    build: (s) => new Uint8Array([0xff, 0xff, enc8(s.dpfSootLoadPct, 0.4), 0xff, 0xff, 0xff, 0xff, 0xff]),
  },
  {
    pgn: PGN.AT1T1I, periodMs: 1000, priority: 6,
    build: (s) => new Uint8Array([
      enc8(s.defLevelPct, 0.4),
      enc8(s.defTankTempC, 1, -40),
      0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    ]),
  },
]

/** Conditions that raise a DTC, evaluated against the model each cycle. */
interface FaultRule {
  spn: number
  fmi: number
  lamp: 'amber' | 'red' | 'protect'
  test: (state: EngineState, faults: FaultInjection) => boolean
}

const FAULT_RULES: FaultRule[] = [
  { spn: 100, fmi: 3, lamp: 'amber', test: (_s, f) => f.oilPressureSensorHigh },
  { spn: 100, fmi: 4, lamp: 'amber', test: (_s, f) => f.oilPressureSensorLow },
  {
    // A range fault is only raised when the circuit itself is healthy: with a
    // failed sensor the ECM substitutes a default and reports the circuit fault
    // alone, which is what a real controller does.
    spn: 100, fmi: 1, lamp: 'red',
    test: (s, f) =>
      f.lowOilPressure && s.running && s.oilPressureKpa < 105 && !f.oilPressureSensorHigh && !f.oilPressureSensorLow,
  },
  { spn: 110, fmi: 3, lamp: 'amber', test: (_s, f) => f.coolantSensorHigh },
  { spn: 110, fmi: 4, lamp: 'amber', test: (_s, f) => f.coolantSensorLow },
  {
    spn: 110, fmi: 0, lamp: 'red',
    test: (s, f) => s.coolantTempC > 107 && !f.coolantSensorHigh && !f.coolantSensorLow,
  },
  {
    spn: 110, fmi: 16, lamp: 'amber',
    test: (s, f) => s.coolantTempC > 102 && s.coolantTempC <= 107 && !f.coolantSensorHigh && !f.coolantSensorLow,
  },
  { spn: 111, fmi: 1, lamp: 'red', test: (_s, f) => f.lowCoolantLevel },
  { spn: 190, fmi: 0, lamp: 'red', test: (s) => s.engineSpeedRpm > 2100 },
  { spn: 190, fmi: 2, lamp: 'red', test: (_s, f) => f.camSensorLoss },
  { spn: 102, fmi: 4, lamp: 'amber', test: (_s, f) => f.boostSensorLow },
  { spn: 94, fmi: 1, lamp: 'amber', test: (s, f) => f.fuelPressureLow && s.running },
  { spn: 168, fmi: 1, lamp: 'amber', test: (s, f) => f.chargingSystemFailure && s.batteryVoltage < 12.2 },
  { spn: 97, fmi: 15, lamp: 'protect', test: (_s, f) => f.waterInFuel },
  { spn: 620, fmi: 4, lamp: 'amber', test: (_s, f) => f.sensorSupplyLow },
  { spn: 629, fmi: 12, lamp: 'red', test: (_s, f) => f.ecmInternalFailure },
  { spn: 3719, fmi: 16, lamp: 'amber', test: (s) => s.dpfSootLoadPct > 80 },
  { spn: 1761, fmi: 1, lamp: 'amber', test: (s) => s.defLevelPct < 10 },
]

interface TrackedFault {
  spn: number
  fmi: number
  lamp: FaultRule['lamp']
  active: boolean
  occurrenceCount: number
}

export class EcmSimulator {
  state: EngineState = { ...INITIAL_STATE }
  inputs: EngineInputs = {
    keyOn: true,
    cranking: false,
    throttlePct: 0,
    loadDemand: 0,
    ambientTempC: 22,
    cutCylinders: [],
  }
  faults: FaultInjection = { ...NO_FAULTS }
  identity: SimulatedEcmIdentity = { ...DEFAULT_IDENTITY }

  private tracked = new Map<string, TrackedFault>()
  private lastSent = new Map<number, number>()
  private lastDm1 = 0
  private sequence = 0

  /** Start the engine directly, skipping the cranking sequence. */
  startEngine(): void {
    this.inputs.keyOn = true
    this.state = { ...this.state, running: true, engineSpeedRpm: 700 }
  }

  stopEngine(): void {
    this.state = { ...this.state, running: false }
  }

  get lamps(): LampStatus {
    const active = [...this.tracked.values()].filter((f) => f.active)
    return {
      malfunction: false,
      red: active.some((f) => f.lamp === 'red'),
      amber: active.some((f) => f.lamp === 'amber'),
      protect: active.some((f) => f.lamp === 'protect'),
    }
  }

  /** Faults currently latched, for the simulator control panel. */
  get activeFaults(): TrackedFault[] {
    return [...this.tracked.values()].filter((f) => f.active)
  }

  get inactiveFaults(): TrackedFault[] {
    return [...this.tracked.values()].filter((f) => !f.active)
  }

  /**
   * Advance the model and return every frame the ECM would put on the bus
   * during this interval.
   */
  step(dtSeconds: number, now: number): CanFrame[] {
    this.state = stepEngine(this.state, this.inputs, this.faults, dtSeconds)
    const readings = sensorReadings(this.state, this.faults) as EngineState
    this.evaluateFaults(readings)

    const frames: CanFrame[] = []
    for (const broadcast of BROADCASTS) {
      const last = this.lastSent.get(broadcast.pgn) ?? 0
      if (now - last < broadcast.periodMs) continue
      this.lastSent.set(broadcast.pgn, now)
      frames.push(this.frame(broadcast.pgn, GLOBAL_ADDRESS, broadcast.build(readings, this), broadcast.priority))
    }

    // DM1 is broadcast once a second while faults are present, and also once
    // a second when there are none (an all-clear DM1).
    if (now - this.lastDm1 >= 1000) {
      this.lastDm1 = now
      frames.push(...this.buildDm1())
    }

    return frames
  }

  private evaluateFaults(readings: EngineState): void {
    for (const rule of FAULT_RULES) {
      const key = `${rule.spn}:${rule.fmi}`
      const condition = rule.test(readings, this.faults)
      const existing = this.tracked.get(key)
      if (condition) {
        if (existing) {
          if (!existing.active) {
            existing.active = true
            existing.occurrenceCount = Math.min(126, existing.occurrenceCount + 1)
          }
        } else {
          this.tracked.set(key, { spn: rule.spn, fmi: rule.fmi, lamp: rule.lamp, active: true, occurrenceCount: 1 })
        }
      } else if (existing?.active) {
        existing.active = false
      }
    }
  }

  private frame(pgn: number, destination: number, data: Uint8Array, priority: number): CanFrame {
    return {
      canId: encodeCanId({ priority, pgn, sourceAddress: ENGINE_ADDRESS, destinationAddress: destination }),
      extended: true,
      data,
    }
  }

  /** DM1, using a BAM when more than one fault is active. */
  private buildDm1(): CanFrame[] {
    const active: RawDtc[] = this.activeFaults.map((fault) => ({
      spn: fault.spn,
      fmi: fault.fmi,
      occurrenceCount: fault.occurrenceCount,
      conversionMethod: 0,
    }))
    const payload = encodeDiagnosticMessage(this.lamps, active)
    if (payload.length <= 8) {
      return [this.frame(PGN.DM1, GLOBAL_ADDRESS, payload, 6)]
    }
    return this.buildBamFrames(PGN.DM1, payload)
  }

  private buildBamFrames(pgn: number, payload: Uint8Array): CanFrame[] {
    const { control, packets } = buildBamPackets(pgn, payload)
    const frames = [this.frame(PGN.TP_CM, GLOBAL_ADDRESS, control, 7)]
    for (const packet of packets) {
      frames.push(this.frame(PGN.TP_DT, GLOBAL_ADDRESS, packet, 7))
    }
    return frames
  }

  /** Respond to a frame sent by the service tool. */
  handleIncoming(frame: CanFrame): CanFrame[] {
    const header = decodeCanId(frame.canId)
    if (header.destinationAddress !== GLOBAL_ADDRESS && header.destinationAddress !== ENGINE_ADDRESS) {
      return []
    }

    switch (header.pgn) {
      case PGN.REQUEST: {
        const requested = frame.data[0] | (frame.data[1] << 8) | (frame.data[2] << 16)
        return this.respondToRequest(requested)
      }
      case PGN.DM3:
        // Clear previously active faults.
        for (const [key, fault] of this.tracked) {
          if (!fault.active) this.tracked.delete(key)
        }
        return [this.buildAck(PGN.DM3, header.sourceAddress, 0)]
      case PGN.DM11: {
        // Clear active faults. A real ECM refuses while the condition is
        // still present, so re-evaluate and only clear what has gone away.
        const readings = sensorReadings(this.state, this.faults) as EngineState
        let refused = false
        for (const [key, fault] of this.tracked) {
          const rule = FAULT_RULES.find((r) => r.spn === fault.spn && r.fmi === fault.fmi)
          if (rule && rule.test(readings, this.faults)) {
            refused = true
            continue
          }
          this.tracked.delete(key)
        }
        return [this.buildAck(PGN.DM11, header.sourceAddress, refused ? 1 : 0)]
      }
      default:
        return []
    }
  }

  private respondToRequest(pgn: number): CanFrame[] {
    switch (pgn) {
      case PGN.COMPONENT_ID: {
        const text = `${this.identity.make}*${this.identity.model}*${this.identity.serialNumber}*${this.identity.unitNumber}*`
        return this.buildBamFrames(PGN.COMPONENT_ID, ascii(text))
      }
      case PGN.SOFTWARE_ID: {
        const text = `${this.identity.softwareIdentification}*${this.identity.calibrationId}*`
        const payload = new Uint8Array(1 + text.length)
        payload[0] = 2
        payload.set(ascii(text), 1)
        return this.buildBamFrames(PGN.SOFTWARE_ID, payload)
      }
      case PGN.VIN:
        return this.buildBamFrames(PGN.VIN, ascii(`${this.identity.vin}*`))
      case PGN.ADDRESS_CLAIM:
        return [this.frame(PGN.ADDRESS_CLAIM, GLOBAL_ADDRESS, this.buildName(), 6)]
      case PGN.DM1:
        return this.buildDm1()
      case PGN.DM2: {
        const inactive: RawDtc[] = this.inactiveFaults.map((fault) => ({
          spn: fault.spn,
          fmi: fault.fmi,
          occurrenceCount: fault.occurrenceCount,
          conversionMethod: 0,
        }))
        const payload = encodeDiagnosticMessage({ malfunction: false, red: false, amber: false, protect: false }, inactive)
        return payload.length <= 8
          ? [this.frame(PGN.DM2, GLOBAL_ADDRESS, payload, 6)]
          : this.buildBamFrames(PGN.DM2, payload)
      }
      default:
        return []
    }
  }

  /** 64-bit NAME for the address claim. */
  private buildName(): Uint8Array {
    const identity = 0x1e240 // arbitrary identity number for the simulated ECM
    const manufacturerCode = 0x01
    return new Uint8Array([
      identity & 0xff,
      (identity >> 8) & 0xff,
      ((identity >> 16) & 0x1f) | ((manufacturerCode & 0x07) << 5),
      (manufacturerCode >> 3) & 0xff,
      0x00, // ECU instance 0, function instance 0
      0x00, // function: engine
      0x00, // vehicle system
      0x00, // industry group 0, not arbitrary-address capable
    ])
  }

  private buildAck(pgn: number, destination: number, controlByte: number): CanFrame {
    // Acknowledgement: control byte, group function, reserved, address, PGN.
    const data = new Uint8Array([
      controlByte,
      0xff,
      0xff,
      0xff,
      destination,
      pgn & 0xff,
      (pgn >> 8) & 0xff,
      (pgn >> 16) & 0xff,
    ])
    return this.frame(PGN.ACK, destination, data, 6)
  }

  /** Sequence counter used by the UI to detect state changes. */
  bumpSequence(): number {
    return ++this.sequence
  }
}

export { CYLINDERS, ENGINE_ADDRESS }
