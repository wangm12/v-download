import { createServer, IncomingMessage, ServerResponse } from 'http'
import { app, BrowserWindow } from 'electron'
import { writeFileSync, mkdirSync, existsSync, chmodSync, readFileSync } from 'fs'
import { randomBytes } from 'crypto'
import { join } from 'path'
import { buildNetscapeCookieFile, type ChromeSyncedCookie } from '@v-download/shared'
import * as settings from './settings'
import { isAllowedOrigin, hasValidCapability, validateCookieRecord, validateDownloadPayload } from './securityValidation'

export const LOCAL_SERVER_PORT = 18765
let server: ReturnType<typeof createServer> | null = null

/** When true, Chrome extension should run syncCookies() (poll or cookie-sync-landing page). */
let cookieSyncRequested = false
const MAX_BODY_BYTES = 2 * 1024 * 1024
const MAX_COOKIES = 2000
const MAX_COOKIE_VALUE_BYTES = 16 * 1024
const ALLOWED_COOKIE_DOMAINS = new Set(['youtube.com', '.youtube.com', 'google.com', '.google.com', 'douyin.com', '.douyin.com', 'tiktok.com', '.tiktok.com', 'bilibili.com', '.bilibili.com', 'xiaohongshu.com', '.xiaohongshu.com', 'x.com', '.x.com'])
let pairingSecret = ''

function getPairingSecret(): string {
  if (pairingSecret) return pairingSecret
  const path = join(app.getPath('userData'), 'extension-pairing.secret')
  try { pairingSecret = readFileSync(path, 'utf8').trim() } catch { pairingSecret = randomBytes(32).toString('hex'); mkdirSync(app.getPath('userData'), { recursive: true }); writeFileSync(path, pairingSecret, { encoding: 'utf8', mode: 0o600 }); chmodSync(path, 0o600) }
  return pairingSecret
}

export function getExtensionPairingSecret(): string { return getPairingSecret() }

const originAllowed = (origin: string | undefined) => isAllowedOrigin(origin)

function authorized(req: IncomingMessage): boolean {
  const token = req.headers['x-vdownload-capability']
  if (typeof token !== 'string' || !originAllowed(req.headers.origin)) return false
  return hasValidCapability(token, getPairingSecret())
}

export function setCookieSyncRequested(value: boolean): void {
  cookieSyncRequested = value
}

function broadcastSettingsChanged(): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('settings-changed')
  }
}

function broadcastCookiesSynced(cookieCount: number): void {
  const payload = { count: cookieCount }
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('cookies-synced', payload)
  }
}

export interface DownloadRequest {
  url: string
  type?: string
  referer?: string
  headers?: Record<string, string>
  title?: string
}

type DownloadHandler = (request: DownloadRequest) => void
type MediaDownloadHandler = (request: DownloadRequest) => void
let onDownloadRequest: DownloadHandler | null = null
let onMediaDownloadRequest: MediaDownloadHandler | null = null

export function setDownloadHandler(handler: DownloadHandler): void {
  onDownloadRequest = handler
}

export function setMediaDownloadHandler(handler: MediaDownloadHandler): void {
  onMediaDownloadRequest = handler
}

function saveCookiesFile(cookies: ChromeSyncedCookie[]): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const cookiesPath = join(dir, 'cookies.txt')

  const content = buildNetscapeCookieFile(cookies, {
    headerNote: 'This file is auto-synced from Chrome via V-Download extension',
  })
  writeFileSync(cookiesPath, content, { encoding: 'utf-8', mode: 0o600 })
  chmodSync(cookiesPath, 0o600)

  settings.set('cookiesPath', cookiesPath)
  return cookiesPath
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    let size = 0
    req.on('data', (chunk) => { size += chunk.length; if (size > MAX_BODY_BYTES) { reject(new Error('Request body too large')); req.destroy() } else body += chunk })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function cors(res: ServerResponse, origin?: string): void {
  if (origin && originAllowed(origin)) res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-VDownload-Capability')
}

