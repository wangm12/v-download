import { createWriteStream, mkdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import { sanitizeDownloadBasename } from './sanitizeDownloadBasename'
import {
  downloadUrlWithDouyinSession,
  fetchDouyinHtmlWithChromium,
  fetchTextWithDouyinSession,
  getDouyinHydrateSessionCookieHeader,
  isDouyinAntiBotShell,
} from './douyinBrowserFetch'
import {
  createDouyinDownloadProgressReporter,
  type DouyinDownloadProgress,
} from './douyinDownloadProgress'

export type { DouyinDownloadProgress } from './douyinDownloadProgress'
import {
  DOUYIN_DESKTOP_UA,
  DOUYIN_MOBILE_UA,
  buildCookieHeaderFromNetscapeFile,
  extractBalancedJsonAfterMarker,
  fetchDouyinPageHtml,
  type DouyinFetchUaMode,
} from './douyinParseUtils'
import { buildDouyinCookieHeader, resolveDouyinCookieContext } from './browserCookies'
import { getCachedProfileAwemeItem } from './douyinProfileAwemeCache'
import { buildSignedAwemeDetailUrl } from './douyinProfileSign'

const DETAIL_API_RETRY_DELAYS_MS = [1000, 2000, 5000]
const DETAIL_API_MAX_ATTEMPTS = 3

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

const MOBILE_UA = DOUYIN_MOBILE_UA
const DESKTOP_UA = DOUYIN_DESKTOP_UA

export type DouyinFetchOptions = { signal?: AbortSignal }

export function throwIfDouyinAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Douyin fetch aborted', 'AbortError')
  }
}

export function isDouyinAbortError(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError'
}

export interface DouyinVideoInfo {
  kind?: 'video'
  id: string
  title: string
  author: string
  videoUrl: string
  /** Other play URLs to try when the primary CDN link returns 403. */
  videoUrlFallbacks?: string[]
  duration: number
  cover: string
}

export interface DouyinGalleryInfo {
  kind: 'gallery'
  id: string
  title: string
  author: string
  cover: string
  imageUrls: string[]
}

export type DouyinMediaResult = DouyinVideoInfo | DouyinGalleryInfo

export function isDouyinGallery(info: DouyinMediaResult | null): info is DouyinGalleryInfo {
  return info != null && info.kind === 'gallery'
}

/** Set when getDouyinInfo returns null — for clearer UI / task errors */
let lastGetDouyinInfoError = ''

export function getLastDouyinInfoError(): string {
  return lastGetDouyinInfoError
}

export function isDouyinUrl(url: string): boolean {
  return /douyin\.com/i.test(url)
}

async function resolveShortUrl(url: string): Promise<string> {
  const res = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'User-Agent': MOBILE_UA,
      Referer: 'https://www.douyin.com/',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
  })
  try {
    await res.arrayBuffer()
  } catch {
    /* ignore */
  }
  return res.url
}

function extractContentId(resolvedUrl: string): string | null {
  const m = resolvedUrl.match(/\/(?:video|note|gallery)\/(\d+)/)
  return m ? m[1] : null
}

type FetchUaMode = DouyinFetchUaMode

async function fetchDouyinHtml(
  pageUrl: string,
  cookiesFilePath: string | undefined,
  uaMode: FetchUaMode
): Promise<string> {
  return fetchDouyinPageHtml(pageUrl, cookiesFilePath, uaMode)
}

function videoPlayAddr(video: Record<string, unknown>): Record<string, unknown> | null {
  const pa = video.play_addr ?? video.playAddr
  if (!pa || typeof pa !== 'object') return null
  return pa as Record<string, unknown>
}

