import React, { useState, useEffect } from 'react'
import { api } from '../api'

// Strip domain suffix, then strip common management-interface tokens so
// "esxi01.lab.local" and "ilo-esxi01.lab.local" both normalise to "01".
function normalizeHostname(hn) {
  const base = hn.split('.')[0].toLowerCase()
  return base
    .replace(/^(ilo|esxi|esx|idrac|bmc|mgmt|oob|ipmi)-?/, '')
    .replace(/-(ilo|esxi|esx|idrac|bmc|mgmt|oob|ipmi)$/, '')
}

function correlate(esxiHosts, iloHosts) {
  const iloMap = new Map()
  for (const h of (iloHosts ?? [])) {
    iloMap.set(normalizeHostname(h.hostname), h)
  }
  return esxiHosts.map(h => {
    const ilo = iloMap.get(normalizeHostname(h.name)) ?? null
    const power = ilo?.power_watts ?? null
    const usedGhz = h.cpu_used_mhz / 1000
    const ghzPerWatt = power ? usedGhz / power : null
    const vmsPerWatt = (power && h.vm_count > 0) ? h.vm_count / power : null
    return { ...h, ilo, power_watts: power, ghz_per_watt: ghzPerWatt, vms_per_watt: vmsPerWatt }
  })
}

function EffBar({ value, max, color = 'var(--c-blue)', decimals = 3 }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 5, background: 'var(--bg)', borderRadius: 3, overflow: 'hidden', border: '0.5px solid var(--border)' }}>
        <div style={{ width: pct + '%', height: '100%', background: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text)', minWidth: 46, textAlign: 'right' }}>
        {value.toFixed(decimals)}
      </span>
    </div>
  )
}

function UtilCell({ pct }) {
  const color = pct > 85 ? 'var(--c-crit)' : pct > 70 ? 'var(--c-warn)' : 'var(--text)'
  return <span style={{ color, fontFamily: 'var(--mono)', fontSize: 12 }}>{pct}%</span>
}

