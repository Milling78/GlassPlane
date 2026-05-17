import React, { useState, useEffect, useCallback, useRef } from 'react'
import { api, apiFetch } from '../api'

function Metric({ label, value, unit = '', accent }) {
  const color = accent === 'ok'       ? 'var(--c-ok)'
              : accent === 'warning'  ? 'var(--c-warn)'
              : accent === 'critical' ? 'var(--c-crit)'
              : '#f0efec'
  return (
    <div className="tv-metric">
      <div className="tv-metric-label">{label}</div>
      <div className="tv-metric-value" style={{ color }}>
        {value ?? '—'}
        {value != null && unit && <span className="tv-metric-unit">{unit}</span>}
      </div>
    </div>
  )
}

function Card({ title, icon, status, children }) {
  const statusColor = status === 'ok'       ? 'var(--c-ok)'
                    : status === 'warning'  ? 'var(--c-warn)'
                    : status === 'critical' ? 'var(--c-crit)'
                    : '#888780'
  return (
    <div className="tv-card">
      <div className="tv-card-header">
        <i className={`ti ${icon}`} style={{ color: statusColor }} aria-hidden="true" />
        <span>{title}</span>
        {status && (
          <span className="tv-card-status" style={{ color: statusColor }}>
            {status.toUpperCase()}
          </span>
        )}
      </div>
      <div className="tv-card-body">{children}</div>
    </div>
  )
}

