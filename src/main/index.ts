import { app, BrowserWindow, protocol, Menu, screen } from 'electron'
import { join } from 'path'
import { optimizer, is } from '@electron-toolkit/utils'
import * as database from './database'
import * as downloadManager from './downloadManager'
import * as dockProgress from './dockProgress'
import { startPoTokenServer } from './poTokenServer'
import { startLocalServer, stopLocalServer, setDownloadHandler, setMediaDownloadHandler, DownloadRequest, LOCAL_SERVER_PORT } from './localServer'
import * as settings from './settings'
import { registerDownloadHandlers } from './ipc/downloads'
import { registerSettingsHandlers } from './ipc/settings'
import { registerWindowHandlers } from './ipc/window'
import { initWorklog, worklog } from './worklog'

app.setName('V-Download')

let mainWindow: BrowserWindow | null = null
let pendingYtdlUrl: string | null = null
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
  pendingYtdlUrl = launchUrl
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
      sandbox: false
    }
  })

  downloadManager.setMainWindow(mainWindow)

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

  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if ((input.meta || input.control) && input.key === 'w') {
      mainWindow?.hide()
    }
  })

  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingYtdlUrl && mainWindow && !mainWindow.isDestroyed()) {
      const pending = pendingYtdlUrl
      pendingYtdlUrl = null
      if (isWakeDeepLink(pending)) {
        mainWindow.show()
        mainWindow.focus()
        return
      }
      mainWindow.webContents.send('ytdl-url', pending)
    }
  })
}

function handleDownloadRequest(request: DownloadRequest): void {
  const params = new URLSearchParams({ url: request.url })
  if (request.type) params.set('type', request.type)
  if (request.referer) params.set('referer', request.referer)
  if (request.title) params.set('title', request.title)
  if (request.headers) params.set('headers', JSON.stringify(request.headers))
  const ytdlUrl = `ytdl://download?${params.toString()}`
  handleYtdlUrl(ytdlUrl)
}

function handleYtdlUrl(url: string): void {
  if (isWakeDeepLink(url)) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
      mainWindow.focus()
    }
    return
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
    mainWindow.webContents.send('ytdl-url', url)
  } else {
    pendingYtdlUrl = url
  }
}

function setupIpcHandlers(): void {
  registerDownloadHandlers()
  registerSettingsHandlers()
  registerWindowHandlers({
    getMainWindow: () => mainWindow
  })
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
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))

  dockProgress.init()

  database.initDB()
  downloadManager.loadFromDbAndRecover()
  startPoTokenServer()
  startLocalServer()
  worklog('local_server_started', { port: LOCAL_SERVER_PORT })
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
  })
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

  app.on('activate', () => {
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
      pendingYtdlUrl = url
    }
  }
})

app.on('second-instance', (_event, commandLine) => {
  const deepLink = commandLine.find((arg) => isDeepLinkUrl(arg))
  if (deepLink) {
    handleYtdlUrl(deepLink)
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
  }
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('window-all-closed', () => {
  database.closeDB()
  stopLocalServer()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
