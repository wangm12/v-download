import { ipcMain, shell, dialog, BrowserWindow, nativeTheme } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { extractSecUidFromProfileUrl } from '../douyinProfile'
import {
  mapBrowserToOpenApp,
  mapBrowserToWinExecutable,
  resolvedCookiesBrowser,
} from '../cookiesBrowser'

const execFileAsync = promisify(execFile)

const WINDOW_BG_DARK = '#0B0B0B'
const WINDOW_BG_LIGHT = '#FFFFFF'

interface WindowContext {
  getMainWindow: () => BrowserWindow | null
}

export function registerWindowHandlers(ctx: WindowContext): void {
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

  ipcMain.handle('open-file-location', async (_event, path: string) => {
    try {
      shell.showItemInFolder(path)
      return { ok: true }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('open-file', async (_event, path: string) => {
    try {
      await shell.openPath(path)
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

  ipcMain.handle('close-window', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && win !== ctx.getMainWindow()) {
      win.close()
    }
  })

  ipcMain.handle('install-chrome-extension', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? ctx.getMainWindow() ?? undefined
    await dialog.showMessageBox(win!, {
      type: 'info',
      title: 'Install Chrome Extension',
      message: 'How to install the V-Download Chrome Extension',
      detail:
        '1. Open Chrome and go to chrome://extensions\n' +
        '2. Enable "Developer mode" (top right toggle)\n' +
        '3. Click "Load unpacked"\n' +
        '4. Select the extension folder from the V-Download app:\n\n' +
        '   Right-click V-Download.app → Show Package Contents → Contents → Resources → extension\n\n' +
        'Or if you cloned the repo, select the extension/ folder directly.',
      buttons: ['Open chrome://extensions', 'OK']
    }).then((result) => {
      if (result.response === 0) {
        shell.openExternal('https://chrome.google.com/extensions').catch(() => {
          shell.openExternal('chrome://extensions').catch(() => {})
        })
      }
    })
    return { ok: true }
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
