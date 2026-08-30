import { existsSync, readdirSync, statSync } from 'node:fs'
import { basename, extname, join, resolve, sep } from 'node:path'

export const JOB_ID_PATTERN = /^[A-Za-z0-9_-]{8,32}$/
export const MAX_ATTEMPTS = 3
export const RETRY_DELAYS_MS = [2000, 4000] as const

export type JobKind = 'file' | 'gallery' | 'collection'
export type JobStatus = 'queued' | 'downloading' | 'complete' | 'error' | 'cancelled'
export type InputClass = 'single' | 'collection' | 'direct'

export interface JobError {
  code: string
  message: string
  details?: Record<string, unknown>
}

export interface JobFile {
  name: string
  contentType: string
  sizeBytes: number
  index: number
}

export interface Artifact {
  name: string
  sizeBytes: number
}

export interface JobRecord {
  id: string
  url: string
  title: string | null
  status: string
  progress: number
  error: JobError | string | null
  updatedAt: string
}

export interface JobView {
  id: string
  status: string
  url: string
  title: string | null
  progress: number
  kind: JobKind | null
  files: JobFile[] | null
  error: JobError | null
  expiresAt: string | null
  expired: boolean
}

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif'])
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mkv', '.mov', '.avi', '.flv', '.ts', '.m4v'])
const AUDIO_EXT = new Set(['.m4a', '.mp3', '.opus', '.ogg', '.aac', '.wav', '.flac'])
const PLAYLIST_EXT = new Set(['.m3u8', '.m3u', '.mpd'])
const DIRECT_EXT = new Set([...IMAGE_EXT, ...VIDEO_EXT, ...AUDIO_EXT, ...PLAYLIST_EXT])

const CONTENT_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.flv': 'video/x-flv',
  '.ts': 'video/mp2t',
  '.m4v': 'video/x-m4v',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.opus': 'audio/opus',
  '.ogg': 'audio/ogg',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.m3u': 'application/vnd.apple.mpegurl',
  '.mpd': 'application/dash+xml',
}

export function contentTypeForName(name: string): string {
  return CONTENT_TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream'
}

export function isIgnoredArtifactName(name: string): boolean {
  if (!name || name.startsWith('.')) return true
  if (name.startsWith('ffmpeg2pass')) return true
  if (name.startsWith('compressed_')) return true
  const lower = name.toLowerCase()
  return lower.endsWith('.part') || lower.endsWith('.ytdl')
}

export function mediaClass(name: string): 'video' | 'audio' | 'image' | 'playlist' | 'other' {
  const ext = extname(name).toLowerCase()
  if (PLAYLIST_EXT.has(ext)) return 'playlist'
  if (IMAGE_EXT.has(ext)) return 'image'
  if (VIDEO_EXT.has(ext)) return 'video'
  if (AUDIO_EXT.has(ext)) return 'audio'
  return 'other'
}

export function parseJobUrl(input: unknown): { ok: true; url: string } | { ok: false; error: JobError } {
  if (typeof input !== 'string') {
    return { ok: false, error: { code: 'invalid_url', message: 'url must be a string' } }
  }
  const trimmed = input.trim()
  if (trimmed.length < 8 || trimmed.length > 8192) {
    return { ok: false, error: { code: 'invalid_url', message: 'url must be 8-8192 characters' } }
  }
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, error: { code: 'invalid_url', message: 'url must be http or https' } }
    }
    return { ok: true, url: parsed.toString() }
  } catch {
    return { ok: false, error: { code: 'invalid_url', message: 'url is not a valid URL' } }
  }
}

export function parseJobCreateBody(
  body: unknown,
): { ok: true; url: string } | { ok: false; error: JobError } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: { code: 'invalid_url', message: 'JSON object with url is required' } }
  }
  const keys = Object.keys(body as Record<string, unknown>)
  const unexpected = keys.filter((key) => key !== 'url')
  if (unexpected.length > 0) {
    return {
      ok: false,
      error: { code: 'unexpected_field', message: `Unexpected field: ${unexpected[0]}` },
    }
  }
  return parseJobUrl((body as { url?: unknown }).url)
}

