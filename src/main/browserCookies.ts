/**
 * Live Douyin cookies from the configured browser profile (yt-dlp extraction),
 * with extension-sync Netscape fallback.
 */
import type { ChildProcess } from 'child_process'
import { existsSync, readFileSync, statSync } from 'fs'
import { dirname, join } from 'path'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'
import { buildCookieHeaderFromNetscapeFile, parseCookieMapFromNetscapeFile, parseNetscapeCookiesFromFile } from './douyinParseUtils'
import { resolvedCookiesBrowser } from './cookiesBrowser'
import { getYtdlpPath } from './ytdlp'
import * as settings from './settings'
import { terminateDownloadProcess } from './downloadTypes'
import { spawnManagedProcess } from './managedChildProcesses'

export interface PlaywrightCookie {
  name: string
  value: string
  domain: string
  path: string
  expires: number
  httpOnly: boolean
  secure: boolean
  sameSite: 'Strict' | 'Lax' | 'None'
}

export interface DouyinCookieContext {
  map: Map<string, string>
  header: string | undefined
  source: 'browser' | 'netscape' | 'none'
}

const DOUYIN_DOMAIN_RE = /douyin|iesdouyin|byte|snssdk|aweme|toutiao/i
const COOKIE_EXTRACT_TIMEOUT_MS = 30_000
const COOKIE_EXTRACT_MAX_STDOUT_BYTES = 16 * 1024 * 1024
const COOKIE_EXTRACT_MAX_STDERR_BYTES = 64 * 1024
const COOKIE_FILE_MAX_BYTES = 16 * 1024 * 1024
const activeCookieProcesses = new Map<ChildProcess, { stop: () => void; done: Promise<void> }>()
let stoppingCookieProcesses = false
let stopCookieProcessesPromise: Promise<void> | null = null

