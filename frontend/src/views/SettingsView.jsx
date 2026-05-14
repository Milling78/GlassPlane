import React, { useState, useEffect, useCallback, useRef } from 'react'
import { apiFetch, getBaseUrl } from '../api'
import { buildEnvContent } from '../utils/env'

function ThresholdField({ label, value, onChange, unit = '', min = 0, step = 1, width = 72 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <label style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <input
          type="number"
          value={value}
          min={min}
          step={step}
          onChange={e => onChange(parseFloat(e.target.value) || 0)}
          style={{
            width, background: 'var(--bg)', border: '0.5px solid var(--border)',
            borderRadius: 6, padding: '0.35rem 0.5rem',
            color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 12, outline: 'none',
          }}
        />
        {unit && <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{unit}</span>}
      </div>
    </div>
  )
}

function ThresholdGrid({ children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '0.75rem' }}>
      {children}
    </div>
  )
}

function SubHeading({ children }) {
  return (
    <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', paddingTop: 4 }}>
      {children}
    </div>
  )
}

// ── Shared field components ───────────────────────────────────────────────────

function Field({ label, value, onChange, type = 'text', placeholder = '', mono = true }) {
  const [show, setShow] = useState(false)
  const isPassword = type === 'password'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {label && (
        <label style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>{label}</label>
      )}
      <div style={{ position: 'relative', display: 'flex' }}>
        <input
          type={isPassword && !show ? 'password' : 'text'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          style={{
            flex: 1,
            background: 'var(--bg)',
            border: '0.5px solid var(--border)',
            borderRadius: 6,
            padding: isPassword ? '0.45rem 2.25rem 0.45rem 0.65rem' : '0.45rem 0.65rem',
            color: 'var(--text)',
            fontFamily: mono ? 'var(--mono)' : 'var(--sans)',
            fontSize: 12,
            outline: 'none',
          }}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShow(s => !s)}
            style={{
              position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 13,
            }}
          >
            <i className={`ti ${show ? 'ti-eye-off' : 'ti-eye'}`} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  )
}

function Toggle({ label, checked, onChange }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        style={{ width: 14, height: 14, cursor: 'pointer' }} />
      {label}
    </label>
  )
}

function Row({ children }) {
  return <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>{children}</div>
}

// ── Connection test row ───────────────────────────────────────────────────────

