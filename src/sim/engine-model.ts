/**
 * Physical model of a heavy-duty diesel engine.
 *
 * The numbers are representative of a 15-litre six-cylinder on-highway engine.
 * The model is deliberately simple - first-order lags around steady-state maps
 * - but it responds correctly to throttle, load and injected faults, which is
 * what the diagnostic screens need in order to be exercised properly.
 */

export interface EngineInputs {
  keyOn: boolean
  cranking: boolean
  /** Accelerator pedal, 0-100%. */
  throttlePct: number
  /** External load as a fraction of available torque, 0-1. */
  loadDemand: number
  ambientTempC: number
  /** Cylinders held out of fuelling by a cylinder cut-out test. */
  cutCylinders: number[]
}

export interface FaultInjection {
  oilPressureSensorHigh: boolean
  oilPressureSensorLow: boolean
  lowOilPressure: boolean
  coolantSensorHigh: boolean
  coolantSensorLow: boolean
  overheat: boolean
  boostSensorLow: boolean
  chargingSystemFailure: boolean
  lowCoolantLevel: boolean
  waterInFuel: boolean
  fuelPressureLow: boolean
  camSensorLoss: boolean
  dpfSootHigh: boolean
  defLow: boolean
  ecmInternalFailure: boolean
  sensorSupplyLow: boolean
}

export const NO_FAULTS: FaultInjection = {
  oilPressureSensorHigh: false,
  oilPressureSensorLow: false,
  lowOilPressure: false,
  coolantSensorHigh: false,
  coolantSensorLow: false,
  overheat: false,
  boostSensorLow: false,
  chargingSystemFailure: false,
  lowCoolantLevel: false,
  waterInFuel: false,
  fuelPressureLow: false,
  camSensorLoss: false,
  dpfSootHigh: false,
  defLow: false,
  ecmInternalFailure: false,
  sensorSupplyLow: false,
}

export interface EngineState {
  running: boolean
  engineSpeedRpm: number
  vehicleSpeedKph: number
  throttlePct: number
  engineLoadPct: number
  torquePct: number
  coolantTempC: number
  oilTempC: number
  oilPressureKpa: number
  fuelRateLph: number
  fuelPressureKpa: number
  fuelRailPressureBar: number
  boostKpa: number
  intakeManifoldTempC: number
  barometricPressureKpa: number
  exhaustTempC: number
  turbochargerSpeedRpm: number
  batteryVoltage: number
  engineHours: number
  idleHours: number
  odometerKm: number
  tripDistanceKm: number
  totalFuelLitres: number
  tripFuelLitres: number
  dpfSootLoadPct: number
  defLevelPct: number
  defTankTempC: number
  crankcasePressureKpa: number
  ambientTempC: number
  fuelTempC: number
  airInletTempC: number
  /** Relative contribution of each cylinder, used by the cut-out test. */
  cylinderContribution: number[]
}

const IDLE_RPM = 700
const RATED_RPM = 1800
const MAX_RPM = 2100
const CYLINDERS = 6

export const INITIAL_STATE: EngineState = {
  running: false,
  engineSpeedRpm: 0,
  vehicleSpeedKph: 0,
  throttlePct: 0,
  engineLoadPct: 0,
  torquePct: 0,
  coolantTempC: 20,
  oilTempC: 20,
  oilPressureKpa: 0,
  fuelRateLph: 0,
  fuelPressureKpa: 0,
  fuelRailPressureBar: 0,
  boostKpa: 0,
  intakeManifoldTempC: 20,
  barometricPressureKpa: 101.3,
  exhaustTempC: 20,
  turbochargerSpeedRpm: 0,
  batteryVoltage: 12.6,
  engineHours: 4287.3,
  idleHours: 1140.8,
  odometerKm: 512843,
  tripDistanceKm: 0,
  totalFuelLitres: 198432,
  tripFuelLitres: 0,
  dpfSootLoadPct: 22,
  defLevelPct: 68,
  defTankTempC: 18,
  crankcasePressureKpa: 0.4,
  ambientTempC: 20,
  fuelTempC: 20,
  airInletTempC: 20,
  cylinderContribution: Array.from({ length: CYLINDERS }, () => 100 / CYLINDERS),
}

