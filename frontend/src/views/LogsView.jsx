import React, { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '../api'

const LEVELS = ['ALL', 'DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL']

const LEVEL_STYLE = {
  DEBUG:    { color: 'var(--muted)' },
  INFO:     { color: 'var(--text)' },
  WARNING:  { color: 'var(--c-warn, #f59e0b)' },
  ERROR:    { color: 'var(--c-crit)' },
  CRITICAL: { color: 'var(--c-crit)', fontWeight: 700 },
}

function fmtTime(iso) {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return iso
  }
}

function shortLogger(name) {
  // connectors.vcenter -> vcenter, routers.api -> api
  const parts = name.split('.')
  return parts[parts.length - 1]
}

export default function LogsView() {
  const [records,     setRecords]     = useState([])
  const [level,       setLevel]       = useState('ALL')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [loading,     setLoading]     = useState(true)
  const [clearing,    setClearing]    = useState(false)
  const [search,      setSearch]      = useState('')
  const bottomRef = useRef(null)
  const autoScrollRef = useRef(true)

  const load = useCallback(async () => {
    try {
      const data = await api.logs(level === 'ALL' ? null : level)
      setRecords(data.records ?? [])
    } catch {
      // silent — backend might not be ready
    } finally {
      setLoading(false)
    }
  }, [level])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!autoRefresh) return
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [autoRefresh, load])

  // Auto-scroll to bottom when new records arrive, unless user scrolled up
  useEffect(() => {
    if (autoScrollRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [records])

  async function handleClear() {
    setClearing(true)
    try {
      await api.clearLogs()
      setRecords([])
    } finally {
      setClearing(false)
    }
  }

  const filtered = search
    ? records.filter(r =>
        r.message.toLowerCase().includes(search.toLowerCase()) ||
        r.logger.toLowerCase().includes(search.toLowerCase())
      )
    : records

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)', gap: '0.75rem' }}>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {/* Level filter */}
        <div style={{ display: 'flex', gap: 4 }}>
          {LEVELS.map(l => (
            <button
              key={l}
              onClick={() => setLevel(l)}
              style={{
                fontFamily: 'var(--mono)', fontSize: 11,
                padding: '0.3rem 0.6rem', borderRadius: 5, border: '0.5px solid var(--border)',
                background: level === l ? 'var(--accent)' : 'var(--surface)',
                color: level === l ? 'var(--text)' : (LEVEL_STYLE[l]?.color ?? 'var(--muted)'),
                cursor: 'pointer',
              }}
            >
              {l}
            </button>
          ))}
        </div>

        {/* Search */}
        <input
          type="text"
          placeholder="filter…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            background: 'var(--bg)', border: '0.5px solid var(--border)', borderRadius: 6,
            padding: '0.3rem 0.6rem', fontFamily: 'var(--mono)', fontSize: 11,
            color: 'var(--text)', outline: 'none', width: 160,
          }}
        />

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Record count */}
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>
            {filtered.length} / 500
          </span>

          {/* Auto-refresh toggle */}
          <button
            onClick={() => setAutoRefresh(v => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              background: autoRefresh ? 'var(--accent)' : 'var(--surface)',
              border: '0.5px solid var(--border)', borderRadius: 6,
              padding: '0.3rem 0.65rem', fontFamily: 'var(--mono)', fontSize: 11,
              color: 'var(--text)', cursor: 'pointer',
            }}
          >
            <i className={`ti ${autoRefresh ? 'ti-player-pause' : 'ti-refresh'}`} />
            {autoRefresh ? 'Pause' : 'Resume'}
          </button>

          {/* Clear */}
          <button
            onClick={handleClear}
            disabled={clearing}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              background: 'var(--surface)', border: '0.5px solid var(--border)',
              borderRadius: 6, padding: '0.3rem 0.65rem',
              fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)',
              cursor: clearing ? 'not-allowed' : 'pointer',
            }}
          >
            <i className="ti ti-trash" />
            Clear
          </button>
        </div>
      </div>

      {/* Log pane */}
      <div
        onScroll={e => {
          const el = e.currentTarget
          autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
        style={{
          flex: 1, overflowY: 'auto',
          background: 'var(--bg)', border: '0.5px solid var(--border)', borderRadius: 8,
          fontFamily: 'var(--mono)', fontSize: 11,
        }}
      >
        {loading && records.length === 0 ? (
          <div style={{ padding: '2rem', color: 'var(--muted)', textAlign: 'center' }}>loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '2rem', color: 'var(--muted)', textAlign: 'center' }}>no log entries</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {filtered.map((r, i) => (
                <tr
                  key={i}
                  style={{
                    borderBottom: '0.5px solid var(--border)',
                    background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)',
                  }}
                >
                  <td style={{ padding: '3px 8px', color: 'var(--muted)', whiteSpace: 'nowrap', width: 80 }}>
                    {fmtTime(r.ts)}
                  </td>
                  <td style={{ padding: '3px 8px', whiteSpace: 'nowrap', width: 72, ...(LEVEL_STYLE[r.level] ?? {}) }}>
                    {r.level}
                  </td>
                  <td style={{ padding: '3px 8px', color: 'var(--c-blue)', whiteSpace: 'nowrap', width: 120 }}>
                    {shortLogger(r.logger)}
                  </td>
                  <td style={{ padding: '3px 10px', color: LEVEL_STYLE[r.level]?.color ?? 'var(--text)', wordBreak: 'break-all' }}>
                    {r.message}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
