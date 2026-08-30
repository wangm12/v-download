import * as settings from './settings'
import * as ytdlp from './ytdlp'
import {
  getDouyinInfo,
  getLastDouyinInfoError,
  isDouyinGallery,
  isDouyinPostUnavailableError,
} from './douyin'
import {
  getXiaohongshuInfo,
  getLastXhsInfoError,
  isXiaohongshuGallery,
  isXiaohongshuUrl,
} from './xiaohongshu'
import { protocolFor, resolveMediaCandidates } from './mediaResolver'

export interface VideoInfoResolveResult {
  data?: unknown
  error?: string
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Video info resolution aborted', 'AbortError')
}

function isDouyinUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host === 'douyin.com' || host.endsWith('.douyin.com') || host === 'iesdouyin.com' || host.endsWith('.iesdouyin.com')
  } catch {
    return false
  }
}

/** Chromium fallback is useful, but an unavailable browser bridge must not hold a resolver worker for minutes. */
export const DOUYIN_INFO_RESOLVE_TIMEOUT_MS = 45_000

type TimeboxedSignal = {
  signal: AbortSignal
  timedOut: () => boolean
  dispose: () => void
}

function timeboxSignal(parent: AbortSignal | undefined, timeoutMs: number): TimeboxedSignal {
  const controller = new AbortController()
  let didTimeout = false
  const abortFromParent = () => controller.abort()
  if (parent?.aborted) controller.abort()
  else parent?.addEventListener('abort', abortFromParent, { once: true })
  const timer = setTimeout(() => {
    didTimeout = true
    controller.abort()
  }, timeoutMs)
  return {
    signal: controller.signal,
    timedOut: () => didTimeout,
    dispose: () => {
      clearTimeout(timer)
      parent?.removeEventListener('abort', abortFromParent)
    }
  }
}

function douyinTimeoutError(): string {
  const hint = getLastDouyinInfoError()
  return [
    `Douyin resolution exceeded the ${Math.round(DOUYIN_INFO_RESOLVE_TIMEOUT_MS / 1000)}-second fallback budget.`,
    hint,
    'Reload V-Download in chrome://extensions and retry if the Chrome bridge is unavailable.'
  ].filter(Boolean).join(' ')
}

function toDouyinData(
  url: string,
  douyin: NonNullable<Awaited<ReturnType<typeof getDouyinInfo>>>
): Record<string, unknown> {
  if (isDouyinGallery(douyin)) {
    return {
      id: douyin.id,
      title: douyin.title,
      thumbnail: ytdlp.normalizeThumbnailUrl(douyin.cover),
      duration: 0,
      channel: douyin.author,
      view_count: 0,
      formats: [],
      webpage_url: url,
      _type: 'douyin_gallery',
      image_urls: douyin.imageUrls
    }
  }
  return {
    id: douyin.id,
    title: douyin.title,
    thumbnail: ytdlp.normalizeThumbnailUrl(douyin.cover),
    duration: douyin.duration,
    channel: douyin.author,
    view_count: 0,
    formats: [],
    webpage_url: url,
    _type: 'video'
  }
}

function toXhsData(
  url: string,
  xhs: NonNullable<Awaited<ReturnType<typeof getXiaohongshuInfo>>>
): Record<string, unknown> {
  return {
    id: xhs.id,
    title: xhs.title,
    thumbnail: ytdlp.normalizeThumbnailUrl(xhs.cover),
    duration: 0,
    channel: xhs.author,
    view_count: 0,
    formats: [],
    webpage_url: url,
    _type: 'xhs_gallery',
    image_urls: xhs.imageUrls,
  }
}

/**
 * Shared implementation for the legacy synchronous IPC call and background
 * resolver workers. Signed format URLs only live in this returned value; the
 * task database stores the original URL and safe task metadata instead.
 */
export async function resolveVideoInfo(url: string, signal?: AbortSignal): Promise<VideoInfoResolveResult> {
  let douyinTimebox: TimeboxedSignal | null = null
  try {
    if (typeof url !== 'string' || !ytdlp.isValidDownloadUrl(url)) {
      return { error: 'Invalid URL' }
    }
    throwIfAborted(signal)

    const cookiesPath = settings.getCookiesPath()
    const ytdlpPath = settings.get('ytdlpPath')
    const douyinUrl = isDouyinUrl(url)
    const xhsUrl = isXiaohongshuUrl(url)
    const resolveSignal = douyinUrl
      ? (douyinTimebox = timeboxSignal(signal, DOUYIN_INFO_RESOLVE_TIMEOUT_MS)).signal
      : signal

    if (ytdlp.isMediaUrl(url)) {
      const candidate = resolveMediaCandidates([{ url, type: protocolFor(url), pageUrl: url, source: 'extension' }])[0]
      return {
        data: {
          id: url,
          title: 'Direct media',
          thumbnail: '',
          duration: 0,
          channel: '',
          view_count: 0,
          formats: candidate ? [candidate] : [],
          candidates: candidate ? [candidate] : [],
          webpage_url: url,
          _type: 'video'
        }
      }
    }

    let douyinHint: Awaited<ReturnType<typeof getDouyinInfo>> = null
    if (douyinUrl) {
      douyinHint = await getDouyinInfo(url, cookiesPath || undefined, { signal: resolveSignal })
      throwIfAborted(resolveSignal)
      const douyinError = getLastDouyinInfoError()
      if (isDouyinPostUnavailableError(douyinError)) return { error: douyinError }
      // Gallery must bypass yt-dlp format-info path; UI should treat it as image set.
      if (isDouyinGallery(douyinHint)) return { data: toDouyinData(url, douyinHint) }
    }

    let xhsHint: Awaited<ReturnType<typeof getXiaohongshuInfo>> = null
    if (xhsUrl) {
      xhsHint = await getXiaohongshuInfo(url, cookiesPath || undefined)
      throwIfAborted(resolveSignal)
      if (isXiaohongshuGallery(xhsHint)) return { data: toXhsData(url, xhsHint) }
    }

    try {
      const info = await ytdlp.getVideoInfo(
        url,
        cookiesPath || undefined,
        ytdlpPath,
        resolveSignal,
        settings.get('proxyUrl') || undefined
      )
      throwIfAborted(resolveSignal)
      return { data: info }
    } catch (err) {
      if (douyinTimebox?.timedOut()) return { error: douyinTimeoutError() }
      throwIfAborted(signal)
      const msg = err instanceof Error ? err.message : String(err)
      if (douyinUrl) {
        const douyin = douyinHint ?? await getDouyinInfo(url, cookiesPath || undefined, { signal: resolveSignal })
        if (douyin) return { data: toDouyinData(url, douyin) }
        const hint = getLastDouyinInfoError()
        if (hint) return { error: `${msg} | ${hint}` }
      }
      if (xhsUrl) {
        const xhs = xhsHint ?? (await getXiaohongshuInfo(url, cookiesPath || undefined))
        if (xhs && isXiaohongshuGallery(xhs)) return { data: toXhsData(url, xhs) }
        const hint = getLastXhsInfoError()
        if (hint) return { error: `${msg} | ${hint}` }
      }
      return { error: msg }
    }
  } catch (err) {
    if (douyinTimebox?.timedOut()) return { error: douyinTimeoutError() }
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    return { error: err instanceof Error ? err.message : String(err) }
  } finally {
    douyinTimebox?.dispose()
  }
}
