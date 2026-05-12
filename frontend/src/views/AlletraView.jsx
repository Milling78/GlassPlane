import React from 'react'
export default function AlletraView({ data }) {
  if (!data) return <div style={{ padding: '3rem', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--muted)' }}>no Alletra data</div>
  return (
    <div>
      <div className="metrics" style={{ marginBottom: '1rem' }}>
        <div className="metric"><div className="metric-label">utilisation</div><div className="metric-val">{data.util_pct}%</div><div className="metric-sub">{data.used_tb?.toFixed(1)} / {data.usable_tb?.toFixed(1)} TB</div></div>
        <div className="metric"><div className="metric-label">efficiency</div><div className="metric-val">{data.total_efficiency_ratio?.toFixed(1)}:1</div></div>
        <div className="metric"><div className="metric-label">IOPS</div><div className="metric-val">{data.iops?.toLocaleString()}</div></div>
        <div className="metric"><div className="metric-label">latency</div><div className="metric-val">{data.latency_ms}ms</div></div>
      </div>
      <div className="card">
        <div className="card-header"><div className="card-title"><i className="ti ti-database" style={{ color: 'var(--c-blue)' }} aria-hidden="true" />Volumes</div></div>
        <div className="tbl-wrap">
          <table style={{ tableLayout: 'auto' }}>
            <thead><tr><th>Name</th><th>Provisioned</th><th>Used</th><th>Util %</th><th>Dedup</th><th>Compress</th><th>Thin</th></tr></thead>
            <tbody>
              {(data.volumes ?? []).map(v => (
                <tr key={v.volume_id}>
                  <td style={{ fontWeight: 500 }}>{v.name}</td>
                  <td>{v.provisioned_gb >= 1024 ? (v.provisioned_gb/1024).toFixed(1)+'TB' : v.provisioned_gb+'GB'}</td>
                  <td>{v.used_gb >= 1024 ? (v.used_gb/1024).toFixed(1)+'TB' : v.used_gb+'GB'}</td>
                  <td style={{ color: v.util_pct > 85 ? 'var(--c-crit)' : v.util_pct > 70 ? 'var(--c-warn)' : undefined }}>{v.util_pct}%</td>
                  <td>{v.dedup_ratio?.toFixed(1)}:1</td>
                  <td>{v.compress_ratio?.toFixed(1)}:1</td>
                  <td>{v.is_thin ? 'yes' : 'no'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
