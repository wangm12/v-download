import type { MediaCandidate } from '@v-download/shared'
import { classifyDownloadError } from './downloadError'

export type ResolverSource = 'yt-dlp' | 'ffmpeg' | 'sniffer' | 'extension'
export type MediaProtocol = 'http' | 'https' | 'hls' | 'dash' | 'file' | 'unknown'

export type ResolverCandidate = MediaCandidate & {
  id?: string
  pageUrl?: string
  source?: ResolverSource
  container?: string
  codec?: string
  fileSize?: number
  approximateSize?: number
  protocol?: MediaProtocol
  hasAudio?: boolean
  hasVideo?: boolean
  confidence?: number
  headers?: Record<string, string>
  formatId?: string
}

export type ResolverErrorKind = 'auth' | 'access-denied' | 'browser-required' | 'unsupported' | 'drm' | 'temporary-network' | 'unknown'

const NOISE = /(?:analytics|tracking|telemetry|doubleclick|google-analytics|pixel|beacon|segment|hotjar)/i
const FRAGMENT = /(?:segment|fragment|init(?:ialization)?)[-_]?\d+\.(?:ts|m4s|aac|mp4)(?:[?#]|$)/i
const EXT = /\.([a-z0-9]+)(?:[?#]|$)/i

function finitePositive(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

export function protocolFor(url: string, mimeType?: string): MediaProtocol {
  if (/\.m3u8(?:[?#]|$)/i.test(url) || /mpegurl/i.test(mimeType || '')) return 'hls'
  if (/\.mpd(?:[?#]|$)/i.test(url) || /dash\+xml/i.test(mimeType || '')) return 'dash'
  try { return new URL(url).protocol.replace(':', '') as MediaProtocol } catch { return 'unknown' }
}

/** Shared routing rule for direct adaptive inputs, including extension MIME labels. */
export function isAdaptiveMediaInput(mediaType: string | undefined, url: string): boolean {
  const type = (mediaType ?? '').toLowerCase()
  const protocol = protocolFor(url, type)
  return type === 'hls' || type === 'dash' || type === 'mpd' || protocol === 'hls' || protocol === 'dash'
}

export function sanitizeResolverError(message: string): string {
  return message
    .replace(/([?&](?:token|sig|signature|key|auth|expires|credential|access_token)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/(^|\n)\s*(cookie|authorization|proxy-authorization)\s*:\s*[^\n]*/gim, '$1$2: [redacted]')
    .replace(/(cookie|authorization|proxy-authorization)\s*[=:]\s*(?:bearer\s+)?[^\s,;]+(?:\s+[^\s,;]+)?/gi, '$1=[redacted]')
}

const PERSISTED_CREDENTIAL_HEADER = /^(?:cookie|set-cookie|authorization|proxy-authorization|www-authenticate|x-api-key|x-auth-token|x-csrf-token|x-xsrf-token|forwarded|proxy-authenticate)$/i

/** Keep only replay-safe request headers in durable task metadata. */
export function filterPersistedHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([name, value]) => {
    return !PERSISTED_CREDENTIAL_HEADER.test(name) && typeof value === 'string' && value.trim().length > 0
  }))
}

export function normalizeCandidate(raw: Partial<ResolverCandidate> & { url: string }, defaults: Partial<ResolverCandidate> = {}): ResolverCandidate | null {
  const url = String(raw.url || '').trim()
  if (!/^https?:\/\//i.test(url) || NOISE.test(url) || FRAGMENT.test(url)) return null
  const mimeType = raw.mimeType || defaults.mimeType
  const protocol = protocolFor(url, mimeType)
  const rawType = String(raw.type || '').toLowerCase()
  const container = (raw.container || defaults.container || (rawType !== 'http' && rawType !== 'https' && rawType !== 'hls' && rawType !== 'dash' ? rawType : '') || EXT.exec(url)?.[1] || '').toLowerCase()
  const size = finitePositive(raw.fileSize ?? raw.approximateSize ?? defaults.fileSize)
  if (protocol !== 'hls' && protocol !== 'dash' && size !== undefined && size < 16_000) return null
  const codecData = raw as Partial<ResolverCandidate> & { vcodec?: string; acodec?: string }
  const codec = raw.codec || [codecData.vcodec, codecData.acodec].filter((value) => value && value !== 'none').join(',') || undefined
  const hasVideo = raw.hasVideo ?? Boolean(codecData.vcodec || raw.width || /video\//i.test(mimeType || '') || ['mp4', 'webm', 'flv', 'mkv'].includes(container))
  const hasAudio = raw.hasAudio ?? Boolean(codecData.acodec || /audio\//i.test(mimeType || '') || /\b(?:audio|muxed)\b/i.test(String(raw.type || '')))
  return { ...defaults, ...raw, url, mimeType, container, protocol, codec, fileSize: size, approximateSize: size, hasAudio, hasVideo, confidence: Math.max(0, Math.min(1, raw.confidence ?? defaults.confidence ?? (protocol === 'hls' || protocol === 'dash' ? 0.85 : 0.7))) }
}

export function mediaTypeForCandidate(candidate: ResolverCandidate | Partial<ResolverCandidate>): string {
  const protocol = candidate.protocol || protocolFor(candidate.url || '', candidate.mimeType)
  if (protocol === 'hls') return 'hls'
  if (protocol === 'dash') return 'dash'
  const value = String(candidate.container || candidate.type || '').toLowerCase()
  if (['mp4', 'webm', 'flv', 'mkv', 'mp3', 'm4a', 'aac', 'opus', 'ogg', 'jpeg'].includes(value)) return value
  const match = EXT.exec(candidate.url || '')
  return match?.[1]?.toLowerCase() || ''
}

export function resolveMediaCandidates(raw: Array<Partial<ResolverCandidate> & { url: string }>, defaults: Partial<ResolverCandidate> = {}): ResolverCandidate[] {
  const merged = new Map<string, ResolverCandidate>()
  for (const item of raw) {
    const candidate = normalizeCandidate(item, defaults)
    if (!candidate) continue
    const key = canonicalMediaUrl(candidate.url)
    const previous = merged.get(key)
    if (!previous || (candidate.confidence || 0) > (previous.confidence || 0) || (candidate.height || 0) > (previous.height || 0)) merged.set(key, candidate)
  }
  return [...merged.values()].sort((a, b) => (b.confidence || 0) - (a.confidence || 0) || (b.height || 0) - (a.height || 0) || (b.bitrate || 0) - (a.bitrate || 0))
}

export function canonicalMediaUrl(value: string): string {
  try {
    const u = new URL(value)
    u.hash = ''
    for (const key of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|tracking|analytics)/i.test(key)) u.searchParams.delete(key)
    return u.toString()
  } catch { return value.split('#')[0] }
}

export function classifyResolverError(message: string): { kind: ResolverErrorKind; action: string } {
  const code = classifyDownloadError(message, false)
  if (code === 'DRM_PROTECTED') return { kind: 'drm', action: 'This media is DRM-protected and cannot be downloaded.' }
  if (code === 'BROWSER_REQUIRED') return { kind: 'browser-required', action: 'Open the source page in Chrome and capture its media.' }
  if (code === 'AUTH_REQUIRED') return { kind: 'auth', action: 'The source explicitly requires authentication. Sign in and retry.' }
  if (code === 'ACCESS_DENIED') return { kind: 'access-denied', action: 'The source refused access; the cause is unknown. Open the source page and recapture its media.' }
  if (code === 'NETWORK_RETRYABLE') return { kind: 'temporary-network', action: 'Check the connection and retry once.' }
  if (code === 'UNSUPPORTED' && /unsupported|no suitable|format not available|HTTP.*(?:404|410)/i.test(message)) return { kind: 'unsupported', action: 'Try another format or capture media from the source page.' }
  return { kind: 'unknown', action: 'Check the URL and try again.' }
}
