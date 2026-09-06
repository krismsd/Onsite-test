import { useMemo, useState } from 'react'
import { useSession, useAppState } from '../app/hooks'
import { Panel, Note, Empty, Tag } from '../ui/primitives'
import { toHex, fromHex } from '../protocol/j1939/scaling'
import type { RawChunk } from '../app/session'

/**
 * Adapter console.
 *
 * Raw bytes in and out of the adapter's endpoints, with no framing applied.
 * This is the tool for an adapter whose protocol is undocumented: send a
 * candidate command, watch what comes back, and work out the framing from the
 * response rather than guessing at it.
 */

interface Probe {
  name: string
  bytes: string
  rationale: string
}

/**
 * Candidate opening commands.
 *
 * None of these is known to be correct for any particular adapter - they are
 * shapes that adapter protocols commonly take, ordered from least to most
 * speculative. A response of any kind is the signal worth chasing.
 */
const PROBES: Probe[] = [
  {
    name: 'Single NUL',
    bytes: '00',
    rationale: 'The most harmless possible write. Some adapters answer any traffic with a status byte.',
  },
  {
    name: 'Carriage return',
    bytes: '0D',
    rationale: 'If the adapter speaks an ASCII line protocol, a bare CR often draws a prompt or an error byte.',
  },
  {
    name: 'ASCII version query',
    bytes: '56 0D',
    rationale: '"V" followed by CR - the version command in slcan and several other ASCII adapter protocols.',
  },
  {
    name: 'Zero-length framing probe',
    bytes: '01 00',
    rationale: 'A one-byte command with a zero length field, testing a length-prefixed binary protocol.',
  },
  {
    name: 'Common binary preamble',
    bytes: '55 AA 00 00',
    rationale: 'A 0x55 0xAA start-of-frame pattern, widely used as a sync preamble in binary framing.',
  },
]

