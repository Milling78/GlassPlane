import React from 'react'
const STATUS_CLS = { Success: 'b-on', Warning: 'b-idle', Failed: 'b-oversized', Running: 'b-off', None: 'b-off' }
export default function VeeamView({ data }) {
  if (!data) return <div style={{ padding: '3rem', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--muted)' }}>no Veeam data</div>
  return (
    <div>
      <div className="metrics" style={{ marginBottom: '1rem' }}>
        <div className="metric"><div className="metric-label">protected VMs</div><div className="metric-val">{data.protected_vms}</div><div className="metric-sub" style={{ color: data.unprotected_vms > 0 ? 'var(--c-warn)' : undefined }}>{data.unprotected_vms} unprotected</div></div>
        <div className="metric"><div className="metric-label">failed jobs</div><div className="metric-val" style={{ color: data.failed_jobs > 0 ? 'var(--c-crit)' : undefined }}>{data.failed_jobs}</div></div>
        <div className="metric"><div className="metric-label">warnings</div><div className="metric-val" style={{ color: data.warning_jobs > 0 ? 'var(--c-warn)' : undefined }}>{data.warning_jobs}</div></div>
        <div className="metric"><div className="metric-label">repo used</div><div className="metric-val">{data.repo_util_pct}%</div><div className="metric-sub">{Math.round(data.total_repo_used_gb/1024)} / {Math.round(data.total_repo_capacity_gb/1024)} TB</div></div>
      </div>
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="card-header"><div className="card-title"><i className="ti ti-cloud-upload" style={{ color: 'var(--c-blue)' }} aria-hidden="true" />Backup jobs</div></div>
        <div className="tbl-wrap">
          <table style={{ tableLayout: 'auto' }}>
            <thead><tr><th>Name</th><th>Type</th><th>Status</th><th>Last run</th><th>Data</th><th>Dedup</th><th>Compress</th></tr></thead>
            <tbody>
              {(data.jobs ?? []).map(j => (
                <tr key={j.job_id}>
                  <td style={{ fontWeight: 500 }}>{j.name}</td>
                  <td>{j.type}</td>
                  <td><span className={`badge ${STATUS_CLS[j.status] ?? 'b-off'}`}>{j.status}</span></td>
                  <td style={{ color: 'var(--muted)', fontSize: 11 }}>{j.last_run ? new Date(j.last_run).toLocaleString() : '—'}</td>
                  <td>{j.data_size_gb > 0 ? j.data_size_gb.toFixed(0)+'GB' : '—'}</td>
                  <td>{j.dedupe_ratio?.toFixed(1)}:1</td>
                  <td>{j.compress_ratio?.toFixed(1)}:1</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <div className="card-header"><div className="card-title"><i className="ti ti-server" style={{ color: 'var(--c-blue)' }} aria-hidden="true" />Repositories</div></div>
        <div className="tbl-wrap">
          <table style={{ tableLayout: 'auto' }}>
            <thead><tr><th>Name</th><th>Host</th><th>Capacity</th><th>Used</th><th>Free</th><th>Util %</th></tr></thead>
            <tbody>
              {(data.repositories ?? []).map(r => (
                <tr key={r.repo_id}>
                  <td style={{ fontWeight: 500 }}>{r.name}</td>
                  <td>{r.host}</td>
                  <td>{Math.round(r.capacity_gb/1024)}TB</td>
                  <td>{Math.round(r.used_gb/1024)}TB</td>
                  <td>{Math.round(r.free_gb/1024)}TB</td>
                  <td style={{ color: r.util_pct > 85 ? 'var(--c-crit)' : r.util_pct > 70 ? 'var(--c-warn)' : undefined }}>{r.util_pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
