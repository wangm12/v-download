import { randomBytes } from 'crypto'
import { readFileSync, realpathSync } from 'fs'
import { join } from 'path'
import type { DouyinMediaResult } from './douyin'
import { getUnpackedChromeExtensionId } from './extensionIdentity'
import { resolveExtensionDir } from './extensionPath'
import { openUrlInConfiguredBrowser } from './openUrlInBrowser'

/**
 * One-shot bridge between the desktop resolver and the user's logged-in
 * Douyin tab. Signed media URLs stay in memory only; the download database
 * continues to persist the original page URL and safe task metadata.
 */
export interface DouyinResolveExtensionCommand {
  requestId: string
  url: string
  awemeId: string
}

export type DouyinExtensionResolveState = 'resolved' | 'unavailable' | 'no-media'

export interface DouyinExtensionResolveAttempt {
  state: DouyinExtensionResolveState
  result: DouyinMediaResult | null
  error?: string
}

interface ExtensionAck {
  ok: boolean
  error?: string
}

interface PendingResolveResult {
  result: DouyinMediaResult | null
  error?: string
}

interface PendingRequest {
  command: DouyinResolveExtensionCommand
  resolveResult: (value: PendingResolveResult) => void
  resolveAck: (value: ExtensionAck) => void
  resultTimer: ReturnType<typeof setTimeout> | null
  ackTimer: ReturnType<typeof setTimeout>
}

/**
 * Chrome can take several seconds to wake a just-reloaded extension worker,
 * restore its loopback pairing, and then dispatch a page. Keep this bounded,
 * but do not expire the request before that cold-start path can respond.
 */
export const EXTENSION_RESOLVE_ACK_TIMEOUT_MS = 15_000
/** Once dispatch has been acknowledged, give the active Douyin page its own result window. */
export const EXTENSION_RESOLVE_RESULT_TIMEOUT_MS = 20_000

const REQUEST_ID_RE = /^[a-f0-9]{20,80}$/i
const EXTENSION_ID_RE = /^[a-p]{32}$/
const MAX_URL_LENGTH = 8192
const pending = new Map<string, PendingRequest>()

function safeHttpUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > MAX_URL_LENGTH) return ''
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    return url.toString()
  } catch {
    return ''
  }
}

function shortError(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const text = value.replace(/[\r\n]+/g, ' ').trim()
  return text ? text.slice(0, 360) : fallback
}

function isDouyinUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase()
    return host === 'douyin.com' || host.endsWith('.douyin.com') || host === 'iesdouyin.com' || host.endsWith('.iesdouyin.com')
  } catch {
    return false
  }
}

function extractAwemeId(value: string): string {
  try {
    const url = new URL(value)
    const match = url.pathname.match(/\/(?:note|video|gallery|share\/(?:note|video))\/(\d{10,32})/i)
    return match?.[1] ?? ''
  } catch {
    return ''
  }
}

function normalizeMediaUrl(value: unknown): string {
  const url = safeHttpUrl(value)
  return url && /^https?:\/\//i.test(url) ? url : ''
}

function normalizeResult(raw: unknown): PendingResolveResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { result: null, error: 'Chrome returned an invalid Douyin resolve response.' }
  }
  const payload = raw as Record<string, unknown>
  if (payload.ok !== true) {
    return {
      result: null,
      error: shortError(payload.error, 'Chrome could not read media information from this Douyin page.')
    }
  }

  const id = String(payload.awemeId ?? '').trim()
  if (!/^\d{10,32}$/.test(id)) {
    return { result: null, error: 'Chrome returned a Douyin item with an invalid ID.' }
  }
  const title = String(payload.title ?? '').trim().slice(0, 200) || `Douyin ${id}`
  const author = String(payload.author ?? '').trim().slice(0, 120)
  const cover = normalizeMediaUrl(payload.cover)
  const imageUrls = Array.isArray(payload.imageUrls)
    ? Array.from(new Set(payload.imageUrls.map(normalizeMediaUrl).filter(Boolean))).slice(0, 200)
    : []

  if (imageUrls.length > 0 || payload.mediaType === 'gallery') {
    if (imageUrls.length === 0) {
      return { result: null, error: 'Chrome identified a Douyin gallery but found no downloadable media.' }
    }
    return {
      result: {
        kind: 'gallery',
        id,
        title,
        author,
        cover: cover || imageUrls[0]!,
        imageUrls,
      }
    }
  }

  const videoUrl = normalizeMediaUrl(payload.videoUrl)
  if (!videoUrl) {
    return { result: null, error: 'Chrome found the Douyin page but no playable video URL.' }
  }
  const videoUrlFallbacks = Array.isArray(payload.videoUrlFallbacks)
    ? Array.from(new Set(payload.videoUrlFallbacks.map(normalizeMediaUrl).filter((url) => url && url !== videoUrl))).slice(0, 8)
    : []
  const duration = Number(payload.duration)
  return {
    result: {
      kind: 'video',
      id,
      title,
      author,
      videoUrl,
      ...(videoUrlFallbacks.length ? { videoUrlFallbacks } : {}),
      duration: Number.isFinite(duration) && duration > 0 ? Math.floor(duration) : 0,
      cover,
    }
  }
}

