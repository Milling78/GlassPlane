const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const net = require('net')
const fs = require('fs')

const isDev = !app.isPackaged
let mainWindow = null
let backendProcess = null
let backendPort = 8000

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

function waitForBackend(port, retries = 40, delayMs = 500) {
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
  if (isDev) {
    // In dev, run Python directly
    return null
  }
  const platform = process.platform
  const binName = platform === 'win32' ? 'glassplane-backend.exe' : 'glassplane-backend'
  // electron-builder copies extraResources to process.resourcesPath
  return path.join(process.resourcesPath, 'backend', binName)
}

function getBackendArgs(port) {
  return ['--host', '127.0.0.1', '--port', String(port)]
}

// ── Backend lifecycle ─────────────────────────────────────────────────────────

async function startBackend() {
  backendPort = await findFreePort(8000)
  const bin = getBackendBinary()

  if (!bin) {
    // Dev mode: run uvicorn directly
    const backendDir = path.join(__dirname, '..', 'backend')
    backendProcess = spawn(
      process.platform === 'win32' ? 'python' : 'python3',
      ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(backendPort)],
      { cwd: backendDir, env: { ...process.env, PYTHONUNBUFFERED: '1' } }
    )
  } else {
    if (!fs.existsSync(bin)) throw new Error(`Backend binary not found: ${bin}`)
    backendProcess = spawn(bin, getBackendArgs(backendPort), {
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
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
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(backendProcess.pid), '/f', '/t'])
    } else {
      backendProcess.kill('SIGTERM')
    }
  } catch (e) {
    console.error('[main] failed to kill backend:', e)
  }
  backendProcess = null
}

// ── Window ────────────────────────────────────────────────────────────────────

function createWindow(port) {
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
      // Allow loading from localhost backend
      webSecurity: true,
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false,
  })

  // Inject backend port so the frontend knows where to call
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript(
      `window.__BACKEND_PORT__ = ${port};`
    )
  })

  if (isDev) {
    // Vite dev server
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'))
  }

  mainWindow.once('ready-to-show', () => mainWindow.show())

  // Open external links in the system browser, not Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => { mainWindow = null })
}

// ── IPC handlers ──────────────────────────────────────────────────────────────

ipcMain.handle('get-backend-port', () => backendPort)

ipcMain.handle('open-env-file', async () => {
  const envPath = isDev
    ? path.join(__dirname, '..', 'backend', '.env')
    : path.join(app.getPath('userData'), '.env')
  if (!fs.existsSync(envPath)) {
    const example = isDev
      ? path.join(__dirname, '..', 'backend', '.env.example')
      : null
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

ipcMain.handle('write-env', async (_, content) => {
  const envPath = isDev
    ? path.join(__dirname, '..', 'backend', '.env')
    : path.join(app.getPath('userData'), '.env')
  fs.writeFileSync(envPath, content, 'utf8')
  return envPath
})

ipcMain.handle('relaunch-app', () => {
  app.relaunch()
  app.exit(0)
})

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  try {
    const port = await startBackend()
    createWindow(port)
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
  stopBackend()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', stopBackend)

// Graceful crash recovery
process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException:', err)
})
