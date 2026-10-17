import { mutateDownloadPlanLibrary, allDownloadPlans, type DownloadPlanMutation } from '@v-download/shared'
import { isAbsolute } from 'path'
import { validateOutputTemplate } from '../outputTemplateModel'
import { ipcMain, clipboard, shell, BrowserWindow } from 'electron'
import { setCookieSyncRequested } from '../localServer'
import * as settings from '../settings'
import type { SettingsSchema } from '../settings'
import { syncRemoteApiServer } from '../remoteApiServer'
import { getMcpLogs } from '../remoteMcpModel'

const COOKIE_SYNC_LANDING = 'http://127.0.0.1:18765/cookie-sync-landing'

function broadcastSettingsChanged(): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('settings-changed')
  }
}

function settingWriteError(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error)
  return `Could not save settings: ${detail.slice(0, 240)}`
}

export function registerSettingsHandlers(): void {
  ipcMain.handle('get-download-plans', () => ({ data: settings.get('downloadPlanLibrary') }))
  ipcMain.handle('mutate-download-plan', (_event, mutation: DownloadPlanMutation) => {
    try {
      const library = mutateDownloadPlanLibrary(settings.get('downloadPlanLibrary'), mutation)
      for (const plan of allDownloadPlans(library)) {
        if (plan.outputDir && !isAbsolute(plan.outputDir)) throw new Error('Download plan folder must be an absolute path')
        if (plan.filenameTemplate && !validateOutputTemplate(plan.filenameTemplate, 'filename').ok) throw new Error('Invalid download plan filename template')
      }
      settings.set('downloadPlanLibrary', library)
      broadcastSettingsChanged()
      return { data: library }
    } catch (error) { return { error: settingWriteError(error) } }
  })

  ipcMain.handle('get-settings', async () => {
    const all = settings.getAll()
    return { data: all }
  })

  ipcMain.handle('update-settings', async (_event, key: string, value: unknown) => {
    const all = settings.getAll()
    const allowed = new Set<keyof SettingsSchema>(Object.keys(all).filter((k) => k !== 'cookiesPath' && k !== 'downloadPlanLibrary') as Array<keyof SettingsSchema>)
    if (allowed.has(key as keyof SettingsSchema) && settings.validateSettingUpdate(key, value)) {
      try {
        settings.set(key as keyof SettingsSchema, value as never)
      } catch (error) {
        return { ok: false, error: settingWriteError(error) }
      }
      if (String(key).startsWith('remoteApi')) syncRemoteApiServer()
      broadcastSettingsChanged()
      return { ok: true }
    }
    return { ok: false, error: 'Unsupported or protected setting' }
  })

  ipcMain.handle(
    'apply-download-speed-mode',
    async (_event, mode: 'balanced' | 'turbo' | 'gentle', options?: { acknowledgeTurboRisk?: boolean }) => {
      let result: ReturnType<typeof settings.applyDownloadSpeedMode>
      try {
        result = settings.applyDownloadSpeedMode(mode, {
          acknowledgeTurboRisk: Boolean(options?.acknowledgeTurboRisk)
        })
      } catch (error) {
        return { ok: false, error: settingWriteError(error) }
      }
      if (result === 'ok') broadcastSettingsChanged()
      return { ok: result === 'ok', error: result === 'turbo_ack_required' ? 'turbo_ack_required' : undefined }
    }
  )

  ipcMain.handle('read-clipboard', async () => {
    return clipboard.readText()
  })

  ipcMain.handle('get-remote-mcp-logs', async (_event, limit?: number) => {
    return { data: getMcpLogs(typeof limit === 'number' ? limit : 50) }
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
