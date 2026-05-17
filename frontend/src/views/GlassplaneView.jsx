import React, { useState, useCallback } from 'react'
import { Responsive, WidthProvider } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import Sparkline from '../components/Sparkline'

const ResponsiveGrid = WidthProvider(Responsive)

// ── Layout persistence ─────────────────────────────────────────────────────────

const LS_KEY = 'glassplane_dashboard_layout'
const COLS   = { lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }
const BREAKS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }
const ROW_H  = 80
const MARGIN = [10, 10]

const DEFAULT_LAYOUTS = {
  lg: [
    { i: 'score',    x: 0, y: 0,  w: 3,  h: 3,  minW: 2, minH: 2 },
    { i: 'recs',     x: 3, y: 0,  w: 9,  h: 3,  minW: 3, minH: 2 },
    { i: 'forecast', x: 0, y: 3,  w: 12, h: 5,  minW: 4, minH: 3 },
    { i: 'vms',      x: 0, y: 8,  w: 4,  h: 4,  minW: 2, minH: 2 },
    { i: 'aruba',    x: 4, y: 8,  w: 4,  h: 4,  minW: 2, minH: 2 },
    { i: 'alletra',  x: 8, y: 8,  w: 4,  h: 4,  minW: 2, minH: 2 },
    { i: 'veeam',    x: 0, y: 12, w: 4,  h: 4,  minW: 2, minH: 2 },
    { i: 'hosts',    x: 4, y: 12, w: 4,  h: 4,  minW: 2, minH: 2 },
  ],
}

function loadLayouts() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return DEFAULT_LAYOUTS
    const saved = JSON.parse(raw)
    // Merge: keep saved positions but fall back to defaults for any missing keys
    const defaultKeys = new Set(DEFAULT_LAYOUTS.lg.map(i => i.i))
    const savedKeys   = new Set((saved.lg ?? []).map(i => i.i))
    const missing = [...defaultKeys].filter(k => !savedKeys.has(k))
    if (missing.length) {
      const extras = DEFAULT_LAYOUTS.lg.filter(i => missing.includes(i.i))
      saved.lg = [...(saved.lg ?? []), ...extras]
    }
    return saved
  } catch {
    return DEFAULT_LAYOUTS
  }
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function RunwayChip({ days }) {
  if (days == null) return null
  const [bg, color] =
    days < 14  ? ['rgba(239,68,68,0.12)',  'var(--c-crit)'] :
    days < 30  ? ['rgba(239,68,68,0.08)',  'var(--c-crit)'] :
    days < 60  ? ['rgba(245,158,11,0.12)', 'var(--c-warn)'] :
                 ['rgba(34,197,94,0.10)',  'var(--c-green)']
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontFamily: 'var(--mono)', fontWeight: 700, color, background: bg, borderRadius: 6, padding: '2px 7px' }}>
      <i className="ti ti-clock-hour-4" aria-hidden="true" />
      {days}d
    </span>
  )
}

function TrendArrow({ trend, slopePerDay, unit, higherIsBad }) {
  const arrow = trend === 'rising' ? '↑' : trend === 'falling' ? '↓' : '→'
  const isBad = trend !== 'stable' && ((higherIsBad && trend === 'rising') || (!higherIsBad && trend === 'falling'))
  const color = trend === 'stable' ? 'var(--muted)' : isBad ? 'var(--c-warn)' : 'var(--c-green)'
  const sign  = slopePerDay >= 0 ? '+' : ''
  const delta = Math.abs(slopePerDay) < 10 ? `${sign}${slopePerDay.toFixed(1)}${unit}/d` : `${sign}${Math.round(slopePerDay)}${unit}/d`
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontFamily: 'var(--mono)', color }}>
      {arrow} {trend === 'stable' ? 'stable' : delta}
    </span>
  )
}

