import React, { useState, useEffect, useCallback } from 'react'
import { api, auth, getBaseUrl } from './api'
import LoginView from './views/LoginView'
import SetupView from './views/SetupView'
import GlassplaneView from './views/GlassplaneView'
import VMsView from './views/VMsView'
import ArubaView from './views/ArubaView'
import AlletraView from './views/AlletraView'
import VeeamView from './views/VeeamView'
import SettingsView from './views/SettingsView'
import AlertsView from './views/AlertsView'
import HostsView from './views/HostsView'
import SurgeView from './views/SurgeView'
import EfficiencyView from './views/EfficiencyView'
import SnapshotsView from './views/SnapshotsView'
import DNSView from './views/DNSView'
import LogsView from './views/LogsView'

const NAV = [
  { id: 'summary',    label: 'Overview',     icon: 'ti-layout-dashboard' },
  { id: 'vms',        label: 'VMs',          icon: 'ti-server-2' },
  { id: 'surges',     label: 'Surge Alerts', icon: 'ti-wave-sine' },
  { id: 'snapshots',  label: 'Snapshots',    icon: 'ti-camera' },
  { id: 'aruba',      label: 'Networking',   icon: 'ti-network' },
  { id: 'alletra',    label: 'Storage',      icon: 'ti-database' },
  { id: 'veeam',      label: 'Backups',      icon: 'ti-cloud-upload' },
  { id: 'hosts',      label: 'Hosts / iLO',  icon: 'ti-cpu' },
  { id: 'dns',        label: 'DNS',          icon: 'ti-world-www' },
  { id: 'efficiency', label: 'Perf/Watt',    icon: 'ti-bolt' },
  { id: 'alerts',     label: 'Alerts',       icon: 'ti-bell' },
  { id: 'logs',       label: 'Logs',         icon: 'ti-terminal-2' },
]

function StatusDot({ status }) {
  const cls = { ok: 'dot-ok', warning: 'dot-warn', critical: 'dot-crit' }
  return <span className={`dot ${cls[status] ?? 'dot-off'}`} />
}

