import React, { useState, useEffect, useCallback } from 'react'
import { api } from '../api'

const TH = ({ children, align = 'left' }) => (
  <th style={{ padding: '0.45rem 0.75rem', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, textAlign: align, borderBottom: '0.5px solid var(--border)', whiteSpace: 'nowrap' }}>
    {children}
  </th>
)
const TD = ({ children, align = 'left', style = {} }) => (
  <td style={{ padding: '0.55rem 0.75rem', fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--text)', textAlign: align, borderBottom: '0.5px solid var(--border)', ...style }}>
    {children}
  </td>
)

function MetricCard({ label, value, unit = '', sub = '', warn = false, crit = false }) {
  const color = crit ? 'var(--c-crit)' : warn ? 'var(--c-warn)' : 'var(--text)'
  return (
    <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '1rem 1.2rem' }}>
      <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 600, fontFamily: 'var(--mono)', color }}>
        {value ?? <span style={{ color: 'var(--muted)', fontSize: 16 }}>—</span>}
        {unit && value != null && <span style={{ fontSize: 14, color: 'var(--muted)', marginLeft: 4 }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function Bar({ pct, warn = 80, crit = 90 }) {
  if (pct == null) return <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>
  const color = pct >= crit ? 'var(--c-crit)' : pct >= warn ? 'var(--c-warn)' : 'var(--c-ok)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 12, fontFamily: 'var(--mono)', color, minWidth: 40, textAlign: 'right' }}>{pct.toFixed(1)}%</span>
    </div>
  )
}

function ConnBadge({ status }) {
  const map = { up: ['var(--c-ok)', '●'], down: ['var(--c-crit)', '●'], unknown: ['var(--muted)', '○'] }
  const [color, dot] = map[status] ?? map.unknown
  return <span style={{ color, fontFamily: 'var(--mono)', fontSize: 11 }}>{dot} {status}</span>
}

export default function FortiAnalyzerView() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      setError(null)
      const d = await api.fortianalyzer()
      setData(d)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return (
    <div style={{ padding: '3rem', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--muted)' }}>
      loading FortiAnalyzer…
    </div>
  )

  if (error) return (
    <div style={{ padding: '1.5rem' }}>
      <div style={{ background: '#fee2e2', border: '0.5px solid #fca5a5', borderRadius: 8, padding: '0.75rem 1rem', fontFamily: 'var(--mono)', fontSize: 12, color: '#991b1b' }}>
        <i className="ti ti-alert-circle" style={{ marginRight: 6 }} />{error}
      </div>
    </div>
  )

  if (!data || data.hostname === 'unconfigured') return (
    <div style={{ padding: '1.5rem', fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--muted)' }}>
      FortiAnalyzer not configured — add FORTIANALYZER_HOST and credentials in Settings.
    </div>
  )

  const overallColor = data.status === 'critical' ? 'var(--c-crit)' : data.status === 'warning' ? 'var(--c-warn)' : 'var(--c-ok)'

  return (
    <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <i className="ti ti-chart-bar" style={{ fontSize: 20, color: 'var(--muted)' }} aria-hidden="true" />
        <div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 15, fontWeight: 600 }}>{data.hostname}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
            {data.version} {data.serial && `· ${data.serial}`} · ADOM: {data.adom}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 11, fontFamily: 'var(--mono)', color: overallColor, textTransform: 'uppercase', fontWeight: 700 }}>
          {data.status}
        </div>
        <button onClick={load} style={{ background: 'none', border: '0.5px solid var(--border)', borderRadius: 6, padding: '0.3rem 0.6rem', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>
          <i className="ti ti-refresh" aria-hidden="true" /> refresh
        </button>
      </div>

      {/* Metric cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.75rem' }}>
        <MetricCard label="Managed Devices" value={data.device_count}
          sub={`${data.devices_up} up · ${data.devices_down} down`}
          warn={data.devices_down > 0} />
        <MetricCard label="Disk Used" value={data.disk_pct != null ? data.disk_pct.toFixed(1) : null} unit="%"
          sub={data.disk_used_gb != null ? `${data.disk_used_gb} GB / ${data.disk_total_gb} GB` : ''}
          warn={data.disk_pct > 80} crit={data.disk_pct > 90} />
        <MetricCard label="CPU" value={data.cpu_pct != null ? data.cpu_pct.toFixed(1) : null} unit="%" />
        <MetricCard label="Memory" value={data.mem_pct != null ? data.mem_pct.toFixed(1) : null} unit="%" />
      </div>

      {/* Utilisation bars */}
      <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '1rem 1.2rem', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {[
          { label: 'Disk', pct: data.disk_pct, warn: 80, crit: 90 },
          { label: 'CPU',  pct: data.cpu_pct,  warn: 70, crit: 90 },
          { label: 'Mem',  pct: data.mem_pct,  warn: 80, crit: 95 },
        ].map(({ label, pct, warn, crit }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)', width: 40 }}>{label}</span>
            <div style={{ flex: 1 }}><Bar pct={pct} warn={warn} crit={crit} /></div>
          </div>
        ))}
      </div>

      {/* Devices table */}
      {data.devices?.length === 0
        ? <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>
            No devices found in ADOM "{data.adom}". Check ADOM name in Settings.
          </div>
        : (
          <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ padding: '0.75rem 1rem', fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.8, borderBottom: '0.5px solid var(--border)' }}>
              Managed Devices ({data.devices?.length ?? 0})
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <TH>Device</TH>
                  <TH>IP</TH>
                  <TH>Platform</TH>
                  <TH>OS Version</TH>
                  <TH>ADOM</TH>
                  <TH>Connection</TH>
                </tr>
              </thead>
              <tbody>
                {data.devices
                  ?.slice()
                  .sort((a, b) => (a.connection_status === 'down' ? -1 : 1) - (b.connection_status === 'down' ? -1 : 1) || a.name.localeCompare(b.name))
                  .map((d, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'var(--surface-alt, var(--surface))' }}>
                      <TD style={{ fontWeight: 600 }}>{d.name}</TD>
                      <TD style={{ color: 'var(--muted)' }}>{d.ip ?? '—'}</TD>
                      <TD style={{ color: 'var(--muted)' }}>{d.platform || '—'}</TD>
                      <TD style={{ color: 'var(--muted)' }}>{d.os_version || '—'}</TD>
                      <TD style={{ color: 'var(--muted)' }}>{d.adom || '—'}</TD>
                      <TD><ConnBadge status={d.connection_status} /></TD>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  )
}
