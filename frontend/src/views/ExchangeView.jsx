import React, { useState, useEffect, useCallback } from 'react'
import { api } from '../api'

const TH = ({ children, align = 'left' }) => (
  <th style={{ padding: '0.45rem 0.75rem', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, textAlign: align, borderBottom: '0.5px solid var(--border)', whiteSpace: 'nowrap' }}>
    {children}
  </th>
)
const TD = ({ children, align = 'left', style = {} }) => (
  <td style={{ padding: '0.55rem 0.75rem', fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--text)', textAlign: align, borderBottom: '0.5px solid var(--border)', ...style }}>
    {children}
  </td>
)

function MetricCard({ label, value, unit = '', sub = '', warn = false, crit = false }) {
  const color = crit ? 'var(--c-crit)' : warn ? 'var(--c-warn)' : 'var(--text)'
  return (
    <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '1rem 1.2rem' }}>
      <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 600, fontFamily: 'var(--mono)', color }}>
        {value ?? <span style={{ color: 'var(--muted)', fontSize: 16 }}>—</span>}
        {unit && value != null && <span style={{ fontSize: 14, color: 'var(--muted)', marginLeft: 4 }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function MountedBadge({ mounted }) {
  return mounted
    ? <span style={{ color: 'var(--c-ok)', fontFamily: 'var(--mono)', fontSize: 11 }}>● mounted</span>
    : <span style={{ color: 'var(--c-crit)', fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700 }}>● dismounted</span>
}

function CopyBadge({ status }) {
  if (!status || status === 'Unknown') return <span style={{ color: 'var(--muted)', fontSize: 11, fontFamily: 'var(--mono)' }}>—</span>
  const color = status === 'Healthy' ? 'var(--c-ok)' : status === 'Failed' ? 'var(--c-crit)' : 'var(--c-warn)'
  return <span style={{ color, fontSize: 11, fontFamily: 'var(--mono)' }}>{status}</span>
}

function QueueBadge({ count }) {
  const color = count > 200 ? 'var(--c-crit)' : count > 50 ? 'var(--c-warn)' : count > 0 ? 'var(--text)' : 'var(--muted)'
  return <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color }}>{count.toLocaleString()}</span>
}

function StatusChip({ status }) {
  const overallColor = status === 'critical' ? 'var(--c-crit)' : status === 'warning' ? 'var(--c-warn)' : status === 'ok' ? 'var(--c-ok)' : 'var(--muted)'
  return (
    <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: overallColor, textTransform: 'uppercase', fontWeight: 700 }}>
      {status}
    </span>
  )
}

function RolesDisplay({ roles }) {
  if (!roles) return <span style={{ color: 'var(--muted)' }}>—</span>
  const parts = roles.split(',').map(r => r.trim()).filter(Boolean)
  return (
    <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>
      {parts.join(' · ')}
    </span>
  )
}

