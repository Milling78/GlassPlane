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

export default function DNSView({ data: propData }) {
  const [data,    setData]    = useState(propData ?? null)
  const [loading, setLoading] = useState(!propData)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    if (propData) { setData(propData); return }
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

  return (
    <div>
      {/* Summary bar */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <div className="stat-card">
          <div className="stat-value">{reachable_count}/{server_count}</div>
          <div className="stat-label">Servers reachable</div>
        </div>
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
      </div>

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

      {/* Hostname resolution checks */}
      {records.length > 0 && (
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
                  <th>Hostname</th>
                  <th>Resolved</th>
                  <th>Addresses</th>
                  <th>Response</th>
                </tr>
              </thead>
              <tbody>
                {records.map(r => (
                  <tr key={r.hostname}>
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

      {servers.length === 0 && records.length === 0 && (
        <div style={{ padding: '3rem', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>
          No DNS servers configured — add them in Settings.
        </div>
      )}
    </div>
  )
}
