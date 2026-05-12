import React, { useState, useEffect } from 'react'
import { api } from '../api'
import Sparkline from './Sparkline'

const RANGES = [
  { label: '24h', hours: 24 },
  { label: '3d',  hours: 72 },
  { label: '7d',  hours: 168 },
]

function MetricBox({ label, value, sub, accent }) {
  return (
    <div style={{ padding: '12px 16px', background: 'var(--bg)', borderRadius: 6, border: '0.5px solid var(--border)' }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: accent ?? 'var(--text)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function UtilBar({ pct }) {
  const color = pct > 85 ? 'var(--c-crit)' : pct > 70 ? 'var(--c-warn)' : 'var(--c-green)'
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)', marginBottom: 6 }}>
        <span>utilisation</span>
        <span style={{ color, fontWeight: 700 }}>{pct}%</span>
      </div>
      <div style={{ height: 10, background: 'var(--bg)', borderRadius: 5, overflow: 'hidden', border: '0.5px solid var(--border)' }}>
        <div style={{ width: pct + '%', height: '100%', background: color, borderRadius: 5, transition: 'width 0.3s' }} />
      </div>
    </div>
  )
}

function TrendPanel({ history }) {
  const trends = [
    { label: 'array util %',  key: 'al_util_pct',  color: 'var(--c-blue)' },
    { label: 'array IOPS',    key: 'al_iops',       color: 'var(--c-green)' },
    { label: 'latency (ms)',  key: 'al_latency',    color: 'var(--c-warn)' },
  ]
  if (history.length < 2) return (
    <div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
      no history yet — snapshots collect every 15 min
    </div>
  )
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
      {trends.map(t => {
        const vals = history.map(p => p[t.key])
        const last = vals.filter(v => v != null).at(-1)
        return (
          <div key={t.key}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)', marginBottom: 4 }}>
              <span>{t.label}</span>
              {last != null && <span style={{ color: 'var(--text)' }}>{typeof last === 'number' && !Number.isInteger(last) ? last.toFixed(1) : last}</span>}
            </div>
            <Sparkline data={vals} color={t.color} height={40} />
          </div>
        )
      })}
    </div>
  )
}

export default function VolumeDetailModal({ volume, onClose }) {
  const [hours, setHours] = useState(24)
  const [history, setHistory] = useState([])

  useEffect(() => {
    api.history(hours).then(d => setHistory(d.points ?? [])).catch(() => setHistory([]))
  }, [hours])

  const freeGb   = (volume.provisioned_gb - volume.used_gb).toFixed(1)
  const utilColor = volume.util_pct > 85 ? 'var(--c-crit)' : volume.util_pct > 70 ? 'var(--c-warn)' : 'var(--c-green)'
  const totalEff  = (volume.dedup_ratio * volume.compress_ratio).toFixed(2)

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: 'var(--surface)', borderRadius: 10, border: '0.5px solid var(--border)',
        width: '100%', maxWidth: 780, maxHeight: '90vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '0.5px solid var(--border)', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <i className="ti ti-database" style={{ color: 'var(--c-blue)', fontSize: 20, marginTop: 2 }} aria-hidden="true" />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 16 }}>{volume.name}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', background: 'var(--bg)', border: '0.5px solid var(--border)', padding: '1px 7px', borderRadius: 3 }}>
                {volume.volume_id}
              </span>
              <span style={{ fontSize: 10, fontFamily: 'var(--mono)', fontWeight: 600, padding: '1px 7px', borderRadius: 3, background: volume.is_thin ? '#dbeafe' : '#f3f4f6', color: volume.is_thin ? '#1e40af' : '#374151' }}>
                {volume.is_thin ? 'thin' : 'thick'}
              </span>
              {volume.host_mapped && (
                <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
                  <i className="ti ti-server-2" style={{ marginRight: 4 }} aria-hidden="true" />{volume.host_mapped}
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Utilisation bar */}
          <UtilBar pct={volume.util_pct} />

          {/* Capacity metrics */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            <MetricBox
              label="provisioned"
              value={volume.provisioned_gb >= 1024 ? (volume.provisioned_gb/1024).toFixed(1)+' TB' : volume.provisioned_gb+' GB'}
            />
            <MetricBox
              label="used"
              value={volume.used_gb >= 1024 ? (volume.used_gb/1024).toFixed(1)+' TB' : volume.used_gb.toFixed(1)+' GB'}
              accent={utilColor}
            />
            <MetricBox
              label="free"
              value={parseFloat(freeGb) >= 1024 ? (freeGb/1024).toFixed(1)+' TB' : freeGb+' GB'}
              accent="var(--c-green)"
            />
          </div>

          {/* Efficiency metrics */}
          <div>
            <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '.05em' }}>Data reduction</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              <MetricBox label="dedup ratio"       value={volume.dedup_ratio.toFixed(2)+':1'} />
              <MetricBox label="compress ratio"    value={volume.compress_ratio.toFixed(2)+':1'} />
              <MetricBox label="total savings"     value={volume.total_savings_pct.toFixed(1)+'%'}
                sub={`${totalEff}:1 combined`} accent="var(--c-green)" />
            </div>
          </div>

          {/* Array-wide trends */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>Array-wide trends</div>
                <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)', marginTop: 2 }}>
                  system-level — not scoped to this volume
                </div>
              </div>
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
            <TrendPanel history={history} />
          </div>

        </div>
      </div>
    </div>
  )
}
