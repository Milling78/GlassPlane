import React, { useState, useEffect, useMemo } from 'react'
import { api } from '../api'
import ReportModal from '../components/ReportModal'

function UtilCell({ pct, off }) {
  const barCls = off ? 'bar-off' : pct > 85 ? 'bar-crit' : pct > 70 ? 'bar-warn' : 'bar-ok'
  const pctCls = off ? 'muted-text' : pct > 85 ? 'crit-text' : pct > 70 ? 'warn-text' : ''
  return (
    <div className="util-cell">
      <div className="util-bar">
        <div className={`bar-fill ${barCls}`} style={{ width: (off ? 0 : pct) + '%' }} />
      </div>
      <span className={`util-pct ${pctCls}`}>{off ? '—' : pct + '%'}</span>
    </div>
  )
}

function Chip({ label, active, onClick, color }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: 11, fontFamily: 'var(--mono)', padding: '3px 10px',
        borderRadius: 12, border: `0.5px solid ${active ? (color ?? 'var(--c-blue)') : 'var(--border)'}`,
        background: active ? (color ?? 'var(--c-blue)') : 'transparent',
        color: active ? '#fff' : 'var(--muted)',
        cursor: 'pointer', transition: 'all 0.1s',
      }}
    >{label}</button>
  )
}

function ThresholdInput({ label, value, onChange, unit = '%' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>
      <span>{label} ≥</span>
      <input
        type="number" min={0} max={100} value={value}
        onChange={e => onChange(Math.max(0, Math.min(100, Number(e.target.value))))}
        style={{ width: 48, fontSize: 12, padding: '3px 6px', textAlign: 'right' }}
      />
      <span>{unit}</span>
    </div>
  )
}

function exportCSV(vms) {
  const hdr = ['Name','Cluster','Host','State','CPU%','RAM%','CPU Alloc','RAM Alloc','Disk GB','Idle','Oversized']
  const rows = vms.map(v => [v.name,v.cluster,v.host,v.power_state,
    Math.round(v.cpu_util_pct),Math.round(v.ram_util_pct),v.cpu_allocated_mhz,v.ram_allocated_mb,
    Math.round(v.datastore_gb),v.is_idle?'yes':'no',v.is_oversized?'yes':'no'])
  const csv = [hdr,...rows].map(r=>r.join(',')).join('\n')
  const a = document.createElement('a')
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv)
  a.download = 'vm_inventory.csv'; a.click()
}

const COLS = [
  { key: '_sel',             label: '',           w: '3%'  },
  { key: 'name',             label: 'VM name',    w: '17%' },
  { key: 'cluster',          label: 'cluster',    w: '10%' },
  { key: 'host',             label: 'host',       w: '12%' },
  { key: 'power_state',      label: 'state',      w: '6%'  },
  { key: 'cpu_util_pct',     label: 'CPU %',      w: '9%'  },
  { key: 'ram_util_pct',     label: 'RAM %',      w: '9%'  },
  { key: 'cpu_allocated_mhz',label: 'CPU alloc',  w: '9%'  },
  { key: 'ram_allocated_mb', label: 'RAM alloc',  w: '8%'  },
  { key: 'datastore_gb',     label: 'disk GB',    w: '7%'  },
  { key: 'flags',            label: 'flags',      w: '10%' },
]

// Which flags are active for a given VM
function vmFlags(v) {
  const f = new Set()
  if (v.is_idle)                     f.add('idle')
  if (v.is_oversized)                f.add('oversized')
  if (v.power_state !== 'poweredOn') f.add('off')
  if (!v.is_idle && !v.is_oversized && v.power_state === 'poweredOn') f.add('healthy')
  return f
}

const FLAG_COLORS = {
  idle:      'var(--c-warn)',
  oversized: '#a855f7',
  off:       'var(--muted)',
  healthy:   'var(--c-green)',
}

