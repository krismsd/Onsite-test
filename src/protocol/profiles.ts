import type { BinaryFramingProfile } from './framing'

/**
 * Starting points for characterising an adapter whose framing is not
 * documented, including the INLINE 7. None of these is known to be correct
 * for a specific adapter - use the Datalink > Capture Analyser screen to test
 * them against a real capture and refine the winning one.
 */
export const BUILT_IN_PROFILES: BinaryFramingProfile[] = [
  {
    id: 'raw-canid-be',
    name: 'Raw frames, big-endian ID',
    description:
      'Fixed 13-byte frames: 4-byte big-endian identifier, DLC byte, then 8 data bytes. No framing bytes or checksum.',
    startOfFrame: [],
    lengthField: null,
    fixedLength: 13,
    checksum: { type: 'none', from: 0, endian: 'big' },
    escape: null,
    layout: { canIdOffset: 0, canIdEndian: 'big', canIdMask: 0x1fffffff, dataOffset: 5, dlcOffset: 4, channelOffset: null },
  },
  {
    id: 'raw-canid-le',
    name: 'Raw frames, little-endian ID',
    description: 'As above but with the identifier stored least-significant byte first.',
    startOfFrame: [],
    lengthField: null,
    fixedLength: 13,
    checksum: { type: 'none', from: 0, endian: 'little' },
    escape: null,
    layout: { canIdOffset: 0, canIdEndian: 'little', canIdMask: 0x1fffffff, dataOffset: 5, dlcOffset: 4, channelOffset: null },
  },
  {
    id: 'length-prefixed',
    name: 'Length-prefixed frames',
    description:
      'One length byte counting everything after it, then a 4-byte big-endian identifier and the payload.',
    startOfFrame: [],
    lengthField: { offset: 0, size: 1, endian: 'big', basis: 'after-length' },
    fixedLength: null,
    checksum: { type: 'none', from: 0, endian: 'big' },
    escape: null,
    layout: { canIdOffset: 1, canIdEndian: 'big', canIdMask: 0x1fffffff, dataOffset: 5, dlcOffset: null, channelOffset: null },
  },
  {
    id: 'sof-length-checksum',
    name: 'Start byte, length, checksum',
    description:
      '0x55 start byte, length byte, channel byte, 4-byte big-endian identifier, payload, then an 8-bit sum checksum.',
    startOfFrame: [0x55],
    lengthField: { offset: 1, size: 1, endian: 'big', basis: 'after-length' },
    fixedLength: null,
    checksum: { type: 'sum8', from: 1, endian: 'big' },
    escape: null,
    layout: { canIdOffset: 3, canIdEndian: 'big', canIdMask: 0x1fffffff, dataOffset: 7, dlcOffset: null, channelOffset: 2 },
  },
  {
    id: 'escaped-framing',
    name: 'Escaped framing with CRC-16',
    description:
      '0x7E start byte with 0x7D/0x20 byte stuffing, 4-byte big-endian identifier and a CRC-16/CCITT trailer.',
    startOfFrame: [0x7e],
    lengthField: { offset: 1, size: 1, endian: 'big', basis: 'after-length' },
    fixedLength: null,
    checksum: { type: 'crc16-ccitt', from: 1, endian: 'big' },
    escape: { escapeByte: 0x7d, escapedBytes: [0x7e], xor: 0x20 },
    layout: { canIdOffset: 2, canIdEndian: 'big', canIdMask: 0x1fffffff, dataOffset: 6, dlcOffset: null, channelOffset: null },
  },
]

export function profileById(id: string): BinaryFramingProfile | undefined {
  return BUILT_IN_PROFILES.find((profile) => profile.id === id)
}

/** A deep copy, so the UI can edit a profile without mutating the built-ins. */
export function cloneProfile(profile: BinaryFramingProfile): BinaryFramingProfile {
  return JSON.parse(JSON.stringify(profile)) as BinaryFramingProfile
}
