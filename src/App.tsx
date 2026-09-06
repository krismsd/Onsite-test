import { useEffect } from 'react'
import { appStore } from './app/store'
import type { ScreenId } from './app/store'
import { useAppState, useSession, useTicker } from './app/hooks'
import { formatDuration, Tag } from './ui/primitives'
import { ConnectionScreen } from './screens/ConnectionScreen'
import { EcmInformationScreen } from './screens/EcmInformationScreen'
import { FaultCodesScreen } from './screens/FaultCodesScreen'
import { MonitorScreen } from './screens/MonitorScreen'
import { TripInformationScreen } from './screens/TripInformationScreen'
import { DatalinkScreen } from './screens/DatalinkScreen'
import { AnalyserScreen } from './screens/AnalyserScreen'
import { UsbDevicesScreen } from './screens/UsbDevicesScreen'
import { ConsoleScreen } from './screens/ConsoleScreen'
import { SimulatorScreen } from './screens/SimulatorScreen'
import { AuditScreen } from './screens/AuditScreen'

interface NavEntry {
  id: ScreenId
  label: string
  group: string
  /** Screens that need a live connection to show anything. */
  requiresSession?: boolean
}

const NAV: NavEntry[] = [
  { id: 'connection', label: 'Connection', group: 'Session' },
  { id: 'ecm-information', label: 'ECM information', group: 'Diagnostics', requiresSession: true },
  { id: 'fault-codes', label: 'Fault codes', group: 'Diagnostics', requiresSession: true },
  { id: 'monitor', label: 'Monitor', group: 'Diagnostics', requiresSession: true },
  { id: 'trip-information', label: 'Trip information', group: 'Diagnostics', requiresSession: true },
  { id: 'datalink', label: 'Datalink monitor', group: 'Datalink', requiresSession: true },
  { id: 'analyser', label: 'Capture analyser', group: 'Datalink' },
  { id: 'usb-devices', label: 'USB devices', group: 'Datalink' },
  { id: 'console', label: 'Adapter console', group: 'Datalink', requiresSession: true },
  { id: 'simulator', label: 'Bench simulator', group: 'Tools' },
  { id: 'audit', label: 'Audit trail', group: 'Tools' },
]

export function App() {
  const state = useAppState()
  const session = useSession()
  useTicker(1000)

  const connected = state.status === 'connected'
  const activeFaults = session.dtcs.filter((dtc) => dtc.active).length

  // Leave the bus cleanly if the page goes away mid-session.
  useEffect(() => {
    const handler = () => void appStore.disconnect(false)
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  const groups = [...new Set(NAV.map((entry) => entry.group))]

  return (
    <div className="app">
      <div className="menubar">
        <span className="brand">
          Service Tool
          <small>engine diagnostics over WebUSB</small>
        </span>
        <span className="menubar-item" onClick={() => appStore.setScreen('connection')}>
          Connection
        </span>
        <span className="menubar-item" onClick={() => appStore.setScreen('fault-codes')}>
          Diagnostics
        </span>
        <span className="menubar-item" onClick={() => appStore.setScreen('datalink')}>
          Datalink
        </span>
        <span className="menubar-item" onClick={() => appStore.setScreen('audit')}>
          Tools
        </span>
      </div>

      <div className="toolbar">
        <button
          className="btn primary"
          disabled={connected || state.status === 'connecting'}
          onClick={() => {
            if (state.settings.transport === 'simulator') void appStore.connectSimulator()
            else if (state.settings.transport === 'webusb') void appStore.connectUsb()
            else void appStore.connectSerial()
          }}
        >
          Connect
        </button>
        <button className="btn" disabled={!connected} onClick={() => void appStore.disconnect()}>
          Disconnect
        </button>
        <span style={{ width: 8 }} />
        <button
          className="btn"
          disabled={!connected || state.settings.listenOnly}
          onClick={() => void state.session?.requestActiveFaults()}
        >
          Read faults
        </button>
        <button
          className="btn"
          disabled={!connected || state.settings.listenOnly}
          onClick={() => void state.session?.requestIdentification()}
        >
          Read identification
        </button>
        <button className="btn" disabled={!connected} onClick={() => state.session?.resetDecodedState()}>
          Clear decoded data
        </button>

        <span className="spacer" />

        {connected ? (
          <>
            {activeFaults > 0 ? (
              <Tag tone="red">
                {activeFaults} active fault{activeFaults === 1 ? '' : 's'}
              </Tag>
            ) : (
              <Tag tone="green">No active faults</Tag>
            )}
            {state.settings.listenOnly ? <Tag tone="amber">Listen only</Tag> : null}
          </>
        ) : (
          <Tag tone="grey">Disconnected</Tag>
        )}
      </div>

      <div className="workspace">
        <nav className="nav">
          {groups.map((group) => (
            <div key={group}>
              <div className="nav-group">{group}</div>
              {NAV.filter((entry) => entry.group === group).map((entry) => (
                <button
                  key={entry.id}
                  className="nav-item"
                  // The badge carries its own label so the button's accessible
                  // name stays the screen name as the counts change.
                  aria-label={entry.label}
                  aria-current={state.screen === entry.id}
                  disabled={entry.requiresSession && !connected}
                  onClick={() => appStore.setScreen(entry.id)}
                >
                  {entry.label}
                  {entry.id === 'fault-codes' && activeFaults > 0 ? (
                    <span className="nav-badge alarm" aria-label={`${activeFaults} active faults`}>
                      {activeFaults}
                    </span>
                  ) : null}
                  {entry.id === 'datalink' && connected ? (
                    <span className="nav-badge" aria-label={`${session.stats.frameRate} frames per second`}>
                      {session.stats.frameRate}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <main className="content">
          <Screen id={state.screen} />
        </main>
      </div>

      <div className="statusbar">
        <span className="cell">{state.statusMessage}</span>
        <span className="cell">
          {state.deviceLabel ?? 'No adapter'}
        </span>
        <span className="cell">
          {connected ? `${session.stats.frameRate} frames/s` : '—'}
        </span>
        <span className="cell">
          {connected ? `Bus load ${session.stats.busLoadPct.toFixed(1)}%` : '—'}
        </span>
        <span className="cell">
          {session.stats.connectedSince
            ? `Connected ${formatDuration((Date.now() - session.stats.connectedSince) / 1000)}`
            : 'Not connected'}
        </span>
      </div>
    </div>
  )
}

function Screen({ id }: { id: ScreenId }) {
  switch (id) {
    case 'connection': return <ConnectionScreen />
    case 'ecm-information': return <EcmInformationScreen />
    case 'fault-codes': return <FaultCodesScreen />
    case 'monitor': return <MonitorScreen />
    case 'trip-information': return <TripInformationScreen />
    case 'datalink': return <DatalinkScreen />
    case 'analyser': return <AnalyserScreen />
    case 'usb-devices': return <UsbDevicesScreen />
    case 'console': return <ConsoleScreen />
    case 'simulator': return <SimulatorScreen />
    case 'audit': return <AuditScreen />
  }
}
