import type { SignalKey } from './types'

/** Display metadata for a monitorable parameter. */
export interface SignalDefinition {
  key: SignalKey
  label: string
  /** Short name used on gauge faces and chart legends. */
  shortLabel: string
  unit: string
  min: number
  max: number
  decimals: number
  group: 'Engine' | 'Vehicle' | 'Fuel' | 'Air' | 'Aftertreatment' | 'Electrical' | 'Switches'
  /** Normal operating band, drawn as a green arc on gauges. */
  normal?: [number, number]
  warnAbove?: number
  warnBelow?: number
  /** Rendered as On/Off rather than a number. */
  boolean?: boolean
}

export const SIGNALS: SignalDefinition[] = [
  { key: 'engineSpeedRpm', label: 'Engine Speed', shortLabel: 'RPM', unit: 'rpm', min: 0, max: 2400, decimals: 0, group: 'Engine', normal: [600, 1900], warnAbove: 2100 },
  { key: 'engineLoadPct', label: 'Engine Percent Load At Current Speed', shortLabel: 'Load', unit: '%', min: 0, max: 100, decimals: 0, group: 'Engine' },
  { key: 'torquePct', label: 'Actual Engine Percent Torque', shortLabel: 'Torque', unit: '%', min: -125, max: 125, decimals: 0, group: 'Engine' },
  { key: 'throttlePct', label: 'Accelerator Pedal Position', shortLabel: 'Pedal', unit: '%', min: 0, max: 100, decimals: 1, group: 'Engine' },
  { key: 'coolantTempC', label: 'Engine Coolant Temperature', shortLabel: 'Coolant', unit: '°C', min: -40, max: 130, decimals: 0, group: 'Engine', normal: [70, 100], warnAbove: 104 },
  { key: 'oilTempC', label: 'Engine Oil Temperature', shortLabel: 'Oil Temp', unit: '°C', min: -40, max: 150, decimals: 1, group: 'Engine', normal: [80, 115], warnAbove: 121 },
  { key: 'oilPressureKpa', label: 'Engine Oil Pressure', shortLabel: 'Oil Press', unit: 'kPa', min: 0, max: 700, decimals: 0, group: 'Engine', normal: [200, 550], warnBelow: 105 },
  { key: 'crankcasePressureKpa', label: 'Crankcase Pressure', shortLabel: 'Crankcase', unit: 'kPa', min: -2, max: 10, decimals: 2, group: 'Engine', warnAbove: 5 },
  { key: 'engineHours', label: 'Total Engine Hours', shortLabel: 'Hours', unit: 'h', min: 0, max: 200000, decimals: 1, group: 'Engine' },
  { key: 'engineIdleHours', label: 'Total Engine Idle Hours', shortLabel: 'Idle Hrs', unit: 'h', min: 0, max: 200000, decimals: 1, group: 'Engine' },
  { key: 'vehicleSpeedKph', label: 'Wheel-Based Vehicle Speed', shortLabel: 'Speed', unit: 'km/h', min: 0, max: 160, decimals: 1, group: 'Vehicle' },
  { key: 'odometerKm', label: 'High Resolution Total Vehicle Distance', shortLabel: 'Odometer', unit: 'km', min: 0, max: 5000000, decimals: 1, group: 'Vehicle' },
  { key: 'tripDistanceKm', label: 'Trip Distance', shortLabel: 'Trip Dist', unit: 'km', min: 0, max: 100000, decimals: 1, group: 'Vehicle' },
  { key: 'fuelRateLph', label: 'Engine Fuel Rate', shortLabel: 'Fuel Rate', unit: 'L/h', min: 0, max: 200, decimals: 2, group: 'Fuel' },
  { key: 'instantFuelEconomyKmpl', label: 'Instantaneous Fuel Economy', shortLabel: 'Inst Econ', unit: 'km/L', min: 0, max: 40, decimals: 2, group: 'Fuel' },
  { key: 'avgFuelEconomyKmpl', label: 'Average Fuel Economy', shortLabel: 'Avg Econ', unit: 'km/L', min: 0, max: 40, decimals: 2, group: 'Fuel' },
  { key: 'totalFuelLitres', label: 'Engine Total Fuel Used', shortLabel: 'Total Fuel', unit: 'L', min: 0, max: 2000000, decimals: 0, group: 'Fuel' },
  { key: 'tripFuelLitres', label: 'Trip Fuel', shortLabel: 'Trip Fuel', unit: 'L', min: 0, max: 100000, decimals: 1, group: 'Fuel' },
  { key: 'fuelPressureKpa', label: 'Engine Fuel Delivery Pressure', shortLabel: 'Fuel Press', unit: 'kPa', min: 0, max: 1000, decimals: 0, group: 'Fuel', normal: [280, 700], warnBelow: 170 },
  { key: 'fuelRailPressureBar', label: 'Injector Metering Rail Pressure', shortLabel: 'Rail', unit: 'bar', min: 0, max: 2500, decimals: 0, group: 'Fuel' },
  { key: 'fuelTempC', label: 'Engine Fuel Temperature', shortLabel: 'Fuel Temp', unit: '°C', min: -40, max: 120, decimals: 0, group: 'Fuel' },
  { key: 'intakeManifoldPressureKpa', label: 'Intake Manifold #1 Pressure (Boost)', shortLabel: 'Boost', unit: 'kPa', min: 0, max: 400, decimals: 0, group: 'Air' },
  { key: 'intakeManifoldTempC', label: 'Intake Manifold #1 Temperature', shortLabel: 'IMT', unit: '°C', min: -40, max: 120, decimals: 0, group: 'Air', warnAbove: 90 },
  { key: 'airInletTempC', label: 'Engine Air Inlet Temperature', shortLabel: 'Air In', unit: '°C', min: -40, max: 120, decimals: 0, group: 'Air' },
  { key: 'barometricPressureKpa', label: 'Barometric Pressure', shortLabel: 'Baro', unit: 'kPa', min: 40, max: 120, decimals: 1, group: 'Air' },
  { key: 'turbochargerSpeedRpm', label: 'Turbocharger #1 Speed', shortLabel: 'Turbo', unit: 'rpm', min: 0, max: 160000, decimals: 0, group: 'Air' },
  { key: 'exhaustTempC', label: 'Exhaust Gas Temperature', shortLabel: 'EGT', unit: '°C', min: -273, max: 1000, decimals: 0, group: 'Aftertreatment', warnAbove: 650 },
  { key: 'dpfSootLoadPct', label: 'Diesel Particulate Filter Soot Load', shortLabel: 'Soot', unit: '%', min: 0, max: 130, decimals: 1, group: 'Aftertreatment', warnAbove: 80 },
  { key: 'dpfDiffPressureKpa', label: 'DPF Differential Pressure', shortLabel: 'DPF dP', unit: 'kPa', min: 0, max: 100, decimals: 2, group: 'Aftertreatment' },
  { key: 'defLevelPct', label: 'Catalyst Tank (DEF) Level', shortLabel: 'DEF', unit: '%', min: 0, max: 100, decimals: 1, group: 'Aftertreatment', warnBelow: 10 },
  { key: 'defTankTempC', label: 'Catalyst Tank Temperature', shortLabel: 'DEF Temp', unit: '°C', min: -40, max: 100, decimals: 0, group: 'Aftertreatment' },
  { key: 'batteryVoltage', label: 'Battery Potential (Switched)', shortLabel: 'Battery', unit: 'V', min: 0, max: 32, decimals: 2, group: 'Electrical', normal: [13.2, 14.4], warnBelow: 12.2 },
  { key: 'ambientTempC', label: 'Ambient Air Temperature', shortLabel: 'Ambient', unit: '°C', min: -40, max: 60, decimals: 1, group: 'Electrical' },
  { key: 'clutchSwitch', label: 'Clutch Switch', shortLabel: 'Clutch', unit: '', min: 0, max: 1, decimals: 0, group: 'Switches', boolean: true },
  { key: 'brakeSwitch', label: 'Brake Switch', shortLabel: 'Brake', unit: '', min: 0, max: 1, decimals: 0, group: 'Switches', boolean: true },
  { key: 'cruiseActive', label: 'Cruise Control Active', shortLabel: 'Cruise', unit: '', min: 0, max: 1, decimals: 0, group: 'Switches', boolean: true },
  { key: 'ptoActive', label: 'PTO Governor Active', shortLabel: 'PTO', unit: '', min: 0, max: 1, decimals: 0, group: 'Switches', boolean: true },
]

const byKey = new Map(SIGNALS.map((s) => [s.key, s]))

export function signal(key: SignalKey): SignalDefinition {
  const found = byKey.get(key)
  if (!found) throw new Error(`Unknown signal: ${key}`)
  return found
}

/** Format a raw value for display using the signal's unit and precision. */
export function formatSignal(key: SignalKey, value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return '- - -'
  const def = signal(key)
  if (def.boolean) return value >= 0.5 ? 'On' : 'Off'
  return `${value.toFixed(def.decimals)}${def.unit ? ` ${def.unit}` : ''}`
}

/** Parameters shown on the monitor screen before the user customises it. */
export const DEFAULT_MONITOR_KEYS: SignalKey[] = [
  'engineSpeedRpm',
  'vehicleSpeedKph',
  'coolantTempC',
  'oilPressureKpa',
  'intakeManifoldPressureKpa',
  'engineLoadPct',
  'fuelRateLph',
  'batteryVoltage',
]
