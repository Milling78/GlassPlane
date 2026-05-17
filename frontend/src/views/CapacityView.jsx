import React, { useMemo } from 'react'

// ── SVG Sparkline with trend projection ───────────────────────────────────────

function TrendChart({ history, timestamps, threshold, higherIsBad, slope, current, unit }) {
  const W = 320
  const H = 80
  const PAD = { t: 8, r: 8, b: 20, l: 40 }
  const iW = W - PAD.l - PAD.r
  const iH = H - PAD.t - PAD.b

  const vals = history.filter(v => v != null)
  if (vals.length < 2) {
    return (
      <svg width={W} height={H} style={{ display: 'block' }}>
        <text x={W / 2} y={H / 2} textAnchor="middle" fontSize={10} fill="var(--muted)">
          not enough data
        </text>
      </svg>
    )
  }

  const allTs = timestamps ?? []
  const pairs = history.map((v, i) => [allTs[i] ?? i, v]).filter(([, v]) => v != null)
  const tsMin = pairs[0][0]
  const tsMax = pairs[pairs.length - 1][0]
  const tSpan = tsMax - tsMin || 1

  // Project 30 days forward from last point
  const projDays = 30
  const tsProj   = tsMax + projDays * 86400
  const projVal  = current + slope * projDays

  const allVals = [...vals, projVal]
  if (threshold != null) allVals.push(threshold)
  const vMin = Math.max(0, Math.min(...allVals) * 0.9)
  const vMax = Math.max(...allVals) * 1.05
  const vSpan = vMax - vMin || 1

  const tsRange = tsProj - tsMin

  const px = t => PAD.l + ((t - tsMin) / tsRange) * iW
  const py = v => PAD.t + iH - ((v - vMin) / vSpan) * iH

  const dataPoints = pairs.map(([t, v]) => `${px(t)},${py(v)}`).join(' ')

  // projection line from last data point
  const [lastT, lastV] = pairs[pairs.length - 1]
  const projPoints = `${px(lastT)},${py(lastV)} ${px(tsProj)},${py(projVal)}`

  // threshold line
  const threshY = threshold != null ? py(threshold) : null

  // axis labels
  const yLabels = [vMin, (vMin + vMax) / 2, vMax].map(v =>
    v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)
  )

  const trendColor = slope > 0
    ? (higherIsBad ? 'var(--c-crit)' : 'var(--c-ok)')
    : (higherIsBad ? 'var(--c-ok)' : 'var(--c-warn)')

  return (
    <svg width={W} height={H} style={{ display: 'block', overflow: 'visible' }}>
      {/* Y-axis labels */}
      {[vMin, (vMin + vMax) / 2, vMax].map((v, i) => (
        <text key={i} x={PAD.l - 4} y={py(v) + 3} textAnchor="end"
          fontSize={8} fill="var(--muted)">
          {yLabels[i]}{unit === '%' ? '%' : ''}
        </text>
      ))}

      {/* Threshold line */}
      {threshY != null && (
        <line x1={PAD.l} y1={threshY} x2={PAD.l + iW} y2={threshY}
          stroke="var(--c-warn)" strokeWidth={0.75} strokeDasharray="3,2" />
      )}

      {/* Data polyline */}
      <polyline points={dataPoints}
        fill="none" stroke="var(--accent)" strokeWidth={1.5}
        strokeLinejoin="round" strokeLinecap="round" />

      {/* Projection */}
      <polyline points={projPoints}
        fill="none" stroke={trendColor} strokeWidth={1} strokeDasharray="4,3" />

      {/* Current dot */}
      <circle cx={px(lastT)} cy={py(lastV)} r={3} fill="var(--accent)" />
    </svg>
  )
}

// ── Metric card ────────────────────────────────────────────────────────────────

const TREND_ICON = { rising: 'ti-trending-up', falling: 'ti-trending-down', stable: 'ti-minus' }