export default function VMsView({ vcenter }) {
  const [vms, setVms] = useState(vcenter?.vms ?? [])
  const [loading, setLoading] = useState(!vcenter?.vms?.length)
  const [search, setSearch] = useState('')
  const [clusterFilter, setClusterFilter] = useState('all')
  const [hostFilter, setHostFilter] = useState('all')
  const [activeFlags, setActiveFlags] = useState(new Set())  // empty = show all
  const [cpuMin, setCpuMin] = useState(0)
  const [ramMin, setRamMin] = useState(0)
  const [sortKey, setSortKey] = useState('cpu_util_pct')
  const [sortDir, setSortDir] = useState('desc')
  const [selected, setSelected] = useState(new Set())
  const [showReport, setShowReport] = useState(false)

  useEffect(() => {
    if (vcenter?.vms?.length) { setVms(vcenter.vms); return }
    setLoading(true)
    api.vcenter().then(d => { setVms(d.vms ?? []); setLoading(false) }).catch(() => setLoading(false))
  }, [vcenter])

  const clusters = useMemo(() => ['all', ...new Set(vms.map(v => v.cluster))], [vms])
  const hosts    = useMemo(() => {
    const src = clusterFilter === 'all' ? vms : vms.filter(v => v.cluster === clusterFilter)
    return ['all', ...new Set(src.map(v => v.host))]
  }, [vms, clusterFilter])

  function toggleFlag(flag) {
    setActiveFlags(prev => {
      const next = new Set(prev)
      next.has(flag) ? next.delete(flag) : next.add(flag)
      return next
    })
  }

  function clearFilters() {
    setSearch('')
    setClusterFilter('all')
    setHostFilter('all')
    setActiveFlags(new Set())
    setCpuMin(0)
    setRamMin(0)
  }

  const isFiltered = search || clusterFilter !== 'all' || hostFilter !== 'all' || activeFlags.size > 0 || cpuMin > 0 || ramMin > 0

  const filtered = useMemo(() => {
    let r = vms
    if (clusterFilter !== 'all') r = r.filter(v => v.cluster === clusterFilter)
    if (hostFilter !== 'all')    r = r.filter(v => v.host === hostFilter)
    if (activeFlags.size > 0)    r = r.filter(v => [...activeFlags].some(f => vmFlags(v).has(f)))
    if (cpuMin > 0) r = r.filter(v => v.power_state === 'poweredOn' && v.cpu_util_pct >= cpuMin)
    if (ramMin > 0) r = r.filter(v => v.power_state === 'poweredOn' && v.ram_util_pct >= ramMin)
    if (search.trim()) {
      const q = search.toLowerCase()
      r = r.filter(v => v.name.toLowerCase().includes(q) || v.host.toLowerCase().includes(q) || v.cluster.toLowerCase().includes(q))
    }
    return [...r].sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey]
      if (typeof av === 'string') { av = av.toLowerCase(); bv = bv.toLowerCase() }
      return sortDir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1)
    })
  }, [vms, clusterFilter, hostFilter, activeFlags, cpuMin, ramMin, search, sortKey, sortDir])

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const allFilteredSelected = filtered.length > 0 && filtered.every(v => selected.has(v.vm_id))

  function toggleSelectAll() {
    setSelected(prev => {
      const next = new Set(prev)
      if (allFilteredSelected) filtered.forEach(v => next.delete(v.vm_id))
      else                     filtered.forEach(v => next.add(v.vm_id))
      return next
    })
  }

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const selectedVms = vms.filter(v => selected.has(v.vm_id))

  const idleCount      = vms.filter(v => v.is_idle).length
  const oversizedCount = vms.filter(v => v.is_oversized).length
  const wastedRam      = Math.round(vms.filter(v => v.is_oversized).reduce((s,v) => s + (v.ram_allocated_mb - v.ram_used_mb)/1024, 0))
  const wastedCpu      = vms.filter(v => v.is_oversized).reduce((s,v) => s + (v.cpu_allocated_mhz - v.cpu_used_mhz)/1000, 0).toFixed(1)

  if (loading) return <div style={{ padding: '3rem', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--muted)' }}>loading VMs…</div>

  return (
    <>
    <div>
      {/* Stats — clickable to set quick filters */}
      <div className="metrics" style={{ marginBottom: '1rem' }}>
        <div className="metric"><div className="metric-label">total VMs</div><div className="metric-val">{vms.length}</div><div className="metric-sub">{vms.filter(v=>v.power_state==='poweredOn').length} powered on</div></div>
        <div className="metric" style={{ cursor: 'pointer' }} title="filter to idle VMs" onClick={() => toggleFlag('idle')}>
          <div className="metric-label">idle</div>
          <div className="metric-val" style={{ color: idleCount > 3 ? 'var(--c-warn)' : undefined }}>{idleCount}</div>
          <div className="metric-sub">CPU avg &lt; 5%</div>
        </div>
        <div className="metric" style={{ cursor: 'pointer' }} title="filter to oversized VMs" onClick={() => toggleFlag('oversized')}>
          <div className="metric-label">oversized</div>
          <div className="metric-val" style={{ color: oversizedCount > 3 ? 'var(--c-warn)' : undefined }}>{oversizedCount}</div>
        </div>
        <div className="metric"><div className="metric-label">wasted RAM</div><div className="metric-val" style={{ color: wastedRam > 20 ? 'var(--c-warn)' : undefined }}>{wastedRam}GB</div></div>
        <div className="metric"><div className="metric-label">wasted CPU</div><div className="metric-val">{wastedCpu}GHz</div></div>
      </div>

      {/* Toolbar row 1: search + dropdowns */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="search name, host or cluster…"
          style={{ flex: 1, minWidth: 200, fontSize: 13 }}
        />
        <select value={clusterFilter} onChange={e => { setClusterFilter(e.target.value); setHostFilter('all') }} style={{ fontSize: 13 }}>
          {clusters.map(c => <option key={c} value={c}>{c === 'all' ? 'all clusters' : c}</option>)}
        </select>
        <select value={hostFilter} onChange={e => setHostFilter(e.target.value)} style={{ fontSize: 13 }}>
          {hosts.map(h => <option key={h} value={h}>{h === 'all' ? 'all hosts' : h}</option>)}
        </select>
      </div>

      {/* Toolbar row 2: flag chips + thresholds + count */}
      <div style={{ display: 'flex', gap: 8, marginBottom: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>show:</span>
        {['idle','oversized','off','healthy'].map(f => (
          <Chip key={f} label={f} active={activeFlags.has(f)} color={FLAG_COLORS[f]} onClick={() => toggleFlag(f)} />
        ))}
        <div style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 4px' }} />
        <ThresholdInput label="CPU" value={cpuMin} onChange={setCpuMin} />
        <ThresholdInput label="RAM" value={ramMin} onChange={setRamMin} />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>
            {filtered.length} of {vms.length}
          </span>
          {isFiltered && (
            <button onClick={clearFilters} style={{ fontSize: 11, color: 'var(--muted)', background: 'transparent', border: '0.5px solid var(--border)', borderRadius: 4, padding: '2px 8px', cursor: 'pointer' }}>
              clear
            </button>
          )}
          {selected.size > 0 && (
            <button
              onClick={() => setShowReport(true)}
              style={{ fontSize: 12, padding: '3px 12px', background: 'var(--c-blue)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontFamily: 'var(--mono)' }}
            >
              <i className="ti ti-report-analytics" style={{ marginRight: 4 }} aria-hidden="true" />
              Report ({selected.size})
            </button>
          )}
          <button onClick={() => exportCSV(filtered)} style={{ fontSize: 12 }}>
            <i className="ti ti-download" style={{ marginRight: 4 }} aria-hidden="true" />export CSV
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="card">
        <div className="tbl-wrap">
          <table>
            <colgroup>{COLS.map(c => <col key={c.key} style={{ width: c.w }} />)}</colgroup>
            <thead>
              <tr>
                <th style={{ width: '3%', padding: '6px 8px' }}>
                  <input type="checkbox" checked={allFilteredSelected} onChange={toggleSelectAll}
                    title={allFilteredSelected ? 'Deselect all' : 'Select all filtered'}
                    style={{ cursor: 'pointer' }} />
                </th>
                {COLS.filter(c => c.key !== '_sel').map(c => (
                  <th key={c.key} onClick={() => toggleSort(c.key)}
                    style={{ cursor: 'pointer', color: sortKey === c.key ? 'var(--c-blue)' : undefined }}>
                    {c.label}
                    <span style={{ opacity: sortKey === c.key ? 1 : 0.3, marginLeft: 3, fontSize: 10 }}>
                      {sortKey === c.key ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0
                ? <tr><td colSpan={11} style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)', fontFamily: 'var(--mono)' }}>no VMs match filters</td></tr>
                : filtered.map(vm => {
                  const off = vm.power_state !== 'poweredOn'
                  const isSel = selected.has(vm.vm_id)
                  return (
                    <tr key={vm.vm_id} style={{ background: isSel ? 'color-mix(in srgb, var(--c-blue) 8%, transparent)' : undefined }}>
                      <td style={{ padding: '6px 8px' }}>
                        <input type="checkbox" checked={isSel} onChange={() => toggleSelect(vm.vm_id)} style={{ cursor: 'pointer' }} />
                      </td>
                      <td title={vm.name} style={{ fontWeight: 500 }}>{vm.name}</td>
                      <td>{vm.cluster}</td>
                      <td style={{ fontSize: 11, color: 'var(--muted)' }}>{vm.host}</td>
                      <td><span className={`badge ${off ? 'b-off' : 'b-on'}`}>{off ? 'off' : 'on'}</span></td>
                      <td><UtilCell pct={Math.round(vm.cpu_util_pct)} off={off} /></td>
                      <td><UtilCell pct={Math.round(vm.ram_util_pct)} off={off} /></td>
                      <td>{vm.cpu_allocated_mhz >= 1000 ? (vm.cpu_allocated_mhz/1000).toFixed(1)+'GHz' : vm.cpu_allocated_mhz+'MHz'}</td>
                      <td>{vm.ram_allocated_mb >= 1024 ? Math.round(vm.ram_allocated_mb/1024)+'GB' : vm.ram_allocated_mb+'MB'}</td>
                      <td>{Math.round(vm.datastore_gb)}GB</td>
                      <td>
                        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                          {vm.is_idle      && <span className="badge b-idle">idle</span>}
                          {vm.is_oversized && <span className="badge b-oversized">oversized</span>}
                          {off             && <span className="badge b-off">off</span>}
                          {!vm.is_idle && !vm.is_oversized && !off && <span className="badge b-ok">ok</span>}
                        </div>
                      </td>
                    </tr>
                  )
                })
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>

    {showReport && (
      <ReportModal vms={selectedVms} onClose={() => setShowReport(false)} />
    )}
    </>
  )
}