function approach(current: number, target: number, rate: number, dt: number): number {
  // First-order lag: rate is the fraction of the gap closed per second.
  const alpha = 1 - Math.exp(-rate * dt)
  return current + (target - current) * alpha
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Advance the model by dt seconds. Returns a new state object. */
export function stepEngine(
  state: EngineState,
  inputs: EngineInputs,
  faults: FaultInjection,
  dt: number,
): EngineState {
  const next: EngineState = { ...state, cylinderContribution: [...state.cylinderContribution] }
  next.ambientTempC = inputs.ambientTempC
  next.throttlePct = clamp(inputs.throttlePct, 0, 100)

  // --- cylinder contribution ------------------------------------------------
  const active = CYLINDERS - inputs.cutCylinders.length
  const share = active > 0 ? 100 / active : 0
  for (let cylinder = 0; cylinder < CYLINDERS; cylinder++) {
    const cut = inputs.cutCylinders.includes(cylinder + 1)
    // A cut cylinder still turns over, it just does not fuel.
    next.cylinderContribution[cylinder] = approach(
      state.cylinderContribution[cylinder],
      cut ? 0 : share,
      4,
      dt,
    )
  }
  const powerFraction = active / CYLINDERS

  // --- speed ---------------------------------------------------------------
  if (!inputs.keyOn) {
    next.running = false
    next.engineSpeedRpm = approach(state.engineSpeedRpm, 0, 3, dt)
  } else if (inputs.cranking && !state.running) {
    next.engineSpeedRpm = approach(state.engineSpeedRpm, 180, 4, dt)
    // The engine catches once cranking speed is established, unless the
    // position sensors have failed.
    if (next.engineSpeedRpm > 150 && !faults.camSensorLoss && active > 0) {
      next.running = true
    }
  } else if (state.running) {
    const demandRpm = IDLE_RPM + (MAX_RPM - IDLE_RPM) * (next.throttlePct / 100)
    // Load pulls the engine down from the governed speed.
    const loadDroop = inputs.loadDemand * 250 * (1 - powerFraction * 0.4)
    const targetRpm = clamp(demandRpm - loadDroop, 0, MAX_RPM + 150)
    next.engineSpeedRpm = approach(state.engineSpeedRpm, targetRpm, next.throttlePct > 5 ? 2.5 : 1.5, dt)
    // Fuel is cut on overspeed, which pulls the engine straight back down.
    if (next.engineSpeedRpm > MAX_RPM) {
      next.engineSpeedRpm = approach(next.engineSpeedRpm, MAX_RPM - 50, 3, dt)
    }
    if (next.engineSpeedRpm < 300 || active === 0 || faults.camSensorLoss) {
      next.running = false
    }
  } else {
    next.engineSpeedRpm = approach(state.engineSpeedRpm, 0, 3, dt)
  }

  const rpm = next.engineSpeedRpm
  const speedFraction = clamp(rpm / RATED_RPM, 0, 1.2)

  // --- load and torque -----------------------------------------------------
  const targetLoad = next.running ? clamp(inputs.loadDemand * 100 * powerFraction + next.throttlePct * 0.15, 0, 100) : 0
  next.engineLoadPct = approach(state.engineLoadPct, targetLoad, 2, dt)
  next.torquePct = approach(state.torquePct, next.running ? clamp(next.engineLoadPct * 1.05, 0, 125) : 0, 2.5, dt)

  // --- vehicle speed -------------------------------------------------------
  // Treat the driveline as locked in top gear above idle when loaded.
  const targetSpeed = next.running && inputs.loadDemand > 0.05 ? clamp((rpm - IDLE_RPM) * 0.06, 0, 120) : 0
  next.vehicleSpeedKph = approach(state.vehicleSpeedKph, targetSpeed, 0.6, dt)

  // --- air path ------------------------------------------------------------
  const boostTarget = next.running ? clamp(speedFraction * (next.engineLoadPct / 100) * 220, 0, 240) : 0
  next.boostKpa = approach(state.boostKpa, faults.boostSensorLow ? 0 : boostTarget, 1.5, dt)
  next.turbochargerSpeedRpm = approach(
    state.turbochargerSpeedRpm,
    next.running ? clamp(20000 + next.boostKpa * 430, 0, 130000) : 0,
    1.2,
    dt,
  )
  next.intakeManifoldTempC = approach(
    state.intakeManifoldTempC,
    inputs.ambientTempC + next.boostKpa * 0.16 + (faults.overheat ? 25 : 0),
    0.4,
    dt,
  )
  next.airInletTempC = approach(state.airInletTempC, inputs.ambientTempC + 4, 0.2, dt)
  next.barometricPressureKpa = 101.3

  // --- thermal -------------------------------------------------------------
  const heatTarget = next.running
    ? 82 + next.engineLoadPct * 0.14 + (faults.overheat ? 35 : 0) + (faults.lowCoolantLevel ? 12 : 0)
    : inputs.ambientTempC
  next.coolantTempC = approach(state.coolantTempC, heatTarget, next.running ? 0.03 : 0.01, dt)
  next.oilTempC = approach(state.oilTempC, next.coolantTempC + (next.running ? 8 + next.engineLoadPct * 0.1 : 0), 0.02, dt)
  next.exhaustTempC = approach(
    state.exhaustTempC,
    next.running ? clamp(180 + next.engineLoadPct * 5.2 + speedFraction * 90, 0, 750) : inputs.ambientTempC,
    0.5,
    dt,
  )

  // --- lubrication ---------------------------------------------------------
  // Oil pressure rises with speed and falls as the oil thins with temperature.
  const viscosityFactor = clamp(1.25 - (next.oilTempC - 40) * 0.0045, 0.7, 1.3)
  const pressureTarget = next.running ? clamp(120 + rpm * 0.21 * viscosityFactor, 0, 620) : 0
  const mechanicalPressure = faults.lowOilPressure ? pressureTarget * 0.18 : pressureTarget
  next.oilPressureKpa = approach(state.oilPressureKpa, mechanicalPressure, 3, dt)
  next.crankcasePressureKpa = approach(state.crankcasePressureKpa, next.running ? 0.3 + next.engineLoadPct * 0.012 : 0, 1, dt)

  // --- fuel ----------------------------------------------------------------
  const fuelTarget = next.running
    ? clamp(2.5 + (next.engineLoadPct / 100) * speedFraction * 130 * powerFraction, 0, 160)
    : 0
  next.fuelRateLph = approach(state.fuelRateLph, fuelTarget, 2, dt)
  next.fuelPressureKpa = approach(
    state.fuelPressureKpa,
    next.running ? (faults.fuelPressureLow ? 120 : clamp(320 + rpm * 0.14, 0, 750)) : 0,
    2,
    dt,
  )
  next.fuelRailPressureBar = approach(
    state.fuelRailPressureBar,
    next.running ? clamp(400 + (next.engineLoadPct / 100) * 1400, 0, 1900) : 0,
    2,
    dt,
  )
  next.fuelTempC = approach(state.fuelTempC, inputs.ambientTempC + (next.running ? 18 + next.engineLoadPct * 0.15 : 0), 0.02, dt)

  // --- electrical ----------------------------------------------------------
  const chargingVoltage = faults.chargingSystemFailure ? 11.8 : 13.9
  const targetVoltage = inputs.cranking ? 9.8 : next.running ? chargingVoltage : inputs.keyOn ? 12.5 : 12.6
  next.batteryVoltage = approach(state.batteryVoltage, targetVoltage, 4, dt)

  // --- aftertreatment ------------------------------------------------------
  // Soot accumulates with fuelling and burns off at high exhaust temperature.
  const sootRate = next.running ? next.fuelRateLph * 0.00035 - Math.max(0, next.exhaustTempC - 480) * 0.0009 : 0
  next.dpfSootLoadPct = clamp(state.dpfSootLoadPct + sootRate * dt * 60 + (faults.dpfSootHigh ? dt * 2 : 0), 0, 120)
  next.defLevelPct = faults.defLow
    ? clamp(state.defLevelPct - dt * 2, 2, 100)
    : clamp(state.defLevelPct - (next.running ? next.fuelRateLph * 0.000004 * dt * 60 : 0), 0, 100)
  next.defTankTempC = approach(state.defTankTempC, inputs.ambientTempC + (next.running ? 8 : 0), 0.02, dt)

  // --- totals --------------------------------------------------------------
  if (next.running) {
    const hours = dt / 3600
    next.engineHours = state.engineHours + hours
    if (next.engineSpeedRpm < 900 && next.vehicleSpeedKph < 1) {
      next.idleHours = state.idleHours + hours
    }
    const litres = (next.fuelRateLph * dt) / 3600
    next.totalFuelLitres = state.totalFuelLitres + litres
    next.tripFuelLitres = state.tripFuelLitres + litres
  }
  const km = (next.vehicleSpeedKph * dt) / 3600
  next.odometerKm = state.odometerKm + km
  next.tripDistanceKm = state.tripDistanceKm + km

  return next
}

/**
 * Sensor readings as the ECM sees them, which is not always the physical
 * truth: a failed sensor circuit reports a rail value.
 */
export function sensorReadings(state: EngineState, faults: FaultInjection) {
  return {
    ...state,
    oilPressureKpa: faults.oilPressureSensorHigh
      ? 655
      : faults.oilPressureSensorLow
        ? 0
        : state.oilPressureKpa,
    coolantTempC: faults.coolantSensorHigh ? 128 : faults.coolantSensorLow ? -40 : state.coolantTempC,
    boostKpa: faults.boostSensorLow ? 0 : state.boostKpa,
  }
}

export { CYLINDERS, IDLE_RPM, RATED_RPM, MAX_RPM }
