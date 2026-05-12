import React from 'react'

const W = 100, H = 30, PAD = 2

export default function Sparkline({ data = [], color = 'var(--c-blue)', height = 32 }) {
  const vals = data.filter(v => v != null)
  if (vals.length < 2) return <div style={{ height }} />

  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const range = max - min || 1

  const toX = i => PAD + (i / (data.length - 1)) * (W - 2 * PAD)
  const toY = v => PAD + (1 - (v - min) / range) * (H - 2 * PAD)

  const pts = data.map((v, i) => ({ x: toX(i), y: v != null ? toY(v) : null }))

  // Split into continuous segments to skip nulls
  const segments = []
  let seg = []
  pts.forEach(p => {
    if (p.y != null) {
      seg.push(p)
    } else if (seg.length) {
      segments.push(seg)
      seg = []
    }
  })
  if (seg.length) segments.push(seg)

  const allSegs = segments.flat()
  const last = allSegs[allSegs.length - 1]

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height, display: 'block' }}
    >
      {segments.map((s, i) => (
        <polygon
          key={i}
          points={[...s.map(p => `${p.x},${p.y}`), `${s[s.length - 1].x},${H}`, `${s[0].x},${H}`].join(' ')}
          fill={color}
          opacity={0.15}
        />
      ))}
      {segments.map((s, i) => (
        <polyline
          key={i}
          points={s.map(p => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {last && (
        <circle cx={last.x} cy={last.y} r={2} fill={color} vectorEffect="non-scaling-stroke" />
      )}
    </svg>
  )
}