export default function EfficiencyView({ iloSummary }) {
  const [hosts, setHosts]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(null)

  useEffect(() => {
    api.vcenterHosts()
      .then(d => { setHosts(d); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  if (loading) return (
    <div style={{ padding: '3rem', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--muted)' }}>
      loading host metrics…
    </div>
  )

  if (error) return (
    <div style={{ padding: '3rem', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--c-crit)' }}>
      {error}
    </div>
  )

  if (!hosts?.length) return (
    <div style={{ padding: '3rem', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--muted)' }}>
      no ESXi hosts found — check vCenter configuration
    </div>
  )

  const correlated = correlate(hosts, iloSummary?.hosts ?? [])
  const withPower   = correlated.filter(h => h.power_watts != null)
  const maxGhzW     = Math.max(...withPower.map(h => h.ghz_per_watt ?? 0), 0.001)
  const maxVmsW     = Math.max(...withPower.map(h => h.vms_per_watt ?? 0), 0.001)
  const totalPower  = withPower.reduce((s, h) => s + (h.power_watts ?? 0), 0)
  const totalUsedGhz = correlated.reduce((s, h) => s + h.cpu_used_mhz / 1000, 0)
  const fleetGhzW   = totalPower > 0 ? totalUsedGhz / totalPower : null
  const missingPower = correlated.length - withPower.length
  const hasPower    = withPower.length > 0

  // Sort: matched hosts first by GHz/W desc, then unmatched by CPU util desc
  const sorted = [...correlated].sort((a, b) => {
    if (a.ghz_per_watt != null && b.ghz_per_watt != null) return b.ghz_per_watt - a.ghz_per_watt
    if (a.ghz_per_watt != null) return -1
    if (b.ghz_per_watt != null) return 1
    return b.cpu_util_pct - a.cpu_util_pct
  })

  let effRank = 0

  return (
    <div>
      {/* Summary metrics */}
      <div className="metrics" style={{ marginBottom: '1rem' }}>
        <div className="metric">
          <div className="metric-label">ESXi hosts</div>
          <div className="metric-val">{correlated.length}</div>
        </div>
        <div className="metric">
          <div className="metric-label">iLO matched</div>
          <div className="metric-val" style={{ color: missingPower > 0 ? 'var(--c-warn)' : undefined }}>
            {withPower.length}
          </div>
          {missingPower > 0 && (
            <div className="metric-sub" style={{ color: 'var(--c-warn)' }}>{missingPower} no power data</div>
          )}
        </div>
        {totalPower > 0 && (
          <div className="metric">
            <div className="metric-label">matched power</div>
            <div className="metric-val">{Math.round(totalPower)} W</div>
          </div>
        )}
        {fleetGhzW != null && (
          <div className="metric">
            <div className="metric-label">fleet GHz / W</div>
            <div className="metric-val">{fleetGhzW.toFixed(3)}</div>
          </div>
        )}
        {totalPower > 0 && totalUsedGhz > 0 && (
          <div className="metric">
            <div className="metric-label">work per kW</div>
            <div className="metric-val">{(totalUsedGhz / (totalPower / 1000)).toFixed(1)}</div>
            <div className="metric-sub">GHz / kW</div>
          </div>
        )}
      </div>

      {/* iLO not configured warning */}
      {!iloSummary && (
        <div style={{
          background: 'rgba(245,158,11,0.08)', border: '0.5px solid var(--c-warn)',
          borderRadius: 8, padding: '0.75rem 1rem', fontFamily: 'var(--mono)', fontSize: 12,
          color: 'var(--c-warn)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: 8
        }}>
          <i className="ti ti-alert-triangle" aria-hidden="true" />
          iLO hosts not configured — power data unavailable. Add ILO_HOSTS in Settings to enable GHz/W ranking.
        </div>
      )}

      {/* Efficiency table */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">
            <i className="ti ti-bolt" style={{ color: 'var(--c-warn)' }} aria-hidden="true" />
            Performance-per-watt ranking
          </div>
          {hasPower && (
            <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>
              higher GHz/W = more work per watt
            </span>
          )}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--mono)', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--muted)', textAlign: 'left' }}>
                {hasPower && <th style={{ padding: '8px 10px', fontWeight: 400, width: 32 }}>#</th>}
                <th style={{ padding: '8px 10px', fontWeight: 400 }}>Host</th>
                <th style={{ padding: '8px 10px', fontWeight: 400 }}>Cluster</th>
                <th style={{ padding: '8px 10px', fontWeight: 400, textAlign: 'right' }}>VMs</th>
                <th style={{ padding: '8px 10px', fontWeight: 400, textAlign: 'right' }}>CPU util</th>
                <th style={{ padding: '8px 10px', fontWeight: 400, textAlign: 'right' }}>RAM util</th>
                <th style={{ padding: '8px 10px', fontWeight: 400, textAlign: 'right' }}>Power</th>
                {hasPower && <th style={{ padding: '8px 10px', fontWeight: 400, minWidth: 160 }}>GHz / W</th>}
                {hasPower && <th style={{ padding: '8px 10px', fontWeight: 400, minWidth: 140 }}>VMs / W</th>}
              </tr>
            </thead>
            <tbody>
              {sorted.map((h) => {
                const isMatched = h.ghz_per_watt != null
                if (isMatched) effRank++
                const rankLabel = isMatched ? effRank : '—'
                const isTop = effRank === 1 && isMatched
                return (
                  <tr key={h.name} style={{ borderBottom: '0.5px solid var(--border)' }}>
                    {hasPower && (
                      <td style={{ padding: '7px 10px', color: isTop ? 'var(--c-green)' : 'var(--muted)', fontWeight: isTop ? 700 : 400 }}>
                        {isTop ? '★' : rankLabel}
                      </td>
                    )}
                    <td style={{ padding: '7px 10px' }}>
                      <span style={{ color: 'var(--text)' }}>{h.name.split('.')[0]}</span>
                      {h.ilo && (
                        <span title={`iLO: ${h.ilo.hostname} · ${h.ilo.model}`}
                          style={{ marginLeft: 6, fontSize: 10, color: 'var(--c-green)' }}>⚡</span>
                      )}
                    </td>
                    <td style={{ padding: '7px 10px', color: 'var(--muted)' }}>{h.cluster}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right' }}>{h.vm_count}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right' }}><UtilCell pct={h.cpu_util_pct} /></td>
                    <td style={{ padding: '7px 10px', textAlign: 'right' }}><UtilCell pct={h.ram_util_pct} /></td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', color: h.power_watts != null ? 'var(--text)' : 'var(--muted)' }}>
                      {h.power_watts != null ? `${Math.round(h.power_watts)} W` : '—'}
                    </td>
                    {hasPower && (
                      <td style={{ padding: '7px 10px', minWidth: 160 }}>
                        {h.ghz_per_watt != null
                          ? <EffBar value={h.ghz_per_watt} max={maxGhzW} color={effRank === 1 ? 'var(--c-green)' : 'var(--c-blue)'} />
                          : <span style={{ color: 'var(--muted)' }}>—</span>}
                      </td>
                    )}
                    {hasPower && (
                      <td style={{ padding: '7px 10px', minWidth: 140 }}>
                        {h.vms_per_watt != null
                          ? <EffBar value={h.vms_per_watt} max={maxVmsW} color="var(--c-blue)" decimals={4} />
                          : <span style={{ color: 'var(--muted)' }}>—</span>}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer: match coverage */}
      <div style={{ marginTop: 8, fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
        {missingPower === 0 && hasPower
          ? <><i className="ti ti-circle-check" style={{ color: 'var(--c-green)' }} aria-hidden="true" /> All ESXi hosts matched to iLO power data</>
          : missingPower > 0 && hasPower
            ? <><i className="ti ti-info-circle" aria-hidden="true" /> Hostname matching is best-effort — rename iLO hosts to share a common base with ESXi hostnames for automatic correlation</>
            : null
        }
      </div>
    </div>
  )
}
