import { computeChecksum, checksumWidth } from './checksums'
import type { ChecksumType } from './checksums'

/**
 * Adapter framing.
 *
 * A datalink adapter wraps each CAN/J1708 message in its own USB frame. The
 * INLINE 7's wrapper is proprietary and undocumented, so rather than hard-code
 * a guess, the framing is described by a profile that can be edited at runtime
 * and validated against a live capture (see analyser.ts).
 *
 * Profiles for open adapter protocols (slcan, gs_usb) are exact and work today.
 */

export interface CanFrame {
  /** 11-bit or 29-bit identifier, without flag bits. */
  canId: number
  extended: boolean
  data: Uint8Array
  /** Adapter channel/port number, where the adapter reports one. */
  channel?: number
  /** Remote transmission request frame. */
  rtr?: boolean
}

export type AdapterMessage =
  | { kind: 'can'; frame: CanFrame }
  | { kind: 'j1708'; mid: number; data: Uint8Array }
  | { kind: 'status'; text: string; bytes: Uint8Array }
  | { kind: 'unknown'; bytes: Uint8Array }

/** Where the length field's count starts and stops. */
export type LengthBasis =
  /** Counts only the payload bytes that follow the header. */
  | 'payload'
  /** Counts every byte in the frame including start-of-frame and checksum. */
  | 'whole-frame'
  /** Counts every byte after the length field itself, checksum included. */
  | 'after-length'

export interface BinaryFramingProfile {
  id: string
  name: string
  description: string
  /** Byte sequence that marks the start of a frame; empty for stream framing. */
  startOfFrame: number[]
  lengthField: {
    /** Offset from the first byte of the frame (after start-of-frame bytes). */
    offset: number
    size: 1 | 2
    endian: 'big' | 'little'
    basis: LengthBasis
  } | null
  /** Fixed frame length, used when there is no length field. */
  fixedLength: number | null
  checksum: {
    type: ChecksumType
    /** Bytes covered by the checksum, relative to the start of the frame. */
    from: number
    /** Endianness for two-byte checksums. */
    endian: 'big' | 'little'
  }
  /** Byte-stuffing scheme, if the adapter escapes its framing bytes. */
  escape: {
    escapeByte: number
    /** Bytes that must be escaped when they appear in the payload. */
    escapedBytes: number[]
    /** Value XORed with an escaped byte. */
    xor: number
  } | null
  /** Where the CAN identifier and payload sit inside the frame body. */
  layout: {
    /** Offset of the 4-byte CAN identifier, from the start of the frame. */
    canIdOffset: number
    canIdEndian: 'big' | 'little'
    /** Mask applied to the identifier to strip adapter flag bits. */
    canIdMask: number
    /** Offset of the first payload byte. */
    dataOffset: number
    /** Offset of the payload length (DLC) byte; null when derived from the frame length. */
    dlcOffset: number | null
    /** Offset of the channel byte, when present. */
    channelOffset: number | null
  }
}

const MAX_BUFFER_BYTES = 64 * 1024

/** A stateful decoder: feed it USB chunks, get whole messages back. */
export interface AdapterCodec {
  readonly id: string
  readonly name: string
  readonly description: string
  /** Feed inbound bytes; returns any complete messages. */
  decode(chunk: Uint8Array): AdapterMessage[]
  /** Build the adapter frame that transmits a CAN message. */
  encode(frame: CanFrame): Uint8Array
  /** Commands sent after opening the transport (bus on, speed, filters). */
  openCommands(options: AdapterOpenOptions): Uint8Array[]
  /** Commands sent before closing the transport (bus off). */
  closeCommands(): Uint8Array[]
  reset(): void
  /** Bytes buffered but not yet forming a complete frame - shown in diagnostics. */
  readonly pendingBytes: number
}

export interface AdapterOpenOptions {
  /** CAN bitrate in bits per second (J1939 is 250k; some engines use 500k). */
  bitrate: number
  /** Listen without transmitting; leaves the tool invisible on the bus. */
  listenOnly: boolean
}

