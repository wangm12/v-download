import { randomBytes } from 'crypto'
import type { DouyinProfileListResult, DouyinProfilePostRow } from './douyinProfileTypes'

export interface DouyinProfileExtensionCommand {
  requestId: string
  profileUrl: string
  existingAwemeIds: string[]
  maxScrolls: number
  idleRounds: number
}

interface PendingRequest {
  command: DouyinProfileExtensionCommand
  resolve: (result: DouyinProfileListResult) => void
  timer: ReturnType<typeof setTimeout>
}

const PROFILE_IMPORT_TIMEOUT_MS = 145_000
const pending = new Map<string, PendingRequest>()

function failure(message: string, code: 'TIMEOUT' | 'LOAD_MORE_FAILED' = 'LOAD_MORE_FAILED'): DouyinProfileListResult {
  return { ok: false, code, message }
}

function safeHttpUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 8192) return ''
  try {
    const u = new URL(value)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
    return u.toString()
  } catch {
    return ''
  }
}

function normalizeRow(raw: unknown): DouyinProfilePostRow | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  const awemeId = String(row.awemeId ?? '').trim()
  if (!/^\d{10,32}$/.test(awemeId)) return null

  const mediaType = row.mediaType === 'gallery' ? 'gallery' : 'video'
  const pageUrl = safeHttpUrl(row.pageUrl) || `https://www.douyin.com/${mediaType === 'gallery' ? 'note' : 'video'}/${awemeId}`
  const cover = safeHttpUrl(row.cover)
  const duration = Number(row.durationSec)
  const imageCount = Number(row.imageCount)

  return {
    awemeId,
    mediaType,
    title: String(row.title ?? '').trim().slice(0, 200) || `Aweme ${awemeId}`,
    author: String(row.author ?? '').trim().slice(0, 120),
    cover,
    ...(Number.isFinite(duration) && duration > 0 ? { durationSec: Math.floor(duration) } : {}),
    ...(mediaType === 'gallery' && Number.isFinite(imageCount) && imageCount > 0
      ? { imageCount: Math.floor(imageCount) }
      : {}),
    pageUrl,
  }
}

function normalizeResult(raw: unknown): DouyinProfileListResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return failure('Chrome extension returned an invalid profile import result.')
  }
  const payload = raw as Record<string, unknown>
  if (payload.ok !== true) {
    const message = String(payload.error ?? '').trim()
    return failure(message || 'Chrome could not import posts from the logged-in Douyin page.')
  }

  const items = Array.isArray(payload.items)
    ? payload.items.map(normalizeRow).filter((row): row is DouyinProfilePostRow => Boolean(row)).slice(0, 2000)
    : []
  const warnings = Array.isArray(payload.warnings)
    ? payload.warnings.map((x) => String(x).trim()).filter(Boolean).slice(0, 4)
    : []

  return {
    ok: true,
    items,
    cursor: null,
    hasMore: false,
    source: 'browser_recovery',
    ...(warnings.length ? { warnings } : {}),
  }
}

export function beginDouyinProfileExtensionRequest(options: {
  profileUrl: string
  existingAwemeIds?: string[]
}): {
  requestId: string
  command: DouyinProfileExtensionCommand
  promise: Promise<DouyinProfileListResult>
  cancel: () => void
} {
  const requestId = randomBytes(18).toString('hex')
  const command: DouyinProfileExtensionCommand = {
    requestId,
    profileUrl: options.profileUrl.trim(),
    existingAwemeIds: Array.from(
      new Set((options.existingAwemeIds ?? []).map((id) => String(id).trim()).filter((id) => /^\d{10,32}$/.test(id)))
    ).slice(0, 2000),
    maxScrolls: 96,
    idleRounds: 5,
  }

  let resolveRequest!: (result: DouyinProfileListResult) => void
  const promise = new Promise<DouyinProfileListResult>((resolve) => {
    resolveRequest = resolve
  })
  const timer = setTimeout(() => {
    if (!pending.has(requestId)) return
    pending.delete(requestId)
    resolveRequest(
      failure(
        'Chrome did not return profile posts in time. Keep the profile open in Chrome with the V-Download extension enabled and retry.',
        'TIMEOUT'
      )
    )
  }, PROFILE_IMPORT_TIMEOUT_MS)

  const entry: PendingRequest = { command, resolve: resolveRequest, timer }
  pending.set(requestId, entry)

  const cancel = () => {
    const current = pending.get(requestId)
    if (!current) return
    clearTimeout(current.timer)
    pending.delete(requestId)
    current.resolve(failure('Request cancelled', 'TIMEOUT'))
  }

  return { requestId, command, promise, cancel }
}

export function getDouyinProfileExtensionCommand(requestId: string): DouyinProfileExtensionCommand | null {
  const current = pending.get(requestId.trim())
  return current ? { ...current.command, existingAwemeIds: [...current.command.existingAwemeIds] } : null
}

/** Resolve a request from the authorized Chrome extension. */
export function completeDouyinProfileExtensionRequest(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  const requestId = String((raw as Record<string, unknown>).requestId ?? '').trim()
  const current = pending.get(requestId)
  if (!current) return false

  clearTimeout(current.timer)
  pending.delete(requestId)
  current.resolve(normalizeResult(raw))
  return true
}