export function parseJobId(id: unknown): { ok: true; id: string } | { ok: false; error: JobError } {
  if (typeof id !== 'string' || !JOB_ID_PATTERN.test(id)) {
    return { ok: false, error: { code: 'invalid_id', message: 'Invalid job id' } }
  }
  return { ok: true, id }
}

export function isSafeFileName(name: unknown): name is string {
  if (typeof name !== 'string' || name.length === 0 || name.length > 512) return false
  if (name === '.' || name === '..') return false
  if (name.includes('/') || name.includes('\\') || name.includes('\0')) return false
  if (name.includes('..')) return false
  return name === basename(name)
}

export function resolveJobFilePath(jobDir: string, name: string): string | null {
  if (!isSafeFileName(name)) return null
  const root = resolve(jobDir)
  const direct = resolve(root, name)
  if (direct === root || !direct.startsWith(root + sep)) return null
  if (existsSync(direct) && statSync(direct).isFile()) return direct
  try {
    for (const entry of walkFiles(root)) {
      if (entry.name === name) return entry.path
    }
  } catch {
    return null
  }
  return null
}

/** Resolve a job file only among paths this job owns (file or directory). */
export function resolveJobOwnedFile(ownedPaths: string[], name: string): string | null {
  if (!isSafeFileName(name)) return null
  for (const owned of ownedPaths) {
    if (!owned || !existsSync(owned)) continue
    const st = statSync(owned)
    if (st.isFile()) {
      if (basename(owned) === name) return owned
      continue
    }
    if (st.isDirectory()) {
      const found = resolveJobFilePath(owned, name)
      if (found) return found
    }
  }
  return null
}

function walkFiles(root: string): Array<{ name: string; path: string; sizeBytes: number }> {
  const out: Array<{ name: string; path: string; sizeBytes: number }> = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (isIgnoredArtifactName(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!entry.isFile()) continue
      const st = statSync(full)
      out.push({ name: entry.name, path: full, sizeBytes: st.size })
    }
  }
  walk(root)
  return out
}

export function listJobArtifacts(jobDir: string): Artifact[] {
  if (!existsSync(jobDir) || !statSync(jobDir).isDirectory()) return []
  return walkFiles(jobDir).map(({ name, sizeBytes }) => ({ name, sizeBytes }))
}

export function classifyArtifacts(artifacts: Artifact[]): {
  kind: JobKind | null
  files?: JobFile[]
  error?: JobError
} {
  const playlists = artifacts.filter((a) => mediaClass(a.name) === 'playlist')
  const media = artifacts.filter((a) => {
    const cls = mediaClass(a.name)
    return cls === 'video' || cls === 'audio' || cls === 'image'
  })
  if (media.length === 0) {
    if (playlists.length > 0) {
      return { kind: null, error: { code: 'remux_failed', message: 'HLS/DASH did not remux into a media file' } }
    }
    return { kind: null, error: { code: 'empty_output', message: 'Download produced no media files' } }
  }

  const files = media.map((a, i) => ({
    name: a.name,
    contentType: contentTypeForName(a.name),
    sizeBytes: a.sizeBytes,
    index: i + 1,
  }))

  if (media.length === 1) return { kind: 'file', files }

  const classes = new Set(media.map((a) => mediaClass(a.name)))
  const onlyImages = classes.size === 1 && classes.has('image')
  if (onlyImages) return { kind: 'gallery', files }
  return { kind: 'collection', files }
}

export function classifyInputUrl(url: string): InputClass {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return 'single'
  }
  const host = parsed.hostname.toLowerCase()
  const path = parsed.pathname.toLowerCase()
  const ext = extname(path)
  if (DIRECT_EXT.has(ext)) return 'direct'

  if (host === 'youtu.be') return 'single'
  if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
    if (path === '/playlist' || path.startsWith('/playlist/')) return 'collection'
    if (path.startsWith('/channel/') || path.startsWith('/c/') || path.startsWith('/@')) return 'collection'
    if (parsed.searchParams.has('v')) return 'single'
    if (path === '/watch' && parsed.searchParams.has('list') && !parsed.searchParams.has('v')) return 'collection'
  }
  return 'single'
}

