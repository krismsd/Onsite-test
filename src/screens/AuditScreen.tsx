import { useAppState } from '../app/hooks'
import { Panel, Empty, formatDateTime } from '../ui/primitives'

/**
 * Audit trail: every connection, fault clear and configuration change made in
 * this session, so the work done on a vehicle can be accounted for.
 */
export function AuditScreen() {
  const { audit } = useAppState()

  function exportLog() {
    const rows = audit.map((entry) =>
      [new Date(entry.timestamp).toISOString(), entry.action, entry.summary, entry.detail ?? ''].join('\t'),
    )
    const blob = new Blob([['timestamp\taction\tsummary\tdetail', ...rows].join('\n')], {
      type: 'text/tab-separated-values',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `audit-${new Date().toISOString().replace(/[:.]/g, '-')}.tsv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <h1>Audit trail</h1>
      <p className="lead">
        Actions taken during this session. The log lives in memory only and is lost when the page is
        closed — export it if it needs to be kept with the job record.
      </p>
      <div className="row" style={{ marginBottom: 10 }}>
        <button className="btn" onClick={exportLog} disabled={audit.length === 0}>
          Export log
        </button>
      </div>
      <Panel title="Events" hint={`${audit.length} entries`} flush>
        {audit.length === 0 ? (
          <Empty>Nothing recorded yet.</Empty>
        ) : (
          <table className="grid">
            <thead>
              <tr>
                <th style={{ width: 165 }}>Time</th>
                <th style={{ width: 130 }}>Action</th>
                <th>Summary</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((entry) => (
                <tr key={entry.id}>
                  <td className="mono">{formatDateTime(entry.timestamp)}</td>
                  <td>{entry.action}</td>
                  <td>{entry.summary}</td>
                  <td className="dim">{entry.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  )
}