export default function App() {
  const [setupNeeded, setSetupNeeded] = useState(null) // null=checking, true=show setup, false=skip
  const [apiKey, setApiKey] = useState(() => auth.getKey())
  const [view, setView] = useState('summary')
  const [summary, setSummary] = useState(null)
  const [history, setHistory] = useState([])
  const [iloSummary,  setIloSummary]  = useState(null)
  const [dnsSummary,  setDnsSummary]  = useState(null)
  const [forecast, setForecast] = useState(null)
  const [activeAlertCount, setActiveAlertCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function checkSetup() {
      try {
        const base = await getBaseUrl()
        const res = await fetch(`${base}/setup/status`, { signal: AbortSignal.timeout(5000) })
        const data = await res.json()
        setSetupNeeded(data.needs_setup)
      } catch {
        setSetupNeeded(false) // backend unreachable — skip setup gate
      }
    }
    checkSetup()
  }, [])

  useEffect(() => {
    function onUnauthorized() {
      auth.clearKey()
      setApiKey('')
    }
    window.addEventListener('glassplane:unauthorized', onUnauthorized)
    return () => window.removeEventListener('glassplane:unauthorized', onUnauthorized)
  }, [])

  const ready = setupNeeded === false && !!apiKey

  const refresh = useCallback(async () => {
    if (!ready) return
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
  }, [ready])

  const refreshHistory = useCallback(async () => {
    if (!ready) return
    try {
      const d = await api.history(24)
      setHistory(d.points ?? [])
    } catch {
      // history is best-effort
    }
  }, [ready])

  const refreshIlo = useCallback(async () => {
    if (!ready) return
    try {
      const d = await api.ilo()
      setIloSummary(d)
    } catch {
      // iLO is optional — no hosts configured is normal
    }
  }, [ready])

  const refreshDns = useCallback(async () => {
    if (!ready) return
    try {
      const d = await api.dns()
      setDnsSummary(d)
    } catch {
      // DNS is optional — no servers configured is normal
    }
  }, [ready])

  const refreshAlertCount = useCallback(async () => {
    if (!ready) return
    try {
      const s = await api.alertStatus()
      setActiveAlertCount(s.active_count ?? 0)
    } catch {
      // best-effort
    }
  }, [ready])

  const refreshForecast = useCallback(async () => {
    if (!ready) return
    try {
      const d = await api.forecast()
      setForecast(d)
    } catch {
      // best-effort
    }
  }, [ready])

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => { refreshHistory() }, [refreshHistory])
  useEffect(() => { refreshIlo() }, [refreshIlo])
  useEffect(() => { refreshDns() }, [refreshDns])
  useEffect(() => { refreshAlertCount() }, [refreshAlertCount])
  useEffect(() => { refreshForecast() }, [refreshForecast])
  useEffect(() => {
    if (!ready) return
    const t = setInterval(refresh, 60_000)
    return () => clearInterval(t)
  }, [refresh, ready])
  useEffect(() => {
    if (!ready) return
    const t = setInterval(refreshHistory, 900_000) // 15 min
    return () => clearInterval(t)
  }, [refreshHistory, ready])
  useEffect(() => {
    if (!ready) return
    const t = setInterval(refreshAlertCount, 60_000)
    return () => clearInterval(t)
  }, [refreshAlertCount, ready])
  useEffect(() => {
    if (!ready) return
    const t = setInterval(refreshForecast, 900_000) // 15 min — matches snapshot cadence
    return () => clearInterval(t)
  }, [refreshForecast, ready])
  useEffect(() => {
    if (!ready) return
    const t = setInterval(refreshDns, 60_000)
    return () => clearInterval(t)
  }, [refreshDns, ready])
  useEffect(() => {
    if (!ready) return
    const t = setInterval(refreshIlo, 120_000)
    return () => clearInterval(t)
  }, [refreshIlo, ready])

  // ── Gates (all hooks above this line) ─────────────────────────────────────

  if (setupNeeded === null) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg)', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>
        starting…
      </div>
    )
  }

  if (setupNeeded) {
    return <SetupView onComplete={() => setSetupNeeded(false)} />
  }

  if (!apiKey) {
    return <LoginView onLogin={key => setApiKey(key)} />
  }

  const subsystemStatus = {
    vms:     summary?.vcenter ? 'ok' : 'unknown',
    aruba:   summary?.aruba?.status,
    alletra: summary?.alletra?.status,
    veeam:   summary?.veeam?.status,
    dns:     dnsSummary?.status,
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
              {n.id === 'alerts' && activeAlertCount > 0 && (
                <span style={{
                  marginLeft: 'auto', fontSize: 10, fontWeight: 700,
                  background: 'var(--c-crit)', color: '#fff',
                  borderRadius: 10, padding: '1px 6px', lineHeight: 1.4,
                }}>{activeAlertCount}</span>
              )}
              {n.id !== 'summary' && n.id !== 'alerts' && subsystemStatus[n.id] && (
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
                {view === 'summary'  && <GlassplaneView data={summary} history={history} iloSummary={iloSummary} forecast={forecast} onNavigate={setView} />}
                {view === 'vms'      && <VMsView vcenter={summary?.vcenter} />}
                {view === 'surges'    && <SurgeView />}
                {view === 'snapshots' && <SnapshotsView />}
                {view === 'aruba'    && <ArubaView data={summary?.aruba} />}
                {view === 'alletra'  && <AlletraView data={summary?.alletra} />}
                {view === 'veeam'    && <VeeamView data={summary?.veeam} />}
                {view === 'hosts'      && <HostsView data={iloSummary} history={history} />}
                {view === 'dns'        && <DNSView data={dnsSummary} />}
                {view === 'efficiency' && <EfficiencyView iloSummary={iloSummary} />}
                {view === 'alerts'     && <AlertsView />}
                {view === 'logs'       && <LogsView />}
                {view === 'settings' && <SettingsView />}
              </>
          }
        </main>
      </div>
    </>
  )
}
