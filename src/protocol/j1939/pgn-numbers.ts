/** PGNs the application decodes or transmits, by SAE acronym. */
export const PGN = {
  /** Request (PDU1). */
  REQUEST: 59904,
  /** Acknowledgement (PDU1). */
  ACK: 59392,
  /** Transport protocol - data transfer. */
  TP_DT: 60160,
  /** Transport protocol - connection management. */
  TP_CM: 60416,
  /** Extended transport protocol - data transfer. */
  ETP_DT: 51968,
  /** Extended transport protocol - connection management. */
  ETP_CM: 52224,
  /** Address claimed / cannot claim. */
  ADDRESS_CLAIM: 60928,
  /** Electronic engine controller 1. */
  EEC1: 61444,
  /** Electronic engine controller 2. */
  EEC2: 61443,
  /** Engine temperature 1. */
  ET1: 65262,
  /** Engine fluid level/pressure 1. */
  EFL_P1: 65263,
  /** Inlet/exhaust conditions 1. */
  IC1: 65270,
  /** Vehicle electrical power 1. */
  VEP1: 65271,
  /** Engine hours, revolutions. */
  HOURS: 65253,
  /** Fuel consumption (liquid). */
  LFC: 65257,
  /** Fuel economy (liquid). */
  LFE: 65266,
  /** Cruise control / vehicle speed 1. */
  CCVS1: 65265,
  /** Ambient conditions. */
  AMB: 65269,
  /** High resolution vehicle distance. */
  HRVD: 65217,
  /** Vehicle distance. */
  VD: 65248,
  /** Dash display. */
  DD: 65276,
  /** Engine fluid level/pressure 2 (rail pressure). */
  EFL_P2: 65243,
  /** Turbocharger information. */
  TCI1: 65245,
  /** Diesel particulate filter control 1. */
  DPFC1: 64892,
  /** Aftertreatment 1 SCR / DEF tank information. */
  AT1T1I: 65110,
  /** Diagnostic message 1 - active DTCs. */
  DM1: 65226,
  /** Diagnostic message 2 - previously active DTCs. */
  DM2: 65227,
  /** Diagnostic message 3 - clear previously active DTCs. */
  DM3: 65228,
  /** Diagnostic message 5 - readiness. */
  DM5: 65230,
  /** Diagnostic message 11 - clear active DTCs. */
  DM11: 65235,
  /** Component identification. */
  COMPONENT_ID: 65259,
  /** Software identification. */
  SOFTWARE_ID: 65242,
  /** Vehicle identification (VIN). */
  VIN: 65260,
} as const

/** Standard J1939 source addresses of interest to a service tool. */
export const ADDRESS = {
  ENGINE_1: 0x00,
  ENGINE_2: 0x01,
  TRANSMISSION: 0x03,
  BRAKES: 0x0b,
  INSTRUMENT_CLUSTER: 0x17,
  AFTERTREATMENT: 0x3d,
  BODY_CONTROLLER: 0x21,
  /** Off-board diagnostic service tool #1 - the address this tool claims. */
  SERVICE_TOOL: 0xf9,
} as const

export const ADDRESS_NAMES: Record<number, string> = {
  0x00: 'Engine #1',
  0x01: 'Engine #2',
  0x03: 'Transmission #1',
  0x05: 'Shift Console',
  0x0b: 'Brakes - System Controller',
  0x0f: 'Retarder - Engine',
  0x10: 'Retarder - Driveline',
  0x11: 'Cruise Control',
  0x17: 'Instrument Cluster #1',
  0x1c: 'Off-Vehicle Gateway',
  0x21: 'Body Controller',
  0x27: 'Suspension - System Controller',
  0x31: 'Cab Controller - Primary',
  0x3d: 'Exhaust Emission Controller',
  0x49: 'Diagnostic Systems Manager',
  0xf9: 'Off-Board Diagnostic Service Tool #1',
  0xfa: 'Off-Board Diagnostic Service Tool #2',
  0xfe: 'Null Address',
  0xff: 'Global (broadcast)',
}

export function addressName(address: number): string {
  return ADDRESS_NAMES[address] ?? `Address ${address} (0x${address.toString(16).padStart(2, '0').toUpperCase()})`
}
