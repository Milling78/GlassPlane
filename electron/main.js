const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const net = require('net')
const fs = require('fs')

const isDev = !app.isPackaged
// Set GLASSPLANE_BACKEND_URL to point Electron at a remote server instead of
// spawning a local backend. The local backend process is skipped entirely.
const REMOTE_BACKEND_URL = (process.env.GLASSPLANE_BACKEND_URL || '').replace(/\/$/, '')

let mainWindow = null
let backendProcess = null
let backendPort = 8000
let _lastUpdateStatus = null

// ── Utilities ────────────────────────────────────────────────────────────────

function findFreePort(start = 8000) {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(start, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
    server.on('error', () => findFreePort(start + 1).then(resolve).catch(reject))
  })
}

function waitForBackend(port, retries = 80, delayMs = 500) {
  return new Promise((resolve, reject) => {
    const http = require('http')
    let attempts = 0
    const check = () => {
      const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
        if (res.statusCode === 200) return resolve()
        retry()
      })
      req.on('error', retry)
      req.setTimeout(500, () => { req.destroy(); retry() })
    }
    const retry = () => {
      attempts++
      if (attempts >= retries) return reject(new Error(`Backend did not start on port ${port}`))
      setTimeout(check, delayMs)
    }
    check()
  })
}

function getBackendBinary() {
  if (isDev) return null
  const binName = process.platform === 'win32' ? 'glassplane-backend.exe' : 'glassplane-backend'
  return path.join(process.resourcesPath, 'backend', binName)
}

// ── Backend lifecycle ─────────────────────────────────────────────────────────

async function startBackend() {
  backendPort = await findFreePort(8000)
  const bin = getBackendBinary()

  if (!bin) {
    // Dev mode: run uvicorn from the backend source directory
    const backendDir = path.join(__dirname, '..', 'backend')
    backendProcess = spawn(
      process.platform === 'win32' ? 'python' : 'python3',
      ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(backendPort)],
      { cwd: backendDir, env: { ...process.env, PYTHONUNBUFFERED: '1' } }
    )
  } else {
    if (!fs.existsSync(bin)) throw new Error(`Backend binary not found: ${bin}`)

    // Production: store .env and glassplane.db in %APPDATA%\Infra Glassplane
    const userDataPath = app.getPath('userData')
    fs.mkdirSync(userDataPath, { recursive: true })

    // Copy .env.example on first run so setup wizard has a template
    const envPath     = path.join(userDataPath, '.env')
    const examplePath = path.join(process.resourcesPath, 'backend', '.env.example')
    if (!fs.existsSync(envPath) && fs.existsSync(examplePath)) {
      fs.copyFileSync(examplePath, envPath)
    }

    backendProcess = spawn(bin, ['--host', '127.0.0.1', '--port', String(backendPort)], {
      cwd: userDataPath,
      env: {
        ...process.env,
        PYTHONUNBUFFERED:    '1',
        GLASSPLANE_ENV_FILE: envPath,
      },
    })
  }

  backendProcess.stdout.on('data', d => console.log('[backend]', d.toString().trim()))
  backendProcess.stderr.on('data', d => console.error('[backend]', d.toString().trim()))
  backendProcess.on('exit', (code) => {
    console.log(`[backend] exited with code ${code}`)
    backendProcess = null
  })

  console.log(`[main] waiting for backend on port ${backendPort}…`)
  await waitForBackend(backendPort)
  console.log(`[main] backend ready on port ${backendPort}`)
  return backendPort
}

function stopBackend() {
  if (!backendProcess) return
  const proc = backendProcess
  backendProcess = null
  try {
    if (process.platform === 'win32') {
      // process.kill(pid) only kills the direct child. PyInstaller --onefile
      // spawns a child Python interpreter that survives and holds the exe locked,
      // preventing NSIS from replacing it during an update. taskkill /T kills
      // the entire process tree; execFileSync blocks until all processes exit.
      require('child_process').execFileSync(
        'taskkill', ['/F', '/T', '/PID', String(proc.pid)],
        { stdio: 'ignore', timeout: 5000 }
      )
    } else {
      proc.kill('SIGTERM')
    }
  } catch (e) {
    console.error('[main] failed to kill backend:', e)
  }
}

// ── Window ────────────────────────────────────────────────────────────────────

function createWindow(port, remoteUrl = '') {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Infrastructure Glassplane',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false,
  })

  mainWindow.webContents.on('did-finish-load', () => {
    if (!remoteUrl) {
      mainWindow.webContents.executeJavaScript(`window.__BACKEND_PORT__ = ${port};`)
    }
  })

  if (remoteUrl) {
    mainWindow.loadURL(remoteUrl)
  } else if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'))
  }

  mainWindow.once('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => { mainWindow = null })
}

// ── Auto-updater ──────────────────────────────────────────────────────────────

function _sendUpdateStatus(data) {
  _lastUpdateStatus = data
  mainWindow?.webContents.send('update-status', data)
}

