import { ipcMain, shell, dialog, BrowserWindow, nativeTheme } from 'electron'

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
}
