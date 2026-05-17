const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('glassplane', {
  getBackendPort:   ()        => ipcRenderer.invoke('get-backend-port'),
  getBackendUrl:    ()        => ipcRenderer.invoke('get-backend-url'),
  openEnvFile:      ()        => ipcRenderer.invoke('open-env-file'),
  showError:        (msg)     => ipcRenderer.invoke('show-error', msg),
  writeEnv:         (content) => ipcRenderer.invoke('write-env', content),
  relaunchApp:      ()        => ipcRenderer.invoke('relaunch-app'),
  openExternal:     (url)     => ipcRenderer.invoke('open-external', url),
  getAppVersion:    ()        => ipcRenderer.invoke('get-app-version'),
  checkForUpdates:  ()        => ipcRenderer.invoke('check-for-updates'),
  installUpdate:    ()        => ipcRenderer.invoke('install-update'),
  getUpdateStatus:  ()        => ipcRenderer.invoke('get-update-status'),
  onUpdateStatus:   (cb)      => { const w = (_, d) => cb(d); ipcRenderer.on('update-status', w); return w },
  offUpdateStatus:  (wrapped) => ipcRenderer.removeListener('update-status', wrapped),
  setTvMode:        (res)     => ipcRenderer.invoke('set-tv-mode', res),
  exitTvMode:       ()        => ipcRenderer.invoke('exit-tv-mode'),
  platform: process.platform,
  isElectron: true,
})
