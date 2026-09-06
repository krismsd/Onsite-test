import type { BinaryFramingProfile } from './framing'
import { decodeCanId } from './j1939/id'
import { decoderFor } from './j1939/decode'

/**
 * Capture analyser.
 *
 * Given a raw byte capture from an adapter whose framing is unknown, find
 * where the CAN identifier sits inside each frame and how long the frames are.
 *
 * The heuristic works because J1939 traffic from a running engine is highly
 * structured: identifiers are 29-bit (so the top three bits of a 32-bit field
 * are zero), source addresses come from a small set, and a handful of PGNs
 * (EEC1, ET1, EFL/P1 and friends) repeat many times a second. Positions where
 * a 4-byte window decodes to a known PGN are therefore very unlikely to be
 * coincidence, and the spacing between those positions is the frame stride.
 */

export interface AnalysisCandidate {
  canIdOffset: number
  endian: 'big' | 'little'
  /** Bytes between consecutive frames; null when the framing is variable-length. */
  stride: number | null
  /** Number of positions in this candidate's alignment that decoded to a valid ID. */
  hits: number
  /** Fraction of hits whose PGN has a known decoder. */
  knownPgnRatio: number
  /** Distinct source addresses observed. */
  sourceAddresses: number[]
  /** Distinct PGNs observed, most frequent first. */
  pgns: number[]
  /** Offset of a byte that always holds a plausible DLC (0-8), if found. */
  dlcOffset: number | null
  /** Confidence score in 0..1. */
  score: number
  /** A framing profile built from this candidate, ready to try. */
  suggestedProfile: BinaryFramingProfile
}

export interface AnalysisResult {
  totalBytes: number
  candidates: AnalysisCandidate[]
  /** Set when frames appear to be variable-length rather than fixed stride. */
  variableLength: boolean
  notes: string[]
}

interface Hit {
  position: number
  canId: number
  pgn: number
  sourceAddress: number
  known: boolean
}

function readId(data: Uint8Array, position: number, endian: 'big' | 'little'): number {
  return endian === 'big'
    ? ((data[position] << 24) | (data[position + 1] << 16) | (data[position + 2] << 8) | data[position + 3]) >>> 0
    : ((data[position + 3] << 24) | (data[position + 2] << 16) | (data[position + 1] << 8) | data[position]) >>> 0
}

/** A 29-bit identifier occupies the low 29 bits, so the top three must be clear. */
function plausibleId(raw: number): boolean {
  if (raw >>> 29 !== 0) return false
  const header = decodeCanId(raw)
  // Addresses 254 (null) and 255 (global) are never used as a source address.
  if (header.sourceAddress >= 0xfe) return false
  // A PGN of zero is not broadcast by an engine controller.
  return header.pgn !== 0
}

function findHits(data: Uint8Array, endian: 'big' | 'little'): Hit[] {
  const hits: Hit[] = []
  for (let position = 0; position + 4 <= data.length; position++) {
    const raw = readId(data, position, endian)
    if (!plausibleId(raw)) continue
    const header = decodeCanId(raw)
    hits.push({
      position,
      canId: raw,
      pgn: header.pgn,
      sourceAddress: header.sourceAddress,
      known: decoderFor(header.pgn) !== undefined,
    })
  }
  return hits
}

/** Frame strides considered when searching for a fixed-length framing. */
const MIN_STRIDE = 5
const MAX_STRIDE = 128

interface Alignment {
  stride: number
  residue: number
  hits: Hit[]
  coverage: number
}

/**
 * Search stride and alignment together.
 *
 * A fixed-length framing puts the identifier at the same offset in every
 * frame, so the winning (stride, offset) pair is the one whose hits account
 * for the largest share of the frames that stride implies. Searching the two
 * jointly matters: a single global stride estimate is thrown off by the
 * spurious hits that shifted windows produce inside real frames.
 */
function findAlignments(hits: Hit[], totalBytes: number): Alignment[] {
  const alignments: Alignment[] = []
  for (let stride = MIN_STRIDE; stride <= MAX_STRIDE; stride++) {
    const expectedFrames = Math.floor(totalBytes / stride)
    if (expectedFrames < 3) break
    const buckets = new Map<number, Hit[]>()
    for (const hit of hits) {
      const residue = hit.position % stride
      const bucket = buckets.get(residue)
      if (bucket) bucket.push(hit)
      else buckets.set(residue, [hit])
    }
    for (const [residue, bucketHits] of buckets) {
      if (bucketHits.length < 3) continue
      // An identifier plus a DLC byte must fit inside the frame.
      if (residue + 4 > stride) continue
      const coverage = Math.min(1, bucketHits.length / expectedFrames)
      if (coverage < 0.5) continue
      alignments.push({ stride, residue, hits: bucketHits, coverage })
    }
  }
  return alignments
}

