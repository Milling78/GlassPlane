import React, { useState, useEffect } from 'react'
import { api } from '../api'

function statusColor(status) {
  if (status === 'critical') return 'var(--c-crit)'
  if (status === 'warning')  return 'var(--c-warn)'
  return 'var(--c-green)'
}

function DaysBar({ days, warnDays = 30, critDays = 14 }) {
  const max = Math.max(days, 365)
  const pct = Math.min(100, (days / max) * 100)
  const color = days <= critDays ? 'var(--c-crit)' : days <= warnDays ? 'var(--c-warn)' : 'var(--c-green)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 5, background: 'var(--bg)', borderRadius: 3, overflow: 'hidden', border: '0.5px solid var(--border)' }}>
        <div style={{ width: pct + '%', height: '100%', background: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color, minWidth: 40, textAlign: 'right' }}>
        {days}d
      </span>
    </div>
  )
}

function SansList({ sans }) {
  const [expanded, setExpanded] = useState(false)
  if (!sans?.length) return <span style={{ color: 'var(--muted)' }}>—</span>
  const visible = expanded ? sans : sans.slice(0, 3)
  return (
    <div style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
      {visible.map((s, i) => (
        <div key={i} style={{ color: 'var(--muted)' }}>{s}</div>
      ))}
      {sans.length > 3 && (
        <button
          onClick={() => setExpanded(e => !e)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-blue)', fontSize: 11, padding: 0, marginTop: 2 }}
        >
          {expanded ? 'show less' : `+${sans.length - 3} more`}
        </button>
      )}
    </div>
  )
}

export default function CertsView({ certsSummary }) {
  const [data, setData]       = useState(certsSummary ?? null)
  const [loading, setLoading] = useState(!certsSummary)
  const [error, setError]     = useState(null)

  useEffect(() => {
    if (certsSummary) { setData(certsSummary); setLoading(false); return }
    api.certs()
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [certsSummary])

  if (loading) return (
    <div style={{ padding: '3rem', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--muted)' }}>
      checking certificates…
    </div>
  )

  if (error) return (
    <div style={{ padding: '3rem', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--c-crit)' }}>
      {error}
    </div>
  )

  if (!data?.total) return (
    <div style={{ padding: '3rem', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--muted)' }}>
      no certificate hosts configured — add CERT_HOSTS in Settings
    </div>
  )

  return (
    <div>
      {/* Summary metrics */}
      <div className="metrics" style={{ marginBottom: '1rem' }}>
        <div className="metric">
          <div className="metric-label">Certificates</div>
          <div className="metric-val">{data.total}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Valid</div>
          <div className="metric-val" style={{ color: 'var(--c-green)' }}>{data.ok_count}</div>
        </div>
        {data.warn_count > 0 && (
          <div className="metric">
            <div className="metric-label">Expiring soon</div>
            <div className="metric-val" style={{ color: 'var(--c-warn)' }}>{data.warn_count}</div>
          </div>
        )}
        {data.crit_count > 0 && (
          <div className="metric">
            <div className="metric-label">Critical / expired</div>
            <div className="metric-val" style={{ color: 'var(--c-crit)' }}>{data.crit_count}</div>
          </div>
        )}
      </div>

      {/* Certificate table */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">
            <i className="ti ti-certificate" style={{ color: 'var(--c-blue)' }} aria-hidden="true" />
            TLS Certificate Inventory
          </div>
          <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>
            sorted by days remaining
          </span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--mono)', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--muted)', textAlign: 'left' }}>
                <th style={{ padding: '8px 10px', fontWeight: 400 }}>Host</th>
                <th style={{ padding: '8px 10px', fontWeight: 400 }}>CN</th>
                <th style={{ padding: '8px 10px', fontWeight: 400 }}>SANs</th>
                <th style={{ padding: '8px 10px', fontWeight: 400 }}>Issuer</th>
                <th style={{ padding: '8px 10px', fontWeight: 400 }}>Expires</th>
                <th style={{ padding: '8px 10px', fontWeight: 400, minWidth: 150 }}>Days remaining</th>
              </tr>
            </thead>
            <tbody>
              {data.hosts.map((h, i) => (
                <tr key={i} style={{ borderBottom: '0.5px solid var(--border)' }}>
                  <td style={{ padding: '7px 10px' }}>
                    <span style={{ color: 'var(--text)' }}>{h.host}</span>
                    {h.port !== 443 && (
                      <span style={{ marginLeft: 4, color: 'var(--muted)', fontSize: 10 }}>:{h.port}</span>
                    )}
                  </td>
                  <td style={{ padding: '7px 10px', color: h.error ? 'var(--c-crit)' : 'var(--text)' }}>
                    {h.error ? <span title={h.error} style={{ cursor: 'help' }}>error ⚠</span> : (h.cn || '—')}
                  </td>
                  <td style={{ padding: '7px 10px' }}>
                    <SansList sans={h.sans} />
                  </td>
                  <td style={{ padding: '7px 10px', color: 'var(--muted)' }}>{h.issuer || '—'}</td>
                  <td style={{ padding: '7px 10px', color: 'var(--muted)' }}>
                    {h.not_after ? h.not_after.slice(0, 10) : '—'}
                  </td>
                  <td style={{ padding: '7px 10px', minWidth: 150 }}>
                    {h.error
                      ? <span style={{ color: 'var(--c-crit)' }}>unreachable</span>
                      : <DaysBar days={h.days_remaining} />
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
