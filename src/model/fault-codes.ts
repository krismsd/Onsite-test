import type { FaultDescription, LampColour } from './types'
import { spnName, fmiName, fmiShort } from '../protocol/j1939/spn-table'

/**
 * SPN/FMI to manufacturer fault code mapping.
 *
 * IMPORTANT: this table is NOT an official Cummins table. Cummins' own
 * SPN/FMI-to-fault-code mapping lives inside the service tool and the ECM
 * calibration and is not published. The entries here are the widely
 * documented ones, and each carries a confidence marker:
 *
 *   'high'   - consistently documented across published service literature
 *   'medium' - commonly reported but engine-family dependent
 *
 * An SPN/FMI pair with no entry is displayed by SPN/FMI alone, which is what
 * the ECM actually broadcast. Add entries for your engine family by editing
 * this table or importing a mapping file from the Fault Codes screen.
 */

export interface FaultCodeMapping {
  spn: number
  fmi: number
  faultCode: number
  description: string
  lamp: LampColour
  confidence: 'high' | 'medium'
  effect?: string
  troubleshooting?: string[]
}

export const FAULT_CODE_MAP: FaultCodeMapping[] = [
  {
    spn: 100, fmi: 1, faultCode: 415, lamp: 'red', confidence: 'high',
    description: 'Engine Oil Pressure Low - Data Valid But Below Normal Operational Range - Most Severe Level',
    effect: 'Engine protection derate and, if enabled, engine shutdown.',
    troubleshooting: [
      'Check the engine oil level and top up to the correct level if low.',
      'Verify actual oil pressure with a mechanical gauge at the sensor port.',
      'If mechanical pressure is correct, check the oil pressure sensor and its harness.',
      'Inspect the oil pump, pickup screen and pressure regulator for restriction or wear.',
    ],
  },
  {
    spn: 100, fmi: 18, faultCode: 143, lamp: 'amber', confidence: 'high',
    description: 'Engine Oil Pressure Low - Data Valid But Below Normal Operational Range - Moderately Severe Level',
    effect: 'Engine protection derate.',
    troubleshooting: [
      'Check the engine oil level.',
      'Compare the ECM reading against a mechanical gauge.',
      'Inspect the oil pressure sensor circuit for damage or corrosion.',
    ],
  },
  {
    spn: 100, fmi: 3, faultCode: 135, lamp: 'amber', confidence: 'high',
    description: 'Engine Oil Pressure Sensor Circuit - Voltage Above Normal or Shorted To High Source',
    effect: 'Oil pressure protection is disabled; a default value is substituted.',
    troubleshooting: [
      'Disconnect the sensor and check for a short to a voltage source in the signal wire.',
      'Inspect the connector pins for corrosion, spread terminals or moisture.',
      'Check the sensor return circuit for an open.',
    ],
  },
  {
    spn: 100, fmi: 4, faultCode: 141, lamp: 'amber', confidence: 'high',
    description: 'Engine Oil Pressure Sensor Circuit - Voltage Below Normal or Shorted To Low Source',
    effect: 'Oil pressure protection is disabled; a default value is substituted.',
    troubleshooting: [
      'Disconnect the sensor and check whether the fault becomes an open-circuit fault.',
      'Check the signal wire for a short to ground.',
      'Verify the +5V supply to the sensor.',
    ],
  },
  {
    spn: 110, fmi: 0, faultCode: 151, lamp: 'red', confidence: 'high',
    description: 'Engine Coolant Temperature High - Data Valid But Above Normal Operational Range - Most Severe Level',
    effect: 'Engine protection derate and, if enabled, engine shutdown.',
    troubleshooting: [
      'Check the coolant level and inspect for leaks.',
      'Inspect the radiator and charge air cooler for external blockage.',
      'Check fan operation and the fan clutch.',
      'Test the thermostat for correct opening temperature.',
    ],
  },
  {
    spn: 110, fmi: 16, faultCode: 146, lamp: 'amber', confidence: 'high',
    description: 'Engine Coolant Temperature High - Data Valid But Above Normal Operational Range - Moderately Severe Level',
    effect: 'Engine protection derate.',
    troubleshooting: [
      'Check the coolant level.',
      'Inspect the cooling system for restriction or airflow blockage.',
      'Verify the coolant temperature sensor reading against an infrared thermometer.',
    ],
  },
  {
    spn: 110, fmi: 3, faultCode: 144, lamp: 'amber', confidence: 'high',
    description: 'Engine Coolant Temperature Sensor Circuit - Voltage Above Normal or Shorted To High Source',
    troubleshooting: [
      'Check the sensor signal wire for an open circuit or a short to a voltage source.',
      'Inspect the connector for corrosion.',
      'Substitute a known-good sensor.',
    ],
  },
  {
    spn: 110, fmi: 4, faultCode: 145, lamp: 'amber', confidence: 'high',
    description: 'Engine Coolant Temperature Sensor Circuit - Voltage Below Normal or Shorted To Low Source',
    troubleshooting: [
      'Check the sensor signal wire for a short to ground.',
      'Disconnect the sensor: if the fault changes to voltage-above-normal, the sensor is failed.',
    ],
  },
  {
    spn: 190, fmi: 0, faultCode: 234, lamp: 'red', confidence: 'high',
    description: 'Engine Speed High - Data Valid But Above Normal Operational Range - Most Severe Level',
    effect: 'Fuelling is cut until engine speed returns to the operating range.',
    troubleshooting: [
      'Review the trip and fault snapshot data for a downhill overspeed event.',
      'Check for driver behaviour: descending in too high a gear without engine brake.',
      'Verify the engine speed sensor signal quality.',
    ],
  },
  {
    spn: 190, fmi: 2, faultCode: 115, lamp: 'red', confidence: 'high',
    description: 'Engine Magnetic Speed/Position Lost Both of Two Signals - Data Erratic, Intermittent or Incorrect',
    effect: 'The engine may stop or fail to start.',
    troubleshooting: [
      'Inspect the crankshaft and camshaft speed sensors and their connectors.',
      'Check the sensor air gap and the tone wheel for damage or debris.',
      'Check the sensor harness for chafing and for correct shield grounding.',
    ],
  },
  {
    spn: 102, fmi: 3, faultCode: 122, lamp: 'amber', confidence: 'high',
    description: 'Intake Manifold #1 Pressure Sensor Circuit - Voltage Above Normal or Shorted To High Source',
    troubleshooting: [
      'Check the boost pressure sensor signal wire for a short to a voltage source.',
      'Verify the sensor supply and return circuits.',
    ],
  },
  {
    spn: 102, fmi: 4, faultCode: 123, lamp: 'amber', confidence: 'high',
    description: 'Intake Manifold #1 Pressure Sensor Circuit - Voltage Below Normal or Shorted To Low Source',
    troubleshooting: [
      'Check the boost pressure sensor signal wire for a short to ground.',
      'Verify the +5V sensor supply is present at the connector.',
    ],
  },
  {
    spn: 105, fmi: 0, faultCode: 155, lamp: 'red', confidence: 'medium',
    description: 'Intake Manifold #1 Temperature High - Data Valid But Above Normal Operational Range - Most Severe Level',
    effect: 'Engine protection derate.',
    troubleshooting: [
      'Inspect the charge air cooler for blockage or leakage.',
      'Check the fan and cooling airflow path.',
    ],
  },
  {
    spn: 105, fmi: 3, faultCode: 153, lamp: 'amber', confidence: 'high',
    description: 'Intake Manifold #1 Temperature Sensor Circuit - Voltage Above Normal or Shorted To High Source',
    troubleshooting: ['Check the sensor signal circuit for an open or a short to a voltage source.'],
  },
  {
    spn: 105, fmi: 4, faultCode: 154, lamp: 'amber', confidence: 'high',
    description: 'Intake Manifold #1 Temperature Sensor Circuit - Voltage Below Normal or Shorted To Low Source',
    troubleshooting: ['Check the sensor signal circuit for a short to ground.'],
  },
  {
    spn: 94, fmi: 1, faultCode: 559, lamp: 'amber', confidence: 'high',
    description: 'Engine Fuel Delivery Pressure Low - Data Valid But Below Normal Operational Range - Moderately Severe Level',
    effect: 'Possible low power and rough running.',
    troubleshooting: [
      'Check the fuel filters for restriction and replace if due.',
      'Inspect the suction side of the fuel system for air leaks.',
      'Verify fuel delivery pressure with a mechanical gauge.',
    ],
  },
  {
    spn: 108, fmi: 3, faultCode: 221, lamp: 'amber', confidence: 'high',
    description: 'Barometric Pressure Sensor Circuit - Voltage Above Normal or Shorted To High Source',
    troubleshooting: ['Check the barometric pressure sensor circuit for an open or short to high.'],
  },
  {
    spn: 108, fmi: 4, faultCode: 222, lamp: 'amber', confidence: 'high',
    description: 'Barometric Pressure Sensor Circuit - Voltage Below Normal or Shorted To Low Source',
    troubleshooting: ['Check the barometric pressure sensor circuit for a short to ground.'],
  },
  {
    spn: 111, fmi: 1, faultCode: 235, lamp: 'red', confidence: 'high',
    description: 'Engine Coolant Level Low - Data Valid But Below Normal Operational Range - Most Severe Level',
    effect: 'Engine protection derate and, if enabled, engine shutdown.',
    troubleshooting: [
      'Check the coolant level and pressure-test the cooling system for leaks.',
      'Inspect the coolant level sensor and its harness.',
    ],
  },
  {
    spn: 111, fmi: 17, faultCode: 197, lamp: 'amber', confidence: 'high',
    description: 'Engine Coolant Level Low - Data Valid But Below Normal Operational Range - Least Severe Level',
    troubleshooting: ['Check the coolant level and top up; inspect for external leaks.'],
  },
  {
    spn: 168, fmi: 1, faultCode: 441, lamp: 'amber', confidence: 'high',
    description: 'Battery #1 Voltage Low - Data Valid But Below Normal Operational Range - Moderately Severe Level',
    effect: 'Possible hard starting and erratic electronic operation.',
    troubleshooting: [
      'Load-test the batteries and check the state of charge.',
      'Inspect the battery cables and grounds for corrosion and voltage drop.',
      'Check alternator output.',
    ],
  },
  {
    spn: 168, fmi: 0, faultCode: 442, lamp: 'amber', confidence: 'high',
    description: 'Battery #1 Voltage High - Data Valid But Above Normal Operational Range - Moderately Severe Level',
    effect: 'Risk of damage to electronic components.',
    troubleshooting: [
      'Measure charging voltage at the batteries with the engine running.',
      'Check the alternator regulator.',
    ],
  },
  {
    spn: 84, fmi: 2, faultCode: 241, lamp: 'amber', confidence: 'high',
    description: 'Wheel-Based Vehicle Speed - Data Erratic, Intermittent or Incorrect',
    effect: 'Cruise control and road speed governing are disabled.',
    troubleshooting: [
      'Verify the number of teeth on the tone ring and the configured axle ratio and tyre size.',
      'Inspect the vehicle speed sensor and harness for damage or shield failure.',
    ],
  },
  {
    spn: 97, fmi: 15, faultCode: 418, lamp: 'protect', confidence: 'high',
    description: 'Water In Fuel Indicator High - Data Valid But Above Normal Operating Range - Least Severe Level',
    effect: 'Risk of fuel system damage if not drained.',
    troubleshooting: [
      'Drain the fuel filter/water separator.',
      'If the fault returns immediately, inspect the water-in-fuel sensor circuit.',
    ],
  },
  {
    spn: 174, fmi: 0, faultCode: 261, lamp: 'amber', confidence: 'high',
    description: 'Engine Fuel Temperature High - Data Valid But Above Normal Operational Range - Moderately Severe Level',
    effect: 'Fuel-temperature-based power derate.',
    troubleshooting: ['Check the fuel level and fuel cooler; verify the return line is not restricted.'],
  },
  {
    spn: 175, fmi: 0, faultCode: 214, lamp: 'red', confidence: 'high',
    description: 'Engine Oil Temperature High - Data Valid But Above Normal Operational Range - Most Severe Level',
    effect: 'Engine protection derate.',
    troubleshooting: ['Check the oil level, oil cooler and cooling system operation.'],
  },
  {
    spn: 620, fmi: 3, faultCode: 386, lamp: 'amber', confidence: 'high',
    description: 'Sensor Supply Voltage 1 (+5V DC) - Voltage Above Normal or Shorted To High Source',
    effect: 'Sensors on this supply report default values.',
    troubleshooting: [
      'Disconnect sensors on the +5V supply one at a time to find a shorted sensor.',
      'Check the supply circuit for a short to a higher voltage source.',
    ],
  },
  {
    spn: 620, fmi: 4, faultCode: 352, lamp: 'amber', confidence: 'high',
    description: 'Sensor Supply Voltage 1 (+5V DC) - Voltage Below Normal or Shorted To Low Source',
    effect: 'Sensors on this supply report default values.',
    troubleshooting: [
      'Disconnect sensors on the +5V supply one at a time to find a shorted sensor.',
      'Check the supply circuit for a short to ground.',
    ],
  },
  {
    spn: 629, fmi: 12, faultCode: 111, lamp: 'red', confidence: 'high',
    description: 'Engine Control Module Critical Internal Failure - Bad Intelligent Device or Component',
    effect: 'The engine may run derated or fail to start.',
    troubleshooting: [
      'Cycle the keyswitch and re-read the fault.',
      'Verify ECM power and ground circuits and battery voltage.',
      'If the fault is persistent the ECM requires replacement.',
    ],
  },
  {
    spn: 639, fmi: 9, faultCode: 285, lamp: 'amber', confidence: 'high',
    description: 'SAE J1939 Multiplexing PGN Timeout Error - Abnormal Update Rate',
    effect: 'Multiplexed devices may not operate.',
    troubleshooting: [
      'Check the datalink for termination resistance (60 ohms across CAN high and low).',
      'Identify which device has stopped broadcasting using the datalink monitor.',
    ],
  },
  {
    spn: 639, fmi: 2, faultCode: 286, lamp: 'amber', confidence: 'medium',
    description: 'SAE J1939 Multiplexing Configuration Error - Data Erratic, Intermittent or Incorrect',
    troubleshooting: ['Verify the multiplexing configuration parameters match the installed devices.'],
  },
  {
    spn: 1761, fmi: 1, faultCode: 1673, lamp: 'amber', confidence: 'medium',
    description: 'Aftertreatment 1 Diesel Exhaust Fluid Tank Level Low - Data Valid But Below Normal Operational Range',
    effect: 'Escalating derate and speed limit if the tank is not refilled.',
    troubleshooting: [
      'Refill the diesel exhaust fluid tank.',
      'If the tank is full, check the DEF level sensor and harness.',
    ],
  },
  {
    spn: 3251, fmi: 0, faultCode: 1922, lamp: 'amber', confidence: 'medium',
    description: 'Aftertreatment 1 Diesel Particulate Filter Differential Pressure High',
    effect: 'Regeneration is requested; a derate follows if soot load continues to rise.',
    troubleshooting: [
      'Perform a stationary regeneration if conditions allow.',
      'Inspect the differential pressure lines for blockage or incorrect routing.',
      'Check for excessive soot loading caused by an upstream engine fault.',
    ],
  },
  {
    spn: 3719, fmi: 16, faultCode: 3714, lamp: 'amber', confidence: 'medium',
    description: 'Aftertreatment 1 Diesel Particulate Filter Soot Load - Moderately High',
    effect: 'A regeneration is required; a derate follows if soot load continues to rise.',
    troubleshooting: [
      'Perform a stationary regeneration.',
      'Investigate any active engine fault that increases soot production.',
    ],
  },
]

