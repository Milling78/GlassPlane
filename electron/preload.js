const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('glassplane', {
  getBackendPort:   ()        => ipcRenderer.invoke('get-backend-port'),
  openEnvFile:      ()        => ipcRenderer.invoke('open-env-file'),
  showError:        (msg)     => ipcRenderer.invoke('show-error', msg),
  writeEnv:         (content) => ipcRenderer.invoke('write-env', content),
  relaunchApp:      ()        => ipcRenderer.invoke('relaunch-app'),
  openExternal:     (url)     => ipcRenderer.invoke('open-external', url),
  getAppVersion:    ()        => ipcRenderer.invoke('get-app-version'),
  checkForUpdates:  ()        => ipcRenderer.invoke('check-for-updates'),
  installUpdate:    ()        => ipcRenderer.invoke('install-update'),
  onUpdateStatus:   (cb)      => ipcRenderer.on('update-status', (_, data) => cb(data)),
  offUpdateStatus:  (cb)      => ipcRenderer.removeListener('update-status', cb),
  platform: process.platform,
  isElectron: true,
})
