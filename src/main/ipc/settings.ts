import { ipcMain, clipboard } from 'electron'
import * as settings from '../settings'
import type { SettingsSchema } from '../settings'

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
}
