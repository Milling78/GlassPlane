import React, { useState, useRef, useEffect } from 'react'
import { aiStreamFetch } from '../api'

// ── Snapshot builder — compact summary of current infra state ─────────────────

function buildSnapshot(summary, iloSummary, certsSummary) {
  const snap = { timestamp: new Date().toISOString() }

  if (summary?.vcenter) {
    const vms = summary.vcenter.vms ?? []
    const on  = vms.filter(v => v.power_state === 'poweredOn')
    snap.vcenter = {
      vm_count: vms.length,
      powered_on: on.length,
      powered_off: vms.length - on.length,
      idle_vms: on.filter(v => v.is_idle).length,
      oversized_vms: on.filter(v => v.is_oversized).length,
      clusters: (summary.vcenter.clusters ?? []).map(c => ({
        name: c.name,
        vm_count: c.vm_count,
        cpu_pct: Math.round(c.cpu_util_pct ?? 0),
        ram_pct: Math.round(c.ram_util_pct ?? 0),
      })),
      top_idle: on.filter(v => v.is_idle).slice(0, 8).map(v => ({
        name: v.name, cluster: v.cluster,
        cpu_pct: Math.round(v.cpu_util_pct), ram_pct: Math.round(v.ram_util_pct),
      })),
      top_oversized: on.filter(v => v.is_oversized).slice(0, 8).map(v => ({
        name: v.name, cluster: v.cluster,
        cpu_alloc_ghz: (v.cpu_allocated_mhz / 1000).toFixed(1),
        ram_alloc_gb: Math.round(v.ram_allocated_mb / 1024),
        ram_used_gb: Math.round((v.ram_used_mb ?? 0) / 1024),
      })),
    }
  }

  if (summary?.alletra) {
    const a = summary.alletra
    snap.storage = {
      array_name: a.array_name, model: a.model,
      used_tb: a.used_tb, usable_tb: a.usable_tb, util_pct: a.util_pct,
      efficiency_ratio: a.total_efficiency_ratio, volume_count: a.volume_count,
      iops: a.iops, latency_ms: a.latency_ms,
    }
  }

  if (iloSummary?.hosts) {
    snap.servers = {
      host_count: iloSummary.host_count,
      total_power_watts: iloSummary.total_power_watts,
      error_count: iloSummary.error_count,
      amber_hosts: iloSummary.hosts
        .filter(h => h.amber_conditions?.length > 0)
        .map(h => ({
          hostname: h.server_name ?? h.hostname,
          health: h.health,
          conditions: h.amber_conditions,
        })),
      iml_errors: iloSummary.hosts
        .filter(h => h.recent_errors?.length > 0)
        .map(h => ({ hostname: h.server_name ?? h.hostname, errors: h.recent_errors })),
    }
  }

  if (summary?.veeam) {
    const v = summary.veeam
    snap.backups = {
      running_jobs: v.running_jobs, failed_jobs: v.failed_jobs,
      protected_vms: v.protected_vms, unprotected_vms: v.unprotected_vms,
      repo_util_pct: v.repo_util_pct,
    }
  }

  if (certsSummary) {
    const expiring = (certsSummary.certs ?? []).filter(c => c.days_remaining != null && c.days_remaining < 30)
    snap.certificates = {
      total: certsSummary.total ?? 0,
      expiring_soon: expiring.length,
      expiring_detail: expiring.map(c => ({ host: c.host, cn: c.cn, days: c.days_remaining })),
    }
  }

  if (summary?.aruba) {
    const a = summary.aruba
    snap.networking = {
      switch_count: a.switch_count, total_ports: a.total_ports,
      unused_ports: a.unused_ports, unused_port_pct: a.unused_port_pct,
    }
  }

  return snap
}

// ── Markdown renderer (no dependency — handles headers, bullets, bold, code) ──

function MdInline({ text }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith('**') && p.endsWith('**'))
          return <strong key={i}>{p.slice(2, -2)}</strong>
        if (p.startsWith('`') && p.endsWith('`'))
          return (
            <code key={i} style={{
              background: 'var(--bg)', padding: '1px 5px', borderRadius: 3,
              fontSize: '0.88em', fontFamily: 'var(--mono)',
              border: '0.5px solid var(--border)',
            }}>{p.slice(1, -1)}</code>
          )
        return <span key={i}>{p}</span>
      })}
    </>
  )
}