function initAutoUpdater() {
  if (isDev) return

  let autoUpdater
  try {
    autoUpdater = require('electron-updater').autoUpdater
  } catch (e) {
    console.warn('[updater] electron-updater not available:', e.message)
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = { info: m => console.log('[updater]', m), warn: m => console.warn('[updater]', m), error: m => console.error('[updater]', m) }

  autoUpdater.on('checking-for-update', () => {
    console.log('[updater] checking for update…')
    _sendUpdateStatus({ status: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    console.log(`[updater] update available: ${info.version}`)
    _sendUpdateStatus({ status: 'available', version: info.version })
  })

  autoUpdater.on('update-not-available', () => {
    console.log('[updater] up to date')
    _sendUpdateStatus({ status: 'current' })
  })

  autoUpdater.on('download-progress', (prog) => {
    const pct = Math.round(prog.percent)
    console.log(`[updater] downloading… ${pct}%`)
    _sendUpdateStatus({ status: 'downloading', percent: pct })
  })

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[updater] update downloaded: ${info.version}`)
    _sendUpdateStatus({ status: 'ready', version: info.version })

    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update ready',
      message: `Infra Glassplane ${info.version} has been downloaded.`,
      detail: 'Restart now to apply the update, or it will install automatically when you next close the app.',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) {
        autoUpdater.quitAndInstall(true, true)
      }
    })
  })

  autoUpdater.on('error', (err) => {
    console.error('[updater] error:', err)
    _sendUpdateStatus({ status: 'error', message: err.message })
  })

  // Check 10 seconds after launch; catch to prevent unhandled rejection
  setTimeout(() => autoUpdater.checkForUpdates().catch(err => console.error('[updater] checkForUpdates rejected:', err)), 10_000)

  ipcMain.handle('check-for-updates', () => autoUpdater.checkForUpdates())
  ipcMain.handle('install-update',    () => autoUpdater.quitAndInstall(true, true))
}

// ── IPC handlers ──────────────────────────────────────────────────────────────

ipcMain.handle('get-backend-port', () => backendPort)
ipcMain.handle('get-backend-url',  () => REMOTE_BACKEND_URL || `http://127.0.0.1:${backendPort}`)
ipcMain.handle('get-update-status', () => _lastUpdateStatus)

ipcMain.handle('open-env-file', async () => {
  const envPath = isDev
    ? path.join(__dirname, '..', 'backend', '.env')
    : path.join(app.getPath('userData'), '.env')
  if (!fs.existsSync(envPath)) {
    const example = isDev ? path.join(__dirname, '..', 'backend', '.env.example') : null
    if (example && fs.existsSync(example)) {
      fs.copyFileSync(example, envPath)
    } else {
      fs.writeFileSync(envPath, '# Infra Glassplane configuration\n')
    }
  }
  shell.openPath(envPath)
  return envPath
})

ipcMain.handle('show-error', async (_, msg) => {
  await dialog.showErrorBox('Glassplane error', msg)
})

// Keys whose blank values should be preserved from the existing .env.
// Matches any key containing PASSWORD, SECRET, TOKEN, KEY, or PASSWD (case-insensitive).
const _CREDENTIAL_RE = /PASSWORD|SECRET|TOKEN|KEY|PASSWD/i

function _mergeEnv(existing, incoming) {
  // Parse existing .env into a map of KEY -> value (raw string after '=')
  const existingVals = {}
  for (const line of existing.split('\n')) {
    const eq = line.indexOf('=')
    if (eq === -1 || line.trimStart().startsWith('#')) continue
    const k = line.slice(0, eq).trim()
    const v = line.slice(eq + 1)  // preserve exactly as-is (may contain spaces/quotes)
    existingVals[k] = v
  }

  // Re-write the incoming content: for credential keys with an empty value,
  // substitute the existing value so passwords are never wiped by the UI.
  return incoming.split('\n').map(line => {
    const eq = line.indexOf('=')
    if (eq === -1 || line.trimStart().startsWith('#')) return line
    const k = line.slice(0, eq).trim()
    const v = line.slice(eq + 1).trim()
    if (v === '' && _CREDENTIAL_RE.test(k) && existingVals[k] !== undefined && existingVals[k].trim() !== '') {
      return `${k}=${existingVals[k]}`
    }
    return line
  }).join('\n')
}

ipcMain.handle('write-env', async (_, content) => {
  const envPath = isDev
    ? path.join(__dirname, '..', 'backend', '.env')
    : path.join(app.getPath('userData'), '.env')

  // Preserve existing credential values for any field left blank in the UI
  let merged = content
  if (fs.existsSync(envPath)) {
    try {
      const existing = fs.readFileSync(envPath, 'utf8')
      merged = _mergeEnv(existing, content)
    } catch (e) {
      console.warn('[main] write-env merge failed, writing as-is:', e.message)
    }
  }

  fs.writeFileSync(envPath, merged, 'utf8')
  return envPath
})

ipcMain.handle('relaunch-app', () => {
  app.relaunch()
  app.exit(0)
})

ipcMain.handle('open-external', (_, url) => {
  shell.openExternal(url)
})

ipcMain.handle('get-app-version', () => app.getVersion())

ipcMain.handle('set-tv-mode', (_, resolution) => {
  if (!mainWindow) return
  const w = resolution === '4k' ? 3840 : 1920
  const h = resolution === '4k' ? 2160 : 1080
  mainWindow.setFullScreen(true)
  mainWindow.setSize(w, h)
  mainWindow.center()
})

ipcMain.handle('exit-tv-mode', () => {
  if (!mainWindow) return
  mainWindow.setFullScreen(false)
  mainWindow.setSize(1400, 900)
  mainWindow.center()
})

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  try {
    if (REMOTE_BACKEND_URL) {
      console.log(`[main] remote backend mode → ${REMOTE_BACKEND_URL}`)
      createWindow(0, REMOTE_BACKEND_URL)
    } else {
      const port = await startBackend()
      createWindow(port)
    }
    initAutoUpdater()
  } catch (err) {
    console.error('[main] startup error:', err)
    dialog.showErrorBox(
      'Startup failed',
      `Could not start the backend service:\n\n${err.message}`
    )
    app.quit()
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(backendPort)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// will-quit fires after electron-updater's before-quit handler has already
// spawned the installer and called app.exit() — safe order on all platforms.
app.on('will-quit', stopBackend)

process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException:', err)
})
