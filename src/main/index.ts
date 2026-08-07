import { app, BrowserWindow, protocol, Menu, screen } from 'electron'
import { join } from 'path'
import { optimizer, is } from '@electron-toolkit/utils'
import * as database from './database'
import * as downloadManager from './downloadManager'
import * as dockProgress from './dockProgress'
import { initializePoTokenServer, stopPoTokenServer } from './poTokenServer'
import { startLocalServer, stopLocalServer, setDownloadHandler, setMediaDownloadHandler, DownloadRequest, DownloadDispatchResult, LOCAL_SERVER_PORT } from './localServer'
import * as settings from './settings'
import { registerDownloadHandlers } from './ipc/downloads'
import { registerSettingsHandlers } from './ipc/settings'
import { registerWindowHandlers } from './ipc/window'
import { initWorklog, worklog } from './worklog'
import { initializeUpdater } from './updater'
import { registerUpdaterHandlers } from './ipc/updater'

app.setName('V-Download')

let mainWindow: BrowserWindow | null = null
let pendingYtdlUrl: string[] = []
let pendingMediaRequests = new Map<string, DownloadRequest>()
let isQuitting = false

const DEEP_LINK_SCHEMES = new Set(['ytdl:', 'vdownload:'])

function isDeepLinkUrl(url: string): boolean {
  try {
    return DEEP_LINK_SCHEMES.has(new URL(url).protocol)
  } catch {
    return false
  }
}

/** Browser extension cold-start: activate app without queuing (download follows via localhost POST). */
function isWakeDeepLink(url: string): boolean {
  if (!isDeepLinkUrl(url)) return false
  try {
    const u = new URL(url)
    return u.hostname === 'wake' || u.hostname === 'open'
  } catch {
    return false
  }
}

const VITE_DEV_SERVER_URL = process.env.ELECTRON_RENDERER_URL

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'ytdl',
    privileges: { standard: true, secure: true, supportFetchAPI: false }
  },
  {
    scheme: 'vdownload',
    privileges: { standard: true, secure: true, supportFetchAPI: false }
  }
])

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

const launchUrl = process.argv.find((arg) => isDeepLinkUrl(arg))
if (launchUrl) {
  pendingYtdlUrl.push(launchUrl)
}

