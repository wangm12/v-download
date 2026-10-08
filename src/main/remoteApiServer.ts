import { createServer } from 'node:http'
import { app, BrowserWindow, dialog } from 'electron'
import { worklog, worklogError } from './worklog'
import * as settings from './settings'
import { getUiLanguage } from './uiLanguage'
import { translate } from '../i18n/catalog'
import { createRemoteApiHttpHandler } from './remoteApiHttp'
import { createElectronRemoteJobBackend } from './remoteJobService'
import type { RemoteJobBackend } from './remoteApiHandler'

export const REMOTE_API_DEFAULT_PORT = 18766
const SERVER_CLOSE_GRACE_MS = 2500

let server: ReturnType<typeof createServer> | null = null
let listening: { bind: string; port: number } | null = null
let lastError: string | null = null
let lifecycle: Promise<void> = Promise.resolve()
const notifiedPortConflicts = new Set<string>()

function isAddressInUse(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === 'EADDRINUSE')
}

function notifyPortConflict(bind: string, port: number): void {
  const endpoint = `${bind}:${port}`
  if (notifiedPortConflicts.has(endpoint)) return
  notifiedPortConflicts.add(endpoint)
  if (notifiedPortConflicts.size > 32) {
    const oldest = notifiedPortConflicts.values().next().value as string | undefined
    if (oldest) notifiedPortConflicts.delete(oldest)
  }
  if (!app.isReady()) return

  try {
    const language = getUiLanguage()
    const options = {
      type: 'warning' as const,
      title: translate(language, 'prefs.remote.portConflictTitle'),
      message: translate(language, 'prefs.remote.portConflictMessage'),
      detail: translate(language, 'prefs.remote.portConflictDetail', { bind, port }),
      buttons: [translate(language, 'common.close')],
    }
    const owner = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed() && window.isVisible())
    const notification = owner
      ? dialog.showMessageBox(owner, options)
      : dialog.showMessageBox(options)
    void notification.catch(() => undefined)
  } catch (error) {
    worklogError('remote_api_port_conflict_notice_failed', error, { bind, port })
  }
}

function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const next = lifecycle.then(fn, fn)
  lifecycle = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

async function stopRemoteApiServerUnlocked(): Promise<void> {
  const current = server
  server = null
  listening = null
  if (!current) return
  await closeHttpServer(current)
  worklog('remote_api_stopped', {})
}

function closeHttpServer(current: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(forceCloseTimer)
      resolve()
    }
    const forceCloseTimer = setTimeout(() => {
      // Remote file/archive responses may be slow or held open by a client.
      // Reconfiguration and application shutdown must still have a deadline.
      current.closeAllConnections?.()
      finish()
    }, SERVER_CLOSE_GRACE_MS)

    try {
      current.close(() => finish())
      current.closeIdleConnections?.()
    } catch {
      finish()
    }
  })
}

async function startRemoteApiServerUnlocked(options?: {
  bind?: string
  port?: number
  backend?: RemoteJobBackend
}): Promise<{ bind: string; port: number }> {
  const bind = options?.bind ?? settings.get('remoteApiBind')
  const port = options?.port ?? settings.get('remoteApiPort')
  const backend = options?.backend ?? createElectronRemoteJobBackend()
  if (server && listening && listening.bind === bind && listening.port === port) {
    lastError = null
    return listening
  }
  await stopRemoteApiServerUnlocked()
  return new Promise((resolve, reject) => {
    const created = createServer(createRemoteApiHttpHandler(backend))
    created.headersTimeout = 15_000
    created.requestTimeout = 30_000
    created.keepAliveTimeout = 5_000
    created.once('error', (err) => {
      if (server === created) {
        server = null
        listening = null
      }
      if (!server || server === created) lastError = err instanceof Error ? err.message : String(err)
      if (isAddressInUse(err)) notifyPortConflict(bind, port)
      reject(err)
    })
    created.listen(port, bind, () => {
      const address = created.address()
      const actualPort = address && typeof address === 'object' ? address.port : port
      server = created
      listening = { bind, port: actualPort }
      lastError = null
      notifiedPortConflicts.clear()
      worklog('remote_api_started', { bind, port: actualPort })
      console.log(`Remote API listening on http://${bind}:${actualPort}`)
      resolve(listening)
    })
  })
}

export function startRemoteApiServer(options?: {
  bind?: string
  port?: number
  backend?: RemoteJobBackend
}): Promise<{ bind: string; port: number }> {
  return runExclusive(() => startRemoteApiServerUnlocked(options))
}

export function stopRemoteApiServer(): Promise<void> {
  return runExclusive(() => stopRemoteApiServerUnlocked())
}

export function getRemoteApiListenInfo(): { bind: string; port: number } | null {
  return listening
}

export function getRemoteApiLastError(): string | null {
  return lastError
}

export function syncRemoteApiServer(): void {
  void runExclusive(async () => {
    if (!settings.get('remoteApiEnabled') || !settings.get('remoteApiToken')) {
      await stopRemoteApiServerUnlocked()
      return
    }
    try {
      await startRemoteApiServerUnlocked()
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      worklogError('remote_api_start_failed', err)
      console.error('Failed to start remote API:', err)
    }
  })
}
