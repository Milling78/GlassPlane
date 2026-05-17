import React, { useState, useEffect } from 'react'
import { api } from '../api'

function statusColor(s) {
  if (s === 'ok')       return 'var(--c-ok)'
  if (s === 'warning')  return 'var(--c-warn)'
  if (s === 'critical') return 'var(--c-crit)'
  return 'var(--muted)'
}

function statusBadge(s) {
  const map = { ok: 'b-on', warning: 'b-warn', critical: 'b-crit', unknown: 'b-off' }
  return map[s] || 'b-off'
}

function ms(val) {
  return val != null ? `${val} ms` : '—'
}

const SOURCE_COLORS = {
  vCenter: { bg: 'rgba(59,130,246,0.12)',  text: '#1d4ed8' },
  Veeam:   { bg: 'rgba(34,197,94,0.12)',   text: '#15803d' },
  Alletra: { bg: 'rgba(168,85,247,0.12)',  text: '#7e22ce' },
  KACE:    { bg: 'rgba(245,158,11,0.12)',  text: '#92400e' },
  iLO:     { bg: 'rgba(239,68,68,0.12)',   text: '#991b1b' },
  Aruba:   { bg: 'rgba(20,184,166,0.12)',  text: '#0f766e' },
  manual:  { bg: 'rgba(128,128,128,0.10)', text: 'var(--muted)' },
}

function SourceBadge({ source }) {
  const c = SOURCE_COLORS[source] ?? SOURCE_COLORS.manual
  return (
    <span style={{
      fontSize: 10, fontFamily: 'var(--mono)', padding: '2px 7px', borderRadius: 10,
      background: c.bg, color: c.text, whiteSpace: 'nowrap',
    }}>{source}</span>
  )
}

export default function DNSView({ data: propData }) {
  const [data,    setData]    = useState(propData ?? null)
  const [loading, setLoading] = useState(!propData)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    if (propData) { setData(propData); return }
    setLoading(true)
    api.dns()
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [propData])

  if (loading) return (
    <div style={{ padding: '3rem', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>
      loading DNS data…
    </div>
  )

  if (error) return (
    <div style={{ padding: '2rem', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--c-crit)' }}>
      <i className="ti ti-alert-circle" style={{ marginRight: 6 }} />
      {error}
    </div>
  )

  if (!data) return null

  const { servers = [], records = [], server_count, reachable_count, failed_records, status } = data
  const usingSystemResolver = server_count === 0 && records.length > 0

  // Sort: failed first, then by source, then hostname
  const sortedRecords = [...records].sort((a, b) => {
    if (a.resolved !== b.resolved) return a.resolved ? 1 : -1
    if (a.source !== b.source) return a.source.localeCompare(b.source)
    return a.hostname.localeCompare(b.hostname)
  })

  return (
    <div>
      {/* Summary bar */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {server_count > 0 && (
          <div className="stat-card">
            <div className="stat-value">{reachable_count}/{server_count}</div>
            <div className="stat-label">Servers reachable</div>
          </div>
        )}
        <div className="stat-card">
          <div className="stat-value" style={{ color: failed_records > 0 ? 'var(--c-crit)' : 'var(--c-ok)' }}>
            {records.length - failed_records}/{records.length}
          </div>
          <div className="stat-label">Hosts resolved</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">
            <span className={`badge ${statusBadge(status)}`}>{status}</span>
          </div>
          <div className="stat-label">Overall health</div>
        </div>
        {usingSystemResolver && (
          <div className="stat-card" style={{ opacity: 0.7 }}>
            <div className="stat-value" style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>system</div>
            <div className="stat-label">Resolver</div>
          </div>
        )}
      </div>

      {usingSystemResolver && (
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)',
          marginBottom: '0.75rem', padding: '0.4rem 0.6rem',
          background: 'color-mix(in srgb, var(--border) 30%, transparent)',
          borderRadius: 6 }}>
          <i className="ti ti-info-circle" style={{ marginRight: 5 }} />
          No DNS servers configured — results are from the system resolver on this machine.
          Add DNS server IPs in Settings to test against specific servers.
        </div>
      )}

      {/* DNS servers */}
      {servers.length > 0 && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <div className="card-header">
            <div className="card-title">
              <i className="ti ti-server" style={{ color: 'var(--c-blue)' }} />
              DNS Servers
            </div>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Server</th>
                  <th>Status</th>
                  <th>Response</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {servers.map(srv => (
                  <tr key={srv.server}>
                    <td style={{ fontFamily: 'var(--mono)', fontWeight: 500 }}>{srv.server}</td>
                    <td>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--mono)', fontSize: 11, color: statusColor(srv.status) }}>
                        <i className={`ti ${srv.reachable ? 'ti-circle-check' : 'ti-circle-x'}`} />
                        {srv.reachable ? 'reachable' : 'unreachable'}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{ms(srv.response_ms)}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--c-crit)' }}>{srv.error || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Hostname resolution */}
      {sortedRecords.length > 0 && (
        <div className="card">
          <div className="card-header">
            <div className="card-title">
              <i className="ti ti-dns" style={{ color: 'var(--c-blue)' }} />
              Hostname Resolution
            </div>
            {failed_records > 0 && (
              <span className="badge b-crit">{failed_records} failed</span>
            )}
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Hostname</th>
                  <th>Resolved</th>
                  <th>Addresses</th>
                  <th>Response</th>
                </tr>
              </thead>
              <tbody>
                {sortedRecords.map(r => (
                  <tr key={r.hostname} style={{ background: !r.resolved ? 'rgba(239,68,68,0.04)' : undefined }}>
                    <td><SourceBadge source={r.source} /></td>
                    <td style={{ fontFamily: 'var(--mono)', fontWeight: 500 }}>{r.hostname}</td>
                    <td>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--mono)', fontSize: 11, color: r.resolved ? 'var(--c-ok)' : 'var(--c-crit)' }}>
                        <i className={`ti ${r.resolved ? 'ti-circle-check' : 'ti-circle-x'}`} />
                        {r.resolved ? 'yes' : r.error || 'failed'}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>
                      {r.addresses?.join(', ') || '—'}
                    </td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{ms(r.response_ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {server_count === 0 && records.length === 0 && (
        <div style={{ padding: '3rem', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>
          No integrations configured — DNS checks will appear once hosts are added in Settings.
        </div>
      )}
    </div>
  )
}