function createWindow(): void {
  const { workAreaSize } = screen.getPrimaryDisplay()
  const margin = 40
  const maxW = Math.max(400, workAreaSize.width - margin)
  const maxH = Math.max(400, workAreaSize.height - margin)
  const defaultWidth = Math.min(1328, maxW)
  const defaultHeight = Math.min(848, maxH)
  const minWidth = Math.min(900, Math.max(560, Math.floor(workAreaSize.width * 0.92)))

  mainWindow = new BrowserWindow({
    width: defaultWidth,
    height: defaultHeight,
    minWidth,
    minHeight: 480,
    icon: join(__dirname, '../../resources/icon.png'),
    backgroundColor: '#0B0B0B',
    titleBarStyle: 'hiddenInset',
    frame: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  downloadManager.setMainWindow(mainWindow)

  const allowedDevOrigin = is.dev && VITE_DEV_SERVER_URL
    ? (() => {
        try { return new URL(VITE_DEV_SERVER_URL).origin } catch { return null }
      })()
    : null
  const isAllowedRendererUrl = (url: string): boolean => {
    if (url.startsWith('file://')) return true
    return Boolean(allowedDevOrigin && (() => {
      try { return new URL(url).origin === allowedDevOrigin } catch { return false }
    })())
  }
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const blockExternalNavigation = (event: Electron.Event, url: string): void => {
    if (!isAllowedRendererUrl(url)) event.preventDefault()
  }
  mainWindow.webContents.on('will-navigate', blockExternalNavigation)
  mainWindow.webContents.on('will-redirect', blockExternalNavigation)

  if (is.dev && VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('close', (e) => {
    if (process.platform === 'darwin' && !isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    downloadManager.setMainWindow(null)
  })

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if ((input.meta || input.control) && input.key === 'w') {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.webContents.on('did-finish-load', () => {
    if (!pendingYtdlUrl.length || !mainWindow || mainWindow.isDestroyed()) return
    const pending = pendingYtdlUrl.splice(0)
    for (const url of pending) {
      if (isWakeDeepLink(url)) {
        mainWindow.show()
        mainWindow.focus()
      } else {
        mainWindow.webContents.send('ytdl-url', url)
      }
    }
  })
}

function handleDownloadRequest(request: DownloadRequest): DownloadDispatchResult {
  const params = new URLSearchParams({ url: request.url })
  if (request.type) params.set('type', request.type)
  if (request.quality) params.set('quality', request.quality)
  if (request.autoStart) params.set('autoStart', '1')
  if (request.referer) params.set('referer', request.referer)
  if (request.title) params.set('title', request.title)
  if (request.headers) params.set('headers', JSON.stringify(request.headers))
  const ytdlUrl = `ytdl://download?${params.toString()}`
  handleYtdlUrl(ytdlUrl)
  return { ok: true, accepted: true }
}

function handleYtdlUrl(url: string): void {
  // The macOS app can stay resident after its window closes. Keep the
  // localhost bridge available for extension requests in that state.
  if (app.isReady()) startLocalServer()
  if (isWakeDeepLink(url)) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
      mainWindow.focus()
    } else {
      pendingYtdlUrl.push(url)
      if (app.isReady()) createWindow()
    }
    return
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
    if (mainWindow.webContents.isLoading()) {
      pendingYtdlUrl.push(url)
      return
    }
    mainWindow.webContents.send('ytdl-url', url)
  } else {
    pendingYtdlUrl.push(url)
    if (app.isReady()) createWindow()
  }
}

function setupIpcHandlers(): void {
  registerDownloadHandlers()
  registerSettingsHandlers()
  registerWindowHandlers({
    getMainWindow: () => mainWindow
  })
  registerUpdaterHandlers()
}

app.whenReady().then(() => {
  initWorklog()
  worklog('app_ready', { packaged: app.isPackaged, version: app.getVersion() })

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Settings…',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.show()
              mainWindow.focus()
              mainWindow.webContents.send('open-preferences')
            }
          }
        },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Find Downloads',
          accelerator: 'CmdOrCtrl+F',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('focus-download-search')
            }
          }
        },
        {
          label: 'Refresh Downloads',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('refresh-downloads')
            }
          }
        }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'close' }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))

  dockProgress.init()

  database.initDB()
  downloadManager.loadFromDbAndRecover()
  initializePoTokenServer()
  setDownloadHandler((request) => handleDownloadRequest(request))
  setMediaDownloadHandler((request) => {
    const quality = settings.get('defaultVideoQuality')
    downloadManager.addTask({
      url: request.url,
      title: request.title || 'download',
      format: 'video',
      quality,
      mediaType: request.type,
      referer: request.referer,
      customHeaders: request.headers
    })
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
      mainWindow.focus()
    }
    return { ok: true, accepted: true }
  })
  // Register handlers before opening the port. The extension uses /ping as a
  // readiness check during cold start, so a successful probe must mean that
  // /download can already enqueue work instead of briefly returning 503.
  startLocalServer()
  worklog('local_server_started', { port: LOCAL_SERVER_PORT })
  // Only the packaged app should claim URL schemes. Dev Electron from
  // node_modules would otherwise become the OS handler and open the generic
  // Electron splash when the extension triggers ytdl:// or vdownload:// wake.
  if (app.isPackaged) {
    app.setAsDefaultProtocolClient('ytdl')
    app.setAsDefaultProtocolClient('vdownload')
  }
  setupIpcHandlers()
  optimizer.registerFramelessWindowIpc()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()
  void initializeUpdater(mainWindow).catch(() => undefined)

  app.on('activate', () => {
    startLocalServer()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
      mainWindow.focus()
    } else {
      createWindow()
    }
  })
})

app.on('open-url', (event, url) => {
  event.preventDefault()
  if (isDeepLinkUrl(url)) {
    if (app.isReady()) {
      handleYtdlUrl(url)
    } else {
      pendingYtdlUrl.push(url)
    }
  }
})

app.on('second-instance', (_event, commandLine) => {
  startLocalServer()
  const deepLink = commandLine.find((arg) => isDeepLinkUrl(arg))
  if (deepLink) {
    handleYtdlUrl(deepLink)
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
  }
})

app.on('before-quit', (event) => {
  if (!isQuitting) { event.preventDefault(); void stopPoTokenServer().finally(() => app.quit()) }
  isQuitting = true
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    database.closeDB()
    stopLocalServer()
    app.quit()
  }
})
