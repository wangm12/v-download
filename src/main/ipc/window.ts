import { app, ipcMain, shell, dialog, BrowserWindow, nativeTheme } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync, statSync, realpathSync } from 'fs'
import { resolve, relative } from 'path'
import * as settings from '../settings'
import { extractSecUidFromProfileUrl } from '../douyinProfile'
import { resolveExtensionDir } from '../extensionPath'
import {
  mapBrowserToOpenApp,
  mapBrowserToWinExecutable,
  resolvedCookiesBrowser,
} from '../cookiesBrowser'

const execFileAsync = promisify(execFile)

const CHROME_EXTENSIONS_URL = 'chrome://extensions'

async function openChromeExtensionsPage(): Promise<boolean> {
  const browser = resolvedCookiesBrowser()
  try {
    if (process.platform === 'darwin') {
      const appName = mapBrowserToOpenApp(browser) || 'Google Chrome'
      await execFileAsync('open', ['-a', appName, CHROME_EXTENSIONS_URL])
      return true
    }
    if (process.platform === 'win32') {
      const exe = mapBrowserToWinExecutable(browser)
      if (exe) {
        await execFileAsync(exe, [CHROME_EXTENSIONS_URL])
        return true
      }
    }
    await shell.openExternal(CHROME_EXTENSIONS_URL)
    return true
  } catch {
    try {
      await shell.openExternal(CHROME_EXTENSIONS_URL)
      return true
    } catch {
      return false
    }
  }
}

const WINDOW_BG_DARK = '#0B0B0B'
const WINDOW_BG_LIGHT = '#FFFFFF'

interface WindowContext {
  getMainWindow: () => BrowserWindow | null
}

export function registerWindowHandlers(ctx: WindowContext): void {
  ipcMain.handle('get-app-version', () => app.getVersion())

  const safeDownloadPath = (candidate: unknown): string | null => {
    if (typeof candidate !== 'string' || candidate.length === 0 || candidate.length > 4096 || !existsSync(candidate)) return null
    try {
      const file = realpathSync(candidate); const root = realpathSync(settings.get('downloadDir'))
      const rel = relative(root, file)
      if (!statSync(file).isFile() || rel.startsWith('..') || resolve(root, rel) !== file) return null
      return file
    } catch { return null }
  }
  ipcMain.handle('set-native-theme-source', (_event, source: unknown) => {
    if (source !== 'dark' && source !== 'light' && source !== 'system') {
      return { ok: false as const, error: 'invalid theme source' }
    }
    nativeTheme.themeSource = source
    const win = ctx.getMainWindow()
    if (win && !win.isDestroyed()) {
      const useDark =
        source === 'dark' ? true : source === 'light' ? false : nativeTheme.shouldUseDarkColors
      win.setBackgroundColor(useDark ? WINDOW_BG_DARK : WINDOW_BG_LIGHT)
    }
    return { ok: true as const }
  })

  nativeTheme.on('updated', () => {
    if (nativeTheme.themeSource !== 'system') return
    const win = ctx.getMainWindow()
    if (win && !win.isDestroyed()) {
      win.setBackgroundColor(nativeTheme.shouldUseDarkColors ? WINDOW_BG_DARK : WINDOW_BG_LIGHT)
    }
  })

  ipcMain.handle('open-file-location', async (_event, path: unknown) => {
    try {
      const safePath = safeDownloadPath(path); if (!safePath) return { ok: false, error: 'File is outside the download folder' }
      shell.showItemInFolder(safePath)
      return { ok: true }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('open-file', async (_event, path: unknown) => {
    try {
      const safePath = safeDownloadPath(path); if (!safePath) return { ok: false, error: 'File is outside the download folder' }
      await shell.openPath(safePath)
      return { ok: true }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('select-download-folder', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? ctx.getMainWindow() ?? undefined
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory'],
      title: 'Select Download Location'
    })
    if (!result.canceled && result.filePaths[0]) {
      return result.filePaths[0]
    }
    return undefined
  })

  ipcMain.handle('open-settings', async () => {
    const mainWindow = ctx.getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
      mainWindow.focus()
      mainWindow.webContents.send('open-preferences')
    }
  })

  ipcMain.handle('get-chrome-extension-path', async () => {
    const path = resolveExtensionDir()
    return { ok: !!path, path: path ?? undefined }
  })

  ipcMain.handle('install-chrome-extension', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? ctx.getMainWindow() ?? undefined
    const extensionPath = resolveExtensionDir()
    if (!extensionPath) {
      await dialog.showMessageBox(win!, {
        type: 'error',
        title: 'Extension not found',
        message: 'Could not locate the V-Download extension folder',
        detail:
          'If you built from source, ensure the extension/ folder exists next to the app.\n\n' +
          'In a packaged app it should be at:\n' +
          'V-Download.app → Contents → Resources → extension',
        buttons: ['OK'],
      })
      return { ok: false, error: 'Extension folder not found' }
    }

    const openedFolder = (await shell.openPath(extensionPath)) === ''
    const openedChrome = await openChromeExtensionsPage()

    const chromeHint = openedChrome
      ? 'Chrome Extensions should have opened.'
      : `Open ${CHROME_EXTENSIONS_URL} in Chrome manually.`

    const result = await dialog.showMessageBox(win!, {
      type: 'info',
      title: 'Install Chrome Extension',
      message: 'Extension folder ready — load it in Chrome',
      detail:
        `1. In Chrome, enable Developer mode (top right)\n` +
        `2. Click "Load unpacked"\n` +
        `3. Select this folder:\n\n${extensionPath}\n\n` +
        chromeHint,
      buttons: openedFolder ? ['Open folder again', 'OK'] : ['OK'],
      defaultId: openedFolder ? 1 : 0,
      cancelId: openedFolder ? 1 : 0,
    })

    if (openedFolder && result.response === 0) {
      await shell.openPath(extensionPath)
    }

    return {
      ok: true,
      path: extensionPath,
      openedFolder,
      openedChrome,
    }
  })

  ipcMain.handle('open-external-url', async (_event, url: unknown) => {
    try {
      const parsed = new URL(String(url ?? ''))
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { ok: false, error: 'Invalid URL' }
      }
      await shell.openExternal(parsed.toString())
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('open-douyin-profile-url', async (_event, profileUrl: unknown) => {
    if (typeof profileUrl !== 'string' || !profileUrl.trim()) {
      return { ok: false, error: 'Invalid profile URL' }
    }
    const url = profileUrl.trim()
    const secUid = extractSecUidFromProfileUrl(url)
    if (!secUid) {
      return { ok: false, error: 'Not a valid Douyin profile URL' }
    }
    try {
      const parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`)
      const host = parsed.hostname.toLowerCase()
      if (host !== 'douyin.com' && !host.endsWith('.douyin.com')) {
        return { ok: false, error: 'URL host not allowed' }
      }
      if (!/\/user\//.test(parsed.pathname)) {
        return { ok: false, error: 'URL path not allowed' }
      }
      const canonical = `https://www.douyin.com/user/${secUid}`
      const browser = resolvedCookiesBrowser()
      const appName = mapBrowserToOpenApp(browser)

      if (process.platform === 'darwin' && appName) {
        await execFileAsync('open', ['-a', appName, canonical])
        return { ok: true, openedIn: appName, url: canonical }
      }

      if (process.platform === 'win32') {
        const exe = mapBrowserToWinExecutable(browser)
        if (exe) {
          await execFileAsync(exe, [canonical])
          return { ok: true, openedIn: browser, url: canonical }
        }
      }

      await shell.openExternal(canonical)
      return { ok: true, openedIn: 'default', url: canonical }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
