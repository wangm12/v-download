import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { sanitizeDownloadBasename } from './sanitizeDownloadBasename'

const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const GALLERY_IMAGE_PARALLEL = 6

export type XiaohongshuFetchOptions = { signal?: AbortSignal }

export function throwIfXhsAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Xiaohongshu fetch aborted', 'AbortError')
  }
}

export function isXhsAbortError(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError'
}

export interface XiaohongshuGalleryInfo {
  kind: 'gallery'
  id: string
  title: string
  author: string
  cover: string
  imageUrls: string[]
}

export type XiaohongshuMediaResult = XiaohongshuGalleryInfo

let lastGetXhsInfoError = ''

export function getLastXhsInfoError(): string {
  return lastGetXhsInfoError
}

export function isXiaohongshuUrl(url: string): boolean {
  return /xiaohongshu\.com|xhslink\.com/i.test(url)
}

export function isXiaohongshuGallery(
  info: XiaohongshuMediaResult | null
): info is XiaohongshuGalleryInfo {
  return info != null && info.kind === 'gallery' && info.imageUrls.length > 0
}

function normalizeHttpsUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('http://')) return `https://${trimmed.slice('http://'.length)}`
  if (trimmed.startsWith('//')) return `https:${trimmed}`
  return trimmed
}

function buildXhsCookieHeader(cookiesFilePath?: string): string {
  if (!cookiesFilePath?.trim() || !existsSync(cookiesFilePath.trim())) return ''
  const map: Record<string, string> = {}
  const content = readFileSync(cookiesFilePath.trim(), 'utf-8')
  for (const line of content.split('\n')) {
    if (line.startsWith('#') || !line.trim()) continue
    const parts = line.split('\t')
    if (parts.length >= 7 && /xiaohongshu/i.test(parts[0])) {
      const name = parts[5]?.trim()
      const value = parts[6]?.trim()
      if (name && value != null) map[name] = value
    }
  }
  return Object.entries(map)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
}

function extractNoteId(url: string): string | null {
  const m = url.match(/xiaohongshu\.com\/(?:explore|discovery\/item)\/([a-f0-9]+)/i)
  return m ? m[1] : null
}

