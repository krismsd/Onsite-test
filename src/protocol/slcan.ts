import type { AdapterCodec, AdapterMessage, AdapterOpenOptions, CanFrame } from './framing'

/**
 * Lawicel "slcan" ASCII protocol.
 *
 * Widely implemented by USB-CAN adapters (CANable, USBtin, Lawicel CANUSB and
 * clones). Every command and every received frame is a line terminated by CR.
 * This codec is exact - it follows the published slcan command set - so the
 * application is fully usable with an slcan adapter while the INLINE framing
 * is being characterised.
 */

const CR = 0x0d
const BEL = 0x07

/** Bitrate codes S0..S8 from the slcan command set. */
const BITRATE_CODES: Array<[number, string]> = [
  [10000, 'S0'],
  [20000, 'S1'],
  [50000, 'S2'],
  [100000, 'S3'],
  [125000, 'S4'],
  [250000, 'S5'],
  [500000, 'S6'],
  [800000, 'S7'],
  [1000000, 'S8'],
]

export function bitrateCommand(bitrate: number): string {
  const match = BITRATE_CODES.find(([rate]) => rate === bitrate)
  if (match) return match[1]
  // Fall back to the nearest supported rate rather than sending nonsense.
  const nearest = BITRATE_CODES.reduce((best, entry) =>
    Math.abs(entry[0] - bitrate) < Math.abs(best[0] - bitrate) ? entry : best,
  )
  return nearest[1]
}

function ascii(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff
  return bytes
}

export class SlcanCodec implements AdapterCodec {
  readonly id = 'slcan'
  readonly name = 'slcan / Lawicel ASCII'
  readonly description =
    'ASCII line protocol used by CANable, USBtin, Lawicel CANUSB and compatible adapters.'

  private buffer = ''

  get pendingBytes(): number {
    return this.buffer.length
  }

  reset(): void {
    this.buffer = ''
  }

  openCommands(options: AdapterOpenOptions): Uint8Array[] {
    return [
      ascii('C\r'), // close first, in case the adapter was left open
      ascii(`${bitrateCommand(options.bitrate)}\r`),
      ascii(options.listenOnly ? 'L\r' : 'O\r'),
    ]
  }

  closeCommands(): Uint8Array[] {
    return [ascii('C\r')]
  }

  decode(chunk: Uint8Array): AdapterMessage[] {
    const messages: AdapterMessage[] = []
    for (const byte of chunk) {
      if (byte === CR) {
        const line = this.buffer
        this.buffer = ''
        if (line.length === 0) continue
        const parsed = this.parseLine(line)
        if (parsed) messages.push(parsed)
        continue
      }
      if (byte === BEL) {
        this.buffer = ''
        messages.push({ kind: 'status', text: 'Adapter reported an error (BEL)', bytes: new Uint8Array([BEL]) })
        continue
      }
      this.buffer += String.fromCharCode(byte)
      if (this.buffer.length > 512) this.buffer = '' // never grow without bound
    }
    return messages
  }

  private parseLine(line: string): AdapterMessage | null {
    const type = line[0]
    const extended = type === 'T' || type === 'R'
    const rtr = type === 'r' || type === 'R'
    if (type !== 't' && type !== 'T' && type !== 'r' && type !== 'R') {
      return { kind: 'status', text: line, bytes: ascii(line) }
    }
    const idLength = extended ? 8 : 3
    const idText = line.slice(1, 1 + idLength)
    const dlcText = line.slice(1 + idLength, 2 + idLength)
    const canId = parseInt(idText, 16)
    const dlc = parseInt(dlcText, 16)
    if (Number.isNaN(canId) || Number.isNaN(dlc)) {
      return { kind: 'status', text: `Malformed frame: ${line}`, bytes: ascii(line) }
    }
    const dataText = line.slice(2 + idLength, 2 + idLength + dlc * 2)
    const data = new Uint8Array(Math.min(dlc, 8))
    for (let i = 0; i < data.length; i++) {
      data[i] = parseInt(dataText.substr(i * 2, 2), 16) || 0
    }
    const frame: CanFrame = { canId, extended, data, rtr }
    return { kind: 'can', frame }
  }

  encode(frame: CanFrame): Uint8Array {
    const extended = frame.extended || frame.canId > 0x7ff
    const prefix = frame.rtr ? (extended ? 'R' : 'r') : extended ? 'T' : 't'
    const id = frame.canId.toString(16).toUpperCase().padStart(extended ? 8 : 3, '0')
    const data = Array.from(frame.data, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join('')
    return ascii(`${prefix}${id}${frame.data.length}${data}\r`)
  }
}
