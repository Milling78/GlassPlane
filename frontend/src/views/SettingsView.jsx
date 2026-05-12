import React, { useState, useEffect, useCallback } from 'react'
import { apiFetch, getBaseUrl } from '../api'
import { buildEnvContent } from '../utils/env'

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
  const [health,     setHealth]     = useState(null)
  const [baseUrl,    setBaseUrl]    = useState('')
  const [saveStatus, setSaveStatus] = useState('idle')  // idle | saving | saved | error | copied
  const [saveMsg,    setSaveMsg]    = useState('')
  const [showEnv,    setShowEnv]    = useState(false)

  const u = useCallback((section, field, value) => {
    setCfg(c => section
      ? { ...c, [section]: { ...c[section], [field]: value } }
      : { ...c, [field]: value }
    )
    setSaveStatus('idle')
  }, [])

  useEffect(() => {
    apiFetch('/setup/config')
      .then(data => setCfg(data))
      .catch(e => setLoadErr(e.message))

    getBaseUrl().then(b => {
      setBaseUrl(b || 'http://localhost:8000')
      fetch((b || '') + '/health').then(r => r.json()).then(setHealth).catch(() => setHealth(null))
    })
  }, [])

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
        loading config…
      </div>
    )
  }

  if (loadErr) {
    return (
      <div style={{ maxWidth: 480 }}>
        <div style={{ background: '#fee2e2', border: '0.5px solid #fca5a5', borderRadius: 8, padding: '0.75rem 1rem', fontFamily: 'var(--mono)', fontSize: 12, color: '#991b1b' }}>
          <i className="ti ti-alert-circle" style={{ marginRight: 6 }} aria-hidden="true" />
          Could not load config: {loadErr}
        </div>
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
          <div>Infra Glassplane v1.0.0</div>
          <div>Backend: FastAPI + pyVmomi + httpx</div>
          <div>Frontend: React + Vite{isElectron ? ' + Electron' : ''}</div>
        </div>
      </Section>
    </div>
  )
}
