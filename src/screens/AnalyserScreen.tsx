import { useState } from 'react'
import { useAppState } from '../app/hooks'
import { appStore } from '../app/store'
import { Panel, Note, Empty, Tag } from '../ui/primitives'
import { analyseCapture } from '../protocol/analyser'
import type { AnalysisResult } from '../protocol/analyser'
import { toHex } from '../protocol/j1939/scaling'
import { formatPgn } from '../protocol/j1939/id'
import { pgnLabel } from '../protocol/j1939/decode'

/**
 * Capture analyser.
 *
 * The route to getting an adapter with undocumented framing working: record
 * raw bytes, let the analyser find the J1939 identifiers inside them, then
 * apply the framing profile it derives.
 */
export function AnalyserScreen() {
  const { session, settings } = useAppState()
  const [capture, setCapture] = useState<Uint8Array | null>(null)
  const [recording, setRecording] = useState(false)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [applied, setApplied] = useState<string | null>(null)

  function start() {
    session?.startCapture()
    setRecording(true)
    setResult(null)
    setCapture(null)
  }

  function stop() {
    const bytes = session?.stopCapture() ?? new Uint8Array(0)
    setRecording(false)
    setCapture(bytes)
    setResult(analyseCapture(bytes))
  }

  async function loadFile(file: File) {
    const buffer = new Uint8Array(await file.arrayBuffer())
    setCapture(buffer)
    setResult(analyseCapture(buffer))
  }

  function download() {
    if (!capture) return
    // Copy into a fresh buffer so the Blob gets a plain ArrayBuffer view.
    const blob = new Blob([new Uint8Array(capture)], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `capture-${new Date().toISOString().replace(/[:.]/g, '-')}.bin`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <h1>Capture analyser</h1>
      <p className="lead">
        Record the raw bytes an adapter sends and work out how it wraps CAN frames. The analyser
        searches the capture for J1939 identifiers — 29-bit values whose source addresses and PGNs
        make sense — and reports the frame length, identifier offset and byte order that explains
        the most frames.
      </p>

      {!session ? (
        <Note kind="warning" title="Not connected">
          <p>Connect to an adapter first, or load a capture file recorded earlier.</p>
        </Note>
      ) : null}

      <Panel title="Capture">
        <div className="row">
          <button className="btn primary" disabled={!session || recording} onClick={start}>
            Start recording
          </button>
          <button className="btn" disabled={!recording} onClick={stop}>
            Stop and analyse
          </button>
          <button className="btn" disabled={!capture} onClick={download}>
            Save capture
          </button>
          <label className="btn" style={{ display: 'inline-flex', alignItems: 'center' }}>
            Load capture file
            <input
              type="file"
              style={{ display: 'none' }}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void loadFile(file)
              }}
            />
          </label>
          {recording ? <Tag tone="red">Recording — {session?.captureSize ?? 0} bytes</Tag> : null}
          {capture ? <span className="dim">{capture.length.toLocaleString()} bytes captured</span> : null}
        </div>
        {settings.codec !== 'binary' ? (
          <Note kind="warning" title="Analysis is most useful with the configurable framing">
            <p>
              You are connected with the <strong>{settings.codec}</strong> protocol, whose framing is
              already known. Switch to the configurable binary framing when characterising an
              adapter whose wrapper is undocumented.
            </p>
          </Note>
        ) : null}
      </Panel>

      {result ? (
        <>
          <Panel
            title="Findings"
            hint={result.convincing ? 'Alignment found' : 'No convincing alignment'}
          >
            {result.convincing ? null : (
              <Note kind="warning" title="Read these candidates with care">
                <p>
                  Random bytes always align into something. Only trust a candidate whose PGNs are
                  recognised — a low percentage means the analyser found coincidence, not framing.
                </p>
              </Note>
            )}
            {result.notes.map((note) => (
              <p key={note} style={{ margin: '3px 0' }}>
                {note}
              </p>
            ))}
          </Panel>

          <Panel title="Candidate framings" flush>
            {result.candidates.length === 0 ? (
              <Empty>
                Nothing in this capture looks like a J1939 identifier. The adapter may need an
                initialisation command before it starts streaming, or it may not be forwarding bus
                traffic at all.
              </Empty>
            ) : (
              <table className="grid">
                <thead>
                  <tr>
                    <th className="num" style={{ width: 60 }}>Score</th>
                    <th className="num" style={{ width: 70 }}>ID offset</th>
                    <th style={{ width: 90 }}>Byte order</th>
                    <th className="num" style={{ width: 80 }}>Frame size</th>
                    <th className="num" style={{ width: 70 }}>DLC at</th>
                    <th className="num" style={{ width: 70 }}>Frames</th>
                    <th className="num" style={{ width: 90 }}>Known PGNs</th>
                    <th>PGNs seen</th>
                    <th style={{ width: 90 }} />
                  </tr>
                </thead>
                <tbody>
                  {result.candidates.map((candidate) => {
                    const id = candidate.suggestedProfile.id
                    return (
                      <tr key={id}>
                        <td className="num mono">{candidate.score.toFixed(2)}</td>
                        <td className="num mono">+{candidate.canIdOffset}</td>
                        <td>{candidate.endian}-endian</td>
                        <td className="num mono">{candidate.stride ?? 'variable'}</td>
                        <td className="num mono">{candidate.dlcOffset ?? '—'}</td>
                        <td className="num mono">{candidate.hits}</td>
                        <td className="num mono">{(candidate.knownPgnRatio * 100).toFixed(0)}%</td>
                        <td className="dim">
                          {candidate.pgns.slice(0, 5).map((pgn) => pgnLabel(pgn)).join(', ')}
                        </td>
                        <td>
                          <button
                            className="btn small"
                            onClick={() => {
                              appStore.updateSettings({ codec: 'binary', profile: candidate.suggestedProfile })
                              appStore.audit(
                                'adapter-command',
                                'Applied a derived framing profile',
                                `Identifier at +${candidate.canIdOffset} (${candidate.endian}-endian), ${candidate.stride ?? 'variable'}-byte frames`,
                              )
                              setApplied(id)
                            }}
                          >
                            {applied === id ? 'Applied' : 'Apply'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </Panel>

          {result.candidates.length > 0 && result.convincing ? (
            <Note title="After applying a profile">
              <p>
                Reconnect for the new framing to take effect, then check the datalink monitor. If
                PGNs such as {formatPgn(61444)} appear with sensible engine speeds, the framing is
                right.
              </p>
            </Note>
          ) : null}
        </>
      ) : null}

      {capture && capture.length > 0 ? (
        <Panel title="Raw capture (first 1 kB)">
          <div className="hex">{formatHexDump(capture.subarray(0, 1024))}</div>
        </Panel>
      ) : null}
    </>
  )
}

/** Classic offset / hex / ASCII dump. */
function formatHexDump(data: Uint8Array): string {
  const lines: string[] = []
  for (let offset = 0; offset < data.length; offset += 16) {
    const chunk = data.subarray(offset, offset + 16)
    const hex = toHex(chunk).padEnd(47, ' ')
    const ascii = Array.from(chunk, (byte) => (byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : '.')).join('')
    lines.push(`${offset.toString(16).padStart(6, '0')}  ${hex}  ${ascii}`)
  }
  return lines.join('\n')
}
