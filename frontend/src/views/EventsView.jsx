import React, { useState, useEffect, useCallback } from 'react'
import { api } from '../api'

const EVENT_ICONS = {
  VmPoweredOnEvent:     { icon: 'ti-player-play', color: 'var(--c-ok)' },
  VmPoweredOffEvent:    { icon: 'ti-player-stop', color: 'var(--muted)' },
  VmSuspendedEvent:     { icon: 'ti-player-pause', color: 'var(--c-warn)' },
  VmMigratedEvent:      { icon: 'ti-arrows-transfer-up', color: 'var(--accent)' },
  VmRelocatedEvent:     { icon: 'ti-arrows-transfer-up', color: 'var(--accent)' },
  VmCreatedEvent:       { icon: 'ti-circle-plus', color: 'var(--c-ok)' },
  VmClonedEvent:        { icon: 'ti-copy', color: 'var(--c-ok)' },
  VmRemovedEvent:       { icon: 'ti-trash', color: 'var(--c-crit)' },
  VmRenamedEvent:       { icon: 'ti-pencil', color: 'var(--accent)' },
  VmReconfiguredEvent:  { icon: 'ti-settings', color: 'var(--accent)' },
  UserLoginSessionEvent:  { icon: 'ti-login', color: 'var(--c-warn)' },
  UserLogoutSessionEvent: { icon: 'ti-logout', color: 'var(--muted)' },
  TaskEvent:            { icon: 'ti-checkbox', color: 'var(--muted)' },
}

const HOURS_OPTIONS = [
  { label: '1h',  value: 1 },
  { label: '4h',  value: 4 },
  { label: '8h',  value: 8 },
  { label: '24h', value: 24 },
  { label: '48h', value: 48 },
  { label: '7d',  value: 168 },
]

const TYPE_GROUPS = {
  'All':      null,
  'Power':    ['VmPoweredOnEvent', 'VmPoweredOffEvent', 'VmSuspendedEvent'],
  'VM Mgmt':  ['VmCreatedEvent', 'VmClonedEvent', 'VmRemovedEvent', 'VmRenamedEvent', 'VmReconfiguredEvent'],
  'Migration':['VmMigratedEvent', 'VmRelocatedEvent'],
  'Auth':     ['UserLoginSessionEvent', 'UserLogoutSessionEvent'],
  'Tasks':    ['TaskEvent'],
}

