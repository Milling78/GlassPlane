import React, { useState, useEffect } from 'react'
import { api } from '../api'

const PRIORITY_COLOR = {
  high:   'var(--c-crit)',
  medium: 'var(--c-warn)',
  low:    'var(--c-green)',
}

const PRIORITY_BADGE = {
  high:   'b-crit',
  medium: 'b-warn',
  low:    'b-on',
}

function PriorityPills({ high, medium, low }) {
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {high   > 0 && <span className="badge b-crit">{high} high</span>}
      {medium > 0 && <span className="badge b-warn">{medium} med</span>}
      {low    > 0 && <span className="badge b-on">{low} low</span>}
    </div>
  )
}

function TicketRow({ ticket }) {
  return (
    <tr style={{ borderBottom: '0.5px solid var(--border)' }}>
      <td style={{ padding: '5px 10px', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
        #{ticket.id}
      </td>
      <td style={{ padding: '5px 10px', fontFamily: 'var(--mono)', fontSize: 12, maxWidth: 340, wordBreak: 'break-word' }}>
        {ticket.title}
      </td>
      <td style={{ padding: '5px 10px' }}>
        <span className={`badge ${PRIORITY_BADGE[ticket.priority] ?? 'b-off'}`}>{ticket.priority}</span>
      </td>
      <td style={{ padding: '5px 10px', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>
        {ticket.status}
      </td>
      <td style={{ padding: '5px 10px', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {ticket.owner || '—'}
      </td>
      <td style={{ padding: '5px 10px', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
        {ticket.modified ? ticket.modified.slice(0, 10) : '—'}
      </td>
    </tr>
  )
}

function TicketGroup({ group }) {
  const [open, setOpen] = useState(false)
  const hasHigh = group.high_count > 0

  return (
    <div style={{
      border: `0.5px solid ${hasHigh ? 'var(--c-crit)' : 'var(--border)'}`,
      borderRadius: 8,
      overflow: 'hidden',
      marginBottom: 8,
      background: hasHigh ? 'rgba(239,68,68,0.04)' : 'var(--surface)',
    }}>
      {/* Group header — clickable to expand */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <i className={`ti ${open ? 'ti-chevron-down' : 'ti-chevron-right'}`}
          style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0 }} aria-hidden="true" />
        <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 500, color: 'var(--text)', flex: 1 }}>
          {group.category}
        </span>
        <PriorityPills high={group.high_count} medium={group.medium_count} low={group.low_count} />
        <span style={{
          marginLeft: 8, fontFamily: 'var(--mono)', fontSize: 11,
          color: 'var(--muted)', whiteSpace: 'nowrap',
        }}>
          {group.count} ticket{group.count !== 1 ? 's' : ''}
        </span>
      </button>

      {open && (
        <div style={{ borderTop: '0.5px solid var(--border)', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--bg)', color: 'var(--muted)', fontSize: 10, fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                <th style={{ padding: '5px 10px', fontWeight: 400, textAlign: 'left' }}>ID</th>
                <th style={{ padding: '5px 10px', fontWeight: 400, textAlign: 'left' }}>Title</th>
                <th style={{ padding: '5px 10px', fontWeight: 400, textAlign: 'left' }}>Priority</th>
                <th style={{ padding: '5px 10px', fontWeight: 400, textAlign: 'left' }}>Status</th>
                <th style={{ padding: '5px 10px', fontWeight: 400, textAlign: 'left' }}>Owner</th>
                <th style={{ padding: '5px 10px', fontWeight: 400, textAlign: 'left' }}>Updated</th>
              </tr>
            </thead>
            <tbody>
              {group.tickets.map(t => <TicketRow key={t.id} ticket={t} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function QueuePanel({ queue, icon, accentColor }) {
  if (!queue) return null

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div className="card-header">
        <div className="card-title">
          <i className={`ti ${icon}`} style={{ color: accentColor }} aria-hidden="true" />
          {queue.queue_name}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <PriorityPills high={queue.high_count} medium={queue.medium_count} low={queue.low_count} />
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>
            {queue.total} open
          </span>
        </div>
      </div>

      {queue.groups.length === 0
        ? (
          <div style={{ padding: '1rem 1.25rem', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>
            No open tickets
          </div>
        )
        : (
          <div style={{ padding: '0.75rem 1rem' }}>
            {queue.groups.map(g => <TicketGroup key={g.category} group={g} />)}
          </div>
        )
      }
    </div>
  )
}

export default function KACEView() {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    api.kace()
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  if (loading) return (
    <div style={{ padding: '3rem', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--muted)' }}>
      loading KACE tickets…
    </div>
  )

  if (error) return (
    <div style={{ padding: '3rem', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--c-crit)' }}>
      <i className="ti ti-alert-circle" style={{ marginRight: 6 }} aria-hidden="true" />
      {error}
    </div>
  )

  if (!data) return null

  if (data.error && !data.helpdesk && !data.engineering) return (
    <div style={{ padding: '3rem', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--c-warn)' }}>
      <i className="ti ti-alert-triangle" style={{ marginRight: 6 }} aria-hidden="true" />
      {data.error}
    </div>
  )

  const helpdesk    = data.helpdesk
  const engineering = data.engineering

  return (
    <div>
      {/* Summary bar */}
      <div className="metrics" style={{ marginBottom: '1rem' }}>
        <div className="metric">
          <div className="metric-label">Total open</div>
          <div className="metric-val">{data.total_open}</div>
        </div>
        {helpdesk && (
          <div className="metric">
            <div className="metric-label">{helpdesk.queue_name}</div>
            <div className="metric-val" style={{ color: helpdesk.high_count > 0 ? 'var(--c-crit)' : 'var(--text)' }}>
              {helpdesk.total}
            </div>
            {helpdesk.high_count > 0 && (
              <div className="metric-sub" style={{ color: 'var(--c-crit)' }}>{helpdesk.high_count} high priority</div>
            )}
          </div>
        )}
        {engineering && (
          <div className="metric">
            <div className="metric-label">{engineering.queue_name}</div>
            <div className="metric-val" style={{ color: engineering.high_count > 0 ? 'var(--c-crit)' : 'var(--text)' }}>
              {engineering.total}
            </div>
            {engineering.high_count > 0 && (
              <div className="metric-sub" style={{ color: 'var(--c-crit)' }}>{engineering.high_count} high priority</div>
            )}
          </div>
        )}
        {helpdesk && (
          <div className="metric">
            <div className="metric-label">Categories</div>
            <div className="metric-val">{helpdesk.groups.length + (engineering?.groups.length ?? 0)}</div>
          </div>
        )}
      </div>

      {data.error && (
        <div style={{
          background: 'rgba(245,158,11,0.08)', border: '0.5px solid var(--c-warn)',
          borderRadius: 8, padding: '0.75rem 1rem', fontFamily: 'var(--mono)', fontSize: 12,
          color: 'var(--c-warn)', marginBottom: '1rem',
        }}>
          <i className="ti ti-info-circle" style={{ marginRight: 6 }} aria-hidden="true" />
          {data.error}
        </div>
      )}

      <QueuePanel
        queue={helpdesk}
        icon="ti-headset"
        accentColor="var(--c-blue)"
      />
      <QueuePanel
        queue={engineering}
        icon="ti-tool"
        accentColor="var(--c-warn)"
      />

      {!helpdesk && !engineering && (
        <div style={{ padding: '3rem', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--muted)' }}>
          no KACE queues found — check queue names in Settings
        </div>
      )}
    </div>
  )
}
