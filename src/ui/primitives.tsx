import type { ReactNode } from 'react'

export function Panel({
  title,
  hint,
  children,
  flush,
  actions,
}: {
  title: string
  hint?: ReactNode
  children: ReactNode
  flush?: boolean
  actions?: ReactNode
}) {
  return (
    <section className="panel">
      <header>
        <span>{title}</span>
        {actions}
        {hint ? <span className="hint">{hint}</span> : null}
      </header>
      <div className={flush ? 'body flush' : 'body'}>{children}</div>
    </section>
  )
}

export function Note({
  kind = 'info',
  title,
  children,
}: {
  kind?: 'info' | 'warning' | 'error'
  title?: string
  children: ReactNode
}) {
  return (
    <div className={kind === 'info' ? 'note' : `note ${kind}`}>
      {title ? <strong>{title}</strong> : null}
      {children}
    </div>
  )
}

export function Properties({ entries }: { entries: Array<[string, ReactNode]> }) {
  return (
    <dl className="properties">
      {entries.map(([term, value]) => (
        <Fragmentish key={term} term={term} value={value} />
      ))}
    </dl>
  )
}

function Fragmentish({ term, value }: { term: string; value: ReactNode }) {
  return (
    <>
      <dt>{term}</dt>
      <dd>{value ?? <span className="dim">- - -</span>}</dd>
    </>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}

export function Tag({ tone, children }: { tone: 'red' | 'amber' | 'green' | 'grey'; children: ReactNode }) {
  return <span className={`tag ${tone}`}>{children}</span>
}

export function Lamps({
  lamps,
}: {
  lamps: { red: boolean; amber: boolean; protect: boolean; malfunction: boolean }
}) {
  return (
    <div className="lamps">
      <Lamp on={lamps.red} tone="red" label="Stop" />
      <Lamp on={lamps.amber} tone="amber" label="Warning" />
      <Lamp on={lamps.protect} tone="protect" label="Protect" />
      <Lamp on={lamps.malfunction} tone="amber" label="MIL" />
    </div>
  )
}

function Lamp({ on, tone, label }: { on: boolean; tone: string; label: string }) {
  return (
    <span className={on ? `lamp on ${tone}` : 'lamp'}>
      <span className="bulb" />
      {label}
    </span>
  )
}

export function Meter({ value, max = 100 }: { value: number; max?: number }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div className="meter" role="meter" aria-valuenow={value} aria-valuemax={max}>
      <span style={{ width: `${pct}%` }} />
    </div>
  )
}

/** Format a duration in seconds as h:mm:ss. */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

export function formatClock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour12: false })
}

export function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString([], { hour12: false })
}
