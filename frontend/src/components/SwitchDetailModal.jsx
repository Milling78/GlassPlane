import React, { useState } from 'react'

// ── Port heatmap ───────────────────────────────────────────────────────────────

function portColor(port) {
  if (port.is_unused) return '#2a2a2a'   // down / unused — dark gray
  const util = Math.max(port.rx_util_pct, port.tx_util_pct)
  if (util === 0) return '#16a34a55'     // link up, no utilization data — dim green
  if (util < 30)  return '#22c55e'       // low
  if (util < 70)  return '#f59e0b'       // medium
  return '#ef4444'                       // high
}

function portTitle(port) {
  const util = Math.max(port.rx_util_pct, port.tx_util_pct)
  const utilStr = port.rx_util_pct === 0 && port.tx_util_pct === 0 && !port.is_unused
    ? 'link up (no rate data)'
    : `RX ${port.rx_util_pct}%  TX ${port.tx_util_pct}%`
  return `Port ${port.port_id}${port.name !== port.port_id ? ' · ' + port.name : ''}\n${port.speed_mbps >= 1000 ? port.speed_mbps / 1000 + ' Gbps' : port.speed_mbps + ' Mbps'}  ${utilStr}`
}

function PortHeatmap({ ports }) {
  const physical = ports.filter(p => p.port_id)
  if (!physical.length) return null
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
        Port utilisation map
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
        {physical.map(p => (
          <div
            key={p.port_id}
            title={portTitle(p)}
            style={{
              width: 18, height: 18, borderRadius: 3,
              background: portColor(p),
              border: p.is_unused ? '1px solid #444' : '1px solid transparent',
              cursor: 'default',
              flexShrink: 0,
            }}
          />
        ))}
      </div>
      {/* Legend */}
      <div style={{ display: 'flex', gap: 14, fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', marginBottom: 16 }}>
        {[
          ['#2a2a2a', 'down / unused'],
          ['#22c55e', '< 30%'],
          ['#f59e0b', '30–70%'],
          ['#ef4444', '> 70%'],
        ].map(([bg, label]) => (
          <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: bg, display: 'inline-block', border: bg === '#2a2a2a' ? '1px solid #555' : 'none' }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Util bar ──────────────────────────────────────────────────────────────────

function UtilBar({ pct, color = 'var(--c-blue)' }) {
  if (pct === 0) return <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>—</span>
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 60, height: 5, background: 'var(--bg)', borderRadius: 3, overflow: 'hidden', border: '0.5px solid var(--border)' }}>
        <div style={{ width: Math.min(100, pct) + '%', height: '100%', background: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text)', minWidth: 34 }}>{pct}%</span>
    </div>
  )
}

// ── Port table ────────────────────────────────────────────────────────────────

const SORT_FIELDS = ['port_id', 'speed_mbps', 'rx_util_pct', 'tx_util_pct']

function PortTable({ ports }) {
  const [sortBy, setSortBy]   = useState('port_id')
  const [sortDir, setSortDir] = useState('asc')
  const [filter, setFilter]   = useState('all') // all | active | unused

  const toggle = field => {
    if (sortBy === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(field); setSortDir('asc') }
  }

  const filtered = ports.filter(p => {
    if (filter === 'active') return !p.is_unused
    if (filter === 'unused') return p.is_unused
    return true
  })
  const sorted = [...filtered].sort((a, b) => {
    const av = a[sortBy], bv = b[sortBy]
    const cmp = typeof av === 'string'
      ? av.localeCompare(bv, undefined, { numeric: true })
      : av - bv
    return sortDir === 'asc' ? cmp : -cmp
  })

  const hasRates = ports.some(p => p.rx_util_pct > 0 || p.tx_util_pct > 0)

  const Th = ({ field, children }) => (
    <th
      onClick={() => SORT_FIELDS.includes(field) && toggle(field)}
      style={{ cursor: SORT_FIELDS.includes(field) ? 'pointer' : 'default', userSelect: 'none' }}
    >
      {children}{sortBy === field ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
    </th>
  )

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        {['all', 'active', 'unused'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              fontSize: 11, fontFamily: 'var(--mono)', padding: '3px 10px',
              borderRadius: 6, border: '0.5px solid var(--border)',
              background: filter === f ? 'var(--c-blue)' : 'transparent',
              color: filter === f ? '#fff' : 'var(--muted)',
              cursor: 'pointer',
            }}
          >
            {f}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)', alignSelf: 'center' }}>
          {sorted.length} port{sorted.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div style={{ overflowY: 'auto', maxHeight: 320 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--mono)', fontSize: 12 }}>
          <thead>
            <tr style={{ color: 'var(--muted)', textAlign: 'left', fontSize: 11 }}>
              <Th field="port_id">Port</Th>
              <th>Name / Description</th>
              <Th field="speed_mbps">Speed</Th>
              <th>Status</th>
              {hasRates && <Th field="rx_util_pct">RX util</Th>}
              {hasRates && <Th field="tx_util_pct">TX util</Th>}
            </tr>
          </thead>
          <tbody>
            {sorted.map(p => (
              <tr key={p.port_id} style={{ borderBottom: '0.5px solid var(--border)' }}>
                <td style={{ padding: '5px 8px', fontWeight: 500 }}>{p.port_id}</td>
                <td style={{ padding: '5px 8px', color: p.name !== p.port_id ? 'var(--text)' : 'var(--muted)' }}>
                  {p.name !== p.port_id ? p.name : '—'}
                </td>
                <td style={{ padding: '5px 8px', color: 'var(--muted)' }}>
                  {p.speed_mbps >= 1000 ? `${p.speed_mbps / 1000} Gbps` : `${p.speed_mbps} Mbps`}
                </td>
                <td style={{ padding: '5px 8px' }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: p.is_unused ? 'var(--muted)' : 'var(--c-green)' }}>
                    {p.is_unused ? '○ down/idle' : '● active'}
                  </span>
                </td>
                {hasRates && <td style={{ padding: '5px 8px' }}><UtilBar pct={p.rx_util_pct} color="var(--c-green)" /></td>}
                {hasRates && <td style={{ padding: '5px 8px' }}><UtilBar pct={p.tx_util_pct} color="var(--c-blue)" /></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Uptime formatter ──────────────────────────────────────────────────────────

function fmtUptime(secs) {
  if (!secs) return '—'
  const d = Math.floor(secs / 86400)
  const h = Math.floor((secs % 86400) / 3600)
  if (d > 0) return `${d}d ${h}h`
  return `${h}h ${Math.floor((secs % 3600) / 60)}m`
}

// ── Modal ─────────────────────────────────────────────────────────────────────

export default function SwitchDetailModal({ sw, onClose }) {
  if (!sw) return null
  const isDirect = sw.source === 'direct'

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 12, width: '100%', maxWidth: 820, maxHeight: '90vh', overflow: 'auto', padding: 24 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
              <i className="ti ti-network" style={{ color: 'var(--c-blue)' }} aria-hidden="true" />
              {sw.name}
              {isDirect && (
                <span style={{ fontSize: 10, fontFamily: 'var(--mono)', background: 'rgba(59,130,246,0.15)', color: 'var(--c-blue)', borderRadius: 4, padding: '2px 7px', fontWeight: 600 }}>
                  DIRECT
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)', marginTop: 4 }}>
              {sw.model}{sw.site && sw.site !== 'direct' ? ` · ${sw.site}` : ''}
              {sw.ip ? ` · ${sw.ip}` : ''}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {isDirect && sw.ip && (
              <button
                onClick={() => {
                  const url = `https://${sw.ip}`
                  if (window.glassplane?.isElectron) window.glassplane.openExternal?.(url)
                  else window.open(url, '_blank', 'noopener')
                }}
                style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontFamily: 'var(--mono)', padding: '5px 12px', borderRadius: 6, border: '0.5px solid var(--c-blue)', background: 'transparent', color: 'var(--c-blue)', cursor: 'pointer' }}
              >
                <i className="ti ti-external-link" aria-hidden="true" />
                Open Web UI
              </button>
            )}
            <button
              onClick={onClose}
              style={{ background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: 4 }}
              aria-label="Close"
            >×</button>
          </div>
        </div>

        {/* Summary metrics */}
        <div className="metrics" style={{ marginBottom: 16 }}>
          <div className="metric">
            <div className="metric-label">ports</div>
            <div className="metric-val">{sw.port_count}</div>
          </div>
          <div className="metric">
            <div className="metric-label">active</div>
            <div className="metric-val">{sw.port_count - sw.unused_ports}</div>
          </div>
          <div className="metric">
            <div className="metric-label">unused</div>
            <div className="metric-val" style={{ color: sw.unused_ports > 0 ? 'var(--c-warn)' : undefined }}>{sw.unused_ports}</div>
          </div>
          <div className="metric">
            <div className="metric-label">CPU</div>
            <div className="metric-val" style={{ color: sw.cpu_util_pct > 70 ? 'var(--c-warn)' : undefined }}>{sw.cpu_util_pct}%</div>
          </div>
          <div className="metric">
            <div className="metric-label">Mem</div>
            <div className="metric-val">{sw.mem_util_pct}%</div>
          </div>
          <div className="metric">
            <div className="metric-label">uptime</div>
            <div className="metric-val">{fmtUptime(sw.uptime_seconds)}</div>
          </div>
        </div>

        {/* SSH note */}
        {isDirect && sw.ports.length > 0 && sw.ports.every(p => p.rx_util_pct === 0 && p.tx_util_pct === 0) && (
          <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
            <i className="ti ti-info-circle" aria-hidden="true" />
            Connected via SSH — port link state only, utilisation rates require AOS-CX REST
          </div>
        )}

        {sw.ports.length > 0 ? (
          <>
            <PortHeatmap ports={sw.ports} />
            <PortTable ports={sw.ports} />
          </>
        ) : (
          <div style={{ padding: '2rem', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--muted)' }}>
            no port data available
          </div>
        )}
      </div>
    </div>
  )
}