function RunwayRow({ f }) {
  const currentFmt = f.current == null ? '—'
    : f.unit === '%' ? `${f.current.toFixed(1)}%`
    : f.unit === 'W' ? `${Math.round(f.current)} W`
    : String(Math.round(f.current))
  const improving = (f.higher_is_bad && f.trend === 'falling') || (!f.higher_is_bad && f.trend === 'rising')
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '140px 65px 130px 90px 1fr', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '0.5px solid var(--border)' }}>
      <span style={{ fontSize: 12, color: 'var(--text)' }}>{f.label}</span>
      <span style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--muted)', textAlign: 'right' }}>{currentFmt}</span>
      <span><TrendArrow trend={f.trend} slopePerDay={f.slope_per_day} unit={f.unit} higherIsBad={f.higher_is_bad} /></span>
      <span>
        {f.days_until_threshold != null
          ? <RunwayChip days={f.days_until_threshold} />
          : f.threshold != null && f.current != null
            ? <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: improving ? 'var(--c-green)' : 'var(--muted)' }}>{improving ? 'improving' : 'stable'}</span>
            : null}
      </span>
      <div style={{ minWidth: 60 }}>
        {f.history.some(v => v != null) && (
          <Sparkline
            data={f.history}
            color={f.days_until_threshold != null && f.days_until_threshold < 30 ? 'var(--c-crit)' : f.days_until_threshold != null && f.days_until_threshold < 60 ? 'var(--c-warn)' : 'var(--c-blue)'}
            height={22}
          />
        )}
      </div>
    </div>
  )
}

function StatusDot({ status }) {
  const cls = { ok: 'dot-ok', warning: 'dot-warn', critical: 'dot-crit' }
  return <span className={`dot ${cls[status] ?? 'dot-off'}`} />
}

function BarRow({ label, pct }) {
  const cls = pct > 85 ? 'bar-crit' : pct > 70 ? 'bar-warn' : 'bar-ok'
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)', marginBottom: 2 }}>
        <span>{label}</span><span>{pct}%</span>
      </div>
      <div className="bar-track"><div className={`bar-fill ${cls}`} style={{ width: pct + '%' }} /></div>
    </div>
  )
}

function ScoreRing({ score }) {
  const r = 22, c = 2 * Math.PI * r, dash = (score / 100) * c
  const col = score > 75 ? '#22c55e' : score > 50 ? '#f59e0b' : '#ef4444'
  return (
    <div style={{ position: 'relative', width: 60, height: 60 }}>
      <svg width={60} height={60} viewBox="0 0 60 60" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={30} cy={30} r={r} fill="none" stroke="var(--bg)" strokeWidth={6} />
        <circle cx={30} cy={30} r={r} fill="none" stroke={col} strokeWidth={6}
          strokeDasharray={`${dash} ${c}`} strokeLinecap="round" />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 500 }}>
        {score}
      </div>
    </div>
  )
}

// ── DashCard wrapper ───────────────────────────────────────────────────────────

function DashCard({ title, icon, iconColor = 'var(--c-blue)', status, navId, onNavigate, children }) {
  return (
    <div className="card" style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxSizing: 'border-box' }}>
      <div
        className="card-header dash-drag-handle"
        style={{ cursor: 'grab', flexShrink: 0, userSelect: 'none' }}
        title="Drag to move"
      >
        <div
          className="card-title"
          style={{ cursor: navId ? 'pointer' : 'default' }}
          onClick={navId && onNavigate ? (e) => { if (!e.defaultPrevented) onNavigate(navId) } : undefined}
        >
          <i className={`ti ${icon}`} style={{ color: iconColor }} aria-hidden="true" />
          {title}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {status && <StatusDot status={status} />}
          <i className="ti ti-grip-horizontal" style={{ color: 'var(--border)', fontSize: 14 }} aria-hidden="true" />
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '0.75rem 1rem' }}>
        {children}
      </div>
    </div>
  )
}

// ── Main dashboard ─────────────────────────────────────────────────────────────

