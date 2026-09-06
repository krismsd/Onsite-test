/** Checksum algorithms used by adapter framing profiles. */

export type ChecksumType = 'none' | 'sum8' | 'sum8-twos-complement' | 'xor8' | 'crc8-sae-j1850' | 'crc16-ccitt' | 'crc16-modbus'

export function sum8(data: Uint8Array): number {
  let sum = 0
  for (const byte of data) sum = (sum + byte) & 0xff
  return sum
}

export function sum8TwosComplement(data: Uint8Array): number {
  return (0x100 - sum8(data)) & 0xff
}

export function xor8(data: Uint8Array): number {
  let value = 0
  for (const byte of data) value ^= byte
  return value
}

/** SAE J1850 CRC-8: polynomial 0x1D, initial value 0xFF, final XOR 0xFF. */
export function crc8SaeJ1850(data: Uint8Array): number {
  let crc = 0xff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x80 ? ((crc << 1) ^ 0x1d) & 0xff : (crc << 1) & 0xff
    }
  }
  return (crc ^ 0xff) & 0xff
}

/** CRC-16/CCITT-FALSE: polynomial 0x1021, initial value 0xFFFF. */
export function crc16Ccitt(data: Uint8Array): number {
  let crc = 0xffff
  for (const byte of data) {
    crc ^= byte << 8
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc
}

/** CRC-16/MODBUS: polynomial 0xA001 reflected, initial value 0xFFFF. */
export function crc16Modbus(data: Uint8Array): number {
  let crc = 0xffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x0001 ? (crc >> 1) ^ 0xa001 : crc >> 1
    }
  }
  return crc
}

export function checksumWidth(type: ChecksumType): number {
  switch (type) {
    case 'none': return 0
    case 'crc16-ccitt':
    case 'crc16-modbus': return 2
    default: return 1
  }
}

export function computeChecksum(type: ChecksumType, data: Uint8Array): number {
  switch (type) {
    case 'none': return 0
    case 'sum8': return sum8(data)
    case 'sum8-twos-complement': return sum8TwosComplement(data)
    case 'xor8': return xor8(data)
    case 'crc8-sae-j1850': return crc8SaeJ1850(data)
    case 'crc16-ccitt': return crc16Ccitt(data)
    case 'crc16-modbus': return crc16Modbus(data)
  }
}