export function ConsoleScreen() {
  const { rawLog, stats } = useSession()
  const { session, settings } = useAppState()
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [showAscii, setShowAscii] = useState(true)
  const [direction, setDirection] = useState<'all' | 'rx' | 'tx'>('all')

  const visible = useMemo(
    () => rawLog.filter((chunk) => direction === 'all' || chunk.direction === direction).slice(-200).reverse(),
    [rawLog, direction],
  )

  const parsed = useMemo(() => {
    const bytes = fromHex(input)
    return { bytes, valid: input.trim().length > 0 && bytes.length > 0 }
  }, [input])

  async function send(hex: string) {
    setError(null)
    try {
      const bytes = fromHex(hex)
      if (bytes.length === 0) throw new Error('Enter at least one hex byte.')
      await session?.writeRaw(bytes)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  if (!session) {
    return (
      <>
        <h1>Adapter console</h1>
        <Panel title="Console">
          <Empty>Connect to an adapter to send and receive raw bytes.</Empty>
        </Panel>
      </>
    )
  }

  return (
    <>
      <h1>Adapter console</h1>
      <p className="lead">
        Bytes exactly as they cross the adapter’s endpoints, with no framing applied. Use this when
        an adapter is connected but silent: send a candidate command and see whether anything comes
        back.
      </p>

      <div className="row" style={{ marginBottom: 10 }}>
        <Tag tone={stats.bytesReceived > 0 ? 'green' : 'grey'}>
          {stats.bytesReceived.toLocaleString()} bytes received
        </Tag>
        <Tag tone="grey">{rawLog.filter((c) => c.direction === 'tx').length} writes</Tag>
        {settings.listenOnly ? <Tag tone="amber">Listen only — sending disabled</Tag> : null}
      </div>

      {stats.bytesReceived === 0 ? (
        <Note kind="warning" title="Nothing has arrived from the adapter">
          <p>
            An adapter that streams unprompted would already be showing bytes. Silence means one of:
            it needs an initialisation command before it will talk, the vehicle side has no traffic
            to forward, or the wrong interface is claimed.
          </p>
          <p>
            Rule out the easy one first — with the adapter connected to a running engine, a streaming
            adapter produces bytes continuously. If it is silent on a live bus, it is waiting to be
            told to start.
          </p>
        </Note>
      ) : null}

      <Panel title="Send raw bytes">
        <div className="stack">
          <label className="inline" style={{ width: '100%' }}>
            Hex
            <input
              className="field mono"
              style={{ flex: 1 }}
              placeholder="e.g. 55 AA 00 01"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && parsed.valid) void send(input)
              }}
            />
            <button
              className="btn primary"
              disabled={!parsed.valid || settings.listenOnly}
              onClick={() => void send(input)}
            >
              Send {parsed.valid ? `${parsed.bytes.length} byte${parsed.bytes.length === 1 ? '' : 's'}` : ''}
            </button>
          </label>
          {error ? <span style={{ color: 'var(--red)' }}>{error}</span> : null}

          <h2>Probes</h2>
          <p className="dim" style={{ margin: 0 }}>
            None of these is known to be correct for any particular adapter. They are shapes adapter
            protocols commonly take — a response of any kind is what you are looking for.
          </p>
          <table className="grid">
            <thead>
              <tr>
                <th style={{ width: 190 }}>Probe</th>
                <th style={{ width: 110 }}>Bytes</th>
                <th>Why try it</th>
                <th style={{ width: 70 }} />
              </tr>
            </thead>
            <tbody>
              {PROBES.map((probe) => (
                <tr key={probe.name}>
                  <td>{probe.name}</td>
                  <td className="mono">{probe.bytes}</td>
                  <td className="dim">{probe.rationale}</td>
                  <td>
                    <button
                      className="btn small"
                      disabled={settings.listenOnly}
                      onClick={() => void send(probe.bytes)}
                    >
                      Send
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title="Endpoint traffic"
        hint={`${visible.length} of ${rawLog.length} chunks`}
        flush
        actions={
          <span className="row" style={{ gap: 6, marginLeft: 12 }}>
            <select
              className="field"
              value={direction}
              onChange={(event) => setDirection(event.target.value as 'all' | 'rx' | 'tx')}
            >
              <option value="all">Both directions</option>
              <option value="rx">Received only</option>
              <option value="tx">Sent only</option>
            </select>
            <label className="inline" style={{ color: '#fff' }}>
              <input type="checkbox" checked={showAscii} onChange={(e) => setShowAscii(e.target.checked)} />
              ASCII
            </label>
            <button className="btn small" onClick={() => session.clearRawLog()}>
              Clear
            </button>
          </span>
        }
      >
        {visible.length === 0 ? (
          <Empty>No traffic yet.</Empty>
        ) : (
          <div className="table-scroll" style={{ maxHeight: 420 }}>
            <table className="grid">
              <thead>
                <tr>
                  <th style={{ width: 78 }}>Time</th>
                  <th style={{ width: 40 }}>Dir</th>
                  <th style={{ width: 58 }}>Bytes</th>
                  <th>Hex</th>
                  {showAscii ? <th style={{ width: 190 }}>ASCII</th> : null}
                </tr>
              </thead>
              <tbody>
                {visible.map((chunk) => (
                  <tr key={chunk.id}>
                    <td className="mono dim">{(chunk.at / 1000).toFixed(3)}</td>
                    <td className="mono" style={{ color: chunk.direction === 'tx' ? 'var(--accent)' : undefined }}>
                      {chunk.direction === 'tx' ? '→' : '←'}
                    </td>
                    <td className="num mono">{chunk.bytes.length}</td>
                    <td className="mono" style={{ wordBreak: 'break-all' }}>
                      {toHex(chunk.bytes.subarray(0, 64))}
                      {chunk.bytes.length > 64 ? <span className="dim"> …</span> : null}
                    </td>
                    {showAscii ? <td className="mono">{printable(chunk)}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  )
}

function printable(chunk: RawChunk): string {
  return Array.from(chunk.bytes.subarray(0, 48), (byte) =>
    byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : '.',
  ).join('')
}
