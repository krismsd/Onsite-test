/**
 * Core domain types.
 *
 * The application has two data sources that produce the same model:
 *   - a real datalink adapter (INLINE 7 over WebUSB / Web Serial), decoded
 *     from SAE J1939 and J1587 broadcast traffic, and
 *   - the built-in bench simulator, for working with no hardware attached.
 *
 * Terminology follows service-tool usage: a "fault code" is the manufacturer
 * code shown to the technician, which maps onto a J1939 SPN (suspect parameter
 * number) / FMI (failure mode identifier) pair reported by the ECM.
 */

export type LampColour = 'none' | 'protect' | 'amber' | 'red' | 'malfunction'

export type DataSource = 'j1939' | 'j1587' | 'simulator'

/** One decoded value, tagged with where and when it came from. */
export interface Sample {
  value: number
  /** performance.now() milliseconds when the value was decoded. */
  at: number
  source: DataSource
  /** Source address of the reporting node (J1939) or MID (J1587). */
  from: number
}

/** Keys of every parameter the application knows how to display. */
export type SignalKey =
  | 'engineSpeedRpm'
  | 'vehicleSpeedKph'
  | 'throttlePct'
  | 'engineLoadPct'
  | 'torquePct'
  | 'coolantTempC'
  | 'oilTempC'
  | 'oilPressureKpa'
  | 'fuelRateLph'
  | 'fuelPressureKpa'
  | 'fuelRailPressureBar'
  | 'intakeManifoldPressureKpa'
  | 'intakeManifoldTempC'
  | 'barometricPressureKpa'
  | 'exhaustTempC'
  | 'turbochargerSpeedRpm'
  | 'batteryVoltage'
  | 'engineHours'
  | 'odometerKm'
  | 'tripDistanceKm'
  | 'tripFuelLitres'
  | 'totalFuelLitres'
  | 'instantFuelEconomyKmpl'
  | 'avgFuelEconomyKmpl'
  | 'dpfSootLoadPct'
  | 'dpfDiffPressureKpa'
  | 'defLevelPct'
  | 'defTankTempC'
  | 'crankcasePressureKpa'
  | 'ambientTempC'
  | 'airInletTempC'
  | 'fuelTempC'
  | 'engineIdleHours'
  | 'clutchSwitch'
  | 'brakeSwitch'
  | 'cruiseActive'
  | 'ptoActive'

/** A live snapshot of every signal seen so far, newest value per key. */
export type SignalFrame = Partial<Record<SignalKey, Sample>>

/**
 * A diagnostic trouble code as reported by the ECM.
 *
 * On real hardware these come from J1939 DM1 (active) and DM2 (previously
 * active) messages; the simulator produces the same shape.
 */
export interface DiagnosticTroubleCode {
  spn: number
  fmi: number
  /** Occurrence count, 0-126 (127 means "not available"). */
  occurrenceCount: number
  /** SPN conversion method bit from the DTC packing. */
  conversionMethod: number
  /** Source address of the node that reported the DTC. */
  sourceAddress: number
  active: boolean
  /** First time this application observed the DTC (epoch ms). */
  firstSeen: number
  /** Most recent time this application observed the DTC (epoch ms). */
  lastSeen: number
}

/** Lamp status byte decoded from DM1/DM2. */
export interface LampStatus {
  malfunction: boolean
  red: boolean
  amber: boolean
  protect: boolean
}

/** Static description of a fault, resolved from the SPN/FMI tables. */
export interface FaultDescription {
  /** Manufacturer fault code, when a mapping is known. */
  faultCode: number | null
  spn: number
  fmi: number
  /** Plain-language description of the SPN (the circuit or parameter). */
  spnName: string
  /** Plain-language description of the FMI (the failure mode). */
  fmiName: string
  /** Combined description, as shown in the fault list. */
  description: string
  /** Effect on engine operation, when known. */
  effect?: string
  /** Ordered troubleshooting steps, when known. */
  troubleshooting?: string[]
  lamp: LampColour
}

/** Identification read from the ECM (J1939 component ID / software ID). */
export interface EcmIdentification {
  sourceAddress: number
  make?: string
  model?: string
  serialNumber?: string
  unitNumber?: string
  softwareIdentification?: string[]
  vin?: string
  /** J1939 NAME fields from the address claim. */
  name?: J1939Name
  /** True when the fields were produced by the simulator, not real hardware. */
  simulated: boolean
}

/** Decoded 64-bit J1939 NAME from an address-claim message. */
export interface J1939Name {
  identityNumber: number
  manufacturerCode: number
  ecuInstance: number
  functionInstance: number
  function: number
  vehicleSystem: number
  vehicleSystemInstance: number
  industryGroup: number
  arbitraryAddressCapable: boolean
}

/** A node discovered on the datalink. */
export interface BusNode {
  address: number
  name?: J1939Name
  label: string
  firstSeen: number
  lastSeen: number
  messageCount: number
}

/** A raw frame moving in either direction across the adapter. */
export interface RawFrame {
  id: number
  direction: 'rx' | 'tx'
  /** performance.now() milliseconds. */
  at: number
  /** 29-bit CAN identifier for J1939 frames. */
  canId?: number
  pgn?: number
  sourceAddress?: number
  destinationAddress?: number
  priority?: number
  data: Uint8Array
  protocol: 'j1939' | 'j1708' | 'adapter'
  /** Human-readable decode, when the frame is understood. */
  note?: string
}

export type AuditAction =
  | 'connect'
  | 'disconnect'
  | 'fault-clear'
  | 'parameter-change'
  | 'trip-reset'
  | 'test-run'
  | 'image-saved'
  | 'adapter-command'

export interface AuditEntry {
  id: string
  timestamp: number
  action: AuditAction
  summary: string
  detail?: string
  user: string
}