function MarkdownText({ text }) {
  if (!text) return null
  return (
    <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text)' }}>
      {text.split('\n').map((line, i) => {
        if (line.startsWith('### '))
          return <div key={i} style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--c-blue)', marginTop: 14, marginBottom: 4 }}>{line.slice(4)}</div>
        if (line.startsWith('## '))
          return <div key={i} style={{ fontWeight: 700, fontSize: 14, marginTop: 16, marginBottom: 4 }}><MdInline text={line.slice(3)} /></div>
        if (line.startsWith('# '))
          return <div key={i} style={{ fontWeight: 700, fontSize: 15, marginTop: 18, marginBottom: 6 }}><MdInline text={line.slice(2)} /></div>
        if (line.startsWith('- ') || line.startsWith('* '))
          return <div key={i} style={{ display: 'flex', gap: 8, paddingLeft: 8, marginTop: 3 }}>
            <span style={{ color: 'var(--c-blue)', flexShrink: 0, fontWeight: 700 }}>·</span>
            <span><MdInline text={line.slice(2)} /></span>
          </div>
        if (/^\d+\.\s/.test(line))
          return <div key={i} style={{ paddingLeft: 8, marginTop: 3 }}><MdInline text={line} /></div>
        if (line.trim() === '---' || line.trim() === '***')
          return <hr key={i} style={{ border: 'none', borderTop: '0.5px solid var(--border)', margin: '10px 0' }} />
        if (!line.trim())
          return <div key={i} style={{ height: 8 }} />
        return <div key={i}><MdInline text={line} /></div>
      })}
    </div>
  )
}

// ── Typing indicator ──────────────────────────────────────────────────────────

function TypingDots() {
  return (
    <div style={{ display: 'flex', gap: 5, alignItems: 'center', padding: '4px 0' }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          width: 6, height: 6, borderRadius: '50%', background: 'var(--muted)',
          animation: 'gp-pulse 1.2s ease-in-out infinite',
          animationDelay: `${i * 0.2}s`,
        }} />
      ))}
    </div>
  )
}

// ── Quick-start prompts ───────────────────────────────────────────────────────

const QUICK = [
  {
    label: 'Full analysis',
    icon: 'ti-sparkles',
    text: 'Analyze my infrastructure and give me the top patterns, risks, and optimization opportunities. Prioritize by business impact.',
  },
  {
    label: 'VM efficiency',
    icon: 'ti-server-2',
    text: 'Which VMs are idle or oversized? Estimate total recoverable RAM and CPU GHz, and give me a prioritized rightsizing list.',
  },
  {
    label: 'Capacity outlook',
    icon: 'ti-database',
    text: 'How is storage capacity trending? When should I expect issues, and which volumes or workloads are the biggest consumers?',
  },
  {
    label: 'Health & risks',
    icon: 'ti-heart-rate-monitor',
    text: 'Are there hardware health warnings, expiring certificates, or backup failures that need immediate attention?',
  },
]

// ── Main view ─────────────────────────────────────────────────────────────────