async function resolveShortUrl(url: string): Promise<string> {
  if (!/xhslink\.com/i.test(url)) return url.trim()
  const res = await fetch(url.trim(), {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'User-Agent': DESKTOP_UA,
      Referer: 'https://www.xiaohongshu.com/',
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

function parseInitialState(html: string): Record<string, unknown> | null {
  const m = html.match(/window\.__INITIAL_STATE__\s*=\s*({.+?})<\/script>/s)
  if (!m) return null
  const raw = m[1].replace(/:undefined\b/g, ':null').replace(/,undefined\b/g, ',null')
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

function findNoteInState(
  state: Record<string, unknown>,
  noteId: string
): Record<string, unknown> | null {
  const note = state.note as Record<string, unknown> | undefined
  const map = note?.noteDetailMap as
    | Record<string, { note?: Record<string, unknown> }>
    | undefined
  if (!map) return null

  const direct = map[noteId]?.note
  if (direct && Object.keys(direct).length > 0) return direct

  for (const entry of Object.values(map)) {
    const candidate = entry?.note
    if (!candidate || Object.keys(candidate).length === 0) continue
    if (candidate.noteId === noteId || Array.isArray(candidate.imageList)) {
      return candidate
    }
  }
  return null
}

function bestImageUrl(img: Record<string, unknown>): string | null {
  const urlDefault = img.urlDefault
  if (typeof urlDefault === 'string' && /^https?:\/\//i.test(urlDefault)) {
    return normalizeHttpsUrl(urlDefault)
  }

  const infoList = img.infoList as Array<{ imageScene?: string; url?: string }> | undefined
  if (Array.isArray(infoList)) {
    const dft = infoList.find((i) => i.imageScene === 'WB_DFT' && typeof i.url === 'string')
    if (dft?.url) return normalizeHttpsUrl(dft.url)
    const any = infoList.find((i) => typeof i.url === 'string' && /^https?:\/\//i.test(i.url))
    if (any?.url) return normalizeHttpsUrl(any.url)
  }

  const urlPre = img.urlPre
  if (typeof urlPre === 'string' && /^https?:\/\//i.test(urlPre)) {
    return normalizeHttpsUrl(urlPre)
  }
  return null
}

function isGalleryNote(note: Record<string, unknown>): boolean {
  const imageList = note.imageList
  if (!Array.isArray(imageList) || imageList.length === 0) return false
  if (note.type === 'video') return false
  if (note.video && typeof note.video === 'object') return false
  return true
}

function parseGalleryFromNote(
  note: Record<string, unknown>,
  noteId: string,
  pageUrl: string,
  html: string
): XiaohongshuGalleryInfo | null {
  if (!isGalleryNote(note)) return null

  const imageUrls: string[] = []
  for (const img of note.imageList as Record<string, unknown>[]) {
    const url = bestImageUrl(img)
    if (url) imageUrls.push(url)
  }
  if (imageUrls.length === 0) return null

  const title =
    (typeof note.title === 'string' && note.title.trim()) ||
    (typeof note.desc === 'string' && note.desc.trim().split('\n')[0]) ||
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1]?.trim() ||
    `xiaohongshu-${noteId}`

  const user = note.user as Record<string, unknown> | undefined
  const author =
    (typeof user?.nickname === 'string' && user.nickname.trim()) ||
    (typeof user?.nickName === 'string' && user.nickName.trim()) ||
    ''

  return {
    kind: 'gallery',
    id: noteId,
    title,
    author,
    cover: imageUrls[0],
    imageUrls,
  }
}

async function fetchPageHtml(pageUrl: string, cookiesFilePath?: string): Promise<string> {
  const cookieHeader = buildXhsCookieHeader(cookiesFilePath)
  const res = await fetch(pageUrl, {
    headers: {
      'User-Agent': DESKTOP_UA,
      Referer: 'https://www.xiaohongshu.com/',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
    redirect: 'follow',
  })
  if (!res.ok) {
    throw new Error(`Xiaohongshu page fetch failed: ${res.status} ${res.statusText}`)
  }
  return res.text()
}

export async function getXiaohongshuInfo(
  url: string,
  cookiesFilePath?: string
): Promise<XiaohongshuMediaResult | null> {
  lastGetXhsInfoError = ''
  try {
    const resolved = await resolveShortUrl(url)
    const noteId = extractNoteId(resolved)
    if (!noteId) {
      lastGetXhsInfoError = 'Could not parse Xiaohongshu note id from URL'
      return null
    }

    const html = await fetchPageHtml(resolved, cookiesFilePath)
    const state = parseInitialState(html)
    if (!state) {
      lastGetXhsInfoError = 'Xiaohongshu page did not include note data'
      return null
    }

    const note = findNoteInState(state, noteId)
    if (!note) {
      lastGetXhsInfoError =
        'Note data missing — paste the full explore link (with xsec_token) or sync Xiaohongshu cookies'
      return null
    }

    const gallery = parseGalleryFromNote(note, noteId, resolved, html)
    if (!gallery) {
      lastGetXhsInfoError = 'This Xiaohongshu post is not an image gallery'
      return null
    }
    return gallery
  } catch (e) {
    lastGetXhsInfoError = e instanceof Error ? e.message : String(e)
    return null
  }
}

function extFromImageUrl(u: string): string {
  try {
    const p = new URL(u).pathname.toLowerCase()
    if (p.includes('.png') || p.endsWith('png')) return 'png'
    if (p.includes('.webp') || p.endsWith('webp')) return 'webp'
    if (p.includes('.jpeg') || p.endsWith('jpeg')) return 'jpeg'
    if (p.includes('.jpg') || p.endsWith('jpg')) return 'jpg'
  } catch {
    /* ignore */
  }
  return 'jpg'
}

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

/** Download all images from a Xiaohongshu note into `outputDir/<title>/`. */
export async function downloadXiaohongshuImageGallery(
  imageUrls: string[],
  outputDir: string,
  title: string,
  cookiesFilePath: string | undefined,
  onProgress?: (percent: number) => void,
  options?: XiaohongshuFetchOptions
): Promise<string> {
  throwIfXhsAborted(options?.signal)
  if (imageUrls.length === 0) throw new Error('No image URLs to download')

  const safeTitle = sanitizeDownloadBasename(title, 80)
  const subDir = join(outputDir, safeTitle)
  mkdirSync(subDir, { recursive: true })

  const cookieHeader = buildXhsCookieHeader(cookiesFilePath)
  const headers = {
    'User-Agent': DESKTOP_UA,
    Referer: 'https://www.xiaohongshu.com/',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
  } as Record<string, string>

  const n = imageUrls.length
  let completed = 0
  const bump = () => {
    completed++
    onProgress?.(Math.min(99, Math.round((completed / n) * 100)))
  }

  let cursor = 0
  async function worker(): Promise<void> {
    while (true) {
      throwIfXhsAborted(options?.signal)
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