async function testConnector(endpoint, body) {
  const base = await getBaseUrl()
  const res = await fetch(`${base}/setup/test/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) return { ok: false, message: `Server error ${res.status}` }
  return res.json()
}

function TestRow({ onTest, disabled }) {
  const [testing, setTesting] = useState(false)
  const [result,  setResult]  = useState(null)

  useEffect(() => { setResult(null) }, [onTest])

  async function run() {
    setTesting(true)
    setResult(null)
    try { setResult(await onTest()) }
    catch (e) { setResult({ ok: false, message: e.message }) }
    finally { setTesting(false) }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 2 }}>
      <button
        type="button"
        onClick={run}
        disabled={disabled || testing}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'var(--bg)', border: '0.5px solid var(--border)',
          borderRadius: 6, padding: '0.4rem 0.75rem',
          fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)',
          cursor: disabled || testing ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <i className={`ti ${testing ? 'ti-loader-2' : 'ti-plug-connected'}`} aria-hidden="true" />
        {testing ? 'Testing…' : 'Test connection'}
      </button>
      {result && (
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: result.ok ? 'var(--c-ok)' : 'var(--c-crit)', display: 'flex', alignItems: 'center', gap: 5 }}>
          <i className={`ti ${result.ok ? 'ti-circle-check' : 'ti-circle-x'}`} aria-hidden="true" />
          {result.message}
        </span>
      )}
    </div>
  )
}

// ── Section card wrapper ──────────────────────────────────────────────────────

function Section({ icon, iconColor = 'var(--c-blue)', title, badge, children }) {
  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div className="card-header">
        <div className="card-title">
          <i className={`ti ${icon}`} style={{ color: iconColor }} aria-hidden="true" />
          {title}
        </div>
        {badge}
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {children}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SettingsView() {
  const isElectron = !!window.glassplane?.isElectron

  const [cfg,        setCfg]        = useState(null)
  const [loadErr,    setLoadErr]    = useState(null)
  const [retrying,   setRetrying]   = useState(false)
  const [health,     setHealth]     = useState(null)
  const [baseUrl,    setBaseUrl]    = useState('')
  const [saveStatus, setSaveStatus] = useState('idle')  // idle | saving | saved | error | copied
  const [saveMsg,    setSaveMsg]    = useState('')
  const [showEnv,    setShowEnv]    = useState(false)
  const [alertStatus, setAlertStatus] = useState(null)  // { active_count, active }
  const [testWebhook, setTestWebhook] = useState('idle') // idle | sending | ok | error
  const [testWebhookMsg, setTestWebhookMsg] = useState('')
  const [importStatus, setImportStatus] = useState('idle')  // idle | ok | error
  const [importMsg,    setImportMsg]    = useState('')
  const importFileRef = useRef(null)
  const [appVersion,   setAppVersion]   = useState(null)
  const [updateStatus, setUpdateStatus] = useState(null)  // null | checking | available | downloading | ready | current | error

  const u = useCallback((section, field, value) => {
    setCfg(c => section
      ? { ...c, [section]: { ...c[section], [field]: value } }
      : { ...c, [field]: value }
    )
    setSaveStatus('idle')
  }, [])

  function loadConfig() {
    setLoadErr(null)
    setRetrying(true)
    apiFetch('/setup/config', { signal: AbortSignal.timeout(30000) })
      .then(data => { setCfg(data); setRetrying(false) })
      .catch(e => { setLoadErr(e.message); setRetrying(false) })
  }

  useEffect(() => {
    loadConfig()

    apiFetch('/api/alerts/status')
      .then(setAlertStatus)
      .catch(() => {})

    getBaseUrl().then(b => {
      setBaseUrl(b || 'http://localhost:8000')
      fetch((b || '') + '/health').then(r => r.json()).then(setHealth).catch(() => setHealth(null))
    })

    if (window.glassplane?.getAppVersion) {
      window.glassplane.getAppVersion().then(v => setAppVersion(v)).catch(() => {})
    }

    if (window.glassplane?.getUpdateStatus) {
      window.glassplane.getUpdateStatus().then(s => { if (s) setUpdateStatus(s) }).catch(() => {})
    }
  }, [])

  useEffect(() => {
    if (!window.glassplane?.onUpdateStatus) return
    const wrapped = window.glassplane.onUpdateStatus((data) => setUpdateStatus(data))
    return () => window.glassplane.offUpdateStatus?.(wrapped)
  }, [])

  async function sendTestWebhook() {
    setTestWebhook('sending')
    setTestWebhookMsg('')
    try {
      const r = await apiFetch('/api/alerts/test', { method: 'POST' })
      setTestWebhook('ok')
      setTestWebhookMsg(r.message)
    } catch (e) {
      setTestWebhook('error')
      setTestWebhookMsg(e.message)
    }
    setTimeout(() => setTestWebhook('idle'), 5000)
  }

  function exportConfig() {
    const payload = {
      version: 1,
      app: 'glassplane',
      exported_at: new Date().toISOString(),
      config: cfg,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `glassplane-config-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleImportFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''  // reset so same file can be re-selected

    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const raw     = JSON.parse(ev.target.result)
        const imported = raw.config ?? raw   // support both wrapped and bare format

        // Basic structure validation
        const knownKeys = ['vcenter', 'aruba', 'alletra', 'veeam', 'ilo', 'alerts', 'apiKey']
        const found = knownKeys.filter(k => imported[k] !== undefined)
        if (found.length === 0) throw new Error('File does not look like a Glassplane config')

        // Deep-merge: keep any current keys the import doesn't have
        setCfg(current => {
          const merged = { ...current }
          for (const key of Object.keys(imported)) {
            if (merged[key] !== null && typeof merged[key] === 'object' && !Array.isArray(merged[key])) {
              merged[key] = { ...merged[key], ...imported[key] }
            } else {
              merged[key] = imported[key]
            }
          }
          return merged
        })
        setSaveStatus('idle')

        const exportedAt = raw.exported_at
          ? ` (exported ${new Date(raw.exported_at).toLocaleDateString()})`
          : ''
        setImportStatus('ok')
        setImportMsg(`Imported${exportedAt} · ${found.join(', ')} — review and save to apply`)
        setTimeout(() => setImportStatus('idle'), 8000)
      } catch (err) {
        setImportStatus('error')
        setImportMsg(err.message)
        setTimeout(() => setImportStatus('idle'), 6000)
      }
    }
    reader.readAsText(file)
  }

  async function handleSave() {
    setSaveStatus('saving')
    setSaveMsg('')
    const content = buildEnvContent(cfg)
    try {
      if (isElectron) {
        await window.glassplane.writeEnv(content)
        await apiFetch('/setup/reload', { method: 'POST' })
        setSaveStatus('saved')
        setSaveMsg('Saved and reloaded — changes are live.')
      } else {
        await navigator.clipboard.writeText(content)
        setSaveStatus('copied')
        setSaveMsg('Copied to clipboard. Save as backend/.env and restart the server.')
        setTimeout(() => setSaveStatus('idle'), 4000)
      }
    } catch (e) {
      setSaveStatus('error')
      setSaveMsg(e.message)
    }
  }

  // ── Loading / error states ─────────────────────────────────────────────────

  if (!cfg && !loadErr) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>
        {retrying ? 'loading config…' : 'loading config…'}
      </div>
    )
  }

  if (loadErr) {
    return (
      <div style={{ maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ background: '#fee2e2', border: '0.5px solid #fca5a5', borderRadius: 8, padding: '0.75rem 1rem', fontFamily: 'var(--mono)', fontSize: 12, color: '#991b1b' }}>
          <i className="ti ti-alert-circle" style={{ marginRight: 6 }} aria-hidden="true" />
          Could not load config: {loadErr}
        </div>
        <button
          onClick={loadConfig}
          disabled={retrying}
          style={{
            alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6,
            background: 'var(--surface)', border: '0.5px solid var(--border)',
            borderRadius: 6, padding: '0.45rem 0.9rem',
            fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text)',
            cursor: retrying ? 'not-allowed' : 'pointer',
          }}
        >
          <i className={`ti ${retrying ? 'ti-loader-2' : 'ti-refresh'}`} aria-hidden="true" />
          {retrying ? 'Retrying…' : 'Retry'}
        </button>
      </div>
    )
  }

  const envContent = buildEnvContent(cfg)

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 600 }}>
      <h2 style={{ fontSize: 18, fontWeight: 500, marginBottom: '1.5rem' }}>Settings</h2>

      {/* Backend status */}
      <Section icon="ti-plug" title="Backend connection"
        badge={<span className={`badge ${health ? 'b-on' : 'b-off'}`}>{health ? 'connected' : 'unreachable'}</span>}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>
          <div style={{ color: 'var(--muted)', marginBottom: 3 }}>API base URL</div>
          <div>{baseUrl}</div>
        </div>
      </Section>

      {/* Security */}
      <Section icon="ti-shield-lock" title="Security">
        <Field
          label="API KEY"
          value={cfg.apiKey}
          onChange={v => u(null, 'apiKey', v)}
          type="password"
          placeholder="leave blank to disable auth"
        />
        <Field
          label="ALLOWED ORIGINS"
          value={cfg.allowedOrigins}
          onChange={v => u(null, 'allowedOrigins', v)}
          placeholder="* or comma-separated URLs"
        />
      </Section>

      {/* vCenter */}
      <Section icon="ti-server-2" title="VMware vCenter" iconColor="var(--c-ok)">
        <Row>
          <div style={{ flex: 2 }}>
            <Field label="HOST / IP" value={cfg.vcenter.host} onChange={v => u('vcenter', 'host', v)} placeholder="vcenter.local" />
          </div>
          <div style={{ flex: 1 }}>
            <Field label="PORT" value={String(cfg.vcenter.port)} onChange={v => u('vcenter', 'port', parseInt(v) || 443)} />
          </div>
        </Row>
        <Field label="USERNAME" value={cfg.vcenter.user} onChange={v => u('vcenter', 'user', v)} placeholder="administrator@vsphere.local" />
        <Field label="PASSWORD" value={cfg.vcenter.password} onChange={v => u('vcenter', 'password', v)} type="password" />
        <Toggle label="Verify SSL certificate" checked={cfg.vcenter.sslVerify} onChange={v => u('vcenter', 'sslVerify', v)} />
        <TestRow
          disabled={!cfg.vcenter.host || !cfg.vcenter.user || !cfg.vcenter.password}
          onTest={() => testConnector('vcenter', { host: cfg.vcenter.host, user: cfg.vcenter.user, password: cfg.vcenter.password, port: cfg.vcenter.port, ssl_verify: cfg.vcenter.sslVerify })}
        />
      </Section>

      {/* Aruba */}
      <Section icon="ti-network" title="Aruba Central" iconColor="var(--c-ok)">
        <Field label="BASE URL" value={cfg.aruba.baseUrl} onChange={v => u('aruba', 'baseUrl', v)} />
        <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>
          Fill access token (static) or OAuth credentials — whichever applies.
        </div>
        <Field label="ACCESS TOKEN (static)" value={cfg.aruba.accessToken} onChange={v => u('aruba', 'accessToken', v)} type="password" placeholder="optional" />
        <Row>
          <div style={{ flex: 1 }}>
            <Field label="CLIENT ID" value={cfg.aruba.clientId} onChange={v => u('aruba', 'clientId', v)} placeholder="optional" />
          </div>
          <div style={{ flex: 1 }}>
            <Field label="CUSTOMER ID" value={cfg.aruba.customerId} onChange={v => u('aruba', 'customerId', v)} placeholder="optional" />
          </div>
        </Row>
        <Field label="CLIENT SECRET" value={cfg.aruba.clientSecret} onChange={v => u('aruba', 'clientSecret', v)} type="password" placeholder="optional" />
        <TestRow
          disabled={!cfg.aruba.accessToken && !cfg.aruba.clientId}
          onTest={() => testConnector('aruba', { base_url: cfg.aruba.baseUrl, access_token: cfg.aruba.accessToken, client_id: cfg.aruba.clientId, client_secret: cfg.aruba.clientSecret, customer_id: cfg.aruba.customerId })}
        />
      </Section>

      {/* Aruba Wireless Controller */}
      <Section icon="ti-wifi" title="Aruba — Wireless controller (standalone)" iconColor="var(--c-ok)">
        <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)', lineHeight: 1.6 }}>
          Connect directly to an Aruba Mobility Controller (ArubaOS). Default REST API port is 4343.
        </div>
        <Row>
          <div style={{ flex: 2 }}>
            <Field label="HOST / IP" value={cfg.arubaWireless?.host ?? ''} onChange={v => u('arubaWireless', 'host', v)} placeholder="aruba-mc.lab.local" />
          </div>
          <div style={{ flex: 1 }}>
            <Field label="PORT" value={String(cfg.arubaWireless?.port ?? 4343)} onChange={v => u('arubaWireless', 'port', parseInt(v) || 4343)} />
          </div>
        </Row>
        <Field label="USERNAME" value={cfg.arubaWireless?.user ?? ''} onChange={v => u('arubaWireless', 'user', v)} placeholder="admin" />
        <Field label="PASSWORD" value={cfg.arubaWireless?.password ?? ''} onChange={v => u('arubaWireless', 'password', v)} type="password" />
        <TestRow
          disabled={!cfg.arubaWireless?.host || !cfg.arubaWireless?.user || !cfg.arubaWireless?.password}
          onTest={() => testConnector('aruba-wireless', {
            host: cfg.arubaWireless?.host,
            user: cfg.arubaWireless?.user,
            password: cfg.arubaWireless?.password,
            port: cfg.arubaWireless?.port ?? 4343,
          })}
        />
      </Section>

      {/* Aruba Direct */}
      <Section icon="ti-plug-connected" title="Aruba — Direct switches (no Central)" iconColor="var(--c-ok)">
        <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)', lineHeight: 1.6 }}>
          Connect directly to switches without Aruba Central. Tries AOS-CX REST first, falls back to SSH for ProCurve / Provision.
        </div>
        <Field
          label="HOSTS (comma-separated IPs or hostnames)"
          value={cfg.arubaDirectSwitches?.hosts ?? ''}
          onChange={v => u('arubaDirectSwitches', 'hosts', v)}
          placeholder="192.168.1.10, 192.168.1.11"
        />
        <Row>
          <div style={{ flex: 2 }}>
            <Field label="USERNAME" value={cfg.arubaDirectSwitches?.user ?? ''} onChange={v => u('arubaDirectSwitches', 'user', v)} placeholder="admin" />
          </div>
          <div style={{ flex: 1 }}>
            <Field label="HTTPS PORT" value={String(cfg.arubaDirectSwitches?.port ?? 443)} onChange={v => u('arubaDirectSwitches', 'port', parseInt(v) || 443)} />
          </div>
          <div style={{ flex: 1 }}>
            <Field label="SSH PORT" value={String(cfg.arubaDirectSwitches?.sshPort ?? 22)} onChange={v => u('arubaDirectSwitches', 'sshPort', parseInt(v) || 22)} />
          </div>
        </Row>
        <Field label="PASSWORD" value={cfg.arubaDirectSwitches?.password ?? ''} onChange={v => u('arubaDirectSwitches', 'password', v)} type="password" />
        <Toggle label="Verify SSL certificate" checked={cfg.arubaDirectSwitches?.sslVerify ?? false} onChange={v => u('arubaDirectSwitches', 'sslVerify', v)} />
        <TestRow
          disabled={!cfg.arubaDirectSwitches?.hosts || !cfg.arubaDirectSwitches?.user || !cfg.arubaDirectSwitches?.password}
          onTest={() => {
            const firstHost = (cfg.arubaDirectSwitches?.hosts ?? '').split(',')[0].trim()
            return testConnector('aruba-direct', {
              host: firstHost,
              user: cfg.arubaDirectSwitches?.user,
              password: cfg.arubaDirectSwitches?.password,
              port: cfg.arubaDirectSwitches?.port ?? 443,
              ssh_port: cfg.arubaDirectSwitches?.sshPort ?? 22,
              ssl_verify: cfg.arubaDirectSwitches?.sslVerify ?? false,
            })
          }}
        />
      </Section>

      {/* Alletra */}
      <Section icon="ti-database" title="HPE Alletra 6000" iconColor="var(--c-ok)">
        <Row>
          <div style={{ flex: 2 }}>
            <Field label="HOST / IP" value={cfg.alletra.host} onChange={v => u('alletra', 'host', v)} placeholder="alletra6k.local" />
          </div>
          <div style={{ flex: 1 }}>
            <Field label="WSAPI PORT" value={String(cfg.alletra.port)} onChange={v => u('alletra', 'port', parseInt(v) || 8080)} />
          </div>
        </Row>
        <Field label="USERNAME" value={cfg.alletra.user} onChange={v => u('alletra', 'user', v)} placeholder="3paradm" />
        <Field label="PASSWORD" value={cfg.alletra.password} onChange={v => u('alletra', 'password', v)} type="password" />
        <TestRow
          disabled={!cfg.alletra.host || !cfg.alletra.user || !cfg.alletra.password}
          onTest={() => testConnector('alletra', { host: cfg.alletra.host, user: cfg.alletra.user, password: cfg.alletra.password, port: cfg.alletra.port })}
        />
      </Section>

      {/* Veeam */}
      <Section icon="ti-cloud-upload" title="Veeam Backup & Replication" iconColor="var(--c-ok)">
        <Row>
          <div style={{ flex: 2 }}>
            <Field label="HOST / IP" value={cfg.veeam.host} onChange={v => u('veeam', 'host', v)} placeholder="veeam.local" />
          </div>
          <div style={{ flex: 1 }}>
            <Field label="REST API PORT" value={String(cfg.veeam.port)} onChange={v => u('veeam', 'port', parseInt(v) || 9419)} />
          </div>
        </Row>
        <Field label="USERNAME" value={cfg.veeam.user} onChange={v => u('veeam', 'user', v)} placeholder="administrator" />
        <Field label="PASSWORD" value={cfg.veeam.password} onChange={v => u('veeam', 'password', v)} type="password" />
        <TestRow
          disabled={!cfg.veeam.host || !cfg.veeam.user || !cfg.veeam.password}
          onTest={() => testConnector('veeam', { host: cfg.veeam.host, user: cfg.veeam.user, password: cfg.veeam.password, port: cfg.veeam.port })}
        />
      </Section>

      {/* HPE iLO */}
      <Section icon="ti-cpu" title="HPE iLO / Redfish" iconColor="var(--c-ok)">
        <Field
          label="HOSTS (comma-separated IPs or hostnames)"
          value={cfg.ilo?.hosts ?? ''}
          onChange={v => u('ilo', 'hosts', v)}
          placeholder="ilo1.lab.local, ilo2.lab.local"
        />
        <Row>
          <div style={{ flex: 2 }}>
            <Field label="USERNAME" value={cfg.ilo?.user ?? ''} onChange={v => u('ilo', 'user', v)} placeholder="Administrator" />
          </div>
          <div style={{ flex: 1 }}>
            <Field label="PORT" value={String(cfg.ilo?.port ?? 443)} onChange={v => u('ilo', 'port', parseInt(v) || 443)} />
          </div>
        </Row>
        <Field label="PASSWORD" value={cfg.ilo?.password ?? ''} onChange={v => u('ilo', 'password', v)} type="password" />
        <Toggle label="Verify SSL certificate" checked={cfg.ilo?.sslVerify ?? false} onChange={v => u('ilo', 'sslVerify', v)} />
        <Field
          label="HOST MAP — iLO → server name (comma-separated ilo_ip=server_name pairs)"
          value={cfg.ilo?.hostMap ?? ''}
          onChange={v => u('ilo', 'hostMap', v)}
          placeholder="192.168.1.10=esxi01.lab.local, 192.168.1.11=esxi02.lab.local"
        />
      </Section>

      {/* DNS */}
      <Section icon="ti-world-www" title="DNS Monitoring" iconColor="var(--c-blue)">
        <Field
          label="DNS SERVERS (comma-separated IPs)"
          value={cfg.dns?.servers ?? ''}
          onChange={v => u('dns', 'servers', v)}
          placeholder="192.168.1.1, 192.168.1.2"
        />
        <Field
          label="HOSTNAMES TO VERIFY (comma-separated)"
          value={cfg.dns?.checkHosts ?? ''}
          onChange={v => u('dns', 'checkHosts', v)}
          placeholder="vcenter.local, ad.local, gateway.local"
        />
        <div style={{ flex: 1, maxWidth: 160 }}>
          <Field
            label="QUERY TIMEOUT (seconds)"
            value={String(cfg.dns?.timeout ?? 5)}
            onChange={v => u('dns', 'timeout', parseFloat(v) || 5)}
          />
        </div>
      </Section>

      {/* App settings */}
      <Section icon="ti-adjustments-horizontal" title="App">
        <Row>
          <div style={{ flex: 1 }}>
            <Field label="CACHE TTL (seconds)" value={String(cfg.cacheTtl)} onChange={v => u(null, 'cacheTtl', parseInt(v) || 60)} />
          </div>
          <div style={{ flex: 1 }}>
            <Field label="LOG LEVEL" value={cfg.logLevel} onChange={v => u(null, 'logLevel', v)} placeholder="INFO" />
          </div>
        </Row>
      </Section>

      {/* Alerts */}
      {cfg.alerts && (() => {
        const al = cfg.alerts
        const ua = (f, v) => u('alerts', f, v)
        return (
          <Section icon="ti-bell" title="Alerts & Webhooks"
            badge={alertStatus?.active_count > 0
              ? <span className="badge b-oversized">{alertStatus.active_count} active</span>
              : alertStatus ? <span className="badge b-on">all clear</span> : null}>

            {/* Active alerts */}
            {alertStatus?.active_count > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <SubHeading>Currently firing</SubHeading>
                {alertStatus.active.map(key => (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--c-crit)' }}>
                    <i className="ti ti-alert-circle" aria-hidden="true" />{key}
                  </div>
                ))}
              </div>
            )}

            {/* Webhook config */}
            <SubHeading>Webhook</SubHeading>
            <Field label="WEBHOOK URL" value={al.webhookUrl} onChange={v => ua('webhookUrl', v)} placeholder="https://…" />
            <Row>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>FORMAT</label>
                  <select
                    value={al.webhookFormat}
                    onChange={e => ua('webhookFormat', e.target.value)}
                    style={{ background: 'var(--bg)', border: '0.5px solid var(--border)', borderRadius: 6, padding: '0.45rem 0.65rem', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 12, outline: 'none' }}
                  >
                    <option value="teams">Microsoft Teams</option>
                    <option value="slack">Slack</option>
                    <option value="generic">Generic JSON</option>
                  </select>
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <ThresholdField label="Check interval" value={al.alertIntervalMinutes} onChange={v => ua('alertIntervalMinutes', v)} unit="min" min={1} step={1} width={64} />
              </div>
            </Row>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                onClick={sendTestWebhook}
                disabled={!al.webhookUrl || testWebhook === 'sending'}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: 'var(--bg)', border: '0.5px solid var(--border)',
                  borderRadius: 6, padding: '0.4rem 0.75rem',
                  fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)',
                  cursor: !al.webhookUrl || testWebhook === 'sending' ? 'not-allowed' : 'pointer',
                  opacity: !al.webhookUrl ? 0.5 : 1,
                }}
              >
                <i className={`ti ${testWebhook === 'sending' ? 'ti-loader-2' : 'ti-send'}`} aria-hidden="true" />
                {testWebhook === 'sending' ? 'Sending…' : 'Send test'}
              </button>
              {testWebhookMsg && (
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: testWebhook === 'error' ? 'var(--c-crit)' : 'var(--c-ok)' }}>
                  <i className={`ti ${testWebhook === 'error' ? 'ti-circle-x' : 'ti-circle-check'}`} style={{ marginRight: 4 }} aria-hidden="true" />
                  {testWebhookMsg}
                </span>
              )}
            </div>

            {/* Thresholds */}
            <SubHeading>vCenter thresholds</SubHeading>
            <ThresholdGrid>
              <ThresholdField label="Idle VMs ≥" value={al.vcenterIdleVms} onChange={v => ua('vcenterIdleVms', v)} unit="VMs" min={1} />
              <ThresholdField label="Oversized VMs ≥" value={al.vcenterOversizedVms} onChange={v => ua('vcenterOversizedVms', v)} unit="VMs" min={1} />
              <ThresholdField label="Cluster CPU low <" value={al.vcenterClusterCpuLowPct} onChange={v => ua('vcenterClusterCpuLowPct', v)} unit="%" min={0} step={5} />
            </ThresholdGrid>

            <SubHeading>Aruba thresholds</SubHeading>
            <ThresholdGrid>
              <ThresholdField label="Unused ports >" value={al.arubaUnusedPortPct} onChange={v => ua('arubaUnusedPortPct', v)} unit="%" min={0} step={5} />
            </ThresholdGrid>

            <SubHeading>Alletra thresholds</SubHeading>
            <ThresholdGrid>
              <ThresholdField label="Storage high >" value={al.alletraUtilHighPct} onChange={v => ua('alletraUtilHighPct', v)} unit="%" min={0} step={5} />
              <ThresholdField label="Storage low <" value={al.alletraUtilLowPct} onChange={v => ua('alletraUtilLowPct', v)} unit="%" min={0} step={5} />
              <ThresholdField label="Efficiency min" value={al.alletraEfficiencyMin} onChange={v => ua('alletraEfficiencyMin', v)} unit=":1" min={0} step={0.1} />
            </ThresholdGrid>

            <SubHeading>Veeam thresholds</SubHeading>
            <ThresholdGrid>
              <ThresholdField label="Failed jobs ≥" value={al.veeamFailedJobs} onChange={v => ua('veeamFailedJobs', v)} unit="jobs" min={1} />
              <ThresholdField label="Unprotected VMs ≥" value={al.veeamUnprotectedVms} onChange={v => ua('veeamUnprotectedVms', v)} unit="VMs" min={1} />
              <ThresholdField label="Repo util >" value={al.veeamRepoUtilPct} onChange={v => ua('veeamRepoUtilPct', v)} unit="%" min={0} step={5} />
            </ThresholdGrid>

            <SubHeading>iLO thresholds</SubHeading>
            <ThresholdGrid>
              <ThresholdField label="Power cap >" value={al.iloPowerCapPct ?? 90} onChange={v => ua('iloPowerCapPct', v)} unit="%" min={0} step={5} />
              <ThresholdField label="IML errors ≥" value={al.iloErrorCount ?? 1} onChange={v => ua('iloErrorCount', v)} unit="errors" min={1} />
            </ThresholdGrid>
          </Section>
        )
      })()}

      {/* Save */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            onClick={handleSave}
            disabled={saveStatus === 'saving'}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: saveStatus === 'saved' ? 'var(--c-ok)' : '#3b82f6',
              color: '#fff', border: 'none', borderRadius: 6,
              padding: '0.55rem 1.25rem', fontFamily: 'var(--mono)', fontSize: 12,
              cursor: saveStatus === 'saving' ? 'not-allowed' : 'pointer',
            }}
          >
            <i className={`ti ${saveStatus === 'saved' ? 'ti-check' : saveStatus === 'saving' ? 'ti-loader-2' : 'ti-device-floppy'}`} aria-hidden="true" />
            {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : isElectron ? 'Save changes' : 'Copy .env to clipboard'}
          </button>

          <button
            onClick={() => setShowEnv(s => !s)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'var(--bg)', border: '0.5px solid var(--border)',
              borderRadius: 6, padding: '0.5rem 0.75rem',
              fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', cursor: 'pointer',
            }}
          >
            <i className="ti ti-file-text" aria-hidden="true" />
            {showEnv ? 'Hide .env' : 'Preview .env'}
          </button>
        </div>

        {/* Export / Import */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', paddingTop: 4, borderTop: '0.5px solid var(--border)', marginTop: 2 }}>
          <button
            onClick={exportConfig}
            disabled={!cfg}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'var(--bg)', border: '0.5px solid var(--border)',
              borderRadius: 6, padding: '0.45rem 0.75rem',
              fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)',
              cursor: cfg ? 'pointer' : 'not-allowed', opacity: cfg ? 1 : 0.5,
            }}
          >
            <i className="ti ti-download" aria-hidden="true" />
            Export config
          </button>
          <button
            onClick={() => importFileRef.current?.click()}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'var(--bg)', border: '0.5px solid var(--border)',
              borderRadius: 6, padding: '0.45rem 0.75rem',
              fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', cursor: 'pointer',
            }}
          >
            <i className="ti ti-upload" aria-hidden="true" />
            Import config
          </button>
          <input
            ref={importFileRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={handleImportFile}
          />
          {importStatus !== 'idle' && (
            <span style={{
              fontFamily: 'var(--mono)', fontSize: 11, display: 'flex', alignItems: 'center', gap: 5,
              color: importStatus === 'ok' ? 'var(--c-green)' : 'var(--c-crit)',
            }}>
              <i className={`ti ${importStatus === 'ok' ? 'ti-circle-check' : 'ti-circle-x'}`} aria-hidden="true" />
              {importMsg}
            </span>
          )}
        </div>

        {saveMsg && (
          <div style={{
            fontFamily: 'var(--mono)', fontSize: 11, padding: '0.5rem 0.75rem',
            borderRadius: 6, border: '0.5px solid',
            color: saveStatus === 'error' ? '#991b1b' : '#166534',
            background: saveStatus === 'error' ? '#fee2e2' : '#dcfce7',
            borderColor: saveStatus === 'error' ? '#fca5a5' : '#bbf7d0',
          }}>
            {saveMsg}
          </div>
        )}

        {showEnv && (
          <pre style={{
            background: 'var(--bg)', border: '0.5px solid var(--border)',
            borderRadius: 8, padding: '0.75rem 1rem',
            fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)',
            whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            maxHeight: 320, overflowY: 'auto',
          }}>{envContent}</pre>
        )}
      </div>

      {/* About */}
      <Section icon="ti-info-circle" title="About">
        <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', lineHeight: 2 }}>
          <div>Infra Glassplane {appVersion ? `v${appVersion}` : 'v1.0.0'}</div>
          <div>Backend: FastAPI + pyVmomi + httpx</div>
          <div>Frontend: React + Vite{isElectron ? ' + Electron' : ''}</div>
          <div>License: MIT — see COMMERCIAL.md for commercial use</div>
        </div>
        {isElectron && (
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={() => {
                setUpdateStatus({ status: 'checking' })
                window.glassplane.checkForUpdates().catch(() => setUpdateStatus({ status: 'error', message: 'Check failed' }))
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: 'var(--bg)', border: '0.5px solid var(--border)',
                borderRadius: 6, padding: '0.4rem 0.75rem',
                fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', cursor: 'pointer',
              }}
            >
              <i className="ti ti-refresh" aria-hidden="true" />
              Check for updates
            </button>

            {updateStatus && (() => {
              const { status, version, percent, message } = updateStatus
              const map = {
                checking:    { icon: 'ti-loader-2', color: 'var(--muted)',    text: 'Checking…' },
                available:   { icon: 'ti-arrow-up-circle', color: 'var(--c-blue)',  text: `v${version} available — downloading…` },
                downloading: { icon: 'ti-loader-2', color: 'var(--c-blue)',  text: `Downloading… ${percent ?? 0}%` },
                ready:       { icon: 'ti-circle-check', color: 'var(--c-green)', text: `v${version} ready — restart to install` },
                current:     { icon: 'ti-circle-check', color: 'var(--c-green)', text: 'Up to date' },
                error:       { icon: 'ti-circle-x',    color: 'var(--c-crit)',  text: message ?? 'Update error' },
              }
              const entry = map[status]
              if (!entry) return null
              return (
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11, display: 'flex', alignItems: 'center', gap: 5, color: entry.color }}>
                  <i className={`ti ${entry.icon}`} aria-hidden="true" />
                  {entry.text}
                  {status === 'ready' && (
                    <button
                      onClick={() => window.glassplane.installUpdate()}
                      style={{
                        marginLeft: 6, background: 'var(--c-green)', color: '#fff',
                        border: 'none', borderRadius: 4, padding: '2px 8px',
                        fontFamily: 'var(--mono)', fontSize: 10, cursor: 'pointer',
                      }}
                    >
                      Restart now
                    </button>
                  )}
                </span>
              )
            })()}
          </div>
        )}
      </Section>
    </div>
  )
}
