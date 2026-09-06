/**
 * Helpers for reading J1939 parameter fields.
 *
 * J1939 reserves the top of each field's range: for a one-byte parameter
 * 0xFE is the error indicator and 0xFF means "not available"; two-byte
 * parameters use 0xFExx and 0xFFFF, and four-byte parameters 0xFFFFFFFF.
 * Those values must never be scaled and shown as data.
 */

export function u8(data: Uint8Array, offset: number): number | undefined {
  if (offset >= data.length) return undefined
  const raw = data[offset]
  if (raw >= 0xfe) return undefined
  return raw
}

export function u16(data: Uint8Array, offset: number): number | undefined {
  if (offset + 1 >= data.length) return undefined
  const raw = data[offset] | (data[offset + 1] << 8)
  if (raw >= 0xfe00) return undefined
  return raw
}

export function u32(data: Uint8Array, offset: number): number | undefined {
  if (offset + 3 >= data.length) return undefined
  const raw = (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0
  if (raw >= 0xfe000000) return undefined
  return raw
}

/** Apply a J1939 resolution and offset to a raw field. */
export function scale(raw: number | undefined, resolution: number, offset = 0): number | undefined {
  if (raw === undefined) return undefined
  return raw * resolution + offset
}

/** Read a two-bit status field (J1939 encodes switches as 2 bits). */
export function bits2(data: Uint8Array, offset: number, shift: number): number | undefined {
  if (offset >= data.length) return undefined
  const value = (data[offset] >> shift) & 0x03
  // 3 = "not available", 2 = "error"
  return value >= 2 ? undefined : value
}

/** Read an n-bit field starting at a bit offset within a byte. */
export function bitsN(data: Uint8Array, offset: number, shift: number, width: number): number | undefined {
  if (offset >= data.length) return undefined
  const mask = (1 << width) - 1
  return (data[offset] >> shift) & mask
}

/**
 * Decode an ASCII field list. Several identification PGNs pack variable
 * length text as '*'-delimited fields.
 */
export function asciiFields(data: Uint8Array, startOffset = 0): string[] {
  let text = ''
  for (let i = startOffset; i < data.length; i++) {
    const byte = data[i]
    if (byte === 0x00 || byte === 0xff) continue
    text += String.fromCharCode(byte)
  }
  return text
    .split('*')
    .map((field) => field.trim())
    .filter((field) => field.length > 0)
}

export function toHex(data: Uint8Array, separator = ' '): string {
  return Array.from(data, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(separator)
}

export function fromHex(text: string): Uint8Array {
  const cleaned = text.replace(/[^0-9a-fA-F]/g, '')
  const bytes = new Uint8Array(Math.floor(cleaned.length / 2))
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleaned.substr(i * 2, 2), 16)
  }
  return bytes
}
