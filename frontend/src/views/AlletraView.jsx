import React, { useState, useEffect } from 'react'
import { api } from '../api'
import Sparkline from '../components/Sparkline'
import VolumeDetailModal from '../components/VolumeDetailModal'

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
        {last != null && <span style={{ color: 'var(--text)' }}>{typeof last === 'number' ? last.toFixed(1) : last}{unit}</span>}
      </div>
      <Sparkline data={data} color={color} height={36} />
    </div>
  )
}

export default function AlletraView({ data }) {
  const [hours, setHours] = useState(24)
  const [history, setHistory] = useState([])
  const [selectedVolume, setSelectedVolume] = useState(null)

  useEffect(() => {
    api.history(hours).then(d => setHistory(d.points ?? [])).catch(() => setHistory([]))
  }, [hours])

  if (!data) return <div style={{ padding: '3rem', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--muted)' }}>no Alletra data</div>
  return (
    <div>
      <div className="metrics" style={{ marginBottom: '1rem' }}>
        <div className="metric"><div className="metric-label">utilisation</div><div className="metric-val">{data.util_pct}%</div><div className="metric-sub">{data.used_tb?.toFixed(1)} / {data.usable_tb?.toFixed(1)} TB</div></div>
        <div className="metric"><div className="metric-label">efficiency</div><div className="metric-val">{data.total_efficiency_ratio?.toFixed(1)}:1</div></div>
        <div className="metric"><div className="metric-label">IOPS</div><div className="metric-val">{data.iops?.toLocaleString()}</div></div>
        <div className="metric"><div className="metric-label">latency</div><div className="metric-val">{data.latency_ms}ms</div></div>
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
                <TrendRow label="utilisation %" data={history.map(p => p.al_util_pct)} color="var(--c-blue)" unit="%" />
                <TrendRow label="IOPS" data={history.map(p => p.al_iops)} color="var(--c-green)" />
                <TrendRow label="latency (ms)" data={history.map(p => p.al_latency)} color="var(--c-warn)" unit="ms" />
              </>
          }
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><i className="ti ti-database" style={{ color: 'var(--c-blue)' }} aria-hidden="true" />Volumes</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>click row to drill down</div>
        </div>
        <div className="tbl-wrap">
          <table style={{ tableLayout: 'auto' }}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Provisioned</th>
                <th>Used</th>
                <th>Util %</th>
                <th>Dedup</th>
                <th>Compress</th>
                <th>Savings</th>
                <th>Type</th>
                <th>Host</th>
              </tr>
            </thead>
            <tbody>
              {(data.volumes ?? []).map(v => (
                <tr
                  key={v.volume_id}
                  onClick={() => setSelectedVolume(v)}
                  style={{ cursor: 'pointer' }}
                >
                  <td style={{ fontWeight: 500 }}>{v.name}</td>
                  <td>{v.provisioned_gb >= 1024 ? (v.provisioned_gb/1024).toFixed(1)+' TB' : v.provisioned_gb+' GB'}</td>
                  <td>{v.used_gb >= 1024 ? (v.used_gb/1024).toFixed(1)+' TB' : v.used_gb.toFixed(1)+' GB'}</td>
                  <td style={{ color: v.util_pct > 85 ? 'var(--c-crit)' : v.util_pct > 70 ? 'var(--c-warn)' : undefined }}>{v.util_pct}%</td>
                  <td>{v.dedup_ratio?.toFixed(2)}:1</td>
                  <td>{v.compress_ratio?.toFixed(2)}:1</td>
                  <td style={{ color: 'var(--c-green)' }}>{v.total_savings_pct?.toFixed(1)}%</td>
                  <td>
                    <span style={{ fontSize: 10, fontFamily: 'var(--mono)', fontWeight: 600, padding: '1px 6px', borderRadius: 3, background: v.is_thin ? '#dbeafe' : '#f3f4f6', color: v.is_thin ? '#1e40af' : '#374151' }}>
                      {v.is_thin ? 'thin' : 'thick'}
                    </span>
                  </td>
                  <td style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{v.host_mapped ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedVolume && (
        <VolumeDetailModal
          volume={selectedVolume}
          onClose={() => setSelectedVolume(null)}
        />
      )}
    </div>
  )
}
