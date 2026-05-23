import { ipcMain, clipboard, shell } from 'electron'
import { setCookieSyncRequested } from '../localServer'
import * as settings from '../settings'
import type { SettingsSchema } from '../settings'

const COOKIE_SYNC_LANDING = 'http://127.0.0.1:18765/cookie-sync-landing'

export function registerSettingsHandlers(): void {
  ipcMain.handle('get-settings', async () => {
    const all = settings.getAll()
    return { data: all }
  })

  ipcMain.handle('update-settings', async (_event, key: string, value: unknown) => {
    const all = settings.getAll()
    if (key in all) {
      settings.set(key as keyof SettingsSchema, value as never)
    }
    return { ok: true }
  })

  ipcMain.handle('read-clipboard', async () => {
    return clipboard.readText()
  })

  ipcMain.handle('request-browser-cookie-sync', async () => {
    setCookieSyncRequested(true)
    try {
      await shell.openExternal(COOKIE_SYNC_LANDING)
      return {
        ok: true,
        openedBrowser: true,
        landingUrl: COOKIE_SYNC_LANDING,
        message:
          'Opened the sync page in your default browser. If Chrome opened with the V-Download extension, cookies should save in a few seconds.',
      }
    } catch (err) {
      return {
        ok: true,
        openedBrowser: false,
        landingUrl: COOKIE_SYNC_LANDING,
        message: `Could not open your browser automatically. Open this URL in Chrome (with the V-Download extension): ${COOKIE_SYNC_LANDING}`,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  })
}
