import React, { useState, useEffect } from 'react'
import { api } from '../api'

// ── Thresholds ────────────────────────────────────────────────────────────────
const WARN_DAYS  = 7
const CRIT_DAYS  = 30
const WARN_COUNT = 3

// ── Helpers ───────────────────────────────────────────────────────────────────

function ageColor(days) {
  return days >= CRIT_DAYS ? 'var(--c-crit)' : days >= WARN_DAYS ? 'var(--c-warn)' : 'var(--c-green)'
}

function AgeBadge({ days }) {
  const color = ageColor(days)
  const bg    = days >= CRIT_DAYS ? 'rgba(239,68,68,0.10)' : days >= WARN_DAYS ? 'rgba(245,158,11,0.10)' : 'rgba(34,197,94,0.10)'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontFamily: 'var(--mono)', fontWeight: 700, color, background: bg, borderRadius: 6, padding: '2px 7px' }}>
      {days >= CRIT_DAYS && <i className="ti ti-alert-octagon" aria-hidden="true" />}
      {days >= WARN_DAYS && days < CRIT_DAYS && <i className="ti ti-alert-triangle" aria-hidden="true" />}
      {days < WARN_DAYS  && <i className="ti ti-clock" aria-hidden="true" />}
      {days.toFixed(0)}d
    </span>
  )
}

