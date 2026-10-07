import { useEffect, useState } from 'react'
import { type BrandProfile, paAdmin } from '../api/paAdmin'

const FIELDS: { key: keyof BrandProfile; label: string; hint?: string; multiline?: boolean }[] = [
  { key: 'companyName', label: 'Company name' },
  { key: 'companyNameMl', label: 'Company name (Malayalam)', hint: 'Used in Malayalam replies and voice notes. Leave blank to use the English name.' },
  { key: 'businessDescription', label: 'What the business does', hint: 'One sentence the assistant uses to describe you.', multiline: true },
  { key: 'servicesSummary', label: 'Services summary', hint: 'Comma separated or short paragraph.', multiline: true },
  { key: 'greetingEn', label: 'Greeting (English)', hint: 'Optional. {company} and {services} are replaced automatically.', multiline: true },
  { key: 'greetingMl', label: 'Greeting (Malayalam)', multiline: true },
  { key: 'leadThanksEn', label: 'Lead thank-you (English)', multiline: true },
  { key: 'leadThanksMl', label: 'Lead thank-you (Malayalam)', multiline: true },
]

/** Company identity the WhatsApp assistant uses — nothing is hard-coded in the bot. */
export function BrandPage() {
  const [brand, setBrand] = useState<BrandProfile | null>(null)
  const [aliases, setAliases] = useState('')
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    paAdmin
      .getSettings()
      .then((s) => {
        setBrand(s.brand ?? null)
        setAliases((s.brand?.mentionAliases ?? []).join(', '))
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
  }, [])

  async function save() {
    if (!brand) return
    setError('')
    try {
      const s = await paAdmin.patchSettings({
        brand: { ...brand, mentionAliases: aliases.split(',').map((a) => a.trim()).filter(Boolean) },
      })
      setBrand(s.brand ?? brand)
      setMsg('Saved.')
      setTimeout(() => setMsg(''), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Brand</h1>
          <p className="muted">How the assistant names and describes your company in chats, voice notes and lead messages.</p>
        </div>
      </header>
      {error ? <p className="error">{error}</p> : null}
      {!brand ? (
        <p className="muted">Loading…</p>
      ) : (
        <section className="panel" style={{ display: 'grid', gap: 12, maxWidth: 720 }}>
          {FIELDS.map((f) => (
            <label key={f.key} style={{ display: 'grid', gap: 4 }}>
              <span>{f.label}</span>
              {f.multiline ? (
                <textarea rows={3} value={String(brand[f.key] ?? '')} onChange={(e) => setBrand({ ...brand, [f.key]: e.target.value })} />
              ) : (
                <input value={String(brand[f.key] ?? '')} onChange={(e) => setBrand({ ...brand, [f.key]: e.target.value })} />
              )}
              {f.hint ? <small className="muted">{f.hint}</small> : null}
            </label>
          ))}
          <label style={{ display: 'grid', gap: 4 }}>
            <span>Group mention aliases</span>
            <input value={aliases} onChange={(e) => setAliases(e.target.value)} />
            <small className="muted">Names people use to call the bot in WhatsApp groups (comma separated).</small>
          </label>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <button type="button" onClick={() => void save()}>
              Save
            </button>
            {msg ? <span className="muted">{msg}</span> : null}
          </div>
        </section>
      )}
    </div>
  )
}
