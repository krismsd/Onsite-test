import { useMemo, useState } from 'react'
import { useSession, useAppState } from '../app/hooks'
import { Panel, Empty, Meter } from '../ui/primitives'
import { toHex, fromHex } from '../protocol/j1939/scaling'
import { formatCanId, formatPgn } from '../protocol/j1939/id'
import { addressName } from '../protocol/j1939/pgn-numbers'
import { decoderFor, decodePgn } from '../protocol/j1939/decode'
import { signal } from '../model/signals'
import type { SignalKey } from '../model/types'

/**
 * Datalink monitor: every frame crossing the adapter, decoded where possible.
 * This is the screen to reach for when something is not appearing elsewhere -
 * it shows whether the data is absent from the bus or merely not decoded.
 */
export function DatalinkScreen() {
  const { frames, stats } = useSession()
  const { session, settings } = useAppState()
  const [filter, setFilter] = useState('')
  const [onlyDecoded, setOnlyDecoded] = useState(false)
  const [paused, setPaused] = useState(false)
  const [frozen, setFrozen] = useState<typeof frames>([])
  const [txId, setTxId] = useState('18EA00F9')
  const [txData, setTxData] = useState('EB FE 00')
  const [txError, setTxError] = useState<string | null>(null)

  const source = paused ? frozen : frames

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return source
      .filter((frame) => {
        if (onlyDecoded && !(frame.pgn !== undefined && decoderFor(frame.pgn))) return false
        if (!needle) return true
        return (
          (frame.note ?? '').toLowerCase().includes(needle) ||
          (frame.pgn !== undefined && String(frame.pgn).includes(needle)) ||
          (frame.canId !== undefined && formatCanId(frame.canId).toLowerCase().includes(needle)) ||
          toHex(frame.data).toLowerCase().includes(needle)
        )
      })
      .slice(-400)
      .reverse()
  }, [source, filter, onlyDecoded])

  async function transmit() {
    setTxError(null)
    try {
      const canId = parseInt(txId.replace(/[^0-9a-fA-F]/g, ''), 16)
      if (!Number.isFinite(canId)) throw new Error('Identifier must be hexadecimal.')
      await session?.sendRaw(canId >>> 0, fromHex(txData))
    } catch (error) {
      setTxError(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <>
      <h1>Datalink monitor</h1>

      <div className="columns" style={{ marginBottom: 10 }}>
        <Panel title="Bus statistics">
          <table className="grid">
            <tbody>
              <tr>
                <th style={{ width: 170 }}>Frame rate</th>
                <td className="num mono">{stats.frameRate} /s</td>
              </tr>
              <tr>
                <th>Bus load (estimated)</th>
                <td>
                  <div className="row">
                    <span className="mono" style={{ width: 52 }}>{stats.busLoadPct.toFixed(1)}%</span>
                    <span style={{ flex: 1 }}>
                      <Meter value={stats.busLoadPct} />
                    </span>
                  </div>
                </td>
              </tr>
              <tr>
                <th>Frames received</th>
                <td className="num mono">{stats.framesReceived.toLocaleString()}</td>
              </tr>
              <tr>
                <th>Frames transmitted</th>
                <td className="num mono">{stats.framesTransmitted.toLocaleString()}</td>
              </tr>
              <tr>
                <th>Bytes received</th>
                <td className="num mono">{stats.bytesReceived.toLocaleString()}</td>
              </tr>
              <tr>
                <th>Undecoded frames</th>
                <td className="num mono">{stats.decodeErrors.toLocaleString()}</td>
              </tr>
              <tr>
                <th>Transport sessions open</th>
                <td className="num mono">{stats.pendingTpSessions}</td>
              </tr>
              <tr>
                <th>Bytes buffered in codec</th>
                <td className="num mono">{stats.pendingCodecBytes}</td>
              </tr>
            </tbody>
          </table>
        </Panel>

        <Panel title="Transmit a frame">
          <div className="stack">
            <label className="inline">
              CAN identifier (hex)
              <input className="field mono" style={{ width: 110 }} value={txId} onChange={(e) => setTxId(e.target.value)} />
            </label>
            <label className="inline">
              Data (hex)
              <input className="field mono" style={{ width: 220 }} value={txData} onChange={(e) => setTxData(e.target.value)} />
            </label>
            <div className="row">
              <button className="btn" disabled={!session || settings.listenOnly} onClick={() => void transmit()}>
                Transmit
              </button>
              <span className="dim">
                Default shown is a request for component identification.
              </span>
            </div>
            {settings.listenOnly ? <span className="dim">Listen-only mode is enabled.</span> : null}
            {txError ? <span style={{ color: 'var(--red)' }}>{txError}</span> : null}
          </div>
        </Panel>
      </div>

      <Panel
        title="Frames"
        hint={`${visible.length} shown of ${source.length} buffered`}
        flush
        actions={
          <span className="row" style={{ gap: 6, marginLeft: 12 }}>
            <input
              className="field"
              placeholder="Filter"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              style={{ width: 150 }}
            />
            <label className="inline" style={{ color: '#fff' }}>
              <input type="checkbox" checked={onlyDecoded} onChange={(e) => setOnlyDecoded(e.target.checked)} />
              Decoded only
            </label>
            <button
              className="btn small"
              onClick={() => {
                if (!paused) setFrozen(frames)
                setPaused((value) => !value)
              }}
            >
              {paused ? 'Resume' : 'Freeze'}
            </button>
          </span>
        }
      >
        {visible.length === 0 ? (
          <Empty>No frames match. If nothing is arriving at all, check the adapter framing profile.</Empty>
        ) : (
          <div className="table-scroll" style={{ maxHeight: 460 }}>
            <table className="grid">
              <thead>
                <tr>
                  <th style={{ width: 68 }}>Time</th>
                  <th style={{ width: 34 }}>Dir</th>
                  <th style={{ width: 78 }}>CAN ID</th>
                  <th style={{ width: 118 }}>PGN</th>
                  <th style={{ width: 62 }}>SA</th>
                  <th style={{ width: 72 }}>Name</th>
                  <th style={{ width: 180 }}>Data</th>
                  <th>Decoded</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((frame) => (
                  <tr key={frame.id}>
                    <td className="mono dim">{(frame.at / 1000).toFixed(3)}</td>
                    <td className="mono">{frame.direction === 'tx' ? '→' : '←'}</td>
                    <td className="mono">{frame.canId !== undefined ? formatCanId(frame.canId) : '—'}</td>
                    <td className="mono">{frame.pgn !== undefined ? formatPgn(frame.pgn) : '—'}</td>
                    <td className="mono">
                      {frame.sourceAddress !== undefined
                        ? `0x${frame.sourceAddress.toString(16).padStart(2, '0').toUpperCase()}`
                        : '—'}
                    </td>
                    <td title={frame.sourceAddress !== undefined ? addressName(frame.sourceAddress) : undefined}>
                      {frame.note}
                    </td>
                    <td className="mono">{toHex(frame.data)}</td>
                    <td className="dim">{describeFrame(frame.pgn, frame.data)}</td>
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

/** One-line summary of a frame's decoded contents. */
function describeFrame(pgn: number | undefined, data: Uint8Array): string {
  if (pgn === undefined) return ''
  const decoded = decodePgn(pgn, data)
  const parts = (Object.keys(decoded) as SignalKey[]).map((key) => {
    const definition = signal(key)
    return `${definition.shortLabel} ${decoded[key]!.toFixed(definition.decimals)}${definition.unit}`
  })
  return parts.join('  ')
}