function fmtSize(gb) {
  if (gb == null) return '—'
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(gb * 1024).toFixed(0)} MB`
}

// ── Expanded snapshot tree for a VM ──────────────────────────────────────────

function SnapshotTree({ snaps }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 0 8px' }}>
      {snaps.map((s, i) => (
        <div
          key={i}
          style={{
            display: 'grid',
            gridTemplateColumns: '200px 80px 1fr',
            gap: 12,
            paddingLeft: 12 + s.depth * 20,
            fontSize: 11,
            fontFamily: 'var(--mono)',
            alignItems: 'center',
          }}
        >
          <span style={{ color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 5 }}>
            {s.depth > 0 && <span style={{ color: 'var(--muted)' }}>└</span>}
            <i className="ti ti-camera" style={{ color: 'var(--muted)', fontSize: 10 }} aria-hidden="true" />
            {s.name}
          </span>
          <AgeBadge days={s.age_days} />
          <span style={{ color: 'var(--muted)', display: 'flex', gap: 16 }}>
            <span>{fmtSize(s.size_gb)}</span>
            {s.description && <span style={{ fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>{s.description}</span>}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

const FILTERS = ['all', 'aged', 'critical']

export default function SnapshotsView() {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [filter,  setFilter]  = useState('all')
  const [sortBy,  setSortBy]  = useState('oldest_days')
  const [sortDir, setSortDir] = useState('desc')
  const [expanded, setExpanded] = useState(new Set())

  useEffect(() => {
    api.vcenterSnapshots()
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  if (loading) return (
    <div style={{ padding: '3rem', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--muted)' }}>
      scanning VM snapshots…
    </div>
  )
  if (error) return (
    <div style={{ padding: '3rem', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--c-crit)' }}>
      {error}
    </div>
  )
  if (!data?.length) return (
    <div style={{ padding: '3rem', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--c-green)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <i className="ti ti-circle-check" style={{ fontSize: 32 }} aria-hidden="true" />
      No snapshots found — all VMs are clean
    </div>
  )

  const criticalVms  = data.filter(v => v.oldest_days >= CRIT_DAYS)
  const warnVms      = data.filter(v => v.oldest_days >= WARN_DAYS && v.oldest_days < CRIT_DAYS)
  const totalSnaps   = data.reduce((s, v) => s + v.snapshot_count, 0)
  const totalSizeGb  = data.reduce((s, v) => s + (v.total_size_gb ?? 0), 0)
  const hasSizeData  = data.some(v => v.total_size_gb != null)

  const filtered = data.filter(v => {
    if (filter === 'aged')     return v.oldest_days >= WARN_DAYS
    if (filter === 'critical') return v.oldest_days >= CRIT_DAYS
    return true
  })

  const toggle = field => {
    if (sortBy === field) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortBy(field); setSortDir('desc') }
  }

  const sorted = [...filtered].sort((a, b) => {
    const av = a[sortBy] ?? 0, bv = b[sortBy] ?? 0
    const cmp = typeof av === 'string' ? av.localeCompare(bv) : bv - av
    return sortDir === 'asc' ? -cmp : cmp
  })

  const toggleExpand = id => setExpanded(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const Th = ({ field, children, right }) => (
    <th
      onClick={() => toggle(field)}
      style={{ cursor: 'pointer', userSelect: 'none', textAlign: right ? 'right' : 'left' }}
    >
      {children}{sortBy === field ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
    </th>
  )

  return (
    <div>
      {/* Summary */}
      <div className="metrics" style={{ marginBottom: '1rem' }}>
        <div className="metric">
          <div className="metric-label">VMs with snapshots</div>
          <div className="metric-val">{data.length}</div>
        </div>
        <div className="metric">
          <div className="metric-label">total snapshots</div>
          <div className="metric-val">{totalSnaps}</div>
        </div>
        <div className="metric">
          <div className="metric-label">critical (&gt;{CRIT_DAYS}d)</div>
          <div className="metric-val" style={{ color: criticalVms.length ? 'var(--c-crit)' : undefined }}>{criticalVms.length}</div>
        </div>
        <div className="metric">
          <div className="metric-label">warning (&gt;{WARN_DAYS}d)</div>
          <div className="metric-val" style={{ color: warnVms.length ? 'var(--c-warn)' : undefined }}>{warnVms.length}</div>
        </div>
        {hasSizeData && (
          <div className="metric">
            <div className="metric-label">total size</div>
            <div className="metric-val">{fmtSize(totalSizeGb)}</div>
          </div>
        )}
      </div>

      {/* Filter + table */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">
            <i className="ti ti-camera" style={{ color: 'var(--c-blue)' }} aria-hidden="true" />
            VM snapshot inventory
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {FILTERS.map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{
                fontSize: 11, fontFamily: 'var(--mono)', padding: '3px 10px',
                borderRadius: 6, border: '0.5px solid var(--border)',
                background: filter === f ? 'var(--c-blue)' : 'transparent',
                color: filter === f ? '#fff' : 'var(--muted)', cursor: 'pointer',
              }}>
                {f}
                {f === 'aged'     && warnVms.length > 0     && <span style={{ marginLeft: 5, fontWeight: 700 }}>{data.filter(v => v.oldest_days >= WARN_DAYS).length}</span>}
                {f === 'critical' && criticalVms.length > 0  && <span style={{ marginLeft: 5, fontWeight: 700 }}>{criticalVms.length}</span>}
              </button>
            ))}
          </div>
        </div>
        <div className="tbl-wrap">
          <table style={{ tableLayout: 'auto' }}>
            <thead>
              <tr>
                <th style={{ width: 24 }} />
                <Th field="vm_name">VM</Th>
                <Th field="cluster">Cluster</Th>
                <Th field="snapshot_count" right>Snaps</Th>
                <Th field="oldest_days" right>Oldest</Th>
                <Th field="newest_days" right>Newest</Th>
                {hasSizeData && <Th field="total_size_gb" right>Size</Th>}
              </tr>
            </thead>
            <tbody>
              {sorted.map(vm => {
                const isOpen = expanded.has(vm.vm_id)
                return (
                  <React.Fragment key={vm.vm_id}>
                    <tr
                      onClick={() => toggleExpand(vm.vm_id)}
                      style={{ cursor: 'pointer' }}
                      className="hoverable-row"
                    >
                      <td style={{ color: 'var(--muted)', fontSize: 11, textAlign: 'center' }}>
                        <i className={`ti ${isOpen ? 'ti-chevron-down' : 'ti-chevron-right'}`} aria-hidden="true" />
                      </td>
                      <td style={{ fontWeight: 500 }}>
                        {vm.vm_name}
                        <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)', fontWeight: 400, marginTop: 1 }}>{vm.host.split('.')[0]}</div>
                      </td>
                      <td style={{ color: 'var(--muted)' }}>{vm.cluster}</td>
                      <td style={{ textAlign: 'right', color: vm.snapshot_count >= WARN_COUNT ? 'var(--c-warn)' : undefined }}>
                        {vm.snapshot_count}
                      </td>
                      <td style={{ textAlign: 'right' }}><AgeBadge days={vm.oldest_days} /></td>
                      <td style={{ textAlign: 'right', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 12 }}>{vm.newest_days.toFixed(0)}d</td>
                      {hasSizeData && <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>{fmtSize(vm.total_size_gb)}</td>}
                    </tr>
                    {isOpen && (
                      <tr>
                        <td />
                        <td colSpan={hasSizeData ? 5 : 4} style={{ padding: 0, background: 'rgba(0,0,0,0.15)' }}>
                          <SnapshotTree snaps={vm.snapshots} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