function clearPending(requestId: string): PendingRequest | null {
  const current = pending.get(requestId)
  if (!current) return null
  if (current.resultTimer) clearTimeout(current.resultTimer)
  clearTimeout(current.ackTimer)
  pending.delete(requestId)
  return current
}

function startResultTimer(requestId: string): void {
  const current = pending.get(requestId)
  if (!current || current.resultTimer) return
  current.resultTimer = setTimeout(() => {
    settleResult(requestId, {
      result: null,
      error: 'V-Download Chrome extension opened the Douyin page but did not return media information in time.'
    })
  }, EXTENSION_RESOLVE_RESULT_TIMEOUT_MS)
}

function settleResult(requestId: string, value: PendingResolveResult): boolean {
  const current = clearPending(requestId)
  if (!current) return false
  current.resolveAck({ ok: true })
  current.resolveResult(value)
  return true
}

function cancelPending(requestId: string, error: string): boolean {
  const current = clearPending(requestId)
  if (!current) return false
  current.resolveAck({ ok: false, error })
  current.resolveResult({ result: null, error })
  return true
}

function configuredExtensionId(): string | null {
  const supplied = [process.env.CHROME_EXTENSION_ID, process.env.V_DOWNLOAD_EXTENSION_ID]
    .map((value) => String(value ?? '').trim())
    .find((value) => EXTENSION_ID_RE.test(value))
  if (supplied) return supplied

  try {
    const configPath = join(process.resourcesPath, 'extension-config.json')
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as { extensionId?: unknown; chrome?: { extensionId?: unknown } }
    const configured = [config.extensionId, config.chrome?.extensionId]
      .map((value) => String(value ?? '').trim())
      .find((value) => EXTENSION_ID_RE.test(value))
    if (configured) return configured
  } catch {
    /* Development builds normally use the unpacked folder identity below. */
  }

  const extensionDir = resolveExtensionDir()
  if (!extensionDir) return null
  const candidates = [extensionDir]
  try { candidates.push(realpathSync(extensionDir)) } catch { /* best effort */ }
  for (const path of candidates) {
    const id = getUnpackedChromeExtensionId(path)
    if (EXTENSION_ID_RE.test(id)) return id
  }
  return null
}

function resolverPageUrl(command: DouyinResolveExtensionCommand): string | null {
  const extensionId = configuredExtensionId()
  if (!extensionId) return null
  // The command contains only the public page URL, immutable item ID, and an
  // unguessable one-shot request ID. Carrying it in the internal extension
  // page avoids a second extension → localhost poll, which can be delayed or
  // rejected while Chrome is restoring a service worker after a reload.
  const encodedCommand = Buffer.from(JSON.stringify(command), 'utf8').toString('base64url')
  return `chrome-extension://${extensionId}/douyin-resolve.html?requestId=${encodeURIComponent(command.requestId)}&command=${encodeURIComponent(encodedCommand)}`
}

