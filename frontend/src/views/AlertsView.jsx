import React, { useState, useEffect, useCallback } from 'react'
import { api } from '../api'

const SEV_COLOR = {
  critical: 'var(--c-crit)',
  warning:  'var(--c-warn)',
  info:     'var(--c-blue)',
  ok:       'var(--c-green)',
}

const SEV_ICON = {
  critical: 'ti-alert-octagon',
  warning:  'ti-alert-triangle',
  info:     'ti-info-circle',
  ok:       'ti-circle-check',
}

const EVENT_BADGE = {
  alert:    { label: 'BREACH',   bg: '#fee2e2', color: '#991b1b' },
  resolved: { label: 'RESOLVED', bg: '#dcfce7', color: '#166534' },
  test:     { label: 'TEST',     bg: '#dbeafe', color: '#1e40af' },
}

function SeverityIcon({ severity }) {
  return (
    <i
      className={`ti ${SEV_ICON[severity] ?? 'ti-circle'}`}
      style={{ color: SEV_COLOR[severity] ?? 'var(--muted)', fontSize: 16, flexShrink: 0 }}
      aria-hidden="true"
    />
  )
}

function EventBadge({ event }) {
  const b = EVENT_BADGE[event] ?? { label: event.toUpperCase(), bg: 'var(--bg)', color: 'var(--muted)' }
  return (
    <span style={{
      fontSize: 10, fontFamily: 'var(--mono)', fontWeight: 600,
      padding: '1px 6px', borderRadius: 3,
      background: b.bg, color: b.color,
    }}>{b.label}</span>
  )
}

export default function AlertsView() {
  const [status, setStatus]   = useState(null)
  const [history, setHistory] = useState([])
  const [checking, setChecking] = useState(false)

  const load = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([api.alertStatus(), api.alertHistory()])
      setStatus(s)
      setHistory(h.history ?? [])
    } catch {
      // best-effort — alerts view degrades gracefully on error
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function runCheck() {
    setChecking(true)
    try {
      await api.alertCheck()
      await load()
    } finally {
      setChecking(false)
    }
  }

  const active = status?.active ?? []

  return (
    <div>
      {/* Active alerts */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="card-header">
          <div className="card-title">
            <i className="ti ti-bell" style={{ color: active.length > 0 ? 'var(--c-crit)' : 'var(--c-green)' }} aria-hidden="true" />
            Active alerts
            {active.length > 0 && (
              <span style={{
                marginLeft: 8, fontSize: 11, fontFamily: 'var(--mono)', fontWeight: 600,
                background: '#fee2e2', color: '#991b1b',
                padding: '1px 7px', borderRadius: 10,
              }}>{active.length}</span>
            )}
          </div>
          <button
            onClick={runCheck}
            disabled={checking}
            style={{
              fontSize: 11, fontFamily: 'var(--mono)', padding: '3px 10px',
              borderRadius: 4, border: '0.5px solid var(--border)',
              background: 'transparent', color: 'var(--muted)',
              cursor: checking ? 'default' : 'pointer', opacity: checking ? 0.5 : 1,
            }}
          >
            <i className="ti ti-refresh" style={{ marginRight: 4 }} aria-hidden="true" />
            {checking ? 'checking…' : 'run check'}
          </button>
        </div>
        <div className="card-body">
          {active.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--c-green)', fontFamily: 'var(--mono)', fontSize: 13 }}>
              <i className="ti ti-circle-check" aria-hidden="true" />
              All clear — no active breaches
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {active.map(key => {
                const entry = history.find(h => h.event === 'alert' && h.key === key)
                return (
                  <div key={key} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <SeverityIcon severity={entry?.severity ?? 'warning'} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{entry?.message ?? key}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)', marginTop: 2 }}>
                        {entry?.system} · since {entry?.timestamp ? new Date(entry.timestamp).toLocaleString() : '—'}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* History */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">
            <i className="ti ti-history" style={{ color: 'var(--c-blue)' }} aria-hidden="true" />
            Recent events
          </div>
        </div>
        {history.length === 0 ? (
          <div className="card-body" style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
            no events yet — alert checks run every {' '}
            <span style={{ color: 'var(--text)' }}>ALERT_INTERVAL_SECONDS</span>
          </div>
        ) : (
          <div className="tbl-wrap">
            <table style={{ tableLayout: 'auto' }}>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Event</th>
                  <th>System</th>
                  <th>Message</th>
                  <th>Severity</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={i}>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                      {new Date(h.timestamp).toLocaleString()}
                    </td>
                    <td><EventBadge event={h.event} /></td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{h.system}</td>
                    <td style={{ fontSize: 13 }}>{h.message}</td>
                    <td>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: SEV_COLOR[h.severity] ?? 'var(--muted)' }}>
                        {h.severity}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