const mapByKey = new Map(FAULT_CODE_MAP.map((entry) => [`${entry.spn}:${entry.fmi}`, entry]))

/** User-supplied mapping entries, imported at runtime, take precedence. */
const userMap = new Map<string, FaultCodeMapping>()

export function importFaultCodeMappings(entries: FaultCodeMapping[]): number {
  let added = 0
  for (const entry of entries) {
    if (typeof entry?.spn !== 'number' || typeof entry?.fmi !== 'number') continue
    userMap.set(`${entry.spn}:${entry.fmi}`, entry)
    added++
  }
  return added
}

export function clearImportedMappings(): void {
  userMap.clear()
}

export function importedMappingCount(): number {
  return userMap.size
}

/**
 * Resolve an SPN/FMI pair into a displayable fault description, falling back
 * to the standard SPN and FMI names when no manufacturer mapping is known.
 */
export function describeFault(spn: number, fmi: number, lampHint?: LampColour): FaultDescription {
  const mapping = userMap.get(`${spn}:${fmi}`) ?? mapByKey.get(`${spn}:${fmi}`)
  if (mapping) {
    return {
      faultCode: mapping.faultCode,
      spn,
      fmi,
      spnName: spnName(spn),
      fmiName: fmiName(fmi),
      description: mapping.description,
      effect: mapping.effect,
      troubleshooting: mapping.troubleshooting,
      lamp: lampHint ?? mapping.lamp,
    }
  }
  return {
    faultCode: null,
    spn,
    fmi,
    spnName: spnName(spn),
    fmiName: fmiName(fmi),
    description: `${spnName(spn)} - ${fmiShort(fmi)}`,
    lamp: lampHint ?? 'amber',
  }
}

/** True when the mapping for this pair is engine-family dependent. */
export function isLowConfidenceMapping(spn: number, fmi: number): boolean {
  const mapping = userMap.get(`${spn}:${fmi}`) ?? mapByKey.get(`${spn}:${fmi}`)
  return mapping?.confidence === 'medium'
}
