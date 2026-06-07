import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import { sanitizeDownloadBasename } from './sanitizeFilename.js'
import { config } from './config.js'

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'

const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export interface DouyinVideoInfo {
  kind?: 'video'
  id: string
  title: string
  author: string
  videoUrl: string
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

/** Last failure reason from `getDouyinInfo` (for queue / bot messages). */
let lastGetDouyinInfoError = ''

export function getLastDouyinInfoError(): string {
  return lastGetDouyinInfoError
}

function isDouyinUrl(url: string): boolean {
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

function buildCookieHeaderFromNetscapeFile(cookiePath: string): string {
  if (!existsSync(cookiePath)) return ''
  const content = readFileSync(cookiePath, 'utf-8')
  const cookies: string[] = []
  for (const line of content.split('\n')) {
    if (line.startsWith('#') || !line.trim()) continue
    const parts = line.split('\t')
    if (parts.length >= 7 && /douyin/i.test(parts[0])) {
      cookies.push(`${parts[5]}=${parts[6]}`)
    }
  }
  return cookies.join('; ')
}

type FetchUaMode = 'mobile' | 'desktop'

async function fetchDouyinHtml(pageUrl: string, uaMode: FetchUaMode): Promise<string> {
  const ua = uaMode === 'desktop' ? DESKTOP_UA : MOBILE_UA
  const headers: Record<string, string> = {
    'User-Agent': ua,
    Referer: 'https://www.douyin.com/',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  }
  const cookiePath = resolve(config.cookiesFilePath)
  const cookieHeader = buildCookieHeaderFromNetscapeFile(cookiePath)
  if (cookieHeader) headers.Cookie = cookieHeader

  const res = await fetch(pageUrl, { headers, redirect: 'follow' })
  if (!res.ok) throw new Error(`Page fetch failed: ${res.status}`)
  return res.text()
}

/** Extract `{...}` assignment after `marker` = (handles strings with `{` `}`). */
function extractBalancedJsonAfterMarker(html: string, marker: string): string | null {
  const pos = html.indexOf(marker)
  if (pos === -1) return null
  const eq = html.indexOf('=', pos + marker.length)
  if (eq === -1) return null
  let j = eq + 1
  while (j < html.length && /\s/.test(html[j])) j++
  if (j >= html.length || html[j] !== '{') return null

  let depth = 0
  let inStr = false
  let quote: '"' | "'" | null = null
  let escape = false
  const start = j

  for (; j < html.length; j++) {
    const c = html[j]
    if (inStr) {
      if (escape) {
        escape = false
        continue
      }
      if (c === '\\') {
        escape = true
        continue
      }
      if (quote && c === quote) {
        inStr = false
        quote = null
        continue
      }
      continue
    }
    if (c === '"' || c === "'") {
      inStr = true
      quote = c as '"' | "'"
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return html.slice(start, j + 1)
    }
  }
  return null
}

function videoPlayAddr(video: Record<string, unknown>): Record<string, unknown> | null {
  const pa = video.play_addr ?? video.playAddr
  if (!pa || typeof pa !== 'object') return null
  return pa as Record<string, unknown>
}

function itemHasPlayUri(o: Record<string, unknown>): boolean {
  const v = o.video
  if (!v || typeof v !== 'object') return false
  const pa = videoPlayAddr(v as Record<string, unknown>)
  if (!pa) return false
  return typeof pa.uri === 'string'
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

function buildDouyinInfoFromItem(item: Record<string, unknown>, fallbackId: string): DouyinVideoInfo {
  const video = item.video as Record<string, unknown>
  const playAddr = videoPlayAddr(video) as Record<string, unknown>
  const uri = String(playAddr.uri)
  const videoUrl = `https://aweme.snssdk.com/aweme/v1/play/?video_id=${uri}&ratio=720p&line=0`
  const coverList = (video.cover as { url_list?: string[] } | undefined)?.url_list
  const coverUrl = coverList?.[0] ?? ''
  const author = (item.author as { nickname?: string } | undefined)?.nickname ?? ''

  return {
    kind: 'video',
    id: String(item.aweme_id ?? fallbackId),
    title: String(item.desc ?? 'Douyin Video').substring(0, 200),
    author: String(author),
    videoUrl,
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
  return null
}

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
  return null
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
      const vid = um?.[1]
      if (vid && isLikelyAwemeVideoId(vid)) return vid
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

export async function getDouyinInfo(url: string): Promise<DouyinMediaResult | null> {
  if (!isDouyinUrl(url)) return null

  lastGetDouyinInfoError = ''

  try {
    console.log(`[douyin] Resolving URL: ${url}`)
    const resolved = await resolveShortUrl(url)
    console.log(`[douyin] Resolved to: ${resolved}`)

    const contentId = extractContentId(resolved)
    if (!contentId) {
      console.log(`[douyin] Could not extract content ID from: ${resolved}`)
      lastGetDouyinInfoError = 'Could not extract video/note id from resolved URL'
      return null
    }
    console.log(`[douyin] Content ID: ${contentId}`)

    const isNote = /\/note\//i.test(resolved)
    const resolvedNoHash = resolved.split('#')[0].trim()
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
      : [
          mShare,
          canonical,
          `https://www.iesdouyin.com/share/video/${contentId}`,
          `https://m.iesdouyin.com/share/video/${contentId}`,
        ]
    if (
      /^https?:\/\//i.test(resolvedNoHash) &&
      /douyin/i.test(resolvedNoHash) &&
      !pageUrls.includes(resolvedNoHash)
    ) {
      pageUrls.push(resolvedNoHash)
    }

    let lastErr = ''
    for (const pageUrl of pageUrls) {
      for (const uaMode of ['mobile', 'desktop'] as FetchUaMode[]) {
        try {
          const html = await fetchDouyinHtml(pageUrl, uaMode)
          console.log(`[douyin] Fetched ${pageUrl} (${uaMode}, ${html.length} bytes)`)
          const info = parseDouyinPageHtml(html, contentId)
          const kind = isDouyinGallery(info) ? `gallery images=${info.imageUrls.length}` : `video duration=${info.duration}s`
          console.log(`[douyin] Parsed: title="${info.title}", author="${info.author}", ${kind}`)
          lastGetDouyinInfoError = ''
          return info
        } catch (e) {
          lastErr = e instanceof Error ? e.message : String(e)
          lastGetDouyinInfoError = lastErr
          console.warn(`[douyin] ${pageUrl} (${uaMode}) failed:`, lastErr)
        }
      }
    }

    if (config.douyinPlaywright) {
      const cookiePath = resolve(config.cookiesFilePath)
      if (!existsSync(cookiePath)) {
        console.warn('[douyin] Cookie file not found; Playwright runs without Netscape jar:', cookiePath)
      }
      try {
        console.warn(`[douyin] Fetch loop exhausted; Playwright hydrate on ${mShare}…`)
        const { fetchDouyinHtmlWithPlaywright } = await import('./douyinPlaywright.js')
        let html: string
        try {
          html = await fetchDouyinHtmlWithPlaywright(mShare, { cookiesFilePath: cookiePath })
        } catch (pw1) {
          console.warn('[douyin] Playwright m-share load failed; trying canonical…', pw1)
          html = await fetchDouyinHtmlWithPlaywright(canonical, { cookiesFilePath: cookiePath })
        }
        let info: DouyinMediaResult
        try {
          info = parseDouyinPageHtml(html, contentId)
        } catch (parseErr) {
          console.warn(
            '[douyin] Playwright m-share HTML did not parse; hydrating canonical…',
            parseErr instanceof Error ? parseErr.message : parseErr
          )
          html = await fetchDouyinHtmlWithPlaywright(canonical, { cookiesFilePath: cookiePath })
          info = parseDouyinPageHtml(html, contentId)
        }
        const kind = isDouyinGallery(info) ? `gallery images=${info.imageUrls.length}` : `video duration=${info.duration}s`
        console.log(`[douyin] Parsed (Playwright): title="${info.title}", author="${info.author}", ${kind}`)
        lastGetDouyinInfoError = ''
        return info
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e)
        lastGetDouyinInfoError = lastErr
        console.warn('[douyin] Playwright hydrate failed:', lastErr)
      }
    } else {
      console.warn(
        '[douyin] Playwright disabled (DOUYIN_PLAYWRIGHT=0). Hard Douyin links often need it: install chromium (`npx playwright install chromium`) and remove DOUYIN_PLAYWRIGHT=0 or unset it.'
      )
    }

    lastGetDouyinInfoError =
      lastErr ||
      'All Douyin page fetches failed or HTML was not parseable'
    if (!config.douyinPlaywright) {
      lastGetDouyinInfoError += ` (Playwright off: remove DOUYIN_PLAYWRIGHT=0 or run npx playwright install chromium when re-enabled)`
    }
    return null
  } catch (err) {
    lastGetDouyinInfoError = err instanceof Error ? err.message : String(err)
    console.warn('[douyin] Fallback failed:', lastGetDouyinInfoError)
    return null
  }
}

export async function downloadDouyinVideo(
  videoUrl: string,
  outputDir: string,
  title: string,
  onProgress?: (percent: number) => void
): Promise<string> {
  mkdirSync(outputDir, { recursive: true })

  const safeTitle = sanitizeDownloadBasename(title, 100)
  const outputPath = join(outputDir, `${safeTitle}.mp4`)

  console.log(`[douyin] Downloading to: ${outputPath}`)

  const res = await fetch(videoUrl, {
    headers: {
      'User-Agent': MOBILE_UA,
      Referer: 'https://www.douyin.com/',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
    redirect: 'follow',
  })

  if (!res.ok || !res.body) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`)
  }

  const contentLength = Number(res.headers.get('content-length') ?? 0)
  const fileStream = createWriteStream(outputPath)
  let downloaded = 0

  const transform = new TransformStream({
    transform(chunk: Uint8Array, controller: TransformStreamDefaultController<Uint8Array>) {
      downloaded += chunk.byteLength
      if (contentLength > 0 && onProgress) {
        onProgress(Math.min(100, (downloaded / contentLength) * 100))
      }
      controller.enqueue(chunk)
    },
  })

  const readable = Readable.fromWeb(res.body.pipeThrough(transform as any) as any)
  await pipeline(readable, fileStream)

  console.log(`[douyin] Download complete: ${(downloaded / 1024 / 1024).toFixed(1)} MB`)
  return outputPath
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

export async function downloadDouyinImageGallery(
  imageUrls: string[],
  outputDir: string,
  title: string,
  onProgress?: (percent: number) => void
): Promise<string> {
  if (imageUrls.length === 0) throw new Error('No image URLs to download')

  const safeTitle = sanitizeDownloadBasename(title, 80)
  const subDir = join(outputDir, safeTitle)
  mkdirSync(subDir, { recursive: true })

  const cookieHeader = buildCookieHeaderFromNetscapeFile(resolve(config.cookiesFilePath))

  let i = 0
  for (const url of imageUrls) {
    i++
    const ext = extFromImageUrl(url)
    const dest = join(subDir, `${String(i).padStart(3, '0')}.${ext}`)
    const res = await fetch(url, {
      headers: {
        'User-Agent': DESKTOP_UA,
        Referer: 'https://www.douyin.com/',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
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
    if (onProgress) onProgress(Math.min(99, Math.round((i / imageUrls.length) * 100)))
  }
  if (onProgress) onProgress(100)
  return subDir
}