export default function ExchangeView() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('databases')

  const load = useCallback(async () => {
    try {
      setError(null)
      const d = await api.exchange()
      setData(d)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return (
    <div style={{ padding: '3rem', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--muted)' }}>
      loading Exchange…
    </div>
  )

  if (error) return (
    <div style={{ padding: '1.5rem' }}>
      <div style={{ background: '#fee2e2', border: '0.5px solid #fca5a5', borderRadius: 8, padding: '0.75rem 1rem', fontFamily: 'var(--mono)', fontSize: 12, color: '#991b1b' }}>
        <i className="ti ti-alert-circle" style={{ marginRight: 6 }} />
        {error}
      </div>
    </div>
  )

  if (!data || data.method === 'unconfigured') return (
    <div style={{ padding: '1.5rem', fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--muted)' }}>
      Exchange not configured — add EXCHANGE_SERVER and credentials in Settings.
    </div>
  )

  if (data.method === 'error') return (
    <div style={{ padding: '1.5rem' }}>
      <div style={{ background: '#fee2e2', border: '0.5px solid #fca5a5', borderRadius: 8, padding: '0.75rem 1rem', fontFamily: 'var(--mono)', fontSize: 12, color: '#991b1b' }}>
        <i className="ti ti-alert-circle" style={{ marginRight: 6 }} />
        Exchange connection failed — check server, credentials, and WinRM connectivity.
      </div>
    </div>
  )

  const dismountedDbs = data.databases?.filter(d => !d.mounted) ?? []
  const nonEmptyQueues = data.queues?.filter(q => q.message_count > 0) ?? []

  return (
    <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <i className="ti ti-mail" style={{ fontSize: 20, color: 'var(--muted)' }} aria-hidden="true" />
        <div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 15, fontWeight: 600 }}>
            MS Exchange
            {data.dag_name && <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 8 }}>DAG: {data.dag_name}</span>}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
            {data.servers?.length ?? 0} server{data.servers?.length !== 1 ? 's' : ''} · {data.databases?.length ?? 0} databases
          </div>
        </div>
        <div style={{ marginLeft: 'auto' }}><StatusChip status={data.status} /></div>
        <button onClick={load} style={{ background: 'none', border: '0.5px solid var(--border)', borderRadius: 6, padding: '0.3rem 0.6rem', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>
          <i className="ti ti-refresh" aria-hidden="true" /> refresh
        </button>
      </div>

      {/* Dismounted alert */}
      {dismountedDbs.length > 0 && (
        <div style={{ background: '#fee2e2', border: '0.5px solid #fca5a5', borderRadius: 8, padding: '0.75rem 1rem', fontFamily: 'var(--mono)', fontSize: 12, color: '#991b1b' }}>
          <i className="ti ti-alert-circle" style={{ marginRight: 6 }} />
          {dismountedDbs.length} database{dismountedDbs.length > 1 ? 's' : ''} dismounted: {dismountedDbs.map(d => d.name).join(', ')}
        </div>
      )}

      {/* Metric cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.75rem' }}>
        <MetricCard label="Databases" value={data.databases?.length ?? 0} sub={`${data.databases_mounted} mounted · ${data.databases_dismounted} dismounted`} crit={data.databases_dismounted > 0} />
        <MetricCard label="Servers" value={data.servers?.length ?? 0} />
        <MetricCard label="Queued Msgs" value={data.total_queued?.toLocaleString() ?? 0} warn={data.total_queued > 50} crit={data.total_queued > 200} />
        <MetricCard label="Active Queues" value={nonEmptyQueues.length} sub="queues with messages" />
      </div>

      {/* Servers table */}
      {data.servers?.length > 0 && (
        <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '0.75rem 1rem', fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.8, borderBottom: '0.5px solid var(--border)' }}>Servers</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <TH>Server</TH>
                <TH>Version</TH>
                <TH>Roles</TH>
                <TH align="right">Active Components</TH>
                <TH align="right">Inactive</TH>
              </tr>
            </thead>
            <tbody>
              {data.servers.map((s, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'var(--surface-alt, var(--surface))' }}>
                  <TD style={{ fontWeight: 600 }}>{s.name}</TD>
                  <TD style={{ color: 'var(--muted)' }}>{s.version || '—'}</TD>
                  <TD><RolesDisplay roles={s.roles} /></TD>
                  <TD align="right">
                    {s.components_active > 0 ? <span style={{ color: 'var(--c-ok)' }}>{s.components_active}</span> : '—'}
                  </TD>
                  <TD align="right">
                    {s.components_inactive > 0 ? <span style={{ color: 'var(--c-warn)' }}>{s.components_inactive}</span> : <span style={{ color: 'var(--muted)' }}>0</span>}
                  </TD>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tabs */}
      <div>
        <div style={{ display: 'flex', gap: 2, marginBottom: '0.75rem' }}>
          {[
            { id: 'databases', label: `Databases (${data.databases?.length ?? 0})` },
            { id: 'queues',    label: `Transport Queues (${nonEmptyQueues.length})` },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              background: tab === t.id ? 'var(--surface)' : 'none',
              border: `0.5px solid ${tab === t.id ? 'var(--border)' : 'transparent'}`,
              borderRadius: 6, padding: '0.35rem 0.75rem', cursor: 'pointer',
              fontFamily: 'var(--mono)', fontSize: 11, color: tab === t.id ? 'var(--text)' : 'var(--muted)',
            }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Databases */}
        {tab === 'databases' && (
          data.databases?.length === 0
            ? <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', padding: '1rem 0' }}>No databases found.</div>
            : (
              <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <TH>Database</TH>
                      <TH>Server</TH>
                      <TH>State</TH>
                      <TH align="right">Size</TH>
                      <TH align="right">Free</TH>
                      <TH align="right">Mailboxes</TH>
                      <TH>DAG Copy</TH>
                      <TH align="right">Copy Queue</TH>
                    </tr>
                  </thead>
                  <tbody>
                    {data.databases
                      ?.slice()
                      .sort((a, b) => (a.mounted === b.mounted ? 0 : a.mounted ? 1 : -1) || a.name.localeCompare(b.name))
                      .map((db, i) => (
                        <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'var(--surface-alt, var(--surface))' }}>
                          <TD style={{ fontWeight: 600 }}>{db.name}</TD>
                          <TD style={{ color: 'var(--muted)' }}>{db.server || '—'}</TD>
                          <TD><MountedBadge mounted={db.mounted} /></TD>
                          <TD align="right">{db.size_gb != null ? `${db.size_gb.toFixed(1)} GB` : '—'}</TD>
                          <TD align="right">{db.whitespace_gb != null ? `${db.whitespace_gb.toFixed(1)} GB` : '—'}</TD>
                          <TD align="right">{db.mailbox_count?.toLocaleString() ?? '—'}</TD>
                          <TD><CopyBadge status={db.copy_status} /></TD>
                          <TD align="right">
                            {db.copy_queue_length > 0
                              ? <span style={{ color: 'var(--c-warn)' }}>{db.copy_queue_length}</span>
                              : <span style={{ color: 'var(--muted)' }}>0</span>}
                          </TD>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )
        )}

        {/* Queues */}
        {tab === 'queues' && (
          nonEmptyQueues.length === 0
            ? <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', padding: '1rem 0' }}>No messages in transport queues.</div>
            : (
              <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <TH>Queue</TH>
                      <TH>Delivery Type</TH>
                      <TH>Status</TH>
                      <TH align="right">Messages</TH>
                      <TH>Next Hop</TH>
                    </tr>
                  </thead>
                  <tbody>
                    {nonEmptyQueues.map((q, i) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'var(--surface-alt, var(--surface))' }}>
                        <TD style={{ fontSize: 11 }}>{q.identity}</TD>
                        <TD style={{ color: 'var(--muted)' }}>{q.delivery_type || '—'}</TD>
                        <TD>
                          <span style={{
                            fontSize: 11, fontFamily: 'var(--mono)',
                            color: q.status === 'Active' ? 'var(--c-ok)' : q.status === 'Retry' ? 'var(--c-warn)' : q.status === 'Suspended' ? 'var(--c-crit)' : 'var(--muted)',
                          }}>
                            {q.status || '—'}
                          </span>
                        </TD>
                        <TD align="right"><QueueBadge count={q.message_count} /></TD>
                        <TD style={{ color: 'var(--muted)', fontSize: 11 }}>{q.next_hop || '—'}</TD>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
        )}
      </div>
    </div>
  )
}
