import React, { useState } from 'react'
import { apiFetch, auth } from '../api'

export default function LoginView({ onLogin }) {
  const [key, setKey]       = useState('')
  const [show, setShow]     = useState(false)
  const [error, setError]   = useState(null)
  const [busy, setBusy]     = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!key.trim()) return
    setBusy(true)
    setError(null)
    try {
      auth.setKey(key.trim())
      await apiFetch('/auth/verify', { method: 'POST' })
      onLogin(key.trim())
    } catch (err) {
      auth.clearKey()
      setError(err.message === 'Unauthorized' ? 'Invalid API key.' : `Connection failed: ${err.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', background: 'var(--bg)',
    }}>
      <form onSubmit={handleSubmit} style={{
        background: 'var(--surface)', border: '0.5px solid var(--border)',
        borderRadius: 12, padding: '2rem 2.5rem', width: 360,
        display: 'flex', flexDirection: 'column', gap: '1.25rem',
      }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 16, color: 'var(--text)', marginBottom: 4 }}>
            Infra Glassplane
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
            Enter your Glassplane API key to connect to the local backend service
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
            API Key
          </label>
          <div style={{ position: 'relative', display: 'flex' }}>
            <input
              type={show ? 'text' : 'password'}
              value={key}
              onChange={e => setKey(e.target.value)}
              autoFocus
              placeholder="glassplane-…"
              style={{
                flex: 1, background: 'var(--bg)', border: '0.5px solid var(--border)',
                borderRadius: 6, padding: '0.5rem 2.5rem 0.5rem 0.75rem',
                color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 13,
                outline: 'none',
              }}
            />
            <button
              type="button"
              onClick={() => setShow(s => !s)}
              style={{
                position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--muted)', padding: 0, fontSize: 14,
              }}
              aria-label={show ? 'Hide key' : 'Show key'}
            >
              <i className={`ti ${show ? 'ti-eye-off' : 'ti-eye'}`} aria-hidden="true" />
            </button>
          </div>
        </div>

        {error && (
          <div style={{
            background: '#fee2e2', border: '0.5px solid #fca5a5', borderRadius: 6,
            padding: '0.5rem 0.75rem', fontSize: 12, color: '#991b1b',
            fontFamily: 'var(--mono)',
          }}>
            <i className="ti ti-alert-circle" style={{ marginRight: 6 }} aria-hidden="true" />
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy || !key.trim()}
          style={{
            background: busy || !key.trim() ? 'var(--border)' : 'var(--accent)',
            color: 'var(--text)', border: 'none', borderRadius: 6,
            padding: '0.6rem 1rem', fontFamily: 'var(--mono)', fontSize: 13,
            cursor: busy || !key.trim() ? 'not-allowed' : 'pointer',
            transition: 'background 0.15s',
          }}
        >
          {busy ? 'Connecting…' : 'Connect'}
        </button>
      </form>
    </div>
  )
}
