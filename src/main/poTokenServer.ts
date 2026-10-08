import type { ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { createServer, request, type Server } from 'http'
import { terminateDownloadProcess } from './downloadTypes'
import { spawnManagedProcess } from './managedChildProcesses'

export interface PoTokenProvider { baseUrl: string; extractorArgs: string; pluginDir: string }
export type PoTokenProviderStatus = 'ready' | 'unavailable'
export interface PoTokenProviderResult { status: PoTokenProviderStatus; provider?: PoTokenProvider; reason?: string }

const HOST = '127.0.0.1'
// bgutil-pot-provider-rs v0.8.x exposes `server` and GET /ping.
const STARTUP_TIMEOUT_MS = 2500
let child: ChildProcess | null = null
let childClose: Promise<void> | null = null
let childError: Error | null = null
let reservation: Server | null = null
let port = 0
let ensurePromise: Promise<PoTokenProviderResult> | null = null
let restartUsed = false
let initialized = false
let activeResult: PoTokenProviderResult | null = null
let stopping = false

export function initializePoTokenServer(): void { initialized = true }

function providerPath(): string {
  if (process.env.V_DOWNLOAD_PO_TOKEN_PROVIDER) return process.env.V_DOWNLOAD_PO_TOKEN_PROVIDER
  const relative = join('engines', 'po-token', `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'bgutil-provider.exe' : 'bgutil-provider')
  const roots = [process.resourcesPath, join(process.cwd(), 'resources')].filter((root): root is string => Boolean(root))
  return roots.map((root) => join(root, relative)).find((candidate) => existsSync(candidate)) ?? join(roots[0] ?? join(process.cwd(), 'resources'), relative)
}

function pluginDir(): string {
  if (process.env.V_DOWNLOAD_PO_TOKEN_PLUGIN_DIR) {
    return existsSync(process.env.V_DOWNLOAD_PO_TOKEN_PLUGIN_DIR) ? process.env.V_DOWNLOAD_PO_TOKEN_PLUGIN_DIR : ''
  }
  const relative = join('engines', 'po-token', `${process.platform}-${process.arch}`, 'yt_dlp_plugins')
  const roots = [process.resourcesPath, join(process.cwd(), 'resources')].filter((root): root is string => Boolean(root))
  return roots.map((root) => join(root, relative)).find((candidate) => existsSync(candidate)) ?? ''
}

async function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    reservation = server
    server.once('error', reject)
    const forced = Number(process.env.V_DOWNLOAD_PO_TOKEN_PROVIDER_PORT ?? 0)
    server.listen(forced > 0 ? forced : 0, HOST, () => {
      const address = server.address()
      if (!address || typeof address === 'string') { reject(new Error('port reservation failed')); return }
      resolve(address.port)
    })
  })
}

async function closeReservation(): Promise<void> {
  const current = reservation
  reservation = null
  if (!current) return
  await new Promise<void>((resolve) => current.close(() => resolve()))
}

function healthCheck(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = request({ host: HOST, port, path: '/ping', method: 'GET', timeout: 350 }, (res) => {
      res.resume(); resolve(Boolean(res.statusCode && res.statusCode >= 200 && res.statusCode < 300))
    })
    req.once('error', () => resolve(false)); req.once('timeout', () => { req.destroy(); resolve(false) }); req.end()
  })
}

async function cleanupChild(): Promise<void> {
  const current = child; child = null
  const close = childClose
  childClose = null
  await closeReservation()
  port = 0
  if (!current) return
  const groupStopped = await terminateDownloadProcess(current, true)
  if (!groupStopped) console.warn('[po-token] provider process group remained visible after SIGKILL escalation')
  await close
}

async function startProvider(): Promise<PoTokenProviderResult> {
  if (stopping) return { status: 'unavailable', reason: 'provider shutdown requested' }
  if (!initialized) initializePoTokenServer()
  const executable = providerPath()
  if (!existsSync(executable)) return { status: 'unavailable', reason: 'provider resource is not installed' }
  const plugins = pluginDir()
  if (!plugins) return { status: 'unavailable', reason: 'provider plugin tree is not installed' }
  try { port = await reservePort(); await closeReservation() } catch { await cleanupChild(); return { status: 'unavailable', reason: 'no loopback port available' } }
  if (stopping) { await cleanupChild(); return { status: 'unavailable', reason: 'provider shutdown requested' } }
  child = spawnManagedProcess(executable, ['server', '--host', HOST, '--port', String(port)], {
    stdio: 'ignore',
    windowsHide: true,
    detached: process.platform !== 'win32'
  })
  const spawned = child
  childError = null
  childClose = new Promise<void>((resolve) => spawned.once('close', () => resolve()))
  spawned.on('error', (error) => { childError = error })
  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (childError || child.exitCode !== null) break
    if (await healthCheck()) return { status: 'ready', provider: { baseUrl: `http://${HOST}:${port}`, extractorArgs: `youtubepot-bgutilhttp:base_url=http://${HOST}:${port}`, pluginDir: plugins } }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  await cleanupChild()
  return { status: 'unavailable', reason: 'provider startup timeout or health failure' }
}

export function ensurePoTokenProvider(): Promise<PoTokenProviderResult> {
  if (stopping) return Promise.resolve({ status: 'unavailable', reason: 'provider shutdown requested' })
  if (!ensurePromise) ensurePromise = (async (): Promise<PoTokenProviderResult> => {
    const unavailableForShutdown = (): PoTokenProviderResult => ({ status: 'unavailable', reason: 'provider shutdown requested' })
    const currentResult = activeResult
    const currentChild = child

    if (currentResult?.status === 'ready' && currentChild && currentChild.exitCode === null) {
      const healthy = await healthCheck()
      if (stopping) return unavailableForShutdown()
      if (child !== currentChild || activeResult !== currentResult) {
        return activeResult ?? { status: 'unavailable', reason: 'provider changed during health check' }
      }
      if (healthy) return currentResult

      await cleanupChild()
      activeResult = null
      if (stopping) return unavailableForShutdown()
      if (restartUsed) return { status: 'unavailable', reason: 'provider health check failed' }
      restartUsed = true
    } else {
      // A child that exited between requests must be reaped before a replacement
      // reserves a new port or updates the active provider result. Clear a stale
      // ready result too, including the unlikely case where child was already null.
      if (currentChild) await cleanupChild()
      activeResult = null
      if (stopping) return unavailableForShutdown()
    }

    let result = await startProvider()
    if (stopping) {
      await cleanupChild()
      activeResult = null
      return unavailableForShutdown()
    }

    if (result.status === 'unavailable' && existsSync(providerPath()) && !restartUsed) {
      restartUsed = true
      result = await startProvider()
      if (stopping) {
        await cleanupChild()
        activeResult = null
        return unavailableForShutdown()
      }
    }

    if (result.status === 'ready' && child && child.exitCode === null) activeResult = result
    else if (result.status === 'ready') result = { status: 'unavailable', reason: 'provider exited during startup' }
    return result
  })().finally(() => { ensurePromise = null })
  return ensurePromise!
}

export async function stopPoTokenServer(): Promise<void> {
  stopping = true
  const pending = ensurePromise
  if (pending) await pending.catch(() => undefined)
  await cleanupChild()
  activeResult = null
  initialized = false
}
