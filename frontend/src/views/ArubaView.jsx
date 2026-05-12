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

function WirelessTab({ wirelessData, wirelessLoading }) {
  if (wirelessLoading) return (
    <div style={{ padding: '3rem', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--muted)' }}>
      fetching access points…
    </div>
  )
  if (!wirelessData) return (
    <div style={{ padding: '3rem', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--muted)' }}>
      Aruba Central wireless not configured
    </div>
  )

  const { ap_count, online_count, offline_count, total_clients, aps } = wirelessData

  return (
    <div>
      {/* Summary metrics */}
      <div className="metrics" style={{ marginBottom: '1rem' }}>
        <div className="metric">
          <div className="metric-label">access points</div>
          <div className="metric-val">{ap_count}</div>
        </div>
        <div className="metric">
          <div className="metric-label">online</div>
          <div className="metric-val" style={{ color: 'var(--c-green)' }}>{online_count}</div>
        </div>
        {offline_count > 0 && (
          <div className="metric">
            <div className="metric-label">offline</div>
            <div className="metric-val" style={{ color: 'var(--c-crit)' }}>{offline_count}</div>
          </div>
        )}
        <div className="metric">
          <div className="metric-label">total clients</div>
          <div className="metric-val">{total_clients}</div>
        </div>
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
                <th>Site</th>
                <th>Group</th>
                <th>IP</th>
                <th style={{ textAlign: 'right' }}>Clients</th>
                <th>Radios</th>
                <th>Ch 2.4G</th>
                <th>Ch 5G</th>
                <th>Uptime</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {aps.map(ap => (
                <tr key={ap.ap_id}>
                  <td style={{ fontWeight: 500 }}>{ap.name}</td>
                  <td style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 12 }}>{ap.model}</td>
                  <td style={{ color: 'var(--muted)' }}>{ap.site || '—'}</td>
                  <td style={{ color: 'var(--muted)' }}>{ap.group || '—'}</td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>{ap.ip_address || '—'}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600 }}>{ap.client_count}</td>
                  <td style={{ textAlign: 'center', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 12 }}>{ap.radio_count}</td>
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
  const [wirelessData, setWirelessData]   = useState(null)
  const [wirelessLoading, setWirelessLoading] = useState(false)

  useEffect(() => {
    setDirectLoading(true)
    api.arubaDirectSwitches()
      .then(d => { setDirectData(d); setDirectLoading(false) })
      .catch(() => setDirectLoading(false))
  }, [])

  useEffect(() => {
    if (tab !== 'wireless' || wirelessData !== null) return
    setWirelessLoading(true)
    api.arubaWireless()
      .then(d => { setWirelessData(d); setWirelessLoading(false) })
      .catch(() => setWirelessLoading(false))
  }, [tab, wirelessData])

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
        <WirelessTab wirelessData={wirelessData} wirelessLoading={wirelessLoading} />
      )}

      <SwitchDetailModal sw={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