function playAddrHasUrls(pa: Record<string, unknown>): boolean {
  if (typeof pa.uri === 'string' && String(pa.uri).trim()) return true
  const urlList = (pa.url_list ?? pa.urlList) as string[] | undefined
  return Array.isArray(urlList) && urlList.some((u) => typeof u === 'string' && /^https?:\/\//i.test(u))
}

function itemHasPlayUri(o: Record<string, unknown>): boolean {
  const v = o.video
  if (!v || typeof v !== 'object') return false
  const video = v as Record<string, unknown>
  const pa = videoPlayAddr(video)
  if (pa && playAddrHasUrls(pa)) return true
  const downloadAddr = video.download_addr ?? video.downloadAddr
  if (downloadAddr && typeof downloadAddr === 'object' && playAddrHasUrls(downloadAddr as Record<string, unknown>)) {
    return true
  }
  const bitRate = video.bit_rate ?? video.bitRate
  if (Array.isArray(bitRate)) {
    for (const br of bitRate) {
      if (!br || typeof br !== 'object') continue
      const brPa = (br as Record<string, unknown>).play_addr ?? (br as Record<string, unknown>).playAddr
      if (brPa && typeof brPa === 'object' && playAddrHasUrls(brPa as Record<string, unknown>)) {
        return true
      }
    }
  }
  return false
}

function findAwemeItemDeep(obj: unknown, depth = 0, maxDepth = 100): Record<string, unknown> | null {
  if (depth > maxDepth || obj == null) return null
  if (typeof obj !== 'object') return null

  if (Array.isArray(obj)) {
    for (const el of obj) {
      const r = findAwemeItemDeep(el, depth + 1, maxDepth)
      if (r) return r
    }
    return null
  }

  const o = obj as Record<string, unknown>
  if (itemHasPlayUri(o)) return o

  for (const key of Object.keys(o)) {
    const r = findAwemeItemDeep(o[key], depth + 1, maxDepth)
    if (r) return r
  }
  return null
}

function videoUrlCandidatesFromPlayAddr(playAddr: Record<string, unknown>): string[] {
  const out: string[] = []
  const urlList = (playAddr.url_list ?? playAddr.urlList) as string[] | undefined
  if (Array.isArray(urlList)) {
    for (let i = urlList.length - 1; i >= 0; i--) {
      const u = urlList[i]
      if (typeof u === 'string' && /^https?:\/\//i.test(u)) out.push(u)
    }
  }
  const uri = playAddr.uri
  if (uri != null && String(uri)) {
    out.push(`https://aweme.snssdk.com/aweme/v1/play/?video_id=${uri}&ratio=720p&line=0`)
  }
  return [...new Set(out)]
}

function bestPlayAddrFromVideo(video: Record<string, unknown>): Record<string, unknown> | null {
  const pa = videoPlayAddr(video)
  if (pa && playAddrHasUrls(pa)) return pa
  const downloadAddr = video.download_addr ?? video.downloadAddr
  if (downloadAddr && typeof downloadAddr === 'object' && playAddrHasUrls(downloadAddr as Record<string, unknown>)) {
    return downloadAddr as Record<string, unknown>
  }
  const bitRate = video.bit_rate ?? video.bitRate
  if (Array.isArray(bitRate)) {
    for (const br of bitRate) {
      if (!br || typeof br !== 'object') continue
      const brPa = (br as Record<string, unknown>).play_addr ?? (br as Record<string, unknown>).playAddr
      if (brPa && typeof brPa === 'object' && playAddrHasUrls(brPa as Record<string, unknown>)) {
        return brPa as Record<string, unknown>
      }
    }
  }
  return pa
}

function buildDouyinInfoFromItem(item: Record<string, unknown>, fallbackId: string): DouyinVideoInfo {
  const video = item.video as Record<string, unknown>
  const playAddr = (bestPlayAddrFromVideo(video) ?? {}) as Record<string, unknown>
  const candidates = videoUrlCandidatesFromPlayAddr(playAddr)
  const videoUrl = candidates[0] ?? ''
  const coverList = (video.cover as { url_list?: string[] } | undefined)?.url_list
  const coverUrl = coverList?.[0] ?? ''
  const author = (item.author as { nickname?: string } | undefined)?.nickname ?? ''

  return {
    kind: 'video',
    id: String(item.aweme_id ?? fallbackId),
    title: String(item.desc ?? 'Douyin Video').substring(0, 200),
    author: String(author),
    videoUrl,
    videoUrlFallbacks: candidates.length > 1 ? candidates.slice(1) : undefined,
    duration: Math.floor((Number(video.duration) || 0) / 1000),
    cover: coverUrl,
  }
}

function itemHasImages(o: Record<string, unknown>): boolean {
  const imgs = (o.images ?? o.image_list ?? o.imageList) as unknown
  if (!Array.isArray(imgs) || imgs.length === 0) return false
  for (const img of imgs) {
    if (!img || typeof img !== 'object') continue
    const rec = img as Record<string, unknown>
    const urlList = rec.url_list ?? rec.urlList
    if (Array.isArray(urlList) && urlList.some((u) => typeof u === 'string' && /^https?:\/\//i.test(u))) {
      return true
    }
  }
  return false
}

function findGalleryItemDeep(obj: unknown, depth = 0, maxDepth = 100): Record<string, unknown> | null {
  if (depth > maxDepth || obj == null) return null
  if (typeof obj !== 'object') return null

  if (Array.isArray(obj)) {
    for (const el of obj) {
      const r = findGalleryItemDeep(el, depth + 1, maxDepth)
      if (r) return r
    }
    return null
  }

  const o = obj as Record<string, unknown>
  if (itemHasImages(o)) return o

  for (const key of Object.keys(o)) {
    const r = findGalleryItemDeep(o[key], depth + 1, maxDepth)
    if (r) return r
  }
  return null
}

function buildDouyinGalleryFromItem(item: Record<string, unknown>, fallbackId: string): DouyinGalleryInfo {
  const imgs = (item.images ?? item.image_list ?? item.imageList) as unknown[] | undefined
  const imageUrls: string[] = []
  if (Array.isArray(imgs)) {
    for (const img of imgs) {
      if (!img || typeof img !== 'object') continue
      const rec = img as Record<string, unknown>
      const urlList = (rec.url_list ?? rec.urlList) as string[] | undefined
      if (Array.isArray(urlList) && urlList.length > 0) {
        const best = urlList[urlList.length - 1]
        if (typeof best === 'string' && /^https?:\/\//i.test(best)) imageUrls.push(best)
      }
    }
  }
  const author = (item.author as { nickname?: string } | undefined)?.nickname ?? ''
  const cover = imageUrls[0] ?? ''

  return {
    kind: 'gallery',
    id: String(item.aweme_id ?? fallbackId),
    title: String(item.desc ?? 'Douyin Images').substring(0, 200),
    author: String(author),
    cover,
    imageUrls,
  }
}

/** Prefer gallery when images exist; fallback to video. */
function resolveMediaFromParsedData(data: Record<string, unknown>, contentId: string): DouyinMediaResult | null {
  let item = findAwemeItemDeep(data.loaderData)
  if (!item) item = findAwemeItemDeep(data)
  let gItem = findGalleryItemDeep(data.loaderData)
  if (!gItem) gItem = findGalleryItemDeep(data)
  if (gItem && itemHasImages(gItem)) {
    return buildDouyinGalleryFromItem(gItem, contentId)
  }
  if (item && itemHasImages(item)) {
    return buildDouyinGalleryFromItem(item, contentId)
  }
  if (item && itemHasPlayUri(item)) {
    return buildDouyinInfoFromItem(item, contentId)
  }
  return null
}

const JSON_MARKERS = ['_ROUTER_DATA', '__MODERN_ROUTER_DATA__', 'SIGI_STATE', 'SUPER_DATA'] as const

function tryParseEmbeddedJsonMarkers(html: string, contentId: string): DouyinMediaResult | null {
  for (const marker of JSON_MARKERS) {
    const jsonStr = extractBalancedJsonAfterMarker(html, marker)
    if (!jsonStr) continue
    try {
      const data = JSON.parse(jsonStr) as Record<string, unknown>
      const resolved = resolveMediaFromParsedData(data, contentId)
      if (resolved) return resolved
    } catch {
      /* try next marker */
    }
  }
  return null
}

/** SSR: URL-encoded JSON in <script id="RENDER_DATA"> */
function tryRenderDataScript(html: string, contentId: string): DouyinMediaResult | null {
  const m = html.match(/<script[^>]*\bid=["']RENDER_DATA["'][^>]*>([\s\S]*?)<\/script>/i)
  if (!m?.[1]) return null
  let raw = m[1].trim()
  try {
    raw = decodeURIComponent(raw)
  } catch {
    return null
  }
  try {
    const data = JSON.parse(raw) as Record<string, unknown>
    return resolveMediaFromParsedData(data, contentId)
  } catch {
    return null
  }
}

/** Next.js-style payload on some Douyin / iesdouyin layouts */
function tryNextDataScript(html: string, contentId: string): DouyinMediaResult | null {
  const m = html.match(/<script[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)
  if (!m?.[1]) return null
  const raw = m[1].trim()
  try {
    const data = JSON.parse(raw) as Record<string, unknown>
    return resolveMediaFromParsedData(data, contentId)
  } catch {
    return null
  }
}

function decodeBasicHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function looseOgMeta(html: string): { title: string; cover: string } {
  const ogTitle =
    html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']*)["']/i)?.[1] ??
    html.match(/<meta\s+name=["']twitter:title["']\s+content=["']([^"']*)["']/i)?.[1] ??
    html.match(/<title>([^<]{1,240})<\/title>/i)?.[1] ??
    'Douyin Video'
  const ogImage =
    html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i)?.[1] ?? ''
  return {
    title: decodeBasicHtmlEntities(ogTitle).slice(0, 200),
    cover: ogImage,
  }
}

function isLikelyAwemeVideoId(id: string): boolean {
  return /^\d{12,}$/.test(id) || /^[\da-f]{16,}$/i.test(id)
}

/** Last resort: HTML may omit _ROUTER_DATA but still embed play URLs or escaped play_addr.uri. */
function tryLoosePlayAddrInHtml(html: string, videoId: string): DouyinVideoInfo | null {
  const { title, cover } = looseOgMeta(html)
  const fromUri = (uri: string): DouyinVideoInfo => ({
    kind: 'video',
    id: videoId,
    title,
    author: '',
    videoUrl: `https://aweme.snssdk.com/aweme/v1/play/?video_id=${uri}&ratio=720p&line=0`,
    duration: 0,
    cover,
  })

  const globalRes = [
    html.match(/aweme\/v1\/play\/\?[^"'\s<>]*video_id=(\d{12,})/),
    html.match(/aweme\/v1\/play\/\?[^"'\s<>]*video_id=([\da-f]{16,})/i),
    html.match(/video_id%3D(\d{12,})/i),
    html.match(/video_id%3D([\da-f]{16,})/i),
  ]
  for (const m of globalRes) {
    const id = m?.[1]
    if (id && isLikelyAwemeVideoId(id)) return fromUri(id)
  }

  const uriInChunk = (chunk: string): string | null => {
    const patterns = [
      /"uri"\s*:\s*"(\d{12,})"/,
      /\\"uri\\"\s*:\s*\\"(\d{12,})\\"/,
      /'uri'\s*:\s*'(\d{12,})'/,
    ]
    for (const re of patterns) {
      const um = chunk.match(re)
      const id = um?.[1]
      if (id && isLikelyAwemeVideoId(id)) return id
    }
    return null
  }

  for (const sep of ['"play_addr"', '"playAddr"']) {
    const chunks = html.split(sep)
    if (chunks.length < 2) continue
    for (let i = 1; i < chunks.length; i++) {
      const chunk = chunks[i].slice(0, 12000)
      const uri = uriInChunk(chunk)
      if (uri) return fromUri(uri)
    }
  }
  return null
}

/** SSR sometimes has empty `item_list` but embeds this aweme's `uri` near `aweme_id`. */
function tryLooseNearAwemeId(html: string, videoId: string): DouyinVideoInfo | null {
  if (!/^\d{10,}$/.test(videoId)) return null
  const needles = [`"aweme_id":"${videoId}"`, `'aweme_id':'${videoId}'`, `"aweme_id": "${videoId}"`]
  let pos = -1
  for (const n of needles) {
    const i = html.indexOf(n)
    if (i !== -1) {
      pos = i
      break
    }
  }
  if (pos === -1) return null

  const slice = html.slice(pos, pos + 55_000)
  const { title, cover } = looseOgMeta(html)
  const fromUri = (uri: string): DouyinVideoInfo => ({
    kind: 'video',
    id: videoId,
    title,
    author: '',
    videoUrl: `https://aweme.snssdk.com/aweme/v1/play/?video_id=${uri}&ratio=720p&line=0`,
    duration: 0,
    cover,
  })
  const uriInChunk = (chunk: string): string | null => {
    for (const re of [/\\"uri\\"\s*:\s*\\"(\d{12,})\\"/, /"uri"\s*:\s*"(\d{12,})"/, /'uri'\s*:\s*'(\d{12,})'/]) {
      const um = chunk.match(re)
      const id = um?.[1]
      if (id && isLikelyAwemeVideoId(id)) return id
    }
    return null
  }
  for (const sep of ['"play_addr"', '"playAddr"']) {
    const chunks = slice.split(sep)
    if (chunks.length < 2) continue
    for (let i = 1; i < chunks.length; i++) {
      const uri = uriInChunk(chunks[i].slice(0, 12_000))
      if (uri) return fromUri(uri)
    }
  }
  const fallback = slice.match(/"uri"\s*:\s*"(\d{12,})"/)?.[1] ?? slice.match(/\\"uri\\"\s*:\s*\\"(\d{12,})\\"/)?.[1]
  if (fallback && isLikelyAwemeVideoId(fallback)) return fromUri(fallback)
  return null
}

function parseDouyinPageHtml(html: string, contentId: string): DouyinMediaResult {
  const fromMarkers = tryParseEmbeddedJsonMarkers(html, contentId)
  if (fromMarkers) return fromMarkers

  const fromRender = tryRenderDataScript(html, contentId)
  if (fromRender) return fromRender

  const fromNext = tryNextDataScript(html, contentId)
  if (fromNext) return fromNext

  const loose = tryLoosePlayAddrInHtml(html, contentId)
  if (loose) return loose

  let jsonStr = extractBalancedJsonAfterMarker(html, '_ROUTER_DATA')
  if (!jsonStr) {
    const m = html.match(/_ROUTER_DATA\s*=\s*(\{[\s\S]*?\})\s*<\/script>/i)
    if (!m) throw new Error('No _ROUTER_DATA found in page')
    jsonStr = m[1]
  }

  const data = JSON.parse(jsonStr) as Record<string, unknown>
  const resolved = resolveMediaFromParsedData(data, contentId)
  if (resolved) return resolved

  const pageData = (data.loaderData as Record<string, unknown> | undefined)?.['video_(id)/page'] as
    | Record<string, unknown>
    | undefined
  const videoInfoRes = pageData?.videoInfoRes as Record<string, unknown> | undefined
  const itemList = videoInfoRes?.item_list as unknown[] | undefined
  const legacyItem = itemList?.[0] as Record<string, unknown> | undefined
  if (legacyItem && itemHasImages(legacyItem)) {
    return buildDouyinGalleryFromItem(legacyItem, contentId)
  }
  if (legacyItem && itemHasPlayUri(legacyItem)) {
    return buildDouyinInfoFromItem(legacyItem, contentId)
  }

  const nearAweme = tryLooseNearAwemeId(html, contentId)
  if (nearAweme) return nearAweme

  throw new Error('No video item in page data (layout not recognized or empty item_list)')
}

function isSnssdkPlayUrl(u: string): boolean {
  return /aweme\.snssdk\.com/i.test(u)
}

function hasDouyinCdnPlayUrl(urls: string[]): boolean {
  return urls.some((u) => /douyinvod|bytecdn|ixigua|amemv|zjcdn|tos-cn-/i.test(u))
}

function normalizeEscapedPlayUrl(u: string): string {
  return u.replace(/\\u002F/gi, '/').replace(/\\\//g, '/').replace(/&amp;/g, '&')
}

/** Pull signed CDN play URLs from hydrated share-page HTML (escaped JSON strings). */
function extractCdnPlayUrlsFromHtml(html: string): string[] {
  const out: string[] = []
  const patterns = [
    /https?:\\?\/\\?\/[^"'\s\\<>]+douyinvod\.com[^"'\s\\<>]*/gi,
    /https?:\\?\/\\?\/[^"'\s\\<>]+\.bytecdn\.com\/[^"'\s\\<>]*(?:mime_type=video|\/video\/)[^"'\s\\<>]*/gi,
    /https?:\\?\/\\?\/[^"'\s\\<>]+(?:zjcdn|ixigua|amemv)\.com[^"'\s\\<>]*/gi,
    /https?:\/\/[^"'\s\\<>]+douyinvod\.com[^"'\s\\<>]*/gi,
  ]
  for (const re of patterns) {
    for (const m of html.matchAll(re)) {
      const u = normalizeEscapedPlayUrl(m[0])
      if (hasDouyinCdnPlayUrl([u]) && !out.includes(u)) out.push(u)
    }
  }
  return out
}

function enrichInfoWithPlayUrls(info: DouyinVideoInfo, urls: string[]): DouyinVideoInfo | null {
  const clean = [...new Set(urls.filter(Boolean))]
  if (clean.length === 0) return null
  const existing = [info.videoUrl, ...(info.videoUrlFallbacks ?? [])].filter(Boolean)
  return {
    ...info,
    videoUrl: clean[clean.length - 1]!,
    videoUrlFallbacks: [...new Set([...clean.slice(0, -1), ...existing])],
  }
}

function parseAwemeDetailBody(bodyText: string, awemeId: string): Record<string, unknown> | null {
  if (!bodyText.trim()) return null
  let j: Record<string, unknown>
  try {
    j = JSON.parse(bodyText) as Record<string, unknown>
  } catch {
    console.warn(`[douyin] aweme/detail API non-JSON for ${awemeId}:`, bodyText.slice(0, 120))
    return null
  }
  const data = j.data != null && typeof j.data === 'object' ? (j.data as Record<string, unknown>) : null
  const item = (j.aweme_detail ?? data?.aweme_detail) as Record<string, unknown> | undefined
  if (!item || typeof item !== 'object') return null
  return item
}

async function fetchAwemeDetailItem(
  awemeId: string,
  cookiesFilePath?: string,
  options?: { viaHydrateSession?: boolean; signal?: AbortSignal }
): Promise<Record<string, unknown> | null> {
  throwIfDouyinAborted(options?.signal)

  for (let attempt = 0; attempt < DETAIL_API_MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await sleep(DETAIL_API_RETRY_DELAYS_MS[attempt - 1] ?? 5000)
      throwIfDouyinAborted(options?.signal)
    }

    try {
      const cookieCtx = await resolveDouyinCookieContext(cookiesFilePath)
      const url = buildSignedAwemeDetailUrl(awemeId, cookiesFilePath, cookieCtx.map)
      let bodyText = ''
      let status = 200

      if (options?.viaHydrateSession) {
        bodyText = await fetchTextWithDouyinSession(url, cookiesFilePath)
      } else {
        const cookieHeader =
          cookieCtx.header ?? (await buildDouyinCookieHeader(cookiesFilePath)) ?? undefined
        const headers: Record<string, string> = {
          'User-Agent': DESKTOP_UA,
          Referer: `https://www.douyin.com/video/${awemeId}`,
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          Accept: 'application/json, text/plain, */*',
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        }
        const res = await fetch(url, { headers, redirect: 'follow', signal: options?.signal })
        status = res.status
        bodyText = await res.text()
        if (!res.ok) {
          console.warn(`[douyin] aweme/detail API HTTP ${res.status} for ${awemeId}`)
          if (status === 429 || status >= 500 || !bodyText.trim()) continue
          return null
        }
      }

      const item = parseAwemeDetailBody(bodyText, awemeId)
      if (item) return item

      if (!bodyText.trim()) {
        console.warn(
          `[douyin] aweme/detail API empty body for ${awemeId}${options?.viaHydrateSession ? ' (session)' : ''} attempt=${attempt + 1}`
        )
        continue
      }
      return null
    } catch (e) {
      if (isDouyinAbortError(e)) throw e
      if (attempt === DETAIL_API_MAX_ATTEMPTS - 1) {
        console.warn(
          `[douyin] aweme/detail API failed for ${awemeId}:`,
          e instanceof Error ? e.message : e
        )
      }
    }
  }
  return null
}

function mediaResultFromAwemeItem(
  item: Record<string, unknown>,
  awemeId: string,
  preferGallery = false
): DouyinMediaResult | null {
  if (preferGallery && itemHasImages(item)) {
    return buildDouyinGalleryFromItem(item, awemeId)
  }
  if (itemHasImages(item) && !itemHasPlayUri(item)) {
    return buildDouyinGalleryFromItem(item, awemeId)
  }
  if (itemHasPlayUri(item)) {
    return buildDouyinInfoFromItem(item, awemeId)
  }
  if (itemHasImages(item)) {
    return buildDouyinGalleryFromItem(item, awemeId)
  }
  return null
}

/** Fast path for profile-picker bulk enqueue — signed aweme/detail API, no Chromium page scrape. */
export async function getDouyinInfoForProfilePick(
  awemeId: string,
  cookiesFilePath?: string,
  options?: DouyinFetchOptions & { mediaType?: string }
): Promise<DouyinMediaResult | null> {
  const id = awemeId.trim()
  if (!id) return null

  const preferGallery = options?.mediaType === 'note' || options?.mediaType === 'gallery'

  const cached = getCachedProfileAwemeItem(id)
  if (cached) {
    const fromCache = mediaResultFromAwemeItem(cached, id, preferGallery)
    if (fromCache) {
      const hasPlayable =
        isDouyinGallery(fromCache) ||
        Boolean(fromCache.videoUrl) ||
        Boolean(fromCache.videoUrlFallbacks?.length)
      if (hasPlayable) {
        console.log(
          `[douyin] profile pick ${id} from listing cache kind=${isDouyinGallery(fromCache) ? 'gallery' : 'video'}`
        )
        lastGetDouyinInfoError = ''
        return fromCache
      }
    }
    if (!preferGallery && cached.video && typeof cached.video === 'object') {
      const author = String((cached.author as { nickname?: string } | undefined)?.nickname ?? '').trim()
      const title = String(cached.desc ?? '').trim().slice(0, 200) || `Aweme ${id}`
      console.log(`[douyin] profile pick ${id} from listing cache (snssdk play API)`)
      lastGetDouyinInfoError = ''
      return {
        kind: 'video',
        id,
        title,
        author,
        videoUrl: `https://aweme.snssdk.com/aweme/v1/play/?video_id=${id}&ratio=720p&line=0`,
        duration: 0,
        cover: '',
      }
    }
  }

  for (const viaSession of [false, true]) {
    throwIfDouyinAborted(options?.signal)
    const item = await fetchAwemeDetailItem(id, cookiesFilePath, {
      viaHydrateSession: viaSession,
      signal: options?.signal,
    })
    if (!item) continue
    const result = mediaResultFromAwemeItem(item, id, preferGallery)
    if (result) {
      console.log(
        `[douyin] profile pick ${id} via aweme/detail API${viaSession ? ' (session)' : ''} kind=${isDouyinGallery(result) ? 'gallery' : 'video'}`
      )
      lastGetDouyinInfoError = ''
      return result
    }
  }
  return null
}

async function tryEnrichFromAwemeDetailApi(
  info: DouyinVideoInfo,
  cookiesFilePath?: string,
  viaHydrateSession = false,
  signal?: AbortSignal
): Promise<DouyinVideoInfo | null> {
  try {
    const item = await fetchAwemeDetailItem(info.id, cookiesFilePath, { viaHydrateSession, signal })
    if (!item) return null
    const refreshed = buildDouyinInfoFromItem(item, info.id)
    const fresh = [refreshed.videoUrl, ...(refreshed.videoUrlFallbacks ?? [])].filter(Boolean)
    if (hasDouyinCdnPlayUrl(fresh) || fresh.some((u) => !isSnssdkPlayUrl(u))) {
      console.log(
        `[douyin] Enriched play URLs via aweme/detail API${viaHydrateSession ? ' (hydrate session)' : ''} for ${info.id}`
      )
      return { ...info, ...refreshed }
    }
  } catch (e) {
    if (isDouyinAbortError(e)) throw e
    console.warn(
      `[douyin] aweme/detail API failed for ${info.id}:`,
      e instanceof Error ? e.message : e
    )
  }
  return null
}

/** Mobile HTML often only has snssdk play API; signed API / Chromium hydrate yield CDN urls. */
export async function enrichDouyinVideoPlayUrls(
  info: DouyinVideoInfo,
  cookiesFilePath?: string,
  options?: DouyinFetchOptions
): Promise<DouyinVideoInfo> {
  throwIfDouyinAborted(options?.signal)
  const existing = [info.videoUrl, ...(info.videoUrlFallbacks ?? [])].filter(Boolean)
  if (hasDouyinCdnPlayUrl(existing)) return info

  const fromApi = await tryEnrichFromAwemeDetailApi(info, cookiesFilePath, false, options?.signal)
  throwIfDouyinAborted(options?.signal)
  if (fromApi) return fromApi

  const capturedCdnUrls: string[] = []
  let html = ''
  try {
    const shareUrl = `https://m.douyin.com/share/video/${info.id}`
    console.log(`[douyin] Enriching play URLs via Chromium for ${info.id} (${shareUrl})`)
    html = await fetchDouyinHtmlWithChromium(shareUrl, {
      cookiesFilePath,
      timeoutMs: 24_000,
      preferredUa: 'mobile',
      capturedCdnUrls,
      enrichmentMode: true,
    })
  } catch (e) {
    if (isDouyinAbortError(e)) throw e
    console.warn(
      `[douyin] Play URL enrichment failed for ${info.id} (m.douyin):`,
      e instanceof Error ? e.message : e
    )
  }

  throwIfDouyinAborted(options?.signal)
  if (capturedCdnUrls.length > 0) {
    console.log(`[douyin] Using ${capturedCdnUrls.length} Chromium CDN url(s) for ${info.id}`)
    const enriched = enrichInfoWithPlayUrls(info, capturedCdnUrls)
    if (enriched) return enriched
  }

  if (html) {
    const fromHtml = extractCdnPlayUrlsFromHtml(html)
    if (fromHtml.length > 0) {
      console.log(`[douyin] Extracted ${fromHtml.length} CDN url(s) from hydrated HTML for ${info.id}`)
      const enriched = enrichInfoWithPlayUrls(info, fromHtml)
      if (enriched) return enriched
    }
  }

  const fromSessionApi = await tryEnrichFromAwemeDetailApi(info, cookiesFilePath, true, options?.signal)
  throwIfDouyinAborted(options?.signal)
  if (fromSessionApi) return fromSessionApi

  if (html) {
    try {
      const refreshed = parseDouyinPageHtml(html, info.id)
      if (refreshed && !isDouyinGallery(refreshed)) {
        const fresh = [refreshed.videoUrl, ...(refreshed.videoUrlFallbacks ?? [])].filter(Boolean)
        if (hasDouyinCdnPlayUrl(fresh) || fresh.some((u) => !isSnssdkPlayUrl(u))) {
          console.log(`[douyin] Enriched play URLs from parsed HTML for ${info.id}: ${fresh[0]?.slice(0, 80)}…`)
          return refreshed
        }
      }
    } catch {
      /* parse failed */
    }
  }

  return info
}

export async function getDouyinInfo(
  url: string,
  cookiesFilePath?: string,
  options?: DouyinFetchOptions
): Promise<DouyinMediaResult | null> {
  if (!isDouyinUrl(url)) return null

  throwIfDouyinAborted(options?.signal)
  lastGetDouyinInfoError = ''

  const safeHost = (u: string) => {
    try {
      return new URL(u).hostname
    } catch {
      return '(bad-url)'
    }
  }

  try {
    console.log(`[douyin] Resolving URL host=${safeHost(url)}`)
    const resolved = await resolveShortUrl(url)
    throwIfDouyinAborted(options?.signal)
    console.log(`[douyin] Resolved host=${safeHost(resolved)}`)

    const contentId = extractContentId(resolved)
    if (!contentId) {
      console.log(`[douyin] Could not extract content ID from resolved URL`)
      lastGetDouyinInfoError = 'Could not extract video/note id from resolved URL'
      return null
    }
    console.log(`[douyin] Content ID: ${contentId}`)

    const isNote = /\/note\//i.test(resolved)
    /** Mobile share often returns parseable HTML without Chromium; `www.douyin.com/video` frequently serves an acrawler shell from non-CN IPs that Electron rarely hydrates before timeout. */
    const canonical = `https://www.douyin.com/video/${contentId}`
    const mShare = `https://m.douyin.com/share/video/${contentId}`
    const pageUrls: string[] = isNote
      ? [
          `https://m.douyin.com/share/note/${contentId}`,
          `https://www.douyin.com/note/${contentId}`,
          `https://www.iesdouyin.com/share/note/${contentId}`,
          canonical,
          mShare,
        ]
      : [mShare, canonical, `https://www.iesdouyin.com/share/video/${contentId}`, `https://m.iesdouyin.com/share/video/${contentId}`]
    const resolvedNoHash = resolved.split('#')[0].trim()
    if (
      /^https?:\/\//i.test(resolvedNoHash) &&
      /douyin/i.test(resolvedNoHash) &&
      !pageUrls.includes(resolvedNoHash)
    ) {
      pageUrls.push(resolvedNoHash)
    }

    let lastErr = ''
    for (const pageUrl of pageUrls) {
      throwIfDouyinAborted(options?.signal)
      let chromiumReturnedForThisUrl = false
      for (const uaMode of ['mobile', 'desktop'] as FetchUaMode[]) {
        throwIfDouyinAborted(options?.signal)
        try {
          let html = await fetchDouyinHtml(pageUrl, cookiesFilePath, uaMode)
          if (isDouyinAntiBotShell(html)) {
            if (/^https:\/\/www\.douyin\.com\/video\//i.test(pageUrl)) {
              lastErr =
                'www.douyin.com/video returned anti-bot shell (skipped Electron hydrate; trying other hosts)'
              console.warn(
                `[douyin] Anti-bot shell from Node fetch (${html.length} bytes) on host=${safeHost(pageUrl)}; skipping Chromium (often times out here)…`
              )
              break
            }
            if (chromiumReturnedForThisUrl) {
              throw new Error('Anti-bot shell: Chromium already fetched HTML for this URL')
            }
            console.warn(
              `[douyin] Anti-bot shell from Node fetch (${html.length} bytes); hydrating host=${safeHost(pageUrl)} in Chromium…`
            )
            html = await fetchDouyinHtmlWithChromium(pageUrl, {
              cookiesFilePath,
              preferredUa: uaMode === 'mobile' ? 'mobile' : 'desktop',
              enrichmentMode: true,
            })
            chromiumReturnedForThisUrl = true
          }
          console.log(`[douyin] Fetched host=${safeHost(pageUrl)} (${uaMode}, ${html.length} bytes)`)
          let info: DouyinMediaResult
          try {
            info = parseDouyinPageHtml(html, contentId)
          } catch (parseErr) {
            const alreadyCanonical = /^https:\/\/www\.douyin\.com\/video\//i.test(pageUrl)
            if (alreadyCanonical) {
              throw parseErr
            }
            let recovered: DouyinMediaResult | undefined
            for (const ua of ['mobile', 'desktop'] as const) {
              try {
                console.warn(
                  `[douyin] Parse failed on ${pageUrl} (${uaMode}): ${parseErr instanceof Error ? parseErr.message : String(parseErr)}; Chromium on canonical (${ua})…`
                )
                const htmlCanon = await fetchDouyinHtmlWithChromium(canonical, {
                  cookiesFilePath,
                  timeoutMs: 92_000,
                  preferredUa: ua,
                  enrichmentMode: true,
                })
                recovered = parseDouyinPageHtml(htmlCanon, contentId)
                break
              } catch {
                /* try next UA */
              }
            }
            if (recovered) {
              info = recovered
            } else {
              throw parseErr
            }
          }
          console.log(
            `[douyin] Parsed: title="${info.title}", author="${info.author}", kind=${isDouyinGallery(info) ? 'gallery' : 'video'}`
          )
          lastGetDouyinInfoError = ''
          return info
        } catch (e) {
          lastErr = e instanceof Error ? e.message : String(e)
          console.warn(`[douyin] ${pageUrl} (${uaMode}) failed:`, lastErr)
        }
      }
    }

    try {
      throwIfDouyinAborted(options?.signal)
      let html: string
      try {
        console.warn('[douyin] Plain fetches failed; Chromium on mobile share URL…')
        html = await fetchDouyinHtmlWithChromium(mShare, {
          cookiesFilePath,
          timeoutMs: 88_000,
          preferredUa: 'mobile',
          enrichmentMode: true,
        })
      } catch (shareChErr) {
        console.warn('[douyin] Mobile share Chromium failed; trying canonical (mobile UA)…', shareChErr)
        try {
          html = await fetchDouyinHtmlWithChromium(canonical, {
            cookiesFilePath,
            timeoutMs: 88_000,
            preferredUa: 'mobile',
            enrichmentMode: true,
          })
        } catch (firstCh) {
          console.warn('[douyin] Canonical Chromium (mobile UA) failed, retrying with desktop UA…', firstCh)
          html = await fetchDouyinHtmlWithChromium(canonical, {
            cookiesFilePath,
            timeoutMs: 88_000,
            preferredUa: 'desktop',
            enrichmentMode: true,
          })
        }
      }
      let info: DouyinMediaResult
      try {
        info = parseDouyinPageHtml(html, contentId)
      } catch (parseErr) {
        console.warn(
          '[douyin] Chromium first URL parse failed; hydrating canonical page…',
          parseErr instanceof Error ? parseErr.message : parseErr
        )
        html = await fetchDouyinHtmlWithChromium(canonical, {
          cookiesFilePath,
          timeoutMs: 92_000,
          preferredUa: 'mobile',
          enrichmentMode: true,
        })
        try {
          info = parseDouyinPageHtml(html, contentId)
        } catch {
          html = await fetchDouyinHtmlWithChromium(canonical, {
            cookiesFilePath,
            timeoutMs: 92_000,
            preferredUa: 'desktop',
            enrichmentMode: true,
          })
          info = parseDouyinPageHtml(html, contentId)
        }
      }
      console.log(
        `[douyin] Parsed (Chromium): title="${info.title}", author="${info.author}", kind=${isDouyinGallery(info) ? 'gallery' : 'video'}`
      )
      lastGetDouyinInfoError = ''
      return info
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e)
      console.warn('[douyin] Chromium fallback failed:', lastErr)
    }

    lastGetDouyinInfoError = lastErr || 'All Douyin page sources failed'
    return null
  } catch (err) {
    if (isDouyinAbortError(err)) throw err
    lastGetDouyinInfoError = err instanceof Error ? err.message : String(err)
    console.warn('[douyin] getDouyinInfo failed:', lastGetDouyinInfoError)
    return null
  }
}

function mergeCookieHeaderStrings(...parts: string[]): string {
  const map = new Map<string, string>()
  for (const part of parts) {
    if (!part.trim()) continue
    for (const pair of part.split(';')) {
      const eq = pair.indexOf('=')
      if (eq < 1) continue
      const name = pair.slice(0, eq).trim()
      const value = pair.slice(eq + 1).trim()
      if (name) map.set(name, value)
    }
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
}

async function buildDouyinMediaDownloadHeaders(
  cookiesFilePath: string | undefined,
  userAgent: string
): Promise<Record<string, string>> {
  const fromFile =
    cookiesFilePath && cookiesFilePath.trim()
      ? buildCookieHeaderFromNetscapeFile(resolve(cookiesFilePath.trim()))
      : ''
  const fromSession = await getDouyinHydrateSessionCookieHeader().catch(() => '')
  const cookieHeader = mergeCookieHeaderStrings(fromFile, fromSession)
  return {
    'User-Agent': userAgent,
    Referer: 'https://www.douyin.com/',
    Origin: 'https://www.douyin.com',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
  }
}

export async function downloadDouyinVideo(
  videoUrl: string,
  outputDir: string,
  title: string,
  cookiesFilePath: string | undefined,
  onProgress?: (progress: DouyinDownloadProgress) => void,
  alternateUrls?: string[],
  options?: DouyinFetchOptions
): Promise<string> {
  throwIfDouyinAborted(options?.signal)
  mkdirSync(outputDir, { recursive: true })

  const safeTitle = sanitizeDownloadBasename(title, 100)
  const outputPath = join(outputDir, `${safeTitle}.mp4`)

  console.log(`[douyin] Downloading to: ${outputPath}`)

  const urls = [...new Set([videoUrl, ...(alternateUrls ?? [])].filter((u) => u && /^https?:\/\//i.test(u)))]
  if (urls.length === 0) throw new Error('No video URL to download')

  const uas = [DESKTOP_UA, MOBILE_UA]
  let lastErr = 'Download failed'
  for (const url of urls) {
    throwIfDouyinAborted(options?.signal)
    try {
      await downloadUrlWithDouyinSession(url, outputPath, cookiesFilePath, onProgress)
      console.log(`[douyin] Download complete (Chromium session)`)
      return outputPath
    } catch (e) {
      if (isDouyinAbortError(e)) throw e
      lastErr = e instanceof Error ? e.message : String(e)
      console.warn(`[douyin] Session download failed for ${url.slice(0, 72)}…: ${lastErr}`)
    }

    for (const ua of uas) {
      throwIfDouyinAborted(options?.signal)
      const res = await fetchWith429Backoff(url, {
        headers: await buildDouyinMediaDownloadHeaders(cookiesFilePath, ua),
        redirect: 'follow',
      })
      if (!res.ok || !res.body) {
        lastErr = `Download failed: ${res.status} ${res.statusText}`
        if (res.status === 403 || res.status === 401) continue
        break
      }

      const contentLength = Number(res.headers.get('content-length') ?? 0)
      const fileStream = createWriteStream(outputPath)
      const reporter = createDouyinDownloadProgressReporter(contentLength, onProgress)

      const transform = new TransformStream({
        transform(chunk: Uint8Array, controller: TransformStreamDefaultController<Uint8Array>) {
          reporter.addBytes(chunk.byteLength)
          controller.enqueue(chunk)
        },
      })

      const readable = Readable.fromWeb(res.body.pipeThrough(transform as any) as any)
      await pipeline(readable, fileStream)

      console.log(`[douyin] Download complete: ${(contentLength > 0 ? contentLength / 1024 / 1024 : 0).toFixed(1)} MB`)
      return outputPath
    }
  }

  throw new Error(lastErr)
}

function extFromImageUrl(u: string): string {
  try {
    const p = new URL(u).pathname.toLowerCase()
    if (p.endsWith('.png')) return 'png'
    if (p.endsWith('.webp')) return 'webp'
    if (p.endsWith('.jpeg')) return 'jpeg'
    if (p.endsWith('.jpg')) return 'jpg'
  } catch {
    /* ignore */
  }
  return 'jpg'
}

const GALLERY_IMAGE_PARALLEL = 6

async function fetchWith429Backoff(url: string, init: RequestInit): Promise<Response> {
  let res = await fetch(url, init)
  if (res.status === 429) {
    const ra = res.headers.get('retry-after')
    let ms = 3000
    if (ra) {
      const sec = parseInt(ra, 10)
      if (Number.isFinite(sec) && sec > 0 && sec < 3600) ms = sec * 1000
    }
    await new Promise((r) => setTimeout(r, ms))
    res = await fetch(url, init)
  }
  return res
}

/** Download all images from a Douyin note / gallery into `outputDir/<title>/`. */
export async function downloadDouyinImageGallery(
  imageUrls: string[],
  outputDir: string,
  title: string,
  cookiesFilePath: string | undefined,
  onProgress?: (percent: number) => void,
  options?: DouyinFetchOptions
): Promise<string> {
  throwIfDouyinAborted(options?.signal)
  if (imageUrls.length === 0) throw new Error('No image URLs to download')

  const safeTitle = sanitizeDownloadBasename(title, 80)
  const subDir = join(outputDir, safeTitle)
  mkdirSync(subDir, { recursive: true })

  const cookieHeader =
    cookiesFilePath && cookiesFilePath.trim()
      ? buildCookieHeaderFromNetscapeFile(resolve(cookiesFilePath.trim()))
      : ''

  const n = imageUrls.length
  const headers = {
    'User-Agent': DESKTOP_UA,
    Referer: 'https://www.douyin.com/',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
  } as Record<string, string>

  let completed = 0
  const bump = () => {
    completed++
    onProgress?.(Math.min(99, Math.round((completed / n) * 100)))
  }

  let cursor = 0
  async function worker(): Promise<void> {
    while (true) {
      throwIfDouyinAborted(options?.signal)
      const idx = cursor++
      if (idx >= n) break
      const url = imageUrls[idx]
      const i = idx + 1
      const ext = extFromImageUrl(url)
      const dest = join(subDir, `${String(i).padStart(3, '0')}.${ext}`)
      const res = await fetchWith429Backoff(url, {
        headers,
        redirect: 'follow',
      })
      if (!res.ok) {
        throw new Error(`Image ${i} failed: ${res.status} ${res.statusText}`)
      }
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length < 64) {
        throw new Error(`Image ${i} response too small`)
      }
      writeFileSync(dest, buf)
      bump()
    }
  }

  const pool = Math.min(GALLERY_IMAGE_PARALLEL, n)
  await Promise.all(Array.from({ length: pool }, () => worker()))

  if (onProgress) onProgress(100)
  return subDir
}
