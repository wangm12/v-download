import { spawn, type ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { createServer, request, type Server } from 'http'

export interface PoTokenProvider { baseUrl: string; extractorArgs: string; pluginDir: string }
export type PoTokenProviderStatus = 'ready' | 'unavailable'
export interface PoTokenProviderResult { status: PoTokenProviderStatus; provider?: PoTokenProvider; reason?: string }

const HOST = '127.0.0.1'
// bgutil-pot-provider-rs v0.8.x exposes `server` and GET /ping.
const STARTUP_TIMEOUT_MS = 2500
let child: ChildProcess | null = null
let reservation: Server | null = null
let port = 0
let startPromise: Promise<PoTokenProviderResult> | null = null
let restartUsed = false
let initialized = false
let activeResult: PoTokenProviderResult | null = null
let stopping = false

export function initializePoTokenServer(): void { initialized = true }

function providerPath(): string {
  if (process.env.V_DOWNLOAD_PO_TOKEN_PROVIDER) return process.env.V_DOWNLOAD_PO_TOKEN_PROVIDER
  const relative = join('engines', 'po-token', `darwin-${process.arch}`, process.platform === 'win32' ? 'bgutil-provider.exe' : 'bgutil-provider')
  const roots = [process.resourcesPath, join(process.cwd(), 'resources')].filter((root): root is string => Boolean(root))
  return roots.map((root) => join(root, relative)).find((candidate) => existsSync(candidate)) ?? join(roots[0] ?? join(process.cwd(), 'resources'), relative)
}

function pluginDir(): string {
  if (process.env.V_DOWNLOAD_PO_TOKEN_PLUGIN_DIR) {
    return existsSync(process.env.V_DOWNLOAD_PO_TOKEN_PLUGIN_DIR) ? process.env.V_DOWNLOAD_PO_TOKEN_PLUGIN_DIR : ''
  }
  const relative = join('engines', 'po-token', `darwin-${process.arch}`, 'yt_dlp_plugins')
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
  await closeReservation()
  port = 0
  if (!current) return
  await new Promise<void>((resolve) => {
    let done = false
    const finish = () => { if (!done) { done = true; resolve() } }
    current.once('close', finish)
    try { current.kill('SIGTERM') } catch { finish() }
    setTimeout(() => { try { current.kill('SIGKILL') } catch {} ; finish() }, 1000)
  })
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
  child = spawn(executable, ['server', '--host', HOST, '--port', String(port)], { stdio: 'ignore', windowsHide: true })
  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break
    if (await healthCheck()) return { status: 'ready', provider: { baseUrl: `http://${HOST}:${port}`, extractorArgs: `youtubepot-bgutilhttp:base_url=http://${HOST}:${port}`, pluginDir: plugins } }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  await cleanupChild()
  return { status: 'unavailable', reason: 'provider startup timeout or health failure' }
}

export function ensurePoTokenProvider(): Promise<PoTokenProviderResult> {
  if (activeResult?.status === 'ready' && child && child.exitCode === null) {
    return healthCheck().then(async (healthy) => {
      if (healthy) return activeResult!
      await cleanupChild(); activeResult = null
      if (!restartUsed) { restartUsed = true; const restartedResult = await startProvider(); if (restartedResult.status === 'ready') activeResult = restartedResult; return restartedResult }
      return { status: 'unavailable', reason: 'provider health check failed' }
    })
  }
  if (!startPromise) startPromise = startProvider().then(async (result) => {
    if (result.status === 'ready') activeResult = result
    if (result.status === 'unavailable' && existsSync(providerPath()) && !restartUsed) { restartUsed = true; const retry = await startProvider(); if (retry.status === 'ready') activeResult = retry; return retry }
    return result
  }).finally(() => { startPromise = null })
  return startPromise
}

export async function stopPoTokenServer(): Promise<void> {
  stopping = true
  const pending = startPromise
  if (pending) await pending.catch(() => undefined)
  await cleanupChild()
  activeResult = null; restartUsed = false; initialized = false; startPromise = null; stopping = false
}
