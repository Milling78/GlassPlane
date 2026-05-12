import React, { useState, useEffect } from 'react'
import { api, getBaseUrl } from '../api'

export default function SettingsView() {
  const [baseUrl, setBaseUrl] = useState('')
  const [health, setHealth] = useState(null)
  const isElectron = !!window.glassplane?.isElectron

  useEffect(() => {
    getBaseUrl().then(u => setBaseUrl(u || 'http://localhost:8000 (proxied)'))
    fetch((baseUrl || '') + '/health').then(r => r.json()).then(setHealth).catch(() => setHealth(null))
  }, [])

  return (
    <div style={{ maxWidth: 560 }}>
      <h2 style={{ fontSize: 18, fontWeight: 500, marginBottom: '1.5rem' }}>Settings</h2>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="card-header">
          <div className="card-title">
            <i className="ti ti-plug" style={{ color: 'var(--c-blue)' }} aria-hidden="true" />
            Backend connection
          </div>
          <span className={`badge ${health ? 'b-on' : 'b-off'}`}>{health ? 'connected' : 'unreachable'}</span>
        </div>
        <div className="card-body" style={{ fontFamily: 'var(--mono)', fontSize: 13 }}>
          <div style={{ color: 'var(--muted)', marginBottom: 4 }}>API base URL</div>
          <div>{baseUrl}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="card-header">
          <div className="card-title">
            <i className="ti ti-file-settings" style={{ color: 'var(--c-blue)' }} aria-hidden="true" />
            Credentials (.env)
          </div>
        </div>
        <div className="card-body" style={{ fontSize: 13 }}>
          <p style={{ color: 'var(--muted)', marginBottom: '0.75rem', lineHeight: 1.6 }}>
            All credentials are stored in a plain <code style={{ fontFamily: 'var(--mono)', background: 'var(--bg)', padding: '1px 4px', borderRadius: 4 }}>.env</code> file
            read by the backend at startup. Restart the app after editing.
          </p>
          {isElectron
            ? <button onClick={() => window.glassplane.openEnvFile()}>
                <i className="ti ti-external-link" style={{ marginRight: 6 }} aria-hidden="true" />
                Open .env in editor
              </button>
            : <p style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>
                Edit <code>backend/.env</code> directly, then restart the server.
              </p>
          }
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">
            <i className="ti ti-info-circle" style={{ color: 'var(--c-blue)' }} aria-hidden="true" />
            About
          </div>
        </div>
        <div className="card-body" style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', lineHeight: 2 }}>
          <div>Infra Glassplane v1.0.0</div>
          <div>Backend: FastAPI + pyVmomi + httpx</div>
          <div>Frontend: React + Vite{isElectron ? ' + Electron' : ''}</div>
          <div>No AI runtime dependency</div>
        </div>
      </div>
    </div>
  )
}
