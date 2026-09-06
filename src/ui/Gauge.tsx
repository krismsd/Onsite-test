import { signal } from '../model/signals'
import type { SignalKey } from '../model/types'

/**
 * Analogue gauge.
 *
 * A 270-degree sweep with the normal operating band drawn as a green arc, so
 * an out-of-range reading is visible at a glance rather than requiring the
 * technician to read the number.
 */

const RADIUS = 46
const CENTRE = 56
const START_ANGLE = 135
const SWEEP = 270

function polar(angleDeg: number, radius = RADIUS): [number, number] {
  const radians = ((angleDeg - 90) * Math.PI) / 180
  return [CENTRE + radius * Math.cos(radians), CENTRE + radius * Math.sin(radians)]
}

function arcPath(fromValue: number, toValue: number, min: number, max: number, radius = RADIUS): string {
  const span = max - min || 1
  const from = START_ANGLE + ((fromValue - min) / span) * SWEEP
  const to = START_ANGLE + ((toValue - min) / span) * SWEEP
  const [x1, y1] = polar(from, radius)
  const [x2, y2] = polar(to, radius)
  const largeArc = to - from > 180 ? 1 : 0
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${radius} ${radius} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`
}

export function Gauge({
  signalKey,
  value,
  stale,
}: {
  signalKey: SignalKey
  value: number | undefined
  stale?: boolean
}) {
  const def = signal(signalKey)
  const hasValue = value !== undefined && Number.isFinite(value)
  const clamped = hasValue ? Math.min(def.max, Math.max(def.min, value)) : def.min
  const span = def.max - def.min || 1
  const needleAngle = START_ANGLE + ((clamped - def.min) / span) * SWEEP
  const [nx, ny] = polar(needleAngle, RADIUS - 8)

  const warning =
    hasValue &&
    ((def.warnAbove !== undefined && value >= def.warnAbove) ||
      (def.warnBelow !== undefined && value <= def.warnBelow))

  const ticks = Array.from({ length: 7 }, (_, index) => def.min + (span * index) / 6)

  return (
    <div className={`gauge${stale ? ' stale' : ''}${warning ? ' warn' : ''}`}>
      <svg viewBox="0 0 112 92" width="100%" height="92" role="img" aria-label={`${def.label} gauge`}>
        <path d={arcPath(def.min, def.max, def.min, def.max)} fill="none" stroke="#d6d2c6" strokeWidth="9" strokeLinecap="round" />
        {def.normal ? (
          <path
            d={arcPath(
              Math.max(def.min, def.normal[0]),
              Math.min(def.max, def.normal[1]),
              def.min,
              def.max,
            )}
            fill="none"
            stroke="#5fa878"
            strokeWidth="9"
            strokeLinecap="butt"
          />
        ) : null}
        {def.warnAbove !== undefined && def.warnAbove < def.max ? (
          <path d={arcPath(def.warnAbove, def.max, def.min, def.max)} fill="none" stroke="#d0453b" strokeWidth="9" />
        ) : null}
        {def.warnBelow !== undefined && def.warnBelow > def.min ? (
          <path d={arcPath(def.min, def.warnBelow, def.min, def.max)} fill="none" stroke="#d0453b" strokeWidth="9" />
        ) : null}
        {ticks.map((tick, index) => {
          const angle = START_ANGLE + ((tick - def.min) / span) * SWEEP
          const [x1, y1] = polar(angle, RADIUS - 6)
          const [x2, y2] = polar(angle, RADIUS - 12)
          return <line key={index} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#8a8776" strokeWidth="1" />
        })}
        {hasValue ? (
          <>
            <line x1={CENTRE} y1={CENTRE} x2={nx} y2={ny} stroke="#b3261e" strokeWidth="2.5" strokeLinecap="round" />
            <circle cx={CENTRE} cy={CENTRE} r="4" fill="#4a4840" />
          </>
        ) : null}
      </svg>
      <div className="readout">
        {hasValue ? (def.boolean ? (value >= 0.5 ? 'ON' : 'OFF') : value.toFixed(def.decimals)) : '- - -'}
        <small>{def.unit || ' '}</small>
      </div>
      <div className="caption">{def.shortLabel}</div>
    </div>
  )
}
