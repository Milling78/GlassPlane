import React, { useState } from 'react'

const STEPS = ['Welcome', 'Security', 'vCenter', 'Aruba', 'Alletra', 'Veeam', 'Save']

const DEFAULTS = {
  apiKey: '',
  vcenter:  { host: '', user: 'administrator@vsphere.local', password: '', port: 443,  sslVerify: false, skip: false },
  aruba:    { baseUrl: 'https://apigw-prod2.central.arubanetworks.com', clientId: '', clientSecret: '', customerId: '', accessToken: '', skip: false },
  alletra:  { host: '', user: '3paradm',       password: '', port: 8080, skip: false },
  veeam:    { host: '', user: 'administrator',  password: '', port: 9419, skip: false },
}

function generateKey() {
  const arr = new Uint8Array(32)
  crypto.getRandomValues(arr)
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
}

function buildEnvContent(cfg) {
  return [
    '# ── vCenter ──────────────────────────────────────────────',
    `VCENTER_HOST=${cfg.vcenter.host}`,
    `VCENTER_USER=${cfg.vcenter.user}`,
    `VCENTER_PASSWORD=${cfg.vcenter.password}`,
    `VCENTER_PORT=${cfg.vcenter.port}`,
    `VCENTER_SSL_VERIFY=${cfg.vcenter.sslVerify}`,
    '',
    '# ── Aruba Central ─────────────────────────────────────────',
    `ARUBA_CENTRAL_BASE_URL=${cfg.aruba.baseUrl}`,
    `ARUBA_CLIENT_ID=${cfg.aruba.clientId}`,
    `ARUBA_CLIENT_SECRET=${cfg.aruba.clientSecret}`,
    `ARUBA_CUSTOMER_ID=${cfg.aruba.customerId}`,
    `ARUBA_ACCESS_TOKEN=${cfg.aruba.accessToken}`,
    '',
    '# ── HPE Alletra 6000 ─────────────────────────────────────',
    `ALLETRA_HOST=${cfg.alletra.host}`,
    `ALLETRA_USER=${cfg.alletra.user}`,
    `ALLETRA_PASSWORD=${cfg.alletra.password}`,
    `ALLETRA_PORT=${cfg.alletra.port}`,
    '',
    '# ── Veeam Backup & Replication ────────────────────────────',
    `VEEAM_HOST=${cfg.veeam.host}`,
    `VEEAM_USER=${cfg.veeam.user}`,
    `VEEAM_PASSWORD=${cfg.veeam.password}`,
    `VEEAM_PORT=${cfg.veeam.port}`,
    '',
    '# ── App ───────────────────────────────────────────────────',
    'CACHE_TTL_SECONDS=60',
    'LOG_LEVEL=INFO',
    '',
    '# ── Auth ──────────────────────────────────────────────────',
    `API_KEY=${cfg.apiKey}`,
    'ALLOWED_ORIGINS=*',
  ].join('\n')
}

// ── Shared field components ───────────────────────────────────────────────────

function Field({ label, value, onChange, type = 'text', placeholder = '' }) {
  const [show, setShow] = useState(false)
  const isPassword = type === 'password'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>{label}</label>
      <div style={{ position: 'relative', display: 'flex' }}>
        <input
          type={isPassword && !show ? 'password' : 'text'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          style={{
            flex: 1, background: 'var(--bg)', border: '0.5px solid var(--border)',
            borderRadius: 6, padding: isPassword ? '0.45rem 2.25rem 0.45rem 0.65rem' : '0.45rem 0.65rem',
            color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 12, outline: 'none',
          }}
        />
        {isPassword && (
          <button type="button" onClick={() => setShow(s => !s)} style={{
            position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
            background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 13,
          }}>
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

// ── Step panels ───────────────────────────────────────────────────────────────

function StepWelcome() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--text)' }}>Welcome to Infra Glassplane</div>
      <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.7 }}>
        This wizard will connect your infrastructure sources. Every step is optional — skip any system you don't use.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
        {[
          ['ti-shield-lock',  'var(--c-blue)',  'Security — set an API key to protect the backend'],
          ['ti-server-2',     'var(--c-ok)',    'vCenter — compute utilisation and VM inventory'],
          ['ti-network',      'var(--c-ok)',    'Aruba Central — switch inventory and port utilisation'],
          ['ti-database',     'var(--c-ok)',    'HPE Alletra 6000 — storage capacity and efficiency'],
          ['ti-cloud-upload', 'var(--c-ok)',    'Veeam B&R — backup job health and repository capacity'],
        ].map(([icon, color, text]) => (
          <div key={icon} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>
            <i className={`ti ${icon}`} style={{ color, fontSize: 15, flexShrink: 0 }} aria-hidden="true" />
            {text}
          </div>
        ))}
      </div>
    </div>
  )
}