function json(res: ServerResponse, status: number, data: Record<string, unknown>): void {
  cors(res)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

export function startLocalServer(): void {
  if (server) return

  server = createServer(async (req, res) => {
    cors(res, req.headers.origin)

    if (req.method === 'OPTIONS') {
      if (!originAllowed(req.headers.origin)) { res.writeHead(403); res.end(); return }
      res.writeHead(204)
      res.end()
      return
    }

    const pathname = (req.url ?? '').split('?')[0] || '/'

    if (req.method === 'GET' && pathname === '/cookie-sync-poll') {
      if (!originAllowed(req.headers.origin)) { json(res, 403, { error: 'Extension origin required' }); return }
      json(res, 200, { pending: cookieSyncRequested, capability: getPairingSecret() })
      return
    }

    if (req.method === 'GET' && pathname === '/cookie-sync-landing') {
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>V-Download — cookie sync</title>
</head>
<body style="font-family:system-ui,-apple-system,sans-serif;padding:2rem;max-width:28rem;margin:0 auto;line-height:1.5;color:#111">
  <h1 style="font-size:1.125rem">V-Download cookie sync</h1>
  <p id="status">Connecting to the V-Download extension…</p>
  <p style="color:#555;font-size:0.875rem">Use <strong>Chrome</strong> with the V-Download extension. If this page does not update, leave Chrome open — sync also runs automatically within about a minute.</p>
</body>
</html>`
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html)
      return
    }

    if (req.method === 'POST' && pathname === '/cookies') {
      try {
        if (!authorized(req)) { json(res, 403, { error: 'Pairing required' }); return }
        const body = await readBody(req)
        const cookies = JSON.parse(body) as ChromeSyncedCookie[]
        if (!Array.isArray(cookies)) {
          json(res, 400, { error: 'Expected array of cookies' })
          return
        }
        if (cookies.length > MAX_COOKIES || cookies.some((c) => !validateCookieRecord(c))) { json(res, 400, { error: 'Invalid cookie payload' }); return }
        const path = saveCookiesFile(cookies)
        cookieSyncRequested = false
        console.log(`Cookies synced: ${cookies.length} cookies saved`)
        broadcastSettingsChanged()
        broadcastCookiesSynced(cookies.length)
        json(res, 200, { ok: true, count: cookies.length })
      } catch (_err) {
        json(res, 400, { error: 'Invalid cookie request' })
      }
      return
    }

    if (req.method === 'POST' && pathname === '/download') {
      try {
        if (!authorized(req)) { json(res, 403, { error: 'Pairing required' }); return }
        const body = await readBody(req)
        const checked = validateDownloadPayload(JSON.parse(body))
        if (!checked.ok) { json(res, 400, { error: checked.error }); return }
        const parsed = checked.value as unknown as DownloadRequest
        if (parsed.type && onMediaDownloadRequest) {
          onMediaDownloadRequest(parsed)
        } else if (!parsed.type && onDownloadRequest) {
          onDownloadRequest(parsed)
        } else { json(res, 503, { error: 'Download service unavailable' }); return }
        json(res, 200, { ok: true })
      } catch (_err) {
        json(res, 400, { error: 'Invalid download request' })
      }
      return
    }

    if (req.method === 'GET' && pathname === '/ping') {
      json(res, 200, { ok: true, app: 'yt-download' })
      return
    }

    json(res, 404, { error: 'Not found' })
  })

  server.listen(LOCAL_SERVER_PORT, '127.0.0.1', () => {
    console.log(`Local server listening on http://127.0.0.1:${LOCAL_SERVER_PORT}`)
  })

  server.on('error', (err) => {
    console.error('Local server error:', err)
  })
}

export function stopLocalServer(): void {
  if (server) {
    server.close()
    server = null
  }
}
