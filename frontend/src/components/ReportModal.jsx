import React, { useRef } from 'react'

const HEADROOM = 1.3  // 30% buffer above peak usage

function recommend(vm) {
  if (vm.is_idle) {
    return {
      action: 'Decommission / suspend',
      recCpuMhz: null,
      recRamMb:  null,
      saveCpuMhz: vm.cpu_allocated_mhz,
      saveRamMb:  vm.ram_allocated_mb,
      severity: 'critical',
    }
  }
  if (vm.is_oversized) {
    const recCpu = Math.max(Math.round((vm.cpu_used_mhz * HEADROOM) / 500) * 500, 500)
    const recRam = Math.max(Math.round((vm.ram_used_mb  * HEADROOM) / 512) * 512, 512)
    return {
      action: 'Right-size',
      recCpuMhz: recCpu,
      recRamMb:  recRam,
      saveCpuMhz: Math.max(vm.cpu_allocated_mhz - recCpu, 0),
      saveRamMb:  Math.max(vm.ram_allocated_mb  - recRam, 0),
      severity: 'warning',
    }
  }
  return {
    action: 'No action needed',
    recCpuMhz: vm.cpu_allocated_mhz,
    recRamMb:  vm.ram_allocated_mb,
    saveCpuMhz: 0,
    saveRamMb:  0,
    severity: 'ok',
  }
}

function fmtCpu(mhz) {
  if (mhz == null) return '—'
  return mhz >= 1000 ? (mhz / 1000).toFixed(1) + ' GHz' : mhz + ' MHz'
}
function fmtRam(mb) {
  if (mb == null) return '—'
  return mb >= 1024 ? Math.round(mb / 1024) + ' GB' : mb + ' MB'
}

function exportCSV(rows) {
  const hdr = [
    'VM Name','Cluster','Host','Issue','Action',
    'Current CPU','Current RAM','Rec. CPU','Rec. RAM',
    'Save CPU','Save RAM','Save CPU (GHz)','Save RAM (GB)',
  ]
  const data = rows.map(({ vm, rec }) => [
    vm.name, vm.cluster, vm.host,
    vm.is_idle ? 'idle' : vm.is_oversized ? 'oversized' : 'healthy',
    rec.action,
    fmtCpu(vm.cpu_allocated_mhz), fmtRam(vm.ram_allocated_mb),
    fmtCpu(rec.recCpuMhz), fmtRam(rec.recRamMb),
    fmtCpu(rec.saveCpuMhz), fmtRam(rec.saveRamMb),
    (rec.saveCpuMhz / 1000).toFixed(2),
    (rec.saveRamMb  / 1024).toFixed(2),
  ])
  const csv = [hdr, ...data].map(r => r.map(v => `"${v}"`).join(',')).join('\n')
  const a = document.createElement('a')
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv)
  a.download = `vm_rightsizing_${new Date().toISOString().slice(0,10)}.csv`
  a.click()
}

const SEV = {
  critical: { color: 'var(--c-crit)', bg: '#fee2e2' },
  warning:  { color: 'var(--c-warn)', bg: '#fef3c7' },
  ok:       { color: 'var(--c-green)', bg: '#dcfce7' },
}

