import React from 'react'
import Sparkline from '../components/Sparkline'

// ── Runway helpers ─────────────────────────────────────────────────────────────

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
  const isBad = trend !== 'stable' && (
    (higherIsBad && trend === 'rising') || (!higherIsBad && trend === 'falling')
  )
  const color = trend === 'stable' ? 'var(--muted)' : isBad ? 'var(--c-warn)' : 'var(--c-green)'
  const sign  = slopePerDay >= 0 ? '+' : ''
  const delta = Math.abs(slopePerDay) < 10
    ? `${sign}${slopePerDay.toFixed(1)}${unit}/d`
    : `${sign}${Math.round(slopePerDay)}${unit}/d`
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontFamily: 'var(--mono)', color }}>
      {arrow} {trend === 'stable' ? 'stable' : delta}
    </span>
  )
}

function RunwayRow({ f }) {
  const hasThreshold = f.threshold != null
  const currentFmt = f.current == null ? '—'
    : f.unit === '%' ? `${f.current.toFixed(1)}%`
    : f.unit === 'W' ? `${Math.round(f.current)} W`
    : String(Math.round(f.current))

  const improving = (f.higher_is_bad && f.trend === 'falling') || (!f.higher_is_bad && f.trend === 'rising')

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '160px 70px 140px 90px 1fr', alignItems: 'center', gap: 12, padding: '7px 0', borderBottom: '0.5px solid var(--border)' }}>
      <span style={{ fontSize: 12, color: 'var(--text)' }}>{f.label}</span>
      <span style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--muted)', textAlign: 'right' }}>{currentFmt}</span>
      <span><TrendArrow trend={f.trend} slopePerDay={f.slope_per_day} unit={f.unit} higherIsBad={f.higher_is_bad} /></span>
      <span>
        {f.days_until_threshold != null
          ? <RunwayChip days={f.days_until_threshold} />
          : hasThreshold && f.current != null
            ? <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: improving ? 'var(--c-green)' : 'var(--muted)' }}>
                {improving ? 'improving' : 'stable'}
              </span>
            : null
        }
      </span>
      <div style={{ minWidth: 80 }}>
        {f.history.some(v => v != null) && (
          <Sparkline
            data={f.history}
            color={f.days_until_threshold != null && f.days_until_threshold < 30
              ? 'var(--c-crit)'
              : f.days_until_threshold != null && f.days_until_threshold < 60
                ? 'var(--c-warn)'
                : 'var(--c-blue)'}
            height={24}
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
      <div className="bar-track">
        <div className={`bar-fill ${cls}`} style={{ width: pct + '%' }} />
      </div>
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

export default function GlassplaneView({ data, history = [], iloSummary, forecast, onNavigate }) {
  if (!data) return null
  const { vcenter, aruba, alletra, veeam, optimization_score, top_recommendations, overall_status } = data

  const subsystems = [
    { id: 'vms',     label: 'vCenter / Compute', icon: 'ti-server-2',    data: vcenter,    status: vcenter ? 'ok' : 'unknown' },
    { id: 'aruba',   label: 'Aruba Networking',  icon: 'ti-network',     data: aruba,      status: aruba?.status },
    { id: 'alletra', label: 'HPE Alletra 6000',  icon: 'ti-database',    data: alletra,    status: alletra?.status },
    { id: 'veeam',   label: 'Veeam Backup',      icon: 'ti-cloud-upload', data: veeam,     status: veeam?.status },
    { id: 'hosts',   label: 'Hosts / iLO',       icon: 'ti-cpu',         data: iloSummary, status: iloSummary?.status },
  ]

  return (
    <div>
      {/* Score header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: '1.5rem' }}>
        <ScoreRing score={optimization_score ?? 0} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 500 }}>
            {optimization_score > 75 ? 'Optimized' : optimization_score > 50 ? 'Needs attention' : 'Action required'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)', display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <StatusDot status={overall_status} />
            {overall_status} · score {optimization_score}/100
          </div>
        </div>
        {history.length > 1 && (
          <div style={{ width: 140 }}>
            <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: 3 }}>score · 24h</div>
            <Sparkline
              data={history.map(p => p.score)}
              color={optimization_score > 75 ? 'var(--c-green)' : optimization_score > 50 ? 'var(--c-warn)' : 'var(--c-crit)'}
              height={36}
            />
          </div>
        )}
      </div>

      {/* Recommendations */}
      {top_recommendations?.length > 0 && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <div className="card-header">
            <div className="card-title">
              <i className="ti ti-bulb" style={{ color: 'var(--c-warn)' }} aria-hidden="true" />
              Optimization recommendations
            </div>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {top_recommendations.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, fontSize: 13 }}>
                <i className="ti ti-arrow-right" style={{ color: 'var(--c-blue)', marginTop: 2, flexShrink: 0 }} aria-hidden="true" />
                <span>{r}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Capacity runway */}
      {forecast && (() => {
        const active = forecast.forecasts.filter(f => f.current != null)
        if (!active.length) return null
        const urgent = active.filter(f => f.days_until_threshold != null && f.days_until_threshold < 60)
        return (
          <div className="card" style={{ marginBottom: '1rem' }}>
            <div className="card-header">
              <div className="card-title">
                <i className="ti ti-timeline" style={{ color: 'var(--c-blue)' }} aria-hidden="true" />
                Capacity runway
              </div>
              <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>
                {forecast.data_points} snapshots · linear trend
                {urgent.length > 0 && (
                  <span style={{ marginLeft: 8, color: 'var(--c-crit)', fontWeight: 600 }}>
                    {urgent.length} metric{urgent.length > 1 ? 's' : ''} nearing threshold
                  </span>
                )}
              </span>
            </div>
            <div className="card-body" style={{ paddingBottom: 2 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '160px 70px 140px 90px 1fr', gap: 12, padding: '4px 0 6px', borderBottom: '0.5px solid var(--border)', color: 'var(--muted)', fontSize: 10, fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                <span>Metric</span><span style={{ textAlign: 'right' }}>Current</span><span>Trend</span><span>Runway</span><span>History</span>
              </div>
              {active.map(f => <RunwayRow key={f.metric} f={f} />)}
            </div>
          </div>
        )
      })()}

      {/* Subsystem cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
        {subsystems.map(s => (
          <div key={s.id} className="card" style={{ cursor: 'pointer' }} onClick={() => onNavigate(s.id)}>
            <div className="card-header">
              <div className="card-title">
                <i className={`ti ${s.icon}`} style={{ color: 'var(--c-blue)' }} aria-hidden="true" />
                {s.label}
              </div>
              <StatusDot status={s.status} />
            </div>
            <div className="card-body">
              {!s.data && <div style={{ color: 'var(--muted)', fontSize: 12, fontFamily: 'var(--mono)' }}>unavailable</div>}
              {s.id === 'vms' && vcenter && (
                <>
                  <div className="metrics" style={{ marginBottom: 10 }}>
                    <div className="metric"><div className="metric-label">total VMs</div><div className="metric-val">{vcenter.total_vms}</div></div>
                    <div className="metric"><div className="metric-label">idle</div><div className="metric-val" style={{ color: vcenter.idle_vms > 5 ? 'var(--c-warn)' : undefined }}>{vcenter.idle_vms}</div></div>
                    <div className="metric"><div className="metric-label">wasted RAM</div><div className="metric-val">{Math.round(vcenter.wasted_ram_gb)}GB</div></div>
                  </div>
                  {vcenter.clusters?.map(c => <BarRow key={c.name} label={`${c.name} CPU`} pct={c.cpu_util_pct} />)}
                  {history.length > 1 && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: 2 }}>idle VMs · 24h</div>
                      <Sparkline data={history.map(p => p.vc_idle)} color="var(--c-warn)" height={28} />
                    </div>
                  )}
                </>
              )}
              {s.id === 'aruba' && aruba && (
                <>
                  <div className="metrics" style={{ marginBottom: history.length > 1 ? 10 : 0 }}>
                    <div className="metric"><div className="metric-label">switches</div><div className="metric-val">{aruba.switch_count}</div></div>
                    <div className="metric"><div className="metric-label">unused ports</div><div className="metric-val">{aruba.unused_ports}</div><div className="metric-sub">{aruba.unused_port_pct}%</div></div>
                  </div>
                  {history.length > 1 && (
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: 2 }}>unused port % · 24h</div>
                      <Sparkline data={history.map(p => p.ar_unused_pct)} color="var(--c-blue)" height={28} />
                    </div>
                  )}
                </>
              )}
              {s.id === 'alletra' && alletra && (
                <>
                  <div className="metrics" style={{ marginBottom: 10 }}>
                    <div className="metric"><div className="metric-label">utilisation</div><div className="metric-val">{alletra.util_pct}%</div></div>
                    <div className="metric"><div className="metric-label">efficiency</div><div className="metric-val">{alletra.total_efficiency_ratio?.toFixed(1)}:1</div></div>
                  </div>
                  <BarRow label="capacity" pct={alletra.util_pct} />
                  {history.length > 1 && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: 2 }}>utilisation % · 24h</div>
                      <Sparkline data={history.map(p => p.al_util_pct)} color="var(--c-blue)" height={28} />
                    </div>
                  )}
                </>
              )}
              {s.id === 'hosts' && iloSummary && (
                <>
                  <div className="metrics" style={{ marginBottom: history.length > 1 ? 10 : 0 }}>
                    <div className="metric"><div className="metric-label">hosts</div><div className="metric-val">{iloSummary.host_count}</div></div>
                    <div className="metric"><div className="metric-label">total power</div><div className="metric-val">{iloSummary.total_power_watts} W</div></div>
                    <div className="metric"><div className="metric-label">IML errors</div><div className="metric-val" style={{ color: iloSummary.error_count > 0 ? 'var(--c-crit)' : undefined }}>{iloSummary.error_count}</div></div>
                  </div>
                  {history.length > 1 && (
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: 2 }}>power (W) · 24h</div>
                      <Sparkline data={history.map(p => p.ilo_total_power_w)} color="var(--c-blue)" height={28} />
                    </div>
                  )}
                </>
              )}
              {s.id === 'veeam' && veeam && (
                <>
                  <div className="metrics" style={{ marginBottom: history.length > 1 ? 10 : 0 }}>
                    <div className="metric"><div className="metric-label">failed jobs</div><div className="metric-val" style={{ color: veeam.failed_jobs > 0 ? 'var(--c-crit)' : undefined }}>{veeam.failed_jobs}</div></div>
                    <div className="metric"><div className="metric-label">protected VMs</div><div className="metric-val">{veeam.protected_vms}</div></div>
                    <div className="metric"><div className="metric-label">repo used</div><div className="metric-val">{veeam.repo_util_pct}%</div></div>
                  </div>
                  {history.length > 1 && (
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: 2 }}>repo util % · 24h</div>
                      <Sparkline data={history.map(p => p.veeam_repo_pct)} color="var(--c-blue)" height={28} />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
