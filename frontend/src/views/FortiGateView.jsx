import React, { useState, useEffect, useCallback } from 'react'
import { api } from '../api'

function MetricCard({ label, value, unit = '', sub = '' }) {
  return (
    <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '1rem 1.2rem' }}>
      <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 600, fontFamily: 'var(--mono)', color: 'var(--text)' }}>
        {value ?? <span style={{ color: 'var(--muted)', fontSize: 16 }}>—</span>}
        {unit && value != null && <span style={{ fontSize: 14, color: 'var(--muted)', marginLeft: 4 }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function Bar({ pct, warn = 70, crit = 90 }) {
  if (pct == null) return <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>
  const color = pct >= crit ? 'var(--c-crit)' : pct >= warn ? 'var(--c-warn)' : 'var(--c-ok)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 12, fontFamily: 'var(--mono)', color, minWidth: 36, textAlign: 'right' }}>{pct.toFixed(1)}%</span>
    </div>
  )
}

function StatusBadge({ status }) {
  const colors = { up: 'var(--c-ok)', down: 'var(--c-crit)', unknown: 'var(--muted)' }
  const color = colors[status] ?? 'var(--muted)'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontFamily: 'var(--mono)', color }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
      {status}
    </span>
  )
}

function HaBadge({ mode, peers }) {
  if (!mode || mode === 'standalone') {
    return <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>standalone</span>
  }
  return (
    <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--c-ok)' }}>
      {mode} ({peers} peer{peers !== 1 ? 's' : ''})
    </span>
  )
}

