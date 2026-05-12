// Resolves the backend base URL whether running in Electron, browser dev, or browser prod.

const API_KEY_STORAGE = 'glassplane_api_key'

export const auth = {
  getKey: ()        => localStorage.getItem(API_KEY_STORAGE) ?? '',
  setKey: (key)     => localStorage.setItem(API_KEY_STORAGE, key),
  clearKey: ()      => localStorage.removeItem(API_KEY_STORAGE),
}

let _port = null

export async function getBaseUrl() {
  if (_port) return `http://127.0.0.1:${_port}`

  // Electron exposes the port via preload
  if (window.glassplane?.isElectron) {
    _port = await window.glassplane.getBackendPort()
    return `http://127.0.0.1:${_port}`
  }

  // Injected by Electron main after load (fallback)
  if (window.__BACKEND_PORT__) {
    _port = window.__BACKEND_PORT__
    return `http://127.0.0.1:${_port}`
  }

  // Plain browser dev (Vite proxy handles /api)
  return ''
}

export async function apiFetch(path, options = {}) {
  const base = await getBaseUrl()
  const key = auth.getKey()
  const headers = { ...(options.headers ?? {}) }
  if (key) headers['Authorization'] = `Bearer ${key}`

  const res = await fetch(`${base}${path}`, {
    ...options,
    headers,
    signal: options.signal ?? AbortSignal.timeout(15000),
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
  history:  (hours = 24) => apiFetch(`/api/history?hours=${hours}`),
  alertStatus:  () => apiFetch('/api/alerts/status'),
  alertHistory: (limit = 100) => apiFetch(`/api/alerts/history?limit=${limit}`),
  alertCheck:   () => apiFetch('/api/alerts/check', { method: 'POST' }),
}

