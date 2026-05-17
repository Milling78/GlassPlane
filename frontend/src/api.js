// Resolves the backend base URL whether running in Electron, browser dev, or browser prod.

const API_KEY_STORAGE = 'glassplane_api_key'

export const auth = {
  getKey: ()        => localStorage.getItem(API_KEY_STORAGE) ?? '',
  setKey: (key)     => localStorage.setItem(API_KEY_STORAGE, key),
  clearKey: ()      => localStorage.removeItem(API_KEY_STORAGE),
}

let _baseUrl = null  // null = not yet resolved; '' = same-origin (browser/static mode)

export async function getBaseUrl() {
  if (_baseUrl !== null) return _baseUrl

  if (window.glassplane?.isElectron) {
    if (window.glassplane.getBackendUrl) {
      // Supports both local (http://127.0.0.1:port) and remote (https://server) backends
      _baseUrl = (await window.glassplane.getBackendUrl()).replace(/\/$/, '')
    } else {
      // Legacy fallback for older builds
      const port = await window.glassplane.getBackendPort()
      _baseUrl = `http://127.0.0.1:${port}`
    }
    return _baseUrl
  }

  // Injected by Electron main for local backend (legacy path)
  if (window.__BACKEND_PORT__) {
    _baseUrl = `http://127.0.0.1:${window.__BACKEND_PORT__}`
    return _baseUrl
  }

  // Browser: same-origin — either Vite proxy (dev) or FastAPI serving static files (prod)
  _baseUrl = ''
  return _baseUrl
}

export async function apiFetch(path, options = {}) {
  const base = await getBaseUrl()
  const key = auth.getKey()
  const headers = { ...(options.headers ?? {}) }
  if (key) headers['Authorization'] = `Bearer ${key}`

  const res = await fetch(`${base}${path}`, {
    ...options,
    headers,
    signal: options.signal ?? AbortSignal.timeout(45000),
  })

  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('glassplane:unauthorized'))
    throw new Error('Unauthorized')
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`)
  return res.json()
}

export const api = {
  summary:  () => apiFetch('/api/summary'),
  vcenter:  () => apiFetch('/api/vcenter'),
  vcenterVMs: (params = {}) => {
    const q = new URLSearchParams(params).toString()
    return apiFetch(`/api/vcenter/vms${q ? '?' + q : ''}`)
  },
  aruba:    () => apiFetch('/api/aruba'),
  alletra:  () => apiFetch('/api/alletra'),
  veeam:    () => apiFetch('/api/veeam'),
  surges:   (params = {}) => {
    const q = new URLSearchParams(params).toString()
    return apiFetch(`/api/vcenter/surges${q ? '?' + q : ''}`)
  },
  vcenterHosts:        () => apiFetch('/api/vcenter/hosts'),
  vcenterSnapshots:    () => apiFetch('/api/vcenter/snapshots'),
  vcenterEvents:       (hours = 8, limit = 200) => apiFetch(`/api/vcenter/events?hours=${hours}&limit=${limit}`),
  arubaDirectSwitches:   () => apiFetch('/api/aruba/direct'),
  arubaWireless:         () => apiFetch('/api/aruba/wireless'),
  arubaWirelessDirect:   () => apiFetch('/api/aruba/wireless/direct'),
  history:  (hours = 24) => apiFetch(`/api/history?hours=${hours}`),
  ilo:           () => apiFetch('/api/ilo/'),
  veeamSessions: (days = 30) => apiFetch(`/api/veeam/sessions?days=${days}`),
  forecast:     () => apiFetch('/api/forecast/'),
  dns:          () => apiFetch('/api/dns/'),
  certs:        () => apiFetch('/api/certs/'),
  kace:         () => apiFetch('/api/kace/'),
  rds:          () => apiFetch('/api/rds/'),
  fortigate:    () => apiFetch('/api/fortigate/'),
  exchange:     () => apiFetch('/api/exchange/'),
  fortianalyzer: () => apiFetch('/api/fortianalyzer/'),
  logs:         (level, limit = 200) => apiFetch(`/api/logs/?${new URLSearchParams({ ...(level && level !== 'ALL' ? { level } : {}), limit })}`),
  clearLogs:    () => apiFetch('/api/logs/', { method: 'DELETE' }),
  alertStatus:  () => apiFetch('/api/alerts/status'),
  alertHistory: (limit = 100) => apiFetch(`/api/alerts/history?limit=${limit}`),
  alertCheck:   () => apiFetch('/api/alerts/check', { method: 'POST' }),
  siemStatus:   () => apiFetch('/api/siem/status'),
  siemEvents:   (params = {}) => {
    const q = new URLSearchParams(params).toString()
    return apiFetch(`/api/siem/events${q ? '?' + q : ''}`)
  },
  siemIngest:   (events) => apiFetch('/api/siem/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(events),
  }),
}

/**
 * Open a streaming SSE connection to the AI analysis endpoint.
 * Returns the raw ReadableStream so the caller can read tokens as they arrive.
 * Pass an AbortController signal to support stop-generation.
 */
export async function aiStreamFetch(messages, snapshot, signal) {
  const base = await getBaseUrl()
  const key  = auth.getKey()
  const resp = await fetch(`${base}/api/ai/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({ messages, snapshot }),
    signal,
  })
  if (resp.status === 401) {
    window.dispatchEvent(new CustomEvent('glassplane:unauthorized'))
    throw new Error('Unauthorized')
  }
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  return resp.body // ReadableStream
}

