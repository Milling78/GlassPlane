import React, { useState, useEffect } from 'react'
import { api } from '../api'
import Sparkline from '../components/Sparkline'

const HEALTH_COLOR = { ok: 'var(--c-green)', warning: 'var(--c-warn)', critical: 'var(--c-crit)', unknown: 'var(--muted)' }
const HEALTH_ICON  = { ok: 'ti-circle-check', warning: 'ti-alert-triangle', critical: 'ti-alert-octagon', unknown: 'ti-question-mark' }

function HealthBadge({ health }) {
  const key = health.toLowerCase()
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontFamily: 'var(--mono)', fontWeight: 600, color: HEALTH_COLOR[key] ?? 'var(--muted)' }}>
      <i className={`ti ${HEALTH_ICON[key] ?? 'ti-question-mark'}`} aria-hidden="true" />
      {health}
    </span>
  )
}

function TempCell({ label, value, warnAt = 65, critAt = 80 }) {
  if (value == null) return null
  const color = value >= critAt ? 'var(--c-crit)' : value >= warnAt ? 'var(--c-warn)' : 'var(--c-green)'
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
      <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 600, color, fontFamily: 'var(--mono)' }}>{value}°C</span>
    </div>
  )
}

function PowerBar({ watts, capWatts }) {
  if (watts == null) return <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>—</span>
  const pct   = capWatts ? Math.min(100, (watts / capWatts) * 100) : null
  const color = pct != null ? (pct > 90 ? 'var(--c-crit)' : pct > 75 ? 'var(--c-warn)' : 'var(--c-blue)') : 'var(--c-blue)'
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)', marginBottom: 4 }}>
        <span>{watts} W</span>
        {capWatts && <span>{Math.round(pct)}% of {capWatts} W cap</span>}
      </div>
      {capWatts && (
        <div style={{ height: 6, background: 'var(--bg)', borderRadius: 3, overflow: 'hidden', border: '0.5px solid var(--border)' }}>
          <div style={{ width: pct + '%', height: '100%', background: color, borderRadius: 3 }} />
        </div>
      )}
    </div>
  )
}

function HostCard({ host, history }) {
  const powerHistory = history.map(p => p.ilo_total_power_w)

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Card header */}
      <div className="card-header">
        <div className="card-title" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 13 }}>{host.hostname}</span>
          {host.model && (
            <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>{host.model}{host.serial ? ` · ${host.serial}` : ''}</span>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <HealthBadge health={host.health} />
          <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
            {host.power_state === 'On' ? '● on' : host.power_state === 'Off' ? '○ off' : '? unknown'}
          </span>
        </div>
      </div>

      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Power */}
        <div>
          <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Power</div>
          <PowerBar watts={host.power_watts} capWatts={host.power_cap_watts} />
        </div>

        {/* Thermal */}
        {(host.cpu_temp_c != null || host.ambient_temp_c != null) && (
          <div>
            <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Thermal</div>
            <div style={{ display: 'flex', gap: 16, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <TempCell label="CPU" value={host.cpu_temp_c} warnAt={65} critAt={80} />
              <TempCell label="Inlet" value={host.ambient_temp_c} warnAt={30} critAt={40} />
              <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: host.fan_status === 'OK' ? 'var(--c-green)' : host.fan_status === 'Warning' ? 'var(--c-warn)' : 'var(--c-crit)' }}>
                <i className="ti ti-propeller" style={{ marginRight: 3 }} aria-hidden="true" />fans {host.fan_status.toLowerCase()}
              </span>
            </div>
          </div>
        )}

        {/* IML errors */}
        {host.recent_errors.length > 0 && (
          <div>
            <div style={{ fontSize: 10, color: 'var(--c-crit)', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>
              <i className="ti ti-alert-octagon" style={{ marginRight: 4 }} aria-hidden="true" />IML errors
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {host.recent_errors.map((msg, i) => (
                <div key={i} style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)', lineHeight: 1.4 }}>{msg}</div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function HostsView({ data, history = [] }) {
  const [localData, setLocalData]   = useState(data)
  const [loading,   setLoading]     = useState(!data)

  useEffect(() => {
    if (data) { setLocalData(data); return }
    setLoading(true)
    api.ilo().then(d => { setLocalData(d); setLoading(false) }).catch(() => setLoading(false))
  }, [data])

  if (loading) return (
    <div style={{ padding: '3rem', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--muted)' }}>
      connecting to iLO hosts…
    </div>
  )

  if (!localData) return (
    <div style={{ padding: '3rem', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--muted)' }}>
      no iLO data — configure ILO_HOSTS in Settings
    </div>
  )

  const { hosts, total_power_watts, host_count, error_count } = localData
  const powerHistory = history.filter(p => p.ilo_total_power_w != null)

  return (
    <div>
      {/* Summary */}
      <div className="metrics" style={{ marginBottom: '1rem' }}>
        <div className="metric">
          <div className="metric-label">hosts</div>
          <div className="metric-val">{host_count}</div>
        </div>
        <div className="metric">
          <div className="metric-label">total power</div>
          <div className="metric-val">{total_power_watts} W</div>
        </div>
        <div className="metric">
          <div className="metric-label">IML errors</div>
          <div className="metric-val" style={{ color: error_count > 0 ? 'var(--c-crit)' : undefined }}>{error_count}</div>
        </div>
        {powerHistory.length > 1 && (
          <div className="metric" style={{ flex: 2 }}>
            <div className="metric-label">power trend · 24h</div>
            <div style={{ marginTop: 4 }}>
              <Sparkline data={powerHistory.map(p => p.ilo_total_power_w)} color="var(--c-blue)" height={28} />
            </div>
          </div>
        )}
      </div>

      {/* Host cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
        {hosts.map(host => (
          <HostCard key={host.hostname} host={host} history={history} />
        ))}
      </div>
    </div>
  )
}