export default function GlassplaneView({ data, history = [], iloSummary, forecast, onNavigate }) {
  const [layouts, setLayouts] = useState(() => loadLayouts())

  const onLayoutChange = useCallback((_layout, allLayouts) => {
    setLayouts(allLayouts)
    try { localStorage.setItem(LS_KEY, JSON.stringify(allLayouts)) } catch {}
  }, [])

  const resetLayout = useCallback(() => {
    setLayouts(DEFAULT_LAYOUTS)
    try { localStorage.removeItem(LS_KEY) } catch {}
  }, [])

  if (!data) return null
  const { vcenter, aruba, alletra, veeam, optimization_score, top_recommendations, overall_status } = data

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 6 }}>
        <button
          onClick={resetLayout}
          style={{
            background: 'none', border: '0.5px solid var(--border)', borderRadius: 6,
            padding: '4px 10px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 11,
            color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 5,
          }}
          title="Reset dashboard to default layout"
        >
          <i className="ti ti-layout-grid" aria-hidden="true" />
          Reset layout
        </button>
      </div>

      {/* react-grid-layout CSS overrides */}
      <style>{`
        .dash-drag-handle { cursor: grab; }
        .dash-drag-handle:active { cursor: grabbing; }
        .react-grid-item.react-grid-placeholder {
          background: var(--c-blue) !important;
          opacity: 0.12 !important;
          border-radius: 10px !important;
        }
        .react-grid-item > .react-resizable-handle {
          position: absolute;
          width: 18px;
          height: 18px;
          bottom: 4px;
          right: 4px;
          cursor: se-resize;
          opacity: 0;
          transition: opacity 0.15s;
        }
        .react-grid-item:hover > .react-resizable-handle,
        .react-grid-item > .react-resizable-handle:active {
          opacity: 1;
        }
        .react-grid-item > .react-resizable-handle::after {
          content: '';
          position: absolute;
          right: 3px;
          bottom: 3px;
          width: 8px;
          height: 8px;
          border-right: 2px solid var(--muted);
          border-bottom: 2px solid var(--muted);
          border-radius: 1px;
        }
        .react-grid-item.react-draggable-dragging {
          box-shadow: 0 8px 30px rgba(0,0,0,0.25);
          z-index: 100;
        }
      `}</style>

      <ResponsiveGrid
        className="layout"
        layouts={layouts}
        breakpoints={BREAKS}
        cols={COLS}
        rowHeight={ROW_H}
        margin={MARGIN}
        draggableHandle=".dash-drag-handle"
        onLayoutChange={onLayoutChange}
        resizeHandles={['se']}
        isDroppable={false}
      >
        {/* ── Score ── */}
        <div key="score">
          <DashCard title="Optimization score" icon="ti-gauge" iconColor="var(--c-green)">
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <ScoreRing score={optimization_score ?? 0} />
              <div>
                <div style={{ fontSize: 16, fontWeight: 500 }}>
                  {optimization_score > 75 ? 'Optimized' : optimization_score > 50 ? 'Needs attention' : 'Action required'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)', display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 }}>
                  <StatusDot status={overall_status} />
                  {overall_status} · {optimization_score}/100
                </div>
              </div>
            </div>
            {history.length > 1 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: 3 }}>score · 24h</div>
                <Sparkline
                  data={history.map(p => p.score)}
                  color={optimization_score > 75 ? 'var(--c-green)' : optimization_score > 50 ? 'var(--c-warn)' : 'var(--c-crit)'}
                  height={32}
                />
              </div>
            )}
          </DashCard>
        </div>

        {/* ── Recommendations ── */}
        <div key="recs">
          <DashCard title="Optimization recommendations" icon="ti-bulb" iconColor="var(--c-warn)">
            {!top_recommendations?.length
              ? <div style={{ color: 'var(--muted)', fontSize: 12, fontFamily: 'var(--mono)' }}>No recommendations — all systems healthy</div>
              : <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {top_recommendations.map((r, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, fontSize: 13 }}>
                      <i className="ti ti-arrow-right" style={{ color: 'var(--c-blue)', marginTop: 2, flexShrink: 0 }} aria-hidden="true" />
                      <span>{r}</span>
                    </div>
                  ))}
                </div>
            }
          </DashCard>
        </div>

        {/* ── Forecast ── */}
        <div key="forecast">
          <DashCard title="Capacity runway" icon="ti-timeline" iconColor="var(--c-blue)">
            {!forecast?.forecasts?.length
              ? <div style={{ color: 'var(--muted)', fontSize: 12, fontFamily: 'var(--mono)' }}>Accumulating snapshot data…</div>
              : (() => {
                  const active = forecast.forecasts.filter(f => f.current != null)
                  const urgent = active.filter(f => f.days_until_threshold != null && f.days_until_threshold < 60)
                  return (
                    <>
                      <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)', marginBottom: 8 }}>
                        {forecast.data_points} snapshots · linear trend
                        {urgent.length > 0 && <span style={{ marginLeft: 8, color: 'var(--c-crit)', fontWeight: 600 }}>{urgent.length} metric{urgent.length > 1 ? 's' : ''} nearing threshold</span>}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '140px 65px 130px 90px 1fr', gap: 10, padding: '4px 0 6px', borderBottom: '0.5px solid var(--border)', color: 'var(--muted)', fontSize: 10, fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                        <span>Metric</span><span style={{ textAlign: 'right' }}>Current</span><span>Trend</span><span>Runway</span><span>History</span>
                      </div>
                      {active.map(f => <RunwayRow key={f.metric} f={f} />)}
                    </>
                  )
                })()
            }
          </DashCard>
        </div>

        {/* ── vCenter / Compute ── */}
        <div key="vms">
          <DashCard title="vCenter / Compute" icon="ti-server-2" iconColor="var(--c-blue)" status={vcenter ? 'ok' : 'unknown'} navId="vms" onNavigate={onNavigate}>
            {!vcenter
              ? <div style={{ color: 'var(--muted)', fontSize: 12, fontFamily: 'var(--mono)' }}>unavailable</div>
              : <>
                  <div className="metrics" style={{ marginBottom: 10 }}>
                    <div className="metric"><div className="metric-label">total VMs</div><div className="metric-val">{vcenter.total_vms}</div></div>
                    <div className="metric"><div className="metric-label">idle</div><div className="metric-val" style={{ color: vcenter.idle_vms > 5 ? 'var(--c-warn)' : undefined }}>{vcenter.idle_vms}</div></div>
                    <div className="metric"><div className="metric-label">wasted RAM</div><div className="metric-val">{Math.round(vcenter.wasted_ram_gb)}GB</div></div>
                  </div>
                  {vcenter.clusters?.map(c => <BarRow key={c.name} label={`${c.name} CPU`} pct={c.cpu_util_pct} />)}
                  {history.length > 1 && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: 2 }}>idle VMs · 24h</div>
                      <Sparkline data={history.map(p => p.vc_idle)} color="var(--c-warn)" height={26} />
                    </div>
                  )}
                </>
            }
          </DashCard>
        </div>

        {/* ── Aruba ── */}
        <div key="aruba">
          <DashCard title="Aruba Networking" icon="ti-network" iconColor="var(--c-blue)" status={aruba?.status} navId="aruba" onNavigate={onNavigate}>
            {!aruba
              ? <div style={{ color: 'var(--muted)', fontSize: 12, fontFamily: 'var(--mono)' }}>unavailable</div>
              : <>
                  <div className="metrics" style={{ marginBottom: history.length > 1 ? 10 : 0 }}>
                    <div className="metric"><div className="metric-label">switches</div><div className="metric-val">{aruba.switch_count}</div></div>
                    <div className="metric"><div className="metric-label">unused ports</div><div className="metric-val">{aruba.unused_ports}</div><div className="metric-sub">{aruba.unused_port_pct}%</div></div>
                  </div>
                  {history.length > 1 && (
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: 2 }}>unused port % · 24h</div>
                      <Sparkline data={history.map(p => p.ar_unused_pct)} color="var(--c-blue)" height={26} />
                    </div>
                  )}
                </>
            }
          </DashCard>
        </div>

        {/* ── Alletra ── */}
        <div key="alletra">
          <DashCard title="HPE Alletra 6000" icon="ti-database" iconColor="var(--c-blue)" status={alletra?.status} navId="alletra" onNavigate={onNavigate}>
            {!alletra
              ? <div style={{ color: 'var(--muted)', fontSize: 12, fontFamily: 'var(--mono)' }}>unavailable</div>
              : <>
                  <div className="metrics" style={{ marginBottom: 10 }}>
                    <div className="metric"><div className="metric-label">utilisation</div><div className="metric-val">{alletra.util_pct}%</div></div>
                    <div className="metric"><div className="metric-label">efficiency</div><div className="metric-val">{alletra.total_efficiency_ratio?.toFixed(1)}:1</div></div>
                  </div>
                  <BarRow label="capacity" pct={alletra.util_pct} />
                  {history.length > 1 && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: 2 }}>utilisation % · 24h</div>
                      <Sparkline data={history.map(p => p.al_util_pct)} color="var(--c-blue)" height={26} />
                    </div>
                  )}
                </>
            }
          </DashCard>
        </div>

        {/* ── Veeam ── */}
        <div key="veeam">
          <DashCard title="Veeam Backup" icon="ti-cloud-upload" iconColor="var(--c-blue)" status={veeam?.status} navId="veeam" onNavigate={onNavigate}>
            {!veeam
              ? <div style={{ color: 'var(--muted)', fontSize: 12, fontFamily: 'var(--mono)' }}>unavailable</div>
              : <>
                  <div className="metrics" style={{ marginBottom: history.length > 1 ? 10 : 0 }}>
                    <div className="metric"><div className="metric-label">failed jobs</div><div className="metric-val" style={{ color: veeam.failed_jobs > 0 ? 'var(--c-crit)' : undefined }}>{veeam.failed_jobs}</div></div>
                    <div className="metric"><div className="metric-label">protected VMs</div><div className="metric-val">{veeam.protected_vms}</div></div>
                    <div className="metric"><div className="metric-label">repo used</div><div className="metric-val">{veeam.repo_util_pct}%</div></div>
                  </div>
                  {history.length > 1 && (
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: 2 }}>repo util % · 24h</div>
                      <Sparkline data={history.map(p => p.veeam_repo_pct)} color="var(--c-blue)" height={26} />
                    </div>
                  )}
                </>
            }
          </DashCard>
        </div>

        {/* ── iLO / Hosts ── */}
        <div key="hosts">
          <DashCard title="Hosts / iLO" icon="ti-cpu" iconColor="var(--c-blue)" status={iloSummary?.status} navId="hosts" onNavigate={onNavigate}>
            {!iloSummary
              ? <div style={{ color: 'var(--muted)', fontSize: 12, fontFamily: 'var(--mono)' }}>unavailable</div>
              : <>
                  <div className="metrics" style={{ marginBottom: history.length > 1 ? 10 : 0 }}>
                    <div className="metric"><div className="metric-label">hosts</div><div className="metric-val">{iloSummary.host_count}</div></div>
                    <div className="metric"><div className="metric-label">total power</div><div className="metric-val">{iloSummary.total_power_watts} W</div></div>
                    <div className="metric"><div className="metric-label">IML errors</div><div className="metric-val" style={{ color: iloSummary.error_count > 0 ? 'var(--c-crit)' : undefined }}>{iloSummary.error_count}</div></div>
                  </div>
                  {history.length > 1 && (
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: 2 }}>power (W) · 24h</div>
                      <Sparkline data={history.map(p => p.ilo_total_power_w)} color="var(--c-blue)" height={26} />
                    </div>
                  )}
                </>
            }
          </DashCard>
        </div>
      </ResponsiveGrid>
    </div>
  )
}
