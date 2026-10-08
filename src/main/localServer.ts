import { createServer, IncomingMessage, ServerResponse } from 'http'
import { app, BrowserWindow, dialog } from 'electron'
import { writeFileSync, mkdirSync, existsSync, chmodSync, readFileSync, realpathSync, renameSync, unlinkSync } from 'fs'
import { randomBytes } from 'crypto'
import { dirname, join } from 'path'
import { buildNetscapeCookieFile, type ChromeSyncedCookie } from '@v-download/shared'
import * as settings from './settings'
import { resolveExtensionDir } from './extensionPath'
import { getUnpackedChromeExtensionId } from './extensionIdentity'
import { CHROME_EXTENSION_ID_PATTERN, filterValidCookieRecords, isAllowedOrigin, isAuthorizedExtensionRequest, validateDownloadPayload } from './securityValidation'
import { worklog, worklogError } from './worklog'
import { getUiLanguage } from './uiLanguage'
import { translate } from '../i18n/catalog'
import {
  completeDouyinProfileExtensionRequest,
  getDouyinProfileExtensionCommand,
} from './douyinProfileExtension'
import {
  acknowledgeDouyinResolveExtensionRequest,
  completeDouyinResolveExtensionRequest,
  getDouyinResolveExtensionCommand,
} from './douyinResolveExtension'

export const LOCAL_SERVER_PORT = 18765
let server: ReturnType<typeof createServer> | null = null

/** When true, Chrome extension should run syncCookies() (poll or cookie-sync-landing page). */
let cookieSyncRequested = false
const MAX_BODY_BYTES = 2 * 1024 * 1024
const MAX_COOKIES = 2000
let pairingSecret = ''
let portConflictNotified = false

function writePrivateFile(path: string, data: string | Buffer): void {
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  const tempPath = `${path}.${process.pid}.tmp`
  try {
    writeFileSync(tempPath, data, { encoding: 'utf8', mode: 0o600 })
    chmodSync(tempPath, 0o600)
    renameSync(tempPath, path)
    chmodSync(path, 0o600)
  } catch (error) {
    try { unlinkSync(tempPath) } catch { /* no partial secret or cookie file */ }
    throw error
  }
}

function readConfiguredExtensionIds(): ReadonlySet<string> {
  const ids = new Set<string>()
  const add = (value: unknown) => {
    if (typeof value === 'string' && CHROME_EXTENSION_ID_PATTERN.test(value.trim())) ids.add(value.trim())
  }
  const addExtensionPath = (extensionPath: string) => {
    add(getUnpackedChromeExtensionId(extensionPath))
    try { add(getUnpackedChromeExtensionId(realpathSync(extensionPath))) } catch { /* best effort */ }
  }
  add(process.env.CHROME_EXTENSION_ID)
  add(process.env.V_DOWNLOAD_EXTENSION_ID)
  try {
    const extensionPath = resolveExtensionDir()
    if (extensionPath) addExtensionPath(extensionPath)
  } catch {
    /* A development build may not have a resolvable extension folder yet. */
  }
  try {
    const configPath = join(process.resourcesPath, 'extension-config.json')
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as { extensionId?: unknown; chrome?: { extensionId?: unknown } }
    add(config.extensionId)
    add(config.chrome?.extensionId)
  } catch {
    /* A development build can use the explicit unpinned fallback below. */
  }
  return ids
}

const configuredExtensionIds = readConfiguredExtensionIds()
const forceExtensionAuth = process.env.V_DOWNLOAD_FORCE_EXTENSION_AUTH === '1'
const allowUnpinnedDevelopmentExtension =
  !forceExtensionAuth && !app.isPackaged && process.env.NODE_ENV !== 'production'

function getPairingSecret(): string {
  if (pairingSecret) return pairingSecret
  const path = join(app.getPath('userData'), 'extension-pairing.secret')
  try {
    pairingSecret = readFileSync(path, 'utf8').trim()
  } catch {
    pairingSecret = randomBytes(32).toString('hex')
    writePrivateFile(path, pairingSecret)
  }
  return pairingSecret
}

export function getExtensionPairingSecret(): string { return getPairingSecret() }

const originAllowed = (origin: string | undefined) => isAllowedOrigin(origin, {
  allowedExtensionIds: configuredExtensionIds,
  allowUnpinned: allowUnpinnedDevelopmentExtension,
})

function authorized(req: IncomingMessage): boolean {
  const token = req.headers['x-vdownload-capability']
  return isAuthorizedExtensionRequest(
    req.headers.origin,
    token,
    getPairingSecret(),
    { allowedExtensionIds: configuredExtensionIds, allowUnpinned: allowUnpinnedDevelopmentExtension }
  )
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
  quality?: string
  autoStart?: boolean
  referer?: string
  headers?: Record<string, string>
  title?: string
}

export interface DownloadDispatchResult {
  ok: boolean
  accepted?: boolean
  error?: string
}

