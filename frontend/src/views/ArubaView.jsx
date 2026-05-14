import React, { useState, useEffect } from 'react'
import { api } from '../api'
import SwitchDetailModal from '../components/SwitchDetailModal'

function fmtUptime(secs) {
  if (!secs) return '—'
  const d = Math.floor(secs / 86400)
  const h = Math.floor((secs % 86400) / 3600)
  return d > 0 ? `${d}d ${h}h` : `${h}h ${Math.floor((secs % 3600) / 60)}m`
}

function SwitchRow({ sw, onClick }) {
  return (
    <tr onClick={onClick} style={{ cursor: 'pointer' }} className="hoverable-row">
      <td style={{ fontWeight: 500 }}>
        {sw.name}
        {sw.source === 'direct' && (
          <span style={{ marginLeft: 6, fontSize: 10, fontFamily: 'var(--mono)', background: 'rgba(59,130,246,0.12)', color: 'var(--c-blue)', borderRadius: 4, padding: '1px 5px' }}>DIRECT</span>
        )}
      </td>
      <td>{sw.model}</td>
      <td>{sw.site !== 'direct' ? sw.site : sw.ip || '—'}</td>
      <td style={{ color: sw.cpu_util_pct > 70 ? 'var(--c-warn)' : undefined }}>{sw.cpu_util_pct}%</td>
      <td>{sw.mem_util_pct}%</td>
      <td>{sw.unused_ports} / {sw.port_count}</td>
      <td>{fmtUptime(sw.uptime_seconds)}</td>
      <td><span className={`badge ${sw.status === 'ok' ? 'b-on' : 'b-off'}`}>{sw.status}</span></td>
    </tr>
  )
}

function ApStatusBadge({ status }) {
  const ok = status === 'ok'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 10, fontFamily: 'var(--mono)', fontWeight: 700,
      color: ok ? 'var(--c-green)' : 'var(--c-crit)',
      background: ok ? 'rgba(34,197,94,0.10)' : 'rgba(239,68,68,0.10)',
      borderRadius: 6, padding: '2px 7px',
    }}>
      <i className={`ti ${ok ? 'ti-wifi' : 'ti-wifi-off'}`} aria-hidden="true" />
      {ok ? 'online' : 'offline'}
    </span>
  )
}

function SourceBadge({ source }) {
  if (source === 'direct') return (
    <span style={{ marginLeft: 6, fontSize: 10, fontFamily: 'var(--mono)', background: 'rgba(59,130,246,0.12)', color: 'var(--c-blue)', borderRadius: 4, padding: '1px 5px' }}>DIRECT</span>
  )
  return null
}