export default function TVModeView({ summary: initSummary, iloSummary: initIlo, dnsSummary: initDns, certsSummary: initCerts, onExit }) {
  const [now, setNow] = useState(new Date())
  const [refreshSeconds, setRefreshSeconds] = useState(30)
  const [countdown, setCountdown] = useState(30)
  const [summary, setSummary] = useState(initSummary)
  const [iloSummary, setIlo] = useState(initIlo)
  const [dnsSummary, setDns] = useState(initDns)
  const [certsSummary, setCerts] = useState(initCerts)
  const countdownRef = useRef(refreshSeconds)

  useEffect(() => {
    apiFetch('/setup/config')
      .then(cfg => {
        const secs = cfg.tv?.refreshSeconds ?? 30
        setRefreshSeconds(secs)
        setCountdown(secs)
        countdownRef.current = secs
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const doRefresh = useCallback(async () => {
    const results = await Promise.allSettled([
      api.summary(), api.ilo(), api.dns(), api.certs(),
    ])
    if (results[0].status === 'fulfilled') setSummary(results[0].value)
    if (results[1].status === 'fulfilled') setIlo(results[1].value)
    if (results[2].status === 'fulfilled') setDns(results[2].value)
    if (results[3].status === 'fulfilled') setCerts(results[3].value)
  }, [])

  useEffect(() => {
    countdownRef.current = refreshSeconds
    setCountdown(refreshSeconds)
    const t = setInterval(() => {
      setCountdown(c => {
        const next = c - 1
        if (next <= 0) {
          doRefresh()
          countdownRef.current = refreshSeconds
          return refreshSeconds
        }
        return next
      })
    }, 1000)
    return () => clearInterval(t)
  }, [refreshSeconds, doRefresh])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') {
        window.glassplane?.exitTvMode?.()
        onExit?.()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onExit])

  const vc    = summary?.vcenter
  const ar    = summary?.aruba
  const al    = summary?.alletra
  const veeam = summary?.veeam
  const score = summary?.optimization_score

  const scoreColor = score == null ? '#888780'
                   : score >= 80   ? 'var(--c-ok)'
                   : score >= 50   ? 'var(--c-warn)'
                   : 'var(--c-crit)'

  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const dateStr = now.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })

  return (
    <div className="tv-root">
      <div className="tv-header">
        <div className="tv-header-brand">
          <i className="ti ti-server-2" style={{ color: 'var(--c-blue)', fontSize: 28 }} aria-hidden="true" />
          <span>Infrastructure</span>
        </div>

        <div className="tv-header-score">
          <div className="tv-score-label">Optimization</div>
          <div className="tv-score-value" style={{ color: scoreColor }}>
            {score ?? '—'}
            <span className="tv-score-unit">/ 100</span>
          </div>
        </div>

        <div className="tv-header-clock">
          <div className="tv-clock-time">{timeStr}</div>
          <div className="tv-clock-date">{dateStr}</div>
          <div className="tv-clock-refresh">↻ {countdown}s</div>
        </div>
      </div>

      <div className="tv-grid">
        <Card title="Virtual Machines" icon="ti-server-2" status={vc ? (vc.idle_vms > 0 || vc.oversized_vms > 0 ? 'warning' : 'ok') : null}>
          <Metric label="Total VMs"  value={vc?.total_vms} />
          <Metric label="Powered On" value={vc?.powered_on} />
          <Metric label="Idle"       value={vc?.idle_vms}       accent={vc?.idle_vms > 0 ? 'warning' : 'ok'} />
          <Metric label="Oversized"  value={vc?.oversized_vms}  accent={vc?.oversized_vms > 0 ? 'warning' : 'ok'} />
        </Card>

        <Card title="Storage" icon="ti-database" status={al?.status?.toLowerCase()}>
          <Metric label="Utilization" value={al?.util_pct != null ? al.util_pct.toFixed(1) : null} unit="%" accent={al?.util_pct > 80 ? 'warning' : al?.util_pct != null ? 'ok' : null} />
          <Metric label="Used"        value={al?.used_tb != null ? al.used_tb.toFixed(1) : null} unit=" TB" />
          <Metric label="IOPS"        value={al?.iops != null ? al.iops.toLocaleString() : null} />
          <Metric label="Efficiency"  value={al?.total_efficiency_ratio != null ? al.total_efficiency_ratio.toFixed(1) : null} unit="x" />
        </Card>

        <Card title="Backups" icon="ti-cloud-upload" status={veeam?.status?.toLowerCase()}>
          <Metric label="Jobs"        value={veeam?.job_count} />
          <Metric label="Failed"      value={veeam?.failed_jobs}      accent={veeam?.failed_jobs > 0 ? 'critical' : 'ok'} />
          <Metric label="Protected"   value={veeam?.protected_vms} />
          <Metric label="Unprotected" value={veeam?.unprotected_vms}  accent={veeam?.unprotected_vms > 0 ? 'warning' : 'ok'} />
        </Card>

        <Card title="Networking" icon="ti-network" status={ar?.status?.toLowerCase()}>
          <Metric label="Switches"     value={ar?.switch_count} />
          <Metric label="Total Ports"  value={ar?.total_ports} />
          <Metric label="Unused Ports" value={ar?.unused_ports}    accent={ar?.unused_port_pct > 30 ? 'warning' : 'ok'} />
          <Metric label="Unused"       value={ar?.unused_port_pct != null ? ar.unused_port_pct.toFixed(0) : null} unit="%" accent={ar?.unused_port_pct > 30 ? 'warning' : 'ok'} />
        </Card>

        <Card title="Hosts / iLO" icon="ti-cpu" status={iloSummary?.status?.toLowerCase()}>
          <Metric label="Hosts"       value={iloSummary?.host_count} />
          <Metric label="Total Power" value={iloSummary?.total_power_watts != null ? Math.round(iloSummary.total_power_watts) : null} unit=" W" />
          <Metric label="IML Alerts"  value={iloSummary?.error_count}  accent={iloSummary?.error_count > 0 ? 'warning' : 'ok'} />
        </Card>

        <Card title="DNS & Certificates" icon="ti-world-www" status={dnsSummary?.status?.toLowerCase()}>
          <Metric label="DNS"          value={dnsSummary?.status  ? dnsSummary.status.toUpperCase()  : null} accent={dnsSummary?.status?.toLowerCase()} />
          <Metric label="Certificates" value={certsSummary?.status ? certsSummary.status.toUpperCase() : null} accent={certsSummary?.status?.toLowerCase()} />
          {certsSummary?.expiring_soon > 0 && (
            <Metric label="Expiring Soon" value={certsSummary.expiring_soon} unit=" certs" accent="warning" />
          )}
        </Card>
      </div>

      <div className="tv-footer">
        <span>Press</span>
        <kbd className="tv-key">Esc</kbd>
        <span>to exit wall display</span>
      </div>
    </div>
  )
}
