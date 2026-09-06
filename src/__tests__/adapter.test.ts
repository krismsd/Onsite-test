import { describe, it, expect } from 'vitest'
import { SlcanCodec, bitrateCommand } from '../protocol/slcan'
import { GsUsbCodec, computeBitTiming, GS_HOST_FRAME_SIZE } from '../protocol/gsusb'
import { BinaryFramingCodec } from '../protocol/framing'
import type { BinaryFramingProfile, CanFrame } from '../protocol/framing'
import { BUILT_IN_PROFILES, profileById } from '../protocol/profiles'
import { analyseCapture } from '../protocol/analyser'
import { computeChecksum, crc16Ccitt, sum8, xor8 } from '../protocol/checksums'
import { encodeBaudRate, stripFtdiStatusBytes } from '../transport/ftdi'
import { encodeCanId } from '../protocol/j1939/id'
import { PGN } from '../protocol/j1939/pgn-numbers'

const EEC1_FRAME: CanFrame = {
  canId: 0x0cf00400,
  extended: true,
  data: new Uint8Array([0xf0, 0xc8, 0xc8, 0xc0, 0x2b, 0x00, 0xff, 0xff]),
}

describe('slcan codec', () => {
  it('encodes an extended frame in Lawicel ASCII', () => {
    const codec = new SlcanCodec()
    const encoded = codec.encode(EEC1_FRAME)
    expect(new TextDecoder().decode(encoded)).toBe('T0CF004008F0C8C8C02B00FFFF\r')
  })

  it('round-trips a frame through encode and decode', () => {
    const codec = new SlcanCodec()
    const messages = codec.decode(codec.encode(EEC1_FRAME))
    expect(messages).toHaveLength(1)
    expect(messages[0].kind).toBe('can')
    if (messages[0].kind !== 'can') throw new Error('expected a CAN frame')
    expect(messages[0].frame.canId).toBe(EEC1_FRAME.canId)
    expect(Array.from(messages[0].frame.data)).toEqual(Array.from(EEC1_FRAME.data))
  })

  it('reassembles a frame split across two USB chunks', () => {
    const codec = new SlcanCodec()
    const bytes = codec.encode(EEC1_FRAME)
    expect(codec.decode(bytes.slice(0, 9))).toHaveLength(0)
    const messages = codec.decode(bytes.slice(9))
    expect(messages).toHaveLength(1)
  })

  it('selects the documented bitrate command', () => {
    expect(bitrateCommand(250000)).toBe('S5')
    expect(bitrateCommand(500000)).toBe('S6')
    // An unsupported rate falls back to the nearest supported one.
    expect(bitrateCommand(260000)).toBe('S5')
  })

  it('reports adapter errors signalled with BEL', () => {
    const codec = new SlcanCodec()
    const messages = codec.decode(new Uint8Array([0x07]))
    expect(messages[0].kind).toBe('status')
  })

  it('opens the bus in listen-only mode when asked', () => {
    const codec = new SlcanCodec()
    const commands = codec.openCommands({ bitrate: 250000, listenOnly: true })
    const text = commands.map((c) => new TextDecoder().decode(c)).join('')
    expect(text).toContain('L\r')
    expect(text).not.toContain('O\r')
  })
})

describe('gs_usb codec', () => {
  it('round-trips a frame through the 20-byte host structure', () => {
    const codec = new GsUsbCodec()
    const encoded = codec.encode(EEC1_FRAME)
    expect(encoded).toHaveLength(GS_HOST_FRAME_SIZE)

    // Mark it as received from the bus rather than an echo of our own frame.
    const received = new Uint8Array(encoded)
    new DataView(received.buffer).setUint32(0, 0xffffffff, true)

    const messages = codec.decode(received)
    expect(messages).toHaveLength(1)
    if (messages[0].kind !== 'can') throw new Error('expected a CAN frame')
    expect(messages[0].frame.canId).toBe(EEC1_FRAME.canId)
    expect(messages[0].frame.extended).toBe(true)
    expect(Array.from(messages[0].frame.data)).toEqual(Array.from(EEC1_FRAME.data))
  })

  it('discards echo frames so our own transmissions are not decoded as bus traffic', () => {
    const codec = new GsUsbCodec()
    expect(codec.decode(codec.encode(EEC1_FRAME))).toHaveLength(0)
  })

  it('buffers a partial host frame until the rest arrives', () => {
    const codec = new GsUsbCodec()
    const encoded = new Uint8Array(codec.encode(EEC1_FRAME))
    new DataView(encoded.buffer).setUint32(0, 0xffffffff, true)
    expect(codec.decode(encoded.slice(0, 12))).toHaveLength(0)
    expect(codec.pendingBytes).toBe(12)
    expect(codec.decode(encoded.slice(12))).toHaveLength(1)
  })

  it('computes a bit timing that yields the requested bitrate', () => {
    const clock = 48_000_000
    for (const bitrate of [125000, 250000, 500000, 1000000]) {
      const timing = computeBitTiming(bitrate, clock)
      const quanta = 1 + timing.propSeg + timing.phaseSeg1 + timing.phaseSeg2
      expect(clock / (timing.brp * quanta)).toBe(bitrate)
    }
  })
})

