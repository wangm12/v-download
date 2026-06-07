/**
 * Phase A: extract creator post rows from Douyin user-page HTML / embedded JSON.
 * Heuristic deep-walk (similar spirit to jiji262/douyin-downloader profile parsing, MIT).
 * Fixture tests: `npm run test:douyin-profile`.
 */
import { extractBalancedJsonAfterMarker } from './douyinParseUtils'
import type { DouyinProfileMediaType, DouyinProfilePostRow } from './douyinProfileTypes'

const JSON_MARKERS = ['_ROUTER_DATA', '__MODERN_ROUTER_DATA__', 'SIGI_STATE', 'SUPER_DATA'] as const

/** Image list blocks used by HTML embeds and web API (shapes differ). */
function collectImageListArrays(o: Record<string, unknown>): unknown[][] {
  const ip = o.image_post
  const ipRec = ip && typeof ip === 'object' ? (ip as Record<string, unknown>) : null
  const candidates: unknown[] = [
    o.images,
    o.image_list,
    o.imageList,
    ipRec?.images,
    ipRec?.image_list,
    ipRec?.imageList,
  ]
  return candidates.filter((x): x is unknown[] => Array.isArray(x) && x.length > 0)
}

function itemHasImages(o: Record<string, unknown>): boolean {
  for (const imgs of collectImageListArrays(o)) {
    for (const img of imgs) {
      if (!img || typeof img !== 'object') continue
      const rec = img as Record<string, unknown>
      const urlList = rec.url_list ?? rec.urlList
      if (Array.isArray(urlList) && urlList.some((u) => typeof u === 'string' && /^https?:\/\//i.test(u))) {
        return true
      }
    }
  }
  return false
}

function awemeTypeNum(item: Record<string, unknown>): number | undefined {
  const v = item.aweme_type ?? (item as { awemeType?: unknown }).awemeType
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

function coverFromItem(item: Record<string, unknown>): string {
  const video = item.video as Record<string, unknown> | undefined
  if (video && typeof video === 'object') {
    const c = video.cover as { url_list?: string[] } | undefined
    const u = c?.url_list?.[0]
    if (typeof u === 'string') return u
  }
  for (const imgs of collectImageListArrays(item)) {
    const first = imgs[0] as Record<string, unknown> | undefined
    const urlList = first?.url_list ?? first?.urlList
    if (Array.isArray(urlList) && urlList.length) {
      const u = urlList[urlList.length - 1]
      if (typeof u === 'string') return u
    }
  }
  return ''
}

function durationSecFromItem(item: Record<string, unknown>): number | undefined {
  const video = item.video as Record<string, unknown> | undefined
  if (!video) return undefined
  const ms = Number(video.duration)
  if (!Number.isFinite(ms) || ms <= 0) return undefined
  return Math.floor(ms / 1000)
}

function imageCountFromItem(item: Record<string, unknown>): number | undefined {
  if (!itemHasImages(item)) return undefined
  for (const imgs of collectImageListArrays(item)) {
    return imgs.length
  }
  return undefined
}

export function awemeItemToProfileRow(item: Record<string, unknown>): DouyinProfilePostRow | null {
  const id = String(item.aweme_id ?? (item as { awemeId?: string }).awemeId ?? '').trim()
  if (!/^\d{10,}$/.test(id)) return null

  const author = String((item.author as { nickname?: string } | undefined)?.nickname ?? '').trim()
  const title = String(item.desc ?? '').trim().slice(0, 200) || `Aweme ${id}`
  const cover = coverFromItem(item)

  // Web `/aweme/v1/web/aweme/post/` payloads often omit `video.play_addr.uri`; those are still normal videos.
  // 68 = 图文笔记 — use note URL even when image URLs are stripped from the list response.
  const asGallery = itemHasImages(item) || awemeTypeNum(item) === 68
  const mediaType: DouyinProfileMediaType = asGallery ? 'gallery' : 'video'
  const pageUrl = asGallery ? `https://www.douyin.com/note/${id}` : `https://www.douyin.com/video/${id}`

  return {
    awemeId: id,
    mediaType,
    title,
    author,
    cover,
    durationSec: durationSecFromItem(item),
    imageCount: imageCountFromItem(item),
    pageUrl,
  }
}

type ItemListBlob = {
  items: Record<string, unknown>[]
  maxCursor: string | null
  hasMore: boolean
}

function pushItemListBlobs(obj: unknown, out: ItemListBlob[]): void {
  if (obj == null || typeof obj !== 'object') return
  if (Array.isArray(obj)) {
    for (const el of obj) pushItemListBlobs(el, out)
    return
  }
  const o = obj as Record<string, unknown>
  const il = o.item_list
  if (Array.isArray(il) && il.length > 0 && typeof il[0] === 'object' && il[0] != null) {
    const first = il[0] as Record<string, unknown>
    if (first.aweme_id != null || first.awemeId != null) {
      const maxRaw = o.max_cursor ?? o.maxCursor
      const maxCursor = maxRaw != null && String(maxRaw).length > 0 ? String(maxRaw) : null
      const hm = o.has_more ?? o.hasMore
      const hasMore = hm === 1 || hm === true || hm === 'true'
      out.push({
        items: il as Record<string, unknown>[],
        maxCursor,
        hasMore: Boolean(hasMore && maxCursor),
      })
    }
  }
  for (const k of Object.keys(o)) pushItemListBlobs(o[k], out)
}

function tryParseJsonRoot(html: string, marker: string): Record<string, unknown> | null {
  const jsonStr = extractBalancedJsonAfterMarker(html, marker)
  if (!jsonStr) return null
  try {
    return JSON.parse(jsonStr) as Record<string, unknown>
  } catch {
    return null
  }
}

function tryRenderData(html: string): Record<string, unknown> | null {
  const m = html.match(/<script[^>]*\bid=["']RENDER_DATA["'][^>]*>([\s\S]*?)<\/script>/i)
  if (!m?.[1]) return null
  let raw = m[1].trim()
  try {
    raw = decodeURIComponent(raw)
  } catch {
    return null
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

function tryNextData(html: string): Record<string, unknown> | null {
  const m = html.match(/<script[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)
  if (!m?.[1]) return null
  try {
    return JSON.parse(m[1].trim()) as Record<string, unknown>
  } catch {
    return null
  }
}

export interface HtmlExtractResult {
  rows: DouyinProfilePostRow[]
  maxCursor: string | null
  hasMore: boolean
}

/** Parse up to `limit` unique posts from user-page HTML. */
export function extractProfilePostsFromHtml(html: string, limit: number): HtmlExtractResult {
  const blobs: ItemListBlob[] = []
  for (const marker of JSON_MARKERS) {
    const root = tryParseJsonRoot(html, marker)
    if (root) pushItemListBlobs(root, blobs)
  }
  const r1 = tryRenderData(html)
  if (r1) pushItemListBlobs(r1, blobs)
  const r2 = tryNextData(html)
  if (r2) pushItemListBlobs(r2, blobs)

  let maxCursor: string | null = null
  let hasMore = false
  for (const b of blobs) {
    if (b.hasMore && b.maxCursor) {
      hasMore = true
      maxCursor = b.maxCursor
      break
    }
  }

  const seen = new Set<string>()
  const rows: DouyinProfilePostRow[] = []
  outer: for (const b of blobs) {
    for (const raw of b.items) {
      if (typeof raw !== 'object' || raw == null) continue
      const row = awemeItemToProfileRow(raw as Record<string, unknown>)
      if (!row || seen.has(row.awemeId)) continue
      seen.add(row.awemeId)
      rows.push(row)
      if (rows.length >= limit) break outer
    }
  }

  return { rows, maxCursor, hasMore: Boolean(hasMore && maxCursor) }
}
