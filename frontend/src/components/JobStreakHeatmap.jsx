import React, { useMemo, useState } from 'react'

const CELL = 15
const GAP  = 3
const RANK = { Failed: 3, Warning: 2, Success: 1, None: 0 }
const COLOR = { Success: '#22c55e', Warning: '#f59e0b', Failed: '#ef4444' }

function buildDays(days) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(today)
    d.setDate(d.getDate() - (days - 1 - i))
    return d
  })
}

function dayKey(d) {
  return d.toISOString().slice(0, 10)
}

function fmtDuration(secs) {
  if (!secs) return ''
  const m = Math.round(secs / 60)
  return m < 60 ? `${m}m` : `${Math.floor(m/60)}h ${m%60}m`
}

export default function JobStreakHeatmap({ sessions, days = 30 }) {
  const [tooltip, setTooltip] = useState(null)  // { x, y, text }

  const dayDates = useMemo(() => buildDays(days), [days])

  const jobs = useMemo(() => {
    const map = {}
    sessions.forEach(s => {
      if (!s.start_time) return
      const jid = s.job_id || s.job_name
      if (!map[jid]) map[jid] = { name: s.job_name, byDay: {} }
      const d = new Date(s.start_time); d.setHours(0, 0, 0, 0)
      const key = dayKey(d)
      const prev = map[jid].byDay[key]
      if (!prev || (RANK[s.result] ?? 0) > (RANK[prev.result] ?? 0)) {
        map[jid].byDay[key] = s
      }
    })
    return Object.values(map).sort((a, b) => a.name.localeCompare(b.name))
  }, [sessions])

  if (!jobs.length) {
    return (
      <div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
        no session history returned — check that the Veeam account has read access to sessions
      </div>
    )
  }

  const todayKey = dayKey(new Date())

  return (
    <div style={{ overflowX: 'auto', position: 'relative' }}>
      {/* Day header */}
      <div style={{ display: 'flex', marginLeft: 168, gap: GAP, marginBottom: 6 }}>
        {dayDates.map((d, i) => {
          const isToday = dayKey(d) === todayKey
          const showLabel = isToday || d.getDate() === 1 || i === 0 || i === days - 1
          return (
            <div
              key={i}
              style={{
                width: CELL, fontSize: 9, textAlign: 'center', flexShrink: 0,
                fontFamily: 'var(--mono)',
                color: isToday ? 'var(--c-blue)' : 'var(--muted)',
                fontWeight: isToday ? 700 : 400,
              }}
            >
              {showLabel
                ? (isToday ? '·' : d.getDate() === 1
                    ? d.toLocaleDateString('en', { month: 'short' })
                    : String(d.getDate()))
                : ''}
            </div>
          )
        })}
      </div>

      {/* Job rows */}
      {jobs.map(job => (
        <div key={job.name} style={{ display: 'flex', alignItems: 'center', gap: GAP, marginBottom: GAP }}>
          <div
            title={job.name}
            style={{
              width: 160, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis',
              whiteSpace: 'nowrap', textAlign: 'right', paddingRight: 8,
              fontFamily: 'var(--mono)', color: 'var(--text)', flexShrink: 0,
            }}
          >{job.name}</div>

          {dayDates.map((d, i) => {
            const key  = dayKey(d)
            const run  = job.byDay[key]
            const bg   = run ? (COLOR[run.result] ?? '#6b7280') : 'transparent'
            const isToday = key === todayKey
            const dateStr = d.toLocaleDateString('en', { month: 'short', day: 'numeric' })
            const tipText  = run
              ? `${job.name}\n${dateStr}: ${run.result}${run.duration_seconds ? ' · ' + fmtDuration(run.duration_seconds) : ''}`
              : `${job.name}\n${dateStr}: no run`

            return (
              <div
                key={i}
                title={tipText}
                style={{
                  width: CELL, height: CELL, borderRadius: 3, flexShrink: 0,
                  background: bg,
                  border: run
                    ? 'none'
                    : `0.5px solid ${isToday ? 'var(--c-blue)' : 'var(--border)'}`,
                  opacity: run ? 1 : 0.45,
                  cursor: run ? 'default' : 'default',
                  boxSizing: 'border-box',
                }}
              />
            )
          })}
        </div>
      ))}

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, marginTop: 10, marginLeft: 168, alignItems: 'center' }}>
        {[
          [COLOR.Success, 'success'],
          [COLOR.Warning, 'warning'],
          [COLOR.Failed,  'failed'],
          ['transparent', 'no run'],
        ].map(([c, l]) => (
          <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: c, border: l === 'no run' ? '0.5px solid var(--border)' : 'none', flexShrink: 0 }} />
            {l}
          </div>
        ))}
      </div>
    </div>
  )
}
