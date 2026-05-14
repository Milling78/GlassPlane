import React, { useState, useEffect, useRef, useMemo } from 'react'
import { api } from '../api'

// ── Tiny Chart.js sparkline ──────────────────────────────────────────────────

function SurgeSparkline({ series, timestamps, surgeMinutes, threshold }) {
  const ref = useRef(null)
  const chartRef = useRef(null)

  useEffect(() => {
    if (!ref.current) return
    if (typeof Chart === 'undefined') {
      const ctx = ref.current.getContext('2d')
      if (ctx) {
        ctx.font = '12px monospace'
        ctx.fillStyle = '#888'
        ctx.fillText('Chart.js unavailable', 8, 20)
      }
      return
    }
    if (chartRef.current) chartRef.current.destroy()

    const surgeSet = new Set(surgeMinutes)
    const totalMin = series.length
    const step = Math.max(1, Math.floor(totalMin / 8))
    const labels = timestamps.map((_, i) => {
      if (i % step === 0) {
        const d = new Date(timestamps[i])
        return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`
      }
      return ''
    })

    const surgePlugin = {
      id: 'surgeZones',
      beforeDraw(chart) {
        const { ctx, chartArea, scales: { x, y } } = chart
        if (!chartArea) return
        ctx.save()
        // threshold line
        ctx.beginPath()
        ctx.setLineDash([4, 4])
        ctx.strokeStyle = 'rgba(239,68,68,0.5)'
        ctx.lineWidth = 1
        const ty = y.getPixelForValue(threshold)
        ctx.moveTo(chartArea.left, ty)
        ctx.lineTo(chartArea.right, ty)
        ctx.stroke()
        ctx.setLineDash([])
        // surge highlight bands (±2 samples around each surge peak)
        for (const sm of surgeMinutes) {
          if (sm < 0 || sm >= series.length) continue
          const x1 = x.getPixelForValue(Math.max(0, sm - 2))
          const x2 = x.getPixelForValue(Math.min(series.length - 1, sm + 2))
          ctx.fillStyle = 'rgba(239,68,68,0.12)'
          ctx.fillRect(x1, chartArea.top, x2 - x1, chartArea.bottom - chartArea.top)
        }
        ctx.restore()
      }
    }

    chartRef.current = new Chart(ref.current, {
      type: 'line',
      plugins: [surgePlugin],
      data: {
        labels,
        datasets: [{
          data: series,
          borderColor: '#3b82f6',
          borderWidth: 1.5,
          pointRadius: 0,
          fill: false,
          tension: 0.3,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 200 },
        plugins: { legend: { display: false }, tooltip: {
          mode: 'index', intersect: false,
          callbacks: { label: ctx => `${Math.round(ctx.parsed.y)}%` }
        }},
        scales: {
          x: { grid: { color: 'rgba(128,128,128,0.07)' }, ticks: { font: { family: 'IBM Plex Mono', size: 10 }, color: '#888780', maxRotation: 0 } },
          y: { min: 0, max: 100, grid: { color: 'rgba(128,128,128,0.07)' }, ticks: { font: { family: 'IBM Plex Mono', size: 10 }, color: '#888780', callback: v => v + '%' } }
        }
      }
    })
    return () => { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null } }
  }, [series, surgeMinutes, threshold])

  return (
    <div style={{ position: 'relative', height: 160 }}>
      <canvas ref={ref} role="img" aria-label="CPU/RAM time series with surge markers">Time series data</canvas>
    </div>
  )
}

// ── Period badge ─────────────────────────────────────────────────────────────

function PeriodBadge({ period }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#fee2e2',
      color: '#991b1b', fontSize: 11, fontFamily: 'var(--mono)', padding: '3px 8px', borderRadius: 4 }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ef4444', flexShrink: 0 }} />
      {period.period_min}min cycle · {period.occurrences}× · offsets: {period.offsets.map(o => ':' + String(o).padStart(2,'0')).join(', ')}
    </span>
  )
}

// ── Main view ────────────────────────────────────────────────────────────────

export default function SurgeView() {
  const [data, setData]           = useState(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [threshold, setThreshold] = useState(80)
  const [metric, setMetric]       = useState('cpu')
  const [lookback, setLookback]   = useState(2)
  const [selected, setSelected]   = useState(null)
  const [search, setSearch]       = useState('')

  async function load() {
    setLoading(true); setError(null)
    try {
      const params = { threshold, metric, lookback_hours: lookback }
      if (search.trim()) params.vm_filter = search.trim()
      const d = await api.surges(params)
      setData(d)
      if (!selected && d.cyclic_vms?.length) setSelected(d.cyclic_vms[0].vm_id)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line

  const selectedVM = useMemo(() =>
    data?.all_vms?.find(v => v.vm_id === selected),
    [data, selected]
  )

  return (
    <div>
      {/* Controls */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
        <label style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>threshold</label>
        <input type="range" min={50} max={95} step={1} value={threshold}
          onChange={e => setThreshold(+e.target.value)} style={{ width: 80 }} />
        <span style={{ fontSize: 12, fontFamily: 'var(--mono)', minWidth: 30 }}>{threshold}%</span>

        <select value={metric} onChange={e => setMetric(e.target.value)} style={{ fontSize: 12 }}>
          <option value="cpu">CPU</option>
          <option value="ram">RAM</option>
        </select>

        <select value={lookback} onChange={e => setLookback(+e.target.value)} style={{ fontSize: 12 }}>
          <option value={1}>1 hour</option>
          <option value={2}>2 hours</option>
          <option value={4}>4 hours</option>
          <option value={8}>8 hours</option>
          <option value={24}>24 hours</option>
        </select>

        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="filter by VM name…" style={{ flex: 1, minWidth: 140, fontSize: 12 }} />

        <button onClick={load} style={{ fontSize: 12 }}>
          <i className="ti ti-refresh" style={{ marginRight: 4 }} aria-hidden="true" />
          scan
        </button>
      </div>

      {error && (
        <div style={{ background: '#fee2e2', border: '0.5px solid #fca5a5', borderRadius: 8,
          padding: '.5rem .75rem', fontFamily: 'var(--mono)', fontSize: 12, color: '#991b1b', marginBottom: '1rem' }}>
          {error}
        </div>
      )}

      {loading && (
        <div style={{ padding: '3rem', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--muted)' }}>
          scanning {lookback}h of {metric.toUpperCase()} data…
        </div>
      )}

      {!loading && data && (
        <>
          {/* Summary stats */}
          <div className="metrics" style={{ marginBottom: '1rem' }}>
            <div className="metric">
              <div className="metric-label">VMs scanned</div>
              <div className="metric-val">{data.vms_scanned}</div>
            </div>
            <div className="metric">
              <div className="metric-label">cyclic alerts</div>
              <div className="metric-val" style={{ color: data.vms_flagged > 0 ? 'var(--c-crit)' : 'var(--c-ok)' }}>
                {data.vms_flagged}
              </div>
            </div>
            <div className="metric">
              <div className="metric-label">threshold</div>
              <div className="metric-val">{data.threshold_pct}%</div>
            </div>
            <div className="metric">
              <div className="metric-label">lookback</div>
              <div className="metric-val">{data.lookback_hours}h</div>
            </div>
          </div>

          {data.vms_flagged === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--muted)' }}>
              <i className="ti ti-check" style={{ fontSize: 24, color: 'var(--c-ok)', display: 'block', marginBottom: 8 }} aria-hidden="true" />
              no cyclic patterns detected at {data.threshold_pct}% threshold
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 12, alignItems: 'start' }}>
              {/* Alert list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {data.cyclic_vms.map(vm => (
                  <div key={vm.vm_id}
                    onClick={() => setSelected(vm.vm_id)}
                    className="card"
                    style={{
                      padding: '.6rem .75rem', cursor: 'pointer',
                      borderColor: selected === vm.vm_id ? 'var(--c-crit)' : undefined,
                      borderWidth: selected === vm.vm_id ? 1.5 : undefined,
                    }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: vm.max_pct > 90 ? 'var(--c-crit)' : 'var(--c-warn)', flexShrink: 0 }} />
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{vm.name}</span>
                    </div>
                    <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)', marginBottom: 4 }}>{vm.cluster}</div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {vm.periods.map((p, i) => (
                        <span key={i} style={{ fontSize: 10, fontFamily: 'var(--mono)', background: '#fee2e2', color: '#991b1b', padding: '1px 6px', borderRadius: 3 }}>
                          {p.period_min}min
                        </span>
                      ))}
                      <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>peak {vm.max_pct}%</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Detail panel */}
              {selectedVM && (
                <div className="card">
                  <div className="card-header">
                    <div className="card-title">
                      <i className="ti ti-wave-sine" style={{ color: 'var(--c-crit)' }} aria-hidden="true" />
                      {selectedVM.name}
                    </div>
                    <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>
                      {selectedVM.surge_events.length} surge events · peak {selectedVM.max_pct}% · avg {selectedVM.avg_pct}%
                    </span>
                  </div>
                  <div className="card-body">
                    <SurgeSparkline
                      series={selectedVM.series}
                      timestamps={selectedVM.series_timestamps}
                      surgeMinutes={selectedVM.surge_events.map(e => e.minute_offset)}
                      threshold={selectedVM.threshold_pct}
                    />
                    <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                        detected cycles
                      </div>
                      {selectedVM.periods.map((p, i) => <PeriodBadge key={i} period={p} />)}
                    </div>
                    <div style={{ marginTop: '0.75rem', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {selectedVM.surge_events.map((e, i) => (
                        <span key={i} style={{ fontSize: 11, fontFamily: 'var(--mono)', background: 'var(--bg)',
                          border: '0.5px solid var(--border)', borderRadius: 4, padding: '2px 8px' }}>
                          {new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {e.peak_pct}%
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