const moduleDir = dirname(fileURLToPath(import.meta.url))

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function extractScriptPath(): string {
  const candidates = [
    join(moduleDir, '../../scripts/extract-douyin-browser-cookies.py'),
    join(process.cwd(), 'scripts/extract-douyin-browser-cookies.py'),
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return candidates[0]!
}

function readYtdlpShebangInterpreter(ytdlpPath: string): string | null {
  if (!existsSync(ytdlpPath)) return null
  try {
    const first = readFileSync(ytdlpPath, 'utf-8').split('\n')[0]?.trim()
    if (!first?.startsWith('#!')) return null
    const interp = first.slice(2).trim()
    if (!interp) return null
    if (interp.includes('python') && (existsSync(interp) || interp.startsWith('/'))) return interp
    return null
  } catch {
    return null
  }
}

interface RawExtractedCookie {
  name?: string
  value?: string
  domain?: string
  path?: string
  secure?: boolean
  httpOnly?: boolean
  expires?: number
}

function isDouyinDomain(domain: string): boolean {
  return DOUYIN_DOMAIN_RE.test(domain)
}

/** Filter + normalize cookies from Python JSON output. Exported for tests. */
export function filterDouyinCookies(raw: RawExtractedCookie[]): PlaywrightCookie[] {
  const out: PlaywrightCookie[] = []
  for (const c of raw) {
    const domain = (c.domain ?? '').trim()
    const name = (c.name ?? '').trim()
    const value = c.value ?? ''
    if (!domain || !name || !isDouyinDomain(domain)) continue
    out.push({
      name,
      value,
      domain: domain.startsWith('.') ? domain : `.${domain}`,
      path: c.path?.trim() || '/',
      expires: typeof c.expires === 'number' && c.expires > 0 ? c.expires : -1,
      httpOnly: Boolean(c.httpOnly),
      secure: Boolean(c.secure),
      sameSite: 'Lax',
    })
  }
  return out
}

function cookiesToMap(cookies: PlaywrightCookie[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const c of cookies) {
    map.set(c.name, c.value)
  }
  return map
}

function mapToHeader(map: Map<string, string>): string | undefined {
  if (map.size === 0) return undefined
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
}

function netscapeMapFromPath(cookiesFilePath: string | undefined): Map<string, string> {
  if (!cookiesFilePath?.trim()) return new Map()
  const rec = parseCookieMapFromNetscapeFile(cookiesFilePath.trim())
  return new Map(Object.entries(rec))
}

async function spawnExtractScript(browser: string): Promise<PlaywrightCookie[]> {
  if (stoppingCookieProcesses) return []
  const scriptPath = extractScriptPath()
  if (!existsSync(scriptPath)) {
    console.log('[browserCookies] extract script not found:', scriptPath)
    return []
  }

  const ytdlpPath = getYtdlpPath(settings.get('ytdlpPath'))
  const python = readYtdlpShebangInterpreter(ytdlpPath) ?? 'python3'

  return new Promise((resolve) => {
    const proc = spawnManagedProcess(python, [scriptPath, browser], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    })
    const stdout: Buffer[] = []
    let stdoutBytes = 0
    let stderr = ''
    let failure: Error | null = null
    let settled = false
    let termination: Promise<boolean> | null = null
    let processDone!: () => void
    const done = new Promise<void>((complete) => { processDone = complete })
    const fail = (error: Error) => {
      if (failure) return
      failure = error
      termination = terminateDownloadProcess(proc, true)
    }
    const timer = setTimeout(() => fail(new Error(`Cookie extraction timed out after ${COOKIE_EXTRACT_TIMEOUT_MS}ms`)), COOKIE_EXTRACT_TIMEOUT_MS)
    const finish = async (code: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (failure) {
        console.log(`[browserCookies] extract failed: ${failure.message.slice(0, 200)}`)
        resolve([])
        return
      }
      if (code !== 0) {
        const msg = stderr.trim() || `exit ${code}`
        console.log(`[browserCookies] extract script failed: ${msg.slice(0, 200)}`)
        resolve([])
        return
      }
      try {
        const parsed = JSON.parse(Buffer.concat(stdout, stdoutBytes).toString('utf8').trim()) as {
          ok?: boolean
          cookies?: RawExtractedCookie[]
          count?: number
          error?: string
        }
        if (!parsed.ok) {
          console.log(`[browserCookies] extract error: ${parsed.error ?? 'unknown'}`)
          resolve([])
          return
        }
        const filtered = filterDouyinCookies(parsed.cookies ?? [])
        console.log(`[browserCookies] live extract: ${filtered.length} Douyin cookies (browser=${browser})`)
        resolve(filtered)
      } catch (e) {
        console.log(`[browserCookies] parse failed: ${e instanceof Error ? e.message : String(e)}`)
        resolve([])
      }
    }
    activeCookieProcesses.set(proc, {
      stop: () => fail(new Error('Cookie extraction stopped during application shutdown')),
      done
    })
    proc.stdout!.on('data', (d: Buffer) => {
      stdoutBytes += d.length
      if (stdoutBytes > COOKIE_EXTRACT_MAX_STDOUT_BYTES) {
        fail(new Error(`Cookie extraction output exceeded ${COOKIE_EXTRACT_MAX_STDOUT_BYTES} bytes`))
        return
      }
      stdout.push(d)
    })
    proc.stderr!.on('data', (d: Buffer) => {
      stderr = `${stderr}${d.toString('utf8')}`.slice(-COOKIE_EXTRACT_MAX_STDERR_BYTES)
    })
    proc.on('error', (err) => {
      console.log(`[browserCookies] spawn failed: ${err.message}`)
      fail(err)
    })
    proc.once('close', async (code) => {
      if (termination && !(await termination)) {
        console.warn('[browserCookies] extraction process group still visible after cancellation')
      }
      activeCookieProcesses.delete(proc)
      processDone()
      await finish(code)
    })
  })
}

