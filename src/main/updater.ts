import { app, BrowserWindow } from 'electron'

export type UpdateState = 'disabled' | 'idle' | 'checking' | 'available' | 'downloaded' | 'error'

export interface UpdaterStatus {
  state: UpdateState
  version?: string
  error?: string
}

const PROVIDER_URL_ENV = 'VDOWNLOAD_UPDATE_PROVIDER_URL'
const UPDATE_URL_ENV = 'VDOWNLOAD_UPDATE_URL'
let status: UpdaterStatus = { state: 'disabled' }
let initialized = false

function configuredProviderUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = (env[PROVIDER_URL_ENV] ?? env[UPDATE_URL_ENV] ?? '').trim()
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

export function getUpdaterConfig(env: NodeJS.ProcessEnv = process.env): { providerUrl: string } | null {
  const providerUrl = configuredProviderUrl(env)
  return providerUrl ? { providerUrl } : null
}

export function getUpdaterStatus(): UpdaterStatus {
  return { ...status }
}

function publishStatus(next: UpdaterStatus, window?: BrowserWindow | null): void {
  status = next
  if (window && !window.isDestroyed()) window.webContents.send('update-status', getUpdaterStatus())
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Update check failed'
  return message.replace(/https?:\/\/[^\s]+/gi, '[redacted-url]').slice(0, 240)
}

export async function initializeUpdater(window: BrowserWindow | null): Promise<boolean> {
  if (initialized || !app.isPackaged) return false
  const config = getUpdaterConfig()
  if (!config) return false
  initialized = true
  try {
    const { autoUpdater } = await import('electron-updater')
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.setFeedURL({ provider: 'generic', url: config.providerUrl })
    autoUpdater.on('checking-for-update', () => publishStatus({ state: 'checking' }, window))
    autoUpdater.on('update-available', (info) => publishStatus({ state: 'available', version: info.version }, window))
    autoUpdater.on('update-downloaded', (info) => publishStatus({ state: 'downloaded', version: info.version }, window))
    autoUpdater.on('error', (error) => publishStatus({ state: 'error', error: safeError(error) }, window))
    publishStatus({ state: 'idle' }, window)
    await autoUpdater.checkForUpdates()
    return true
  } catch (error) {
    publishStatus({ state: 'error', error: safeError(error) }, window)
    return false
  }
}
