import { signal } from '../model/signals'
import type { SignalKey } from '../model/types'

/**
 * Multi-trace strip chart.
 *
 * Each trace is normalised to its own signal range so parameters with very
 * different units can be compared on one time base, which is how a technician
 * looks for a correlation (a boost drop against a load change, say).
 */

export const TRACE_COLOURS = [
  '#0a41a0',
  '#b3261e',
  '#1f6b34',
  '#b06a00',
  '#6b21a8',
  '#0f766e',
  '#9d174d',
  '#374151',
]

export interface Trace {
  key: SignalKey
  values: Array<number | undefined>
  colour: string
  visible: boolean
}

const WIDTH = 900
const HEIGHT = 240
const PADDING = { top: 8, right: 10, bottom: 18, left: 10 }

export function StripChart({
  traces,
  windowSeconds,
  capacity,
}: {
  traces: Trace[]
  windowSeconds: number
  /** Samples the window holds when full; fewer samples plot against the right edge. */
  capacity: number
}) {
  const plotWidth = WIDTH - PADDING.left - PADDING.right
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom
  const sampleCount = Math.max(...traces.map((trace) => trace.values.length), 1)
  // Anchor the newest sample at the right edge so a partly filled buffer is not
  // stretched across the whole time axis.
  const firstSlot = Math.max(0, capacity - sampleCount)
  const slotWidth = plotWidth / Math.max(capacity - 1, 1)

  const gridLines = 4
  const timeLabels = 6

  return (
    <svg className="chart" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" height={HEIGHT} role="img" aria-label="Parameter trend">
      {Array.from({ length: gridLines + 1 }, (_, index) => {
        const y = PADDING.top + (plotHeight * index) / gridLines
        return <line key={`h${index}`} x1={PADDING.left} y1={y} x2={WIDTH - PADDING.right} y2={y} stroke="#e2dfd4" strokeWidth="1" />
      })}
      {Array.from({ length: timeLabels + 1 }, (_, index) => {
        const x = PADDING.left + (plotWidth * index) / timeLabels
        const secondsAgo = Math.round(windowSeconds - (windowSeconds * index) / timeLabels)
        return (
          <g key={`v${index}`}>
            <line x1={x} y1={PADDING.top} x2={x} y2={PADDING.top + plotHeight} stroke="#e2dfd4" strokeWidth="1" />
            <text x={x} y={HEIGHT - 5} fontSize="10" fill="#5c5a52" textAnchor={index === 0 ? 'start' : index === timeLabels ? 'end' : 'middle'}>
              {secondsAgo === 0 ? 'now' : `-${secondsAgo}s`}
            </text>
          </g>
        )
      })}

      {traces
        .filter((trace) => trace.visible)
        .map((trace) => {
          const def = signal(trace.key)
          const span = def.max - def.min || 1
          let path = ''
          let penDown = false
          trace.values.forEach((value, index) => {
            if (value === undefined || !Number.isFinite(value)) {
              penDown = false
              return
            }
            const x = PADDING.left + (firstSlot + index) * slotWidth
            const normalised = Math.min(1, Math.max(0, (value - def.min) / span))
            const y = PADDING.top + plotHeight - normalised * plotHeight
            path += `${penDown ? 'L' : 'M'} ${x.toFixed(1)} ${y.toFixed(1)} `
            penDown = true
          })
          return path ? (
            <path key={trace.key} d={path.trim()} fill="none" stroke={trace.colour} strokeWidth="1.6" strokeLinejoin="round" />
          ) : null
        })}
    </svg>
  )
}