export default function ReportModal({ vms, onClose }) {
  const printRef = useRef()

  const rows = vms.map(vm => ({ vm, rec: recommend(vm) }))
  const totalSaveCpuGhz = rows.reduce((s, r) => s + r.rec.saveCpuMhz / 1000, 0).toFixed(1)
  const totalSaveRamGb  = rows.reduce((s, r) => s + r.rec.saveRamMb  / 1024, 0).toFixed(1)
  const actionCount     = rows.filter(r => r.rec.severity !== 'ok').length
  const reportDate      = new Date().toLocaleString()

  function handlePrint() {
    const w = window.open('', '_blank')
    w.document.write(`<!DOCTYPE html><html><head>
<title>VM Right-Sizing Report</title>
<style>
  body { font-family: system-ui, sans-serif; font-size: 13px; color: #111; margin: 32px; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  .sub { color: #666; font-size: 12px; margin-bottom: 24px; }
  .summary { display: flex; gap: 32px; margin-bottom: 24px; }
  .stat { }
  .stat-val { font-size: 28px; font-weight: 700; }
  .stat-lbl { font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: .05em; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; border-bottom: 2px solid #e5e7eb; padding: 6px 8px; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #666; }
  td { padding: 6px 8px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  .badge { display: inline-block; padding: 1px 7px; border-radius: 3px; font-size: 10px; font-weight: 600; }
  .b-crit { background: #fee2e2; color: #991b1b; }
  .b-warn { background: #fef3c7; color: #92400e; }
  .b-ok   { background: #dcfce7; color: #166534; }
  .save { font-weight: 600; color: #166534; }
  .total td { font-weight: 700; border-top: 2px solid #e5e7eb; background: #f9fafb; }
  @media print { body { margin: 16px; } }
</style></head><body>
<h1>VM Right-Sizing Report</h1>
<div class="sub">Generated ${reportDate} &nbsp;·&nbsp; ${vms.length} VM${vms.length !== 1 ? 's' : ''} analysed</div>
<div class="summary">
  <div class="stat"><div class="stat-val">${actionCount}</div><div class="stat-lbl">VMs requiring action</div></div>
  <div class="stat"><div class="stat-val">${totalSaveCpuGhz} GHz</div><div class="stat-lbl">potential CPU reclaim</div></div>
  <div class="stat"><div class="stat-val">${totalSaveRamGb} GB</div><div class="stat-lbl">potential RAM reclaim</div></div>
</div>
<table>
  <thead><tr>
    <th>VM Name</th><th>Cluster</th><th>Issue</th><th>Action</th>
    <th>Current CPU</th><th>Current RAM</th><th>Rec. CPU</th><th>Rec. RAM</th>
    <th>Save CPU</th><th>Save RAM</th>
  </tr></thead>
  <tbody>
    ${rows.map(({ vm, rec }) => `<tr>
      <td><strong>${vm.name}</strong></td>
      <td>${vm.cluster}</td>
      <td><span class="badge ${rec.severity === 'critical' ? 'b-crit' : rec.severity === 'warning' ? 'b-warn' : 'b-ok'}">${vm.is_idle ? 'idle' : vm.is_oversized ? 'oversized' : 'healthy'}</span></td>
      <td>${rec.action}</td>
      <td>${fmtCpu(vm.cpu_allocated_mhz)}</td>
      <td>${fmtRam(vm.ram_allocated_mb)}</td>
      <td>${fmtCpu(rec.recCpuMhz)}</td>
      <td>${fmtRam(rec.recRamMb)}</td>
      <td class="save">${rec.saveCpuMhz > 0 ? fmtCpu(rec.saveCpuMhz) : '—'}</td>
      <td class="save">${rec.saveRamMb  > 0 ? fmtRam(rec.saveRamMb)  : '—'}</td>
    </tr>`).join('')}
    <tr class="total">
      <td colspan="8">Total potential savings</td>
      <td>${totalSaveCpuGhz} GHz</td>
      <td>${totalSaveRamGb} GB</td>
    </tr>
  </tbody>
</table>
<p style="margin-top:24px;font-size:11px;color:#999;">CPU recommendations include 30% headroom above peak observed usage. Idle VMs show full allocation as reclaimable. Validate recommendations before applying changes in production.</p>
</body></html>`)
    w.document.close()
    w.focus()
    w.print()
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.55)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: 'var(--surface)', borderRadius: 10, border: '0.5px solid var(--border)',
        width: '100%', maxWidth: 960, maxHeight: '90vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>VM Right-Sizing Report</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)', marginTop: 2 }}>{reportDate} · {vms.length} VM{vms.length !== 1 ? 's' : ''} analysed</div>
          </div>
          <button onClick={() => exportCSV(rows)} style={{ fontSize: 12, padding: '4px 12px' }}>
            <i className="ti ti-download" style={{ marginRight: 4 }} aria-hidden="true" />Export CSV
          </button>
          <button onClick={handlePrint} style={{ fontSize: 12, padding: '4px 12px' }}>
            <i className="ti ti-printer" style={{ marginRight: 4 }} aria-hidden="true" />Print / PDF
          </button>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: 18, cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}>×</button>
        </div>

        {/* Summary */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '0.5px solid var(--border)' }}>
          {[
            { label: 'VMs requiring action', val: actionCount, color: actionCount > 0 ? 'var(--c-warn)' : 'var(--c-green)' },
            { label: 'Potential CPU reclaim', val: totalSaveCpuGhz + ' GHz', color: 'var(--text)' },
            { label: 'Potential RAM reclaim', val: totalSaveRamGb + ' GB',   color: 'var(--text)' },
          ].map((s, i) => (
            <div key={i} style={{ flex: 1, padding: '14px 20px', borderRight: i < 2 ? '0.5px solid var(--border)' : 'none' }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.val}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)', marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Table */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
                {['VM Name','Cluster','Issue','Action','Current CPU','Current RAM','Rec. CPU','Rec. RAM','Save CPU','Save RAM'].map(h => (
                  <th key={h} style={{ padding: '8px 12px', borderBottom: '0.5px solid var(--border)', textAlign: 'left', fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ vm, rec }, i) => {
                const sev = SEV[rec.severity]
                return (
                  <tr key={vm.vm_id} style={{ background: i % 2 === 0 ? 'transparent' : 'var(--bg)' }}>
                    <td style={{ padding: '7px 12px', fontWeight: 500 }}>{vm.name}</td>
                    <td style={{ padding: '7px 12px', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 11 }}>{vm.cluster}</td>
                    <td style={{ padding: '7px 12px' }}>
                      <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 3, background: sev.bg, color: sev.color }}>
                        {vm.is_idle ? 'idle' : vm.is_oversized ? 'oversized' : 'healthy'}
                      </span>
                    </td>
                    <td style={{ padding: '7px 12px', fontSize: 11 }}>{rec.action}</td>
                    <td style={{ padding: '7px 12px', fontFamily: 'var(--mono)', fontSize: 11 }}>{fmtCpu(vm.cpu_allocated_mhz)}</td>
                    <td style={{ padding: '7px 12px', fontFamily: 'var(--mono)', fontSize: 11 }}>{fmtRam(vm.ram_allocated_mb)}</td>
                    <td style={{ padding: '7px 12px', fontFamily: 'var(--mono)', fontSize: 11 }}>{fmtCpu(rec.recCpuMhz)}</td>
                    <td style={{ padding: '7px 12px', fontFamily: 'var(--mono)', fontSize: 11 }}>{fmtRam(rec.recRamMb)}</td>
                    <td style={{ padding: '7px 12px', fontFamily: 'var(--mono)', fontSize: 11, color: rec.saveCpuMhz > 0 ? 'var(--c-green)' : 'var(--muted)' }}>
                      {rec.saveCpuMhz > 0 ? fmtCpu(rec.saveCpuMhz) : '—'}
                    </td>
                    <td style={{ padding: '7px 12px', fontFamily: 'var(--mono)', fontSize: 11, color: rec.saveRamMb > 0 ? 'var(--c-green)' : 'var(--muted)' }}>
                      {rec.saveRamMb > 0 ? fmtRam(rec.saveRamMb) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '0.5px solid var(--border)', background: 'var(--bg)' }}>
                <td colSpan={8} style={{ padding: '8px 12px', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>Total potential savings</td>
                <td style={{ padding: '8px 12px', fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, color: 'var(--c-green)' }}>{totalSaveCpuGhz} GHz</td>
                <td style={{ padding: '8px 12px', fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, color: 'var(--c-green)' }}>{totalSaveRamGb} GB</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Footer note */}
        <div style={{ padding: '10px 20px', borderTop: '0.5px solid var(--border)', fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
          CPU recommendations include 30% headroom above peak observed usage. Validate before applying changes in production.
        </div>
      </div>
    </div>
  )
}
