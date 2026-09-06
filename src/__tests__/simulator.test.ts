import { describe, it, expect } from 'vitest'
import { stepEngine, sensorReadings, INITIAL_STATE, NO_FAULTS } from '../sim/engine-model'
import type { EngineInputs, EngineState } from '../sim/engine-model'
import { EcmSimulator } from '../sim/ecm-simulator'
import { SimulatorTransport } from '../sim/simulator-transport'
import { DatalinkSession, DEFAULT_SESSION_OPTIONS } from '../app/session'
import { SlcanCodec } from '../protocol/slcan'
import { PGN } from '../protocol/j1939/pgn-numbers'
import { decodeCanId, encodeCanId } from '../protocol/j1939/id'

const IDLE: EngineInputs = {
  keyOn: true,
  cranking: false,
  throttlePct: 0,
  loadDemand: 0,
  ambientTempC: 20,
  cutCylinders: [],
}

/** Run the model forward for a number of simulated seconds. */
function run(state: EngineState, inputs: EngineInputs, seconds: number, faults = NO_FAULTS): EngineState {
  let current = state
  const dt = 0.05
  for (let t = 0; t < seconds; t += dt) {
    current = stepEngine(current, inputs, faults, dt)
  }
  return current
}

describe('engine model', () => {
  it('starts when cranked and settles at idle', () => {
    let state = { ...INITIAL_STATE }
    state = run(state, { ...IDLE, cranking: true }, 2)
    expect(state.running).toBe(true)
    state = run(state, IDLE, 10)
    expect(state.engineSpeedRpm).toBeGreaterThan(600)
    expect(state.engineSpeedRpm).toBeLessThan(800)
  })

  it('builds oil pressure once running and loses it when stopped', () => {
    let state = run({ ...INITIAL_STATE, running: true, engineSpeedRpm: 700 }, IDLE, 10)
    expect(state.oilPressureKpa).toBeGreaterThan(150)

    state = run(state, { ...IDLE, keyOn: false }, 15)
    expect(state.running).toBe(false)
    expect(state.oilPressureKpa).toBeLessThan(20)
  })

  it('warms to operating temperature under load', () => {
    const state = run(
      { ...INITIAL_STATE, running: true, engineSpeedRpm: 1400 },
      { ...IDLE, throttlePct: 60, loadDemand: 0.6 },
      600,
    )
    expect(state.coolantTempC).toBeGreaterThan(80)
    expect(state.coolantTempC).toBeLessThan(105)
    expect(state.boostKpa).toBeGreaterThan(20)
  })

  it('accumulates hours, distance and fuel', () => {
    const state = run(
      { ...INITIAL_STATE, running: true, engineSpeedRpm: 1500 },
      { ...IDLE, throttlePct: 70, loadDemand: 0.7 },
      3600,
    )
    expect(state.engineHours).toBeCloseTo(INITIAL_STATE.engineHours + 1, 1)
    expect(state.odometerKm).toBeGreaterThan(INITIAL_STATE.odometerKm)
    expect(state.totalFuelLitres).toBeGreaterThan(INITIAL_STATE.totalFuelLitres)
  })

  it('does not exceed the governed maximum speed', () => {
    const state = run(
      { ...INITIAL_STATE, running: true, engineSpeedRpm: 1800 },
      { ...IDLE, throttlePct: 100 },
      60,
    )
    expect(state.engineSpeedRpm).toBeLessThanOrEqual(2150)
  })

  it('will not start with the position sensors failed', () => {
    const state = run({ ...INITIAL_STATE }, { ...IDLE, cranking: true }, 5, { ...NO_FAULTS, camSensorLoss: true })
    expect(state.running).toBe(false)
  })

  it('loses power when cylinders are cut out', () => {
    const base = run({ ...INITIAL_STATE, running: true, engineSpeedRpm: 1400 }, { ...IDLE, throttlePct: 50, loadDemand: 0.5 }, 30)
    const cut = run(
      { ...INITIAL_STATE, running: true, engineSpeedRpm: 1400 },
      { ...IDLE, throttlePct: 50, loadDemand: 0.5, cutCylinders: [1, 2] },
      30,
    )
    expect(cut.engineSpeedRpm).toBeLessThan(base.engineSpeedRpm)
    expect(cut.cylinderContribution[0]).toBeLessThan(1)
  })

  it('reports a failed sensor circuit at its rail value, not the physical truth', () => {
    const state = run({ ...INITIAL_STATE, running: true, engineSpeedRpm: 1200 }, IDLE, 10)
    const readings = sensorReadings(state, { ...NO_FAULTS, oilPressureSensorHigh: true })
    expect(state.oilPressureKpa).toBeGreaterThan(100)
    expect(readings.oilPressureKpa).toBe(655)
  })
})