describe('checksums', () => {
  it('matches known CRC-16/CCITT-FALSE check value', () => {
    const check = new TextEncoder().encode('123456789')
    expect(crc16Ccitt(check)).toBe(0x29b1)
  })

  it('computes 8-bit sum and xor', () => {
    const data = new Uint8Array([0x01, 0x02, 0x03])
    expect(sum8(data)).toBe(6)
    expect(xor8(data)).toBe(0)
    expect(computeChecksum('sum8', data)).toBe(6)
    expect(computeChecksum('none', data)).toBe(0)
  })
})

describe('binary framing codec', () => {
  it('round-trips through a fixed-length profile', () => {
    const codec = new BinaryFramingCodec(profileById('raw-canid-be')!)
    const messages = codec.decode(codec.encode(EEC1_FRAME))
    expect(messages).toHaveLength(1)
    if (messages[0].kind !== 'can') throw new Error('expected a CAN frame')
    expect(messages[0].frame.canId).toBe(EEC1_FRAME.canId)
    expect(Array.from(messages[0].frame.data)).toEqual(Array.from(EEC1_FRAME.data))
  })

  it('round-trips through a profile with a start byte and checksum', () => {
    const codec = new BinaryFramingCodec(profileById('sof-length-checksum')!)
    const encoded = codec.encode(EEC1_FRAME)
    expect(encoded[0]).toBe(0x55)
    const messages = codec.decode(encoded)
    expect(messages).toHaveLength(1)
    if (messages[0].kind !== 'can') throw new Error('expected a CAN frame')
    expect(messages[0].frame.canId).toBe(EEC1_FRAME.canId)
  })

  it('round-trips through an escaped profile with CRC-16', () => {
    const codec = new BinaryFramingCodec(profileById('escaped-framing')!)
    const frame: CanFrame = { canId: 0x18fe7e00, extended: true, data: new Uint8Array([0x7e, 0x7d, 0x01]) }
    const messages = codec.decode(codec.encode(frame))
    expect(messages).toHaveLength(1)
    if (messages[0].kind !== 'can') throw new Error('expected a CAN frame')
    expect(messages[0].frame.canId).toBe(frame.canId)
    expect(Array.from(messages[0].frame.data)).toEqual([0x7e, 0x7d, 0x01])
  })

  it('rejects a frame whose checksum does not match', () => {
    const codec = new BinaryFramingCodec(profileById('sof-length-checksum')!)
    const corrupted = codec.encode(EEC1_FRAME)
    corrupted[corrupted.length - 1] ^= 0xff
    const messages = codec.decode(corrupted)
    expect(messages.every((m) => m.kind !== 'can')).toBe(true)
  })

  it('resynchronises after leading rubbish bytes', () => {
    const codec = new BinaryFramingCodec(profileById('sof-length-checksum')!)
    const encoded = codec.encode(EEC1_FRAME)
    const noisy = new Uint8Array([0x00, 0x11, 0x22, ...encoded])
    const messages = codec.decode(noisy)
    expect(messages.some((m) => m.kind === 'can')).toBe(true)
  })

  it('every built-in profile survives an encode/decode round trip', () => {
    for (const profile of BUILT_IN_PROFILES) {
      const codec = new BinaryFramingCodec(profile)
      const messages = codec.decode(codec.encode(EEC1_FRAME))
      const can = messages.find((m) => m.kind === 'can')
      expect(can, `profile ${profile.id} failed to round-trip`).toBeDefined()
    }
  })
})

