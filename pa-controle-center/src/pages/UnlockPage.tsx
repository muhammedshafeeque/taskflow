import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import {
  clearStoredSecret,
  getStoredSecret,
  paAdmin,
  setStoredSecret,
} from '../api/paAdmin'

export function UnlockPage() {
  const navigate = useNavigate()
  const existing = getStoredSecret()
  const [secret, setSecret] = useState(existing)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (existing) {
    return <Navigate to="/" replace />
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    setStoredSecret(secret)
    try {
      await paAdmin.status()
      navigate('/', { replace: true })
    } catch (err) {
      clearStoredSecret()
      setError(err instanceof Error ? err.message : 'Unlock failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="unlock">
      <form className="unlock-card" onSubmit={onSubmit}>
        <p className="eyebrow">Ivorix PA</p>
        <h1>Control Center</h1>
        <p className="muted">Enter the PA admin secret to continue.</p>
        <label>
          Admin secret
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            autoFocus
            required
          />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <button type="submit" disabled={loading}>
          {loading ? 'Checking…' : 'Unlock'}
        </button>
      </form>
    </div>
  )
}