/** DM3 and DM11 are PDU2 PGNs, so they go out as broadcasts from the tool. */
function dmFrame(pgn: number): number {
  return encodeCanId({ priority: 6, pgn, sourceAddress: 0xf9, destinationAddress: 0xff })
}

describe('simulated ECM', () => {
  it('broadcasts EEC1 at its standard rate', () => {
    const ecm = new EcmSimulator()
    ecm.startEngine()
    let eec1 = 0
    for (let ms = 0; ms < 1000; ms += 20) {
      for (const frame of ecm.step(0.02, ms)) {
        if (decodeCanId(frame.canId).pgn === PGN.EEC1) eec1++
      }
    }
    // 50 Hz, allowing for the first tick.
    expect(eec1).toBeGreaterThan(45)
    expect(eec1).toBeLessThanOrEqual(51)
  })

  it('raises a fault when a sensor circuit is failed', () => {
    const ecm = new EcmSimulator()
    ecm.startEngine()
    ecm.faults = { ...ecm.faults, oilPressureSensorHigh: true }
    for (let ms = 0; ms < 500; ms += 20) ecm.step(0.02, ms)
    expect(ecm.activeFaults.some((f) => f.spn === 100 && f.fmi === 3)).toBe(true)
    expect(ecm.lamps.amber).toBe(true)
  })

  it('moves a fault to inactive when the condition clears', () => {
    const ecm = new EcmSimulator()
    ecm.startEngine()
    ecm.faults = { ...ecm.faults, oilPressureSensorHigh: true }
    for (let ms = 0; ms < 200; ms += 20) ecm.step(0.02, ms)
    ecm.faults = { ...ecm.faults, oilPressureSensorHigh: false }
    for (let ms = 200; ms < 400; ms += 20) ecm.step(0.02, ms)
    expect(ecm.activeFaults).toHaveLength(0)
    expect(ecm.inactiveFaults.some((f) => f.spn === 100 && f.fmi === 3)).toBe(true)
  })

  it('counts repeat occurrences of the same fault', () => {
    const ecm = new EcmSimulator()
    ecm.startEngine()
    for (let cycle = 0; cycle < 3; cycle++) {
      ecm.faults = { ...ecm.faults, waterInFuel: true }
      for (let i = 0; i < 5; i++) ecm.step(0.02, cycle * 400 + i * 20)
      ecm.faults = { ...ecm.faults, waterInFuel: false }
      for (let i = 5; i < 10; i++) ecm.step(0.02, cycle * 400 + i * 20)
    }
    const fault = ecm.inactiveFaults.find((f) => f.spn === 97)
    expect(fault?.occurrenceCount).toBe(3)
  })

  it('reports only the circuit fault when a sensor has failed, not a range fault too', () => {
    const ecm = new EcmSimulator()
    ecm.startEngine()
    // The failed circuit reads 128 C, which would otherwise look like an overheat.
    ecm.faults = { ...ecm.faults, coolantSensorHigh: true }
    for (let ms = 0; ms < 400; ms += 20) ecm.step(0.02, ms)
    expect(ecm.activeFaults.some((f) => f.spn === 110 && f.fmi === 3)).toBe(true)
    expect(ecm.activeFaults.some((f) => f.spn === 110 && (f.fmi === 0 || f.fmi === 16))).toBe(false)
  })

  it('still reports a genuine overheat when the sensor circuit is healthy', () => {
    const ecm = new EcmSimulator()
    ecm.startEngine()
    ecm.faults = { ...ecm.faults, overheat: true }
    ecm.inputs = { ...ecm.inputs, throttlePct: 80, loadDemand: 0.8 }
    // Run long enough for the coolant to actually climb.
    for (let ms = 0; ms < 400_000; ms += 200) ecm.step(0.2, ms)
    expect(ecm.activeFaults.some((f) => f.spn === 110 && (f.fmi === 0 || f.fmi === 16))).toBe(true)
  })

  it('uses a BAM when more than one fault is active', () => {
    const ecm = new EcmSimulator()
    ecm.startEngine()
    ecm.faults = { ...ecm.faults, oilPressureSensorHigh: true, coolantSensorHigh: true, waterInFuel: true }
    let sawBam = false
    for (let ms = 0; ms <= 1200; ms += 20) {
      for (const frame of ecm.step(0.02, ms)) {
        if (decodeCanId(frame.canId).pgn === PGN.TP_CM) sawBam = true
      }
    }
    expect(sawBam).toBe(true)
  })

  it('refuses to clear an active fault but clears an inactive one', () => {
    const ecm = new EcmSimulator()
    ecm.startEngine()
    ecm.faults = { ...ecm.faults, waterInFuel: true }
    for (let ms = 0; ms < 200; ms += 20) ecm.step(0.02, ms)
    expect(ecm.activeFaults).toHaveLength(1)

    // DM11 while the condition is present: the fault stays.
    ecm.handleIncoming({ canId: dmFrame(PGN.DM11), extended: true, data: new Uint8Array(8).fill(0xff) })
    expect(ecm.activeFaults).toHaveLength(1)

    // Condition clears, fault goes inactive, DM3 removes it.
    ecm.faults = { ...ecm.faults, waterInFuel: false }
    for (let ms = 200; ms < 400; ms += 20) ecm.step(0.02, ms)
    ecm.handleIncoming({ canId: dmFrame(PGN.DM3), extended: true, data: new Uint8Array(8).fill(0xff) })
    expect(ecm.inactiveFaults).toHaveLength(0)
  })
})