export default function InsightsView({ summary, iloSummary, certsSummary }) {
  const [messages, setMessages] = useState([])
  const [input, setInput]       = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError]       = useState(null)
  const bottomRef  = useRef(null)
  const abortRef   = useRef(null)
  const snapshotRef = useRef(null)

  // Rebuild snapshot whenever props update
  useEffect(() => {
    snapshotRef.current = buildSnapshot(summary, iloSummary, certsSummary)
  }, [summary, iloSummary, certsSummary])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function send(text) {
    const userContent = text.trim()
    if (!userContent || streaming) return

    setError(null)
    setInput('')

    const userMsg      = { role: 'user',      content: userContent }
    const assistantMsg = { role: 'assistant', content: '' }

    setMessages(prev => [...prev, userMsg, assistantMsg])
    setStreaming(true)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const allMessages = [...messages, userMsg].map(m => ({ role: m.role, content: m.content }))
      const stream = await aiStreamFetch(allMessages, snapshotRef.current, controller.signal)

      const reader  = stream.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6)
          if (raw === '[DONE]') break
          try {
            const { text: chunk } = JSON.parse(raw)
            if (chunk) {
              setMessages(prev => {
                const next = [...prev]
                const last = next[next.length - 1]
                next[next.length - 1] = { ...last, content: last.content + chunk }
                return next
              })
            }
          } catch { /* skip malformed SSE chunk */ }
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        setError(e.message)
        // remove the empty assistant placeholder on hard error
        setMessages(prev => prev.slice(0, -1))
      }
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }

  function stop() {
    abortRef.current?.abort()
  }

  function reset() {
    stop()
    setMessages([])
    setInput('')
    setError(null)
    setStreaming(false)
  }

  const hasMessages = messages.length > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 110px)' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexShrink: 0 }}>
        <i className="ti ti-brain" style={{ fontSize: 18, color: 'var(--c-blue)' }} aria-hidden="true" />
        <span style={{ fontWeight: 600, fontSize: 15 }}>Infrastructure Insights</span>
        <span style={{
          fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)',
          background: 'var(--bg)', border: '0.5px solid var(--border)',
          borderRadius: 4, padding: '1px 7px',
        }}>claude</span>
        {hasMessages && (
          <button
            onClick={reset}
            style={{
              marginLeft: 'auto', fontSize: 11, fontFamily: 'var(--mono)',
              color: 'var(--muted)', background: 'transparent',
              border: '0.5px solid var(--border)', borderRadius: 4,
              padding: '3px 10px', cursor: 'pointer',
            }}
          >
            new conversation
          </button>
        )}
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div style={{
          background: '#fee2e2', border: '0.5px solid #fca5a5', borderRadius: 6,
          padding: '6px 10px', fontFamily: 'var(--mono)', fontSize: 12,
          color: '#991b1b', marginBottom: 8, flexShrink: 0,
        }}>
          <i className="ti ti-alert-circle" style={{ marginRight: 6 }} aria-hidden="true" />
          {error}
        </div>
      )}

      {/* ── Message area ── */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {!hasMessages ? (
          // Quick-start prompts
          <div style={{
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            height: '100%', gap: 20,
          }}>
            <div style={{ textAlign: 'center', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 12 }}>
              <i className="ti ti-sparkles" style={{ fontSize: 28, display: 'block', marginBottom: 8, color: 'var(--c-blue)' }} aria-hidden="true" />
              ask about your infrastructure
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, maxWidth: 480, width: '100%' }}>
              {QUICK.map(p => (
                <button
                  key={p.label}
                  onClick={() => send(p.text)}
                  style={{
                    padding: '10px 14px', textAlign: 'left', cursor: 'pointer',
                    background: 'var(--card)', border: '0.5px solid var(--border)',
                    borderRadius: 8, fontFamily: 'var(--mono)', fontSize: 12,
                    color: 'var(--text)', display: 'flex', alignItems: 'flex-start', gap: 8,
                    transition: 'border-color 0.1s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--c-blue)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                >
                  <i className={`ti ${p.icon}`} style={{ color: 'var(--c-blue)', fontSize: 14, marginTop: 1, flexShrink: 0 }} aria-hidden="true" />
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          // Conversation thread
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {messages.map((msg, i) => (
              <div
                key={i}
                style={{
                  padding: '14px 16px',
                  background: msg.role === 'user'
                    ? 'color-mix(in srgb, var(--c-blue) 5%, transparent)'
                    : 'transparent',
                  borderBottom: '0.5px solid var(--border)',
                  display: 'flex', gap: 12, alignItems: 'flex-start',
                }}
              >
                {/* Avatar */}
                <div style={{
                  width: 24, height: 24, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: msg.role === 'user' ? 'var(--c-blue)' : 'var(--border)',
                  fontSize: 11,
                }}>
                  <i
                    className={`ti ${msg.role === 'user' ? 'ti-user' : 'ti-brain'}`}
                    style={{ color: msg.role === 'user' ? '#fff' : 'var(--muted)' }}
                    aria-hidden="true"
                  />
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  {msg.role === 'user'
                    ? <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                    : msg.content
                      ? <MarkdownText text={msg.content} />
                      : <TypingDots />
                  }
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* ── Input bar ── */}
      <div style={{
        borderTop: '0.5px solid var(--border)', paddingTop: 10,
        display: 'flex', gap: 8, alignItems: 'flex-end', flexShrink: 0,
      }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) }
          }}
          placeholder="Ask about your infrastructure… (Enter sends, Shift+Enter for newline)"
          disabled={streaming}
          rows={2}
          style={{
            flex: 1, resize: 'none', fontSize: 13, padding: '8px 10px',
            borderRadius: 6, lineHeight: 1.5, opacity: streaming ? 0.6 : 1,
          }}
        />
        {streaming
          ? <button
              onClick={stop}
              style={{
                fontSize: 12, padding: '8px 16px', borderRadius: 6,
                background: 'var(--c-crit)', color: '#fff',
                border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)',
              }}
            >
              stop
            </button>
          : <button
              onClick={() => send(input)}
              disabled={!input.trim()}
              style={{
                fontSize: 12, padding: '8px 16px', borderRadius: 6,
                background: input.trim() ? 'var(--c-blue)' : 'var(--bg)',
                color: input.trim() ? '#fff' : 'var(--muted)',
                border: `0.5px solid ${input.trim() ? 'var(--c-blue)' : 'var(--border)'}`,
                cursor: input.trim() ? 'pointer' : 'default',
                fontFamily: 'var(--mono)',
              }}
            >
              send ↵
            </button>
        }
      </div>

      <style>{`
        @keyframes gp-pulse {
          0%, 100% { opacity: 0.25; transform: scale(0.75); }
          50%       { opacity: 1;    transform: scale(1);    }
        }
      `}</style>
    </div>
  )
}
