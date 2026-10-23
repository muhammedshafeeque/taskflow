import { useEffect, useState } from 'react'
import {
  type SupportCaseRow,
  type SupportEventRow,
  paAdmin,
  supportEventsUrl,
} from '../api/paAdmin'

export function SupportPage() {
  const [cases, setCases] = useState<SupportCaseRow[]>([])
  const [events, setEvents] = useState<SupportEventRow[]>([])
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')
  const [badge, setBadge] = useState(0)

  async function load() {
    setError('')
    try {
      const data = await paAdmin.listSupportCases()
      setCases(data.cases || [])
      setEvents(data.events || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load support')
    }
  }

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    let es: EventSource | null = null
    let cancelled = false
    void (async () => {
      try {
        const url = await supportEventsUrl()
        if (cancelled) return
        es = new EventSource(url)
        es.addEventListener('support', (ev) => {
          try {
            const data = JSON.parse((ev as MessageEvent).data) as SupportEventRow
            setEvents((prev) => [data, ...prev].slice(0, 80))
            if (
              data.type === 'TICKET_CREATED' ||
              data.type === 'NEW_ISSUE_DETECTED' ||
              data.type === 'DUPLICATE_ISSUE_FOUND'
            ) {
              setBadge((n) => n + 1)
              setToast(
                `${data.type.replace(/_/g, ' ')}: ${
                  data.summary || data.ticketId || data.groupName || ''
                }`
              )
              void load()
            }
          } catch {
            // ignore
          }
        })
        es.onerror = () => {
          // browser will retry
        }
      } catch (err) {
        console.warn('SSE failed', err)
      }
    })()
    return () => {
      cancelled = true
      es?.close()
    }
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(''), 5000)
    return () => window.clearTimeout(t)
  }, [toast])

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>
            Support{' '}
            {badge > 0 ? <span className="badge ok">{badge} new</span> : null}
          </h1>
          <p className="muted">
            Live project support group activity — Support Engineer, QA Lead, and
            Service Desk tickets.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setBadge(0)
            void load()
          }}
        >
          Refresh
        </button>
      </header>

      {toast ? <p className="ok banner-ok">{toast}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      <section className="support-grid">
        <div className="panel">
          <h2>Cases</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Group</th>
                  <th>Status</th>
                  <th>QA</th>
                  <th>Tickets</th>
                  <th>Agent</th>
                </tr>
              </thead>
              <tbody>
                {cases.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="muted">
                      No support cases yet. Enable a group with projects and send
                      a WhatsApp message.
                    </td>
                  </tr>
                ) : (
                  cases.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <strong>{c.groupName || c.groupId}</strong>
                        <div className="muted tiny">{c.groupId}</div>
                      </td>
                      <td>{c.status}</td>
                      <td>
                        {c.lastQaStatus || '—'}
                        {c.lastPriority ? (
                          <div className="muted tiny">{c.lastPriority}</div>
                        ) : null}
                      </td>
                      <td className="tiny">
                        {(c.ticketIds || []).join(', ') || '—'}
                      </td>
                      <td className="tiny">
                        {c.latestAgent || '—'}
                        {c.latestAgentStatus ? (
                          <div className="muted">{c.latestAgentStatus}</div>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <h2>Live events</h2>
          <ul className="event-feed">
            {events.length === 0 ? (
              <li className="muted">Waiting for events…</li>
            ) : (
              events.map((e) => (
                <li key={e.id}>
                  <div className="event-type">{e.type}</div>
                  <div className="muted tiny">{e.at}</div>
                  <div>
                    {e.groupName || e.groupId || ''}
                    {e.projectName ? ` · ${e.projectName}` : ''}
                    {e.ticketId ? ` · ${e.ticketId}` : ''}
                  </div>
                  {e.summary ? (
                    <div className="tiny">{e.summary}</div>
                  ) : null}
                </li>
              ))
            )}
          </ul>
        </div>
      </section>
    </div>
  )
}
