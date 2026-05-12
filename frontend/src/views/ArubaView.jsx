// ArubaView.jsx
import React from 'react'
export default function ArubaView({ data }) {
  if (!data) return <div style={{ padding: '3rem', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--muted)' }}>no Aruba data</div>
  return (
    <div>
      <div className="metrics" style={{ marginBottom: '1rem' }}>
        <div className="metric"><div className="metric-label">switches</div><div className="metric-val">{data.switch_count}</div></div>
        <div className="metric"><div className="metric-label">total ports</div><div className="metric-val">{data.total_ports}</div></div>
        <div className="metric"><div className="metric-label">unused ports</div><div className="metric-val" style={{ color: data.unused_port_pct > 20 ? 'var(--c-warn)' : undefined }}>{data.unused_ports}</div><div className="metric-sub">{data.unused_port_pct}%</div></div>
      </div>
      <div className="card">
        <div className="card-header"><div className="card-title"><i className="ti ti-network" style={{ color: 'var(--c-blue)' }} aria-hidden="true" />Switches</div></div>
        <div className="tbl-wrap">
          <table style={{ tableLayout: 'auto' }}>
            <thead><tr><th>Name</th><th>Model</th><th>Site</th><th>CPU %</th><th>Mem %</th><th>Unused ports</th><th>Status</th></tr></thead>
            <tbody>
              {(data.switches ?? []).map(s => (
                <tr key={s.device_id}>
                  <td style={{ fontWeight: 500 }}>{s.name}</td>
                  <td>{s.model}</td>
                  <td>{s.site}</td>
                  <td style={{ color: s.cpu_util_pct > 70 ? 'var(--c-warn)' : undefined }}>{s.cpu_util_pct}%</td>
                  <td>{s.mem_util_pct}%</td>
                  <td>{s.unused_ports} / {s.port_count}</td>
                  <td><span className={`badge ${s.status === 'ok' ? 'b-on' : 'b-off'}`}>{s.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