function formatBytes(bytes) {
  if (bytes == null) return '—'
  if (bytes > 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes > 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
  if (bytes > 1e3) return `${(bytes / 1e3).toFixed(1)} KB`
  return `${bytes} B`
}

function formatDuration(sec) {
  if (sec == null) return '—'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

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

export default function FortiGateView() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('vpn') // vpn | ssl | interfaces

  const load = useCallback(async () => {
    try {
      setError(null)
      const d = await api.fortigate()
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
      loading FortiGate…
    </div>
  )

  if (error) return (
    <div style={{ padding: '1.5rem' }}>
      <div style={{ background: '#fee2e2', border: '0.5px solid #fca5a5', borderRadius: 8, padding: '0.75rem 1rem', fontFamily: 'var(--mono)', fontSize: 12, color: '#991b1b' }}>
        <i className="ti ti-alert-circle" style={{ marginRight: 6 }} />
        {error}
      </div>
    </div>
  )

  if (!data || data.hostname === 'unconfigured') return (
    <div style={{ padding: '1.5rem', fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--muted)' }}>
      FortiGate not configured — add FORTIGATE_HOST and FORTIGATE_TOKEN in Settings.
    </div>
  )

  const overallColor = data.status === 'critical' ? 'var(--c-crit)' : data.status === 'warning' ? 'var(--c-warn)' : 'var(--c-ok)'

  return (
    <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <i className="ti ti-shield-lock" style={{ fontSize: 20, color: 'var(--muted)' }} aria-hidden="true" />
        <div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 15, fontWeight: 600 }}>{data.hostname}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
            {data.firmware_version} {data.serial && `· ${data.serial}`} · VDOM: {data.vdom} · HA: <HaBadge mode={data.ha_mode} peers={data.ha_peers} />
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.75rem' }}>
        <MetricCard label="CPU" value={data.cpu_pct != null ? data.cpu_pct.toFixed(1) : null} unit="%" />
        <MetricCard label="Memory" value={data.mem_pct != null ? data.mem_pct.toFixed(1) : null} unit="%" />
        <MetricCard label="Sessions" value={data.session_count?.toLocaleString() ?? null} />
        <MetricCard label="IPsec Tunnels" value={data.ipsec_tunnels_total} sub={`${data.ipsec_tunnels_up} up · ${data.ipsec_tunnels_down} down`} />
        <MetricCard label="SSL VPN Users" value={data.ssl_sessions} />
        <MetricCard label="Interfaces" value={data.interfaces?.length ?? 0} sub={`${data.interfaces?.filter(i => i.status === 'up').length ?? 0} up`} />
      </div>

      {/* CPU/Mem bars */}
      <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '1rem 1.2rem', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)', width: 60 }}>CPU</span>
          <div style={{ flex: 1 }}><Bar pct={data.cpu_pct} warn={70} crit={90} /></div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)', width: 60 }}>Memory</span>
          <div style={{ flex: 1 }}><Bar pct={data.mem_pct} warn={80} crit={95} /></div>
        </div>
      </div>

      {/* Tabs */}
      <div>
        <div style={{ display: 'flex', gap: 2, marginBottom: '0.75rem' }}>
          {[
            { id: 'vpn', label: `IPsec VPN (${data.vpn_tunnels?.length ?? 0})` },
            { id: 'ssl', label: `SSL VPN (${data.ssl_vpn_sessions?.length ?? 0})` },
            { id: 'interfaces', label: `Interfaces (${data.interfaces?.length ?? 0})` },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              background: tab === t.id ? 'var(--surface)' : 'none',
              border: `0.5px solid ${tab === t.id ? 'var(--border)' : 'transparent'}`,
              borderRadius: 6, padding: '0.35rem 0.75rem', cursor: 'pointer',
              fontFamily: 'var(--mono)', fontSize: 11, color: tab === t.id ? 'var(--text)' : 'var(--muted)',
            }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* IPsec VPN */}
        {tab === 'vpn' && (
          data.vpn_tunnels?.length === 0
            ? <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', padding: '1rem 0' }}>No IPsec tunnels configured.</div>
            : (
              <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <TH>Tunnel</TH>
                      <TH>Remote</TH>
                      <TH>Status</TH>
                      <TH align="right">RX</TH>
                      <TH align="right">TX</TH>
                    </tr>
                  </thead>
                  <tbody>
                    {data.vpn_tunnels?.map((t, i) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'var(--surface-alt, var(--surface))' }}>
                        <TD>{t.name}</TD>
                        <TD>{t.remote_ip ?? '—'}</TD>
                        <TD><StatusBadge status={t.status} /></TD>
                        <TD align="right">{formatBytes(t.incoming_bytes)}</TD>
                        <TD align="right">{formatBytes(t.outgoing_bytes)}</TD>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
        )}

        {/* SSL VPN */}
        {tab === 'ssl' && (
          data.ssl_vpn_sessions?.length === 0
            ? <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', padding: '1rem 0' }}>No active SSL VPN sessions.</div>
            : (
              <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <TH>User</TH>
                      <TH>Source IP</TH>
                      <TH>Duration</TH>
                      <TH align="right">RX</TH>
                      <TH align="right">TX</TH>
                    </tr>
                  </thead>
                  <tbody>
                    {data.ssl_vpn_sessions?.map((s, i) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'var(--surface-alt, var(--surface))' }}>
                        <TD>{s.username}</TD>
                        <TD>{s.source_ip ?? '—'}</TD>
                        <TD>{formatDuration(s.duration_sec)}</TD>
                        <TD align="right">{formatBytes(s.rx_bytes)}</TD>
                        <TD align="right">{formatBytes(s.tx_bytes)}</TD>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
        )}

        {/* Interfaces */}
        {tab === 'interfaces' && (
          data.interfaces?.length === 0
            ? <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', padding: '1rem 0' }}>No interface data available.</div>
            : (
              <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <TH>Interface</TH>
                      <TH>Alias</TH>
                      <TH>IP</TH>
                      <TH>Status</TH>
                      <TH align="right">Speed</TH>
                      <TH align="right">RX</TH>
                      <TH align="right">TX</TH>
                    </tr>
                  </thead>
                  <tbody>
                    {data.interfaces
                      ?.slice()
                      .sort((a, b) => (a.status === 'up' ? -1 : 1) - (b.status === 'up' ? -1 : 1) || a.name.localeCompare(b.name))
                      .map((iface, i) => (
                        <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'var(--surface-alt, var(--surface))' }}>
                          <TD style={{ fontWeight: 600 }}>{iface.name}</TD>
                          <TD style={{ color: 'var(--muted)' }}>{iface.alias ?? '—'}</TD>
                          <TD>{iface.ip ?? '—'}</TD>
                          <TD><StatusBadge status={iface.status} /></TD>
                          <TD align="right">{iface.speed != null ? `${iface.speed} Mbps` : '—'}</TD>
                          <TD align="right">{formatBytes(iface.rx_bytes)}</TD>
                          <TD align="right">{formatBytes(iface.tx_bytes)}</TD>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )
        )}
      </div>
    </div>
  )
}
