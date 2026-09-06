import { useSyncExternalStore, useEffect, useRef, useState } from 'react'
import { appStore } from './store'
import type { AppState } from './store'
import type { SessionSnapshot } from './session'

/** Subscribe a component to application state. */
export function useAppState(): AppState {
  return useSyncExternalStore(appStore.subscribe, appStore.getState, appStore.getState)
}

const EMPTY_SNAPSHOT: SessionSnapshot = {
  signals: {},
  dtcs: [],
  lamps: { malfunction: false, red: false, amber: false, protect: false },
  nodes: [],
  identification: new Map(),
  frames: [],
  stats: {
    framesReceived: 0,
    framesTransmitted: 0,
    bytesReceived: 0,
    decodeErrors: 0,
    frameRate: 0,
    busLoadPct: 0,
    connectedSince: null,
    lastFrameAt: null,
    pendingTpSessions: 0,
    pendingCodecBytes: 0,
  },
}

/**
 * Live session state. The session returns a cached snapshot between changes,
 * which is what useSyncExternalStore requires.
 */
export function useSession(): SessionSnapshot {
  const { session } = useAppState()
  const subscribe = session ? session.subscribe.bind(session) : () => () => undefined
  const getSnapshot = session ? session.snapshot.bind(session) : () => EMPTY_SNAPSHOT
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Re-render on an interval, for views that show elapsed time. */
export function useTicker(intervalMs = 1000): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return tick
}

/** Keep a rolling history of values for the strip chart. */
export function useHistory<T>(value: T, length: number): T[] {
  const history = useRef<T[]>([])
  history.current = [...history.current, value].slice(-length)
  return history.current
}