describe('capture analyser', () => {
  /** Build a capture in an arbitrary framing the analyser has never seen. */
  function syntheticCapture(canIdOffset: number, stride: number, endian: 'big' | 'little'): Uint8Array {
    const pgns = [PGN.EEC1, PGN.ET1, PGN.EFL_P1, PGN.LFE, PGN.CCVS1, PGN.IC1]
    const frames: number[] = []
    for (let i = 0; i < 60; i++) {
      const canId = encodeCanId({
        priority: 6,
        pgn: pgns[i % pgns.length],
        sourceAddress: i % 3 === 0 ? 0x00 : 0x03,
        destinationAddress: 0xff,
      })
      const frame = new Array<number>(stride).fill(0xaa)
      const idBytes =
        endian === 'big'
          ? [(canId >>> 24) & 0xff, (canId >>> 16) & 0xff, (canId >>> 8) & 0xff, canId & 0xff]
          : [canId & 0xff, (canId >>> 8) & 0xff, (canId >>> 16) & 0xff, (canId >>> 24) & 0xff]
      for (let b = 0; b < 4; b++) frame[canIdOffset + b] = idBytes[b]
      frame[canIdOffset + 4] = 8 // DLC
      frames.push(...frame)
    }
    return new Uint8Array(frames)
  }

  it('recovers the identifier offset, endianness and frame length', () => {
    const capture = syntheticCapture(3, 16, 'big')
    const result = analyseCapture(capture)
    expect(result.candidates.length).toBeGreaterThan(0)
    const best = result.candidates[0]
    expect(best.canIdOffset).toBe(3)
    expect(best.endian).toBe('big')
    expect(best.stride).toBe(16)
    expect(best.knownPgnRatio).toBeGreaterThan(0.9)
    expect(best.dlcOffset).toBe(7)
  })

  it('handles little-endian identifiers', () => {
    const result = analyseCapture(syntheticCapture(1, 14, 'little'))
    expect(result.candidates[0].endian).toBe('little')
    expect(result.candidates[0].canIdOffset).toBe(1)
  })

  it('produces a profile that actually decodes the capture it was derived from', () => {
    const capture = syntheticCapture(3, 16, 'big')
    const profile = analyseCapture(capture).candidates[0].suggestedProfile as BinaryFramingProfile
    const codec = new BinaryFramingCodec(profile)
    const messages = codec.decode(capture)
    const canFrames = messages.filter((m) => m.kind === 'can')
    expect(canFrames.length).toBeGreaterThan(50)
  })

  it('says so plainly when nothing looks like J1939', () => {
    const random = new Uint8Array(2048)
    for (let i = 0; i < random.length; i++) random[i] = (i * 37 + 11) & 0xff
    const result = analyseCapture(random)
    expect(result.convincing).toBe(false)
    expect(result.notes.join(' ')).toMatch(/no convincing alignment|no j1939 identifier/i)
  })

  it('reports a real alignment as convincing', () => {
    expect(analyseCapture(syntheticCapture(3, 16, 'big')).convincing).toBe(true)
  })

  it('recognises an ASCII adapter protocol instead of guessing byte offsets', () => {
    const codec = new SlcanCodec()
    let capture = new Uint8Array(0)
    for (let i = 0; i < 40; i++) {
      const encoded = codec.encode(EEC1_FRAME)
      const combined = new Uint8Array(capture.length + encoded.length)
      combined.set(capture, 0)
      combined.set(encoded, capture.length)
      capture = combined
    }
    const result = analyseCapture(capture)
    expect(result.candidates).toHaveLength(0)
    expect(result.notes.join(' ')).toMatch(/slcan/i)
    expect(result.notes.join(' ')).toMatch(/40 CAN frames/)
  })

  it('refuses to guess from a capture that is too short', () => {
    const result = analyseCapture(new Uint8Array(8))
    expect(result.candidates).toHaveLength(0)
    expect(result.notes[0]).toMatch(/too short/i)
  })
})

describe('FTDI helpers', () => {
  it('encodes standard baud rates to FTDI divisors', () => {
    // 9600 baud on a 3 MHz clock is divisor 312.5 => 0x4138 in FTDI encoding.
    expect(encodeBaudRate(9600).value).toBe(0x4138)
    expect(encodeBaudRate(3000000).value).toBe(0)
    expect(encodeBaudRate(2000000).value).toBe(1)
  })

  it('strips the two modem status bytes from each USB packet', () => {
    const packet = new Uint8Array(64)
    packet[0] = 0x01
    packet[1] = 0x60
    packet.set([0xde, 0xad, 0xbe, 0xef], 2)
    const stripped = stripFtdiStatusBytes(packet, 64)
    expect(stripped).toHaveLength(62)
    expect(Array.from(stripped.subarray(0, 4))).toEqual([0xde, 0xad, 0xbe, 0xef])
  })

  it('handles several packets in one transfer', () => {
    const transfer = new Uint8Array(128)
    transfer.set([0x01, 0x60, 0xaa], 0)
    transfer.set([0x01, 0x60, 0xbb], 64)
    const stripped = stripFtdiStatusBytes(transfer, 64)
    expect(stripped[0]).toBe(0xaa)
    expect(stripped[62]).toBe(0xbb)
  })
})
