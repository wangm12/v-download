import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'fs'
import { join, resolve } from 'path'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import { sanitizeDownloadBasename } from './sanitizeDownloadBasename'
import { fetchDouyinHtmlWithChromium, isDouyinAntiBotShell } from './douyinBrowserFetch'

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'

const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export interface DouyinVideoInfo {
  id: string
  title: string
  author: string
  videoUrl: string
  duration: number
  cover: string
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

function extractVideoId(resolvedUrl: string): string | null {
  const m = resolvedUrl.match(/video\/(\d+)/)
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

async function fetchDouyinHtml(
  pageUrl: string,
  cookiesFilePath: string | undefined,
  uaMode: FetchUaMode
): Promise<string> {
  const ua = uaMode === 'desktop' ? DESKTOP_UA : MOBILE_UA
  const headers: Record<string, string> = {
    'User-Agent': ua,
    Referer: 'https://www.douyin.com/',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  }
  if (cookiesFilePath && cookiesFilePath.trim()) {
    const abs = resolve(cookiesFilePath.trim())
    const cookieHeader = buildCookieHeaderFromNetscapeFile(abs)
    if (cookieHeader) headers.Cookie = cookieHeader
  }

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
    id: String(item.aweme_id ?? fallbackId),
    title: String(item.desc ?? 'Douyin Video').substring(0, 200),
    author: String(author),
    videoUrl,
    duration: Math.floor((Number(video.duration) || 0) / 1000),
    cover: coverUrl,
  }
}

const JSON_MARKERS = ['_ROUTER_DATA', '__MODERN_ROUTER_DATA__', 'SIGI_STATE'] as const

function tryParseEmbeddedJsonMarkers(html: string, videoId: string): DouyinVideoInfo | null {
  for (const marker of JSON_MARKERS) {
    const jsonStr = extractBalancedJsonAfterMarker(html, marker)
    if (!jsonStr) continue
    try {
      const data = JSON.parse(jsonStr) as Record<string, unknown>
      let item = findAwemeItemDeep(data.loaderData)
      if (!item) item = findAwemeItemDeep(data)
      if (item) return buildDouyinInfoFromItem(item, videoId)
    } catch {
      /* try next marker */
    }
  }
  return null
}

/** SSR: URL-encoded JSON in <script id="RENDER_DATA"> */
function tryRenderDataScript(html: string, videoId: string): DouyinVideoInfo | null {
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
    const item = findAwemeItemDeep(data)
    if (item) return buildDouyinInfoFromItem(item, videoId)
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

function parseDouyinPageHtml(html: string, videoId: string): DouyinVideoInfo {
  const fromMarkers = tryParseEmbeddedJsonMarkers(html, videoId)
  if (fromMarkers) return fromMarkers

  const fromRender = tryRenderDataScript(html, videoId)
  if (fromRender) return fromRender

  const loose = tryLoosePlayAddrInHtml(html, videoId)
  if (loose) return loose

  let jsonStr = extractBalancedJsonAfterMarker(html, '_ROUTER_DATA')
  if (!jsonStr) {
    const m = html.match(/_ROUTER_DATA\s*=\s*(\{[\s\S]*?\})\s*<\/script>/i)
    if (!m) throw new Error('No _ROUTER_DATA found in page')
    jsonStr = m[1]
  }

  const data = JSON.parse(jsonStr) as Record<string, unknown>
  let item = findAwemeItemDeep(data.loaderData)
  if (!item) item = findAwemeItemDeep(data)
  if (item) return buildDouyinInfoFromItem(item, videoId)

  const pageData = (data.loaderData as Record<string, unknown> | undefined)?.['video_(id)/page'] as
    | Record<string, unknown>
    | undefined
  const videoInfoRes = pageData?.videoInfoRes as Record<string, unknown> | undefined
  const itemList = videoInfoRes?.item_list as unknown[] | undefined
  const legacyItem = itemList?.[0] as Record<string, unknown> | undefined
  if (legacyItem && itemHasPlayUri(legacyItem)) {
    return buildDouyinInfoFromItem(legacyItem, videoId)
  }

  const nearAweme = tryLooseNearAwemeId(html, videoId)
  if (nearAweme) return nearAweme

  throw new Error('No video item in page data (layout not recognized or empty item_list)')
}

export async function getDouyinInfo(url: string, cookiesFilePath?: string): Promise<DouyinVideoInfo | null> {
  if (!isDouyinUrl(url)) return null

  lastGetDouyinInfoError = ''

  try {
    console.log(`[douyin] Resolving URL: ${url}`)
    const resolved = await resolveShortUrl(url)
    console.log(`[douyin] Resolved to: ${resolved}`)

    const videoId = extractVideoId(resolved)
    if (!videoId) {
      console.log(`[douyin] Could not extract video ID from: ${resolved}`)
      lastGetDouyinInfoError = 'Could not extract numeric video id from resolved URL'
      return null
    }
    console.log(`[douyin] Video ID: ${videoId}`)

    /** Mobile share often returns parseable HTML without Chromium; `www.douyin.com/video` frequently serves an acrawler shell from non-CN IPs that Electron rarely hydrates before timeout. */
    const canonical = `https://www.douyin.com/video/${videoId}`
    const mShare = `https://m.douyin.com/share/video/${videoId}`
    const pageUrls: string[] = [
      mShare,
      canonical,
      `https://www.iesdouyin.com/share/video/${videoId}`,
      `https://m.iesdouyin.com/share/video/${videoId}`,
    ]
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
      let chromiumReturnedForThisUrl = false
      for (const uaMode of ['mobile', 'desktop'] as FetchUaMode[]) {
        try {
          let html = await fetchDouyinHtml(pageUrl, cookiesFilePath, uaMode)
          if (isDouyinAntiBotShell(html)) {
            if (/^https:\/\/www\.douyin\.com\/video\//i.test(pageUrl)) {
              lastErr =
                'www.douyin.com/video returned anti-bot shell (skipped Electron hydrate; trying other hosts)'
              console.warn(
                `[douyin] Anti-bot shell from Node fetch (${html.length} bytes) on ${pageUrl}; skipping Chromium (often times out here)…`
              )
              break
            }
            if (chromiumReturnedForThisUrl) {
              throw new Error('Anti-bot shell: Chromium already fetched HTML for this URL')
            }
            console.warn(
              `[douyin] Anti-bot shell from Node fetch (${html.length} bytes); hydrating ${pageUrl} in Chromium…`
            )
            html = await fetchDouyinHtmlWithChromium(pageUrl, {
              cookiesFilePath,
              preferredUa: uaMode === 'mobile' ? 'mobile' : 'desktop',
            })
            chromiumReturnedForThisUrl = true
          }
          console.log(`[douyin] Fetched ${pageUrl} (${uaMode}, ${html.length} bytes)`)
          let info: DouyinVideoInfo
          try {
            info = parseDouyinPageHtml(html, videoId)
          } catch (parseErr) {
            const shareLike = /iesdouyin\.com|\/share\/video\//i.test(pageUrl)
            const onMShare = /\/\/m\.douyin\.com\/share\/video\//i.test(pageUrl)
            const eligible = !!cookiesFilePath?.trim() && shareLike && (pageUrl !== canonical || onMShare)
            if (eligible) {
              const retryUrl = onMShare ? mShare : canonical
              const retryUa = onMShare && uaMode === 'mobile' ? 'desktop' : uaMode === 'mobile' ? 'mobile' : 'desktop'
              console.warn(
                `[douyin] Parse failed on ${pageUrl} (${uaMode}): ${parseErr instanceof Error ? parseErr.message : String(parseErr)}; Chromium on ${retryUrl} (${retryUa})…`
              )
              const htmlRetry = await fetchDouyinHtmlWithChromium(retryUrl, {
                cookiesFilePath,
                timeoutMs: 88_000,
                preferredUa: retryUa,
              })
              info = parseDouyinPageHtml(htmlRetry, videoId)
            } else {
              throw parseErr
            }
          }
          console.log(`[douyin] Parsed: title="${info.title}", author="${info.author}", duration=${info.duration}s`)
          lastGetDouyinInfoError = ''
          return info
        } catch (e) {
          lastErr = e instanceof Error ? e.message : String(e)
          console.warn(`[douyin] ${pageUrl} (${uaMode}) failed:`, lastErr)
        }
      }
    }

    try {
      let html: string
      try {
        console.warn('[douyin] Plain fetches failed; Chromium on mobile share URL…')
        html = await fetchDouyinHtmlWithChromium(mShare, {
          cookiesFilePath,
          timeoutMs: 88_000,
          preferredUa: 'mobile',
        })
      } catch (shareChErr) {
        console.warn('[douyin] Mobile share Chromium failed; trying canonical (mobile UA)…', shareChErr)
        try {
          html = await fetchDouyinHtmlWithChromium(canonical, {
            cookiesFilePath,
            timeoutMs: 88_000,
            preferredUa: 'mobile',
          })
        } catch (firstCh) {
          console.warn('[douyin] Canonical Chromium (mobile UA) failed, retrying with desktop UA…', firstCh)
          html = await fetchDouyinHtmlWithChromium(canonical, {
            cookiesFilePath,
            timeoutMs: 88_000,
            preferredUa: 'desktop',
          })
        }
      }
      const info = parseDouyinPageHtml(html, videoId)
      console.log(`[douyin] Parsed (Chromium): title="${info.title}", author="${info.author}", duration=${info.duration}s`)
      lastGetDouyinInfoError = ''
      return info
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e)
      console.warn('[douyin] Chromium fallback failed:', lastErr)
    }

    lastGetDouyinInfoError = lastErr || 'All Douyin page sources failed'
    return null
  } catch (err) {
    lastGetDouyinInfoError = err instanceof Error ? err.message : String(err)
    console.warn('[douyin] getDouyinInfo failed:', lastGetDouyinInfoError)
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