/** Generic decoder driven by a BinaryFramingProfile. */
export class BinaryFramingCodec implements AdapterCodec {
  private buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0)
  constructor(readonly profile: BinaryFramingProfile) {}

  get id(): string { return this.profile.id }
  get name(): string { return this.profile.name }
  get description(): string { return this.profile.description }
  get pendingBytes(): number { return this.buffer.length }

  reset(): void {
    this.buffer = new Uint8Array(0)
  }

  openCommands(): Uint8Array[] {
    return []
  }

  closeCommands(): Uint8Array[] {
    return []
  }

  decode(chunk: Uint8Array): AdapterMessage[] {
    this.buffer = concat(this.buffer, chunk)
    if (this.buffer.length > MAX_BUFFER_BYTES) {
      // Never let an un-syncable stream grow without bound.
      this.buffer = this.buffer.subarray(this.buffer.length - MAX_BUFFER_BYTES)
    }
    const messages: AdapterMessage[] = []
    for (;;) {
      const result = this.takeFrame()
      if (!result) break
      messages.push(result)
    }
    return messages
  }

  private takeFrame(): AdapterMessage | null {
    const { startOfFrame } = this.profile
    if (startOfFrame.length > 0) {
      const start = indexOfSequence(this.buffer, startOfFrame)
      if (start < 0) {
        // Keep only a possible partial start-of-frame at the tail.
        const keep = Math.max(0, this.buffer.length - startOfFrame.length + 1)
        this.buffer = this.buffer.subarray(keep)
        return null
      }
      if (start > 0) this.buffer = this.buffer.subarray(start)
    }

    const framed = this.readFrame()
    if (!framed) return null

    if (!this.checksumValid(framed.bytes)) {
      // Desynchronised: drop one byte and try to resynchronise.
      const rejected = this.buffer.subarray(0, framed.consumed).slice()
      this.buffer = this.buffer.subarray(1)
      return { kind: 'unknown', bytes: rejected }
    }

    this.buffer = this.buffer.subarray(framed.consumed)
    return this.parseFrame(framed.bytes) ?? { kind: 'unknown', bytes: framed.bytes }
  }

  /**
   * Read one frame from the head of the buffer, undoing byte stuffing as it
   * goes.
   *
   * Un-escaping has to happen while the frame is being measured, not after:
   * the length field counts unescaped bytes, so with byte stuffing in play the
   * number of bytes to consume from the wire is not known up front.
   */
  private readFrame(): { bytes: Uint8Array; consumed: number } | null {
    const { escape, startOfFrame } = this.profile
    const unescaped: number[] = []
    let consumed = 0
    let needed: number | null = null

    while (consumed < this.buffer.length) {
      let byte = this.buffer[consumed]
      if (escape && byte === escape.escapeByte && consumed >= startOfFrame.length) {
        if (consumed + 1 >= this.buffer.length) return null // escape pair split across chunks
        byte = this.buffer[consumed + 1] ^ escape.xor
        consumed += 2
      } else {
        consumed += 1
      }
      unescaped.push(byte)

      if (needed === null) needed = this.frameLength(unescaped)
      if (needed !== null && unescaped.length >= needed) {
        return { bytes: new Uint8Array(unescaped), consumed }
      }
    }
    return null
  }

  /**
   * Total unescaped bytes in the frame, or null while too few bytes have
   * arrived to tell.
   */
  private frameLength(bytes: number[]): number | null {
    const { lengthField, fixedLength, startOfFrame, checksum } = this.profile
    if (fixedLength !== null) return fixedLength
    if (!lengthField) return null
    const offset = lengthField.offset
    if (bytes.length < offset + lengthField.size) return null
    const raw = lengthField.size === 1
      ? bytes[offset]
      : lengthField.endian === 'big'
        ? (bytes[offset] << 8) | bytes[offset + 1]
        : bytes[offset] | (bytes[offset + 1] << 8)

    switch (lengthField.basis) {
      case 'whole-frame':
        return raw
      case 'after-length':
        return offset + lengthField.size + raw
      case 'payload':
      default:
        return startOfFrame.length + (offset - startOfFrame.length) + lengthField.size + raw + checksumWidth(checksum.type)
    }
  }

  private checksumValid(frame: Uint8Array): boolean {
    const { checksum } = this.profile
    const width = checksumWidth(checksum.type)
    if (width === 0) return true
    if (frame.length <= checksum.from + width) return false
    const covered = frame.subarray(checksum.from, frame.length - width)
    const expected = computeChecksum(checksum.type, covered)
    const tail = frame.subarray(frame.length - width)
    const actual = width === 1
      ? tail[0]
      : checksum.endian === 'big'
        ? (tail[0] << 8) | tail[1]
        : tail[0] | (tail[1] << 8)
    return expected === actual
  }

  private parseFrame(frame: Uint8Array): AdapterMessage | null {
    const { layout, checksum } = this.profile
    if (frame.length < layout.dataOffset) return null
    const canIdBytes = frame.subarray(layout.canIdOffset, layout.canIdOffset + 4)
    if (canIdBytes.length < 4) return null
    const rawId = layout.canIdEndian === 'big'
      ? ((canIdBytes[0] << 24) | (canIdBytes[1] << 16) | (canIdBytes[2] << 8) | canIdBytes[3]) >>> 0
      : ((canIdBytes[3] << 24) | (canIdBytes[2] << 16) | (canIdBytes[1] << 8) | canIdBytes[0]) >>> 0
    const canId = (rawId & layout.canIdMask) >>> 0

    const trailing = checksumWidth(checksum.type)
    const dlc = layout.dlcOffset !== null
      ? Math.min(frame[layout.dlcOffset] & 0x0f, 8)
      : Math.max(0, Math.min(8, frame.length - trailing - layout.dataOffset))
    const data = frame.subarray(layout.dataOffset, layout.dataOffset + dlc)

    return {
      kind: 'can',
      frame: {
        canId,
        extended: canId > 0x7ff,
        data: data.slice(),
        channel: layout.channelOffset !== null ? frame[layout.channelOffset] : undefined,
      },
    }
  }

  encode(frame: CanFrame): Uint8Array {
    const { layout, startOfFrame, lengthField, checksum, escape } = this.profile
    const trailing = checksumWidth(checksum.type)
    const bodyLength = layout.dataOffset + frame.data.length
    const body = new Uint8Array(bodyLength)
    body.set(startOfFrame, 0)

    const id = frame.canId >>> 0
    const idBytes = layout.canIdEndian === 'big'
      ? [(id >>> 24) & 0xff, (id >>> 16) & 0xff, (id >>> 8) & 0xff, id & 0xff]
      : [id & 0xff, (id >>> 8) & 0xff, (id >>> 16) & 0xff, (id >>> 24) & 0xff]
    body.set(idBytes, layout.canIdOffset)
    if (layout.dlcOffset !== null) body[layout.dlcOffset] = frame.data.length
    if (layout.channelOffset !== null) body[layout.channelOffset] = frame.channel ?? 0
    body.set(frame.data, layout.dataOffset)

    if (lengthField) {
      const value =
        lengthField.basis === 'whole-frame' ? bodyLength + trailing
        : lengthField.basis === 'after-length' ? bodyLength + trailing - lengthField.offset - lengthField.size
        : frame.data.length
      if (lengthField.size === 1) {
        body[lengthField.offset] = value & 0xff
      } else if (lengthField.endian === 'big') {
        body[lengthField.offset] = (value >> 8) & 0xff
        body[lengthField.offset + 1] = value & 0xff
      } else {
        body[lengthField.offset] = value & 0xff
        body[lengthField.offset + 1] = (value >> 8) & 0xff
      }
    }

    let output: Uint8Array<ArrayBufferLike> = body
    if (trailing > 0) {
      const value = computeChecksum(checksum.type, body.subarray(checksum.from))
      const withChecksum = new Uint8Array(body.length + trailing)
      withChecksum.set(body, 0)
      if (trailing === 1) {
        withChecksum[body.length] = value & 0xff
      } else if (checksum.endian === 'big') {
        withChecksum[body.length] = (value >> 8) & 0xff
        withChecksum[body.length + 1] = value & 0xff
      } else {
        withChecksum[body.length] = value & 0xff
        withChecksum[body.length + 1] = (value >> 8) & 0xff
      }
      output = withChecksum
    }

    if (escape) output = applyEscaping(output, escape, startOfFrame.length)
    return output
  }
}

function applyEscaping(
  frame: Uint8Array,
  escape: NonNullable<BinaryFramingProfile['escape']>,
  skipLeading: number,
): Uint8Array {
  const output: number[] = []
  for (let i = 0; i < frame.length; i++) {
    const byte = frame[i]
    if (i >= skipLeading && (byte === escape.escapeByte || escape.escapedBytes.includes(byte))) {
      output.push(escape.escapeByte, byte ^ escape.xor)
    } else {
      output.push(byte)
    }
  }
  return new Uint8Array(output)
}

export function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

export function indexOfSequence(haystack: Uint8Array, needle: number[]): number {
  if (needle.length === 0) return 0
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer
    }
    return i
  }
  return -1
}