function relTime(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60)   return `${Math.round(diff)}s ago`
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`
  return `${Math.round(diff / 86400)}d ago`
}

function shortType(t) {
  return t.replace(/Event$/, '').replace(/([a-z])([A-Z])/g, '$1 $2')
}

export default function EventsView() {
  const [events, setEvents]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [hours, setHours]     = useState(8)
  const [typeFilter, setTypeFilter] = useState('All')
  const [search, setSearch]   = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.vcenterEvents(hours, 500)
      setEvents(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [hours])

  useEffect(() => { load() }, [load])

  const filtered = (events ?? []).filter(ev => {
    const types = TYPE_GROUPS[typeFilter]
    if (types && !types.includes(ev.event_type)) return false
    if (search) {
      const q = search.toLowerCase()
      return (ev.vm_name ?? '').toLowerCase().includes(q) ||
             (ev.user_name ?? '').toLowerCase().includes(q) ||
             ev.message.toLowerCase().includes(q) ||
             ev.event_type.toLowerCase().includes(q)
    }
    return true
  })

  // Group by date
  const groups = filtered.reduce((acc, ev) => {
    const d = new Date(ev.created_time)
    const label = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    if (!acc[label]) acc[label] = []
    acc[label].push(ev)
    return acc
  }, {})

  return (
    <div style={{ padding: '1.25rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
          vCenter Events
        </h2>

        {/* Time range */}
        <div style={{ display: 'flex', gap: 4 }}>
          {HOURS_OPTIONS.map(opt => (
            <button key={opt.value}
              onClick={() => setHours(opt.value)}
              style={{
                padding: '2px 8px', borderRadius: 4, border: '0.5px solid var(--border)',
                fontFamily: 'var(--mono)', fontSize: 10, cursor: 'pointer',
                background: hours === opt.value ? 'var(--accent)' : 'var(--surface)',
                color: hours === opt.value ? '#fff' : 'var(--muted)',
              }}>
              {opt.label}
            </button>
          ))}
        </div>

        {/* Type filter */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {Object.keys(TYPE_GROUPS).map(g => (
            <button key={g}
              onClick={() => setTypeFilter(g)}
              style={{
                padding: '2px 8px', borderRadius: 4, border: '0.5px solid var(--border)',
                fontFamily: 'var(--mono)', fontSize: 10, cursor: 'pointer',
                background: typeFilter === g ? 'var(--surface2, var(--surface))' : 'var(--surface)',
                color: typeFilter === g ? 'var(--text)' : 'var(--muted)',
                fontWeight: typeFilter === g ? 700 : 400,
              }}>
              {g}
            </button>
          ))}
        </div>

        {/* Search */}
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="filter…"
          style={{
            marginLeft: 'auto', padding: '3px 8px',
            fontFamily: 'var(--mono)', fontSize: 11,
            background: 'var(--surface)', border: '0.5px solid var(--border)',
            borderRadius: 4, color: 'var(--text)', outline: 'none', width: 160,
          }}
        />

        <button onClick={load} disabled={loading}
          style={{
            padding: '3px 10px', borderRadius: 4, border: '0.5px solid var(--border)',
            fontFamily: 'var(--mono)', fontSize: 10, cursor: 'pointer',
            background: 'var(--surface)', color: 'var(--muted)',
          }}>
          <i className="ti ti-refresh" aria-hidden="true" />
        </button>
      </div>

      {/* Count */}
      {!loading && !error && (
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', marginBottom: '0.75rem' }}>
          {filtered.length} of {(events ?? []).length} events
        </div>
      )}

      {error && (
        <div style={{
          background: 'rgba(239,68,68,0.07)', border: '0.5px solid var(--c-crit)',
          borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '1rem',
          fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--c-crit)',
        }}>
          <i className="ti ti-alert-circle" style={{ marginRight: 6 }} aria-hidden="true" />
          {error}
        </div>
      )}

      {loading && (
        <div style={{ padding: '3rem', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--muted)' }}>
          <i className="ti ti-loader-2" style={{ marginRight: 6 }} aria-hidden="true" />
          fetching events…
        </div>
      )}

      {/* Event timeline */}
      {!loading && !error && Object.entries(groups).map(([date, evs]) => (
        <div key={date} style={{ marginBottom: '1.25rem' }}>
          <div style={{
            fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 600,
            color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1,
            marginBottom: 6,
          }}>
            {date}
          </div>

          <div style={{
            background: 'var(--surface)', border: '0.5px solid var(--border)',
            borderRadius: 8, overflow: 'hidden',
          }}>
            {evs.map((ev, i) => {
              const { icon, color } = EVENT_ICONS[ev.event_type] ?? { icon: 'ti-point', color: 'var(--muted)' }
              return (
                <div key={ev.event_id} style={{
                  display: 'grid',
                  gridTemplateColumns: '28px 110px 120px 1fr',
                  gap: 0,
                  padding: '5px 10px',
                  alignItems: 'start',
                  borderTop: i > 0 ? '0.5px solid var(--border)' : 'none',
                  fontFamily: 'var(--mono)', fontSize: 11,
                }}>
                  <i className={`ti ${icon}`} style={{ fontSize: 13, color, paddingTop: 1 }} aria-hidden="true" />
                  <span style={{ color: 'var(--muted)', fontSize: 10, paddingTop: 1 }}>
                    {new Date(ev.created_time).toLocaleTimeString()}
                    {' '}
                    <span title={new Date(ev.created_time).toISOString()}
                      style={{ color: 'var(--muted)', opacity: 0.7 }}>
                      ({relTime(ev.created_time)})
                    </span>
                  </span>
                  <span style={{ color: 'var(--text)', fontWeight: 600, fontSize: 10 }}>
                    {shortType(ev.event_type)}
                  </span>
                  <div style={{ color: 'var(--muted)', lineHeight: 1.4, paddingRight: 8 }}>
                    {ev.vm_name && (
                      <span style={{ color: 'var(--text)', fontWeight: 600 }}>{ev.vm_name} </span>
                    )}
                    {ev.user_name && (
                      <span style={{ opacity: 0.7 }}>by {ev.user_name} </span>
                    )}
                    <span style={{ fontSize: 10, opacity: 0.75 }}>
                      {ev.message.length > 120 ? ev.message.slice(0, 120) + '…' : ev.message}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {!loading && !error && filtered.length === 0 && (
        <div style={{
          fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)',
          background: 'var(--surface)', border: '0.5px solid var(--border)',
          borderRadius: 8, padding: '2rem', textAlign: 'center',
        }}>
          no events matched
        </div>
      )}
    </div>
  )
}
