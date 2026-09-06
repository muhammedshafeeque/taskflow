import { useEffect, useState } from 'react'
import { type WhatsappLead, paAdmin } from '../api/paAdmin'

export function LeadsPage() {
  const [rows, setRows] = useState<WhatsappLead[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    void (async () => {
      try {
        setRows(await paAdmin.listLeads())
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load leads')
      }
    })()
  }, [])

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Leads</h1>
          <p className="muted">WhatsApp leads stored by PA (local + CRM link)</p>
        </div>
      </header>

      {error ? <p className="error">{error}</p> : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Phone</th>
              <th>CRM</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row._id}>
                <td>
                  <strong>{row.title}</strong>
                  <div className="muted tiny">{row.summary?.slice(0, 100)}</div>
                </td>
                <td>{row.contactPhone || '—'}</td>
                <td className="tiny">{row.crmLeadId || 'local only'}</td>
                <td className="tiny">
                  {row.createdAt
                    ? new Date(row.createdAt).toLocaleString()
                    : '—'}
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={4} className="muted">
                  No leads yet
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}
