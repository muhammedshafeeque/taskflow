import { useEffect, useState } from 'react'
import {
  type AdminStatus,
  type BotSettings,
  paAdmin,
} from '../api/paAdmin'

export function DashboardPage() {
  const [status, setStatus] = useState<AdminStatus | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function load() {
    setError('')
    try {
      setStatus(await paAdmin.status())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function patch(partial: Partial<BotSettings>) {
    setSaving(true)
    setError('')
    try {
      const settings = await paAdmin.patchSettings(partial)
      setStatus((s) => (s ? { ...s, settings } : s))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (!status && !error) {
    return <p className="muted">Loading…</p>
  }

  const s = status?.settings

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">Bot status, global pause, and voice settings</p>
        </div>
        <button type="button" className="ghost" onClick={() => void load()}>
          Refresh
        </button>
      </header>

      {error ? <p className="error">{error}</p> : null}

      <section className="grid stats">
        <article>
          <span>WhatsApp</span>
          <strong className={status?.whatsapp.ready ? 'ok' : 'warn'}>
            {status?.whatsapp.ready ? 'Ready' : 'Not ready'}
          </strong>
          <small>
            {status?.whatsapp.authenticated ? 'Authenticated' : 'Waiting auth'}
          </small>
        </article>
        <article>
          <span>Conversations</span>
          <strong>{status?.counts.conversations ?? 0}</strong>
          <small>{status?.counts.paused ?? 0} paused</small>
        </article>
        <article>
          <span>Local leads</span>
          <strong>{status?.counts.leads ?? 0}</strong>
          <small>WhatsApp → CRM</small>
        </article>
      </section>

      <section className="panel">
        <h2>Controls</h2>
        <div className="control-row">
          <div>
            <strong>Pause all auto-replies</strong>
            <p className="muted">Stops the bot for every chat</p>
          </div>
          <button
            type="button"
            disabled={saving || !s}
            className={s?.botPaused ? 'danger' : ''}
            onClick={() => void patch({ botPaused: !s?.botPaused })}
          >
            {s?.botPaused ? 'Resume bot' : 'Pause bot'}
          </button>
        </div>

        <div className="control-row">
          <div>
            <strong>Voice assistance</strong>
            <p className="muted">
              When on, voice notes get spoken replies. When off, always text.
            </p>
          </div>
          <button
            type="button"
            disabled={saving || !s}
            onClick={() =>
              void patch({ voiceRepliesEnabled: !s?.voiceRepliesEnabled })
            }
          >
            {s?.voiceRepliesEnabled ? 'Voice on' : 'Voice off'}
          </button>
        </div>

        <div className="control-row">
          <div>
            <strong>STT language</strong>
            <p className="muted">Whisper language for incoming voice notes</p>
          </div>
          <select
            disabled={saving || !s}
            value={s?.sttLanguage ?? 'ml'}
            onChange={(e) =>
              void patch({
                sttLanguage: e.target.value as BotSettings['sttLanguage'],
              })
            }
          >
            <option value="ml">Malayalam</option>
            <option value="en">English</option>
            <option value="auto">Auto-detect</option>
          </select>
        </div>
      </section>
    </div>
  )
}