describe('end to end: simulator through the full decode path', () => {
  const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  it('decodes live engine data from simulated bus traffic', async () => {
    const transport = new SimulatorTransport(() => new SlcanCodec(), { tickMs: 10, timeScale: 20 })
    transport.ecm.startEngine()
    transport.ecm.inputs = { ...transport.ecm.inputs, throttlePct: 55, loadDemand: 0.5 }

    const session = new DatalinkSession(transport, new SlcanCodec(), DEFAULT_SESSION_OPTIONS)
    await session.start()
    await settle(400)

    const { signals, stats } = session.snapshot()
    expect(stats.framesReceived).toBeGreaterThan(50)
    expect(signals.engineSpeedRpm?.value).toBeGreaterThan(700)
    expect(signals.coolantTempC?.value).toBeGreaterThan(0)
    expect(signals.oilPressureKpa?.value).toBeGreaterThan(100)
    expect(signals.batteryVoltage?.value).toBeGreaterThan(13)
    expect(signals.engineSpeedRpm?.source).toBe('j1939')
    expect(signals.engineSpeedRpm?.from).toBe(0x00)

    await session.stop()
  })

  it('surfaces an injected fault as a decoded DTC', async () => {
    const transport = new SimulatorTransport(() => new SlcanCodec(), { tickMs: 10, timeScale: 20 })
    transport.ecm.startEngine()
    transport.ecm.faults = { ...transport.ecm.faults, coolantSensorHigh: true, waterInFuel: true }

    const session = new DatalinkSession(transport, new SlcanCodec(), DEFAULT_SESSION_OPTIONS)
    await session.start()
    await settle(500)

    const { dtcs, lamps } = session.snapshot()
    // Both faults arrive in a single DM1, which means a BAM was reassembled.
    expect(dtcs.some((d) => d.spn === 110 && d.fmi === 3 && d.active)).toBe(true)
    expect(dtcs.some((d) => d.spn === 97 && d.fmi === 15 && d.active)).toBe(true)
    expect(lamps.amber || lamps.protect).toBe(true)

    await session.stop()
  })

  it('reads ECM identification via a request and BAM response', async () => {
    const transport = new SimulatorTransport(() => new SlcanCodec(), { tickMs: 10, timeScale: 1 })
    const session = new DatalinkSession(transport, new SlcanCodec(), DEFAULT_SESSION_OPTIONS)
    await session.start()
    await session.requestIdentification()
    await settle(300)

    const identity = session.snapshot().identification.get(0x00)
    expect(identity?.serialNumber).toBe('79451235')
    expect(identity?.model).toContain('BENCH ECM')
    expect(identity?.vin).toBe('SIMULATOR00000001')
    expect(identity?.softwareIdentification?.[0]).toBe('SIM-CAL-4419372')

    await session.stop()
  })

  it('discovers the engine controller on the bus', async () => {
    const transport = new SimulatorTransport(() => new SlcanCodec(), { tickMs: 10 })
    const session = new DatalinkSession(transport, new SlcanCodec(), DEFAULT_SESSION_OPTIONS)
    await session.start()
    await settle(200)

    const nodes = session.snapshot().nodes
    expect(nodes.some((node) => node.address === 0x00)).toBe(true)
    expect(nodes[0].label).toContain('Engine')

    await session.stop()
  })

  it('refuses to transmit in listen-only mode', async () => {
    const transport = new SimulatorTransport(() => new SlcanCodec(), { tickMs: 20 })
    const session = new DatalinkSession(transport, new SlcanCodec(), {
      ...DEFAULT_SESSION_OPTIONS,
      listenOnly: true,
    })
    await session.start()
    await expect(session.requestActiveFaults()).rejects.toThrow(/listen-only/i)
    await session.stop()
  })

  it('captures raw bytes for the framing analyser', async () => {
    const transport = new SimulatorTransport(() => new SlcanCodec(), { tickMs: 10 })
    const session = new DatalinkSession(transport, new SlcanCodec(), DEFAULT_SESSION_OPTIONS)
    await session.start()
    session.startCapture()
    await settle(200)
    const capture = session.stopCapture()
    expect(capture.length).toBeGreaterThan(100)
    await session.stop()
  })
})

