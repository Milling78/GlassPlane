import React, { useState, useEffect, useCallback } from 'react'
import { api } from '../api'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Normalise to first DNS label, lowercased: "TS01.corp.local" → "ts01" */
function shortName(str) {
  return (str || '').split('.')[0].toLowerCase()
}

/** Build {shortName: vmObject} from vCenter VM list */
function buildVmLookup(vms) {
  const map = {}
  for (const vm of (vms || [])) {
    const key = shortName(vm.name)
    if (key) map[key] = vm
  }
  return map
}

const STATUS_COLOR = {
  available:   'var(--c-ok)',
  unavailable: 'var(--c-warn)',
  drain:       'var(--c-warn)',
  unreachable: 'var(--c-crit)',
}

function statusColor(s) {
  return STATUS_COLOR[(s || '').toLowerCase()] || 'var(--muted)'
}

function StatusBadge({ status }) {
  const color = statusColor(status)
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontFamily: 'var(--mono)', fontWeight: 600, color }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
      {(status || 'Unknown').toUpperCase()}
    </span>
  )
}

function MethodBadge({ method }) {
  const label = method === 'broker' ? 'Broker' : method === 'direct' ? 'Direct' : method === 'broker_error' ? 'Broker failed' : method || ''
  const color  = method === 'broker' ? 'var(--c-blue)' : method === 'direct' ? 'var(--c-ok)' : 'var(--c-warn)'
  return <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color, marginLeft: 8 }}>[{label}]</span>
}

function VcBadge() {
  return (
    <span title="Matched to vCenter VM" style={{
      display: 'inline-flex', alignItems: 'center',
      fontSize: 9, fontFamily: 'var(--mono)', fontWeight: 700,
      color: 'var(--c-ok)', background: 'color-mix(in srgb, var(--c-ok) 12%, transparent)',
      border: '0.5px solid color-mix(in srgb, var(--c-ok) 30%, transparent)',
      borderRadius: 3, padding: '1px 4px', marginLeft: 5, letterSpacing: 0.5,
    }}>VC</span>
  )
}

function Bar({ pct, warn = 75, crit = 90, width = 60 }) {
  if (pct == null) return <span style={{ color: 'var(--muted)', fontSize: 11 }}>—</span>
  const color = pct >= crit ? 'var(--c-crit)' : pct >= warn ? 'var(--c-warn)' : 'var(--c-ok)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width, height: 4, background: 'var(--bg)', borderRadius: 2, overflow: 'hidden', flexShrink: 0 }}>
        <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: color, borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color, minWidth: 36 }}>{pct.toFixed(0)}%</span>
    </div>
  )
}

function DualBar({ wmiPct, vcPct, warnCpu = 75, critCpu = 90, warnRam = 80, critRam = 90, isRam = false }) {
  const warn = isRam ? warnRam : warnCpu
  const crit = isRam ? critRam : critCpu
  // Prefer vCenter data; fall back to WMI
  const pct    = vcPct ?? wmiPct
  const source = vcPct != null ? 'vc' : wmiPct != null ? 'wmi' : null
  if (pct == null) return <span style={{ color: 'var(--muted)', fontSize: 11 }}>—</span>
  const color  = pct >= crit ? 'var(--c-crit)' : pct >= warn ? 'var(--c-warn)' : 'var(--c-ok)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 60, height: 4, background: 'var(--bg)', borderRadius: 2, overflow: 'hidden', flexShrink: 0 }}>
        <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: color, borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color, minWidth: 36 }}>{pct.toFixed(0)}%</span>
      {source === 'wmi' && <span style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>wmi</span>}
    </div>
  )
}

function AllocCell({ cpuMhz, ramMb }) {
  if (cpuMhz == null && ramMb == null) return <span style={{ color: 'var(--muted)' }}>—</span>
  const cpu = cpuMhz != null ? `${(cpuMhz / 1000).toFixed(1)} GHz` : null
  const ram = ramMb  != null ? `${(ramMb  / 1024).toFixed(1)} GB`  : null
  return (
    <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>
      {[cpu, ram].filter(Boolean).join(' / ')}
    </span>
  )
}

function fmt_idle(mins) {
  if (mins == null) return '—'
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60), m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

// ── Main view ─────────────────────────────────────────────────────────────────

