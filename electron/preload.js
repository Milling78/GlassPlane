const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('glassplane', {
  getBackendPort: () => ipcRenderer.invoke('get-backend-port'),
  openEnvFile:    () => ipcRenderer.invoke('open-env-file'),
  showError:  (msg) => ipcRenderer.invoke('show-error', msg),
  platform: process.platform,
  isElectron: true,
})
