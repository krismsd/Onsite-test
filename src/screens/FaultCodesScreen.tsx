import { useState } from 'react'
import { useSession, useAppState } from '../app/hooks'
import { Panel, Empty, Tag, Lamps, Note, formatDateTime } from '../ui/primitives'
import { describeFault, isLowConfidenceMapping } from '../model/fault-codes'
import type { DiagnosticTroubleCode } from '../model/types'
import { addressName } from '../protocol/j1939/pgn-numbers'
import { fmiShort } from '../protocol/j1939/spn-table'
import { appStore } from '../app/store'

/**
 * Fault codes.
 *
 * Active faults come from DM1, previously active ones from DM2. Both are
 * displayed by SPN/FMI - what the ECM actually reported - with the
 * manufacturer fault code shown alongside when a mapping is known.
 */
export function FaultCodesScreen() {
  const { dtcs, lamps } = useSession()
  const { session, settings } = useAppState()
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const active = dtcs.filter((dtc) => dtc.active)
  const inactive = dtcs.filter((dtc) => !dtc.active)
  const selectedDtc = dtcs.find((dtc) => keyOf(dtc) === selected) ?? null

  const engineAddress = dtcs[0]?.sourceAddress ?? 0x00

  async function clearInactive() {
    if (!session) return
    setBusy(true)
    try {
      await session.clearInactiveFaults(engineAddress)
      appStore.audit('fault-clear', 'Cleared previously active faults (DM3)', addressName(engineAddress))
    } finally {
      setBusy(false)
    }
  }

  async function clearActive() {
    if (!session) return
    setBusy(true)
    try {
      await session.clearActiveFaults(engineAddress)
      appStore.audit('fault-clear', 'Requested clear of active faults (DM11)', addressName(engineAddress))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h1>Fault codes</h1>
      <div className="row" style={{ marginBottom: 10 }}>
        <Lamps lamps={lamps} />
        <span className="spacer" style={{ flex: 1 }} />
        <button className="btn" disabled={!session || settings.listenOnly} onClick={() => void session?.requestActiveFaults()}>
          Re-read active (DM1)
        </button>
        <button className="btn" disabled={!session || settings.listenOnly} onClick={() => void session?.requestInactiveFaults()}>
          Re-read inactive (DM2)
        </button>
        <button className="btn" disabled={!session || settings.listenOnly || busy || inactive.length === 0} onClick={() => void clearInactive()}>
          Clear inactive faults
        </button>
        <button
          className="btn danger"
          disabled={!session || settings.listenOnly || busy || active.length === 0}
          onClick={() => void clearActive()}
        >
          Clear active faults
        </button>
      </div>

      <Panel title="Active faults" hint={`${active.length} active`} flush>
        <FaultTable dtcs={active} selected={selected} onSelect={setSelected} />
      </Panel>

      <Panel title="Previously active faults" hint={`${inactive.length} inactive`} flush>
        <FaultTable dtcs={inactive} selected={selected} onSelect={setSelected} />
      </Panel>

      {selectedDtc ? <FaultDetail dtc={selectedDtc} /> : null}
    </>
  )
}

function keyOf(dtc: DiagnosticTroubleCode): string {
  return `${dtc.sourceAddress}:${dtc.spn}:${dtc.fmi}`
}

function FaultTable({
  dtcs,
  selected,
  onSelect,
}: {
  dtcs: DiagnosticTroubleCode[]
  selected: string | null
  onSelect: (key: string) => void
}) {
  if (dtcs.length === 0) {
    return <Empty>No faults in this category.</Empty>
  }
  return (
    <div className="table-scroll">
      <table className="grid">
        <thead>
          <tr>
            <th style={{ width: 72 }}>Code</th>
            <th className="num" style={{ width: 60 }}>SPN</th>
            <th className="num" style={{ width: 50 }}>FMI</th>
            <th style={{ width: 78 }}>Lamp</th>
            <th>Description</th>
            <th className="num" style={{ width: 60 }}>Count</th>
            <th style={{ width: 150 }}>Last seen</th>
          </tr>
        </thead>
        <tbody>
          {dtcs.map((dtc) => {
            const description = describeFault(dtc.spn, dtc.fmi)
            const key = keyOf(dtc)
            return (
              <tr
                key={key}
                className="selectable"
                aria-selected={selected === key}
                onClick={() => onSelect(key)}
              >
                <td className="mono">
                  {description.faultCode ?? <span className="dim">- - -</span>}
                  {description.faultCode && isLowConfidenceMapping(dtc.spn, dtc.fmi) ? (
                    <span title="Mapping is engine-family dependent"> *</span>
                  ) : null}
                </td>
                <td className="num mono">{dtc.spn}</td>
                <td className="num mono">{dtc.fmi}</td>
                <td>
                  <Tag tone={description.lamp === 'red' ? 'red' : description.lamp === 'protect' ? 'grey' : 'amber'}>
                    {description.lamp === 'red' ? 'Stop' : description.lamp === 'protect' ? 'Protect' : 'Warning'}
                  </Tag>
                </td>
                <td>{description.description}</td>
                <td className="num mono">{dtc.occurrenceCount}</td>
                <td className="mono">{formatDateTime(dtc.lastSeen)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function FaultDetail({ dtc }: { dtc: DiagnosticTroubleCode }) {
  const description = describeFault(dtc.spn, dtc.fmi)
  return (
    <Panel
      title={`Fault detail: SPN ${dtc.spn} FMI ${dtc.fmi}`}
      hint={description.faultCode ? `Fault code ${description.faultCode}` : 'No manufacturer code mapping'}
    >
      <div className="columns two">
        <div>
          <table className="grid">
            <tbody>
              <tr>
                <th style={{ width: 190 }}>Reported by</th>
                <td>{addressName(dtc.sourceAddress)}</td>
              </tr>
              <tr>
                <th>Suspect parameter</th>
                <td>{description.spnName}</td>
              </tr>
              <tr>
                <th>Failure mode</th>
                <td>
                  {dtc.fmi} - {description.fmiName}
                </td>
              </tr>
              <tr>
                <th>Status</th>
                <td>{dtc.active ? <Tag tone="red">Active</Tag> : <Tag tone="grey">Inactive</Tag>}</td>
              </tr>
              <tr>
                <th>Occurrence count</th>
                <td className="mono">{dtc.occurrenceCount}</td>
              </tr>
              <tr>
                <th>First observed</th>
                <td className="mono">{formatDateTime(dtc.firstSeen)}</td>
              </tr>
              <tr>
                <th>Last observed</th>
                <td className="mono">{formatDateTime(dtc.lastSeen)}</td>
              </tr>
              <tr>
                <th>SPN conversion method</th>
                <td className="mono">{dtc.conversionMethod}</td>
              </tr>
            </tbody>
          </table>
          {description.effect ? (
            <>
              <h2>Effect on engine operation</h2>
              <p>{description.effect}</p>
            </>
          ) : null}
        </div>
        <div>
          <h2>Troubleshooting</h2>
          {description.troubleshooting ? (
            <ol style={{ paddingLeft: 20, margin: '4px 0' }}>
              {description.troubleshooting.map((step) => (
                <li key={step} style={{ marginBottom: 4 }}>
                  {step}
                </li>
              ))}
            </ol>
          ) : (
            <Note kind="warning" title="No troubleshooting steps for this SPN/FMI pair">
              <p>
                The failure mode is <strong>{fmiShort(dtc.fmi)}</strong> on{' '}
                <strong>{description.spnName}</strong>. Diagnose it against the engine
                manufacturer’s service literature for this SPN and FMI.
              </p>
            </Note>
          )}
          {description.faultCode && isLowConfidenceMapping(dtc.spn, dtc.fmi) ? (
            <Note kind="warning" title="Fault code mapping is engine-family dependent">
              <p>
                The SPN and FMI are what the ECM reported and are reliable. The manufacturer fault
                code shown for this pair varies between engine families — confirm it against the
                service manual for this engine before ordering parts.
              </p>
            </Note>
          ) : null}
        </div>
      </div>
    </Panel>
  )
}