export function beginDouyinResolveExtensionRequest(options: { url: string }): {
  requestId: string
  command: DouyinResolveExtensionCommand
  ack: Promise<ExtensionAck>
  result: Promise<PendingResolveResult>
  cancel: (reason?: string) => void
} {
  const url = safeHttpUrl(options.url.trim())
  const awemeId = extractAwemeId(url)
  const requestId = randomBytes(18).toString('hex')
  const command: DouyinResolveExtensionCommand = { requestId, url, awemeId }

  let resolveAck!: (value: ExtensionAck) => void
  let resolveResult!: (value: PendingResolveResult) => void
  const ack = new Promise<ExtensionAck>((resolve) => { resolveAck = resolve })
  const result = new Promise<PendingResolveResult>((resolve) => { resolveResult = resolve })

  const ackTimer = setTimeout(() => {
    cancelPending(
      requestId,
      'V-Download Chrome extension did not acknowledge the request. Reload V-Download in chrome://extensions, then retry.'
    )
  }, EXTENSION_RESOLVE_ACK_TIMEOUT_MS)
  pending.set(requestId, { command, resolveAck, resolveResult, ackTimer, resultTimer: null })

  const cancel = (reason = 'Douyin browser resolution was cancelled.') => {
    cancelPending(requestId, reason)
  }

  return { requestId, command, ack, result, cancel }
}

export function getDouyinResolveExtensionCommand(requestId: string): DouyinResolveExtensionCommand | null {
  if (!REQUEST_ID_RE.test(requestId.trim())) return null
  const current = pending.get(requestId.trim())
  return current ? { ...current.command } : null
}

/** Records that the extension service worker received and dispatched the request. */
export function acknowledgeDouyinResolveExtensionRequest(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  const payload = raw as Record<string, unknown>
  const requestId = String(payload.requestId ?? '').trim()
  if (!REQUEST_ID_RE.test(requestId)) return false
  const current = pending.get(requestId)
  if (!current) return false
  const ok = payload.ok === true
  const error = shortError(payload.error, 'V-Download Chrome extension could not start the Douyin page resolver.')
  if (!ok) return cancelPending(requestId, error)
  clearTimeout(current.ackTimer)
  current.resolveAck({ ok: true })
  startResultTimer(requestId)
  return true
}

/** Completes a request posted by the V-Download browser extension. */
export function completeDouyinResolveExtensionRequest(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  const requestId = String((raw as Record<string, unknown>).requestId ?? '').trim()
  if (!REQUEST_ID_RE.test(requestId)) return false
  return settleResult(requestId, normalizeResult(raw))
}

/**
 * Ask the configured browser's V-Download extension first. The extension page
 * is opened as a background tab and closes itself after it wakes the service
 * worker. A missing/stale extension returns quickly and leaves the caller free
 * to use the bounded Chromium fallback.
 */
export async function resolveDouyinInfoViaExtension(
  url: string,
  signal?: AbortSignal
): Promise<DouyinExtensionResolveAttempt> {
  const normalizedUrl = safeHttpUrl(url.trim())
  if (!normalizedUrl || !isDouyinUrl(normalizedUrl)) {
    return { state: 'unavailable', result: null, error: 'This is not a supported Douyin page URL.' }
  }
  if (signal?.aborted) throw new DOMException('Douyin browser resolution aborted', 'AbortError')

  const request = beginDouyinResolveExtensionRequest({ url: normalizedUrl })
  const pageUrl = resolverPageUrl(request.command)
  const onAbort = () => request.cancel('Douyin browser resolution aborted.')
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    if (!pageUrl) {
      request.cancel('V-Download could not determine the installed Chrome extension ID.')
      return {
        state: 'unavailable',
        result: null,
        error: 'V-Download could not determine the installed Chrome extension ID.'
      }
    }
    const opened = await openUrlInConfiguredBrowser(pageUrl, { background: true })
    if (!opened.ok) {
      const error = `Could not open the configured browser extension: ${opened.error ?? 'unknown error'}`
      request.cancel(error)
      return { state: 'unavailable', result: null, error }
    }

    const ack = await request.ack
    if (signal?.aborted) throw new DOMException('Douyin browser resolution aborted', 'AbortError')
    if (!ack.ok) {
      return { state: 'unavailable', result: null, error: ack.error }
    }

    const resolved = await request.result
    if (signal?.aborted) throw new DOMException('Douyin browser resolution aborted', 'AbortError')
    if (resolved.result) return { state: 'resolved', result: resolved.result }
    return { state: 'no-media', result: null, error: resolved.error }
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}
