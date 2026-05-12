import React, { useState, useEffect } from 'react'
import { api } from '../api'
import Sparkline from '../components/Sparkline'

const STATUS_CLS = { Success: 'b-on', Warning: 'b-idle', Failed: 'b-oversized', Running: 'b-off', None: 'b-off' }

const RANGES = [
  { label: '24h', hours: 24 },
  { label: '3d',  hours: 72 },
  { label: '7d',  hours: 168 },
]

function TrendRow({ label, data, color, unit = '' }) {
  const vals = data.filter(v => v != null)
  const last = vals[vals.length - 1]
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)', marginBottom: 4 }}>
        <span>{label}</span>
        {last != null && <span style={{ color: 'var(--text)' }}>{typeof last === 'number' && !Number.isInteger(last) ? last.toFixed(1) : last}{unit}</span>}
      </div>
      <Sparkline data={data} color={color} height={36} />
    </div>
  )
}

export default function VeeamView({ data }) {
  const [hours, setHours] = useState(24)
  const [history, setHistory] = useState([])

  useEffect(() => {
    api.history(hours).then(d => setHistory(d.points ?? [])).catch(() => setHistory([]))
  }, [hours])

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
        <div className="card-header">
          <div className="card-title"><i className="ti ti-chart-line" style={{ color: 'var(--c-blue)' }} aria-hidden="true" />Trends</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {RANGES.map(r => (
              <button
                key={r.hours}
                onClick={() => setHours(r.hours)}
                style={{
                  fontSize: 11, fontFamily: 'var(--mono)', padding: '2px 8px',
                  borderRadius: 4, border: '0.5px solid var(--border)',
                  background: hours === r.hours ? 'var(--c-blue)' : 'transparent',
                  color: hours === r.hours ? '#fff' : 'var(--muted)',
                  cursor: 'pointer',
                }}
              >{r.label}</button>
            ))}
          </div>
        </div>
        <div className="card-body">
          {history.length < 2
            ? <div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>no history yet — snapshots collect every 15 min</div>
            : <>
                <TrendRow label="failed jobs" data={history.map(p => p.veeam_failed)} color="var(--c-crit)" />
                <TrendRow label="repo utilisation %" data={history.map(p => p.veeam_repo_pct)} color="var(--c-blue)" unit="%" />
                <TrendRow label="protected VMs" data={history.map(p => p.veeam_protected)} color="var(--c-green)" />
              </>
          }
        </div>
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
