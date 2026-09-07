import { BrowserWindow } from 'electron'
import { join } from 'path'
import { COMPACT_HASH, compactLoadHash, compactWindowOptions } from './compactWindow'

let compactWindow: BrowserWindow | null = null

function getCompactWindow(): BrowserWindow | null {
  return compactWindow && !compactWindow.isDestroyed() ? compactWindow : null
}

export function closeCompactWindow(): void {
  if (compactWindow && !compactWindow.isDestroyed()) {
    compactWindow.close()
  }
  compactWindow = null
}

export function showCompactWindow(options: {
  preloadPath: string
  iconPath: string
  backgroundColor?: string
  devServerUrl?: string | null
}): BrowserWindow {
  const existing = getCompactWindow()
  if (existing) {
    existing.show()
    existing.focus()
    return existing
  }

  const win = new BrowserWindow({
    ...compactWindowOptions(),
    icon: options.iconPath,
    backgroundColor: options.backgroundColor ?? '#0B0B0B',
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  compactWindow = win
  win.setMenuBarVisibility(false)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  const hash = compactLoadHash()
  if (options.devServerUrl) {
    const base = options.devServerUrl.replace(/\/$/, '')
    void win.loadURL(`${base}/${hash}`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: COMPACT_HASH.replace(/^#/, '') })
  }

  win.on('closed', () => {
    if (compactWindow === win) compactWindow = null
  })
  win.show()
  win.focus()
  return win
}