function WirelessTab({ wirelessData, wirelessLoading, wirelessDirectData, wirelessDirectLoading }) {
  const centralAps = wirelessData?.aps ?? []
  const directAps  = wirelessDirectData?.aps ?? []
  const allAps     = [...centralAps, ...directAps].sort((a, b) => b.client_count - a.client_count || a.name.localeCompare(b.name))
  const showSource = centralAps.length > 0 && directAps.length > 0

  const loading = wirelessLoading || wirelessDirectLoading
  const hasData = wirelessData || wirelessDirectData

  if (loading && !hasData) return (
    <div style={{ padding: '3rem', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--muted)' }}>
      fetching access points…
    </div>
  )
  if (!hasData) return (
    <div style={{ padding: '3rem', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--muted)' }}>
      no wireless data — configure Aruba Central or a Wireless Controller in Settings
    </div>
  )

  const totalAps     = allAps.length
  const onlineCount  = allAps.filter(a => a.status === 'ok').length
  const offlineCount = totalAps - onlineCount
  const totalClients = allAps.reduce((s, a) => s + a.client_count, 0)

  return (
    <div>
      {/* Summary metrics */}
      <div className="metrics" style={{ marginBottom: '1rem' }}>
        <div className="metric">
          <div className="metric-label">access points</div>
          <div className="metric-val">{totalAps}</div>
          {centralAps.length > 0 && directAps.length > 0 && (
            <div className="metric-sub">{centralAps.length} Central · {directAps.length} direct</div>
          )}
        </div>
        <div className="metric">
          <div className="metric-label">online</div>
          <div className="metric-val" style={{ color: 'var(--c-green)' }}>{onlineCount}</div>
        </div>
        {offlineCount > 0 && (
          <div className="metric">
            <div className="metric-label">offline</div>
            <div className="metric-val" style={{ color: 'var(--c-crit)' }}>{offlineCount}</div>
          </div>
        )}
        <div className="metric">
          <div className="metric-label">total clients</div>
          <div className="metric-val">{totalClients}</div>
        </div>
        {wirelessDirectLoading && (
          <div className="metric">
            <div className="metric-label" style={{ color: 'var(--muted)' }}>controller…</div>
            <div className="metric-val" style={{ fontSize: 12, color: 'var(--muted)' }}>loading</div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">
            <i className="ti ti-wifi" style={{ color: 'var(--c-blue)' }} aria-hidden="true" />
            Access point inventory
          </div>
        </div>
        <div className="tbl-wrap">
          <table style={{ tableLayout: 'auto' }}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Model</th>
                {!showSource && <th>Site</th>}
                <th>Group</th>
                <th>IP</th>
                <th style={{ textAlign: 'right' }}>Clients</th>
                <th>Ch 2.4G</th>
                <th>Ch 5G</th>
                <th>Uptime</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {allAps.map(ap => (
                <tr key={`${ap.source}-${ap.ap_id}`}>
                  <td style={{ fontWeight: 500 }}>
                    {ap.name}
                    {showSource && <SourceBadge source={ap.source} />}
                  </td>
                  <td style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 12 }}>{ap.model || '—'}</td>
                  {!showSource && <td style={{ color: 'var(--muted)' }}>{ap.site || '—'}</td>}
                  <td style={{ color: 'var(--muted)' }}>{ap.group || '—'}</td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>{ap.ip_address || '—'}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600 }}>{ap.client_count}</td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>{ap.channel_2g ?? '—'}</td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>{ap.channel_5g ?? '—'}</td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>{fmtUptime(ap.uptime_seconds)}</td>
                  <td><ApStatusBadge status={ap.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function SwitchesTab({ data, directData, directLoading, setSelected }) {
  const centralSwitches = data?.switches ?? []
  const directSwitches  = directData ?? []

  if (!data && !directData && !directLoading) return (
    <div style={{ padding: '3rem', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--muted)' }}>
      no switch data — configure Central or Direct switches in Settings
    </div>
  )

  return (
    <div>
      {/* Summary metrics */}
      <div className="metrics" style={{ marginBottom: '1rem' }}>
        {data && (
          <>
            <div className="metric"><div className="metric-label">Central switches</div><div className="metric-val">{data.switch_count}</div></div>
            <div className="metric"><div className="metric-label">total ports</div><div className="metric-val">{data.total_ports}</div></div>
            <div className="metric">
              <div className="metric-label">unused ports</div>
              <div className="metric-val" style={{ color: data.unused_port_pct > 20 ? 'var(--c-warn)' : undefined }}>{data.unused_ports}</div>
              <div className="metric-sub">{data.unused_port_pct}%</div>
            </div>
          </>
        )}
        {directSwitches.length > 0 && (
          <div className="metric">
            <div className="metric-label">direct switches</div>
            <div className="metric-val">{directSwitches.length}</div>
          </div>
        )}
      </div>

      {/* Central-managed switches */}
      {centralSwitches.length > 0 && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <div className="card-header">
            <div className="card-title">
              <i className="ti ti-cloud" style={{ color: 'var(--c-blue)' }} aria-hidden="true" />
              Aruba Central — managed switches
            </div>
          </div>
          <div className="tbl-wrap">
            <table style={{ tableLayout: 'auto' }}>
              <thead>
                <tr><th>Name</th><th>Model</th><th>Site</th><th>CPU %</th><th>Mem %</th><th>Unused / Total</th><th>Uptime</th><th>Status</th></tr>
              </thead>
              <tbody>
                {centralSwitches.map(s => (
                  <SwitchRow key={s.device_id} sw={s} onClick={() => setSelected(s)} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Directly connected switches */}
      {(directSwitches.length > 0 || directLoading) && (
        <div className="card">
          <div className="card-header">
            <div className="card-title">
              <i className="ti ti-plug-connected" style={{ color: 'var(--c-blue)' }} aria-hidden="true" />
              Direct switches
            </div>
            {directLoading && (
              <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>connecting…</span>
            )}
          </div>
          {directSwitches.length > 0 ? (
            <div className="tbl-wrap">
              <table style={{ tableLayout: 'auto' }}>
                <thead>
                  <tr><th>Name</th><th>Model</th><th>IP / Host</th><th>CPU %</th><th>Mem %</th><th>Unused / Total</th><th>Uptime</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {directSwitches.map(s => (
                    <SwitchRow key={s.device_id} sw={s} onClick={() => setSelected(s)} />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            !directLoading && (
              <div className="card-body" style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 12 }}>
                no direct switches configured — add IPs to ARUBA_DIRECT_HOSTS in Settings
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}

const TABS = [
  { id: 'switches', label: 'Switches', icon: 'ti-switch' },
  { id: 'wireless', label: 'Wireless / APs', icon: 'ti-wifi' },
]

export default function ArubaView({ data }) {
  const [tab, setTab]                   = useState('switches')
  const [selected, setSelected]         = useState(null)
  const [directData, setDirectData]     = useState(null)
  const [directLoading, setDirectLoading] = useState(false)
  const [wirelessData,       setWirelessData]       = useState(null)
  const [wirelessLoading,    setWirelessLoading]    = useState(false)
  const [wirelessDirectData, setWirelessDirectData] = useState(null)
  const [wirelessDirectLoading, setWirelessDirectLoading] = useState(false)
  const wirelessFetched = useState(false)

  useEffect(() => {
    setDirectLoading(true)
    api.arubaDirectSwitches()
      .then(d => { setDirectData(d); setDirectLoading(false) })
      .catch(() => setDirectLoading(false))
  }, [])

  useEffect(() => {
    if (tab !== 'wireless' || wirelessFetched[0]) return
    wirelessFetched[1](true)

    setWirelessLoading(true)
    api.arubaWireless()
      .then(d => { setWirelessData(d); setWirelessLoading(false) })
      .catch(() => setWirelessLoading(false))

    setWirelessDirectLoading(true)
    api.arubaWirelessDirect()
      .then(d => { setWirelessDirectData(d); setWirelessDirectLoading(false) })
      .catch(() => setWirelessDirectLoading(false))
  }, [tab])

  return (
    <div>
      {/* Tab selector */}
      <div style={{ display: 'flex', gap: 6, marginBottom: '1rem' }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              fontSize: 12, fontFamily: 'var(--mono)', padding: '5px 14px',
              borderRadius: 7, border: '0.5px solid var(--border)',
              background: tab === t.id ? 'var(--c-blue)' : 'transparent',
              color: tab === t.id ? '#fff' : 'var(--muted)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <i className={`ti ${t.icon}`} aria-hidden="true" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'switches' && (
        <SwitchesTab
          data={data}
          directData={directData}
          directLoading={directLoading}
          setSelected={setSelected}
        />
      )}
      {tab === 'wireless' && (
        <WirelessTab
          wirelessData={wirelessData}
          wirelessLoading={wirelessLoading}
          wirelessDirectData={wirelessDirectData}
          wirelessDirectLoading={wirelessDirectLoading}
        />
      )}

      <SwitchDetailModal sw={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
