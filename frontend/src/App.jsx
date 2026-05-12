import React, { useState, useEffect, useCallback } from 'react'
import { api, auth } from './api'
import LoginView from './views/LoginView'
import GlassplaneView from './views/GlassplaneView'
import VMsView from './views/VMsView'
import ArubaView from './views/ArubaView'
import AlletraView from './views/AlletraView'
import VeeamView from './views/VeeamView'
import SettingsView from './views/SettingsView'

import SurgeView from './views/SurgeView'

const NAV = [
  { id: 'summary',  label: 'Overview',      icon: 'ti-layout-dashboard' },
  { id: 'vms',      label: 'VMs',            icon: 'ti-server-2' },
  { id: 'surges',   label: 'Surge Alerts',   icon: 'ti-wave-sine' },
  { id: 'aruba',    label: 'Networking',     icon: 'ti-network' },
  { id: 'alletra',  label: 'Storage',        icon: 'ti-database' },
  { id: 'veeam',    label: 'Backups',        icon: 'ti-cloud-upload' },
]

function StatusDot({ status }) {
  const cls = { ok: 'dot-ok', warning: 'dot-warn', critical: 'dot-crit' }
  return <span className={`dot ${cls[status] ?? 'dot-off'}`} />
}

export default function App() {
  const [apiKey, setApiKey] = useState(() => auth.getKey())
  const [view, setView] = useState('summary')
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    function onUnauthorized() {
      auth.clearKey()
      setApiKey('')
    }
    window.addEventListener('glassplane:unauthorized', onUnauthorized)
    return () => window.removeEventListener('glassplane:unauthorized', onUnauthorized)
  }, [])

  if (!apiKey) {
    return <LoginView onLogin={key => setApiKey(key)} />
  }

  const refresh = useCallback(async () => {
    try {
      setError(null)
      const data = await api.summary()
      setSummary(data)
      setLastRefresh(new Date())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => {
    const t = setInterval(refresh, 60_000)
    return () => clearInterval(t)
  }, [refresh])

  const subsystemStatus = {
    vms:     summary?.vcenter ? 'ok' : 'unknown',
    aruba:   summary?.aruba?.status,
    alletra: summary?.alletra?.status,
    veeam:   summary?.veeam?.status,
  }

  return (
    <>
      <div className="titlebar">
        <span style={{ fontWeight: 500, color: 'var(--text)' }}>Infra Glassplane</span>
        {lastRefresh && (
          <span style={{ marginLeft: 'auto' }}>
            {lastRefresh.toLocaleTimeString()}
          </span>
        )}
      </div>

      <div className="app-layout">
        <nav className="sidebar">
          <div className="nav-section">views</div>
          {NAV.map(n => (
            <button
              key={n.id}
              className={`nav-item ${view === n.id ? 'active' : ''}`}
              onClick={() => setView(n.id)}
            >
              <i className={`ti ${n.icon}`} aria-hidden="true" />
              {n.label}
              {n.id !== 'summary' && subsystemStatus[n.id] && (
                <StatusDot status={subsystemStatus[n.id]} />
              )}
            </button>
          ))}
          <div className="nav-section" style={{ marginTop: 'auto' }}>config</div>
          <button
            className={`nav-item ${view === 'settings' ? 'active' : ''}`}
            onClick={() => setView('settings')}
          >
            <i className="ti ti-settings" aria-hidden="true" />
            Settings
          </button>
          {window.glassplane?.isElectron && (
            <button
              className="nav-item"
              onClick={() => window.glassplane.openEnvFile()}
            >
              <i className="ti ti-file-settings" aria-hidden="true" />
              Edit .env
            </button>
          )}
          <button className="nav-item" onClick={refresh}>
            <i className="ti ti-refresh" aria-hidden="true" />
            Refresh
          </button>
          {auth.getKey() && (
            <button
              className="nav-item"
              onClick={() => { auth.clearKey(); setApiKey('') }}
            >
              <i className="ti ti-logout" aria-hidden="true" />
              Logout
            </button>
          )}
        </nav>

        <main className="main-content">
          {error && (
            <div style={{
              background: '#fee2e2', border: '0.5px solid #fca5a5',
              borderRadius: 8, padding: '0.75rem 1rem',
              fontFamily: 'var(--mono)', fontSize: 12,
              color: '#991b1b', marginBottom: '1rem'
            }}>
              <i className="ti ti-alert-circle" style={{ marginRight: 6 }} aria-hidden="true" />
              {error}
            </div>
          )}
          {loading && !summary
            ? <div style={{ padding: '3rem', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--muted)' }}>
                connecting to backend…
              </div>
            : <>
                {view === 'summary'  && <GlassplaneView data={summary} onNavigate={setView} />}
                {view === 'vms'      && <VMsView vcenter={summary?.vcenter} />}
                {view === 'surges'   && <SurgeView />}
                {view === 'aruba'    && <ArubaView data={summary?.aruba} />}
                {view === 'alletra'  && <AlletraView data={summary?.alletra} />}
                {view === 'veeam'    && <VeeamView data={summary?.veeam} />}
                {view === 'settings' && <SettingsView />}
              </>
          }
        </main>
      </div>
    </>
  )
}
