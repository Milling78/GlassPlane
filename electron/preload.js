const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('glassplane', {
  getBackendPort: ()        => ipcRenderer.invoke('get-backend-port'),
  openEnvFile:    ()        => ipcRenderer.invoke('open-env-file'),
  showError:      (msg)     => ipcRenderer.invoke('show-error', msg),
  writeEnv:       (content) => ipcRenderer.invoke('write-env', content),
  relaunchApp:    ()        => ipcRenderer.invoke('relaunch-app'),
  platform: process.platform,
  isElectron: true,
})
