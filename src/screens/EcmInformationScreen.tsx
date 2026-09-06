import { useSession, useAppState } from '../app/hooks'
import { Panel, Properties, Empty, Note } from '../ui/primitives'
import { appStore } from '../app/store'
import { addressName } from '../protocol/j1939/pgn-numbers'
import { formatClock } from '../ui/primitives'

/** Identification read from every controller found on the datalink. */
export function EcmInformationScreen() {
  const { identification, nodes } = useSession()
  const { session, settings } = useAppState()
  const entries = [...identification.values()]

  return (
    <>
      <h1>ECM information</h1>
      <p className="lead">
        Identification is read with J1939 requests for component identification, software
        identification and vehicle identification. A controller that does not support a request
        simply does not answer it.
      </p>

      <div className="row" style={{ marginBottom: 10 }}>
        <button
          className="btn"
          disabled={!session || settings.listenOnly}
          onClick={() => void session?.requestIdentification()}
        >
          Re-read identification
        </button>
        {settings.listenOnly ? <span className="dim">Listen-only mode: the tool cannot send requests.</span> : null}
      </div>

      {entries.length === 0 ? (
        <Panel title="Controllers">
          <Empty>
            No identification received yet. Controllers answer a request within a second or two; if
            nothing arrives, check that the tool is not in listen-only mode.
          </Empty>
        </Panel>
      ) : (
        entries.map((identity) => (
          <Panel
            key={identity.sourceAddress}
            title={addressName(identity.sourceAddress)}
            hint={`Source address 0x${identity.sourceAddress.toString(16).padStart(2, '0').toUpperCase()}`}
          >
            <Properties
              entries={[
                ['Make', identity.make],
                ['Model', identity.model],
                ['Serial number', identity.serialNumber],
                ['Unit number', identity.unitNumber],
                ['Software identification', identity.softwareIdentification?.join('  |  ')],
                ['Vehicle identification (VIN)', identity.vin],
                ['Manufacturer code', identity.name ? String(identity.name.manufacturerCode) : undefined],
                ['Identity number', identity.name ? String(identity.name.identityNumber) : undefined],
                ['ECU instance', identity.name ? String(identity.name.ecuInstance) : undefined],
                [
                  'Industry group',
                  identity.name ? `${identity.name.industryGroup} (vehicle system ${identity.name.vehicleSystem})` : undefined,
                ],
              ]}
            />
          </Panel>
        ))
      )}

      <Panel title="Nodes seen on the datalink" flush>
        {nodes.length === 0 ? (
          <Empty>No traffic decoded yet.</Empty>
        ) : (
          <table className="grid">
            <thead>
              <tr>
                <th>Address</th>
                <th>Description</th>
                <th className="num">Messages</th>
                <th>First seen</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {nodes.map((node) => (
                <tr key={node.address}>
                  <td className="mono">0x{node.address.toString(16).padStart(2, '0').toUpperCase()}</td>
                  <td>{node.label}</td>
                  <td className="num">{node.messageCount.toLocaleString()}</td>
                  <td className="mono">{(node.firstSeen / 1000).toFixed(1)}s</td>
                  <td className="mono">{(node.lastSeen / 1000).toFixed(1)}s</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {appStore.getState().simulator ? (
        <Note title="Simulated ECM">
          <p>
            These values come from the bench simulator, not from a vehicle. The identification
            strings are deliberately marked as simulated so they cannot be mistaken for a real
            engine record.
          </p>
        </Note>
      ) : null}
      <p className="dim">Times are relative to the start of the session ({formatClock(Date.now())}).</p>
    </>
  )
}