export default function RDSView({ data: propData }) {
  const [data,    setData]    = useState(propData)
  const [vmMap,   setVmMap]   = useState({})
  const [hasVc,   setHasVc]   = useState(false)
  const [loading, setLoading] = useState(!propData)
  const [error,   setError]   = useState(null)
  const [sessionSort, setSessionSort] = useState({ col: 'state',    dir: 1 })
  const [hostSort,    setHostSort]    = useState({ col: 'hostname',  dir: 1 })

  const load = useCallback(async () => {
    try {
      setError(null)
      const [rdsResult, vcResult] = await Promise.allSettled([
        api.rds(),
        api.vcenterVMs({ limit: 1000, sort_by: 'name', sort_dir: 'asc' }),
      ])

      if (rdsResult.status === 'fulfilled') setData(rdsResult.value)
      else throw rdsResult.reason

      if (vcResult.status === 'fulfilled') {
        const lookup = buildVmLookup(vcResult.value)
        setVmMap(lookup)
        setHasVc(Object.keys(lookup).length > 0)
      }
      // vCenter failure is silent — RDS view still works without it
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function sortHosts(col)    { setHostSort(s    => ({ col, dir: s.col    === col ? -s.dir : 1 })) }
  function sortSessions(col) { setSessionSort(s => ({ col, dir: s.col === col ? -s.dir : 1 })) }
  const thStyle = (col, sort) => ({ cursor: 'pointer', color: sort.col === col ? 'var(--text)' : undefined })

  if (loading) return (
    <div style={{ padding: '3rem', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>
      loading terminal server data…
    </div>
  )

  if (error) return (
    <div style={{ padding: '2rem' }}>
      <div style={{ background: '#fee2e2', border: '0.5px solid #fca5a5', borderRadius: 8, padding: '0.75rem 1rem', fontFamily: 'var(--mono)', fontSize: 12, color: '#991b1b' }}>
        {error}
      </div>
    </div>
  )

  if (!data || data.method === 'unconfigured') return (
    <div style={{ padding: '2rem' }}>
      <div className="card">
        <div className="card-body" style={{ textAlign: 'center', padding: '2rem', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>
          <i className="ti ti-device-desktop" style={{ fontSize: 32, display: 'block', marginBottom: 12 }} aria-hidden="true" />
          No RDS configuration found. Add your RD Connection Broker or RDSH hostnames in Settings.
        </div>
      </div>
    </div>
  )

  const hosts = [...(data.hosts || [])].sort((a, b) => {
    const { col, dir } = hostSort
    const av = a[col] ?? '', bv = b[col] ?? ''
    return (typeof av === 'number' ? (av - bv) : String(av).localeCompare(String(bv))) * dir
  })

  const sessions = [...(data.sessions || [])].sort((a, b) => {
    const { col, dir } = sessionSort
    const av = a[col] ?? '', bv = b[col] ?? ''
    return (typeof av === 'number' ? (av - bv) : String(av).localeCompare(String(bv))) * dir
  })

  // Determine which VC columns to show (only if at least one host matched)
  const matchedHosts = hosts.filter(h => vmMap[shortName(h.hostname)])
  const showVcCols   = hasVc && matchedHosts.length > 0

  const headerColor  = { ok: 'var(--c-ok)', warning: 'var(--c-warn)', critical: 'var(--c-crit)' }[(data.status || 'ok').toLowerCase()] || 'var(--muted)'

  return (
    <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.75rem' }}>
        {[
          { label: 'Hosts',          value: data.host_count,         icon: 'ti-server-2' },
          { label: 'Active Sessions', value: data.total_active,       icon: 'ti-user-check', color: data.total_active > 0 ? 'var(--c-ok)' : undefined },
          { label: 'Disconnected',   value: data.total_disconnected,  icon: 'ti-user-off',   color: data.total_disconnected > 0 ? 'var(--c-warn)' : undefined },
          { label: 'Total Sessions', value: data.total_sessions,      icon: 'ti-users' },
        ].map(({ label, value, icon, color }) => (
          <div key={label} className="card">
            <div className="card-body" style={{ padding: '0.9rem 1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <i className={`ti ${icon}`} style={{ color: 'var(--muted)', fontSize: 14 }} aria-hidden="true" />
                <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
              </div>
              <div style={{ fontSize: 28, fontFamily: 'var(--mono)', fontWeight: 600, color: color || 'var(--text)', lineHeight: 1 }}>
                {value ?? '—'}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Matched VM count note */}
      {hasVc && (
        <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>
          <span style={{ color: 'var(--c-ok)', fontWeight: 600 }}>VC</span>
          {' '}vCenter match active — {matchedHosts.length} of {hosts.length} host{hosts.length !== 1 ? 's' : ''} found.
          {matchedHosts.length < hosts.length && ` (${hosts.length - matchedHosts.length} unmatched)`}
        </div>
      )}

      {/* Host table */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">
            <i className="ti ti-server-2" style={{ color: headerColor }} aria-hidden="true" />
            Session Hosts
            <MethodBadge method={data.method} />
          </div>
          <button onClick={load} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 13 }}>
            <i className="ti ti-refresh" aria-hidden="true" />
          </button>
        </div>
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th onClick={() => sortHosts('hostname')} style={thStyle('hostname', hostSort)}>Host</th>
                <th onClick={() => sortHosts('status')}   style={thStyle('status',   hostSort)}>Status</th>
                <th onClick={() => sortHosts('active_sessions')}       style={thStyle('active_sessions',      hostSort)}>Active</th>
                <th onClick={() => sortHosts('disconnected_sessions')} style={thStyle('disconnected_sessions', hostSort)}>Disconn.</th>
                <th onClick={() => sortHosts('cpu_pct')} style={thStyle('cpu_pct', hostSort)}>CPU</th>
                <th onClick={() => sortHosts('ram_pct')} style={thStyle('ram_pct', hostSort)}>RAM</th>
                <th onClick={() => sortHosts('load_pct')} style={thStyle('load_pct', hostSort)}>Load</th>
                {showVcCols && <th>Allocated</th>}
                {showVcCols && <th>Cluster</th>}
                {showVcCols && <th>ESXi Host</th>}
              </tr>
            </thead>
            <tbody>
              {hosts.map(h => {
                const vm = vmMap[shortName(h.hostname)] || null
                return (
                  <tr key={h.hostname}>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 12, whiteSpace: 'nowrap' }}>
                      {h.hostname}
                      {vm && <VcBadge />}
                    </td>
                    <td><StatusBadge status={h.status} /></td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 12, color: h.active_sessions > 0 ? 'var(--c-ok)' : 'var(--muted)' }}>{h.active_sessions}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 12, color: h.disconnected_sessions > 0 ? 'var(--c-warn)' : 'var(--muted)' }}>{h.disconnected_sessions}</td>
                    <td>
                      <DualBar
                        wmiPct={h.cpu_pct}
                        vcPct={vm?.cpu_util_pct ?? null}
                        warnCpu={75} critCpu={90}
                      />
                    </td>
                    <td>
                      <DualBar
                        wmiPct={h.ram_pct}
                        vcPct={vm?.ram_util_pct ?? null}
                        warnRam={80} critRam={90}
                        isRam
                      />
                    </td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>
                      {h.load_pct != null ? `${h.load_pct.toFixed(0)}%` : '—'}
                    </td>
                    {showVcCols && (
                      <td>
                        <AllocCell cpuMhz={vm?.cpu_allocated_mhz} ramMb={vm?.ram_allocated_mb} />
                      </td>
                    )}
                    {showVcCols && (
                      <td style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>
                        {vm?.cluster || '—'}
                      </td>
                    )}
                    {showVcCols && (
                      <td style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>
                        {vm ? shortName(vm.host) : '—'}
                      </td>
                    )}
                  </tr>
                )
              })}
              {hosts.length === 0 && (
                <tr><td colSpan={showVcCols ? 10 : 7} style={{ textAlign: 'center', color: 'var(--muted)', padding: '1.5rem', fontFamily: 'var(--mono)', fontSize: 12 }}>No hosts returned</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Sessions table */}
      {sessions.length > 0 && (
        <div className="card">
          <div className="card-header">
            <div className="card-title">
              <i className="ti ti-users" style={{ color: 'var(--c-blue)' }} aria-hidden="true" />
              Active &amp; Disconnected Sessions ({sessions.length})
            </div>
          </div>
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th onClick={() => sortSessions('username')}    style={thStyle('username',    sessionSort)}>Username</th>
                  <th onClick={() => sortSessions('state')}       style={thStyle('state',       sessionSort)}>State</th>
                  <th onClick={() => sortSessions('host')}        style={thStyle('host',        sessionSort)}>Host</th>
                  <th onClick={() => sortSessions('idle_minutes')} style={thStyle('idle_minutes', sessionSort)}>Idle</th>
                  <th onClick={() => sortSessions('session_id')}  style={thStyle('session_id',  sessionSort)}>ID</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((sess, i) => (
                  <tr key={`${sess.username}-${sess.host}-${sess.session_id ?? i}`}>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>
                      {sess.domain ? `${sess.domain}\\${sess.username}` : sess.username}
                    </td>
                    <td>
                      <span style={{ fontSize: 10, fontFamily: 'var(--mono)', fontWeight: 600, color: sess.state === 'Active' ? 'var(--c-ok)' : 'var(--c-warn)' }}>
                        {(sess.state || '').toUpperCase()}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>
                      {sess.host}
                      {vmMap[shortName(sess.host)] && <VcBadge />}
                    </td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>{fmt_idle(sess.idle_minutes)}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>{sess.session_id ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
