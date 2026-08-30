import { ipcMain } from 'electron'
import { checkEngineUpdates, getEngineStatuses, updateEngine } from '../engineManager'

const ENGINE_NAMES = new Set(['yt-dlp', 'ffmpeg'])

export function registerEngineHandlers(): void {
  ipcMain.handle('get-engine-status', async () => {
    try {
      return { data: await getEngineStatuses() }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('check-engine-updates', async () => {
    try {
      return { data: await checkEngineUpdates() }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('update-engine', async (_event, name: string) => {
    if (!ENGINE_NAMES.has(name)) return { error: 'Unsupported engine' }
    try {
      return { data: await updateEngine(name as 'yt-dlp' | 'ffmpeg') }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })
}
