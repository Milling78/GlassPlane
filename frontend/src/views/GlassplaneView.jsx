import React from 'react'
import Sparkline from '../components/Sparkline'

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

export default function GlassplaneView({ data, history = [], onNavigate }) {
  if (!data) return null
  const { vcenter, aruba, alletra, veeam, optimization_score, top_recommendations, overall_status } = data

  const subsystems = [
    { id: 'vms',     label: 'vCenter / Compute', icon: 'ti-server-2',    data: vcenter, status: vcenter ? 'ok' : 'unknown' },
    { id: 'aruba',   label: 'Aruba Networking',  icon: 'ti-network',     data: aruba,   status: aruba?.status },
    { id: 'alletra', label: 'HPE Alletra 6000',  icon: 'ti-database',    data: alletra, status: alletra?.status },
    { id: 'veeam',   label: 'Veeam Backup',      icon: 'ti-cloud-upload', data: veeam,  status: veeam?.status },
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
