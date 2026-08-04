import { COOKIE_SYNC_DOMAINS } from '@v-download/shared'
import { timingSafeEqual } from 'node:crypto'

const MEDIA_TYPES = new Set(['hls', 'dash', 'mpd', 'mp4', 'webm', 'flv', 'mkv', 'mp3', 'm4a', 'aac', 'opus', 'ogg', 'jpeg'])
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/
export const CHROME_EXTENSION_ID_PATTERN = /^[a-p]{32}$/

export function isAllowedOrigin(
  origin: unknown,
  options: { allowedExtensionIds?: ReadonlySet<string>; allowUnpinned?: boolean } = {}
): boolean {
  if (typeof origin !== 'string') return false
  try {
    const u = new URL(origin)
    if (u.protocol !== 'chrome-extension:' || !CHROME_EXTENSION_ID_PATTERN.test(u.hostname)) return false
    // Development uses unpacked extensions whose ID can change when the
    // folder is moved. Keep the explicit unpinned opt-in authoritative even
    // when the current app also knows one configured extension ID.
    if (options.allowUnpinned === true) return true
    if (options.allowedExtensionIds?.size) return options.allowedExtensionIds.has(u.hostname)
    return false
  } catch { return false }
}

export function hasValidCapability(provided: unknown, expected: string): boolean {
  if (typeof provided !== 'string' || !/^[a-f0-9]{64}$/.test(provided) || !/^[a-f0-9]{64}$/.test(expected)) return false
  const a = Buffer.from(provided); const b = Buffer.from(expected)
  return timingSafeEqual(a, b)
}

export function isAuthorizedExtensionRequest(
  origin: unknown,
  capability: unknown,
  expectedCapability: string,
  options: { allowedExtensionIds?: ReadonlySet<string>; allowUnpinned?: boolean } = {}
): boolean {
  if (!isAllowedOrigin(origin, options)) return false
  // A development app intentionally accepts any unpacked extension origin.
  // The loopback server remains bound to 127.0.0.1, while packaged builds
  // continue to require the per-install capability below.
  if (options.allowUnpinned === true) return true
  return hasValidCapability(capability, expectedCapability)
}

export function isAllowedCookieDomain(domain: unknown): boolean {
  if (typeof domain !== 'string' || domain.length < 2 || domain.length > 255) return false
  const normalized = domain.toLowerCase().replace(/^\./, '')
  return COOKIE_SYNC_DOMAINS.some((allowed) => {
    const base = allowed.replace(/^\./, '')
    return normalized === base || normalized.endsWith(`.${base}`)
  })
}

export function validateCookieRecord(cookie: unknown): boolean {
  if (!cookie || typeof cookie !== 'object') return false
  const c = cookie as Record<string, unknown>
  const controlChars = /[\u0000-\u001f\u007f]/
  const cookieName = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
  if (!isAllowedCookieDomain(c.domain) || typeof c.domain !== 'string' || controlChars.test(c.domain) || typeof c.name !== 'string' || c.name.length < 1 || c.name.length > 256 || controlChars.test(c.name) || !cookieName.test(c.name) || typeof c.value !== 'string' || controlChars.test(c.value) || Buffer.byteLength(c.value) > 16 * 1024) return false
  if (typeof c.path !== 'string' || c.path.length < 1 || c.path.length > 1024 || !/^\/[\x20-\x7e]*$/.test(c.path)) return false
  if (typeof c.secure !== 'boolean' || typeof c.httpOnly !== 'boolean') return false
  if (c.session !== undefined && typeof c.session !== 'boolean') return false
  if (c.expirationDate !== undefined && (typeof c.expirationDate !== 'number' || !Number.isFinite(c.expirationDate) || c.expirationDate < 0)) return false
  return true
}

export function validateDownloadPayload(payload: unknown): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, error: 'Invalid payload' }
  const p = payload as Record<string, unknown>
  const keys = new Set(['url', 'type', 'quality', 'autoStart', 'referer', 'headers', 'title', 'filename'])
  if (Object.keys(p).some((k) => !keys.has(k)) || typeof p.url !== 'string' || p.url.length < 1 || p.url.length > 8192) return { ok: false, error: 'Invalid download payload' }
  try { const u = new URL(p.url); if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, error: 'Invalid download URL' } } catch { return { ok: false, error: 'Invalid download URL' } }
  for (const key of ['referer', 'title', 'filename']) if (p[key] !== undefined && (typeof p[key] !== 'string' || p[key].length > 512)) return { ok: false, error: 'Invalid download field' }
  if (p.quality !== undefined && (typeof p.quality !== 'string' || !/^(?:\d{1,4}|best)$/.test(p.quality))) return { ok: false, error: 'Invalid download quality' }
  if (p.autoStart !== undefined && typeof p.autoStart !== 'boolean') return { ok: false, error: 'Invalid download option' }
  if (p.referer !== undefined) { try { const r = new URL(p.referer as string); if (r.protocol !== 'http:' && r.protocol !== 'https:') return { ok: false, error: 'Invalid referer' } } catch { return { ok: false, error: 'Invalid referer' } } }
  if (p.type !== undefined && (typeof p.type !== 'string' || !MEDIA_TYPES.has(p.type.toLowerCase()))) return { ok: false, error: 'Invalid media type' }
  if (p.headers !== undefined) {
    if (!p.headers || typeof p.headers !== 'object' || Array.isArray(p.headers)) return { ok: false, error: 'Invalid headers' }
    const h = p.headers as Record<string, unknown>
    if (Object.keys(h).length > 32 || Object.entries(h).some(([k, v]) => !HEADER_NAME.test(k) || typeof v !== 'string' || v.length > 4096 || /[\r\n]/.test(v))) return { ok: false, error: 'Invalid headers' }
  }
  return { ok: true, value: p }
}
