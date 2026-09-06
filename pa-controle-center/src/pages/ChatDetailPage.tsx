import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { type ConversationDetail, paAdmin } from '../api/paAdmin'

export function ChatDetailPage() {
  const { chatId: rawId = '' } = useParams()
  const chatId = decodeURIComponent(rawId)
  const [conv, setConv] = useState<ConversationDetail | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    setError('')
    try {
      setConv(await paAdmin.getConversation(chatId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    }
  }

  useEffect(() => {
    void load()
  }, [chatId])

  async function pauseToggle() {
    if (!conv) return
    setBusy(true)
    try {
      if (conv.autoReplyPaused) await paAdmin.resume(chatId)
      else await paAdmin.pause(chatId)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  async function resetMemory() {
    if (!confirm('Clear chat memory for this conversation?')) return
    setBusy(true)
    try {
      await paAdmin.reset(chatId)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed')
    } finally {
      setBusy(false)
    }
  }

  if (!conv && !error) return <p className="muted">Loading…</p>

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <Link to="/chats" className="back">
            ← Chats
          </Link>
          <h1>{conv?.contactName || conv?.contactPhone || chatId}</h1>
          <p className="muted tiny">{chatId}</p>
        </div>
        <div className="actions">
          <button type="button" disabled={busy} onClick={() => void pauseToggle()}>
            {conv?.autoReplyPaused ? 'Resume auto-reply' : 'Pause auto-reply'}
          </button>
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={() => void resetMemory()}
          >
            Reset memory
          </button>
        </div>
      </header>

      {error ? <p className="error">{error}</p> : null}

      <section className="meta-row">
        <span>
          Status:{' '}
          <strong>{conv?.autoReplyPaused ? 'Paused' : 'Active'}</strong>
        </span>
        <span>Lang: {conv?.lastLang || '—'}</span>
        <span>Type: {conv?.lastType || '—'}</span>
        <span>CRM: {conv?.crmLeadId || '—'}</span>
      </section>

      {conv?.lead?.summary ? (
        <section className="panel">
          <h2>Lead notes</h2>
          <pre className="notes">{conv.lead.summary}</pre>
        </section>
      ) : null}

      <section className="panel thread">
        <h2>Messages</h2>
        {(conv?.messages ?? []).map((m, i) => (
          <div key={`${m.role}-${i}`} className={`bubble ${m.role}`}>
            <span className="role">{m.role}</span>
            <p>{m.content}</p>
          </div>
        ))}
        {!conv?.messages?.length ? (
          <p className="muted">No messages in memory</p>
        ) : null}
      </section>
    </div>
  )
}
