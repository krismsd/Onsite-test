import { useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from '../app/hooks'
import { Panel, Empty } from '../ui/primitives'
import { Gauge } from '../ui/Gauge'
import { StripChart, TRACE_COLOURS } from '../ui/StripChart'
import type { Trace } from '../ui/StripChart'
import { SIGNALS, signal, DEFAULT_MONITOR_KEYS, formatSignal } from '../model/signals'
import type { SignalKey, SignalFrame } from '../model/types'

/** A value older than this is shown greyed out: the ECM has stopped sending it. */
const STALE_AFTER_MS = 3000
const SAMPLE_INTERVAL_MS = 250
const HISTORY_SAMPLES = 240 // 60 seconds at 4 Hz

/**
 * Live parameter monitor: gauges for the selected parameters, a rolling trend
 * for all of them, and a CSV export of whatever has been recorded.
 */
export function MonitorScreen() {
  const { signals } = useSession()
  const [selected, setSelected] = useState<SignalKey[]>(DEFAULT_MONITOR_KEYS)
  const [hidden, setHidden] = useState<Set<SignalKey>>(new Set())
  const [paused, setPaused] = useState(false)
  const [history, setHistory] = useState<Array<{ at: number; values: Partial<Record<SignalKey, number>> }>>([])
  const latest = useRef<SignalFrame>(signals)
  latest.current = signals

  useEffect(() => {
    if (paused) return
    const timer = setInterval(() => {
      const values: Partial<Record<SignalKey, number>> = {}
      const now = performance.now()
      for (const key of Object.keys(latest.current) as SignalKey[]) {
        const sample = latest.current[key]
        if (sample && now - sample.at < STALE_AFTER_MS) values[key] = sample.value
      }
      setHistory((previous) => [...previous, { at: Date.now(), values }].slice(-HISTORY_SAMPLES))
    }, SAMPLE_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [paused])

  const traces: Trace[] = useMemo(
    () =>
      selected.map((key, index) => ({
        key,
        colour: TRACE_COLOURS[index % TRACE_COLOURS.length],
        visible: !hidden.has(key),
        values: history.map((entry) => entry.values[key]),
      })),
    [selected, hidden, history],
  )

  const now = performance.now()

  function toggleSignal(key: SignalKey) {
    setSelected((previous) =>
      previous.includes(key) ? previous.filter((existing) => existing !== key) : [...previous, key],
    )
  }

  function exportCsv() {
    const header = ['timestamp', ...selected].join(',')
    const rows = history.map((entry) =>
      [new Date(entry.at).toISOString(), ...selected.map((key) => entry.values[key] ?? '')].join(','),
    )
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `monitor-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <h1>Monitor</h1>
      <div className="row" style={{ marginBottom: 10 }}>
        <button className="btn" onClick={() => setPaused((value) => !value)}>
          {paused ? 'Resume recording' : 'Pause recording'}
        </button>
        <button className="btn" onClick={() => setHistory([])}>
          Clear trend
        </button>
        <button className="btn" onClick={exportCsv} disabled={history.length === 0}>
          Export CSV
        </button>
        <span className="dim">
          {history.length} samples ({((history.length * SAMPLE_INTERVAL_MS) / 1000).toFixed(0)}s)
        </span>
      </div>

      <Panel title="Gauges">
        {selected.length === 0 ? (
          <Empty>Select parameters below to display them.</Empty>
        ) : (
          <div className="gauge-grid">
            {selected.map((key) => {
              const sample = signals[key]
              const stale = !sample || now - sample.at > STALE_AFTER_MS
              return <Gauge key={key} signalKey={key} value={sample?.value} stale={stale} />
            })}
          </div>
        )}
      </Panel>

      <Panel title="Trend" hint={`${(HISTORY_SAMPLES * SAMPLE_INTERVAL_MS) / 1000}s window`}>
        <StripChart
          traces={traces}
          windowSeconds={(HISTORY_SAMPLES * SAMPLE_INTERVAL_MS) / 1000}
          capacity={HISTORY_SAMPLES}
        />
        <div className="legend">
          {traces.map((trace) => (
            <span
              key={trace.key}
              className={trace.visible ? 'key' : 'key off'}
              onClick={() =>
                setHidden((previous) => {
                  const next = new Set(previous)
                  if (next.has(trace.key)) next.delete(trace.key)
                  else next.add(trace.key)
                  return next
                })
              }
            >
              <span className="swatch" style={{ background: trace.colour }} />
              {signal(trace.key).label}
              <span className="dim mono">{formatSignal(trace.key, signals[trace.key]?.value)}</span>
            </span>
          ))}
        </div>
      </Panel>

      <Panel title="All parameters" flush>
        <div className="table-scroll">
          <table className="grid">
            <thead>
              <tr>
                <th style={{ width: 34 }} />
                <th>Parameter</th>
                <th style={{ width: 110 }}>Group</th>
                <th className="num" style={{ width: 130 }}>Value</th>
                <th style={{ width: 90 }}>Source</th>
                <th style={{ width: 80 }}>Age</th>
              </tr>
            </thead>
            <tbody>
              {SIGNALS.map((definition) => {
                const sample = signals[definition.key]
                const age = sample ? (now - sample.at) / 1000 : null
                const stale = age === null || age > STALE_AFTER_MS / 1000
                return (
                  <tr key={definition.key}>
                    <td style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={selected.includes(definition.key)}
                        onChange={() => toggleSignal(definition.key)}
                        aria-label={`Show ${definition.label}`}
                      />
                    </td>
                    <td className={stale ? 'dim' : undefined}>{definition.label}</td>
                    <td className="dim">{definition.group}</td>
                    <td className="num mono">{formatSignal(definition.key, sample?.value)}</td>
                    <td className="dim mono">
                      {sample ? `${sample.source} 0x${sample.from.toString(16).padStart(2, '0')}` : '- - -'}
                    </td>
                    <td className="num mono dim">{age === null ? '- - -' : `${age.toFixed(1)}s`}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  )
}
