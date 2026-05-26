import { createServer, IncomingMessage, ServerResponse } from 'http'
import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { buildNetscapeCookieFile, type ChromeSyncedCookie } from '@v-download/shared'
import * as settings from './settings'

const PORT = 18765
let server: ReturnType<typeof createServer> | null = null

/** When true, Chrome extension should run syncCookies() (poll or cookie-sync-landing page). */
let cookieSyncRequested = false

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
  writeFileSync(cookiesPath, content, 'utf-8')

  settings.set('cookiesPath', cookiesPath)
  return cookiesPath
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function cors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function json(res: ServerResponse, status: number, data: Record<string, unknown>): void {
  cors(res)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

export function startLocalServer(): void {
  if (server) return

  server = createServer(async (req, res) => {
    cors(res)

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const pathname = (req.url ?? '').split('?')[0] || '/'

    if (req.method === 'GET' && pathname === '/cookie-sync-poll') {
      json(res, 200, { pending: cookieSyncRequested })
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
        const body = await readBody(req)
        const cookies = JSON.parse(body) as ChromeSyncedCookie[]
        if (!Array.isArray(cookies)) {
          json(res, 400, { error: 'Expected array of cookies' })
          return
        }
        const path = saveCookiesFile(cookies)
        cookieSyncRequested = false
        console.log(`Cookies synced: ${cookies.length} cookies saved to ${path}`)
        broadcastSettingsChanged()
        broadcastCookiesSynced(cookies.length)
        json(res, 200, { ok: true, count: cookies.length, path })
      } catch (err) {
        json(res, 500, { error: String(err) })
      }
      return
    }

    if (req.method === 'POST' && pathname === '/download') {
      try {
        const body = await readBody(req)
        const parsed = JSON.parse(body) as DownloadRequest
        if (!parsed.url) {
          json(res, 400, { error: 'Missing url' })
          return
        }
        console.log(
          `[localServer] POST /download type=${parsed.type ?? '(page)'} urlLen=${parsed.url.length} title=${(parsed.title || '').slice(0, 40)}`
        )
        if (parsed.type && onMediaDownloadRequest) {
          onMediaDownloadRequest(parsed)
        } else if (onDownloadRequest) {
          onDownloadRequest(parsed)
        }
        json(res, 200, { ok: true, url: parsed.url })
      } catch (err) {
        json(res, 500, { error: String(err) })
      }
      return
    }

    if (req.method === 'GET' && pathname === '/ping') {
      json(res, 200, { ok: true, app: 'yt-download' })
      return
    }

    json(res, 404, { error: 'Not found' })
  })

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Local server listening on http://127.0.0.1:${PORT}`)
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
