import { ipcMain } from 'electron'
import { getUpdaterStatus } from '../updater'

export function registerUpdaterHandlers(): void {
  ipcMain.handle('get-update-status', () => getUpdaterStatus())
}