function MetricCard({ fc, timestamps }) {
  if (!fc) return null

  const hasData  = fc.current != null
  const urgency  = fc.days_until_threshold
  const trendBad = (fc.higher_is_bad && fc.trend === 'rising') ||
                   (!fc.higher_is_bad && fc.trend === 'falling')

  const urgencyColor = urgency != null
    ? urgency <= 30 ? 'var(--c-crit)' : urgency <= 90 ? 'var(--c-warn)' : 'var(--c-ok)'
    : 'var(--muted)'

  return (
    <div style={{
      background: 'var(--surface)', border: '0.5px solid var(--border)',
      borderRadius: 8, padding: '0.875rem 1rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, color: 'var(--text)' }}>
          {fc.label}
        </span>
        {hasData && (
          <i className={`ti ${TREND_ICON[fc.trend] ?? 'ti-minus'}`}
            style={{ fontSize: 13, color: trendBad ? 'var(--c-warn)' : 'var(--c-ok)', marginLeft: 'auto' }}
            aria-hidden="true" />
        )}
      </div>

      {hasData ? (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 8 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>
              {fc.current >= 1000 ? `${(fc.current / 1000).toFixed(1)}k` : fc.current.toFixed(fc.unit === '%' ? 1 : 0)}
            </span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>
              {fc.unit} · {fc.slope_per_day >= 0 ? '+' : ''}{fc.slope_per_day.toFixed(2)}/day
            </span>
          </div>

          <TrendChart
            history={fc.history}
            timestamps={timestamps}
            threshold={fc.threshold}
            higherIsBad={fc.higher_is_bad}
            slope={fc.slope_per_day}
            current={fc.current}
            unit={fc.unit}
          />

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
            {urgency != null ? (
              <>
                <i className="ti ti-clock-exclamation" style={{ fontSize: 11, color: urgencyColor }} aria-hidden="true" />
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: urgencyColor }}>
                  {urgency}d until {fc.threshold_label}
                </span>
              </>
            ) : fc.threshold != null ? (
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)' }}>
                threshold {fc.threshold}{fc.unit} — not approaching
              </span>
            ) : (
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)' }}>
                no threshold set
              </span>
            )}
            <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--muted)' }}>
              r²={fc.r_squared.toFixed(2)}
            </span>
          </div>
        </>
      ) : (
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', paddingTop: 4 }}>
          no data collected yet
        </div>
      )}
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

export default function CapacityView({ forecast }) {
  const urgent = useMemo(() => {
    if (!forecast?.forecasts) return []
    return forecast.forecasts
      .filter(f => f.days_until_threshold != null && f.days_until_threshold <= 90)
      .sort((a, b) => a.days_until_threshold - b.days_until_threshold)
  }, [forecast])

  if (!forecast) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--muted)' }}>
        <i className="ti ti-loader-2" style={{ marginRight: 6 }} aria-hidden="true" />
        loading capacity data…
      </div>
    )
  }

  const { forecasts = [], data_points = 0, timestamps = [] } = forecast

  const byKey = Object.fromEntries(forecasts.map(f => [f.metric, f]))

  const sections = [
    {
      title: 'Compute',
      metrics: ['vc_powered_on', 'vc_cpu_max_pct', 'vc_ram_max_pct', 'vc_idle'],
    },
    {
      title: 'Storage & Backup',
      metrics: ['al_util_pct', 'veeam_repo_pct'],
    },
    {
      title: 'Power & Health',
      metrics: ['ilo_total_power_w', 'score'],
    },
  ]

  return (
    <div style={{ padding: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1rem' }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
          Capacity Planning
        </h2>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>
          {data_points} snapshots · linear regression
        </span>
      </div>

      {urgent.length > 0 && (
        <div style={{
          background: 'rgba(239,68,68,0.07)', border: '0.5px solid var(--c-crit)',
          borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '1.25rem',
          fontFamily: 'var(--mono)', fontSize: 11,
        }}>
          <div style={{ fontWeight: 700, color: 'var(--c-crit)', marginBottom: 6 }}>
            <i className="ti ti-alert-triangle" style={{ marginRight: 6 }} aria-hidden="true" />
            Approaching thresholds
          </div>
          {urgent.map(f => (
            <div key={f.metric} style={{ color: 'var(--text)', marginBottom: 2 }}>
              <span style={{ color: 'var(--muted)' }}>{f.label}:</span>
              {' '}{f.days_until_threshold}d until {f.threshold_label}
              {' '}({f.current?.toFixed(1)}{f.unit} → {f.threshold}{f.unit})
            </div>
          ))}
        </div>
      )}

      {sections.map(sec => (
        <div key={sec.title} style={{ marginBottom: '1.5rem' }}>
          <div style={{
            fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 600,
            color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1,
            marginBottom: 8,
          }}>
            {sec.title}
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
            gap: 12,
          }}>
            {sec.metrics.map(key => (
              <MetricCard key={key} fc={byKey[key]} timestamps={timestamps} />
            ))}
          </div>
        </div>
      ))}

      {data_points < 4 && (
        <div style={{
          fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)',
          background: 'var(--surface)', border: '0.5px solid var(--border)',
          borderRadius: 8, padding: '0.75rem 1rem',
        }}>
          <i className="ti ti-info-circle" style={{ marginRight: 6 }} aria-hidden="true" />
          Trend lines improve with more data. Snapshots are collected every 15 minutes —
          check back after a few hours for meaningful projections.
        </div>
      )}
    </div>
  )
}
