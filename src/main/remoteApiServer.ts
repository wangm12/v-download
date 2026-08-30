import { createServer } from 'node:http'
import { worklog, worklogError } from './worklog'
import * as settings from './settings'
import { createRemoteApiHttpHandler } from './remoteApiHttp'
import { createElectronRemoteJobBackend } from './remoteJobService'
import type { RemoteJobBackend } from './remoteApiHandler'

export const REMOTE_API_DEFAULT_PORT = 18766

let server: ReturnType<typeof createServer> | null = null
let listening: { bind: string; port: number } | null = null
let lastError: string | null = null
let lifecycle: Promise<void> = Promise.resolve()

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
  await new Promise<void>((resolve) => {
    current.close(() => resolve())
  })
  worklog('remote_api_stopped', {})
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
    created.once('error', (err) => {
      server = null
      listening = null
      lastError = err instanceof Error ? err.message : String(err)
      reject(err)
    })
    created.listen(port, bind, () => {
      const address = created.address()
      const actualPort = address && typeof address === 'object' ? address.port : port
      server = created
      listening = { bind, port: actualPort }
      lastError = null
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