function StepSecurity({ cfg, setCfg }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ fontSize: 16, fontWeight: 600 }}>API Key</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
        A shared secret that protects all <code style={{ fontFamily: 'var(--mono)', background: 'var(--bg)', padding: '1px 4px', borderRadius: 3 }}>/api/*</code> endpoints.
        Leave blank to disable auth (fine for localhost-only installs).
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <Field label="API KEY" value={cfg.apiKey} onChange={v => setCfg(c => ({ ...c, apiKey: v }))} type="password" placeholder="leave blank to skip" />
        </div>
        <button type="button" onClick={() => setCfg(c => ({ ...c, apiKey: generateKey() }))} style={{
          padding: '0.45rem 0.75rem', background: 'var(--bg)', border: '0.5px solid var(--border)',
          borderRadius: 6, cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)',
          whiteSpace: 'nowrap', flexShrink: 0,
        }}>
          <i className="ti ti-wand" style={{ marginRight: 4 }} aria-hidden="true" />Generate
        </button>
      </div>
      {cfg.apiKey && (
        <div style={{ background: 'var(--bg)', borderRadius: 6, padding: '0.5rem 0.75rem', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', wordBreak: 'break-all' }}>
          {cfg.apiKey}
        </div>
      )}
    </div>
  )
}

function StepVCenter({ cfg, setCfg }) {
  const u = (f, v) => setCfg(c => ({ ...c, vcenter: { ...c.vcenter, [f]: v } }))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
      <div style={{ fontSize: 16, fontWeight: 600 }}>VMware vCenter</div>
      <Field label="HOST / IP" value={cfg.vcenter.host} onChange={v => u('host', v)} placeholder="vcenter.local" />
      <Field label="USERNAME" value={cfg.vcenter.user} onChange={v => u('user', v)} placeholder="administrator@vsphere.local" />
      <Field label="PASSWORD" value={cfg.vcenter.password} onChange={v => u('password', v)} type="password" />
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <Field label="PORT" value={String(cfg.vcenter.port)} onChange={v => u('port', parseInt(v) || 443)} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, justifyContent: 'flex-end', paddingBottom: 2 }}>
          <Toggle label="Verify SSL" checked={cfg.vcenter.sslVerify} onChange={v => u('sslVerify', v)} />
        </div>
      </div>
    </div>
  )
}

function StepAruba({ cfg, setCfg }) {
  const u = (f, v) => setCfg(c => ({ ...c, aruba: { ...c.aruba, [f]: v } }))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
      <div style={{ fontSize: 16, fontWeight: 600 }}>Aruba Central</div>
      <Field label="BASE URL" value={cfg.aruba.baseUrl} onChange={v => u('baseUrl', v)} />
      <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)', marginTop: -4 }}>
        Use a static access token or OAuth credentials — fill whichever applies.
      </div>
      <Field label="ACCESS TOKEN (static)" value={cfg.aruba.accessToken} onChange={v => u('accessToken', v)} type="password" placeholder="optional" />
      <Field label="CLIENT ID (OAuth)" value={cfg.aruba.clientId} onChange={v => u('clientId', v)} placeholder="optional" />
      <Field label="CLIENT SECRET (OAuth)" value={cfg.aruba.clientSecret} onChange={v => u('clientSecret', v)} type="password" placeholder="optional" />
      <Field label="CUSTOMER ID (OAuth)" value={cfg.aruba.customerId} onChange={v => u('customerId', v)} placeholder="optional" />
    </div>
  )
}

function StepAlletra({ cfg, setCfg }) {
  const u = (f, v) => setCfg(c => ({ ...c, alletra: { ...c.alletra, [f]: v } }))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
      <div style={{ fontSize: 16, fontWeight: 600 }}>HPE Alletra 6000</div>
      <Field label="HOST / IP" value={cfg.alletra.host} onChange={v => u('host', v)} placeholder="alletra6k.local" />
      <Field label="USERNAME" value={cfg.alletra.user} onChange={v => u('user', v)} placeholder="3paradm" />
      <Field label="PASSWORD" value={cfg.alletra.password} onChange={v => u('password', v)} type="password" />
      <Field label="WSAPI PORT" value={String(cfg.alletra.port)} onChange={v => u('port', parseInt(v) || 8080)} />
    </div>
  )
}

function StepVeeam({ cfg, setCfg }) {
  const u = (f, v) => setCfg(c => ({ ...c, veeam: { ...c.veeam, [f]: v } }))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
      <div style={{ fontSize: 16, fontWeight: 600 }}>Veeam Backup & Replication</div>
      <Field label="HOST / IP" value={cfg.veeam.host} onChange={v => u('host', v)} placeholder="veeam.local" />
      <Field label="USERNAME" value={cfg.veeam.user} onChange={v => u('user', v)} placeholder="administrator" />
      <Field label="PASSWORD" value={cfg.veeam.password} onChange={v => u('password', v)} type="password" />
      <Field label="REST API PORT" value={String(cfg.veeam.port)} onChange={v => u('port', parseInt(v) || 9419)} />
    </div>
  )
}

function StepSave({ cfg, onComplete }) {
  const isElectron = !!window.glassplane?.isElectron
  const [status, setStatus] = useState('idle') // idle | saving | done | error | copied
  const [errorMsg, setErrorMsg] = useState('')
  const envContent = buildEnvContent(cfg)

  const configured = [
    cfg.vcenter.host  && 'vCenter',
    (cfg.aruba.accessToken || cfg.aruba.clientId) && 'Aruba Central',
    cfg.alletra.host  && 'HPE Alletra',
    cfg.veeam.host    && 'Veeam',
  ].filter(Boolean)

  async function handleSave() {
    setStatus('saving')
    try {
      await window.glassplane.writeEnv(envContent)
      setStatus('done')
    } catch (e) {
      setErrorMsg(e.message)
      setStatus('error')
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(envContent)
    setStatus('copied')
    setTimeout(() => setStatus('idle'), 2500)
  }

  if (status === 'done') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'center', textAlign: 'center', padding: '1rem 0' }}>
        <i className="ti ti-circle-check" style={{ fontSize: 48, color: 'var(--c-ok)' }} aria-hidden="true" />
        <div style={{ fontSize: 16, fontWeight: 600 }}>Configuration saved</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
          The .env file has been written. Relaunch the app to connect to your infrastructure.
        </div>
        <button onClick={() => window.glassplane.relaunchApp()} style={btnStyle('#3b82f6', '#fff')}>
          <i className="ti ti-refresh" style={{ marginRight: 6 }} aria-hidden="true" />Relaunch Now
        </button>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ fontSize: 16, fontWeight: 600 }}>Review & Save</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>CONFIGURED</div>
        {configured.length === 0
          ? <div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>No connectors configured — you can add them later from Settings.</div>
          : configured.map(name => (
              <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--c-ok)' }}>
                <i className="ti ti-check" aria-hidden="true" />{name}
              </div>
            ))
        }
        {cfg.apiKey && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--c-ok)' }}>
            <i className="ti ti-check" aria-hidden="true" />API key set
          </div>
        )}
      </div>

      <details style={{ fontSize: 12 }}>
        <summary style={{ cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', userSelect: 'none' }}>
          Preview .env
        </summary>
        <pre style={{
          marginTop: 8, background: 'var(--bg)', border: '0.5px solid var(--border)',
          borderRadius: 6, padding: '0.75rem', fontFamily: 'var(--mono)', fontSize: 11,
          color: 'var(--muted)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 200, overflowY: 'auto',
        }}>{envContent}</pre>
      </details>

      {status === 'error' && (
        <div style={{ background: '#fee2e2', border: '0.5px solid #fca5a5', borderRadius: 6, padding: '0.5rem 0.75rem', fontSize: 12, color: '#991b1b', fontFamily: 'var(--mono)' }}>
          {errorMsg}
        </div>
      )}

      {isElectron ? (
        <button onClick={handleSave} disabled={status === 'saving'} style={btnStyle('#3b82f6', '#fff')}>
          {status === 'saving' ? 'Saving…' : 'Save & Continue'}
        </button>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button onClick={handleCopy} style={btnStyle('#3b82f6', '#fff')}>
            <i className={`ti ${status === 'copied' ? 'ti-check' : 'ti-clipboard'}`} style={{ marginRight: 6 }} aria-hidden="true" />
            {status === 'copied' ? 'Copied!' : 'Copy .env to clipboard'}
          </button>
          <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)', lineHeight: 1.7 }}>
            Save as <code>backend/.env</code>, restart the backend, then refresh this page.
          </div>
          <button onClick={onComplete} style={{ ...btnStyle('var(--bg)', 'var(--muted)'), border: '0.5px solid var(--border)', fontSize: 11 }}>
            I've saved it — take me to the app
          </button>
        </div>
      )}
    </div>
  )
}

function btnStyle(bg, color) {
  return {
    background: bg, color, border: 'none', borderRadius: 6,
    padding: '0.55rem 1rem', fontFamily: 'var(--mono)', fontSize: 12,
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: '100%',
  }
}

// ── Main wizard ───────────────────────────────────────────────────────────────

export default function SetupView({ onComplete }) {
  const [step, setStep] = useState(0)
  const [cfg, setCfg] = useState(DEFAULTS)

  const isFirst = step === 0
  const isLast  = step === STEPS.length - 1

  const CONNECTOR_STEPS = { 2: 'vcenter', 3: 'aruba', 4: 'alletra', 5: 'veeam' }

  function canSkip() {
    return step >= 1 && step <= 5
  }

  function handleSkip() {
    const key = CONNECTOR_STEPS[step]
    if (key) setCfg(c => ({ ...c, [key]: { ...c[key], skip: true } }))
    setStep(s => s + 1)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--bg)', padding: '1rem' }}>
      <div style={{ width: '100%', maxWidth: 520, background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>

        {/* Progress bar */}
        <div style={{ height: 3, background: 'var(--bg)' }}>
          <div style={{ height: '100%', background: 'var(--c-blue)', width: `${((step) / (STEPS.length - 1)) * 100}%`, transition: 'width 0.3s ease' }} />
        </div>

        {/* Step label */}
        <div style={{ padding: '0.75rem 1.5rem 0', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {STEPS[step]}
          </span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--border)', marginLeft: 'auto' }}>
            {step + 1} / {STEPS.length}
          </span>
        </div>

        {/* Step content */}
        <div style={{ padding: '1.25rem 1.5rem' }}>
          {step === 0 && <StepWelcome />}
          {step === 1 && <StepSecurity cfg={cfg} setCfg={setCfg} />}
          {step === 2 && <StepVCenter  cfg={cfg} setCfg={setCfg} />}
          {step === 3 && <StepAruba   cfg={cfg} setCfg={setCfg} />}
          {step === 4 && <StepAlletra cfg={cfg} setCfg={setCfg} />}
          {step === 5 && <StepVeeam   cfg={cfg} setCfg={setCfg} />}
          {step === 6 && <StepSave    cfg={cfg} onComplete={onComplete} />}
        </div>

        {/* Navigation */}
        {!isLast && (
          <div style={{ padding: '0 1.5rem 1.25rem', display: 'flex', gap: 8 }}>
            {!isFirst && (
              <button onClick={() => setStep(s => s - 1)} style={{
                ...btnStyle('var(--bg)', 'var(--muted)'), border: '0.5px solid var(--border)', width: 'auto', padding: '0.5rem 1rem',
              }}>
                <i className="ti ti-arrow-left" style={{ marginRight: 6 }} aria-hidden="true" />Back
              </button>
            )}
            <div style={{ flex: 1 }} />
            {canSkip() && (
              <button onClick={handleSkip} style={{ ...btnStyle('transparent', 'var(--muted)'), width: 'auto', padding: '0.5rem 0.75rem', fontSize: 11 }}>
                Skip
              </button>
            )}
            <button onClick={() => setStep(s => s + 1)} style={{ ...btnStyle('#3b82f6', '#fff'), width: 'auto', padding: '0.5rem 1.25rem' }}>
              {isFirst ? 'Get Started' : 'Next'}
              <i className="ti ti-arrow-right" style={{ marginLeft: 6 }} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