type DownloadHandler = (request: DownloadRequest) => DownloadDispatchResult | void
type MediaDownloadHandler = (request: DownloadRequest) => DownloadDispatchResult | void
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
  writePrivateFile(cookiesPath, content)

  settings.set('cookiesPath', cookiesPath)
  return cookiesPath
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    req.on('data', (chunk) => {
      if (settled) return
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += bytes.length
      if (size > MAX_BODY_BYTES) {
        settled = true
        reject(Object.assign(new Error('Request body too large'), { code: 'payload_too_large' }))
        // Drain without retaining additional bytes so the client can receive the
        // explicit 413 response instead of a reset socket.
        req.resume()
        return
      }
      chunks.push(bytes)
    })
    req.on('end', () => {
      if (!settled) {
        settled = true
        resolve(Buffer.concat(chunks, size).toString('utf8'))
      }
    })
    req.on('error', (error) => {
      if (!settled) {
        settled = true
        reject(error)
      }
    })
    req.on('aborted', () => {
      if (!settled) {
        settled = true
        reject(new Error('Request body was aborted'))
      }
    })
  })
}

function respondRequestError(res: ServerResponse, error: unknown, fallback: string): void {
  const code = error && typeof error === 'object' && 'code' in error
    ? (error as { code?: unknown }).code
    : undefined
  if (code === 'payload_too_large') {
    json(res, 413, { error: 'Request body too large' })
    return
  }
  json(res, 400, { error: fallback })
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

  const created = createServer(async (req, res) => {
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

    if (req.method === 'GET' && pathname === '/douyin-profile-import-poll') {
      if (!authorized(req)) { json(res, 403, { error: 'Pairing required' }); return }
      const requestId = new URL(req.url ?? '/', `http://127.0.0.1:${LOCAL_SERVER_PORT}`).searchParams.get('requestId')?.trim() ?? ''
      if (!/^[a-f0-9]{20,80}$/i.test(requestId)) {
        json(res, 400, { error: 'Invalid profile import request' })
        return
      }
      const command = getDouyinProfileExtensionCommand(requestId)
      if (!command) {
        json(res, 404, { pending: false, error: 'Profile import request expired' })
        return
      }
      json(res, 200, { pending: true, ...command })
      return
    }

    if (req.method === 'POST' && pathname === '/douyin-profile-import-result') {
      try {
        if (!authorized(req)) { json(res, 403, { error: 'Pairing required' }); return }
        const body = await readBody(req)
        const accepted = completeDouyinProfileExtensionRequest(JSON.parse(body) as unknown)
        if (!accepted) {
          json(res, 404, { error: 'Profile import request expired' })
          return
        }
        json(res, 200, { ok: true })
      } catch (err) {
        respondRequestError(res, err, 'Invalid profile import result')
      }
      return
    }

    if (req.method === 'GET' && pathname === '/douyin-resolve-poll') {
      if (!authorized(req)) { json(res, 403, { error: 'Pairing required' }); return }
      const requestId = new URL(req.url ?? '/', `http://127.0.0.1:${LOCAL_SERVER_PORT}`).searchParams.get('requestId')?.trim() ?? ''
      if (!/^[a-f0-9]{20,80}$/i.test(requestId)) {
        json(res, 400, { error: 'Invalid Douyin resolve request' })
        return
      }
      const command = getDouyinResolveExtensionCommand(requestId)
      if (!command) {
        json(res, 404, { pending: false, error: 'Douyin resolve request expired' })
        return
      }
      json(res, 200, { pending: true, ...command })
      return
    }

    if (req.method === 'POST' && pathname === '/douyin-resolve-result') {
      try {
        if (!authorized(req)) { json(res, 403, { error: 'Pairing required' }); return }
        const body = await readBody(req)
        const accepted = completeDouyinResolveExtensionRequest(JSON.parse(body) as unknown)
        if (!accepted) {
          json(res, 404, { error: 'Douyin resolve request expired' })
          return
        }
        json(res, 200, { ok: true })
      } catch (err) {
        respondRequestError(res, err, 'Invalid Douyin resolve result')
      }
      return
    }

    if (req.method === 'POST' && pathname === '/douyin-resolve-ack') {
      try {
        if (!authorized(req)) { json(res, 403, { error: 'Pairing required' }); return }
        const body = await readBody(req)
        const accepted = acknowledgeDouyinResolveExtensionRequest(JSON.parse(body) as unknown)
        if (!accepted) {
          json(res, 404, { error: 'Douyin resolve request expired' })
          return
        }
        json(res, 200, { ok: true })
      } catch (err) {
        respondRequestError(res, err, 'Invalid Douyin resolve acknowledgement')
      }
      return
    }

    if (req.method === 'POST' && pathname === '/pair') {
      if (!originAllowed(req.headers.origin)) { json(res, 403, { error: 'Extension origin required' }); return }
      json(res, 200, { ok: true, capability: getPairingSecret() })
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

    if (req.method === 'GET' && pathname === '/douyin-profile-import-landing') {
      const requestId = new URL(req.url ?? '/', `http://127.0.0.1:${LOCAL_SERVER_PORT}`).searchParams.get('requestId')?.trim() ?? ''
      const command = /^[a-f0-9]{20,80}$/i.test(requestId)
        ? getDouyinProfileExtensionCommand(requestId)
        : null
      // Put the short-lived command in the app-owned bridge document. This
      // avoids a second extension → localhost request before Chrome has
      // restored its pairing token, while the result callback remains
      // authenticated by the normal extension capability check.
      const encodedCommand = command
        ? Buffer.from(JSON.stringify({ pending: true, ...command }), 'utf8').toString('base64')
        : ''
      const status = command
        ? 'Connecting to the V-Download extension…'
        : 'This V-Download profile import request has expired. Return to the app and start it again.'
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="vdownload-douyin-profile-import-command" content="${encodedCommand}" />
  <title>V-Download — Douyin profile import</title>
</head>
<body style="font-family:system-ui,-apple-system,sans-serif;padding:2rem;max-width:32rem;margin:0 auto;line-height:1.5;color:#111">
  <h1 style="font-size:1.125rem">V-Download — Douyin profile import</h1>
  <p id="status">${status}</p>
  <p style="color:#555;font-size:0.875rem">The extension will use your normal logged-in Douyin tab. No separate headless browser is started.</p>
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
        const cookies = JSON.parse(body) as unknown
        if (!Array.isArray(cookies)) {
          json(res, 400, { error: 'Expected array of cookies' })
          return
        }
        if (cookies.length > MAX_COOKIES) { json(res, 400, { error: 'Too many cookies' }); return }
        const { valid: validCookies, skipped } = filterValidCookieRecords(cookies)
        // An empty payload is a valid way to clear a previously synced jar,
        // but an all-invalid payload should never erase usable credentials.
        if (cookies.length > 0 && validCookies.length === 0) {
          json(res, 400, { error: 'No valid cookies to sync', skipped })
          return
        }
        const path = saveCookiesFile(validCookies)
        cookieSyncRequested = false
        console.log(`Cookies synced: ${validCookies.length} cookies saved${skipped ? `, ${skipped} skipped` : ''}`)
        broadcastSettingsChanged()
        broadcastCookiesSynced(validCookies.length)
        json(res, 200, { ok: true, count: validCookies.length, skipped })
      } catch (err) {
        respondRequestError(res, err, 'Invalid cookie request')
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
        const handler = parsed.type ? onMediaDownloadRequest : onDownloadRequest
        if (!handler) { json(res, 503, { error: 'Download service unavailable' }); return }
        const result = handler(parsed)
        const accepted = result?.accepted !== false && result?.ok !== false
        worklog('download_request', {
          mode: parsed.type ? 'media' : 'page',
          type: parsed.type || '',
          host: new URL(parsed.url).hostname,
          accepted
        })
        if (!accepted) {
          json(res, 503, { error: result?.error || 'Download request was not accepted' })
          return
        }
        json(res, 200, { ok: true, accepted: true })
      } catch (err) {
        worklogError('download_request_failed', err)
        respondRequestError(res, err, 'Invalid download request')
      }
      return
    }

    if (req.method === 'GET' && pathname === '/ping') {
      json(res, 200, { ok: true, app: 'yt-download' })
      return
    }

    json(res, 404, { error: 'Not found' })
  })

  created.headersTimeout = 15_000
  created.requestTimeout = 30_000
  created.keepAliveTimeout = 5_000
  server = created

  created.listen(LOCAL_SERVER_PORT, '127.0.0.1', () => {
    console.log(`Local server listening on http://127.0.0.1:${LOCAL_SERVER_PORT}`)
  })

  created.on('error', (err) => {
    if (server === created) server = null
    worklogError('local_server_error', err)
    console.error('Local server error:', err)
    const code = err && typeof err === 'object' && 'code' in err
      ? (err as NodeJS.ErrnoException).code
      : undefined
    if (code === 'EADDRINUSE' && !portConflictNotified) {
      portConflictNotified = true
      try {
        const language = getUiLanguage()
        const options = {
          type: 'warning' as const,
          title: translate(language, 'chromeCookie.localServerUnavailableTitle'),
          message: translate(language, 'chromeCookie.localServerUnavailableMessage'),
          detail: translate(language, 'chromeCookie.localServerUnavailableDetail', { port: LOCAL_SERVER_PORT }),
          buttons: [translate(language, 'common.close')],
        }
        const owner = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed() && window.isVisible())
        const notification = owner
          ? dialog.showMessageBox(owner, options)
          : dialog.showMessageBox(options)
        void notification.catch(() => undefined)
      } catch (noticeError) {
        worklogError('local_server_conflict_notice_failed', noticeError)
      }
    }
  })
}

export function stopLocalServer(graceMs = 2500): Promise<void> {
  const current = server
  server = null
  if (!current) return Promise.resolve()

  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(forceCloseTimer)
      resolve()
    }
    const forceCloseTimer = setTimeout(() => {
      current.closeAllConnections?.()
      finish()
    }, graceMs)
    forceCloseTimer.unref?.()

    try {
      current.close(() => finish())
      current.closeIdleConnections?.()
    } catch {
      finish()
    }
  })
}
