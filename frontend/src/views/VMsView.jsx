import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { api } from '../api'

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
  { key: 'name',             label: 'VM name',    w: '18%' },
  { key: 'cluster',          label: 'cluster',    w: '12%' },
  { key: 'host',             label: 'host',       w: '14%' },
  { key: 'power_state',      label: 'state',      w: '7%'  },
  { key: 'cpu_util_pct',     label: 'CPU %',      w: '10%' },
  { key: 'ram_util_pct',     label: 'RAM %',      w: '10%' },
  { key: 'cpu_allocated_mhz',label: 'CPU alloc',  w: '9%'  },
  { key: 'ram_allocated_mb', label: 'RAM alloc',  w: '9%'  },
  { key: 'datastore_gb',     label: 'disk GB',    w: '7%'  },
  { key: 'flags',            label: 'flags',      w: '8%'  },
]

export default function VMsView({ vcenter }) {
  const [vms, setVms] = useState(vcenter?.vms ?? [])
  const [loading, setLoading] = useState(!vcenter?.vms?.length)
  const [search, setSearch] = useState('')
  const [clusterFilter, setClusterFilter] = useState('all')
  const [flagFilter, setFlagFilter] = useState('all')
  const [sortKey, setSortKey] = useState('cpu_util_pct')
  const [sortDir, setSortDir] = useState('desc')

  useEffect(() => {
    if (vcenter?.vms?.length) { setVms(vcenter.vms); return }
    setLoading(true)
    api.vcenter().then(d => { setVms(d.vms ?? []); setLoading(false) }).catch(() => setLoading(false))
  }, [vcenter])

  const clusters = useMemo(() => ['all', ...new Set(vms.map(v => v.cluster))], [vms])

  const filtered = useMemo(() => {
    let r = vms
    if (clusterFilter !== 'all') r = r.filter(v => v.cluster === clusterFilter)
    if (flagFilter === 'idle')      r = r.filter(v => v.is_idle)
    else if (flagFilter === 'oversized') r = r.filter(v => v.is_oversized)
    else if (flagFilter === 'off')  r = r.filter(v => v.power_state !== 'poweredOn')
    else if (flagFilter === 'clean') r = r.filter(v => !v.is_idle && !v.is_oversized && v.power_state === 'poweredOn')
    if (search.trim()) {
      const q = search.toLowerCase()
      r = r.filter(v => v.name.toLowerCase().includes(q) || v.host.toLowerCase().includes(q))
    }
    return [...r].sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey]
      if (typeof av === 'string') { av = av.toLowerCase(); bv = bv.toLowerCase() }
      return sortDir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1)
    })
  }, [vms, clusterFilter, flagFilter, search, sortKey, sortDir])

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const idleCount     = vms.filter(v => v.is_idle).length
  const oversizedCount= vms.filter(v => v.is_oversized).length
  const wastedRam     = Math.round(vms.filter(v => v.is_oversized).reduce((s,v) => s + (v.ram_allocated_mb - v.ram_used_mb)/1024, 0))
  const wastedCpu     = vms.filter(v => v.is_oversized).reduce((s,v) => s + (v.cpu_allocated_mhz - v.cpu_used_mhz)/1000, 0).toFixed(1)

  if (loading) return <div style={{ padding: '3rem', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--muted)' }}>loading VMs…</div>

  return (
    <div>
      {/* Stats */}
      <div className="metrics" style={{ marginBottom: '1rem' }}>
        <div className="metric"><div className="metric-label">total VMs</div><div className="metric-val">{vms.length}</div><div className="metric-sub">{vms.filter(v=>v.power_state==='poweredOn').length} powered on</div></div>
        <div className="metric"><div className="metric-label">idle VMs</div><div className="metric-val" style={{ color: idleCount > 3 ? 'var(--c-warn)' : undefined }}>{idleCount}</div><div className="metric-sub">CPU avg &lt; 5%</div></div>
        <div className="metric"><div className="metric-label">oversized VMs</div><div className="metric-val" style={{ color: oversizedCount > 3 ? 'var(--c-warn)' : undefined }}>{oversizedCount}</div></div>
        <div className="metric"><div className="metric-label">wasted RAM</div><div className="metric-val" style={{ color: wastedRam > 20 ? 'var(--c-warn)' : undefined }}>{wastedRam}GB</div></div>
        <div className="metric"><div className="metric-label">wasted CPU</div><div className="metric-val">{wastedCpu}GHz</div></div>
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="search name or host…" style={{ flex: 1, minWidth: 180, fontSize: 13 }} />
        <select value={clusterFilter} onChange={e => setClusterFilter(e.target.value)} style={{ fontSize: 13 }}>
          {clusters.map(c => <option key={c} value={c}>{c === 'all' ? 'all clusters' : c}</option>)}
        </select>
        <select value={flagFilter} onChange={e => setFlagFilter(e.target.value)} style={{ fontSize: 13 }}>
          <option value="all">all VMs</option>
          <option value="idle">idle only</option>
          <option value="oversized">oversized only</option>
          <option value="off">powered off</option>
          <option value="clean">healthy only</option>
        </select>
        <span style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>{filtered.length} of {vms.length}</span>
        <button onClick={() => exportCSV(filtered)} style={{ fontSize: 12 }}>
          <i className="ti ti-download" style={{ marginRight: 4 }} aria-hidden="true" />export CSV
        </button>
      </div>

      {/* Table */}
      <div className="card">
        <div className="tbl-wrap">
          <table>
            <colgroup>{COLS.map(c => <col key={c.key} style={{ width: c.w }} />)}</colgroup>
            <thead>
              <tr>
                {COLS.map(c => (
                  <th key={c.key} onClick={() => toggleSort(c.key)}
                    style={{ color: sortKey === c.key ? 'var(--c-blue)' : undefined }}>
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
                ? <tr><td colSpan={10} style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)', fontFamily: 'var(--mono)' }}>no VMs match filters</td></tr>
                : filtered.map(vm => {
                  const off = vm.power_state !== 'poweredOn'
                  return (
                    <tr key={vm.vm_id}>
                      <td title={vm.name} style={{ fontWeight: 500 }}>{vm.name}</td>
                      <td>{vm.cluster}</td>
                      <td>{vm.host}</td>
                      <td><span className={`badge ${off ? 'b-off' : 'b-on'}`}>{off ? 'off' : 'on'}</span></td>
                      <td><UtilCell pct={Math.round(vm.cpu_util_pct)} off={off} /></td>
                      <td><UtilCell pct={Math.round(vm.ram_util_pct)} off={off} /></td>
                      <td>{vm.cpu_allocated_mhz >= 1000 ? (vm.cpu_allocated_mhz/1000).toFixed(1)+'GHz' : vm.cpu_allocated_mhz+'MHz'}</td>
                      <td>{vm.ram_allocated_mb >= 1024 ? Math.round(vm.ram_allocated_mb/1024)+'GB' : vm.ram_allocated_mb+'MB'}</td>
                      <td>{Math.round(vm.datastore_gb)}GB</td>
                      <td>
                        <div style={{ display: 'flex', gap: 3 }}>
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
  )
}
