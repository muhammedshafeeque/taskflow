import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { type ConversationListItem, paAdmin } from '../api/paAdmin'

export function ChatsPage() {
  const [rows, setRows] = useState<ConversationListItem[]>([])
  const [q, setQ] = useState('')
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')

  async function load(search = q) {
    setError('')
    try {
      setRows(await paAdmin.listConversations(search))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load chats')
    }
  }

  useEffect(() => {
    void load('')
  }, [])

  async function onSearch(e: FormEvent) {
    e.preventDefault()
    await load(q)
  }

  async function togglePause(row: ConversationListItem) {
    setBusyId(row.chatId)
    setError('')
    try {
      if (row.autoReplyPaused) await paAdmin.resume(row.chatId)
      else await paAdmin.pause(row.chatId)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusyId('')
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Chats</h1>
          <p className="muted">Pause or resume auto-reply per WhatsApp chat</p>
        </div>
        <form className="search" onSubmit={onSearch}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search chat id / phone / name"
          />
          <button type="submit">Search</button>
        </form>
      </header>

      {error ? <p className="error">{error}</p> : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Contact</th>
              <th>Last</th>
              <th>Msgs</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.chatId}>
                <td>
                  <Link to={`/chats/${encodeURIComponent(row.chatId)}`}>
                    {row.contactName || row.contactPhone || row.chatId}
                  </Link>
                  <div className="muted tiny">{row.chatId}</div>
                </td>
                <td>
                  <div>{row.lastType || '—'}</div>
                  <div className="muted tiny">{row.preview || '—'}</div>
                </td>
                <td>{row.messageCount}</td>
                <td>
                  <span
                    className={
                      row.autoReplyPaused ? 'badge warn' : 'badge ok'
                    }
                  >
                    {row.autoReplyPaused ? 'Paused' : 'Active'}
                  </span>
                </td>
                <td className="actions">
                  <button
                    type="button"
                    disabled={busyId === row.chatId}
                    className={row.autoReplyPaused ? '' : 'danger'}
                    onClick={() => void togglePause(row)}
                  >
                    {row.autoReplyPaused ? 'Resume' : 'Pause'}
                  </button>
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={5} className="muted">
                  No conversations yet
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}