export function classifyYtdlpProbe(
  url: string,
  json: { _type?: string; n_entries?: number; entries?: unknown[] },
): InputClass {
  const input = classifyInputUrl(url)
  if (input === 'direct' || input === 'single') return input
  if (json._type === 'playlist') return 'collection'
  if (input === 'collection') return 'collection'
  return 'single'
}

export function collectionTooLarge(itemCount: number, max: number): JobError {
  return {
    code: 'collection_too_large',
    message: `Collection has ${itemCount} items; max is ${max}`,
    details: { itemCount, max },
  }
}

export function classifyFailureMessage(message: string): JobError {
  const text = message.slice(0, 500)
  if (/fresh cookies|log ?in|sign in|authentication|cookies? are needed/i.test(text)) {
    return { code: 'auth_required', message: text }
  }
  if (/\bis_live\b|live event|livestream|unsupported_live/i.test(text)) {
    return { code: 'unsupported_live', message: text }
  }
  if (/file_too_large|exceeds .*MB/i.test(text)) {
    return { code: 'file_too_large', message: text }
  }
  if (/remux_failed|did not remux/i.test(text)) {
    return { code: 'remux_failed', message: text }
  }
  return { code: 'download_failed', message: text || 'Download failed' }
}

export function shouldRetryError(code: string): boolean {
  return !['auth_required', 'unsupported_live', 'file_too_large', 'collection_too_large', 'cancelled'].includes(code)
}

export async function withRetries<T>(
  fn: () => Promise<T>,
  options: { sleep?: (ms: number) => Promise<void>; maxAttempts?: number } = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : classifyFailureMessage(err instanceof Error ? err.message : String(err)).code
      if (!shouldRetryError(code) || attempt === maxAttempts) throw err
      const delay = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)]
      await sleep(delay)
    }
  }
  throw lastError
}

export function parseStoredError(raw: string | JobError | null): JobError | null {
  if (!raw) return null
  if (typeof raw === 'object') return raw
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && typeof (parsed as JobError).code === 'string') {
      return parsed as JobError
    }
  } catch {
    /* plain string from older rows */
  }
  return classifyFailureMessage(raw)
}

export function stringifyError(error: JobError): string {
  return JSON.stringify(error)
}

export function buildJobView(
  record: JobRecord,
  options: { artifacts: Artifact[] },
): JobView {
  const error = parseStoredError(record.error)
  const progress = Math.max(0, Math.min(100, Math.round(record.progress)))
  const classified = classifyArtifacts(options.artifacts)
  const isComplete = record.status === 'complete'
  const expired = isComplete && options.artifacts.length === 0

  return {
    id: record.id,
    status: record.status,
    url: record.url,
    title: record.title,
    progress,
    kind: isComplete && !expired ? classified.kind : null,
    files: isComplete ? (expired ? [] : classified.files ?? []) : null,
    error: record.status === 'error' || record.status === 'cancelled' ? error : null,
    expiresAt: null,
    expired,
  }
}

export function contentDisposition(fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'download'
  const encoded = encodeURIComponent(fileName)
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`
}

export class JobFailure extends Error {
  readonly code: string
  readonly details?: Record<string, unknown>
  constructor(error: JobError) {
    super(error.message)
    this.name = 'JobFailure'
    this.code = error.code
    this.details = error.details
  }

  toJSON(): JobError {
    return { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) }
  }
}

export function toJobError(err: unknown): JobError {
  if (err instanceof JobFailure) return err.toJSON()
  if (err && typeof err === 'object' && 'code' in err && typeof (err as JobFailure).code === 'string') {
    const e = err as { code: string; message?: string; details?: Record<string, unknown> }
    return { code: e.code, message: e.message || e.code, details: e.details }
  }
  return classifyFailureMessage(err instanceof Error ? err.message : String(err))
}

export function fileTooLarge(name: string, sizeBytes: number, maxMb: number): JobError {
  return {
    code: 'file_too_large',
    message: `${name} is ${(sizeBytes / 1024 / 1024).toFixed(1)} MB; max is ${maxMb} MB`,
    details: { name, sizeBytes, maxMb },
  }
}
