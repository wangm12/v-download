/**
 * Live Douyin cookies from the configured browser profile (yt-dlp extraction),
 * with extension-sync Netscape fallback.
 */
import { spawn } from 'child_process'
import { existsSync, readFileSync, statSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { buildCookieHeaderFromNetscapeFile, parseCookieMapFromNetscapeFile } from './douyinParseUtils'
import { resolvedCookiesBrowser } from './cookiesBrowser'
import { getYtdlpPath } from './ytdlp'
import * as settings from './settings'

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
  const scriptPath = extractScriptPath()
  if (!existsSync(scriptPath)) {
    console.log('[browserCookies] extract script not found:', scriptPath)
    return []
  }

  const ytdlpPath = getYtdlpPath(settings.get('ytdlpPath'))
  const python = readYtdlpShebangInterpreter(ytdlpPath) ?? 'python3'

  return new Promise((resolve) => {
    const proc = spawn(python, [scriptPath, browser], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d: Buffer) => {
      stdout += d.toString()
    })
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    proc.on('error', (err) => {
      console.log(`[browserCookies] spawn failed: ${err.message}`)
      resolve([])
    })
    proc.on('close', (code) => {
      if (code !== 0) {
        const msg = stderr.trim() || stdout.trim() || `exit ${code}`
        console.log(`[browserCookies] extract script failed: ${msg.slice(0, 200)}`)
        resolve([])
        return
      }
      try {
        const parsed = JSON.parse(stdout.trim()) as {
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
    })
  })
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
  const live = await spawnExtractScript(browser)
  if (live.length > 0) return live

  const path = cookiesFilePath?.trim() || settings.getCookiesPath()
  if (path && existsSync(path)) {
    const map = netscapeMapFromPath(path)
    if (map.size > 0) {
      return filterDouyinCookies(
        [...map.entries()].map(([name, value]) => ({
          name,
          value,
          domain: '.douyin.com',
          path: '/',
          secure: true,
          httpOnly: false,
          expires: -1,
        }))
      )
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

let cookieContextCache: { at: number; ctx: DouyinCookieContext } | null = null
const COOKIE_CONTEXT_TTL_MS = 4000

export async function resolveDouyinCookieContext(cookiesFilePath?: string): Promise<DouyinCookieContext> {
  const now = Date.now()
  if (cookieContextCache && now - cookieContextCache.at < COOKIE_CONTEXT_TTL_MS) {
    return cookieContextCache.ctx
  }

  const browser = resolvedCookiesBrowser()
  const live = await spawnExtractScript(browser)
  let ctx: DouyinCookieContext
  if (live.length > 0) {
    const map = cookiesToMap(live)
    ctx = { map, header: mapToHeader(map), source: 'browser' }
  } else {
    const path = cookiesFilePath?.trim() || settings.getCookiesPath()
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

  cookieContextCache = { at: now, ctx }
  return ctx
}
