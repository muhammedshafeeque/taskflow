import { useEffect, useState } from 'react'
import {
  type CustomerRequestRow,
  type ServiceTicketRow,
  paAdmin,
} from '../api/paAdmin'

type Tab = 'pending' | 'all' | 'tickets'

function labelOf(v: unknown): string {
  if (!v) return '—'
  if (typeof v === 'string') return v
  if (typeof v === 'object' && v !== null) {
    const o = v as { name?: string; key?: string; email?: string }
    if (o.name && o.key) return `${o.name} (${o.key})`
    return o.name || o.email || '—'
  }
  return String(v)
}

function statusClass(status: string): string {
  if (status.includes('pending') || status === 'submitted') return 'warn'
  if (status === 'rejected') return 'danger'
  if (status === 'resolved' || status === 'closed' || status === 'approved')
    return 'ok'
  return ''
}

export function RequestsPage() {
  const [tab, setTab] = useState<Tab>('pending')
  const [requests, setRequests] = useState<CustomerRequestRow[]>([])
  const [tickets, setTickets] = useState<ServiceTicketRow[]>([])
  const [selected, setSelected] = useState<CustomerRequestRow | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')
  const [workClassification, setWorkClassification] = useState<
    'billable_change' | 'fix' | ''
  >('')
  const [approveNote, setApproveNote] = useState('')
  const [rejectReason, setRejectReason] = useState('')
  const [rejectNote, setRejectNote] = useState('')
  const [ticketStatusFilter, setTicketStatusFilter] = useState('')

  async function load() {
    setError('')
    setSuccess('')
    try {
      if (tab === 'tickets') {
        const data = await paAdmin.listServiceTickets({
          status: ticketStatusFilter || undefined,
        })
        setTickets(data.tickets || [])
      } else {
        const data = await paAdmin.listServiceRequests({
          pendingOnly: tab === 'pending',
          status: tab === 'all' && statusFilter ? statusFilter : undefined,
          limit: 80,
        })
        setRequests(data.requests || [])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, statusFilter, ticketStatusFilter])

  async function openDetail(row: CustomerRequestRow) {
    setError('')
    try {
      const data = await paAdmin.getServiceRequest(row._id)
      setSelected(data.request)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load request')
    }
  }

  async function onApprove() {
    if (!selected || !workClassification) {
      setError('Choose work classification (Billable change or Fix)')
      return
    }
    setBusy(true)
    setError('')
    try {
      await paAdmin.approveServiceRequest(selected._id, {
        workClassification,
        note: approveNote || undefined,
      })
      setSuccess('Request approved — ticket/issue created')
      setSelected(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve failed')
    } finally {
      setBusy(false)
    }
  }

  async function onReject() {
    if (!selected) return
    setBusy(true)
    setError('')
    try {
      await paAdmin.rejectServiceRequest(selected._id, {
        reason: rejectReason || undefined,
        note: rejectNote || undefined,
      })
      setSuccess('Request rejected')
      setSelected(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reject failed')
    } finally {
      setBusy(false)
    }
  }

  async function setTicketStatus(id: string, status: string) {
    setBusy(true)
    setError('')
    try {
      await paAdmin.patchServiceTicket(id, { status })
      setSuccess(`Ticket → ${status}`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  const pendingTf = selected?.status === 'pending_taskflow_approval'

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Service requests</h1>
          <p className="muted">
            Portal requests: approve / reject, and manage service desk tickets
          </p>
        </div>
        <button type="button" className="ghost" onClick={() => void load()}>
          Refresh
        </button>
      </header>

      {error ? <p className="error">{error}</p> : null}
      {success ? <p className="ok">{success}</p> : null}

      <div className="tabs-row">
        {(
          [
            ['pending', 'Pending approval'],
            ['all', 'All requests'],
            ['tickets', 'Service tickets'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={tab === id ? '' : 'ghost'}
            onClick={() => {
              setTab(id)
              setSelected(null)
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'all' ? (
        <div className="filter-row">
          <label>
            Status{' '}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">Any</option>
              {[
                'pending_taskflow_approval',
                'pending_customer_approval',
                'ticket_created',
                'in_progress',
                'approved',
                'resolved',
                'closed',
                'rejected',
                'submitted',
                'draft',
              ].map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {tab === 'tickets' ? (
        <div className="filter-row">
          <label>
            Status{' '}
            <select
              value={ticketStatusFilter}
              onChange={(e) => setTicketStatusFilter(e.target.value)}
            >
              <option value="">Any</option>
              {['open', 'pending', 'in_progress', 'resolved', 'closed'].map(
                (s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                )
              )}
            </select>
          </label>
        </div>
      ) : null}

      {tab !== 'tickets' ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Org</th>
                <th>Project</th>
                <th>Priority</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r._id}>
                  <td>
                    <strong>{r.title}</strong>
                    <div className="muted tiny">{r.type}</div>
                  </td>
                  <td>{labelOf(r.customerOrgId)}</td>
                  <td>{labelOf(r.projectId)}</td>
                  <td>{r.priority}</td>
                  <td>
                    <span className={`pill ${statusClass(r.status)}`}>
                      {r.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => void openDetail(r)}
                    >
                      Review
                    </button>
                  </td>
                </tr>
              ))}
              {!requests.length ? (
                <tr>
                  <td colSpan={6} className="muted">
                    No requests
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Subject</th>
                <th>Project</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t._id}>
                  <td>
                    <strong>{t.subject}</strong>
                    <div className="muted tiny">
                      {typeof t.linkedIssueId === 'object'
                        ? t.linkedIssueId?.key
                        : t.source || ''}
                    </div>
                  </td>
                  <td>{labelOf(t.projectId)}</td>
                  <td>{t.priority}</td>
                  <td>
                    <span className={`pill ${statusClass(t.status)}`}>
                      {t.status}
                    </span>
                  </td>
                  <td className="actions-cell">
                    {['in_progress', 'pending', 'resolved', 'closed'].map(
                      (s) => (
                        <button
                          key={s}
                          type="button"
                          className="ghost tiny-btn"
                          disabled={busy || t.status === s}
                          onClick={() => void setTicketStatus(t._id, s)}
                        >
                          {s}
                        </button>
                      )
                    )}
                  </td>
                </tr>
              ))}
              {!tickets.length ? (
                <tr>
                  <td colSpan={5} className="muted">
                    No tickets
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      {selected ? (
        <div className="drawer">
          <div className="drawer-panel">
            <header className="page-head">
              <div>
                <h2>{selected.title}</h2>
                <p className="muted">
                  {labelOf(selected.customerOrgId)} ·{' '}
                  {labelOf(selected.projectId)}
                </p>
              </div>
              <button
                type="button"
                className="ghost"
                onClick={() => setSelected(null)}
              >
                Close
              </button>
            </header>
            <p>
              <span className={`pill ${statusClass(selected.status)}`}>
                {selected.status.replace(/_/g, ' ')}
              </span>{' '}
              · {selected.priority} · {selected.type}
            </p>
            <p className="pre">{selected.description || 'No description'}</p>
            {selected.linkedIssueKey ? (
              <p className="muted">Issue {selected.linkedIssueKey}</p>
            ) : null}

            {pendingTf ? (
              <>
                <section className="panel">
                  <h3>Approve</h3>
                  <label>
                    Work classification
                    <select
                      value={workClassification}
                      onChange={(e) =>
                        setWorkClassification(
                          e.target.value as 'billable_change' | 'fix' | ''
                        )
                      }
                    >
                      <option value="">Select…</option>
                      <option value="billable_change">Billable change</option>
                      <option value="fix">Fix</option>
                    </select>
                  </label>
                  <label>
                    Note
                    <textarea
                      value={approveNote}
                      onChange={(e) => setApproveNote(e.target.value)}
                      rows={2}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void onApprove()}
                  >
                    Approve & create ticket
                  </button>
                </section>
                <section className="panel">
                  <h3>Reject</h3>
                  <label>
                    Reason
                    <input
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                    />
                  </label>
                  <label>
                    Note
                    <textarea
                      value={rejectNote}
                      onChange={(e) => setRejectNote(e.target.value)}
                      rows={2}
                    />
                  </label>
                  <button
                    type="button"
                    className="danger"
                    disabled={busy}
                    onClick={() => void onReject()}
                  >
                    Reject request
                  </button>
                </section>
              </>
            ) : (
              <p className="muted">
                This request is not pending TaskFlow approval.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