describe('raw endpoint access', () => {
  const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  it('records inbound and outbound bytes unframed', async () => {
    const transport = new SimulatorTransport(() => new SlcanCodec(), { tickMs: 10 })
    const session = new DatalinkSession(transport, new SlcanCodec(), DEFAULT_SESSION_OPTIONS)
    await session.start()
    await settle(150)

    await session.writeRaw(new Uint8Array([0x56, 0x0d]))
    const { rawLog } = session.snapshot()

    const sent = rawLog.filter((chunk) => chunk.direction === 'tx')
    const received = rawLog.filter((chunk) => chunk.direction === 'rx')
    expect(received.length).toBeGreaterThan(0)
    expect(sent.some((chunk) => Array.from(chunk.bytes).join() === '86,13')).toBe(true)

    await session.stop()
  })

  it('refuses raw writes in listen-only mode', async () => {
    const transport = new SimulatorTransport(() => new SlcanCodec(), { tickMs: 20 })
    const session = new DatalinkSession(transport, new SlcanCodec(), {
      ...DEFAULT_SESSION_OPTIONS,
      listenOnly: true,
    })
    await session.start()
    await expect(session.writeRaw(new Uint8Array([0x00]))).rejects.toThrow(/listen-only/i)
    await session.stop()
  })

  it('rejects an empty write rather than sending nothing', async () => {
    const transport = new SimulatorTransport(() => new SlcanCodec(), { tickMs: 20 })
    const session = new DatalinkSession(transport, new SlcanCodec(), DEFAULT_SESSION_OPTIONS)
    await session.start()
    await expect(session.writeRaw(new Uint8Array(0))).rejects.toThrow(/nothing to send/i)
    await session.stop()
  })

  it('bounds the raw log so a long session cannot grow without limit', async () => {
    const transport = new SimulatorTransport(() => new SlcanCodec(), { tickMs: 5, timeScale: 5 })
    const session = new DatalinkSession(transport, new SlcanCodec(), DEFAULT_SESSION_OPTIONS)
    await session.start()
    await settle(600)
    expect(session.snapshot().rawLog.length).toBeLessThanOrEqual(500)
    await session.stop()
  })
})