async function extractCookiesViaYtdlpCli(browser: string): Promise<PlaywrightCookie[]> {
  if (stoppingCookieProcesses) return []
  const ytdlpPath = getYtdlpPath(settings.get('ytdlpPath'))
  if (!ytdlpPath || !existsSync(ytdlpPath)) return []

  const tempCookieFile = join(tmpdir(), `vdl-cookies-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`)
  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawnManagedProcess(
        ytdlpPath,
        ['--cookies-from-browser', browser, '--cookies', tempCookieFile, '--skip-download', 'https://www.douyin.com'],
        { stdio: ['ignore', 'ignore', 'pipe'], detached: process.platform !== 'win32' }
      )
      let stderr = ''
      let failure: Error | null = null
      let termination: Promise<boolean> | null = null
      let processDone!: () => void
      const done = new Promise<void>((complete) => { processDone = complete })
      const fail = (error: Error) => {
        if (failure) return
        failure = error
        termination = terminateDownloadProcess(proc, true)
      }
      const timer = setTimeout(
        () => fail(new Error(`yt-dlp cookie export timed out after ${COOKIE_EXTRACT_TIMEOUT_MS}ms`)),
        COOKIE_EXTRACT_TIMEOUT_MS
      )
      activeCookieProcesses.set(proc, {
        stop: () => fail(new Error('yt-dlp cookie export stopped during application shutdown')),
        done
      })
      proc.stderr?.on('data', (d: Buffer) => {
        stderr = `${stderr}${d.toString('utf8')}`.slice(-COOKIE_EXTRACT_MAX_STDERR_BYTES)
      })
      proc.on('error', fail)
      proc.on('close', async (code) => {
        clearTimeout(timer)
        if (termination && !(await termination)) {
          console.warn('[browserCookies] yt-dlp cookie process group still visible after cancellation')
        }
        activeCookieProcesses.delete(proc)
        processDone()
        if (failure) {
          reject(failure)
          return
        }
        if (code === 0 && existsSync(tempCookieFile)) {
          resolve()
        } else {
          reject(new Error(`yt-dlp cookie export failed (${code}): ${stderr.slice(-200)}`))
        }
      })
    })

    if (existsSync(tempCookieFile)) {
      if (statSync(tempCookieFile).size > COOKIE_FILE_MAX_BYTES) {
        throw new Error(`yt-dlp cookie file exceeded ${COOKIE_FILE_MAX_BYTES} bytes`)
      }
      const content = readFileSync(tempCookieFile, 'utf-8')
      const cookies: RawExtractedCookie[] = []
      for (const line of content.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        const httpOnly = trimmed.startsWith('#HttpOnly_')
        if (trimmed.startsWith('#') && !httpOnly) continue
        const parts = (httpOnly ? trimmed.slice('#HttpOnly_'.length) : trimmed).split('\t')
        if (parts.length >= 7) {
          cookies.push({
            domain: parts[0],
            path: parts[2],
            secure: parts[3] === 'TRUE',
            expires: Number(parts[4]) || -1,
            name: parts[5],
            value: parts[6] ?? '',
            httpOnly,
          })
        }
      }
      const filtered = filterDouyinCookies(cookies)
      if (filtered.length > 0) {
        console.log(`[browserCookies] yt-dlp CLI extracted ${filtered.length} Douyin cookies (browser=${browser})`)
      }
      return filtered
    }
  } catch (err) {
    console.log(`[browserCookies] ytdlp CLI cookie export failed: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    try {
      if (existsSync(tempCookieFile)) {
        await (await import('node:fs/promises')).unlink(tempCookieFile)
      }
    } catch {
      /* ignore */
    }
  }
  return []
}

const liveCookieExtractionByBrowser = new Map<string, Promise<PlaywrightCookie[]>>()

async function extractLiveBrowserCookies(browser: string): Promise<PlaywrightCookie[]> {
  if (stoppingCookieProcesses) return []
  const pending = liveCookieExtractionByBrowser.get(browser)
  if (pending) return pending
  const extraction = (async () => {
    const fromScript = await spawnExtractScript(browser)
    return fromScript.length > 0 ? fromScript : extractCookiesViaYtdlpCli(browser)
  })()
  liveCookieExtractionByBrowser.set(browser, extraction)
  try {
    return await extraction
  } finally {
    if (liveCookieExtractionByBrowser.get(browser) === extraction) {
      liveCookieExtractionByBrowser.delete(browser)
    }
  }
}

/** Stop cookie helper subprocesses before application shutdown or database teardown. */
export function stopBrowserCookieProcesses(): Promise<void> {
  if (stopCookieProcessesPromise) return stopCookieProcessesPromise
  stoppingCookieProcesses = true
  const active = [...activeCookieProcesses.values()]
  for (const process of activeCookieProcesses.values()) process.stop()
  stopCookieProcessesPromise = Promise.allSettled(active.map((process) => process.done)).then(() => undefined)
  return stopCookieProcessesPromise
}

/** Poll cookies.txt mtime after extension sync (best-effort). */
export async function waitForNetscapeCookieRefresh(
  cookiesFilePath: string | undefined,
  timeoutMs = 8000
): Promise<boolean> {
  if (!cookiesFilePath?.trim() || !existsSync(cookiesFilePath.trim())) return false
  const abs = cookiesFilePath.trim()
  const startMtime = statSync(abs).mtimeMs
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await sleep(500)
    try {
      if (statSync(abs).mtimeMs > startMtime) return true
    } catch {
      /* ignore */
    }
  }
  return false
}

export async function readDouyinCookiesFromBrowser(
  cookiesFilePath?: string
): Promise<PlaywrightCookie[]> {
  const browser = resolvedCookiesBrowser()
  const live = await extractLiveBrowserCookies(browser)
  if (live.length > 0) return live

  const path = cookiesFilePath?.trim() || settings.getCookiesPath()
  if (path && existsSync(path)) {
    const netscapeCookies = parseNetscapeCookiesFromFile(path)
    if (netscapeCookies.length > 0) {
      return filterDouyinCookies(netscapeCookies)
    }
  }
  return []
}

export async function buildDouyinCookieMap(cookiesFilePath?: string): Promise<Map<string, string>> {
  const ctx = await resolveDouyinCookieContext(cookiesFilePath)
  return ctx.map
}

export async function buildDouyinCookieHeader(cookiesFilePath?: string): Promise<string | undefined> {
  const ctx = await resolveDouyinCookieContext(cookiesFilePath)
  return ctx.header
}

let cookieContextCache: { key: string; at: number; ctx: DouyinCookieContext } | null = null
const COOKIE_CONTEXT_TTL_MS = 4000

export async function resolveDouyinCookieContext(cookiesFilePath?: string): Promise<DouyinCookieContext> {
  const now = Date.now()
  const browser = resolvedCookiesBrowser()
  const fallbackPath = cookiesFilePath?.trim() || settings.getCookiesPath()
  const cacheKey = `${browser}\0${fallbackPath}`
  if (cookieContextCache?.key === cacheKey && now - cookieContextCache.at < COOKIE_CONTEXT_TTL_MS) {
    return cookieContextCache.ctx
  }

  const live = await extractLiveBrowserCookies(browser)
  let ctx: DouyinCookieContext
  if (live.length > 0) {
    const map = cookiesToMap(live)
    ctx = { map, header: mapToHeader(map), source: 'browser' }
  } else {
    const path = fallbackPath
    if (path && existsSync(path)) {
      const map = netscapeMapFromPath(path)
      const header = buildCookieHeaderFromNetscapeFile(path)
      if (map.size > 0) {
        console.log(`[browserCookies] using Netscape fallback (${map.size} cookies)`)
        ctx = { map, header: header || mapToHeader(map), source: 'netscape' }
      } else {
        ctx = { map: new Map(), header: undefined, source: 'none' }
      }
    } else {
      ctx = { map: new Map(), header: undefined, source: 'none' }
    }
  }

  cookieContextCache = { key: cacheKey, at: now, ctx }
  return ctx
}