function buildProfile(
  canIdOffset: number,
  endian: 'big' | 'little',
  stride: number | null,
  dlcOffset: number | null,
): BinaryFramingProfile {
  const dataOffset = dlcOffset !== null ? dlcOffset + 1 : canIdOffset + 4
  return {
    id: `derived-${endian}-${canIdOffset}-${stride ?? 'var'}`,
    name: `Derived: ID at +${canIdOffset} (${endian}-endian)${stride ? `, ${stride}-byte frames` : ''}`,
    description: 'Generated by the capture analyser. Verify against live traffic before relying on it.',
    startOfFrame: [],
    lengthField: null,
    fixedLength: stride,
    checksum: { type: 'none', from: 0, endian: 'big' },
    escape: null,
    layout: {
      canIdOffset,
      canIdEndian: endian,
      canIdMask: 0x1fffffff,
      dataOffset,
      dlcOffset,
      channelOffset: null,
    },
  }
}

/** Look for a byte that consistently holds a plausible DLC after the identifier. */
function findDlcOffset(data: Uint8Array, positions: number[], canIdOffset: number, stride: number | null): number | null {
  if (stride === null) return null
  for (let offset = canIdOffset + 4; offset < Math.min(canIdOffset + 7, stride); offset++) {
    let plausible = 0
    let checked = 0
    for (const position of positions) {
      const index = position - canIdOffset + offset
      if (index >= data.length) continue
      checked++
      if (data[index] <= 8) plausible++
    }
    if (checked >= 3 && plausible / checked > 0.95) return offset
  }
  return null
}

export function analyseCapture(data: Uint8Array): AnalysisResult {
  const notes: string[] = []
  const candidates: AnalysisCandidate[] = []
  let variableLength = false

  if (data.length < 32) {
    return {
      totalBytes: data.length,
      candidates: [],
      variableLength: false,
      notes: ['Capture is too short to analyse. Record at least a few hundred bytes of live traffic.'],
    }
  }

  for (const endian of ['big', 'little'] as const) {
    const hits = findHits(data, endian)
    if (hits.length < 3) continue

    const alignments = findAlignments(hits, data.length)
    if (alignments.length === 0 && hits.length >= 3) variableLength = true

    for (const alignment of alignments) {
      const group = alignment.hits
      const knownCount = group.filter((hit) => hit.known).length
      const sourceAddresses = [...new Set(group.map((hit) => hit.sourceAddress))].sort((a, b) => a - b)
      const pgnCounts = new Map<number, number>()
      for (const hit of group) pgnCounts.set(hit.pgn, (pgnCounts.get(hit.pgn) ?? 0) + 1)
      const pgns = [...pgnCounts.entries()].sort((a, b) => b[1] - a[1]).map(([pgn]) => pgn)

      const positions = group.map((hit) => hit.position)
      const dlcOffset = findDlcOffset(data, positions, alignment.residue, alignment.stride)

      const knownPgnRatio = knownCount / group.length
      // Many distinct source addresses usually means the alignment is picking
      // up coincidences rather than a real identifier field.
      const addressPenalty = sourceAddresses.length > 16 ? 0.5 : 1
      const score = (alignment.coverage * 0.5 + knownPgnRatio * 0.4 + (dlcOffset !== null ? 0.1 : 0)) * addressPenalty

      candidates.push({
        canIdOffset: alignment.residue,
        endian,
        stride: alignment.stride,
        hits: group.length,
        knownPgnRatio,
        sourceAddresses,
        pgns,
        dlcOffset,
        score,
        suggestedProfile: buildProfile(alignment.residue, endian, alignment.stride, dlcOffset),
      })
    }
  }

  // Equal scores: prefer the smallest stride, since any multiple of the true
  // frame length also lines up with the identifier.
  candidates.sort((a, b) => b.score - a.score || (a.stride ?? 0) - (b.stride ?? 0))

  if (candidates.length === 0) {
    notes.push(
      'No J1939 identifier alignment was found. The adapter may compress or encrypt its framing, may not be forwarding bus traffic yet, or may need an initialisation command before it starts streaming.',
    )
  } else {
    const best = candidates[0]
    notes.push(
      `Best alignment: identifier at offset +${best.canIdOffset} (${best.endian}-endian), ${best.stride ?? 'variable'}-byte frames, ${best.hits} frames matched, ${(best.knownPgnRatio * 100).toFixed(0)}% of PGNs recognised.`,
    )
    if (best.sourceAddresses.length > 0) {
      notes.push(`Source addresses seen: ${best.sourceAddresses.map((a) => `0x${a.toString(16).padStart(2, '0')}`).join(', ')}.`)
    }
  }
  if (variableLength) {
    notes.push('Frame spacing is inconsistent, so the adapter probably uses a length field. Try the length-prefixed profile and adjust the length field offset.')
  }

  return { totalBytes: data.length, candidates: candidates.slice(0, 8), variableLength, notes }
}
