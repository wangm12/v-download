export type MediaRole = 'main' | 'variant' | 'preview' | 'heatmap' | 'related' | 'ad' | 'unknown'
export type PlaylistKind = 'master' | 'media' | 'unknown'

export interface MediaIdentityItem {
  url: string
  type?: string
  mime?: string | null
  mimeType?: string | null
  contentType?: string | null
  size?: number | null
  timestamp?: number
  pageUrl?: string
  source?: string
  role?: MediaRole
  playlistKind?: PlaylistKind
  displayTitle?: string
}

export interface MediaIdentityContext {
  pageTitle?: string
  pageUrl?: string
}

const AUDIO = new Set(['mp3', 'm4a', 'aac', 'ogg', 'wav', 'flac'])
const MANIFESTS = new Set(['hls', 'dash'])
const PREVIEW_SIZE = 5 * 1024 * 1024
const HEATMAP = /(^|[./_-])(heatmap|sprite|thumbnail|preview_v)([0-9a-z._-]|$)/i
const TRAILER = /(^|[./_-])(teaser|trailer)([0-9a-z._-]|$)/i
const MASTER_STEM = /^(master|index|playlist)$/i
const MEDIA_EXT = /\.(?:m3u8|mpd|mp4|webm|flv|mkv|mp3|m4a|aac|ogg|wav|flac)$/i
const TRACKING = /^(utm_|fbclid$|gclid$|dclid$|msclkid$|mc_cid$|mc_eid$|_ga$|beacon$|pixel$|tracking$|analytics$)/i
const EPHEMERAL = /^(token|auth|authorization|signature|sig|expires|expire|expiry|exp|hdnts|policy|key-pair-id|t|s|st|e|key|hash|ts|timestamp|uid|session|sid|jwt|access_token|id_token)$/i
const AD_PATH = /(^|[./_-])(ads?|advert|advertising|vast|preroll|midroll|postroll|ima|sponsor)([./_-]|$)/i
const AD_HOST = /(^|\.)(doubleclick\.|googleadservices\.|googlesyndication\.|adservice\.|adsrvr\.|adnxs\.|exoclick\.|exdynsrv\.|trafficjunky\.|tsyndicate\.|juicyads\.|popads\.|adsterra\.|pubmatic\.|openx\.|criteo\.)/i
const PAGE_PATH_SKIP = new Set(['videos', 'video', 'watch', 'v', 'embed', 'player', 'hls', 'mp4', 'media'])
const REUSABLE_STATUS = new Set(['queued', 'downloading', 'paused', 'interrupted', 'complete', 'ready', 'resolving'])

function pathText(url: string): string {
  try { return new URL(url).pathname.toLowerCase() } catch { return String(url || '').toLowerCase() }
}

function hostText(url: string): string {
  try { return new URL(url).hostname.toLowerCase() } catch { return '' }
}

function filenameFromUrl(url: string): string {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || '')
    if (name) return name.length > 60 ? `${name.slice(0, 57)}...` : name
  } catch { /* ignore */ }
  return url.length > 60 ? `${url.slice(0, 57)}...` : url
}

export function isAdLikeUrl(url: string): boolean {
  const host = hostText(url)
  const path = pathText(url)
  if (!host && !path) return false
  if (AD_HOST.test(host)) return true
  if (host.startsWith('ad.') || host.startsWith('ads.') || host.includes('.ads.')) return true
  return AD_PATH.test(host) || AD_PATH.test(path)
}

export function stableMediaUrl(raw: string): string {
  try {
    const parsed = new URL(raw)
    parsed.hash = ''
    const kept: Array<[string, string]> = []
    for (const [key, value] of parsed.searchParams) {
      if (TRACKING.test(key) || EPHEMERAL.test(key)) continue
      kept.push([key, value])
    }
    kept.sort(([left], [right]) => left.localeCompare(right))
    parsed.search = new URLSearchParams(kept).toString()
    return parsed.toString()
  } catch {
    return String(raw || '')
  }
}

export function hintDirectMediaUrl(url: string, mediaType?: string): string {
  if (!url || !mediaType) return url
  const type = mediaType.toLowerCase()
  if (type === 'hls' && !/\.m3u8(\?|#|$)/i.test(url)) {
    return url.includes('#') ? url : `${url}#.m3u8`
  }
  if ((type === 'dash' || type === 'mpd') && !/\.mpd(\?|#|$)/i.test(url)) {
    return url.includes('#') ? url : `${url}#.mpd`
  }
  return url
}

export function findReusableDownload<T extends { url: string; status: string }>(
  rows: T[],
  url: string
): T | undefined {
  const key = stableMediaUrl(url)
  if (!key) return undefined
  return (Array.isArray(rows) ? rows : []).find((row) => (
    row && REUSABLE_STATUS.has(String(row.status)) && stableMediaUrl(row.url) === key
  ))
}

export function shouldRedownloadExisting(
  row: { status: string; file_path?: string | null } | undefined,
  outputExists: (path: string) => boolean
): boolean {
  if (!row || String(row.status) !== 'complete') return false
  const path = String(row.file_path || '').trim()
  return !path || !outputExists(path)
}

function isRelatedDocument(itemUrl: string, contextUrl: string): boolean {
  try {
    const item = new URL(itemUrl)
    const context = new URL(contextUrl)
    if (!/^https?:$/.test(item.protocol) || !/^https?:$/.test(context.protocol)) return false
    const itemPath = item.pathname.replace(/\/+$/, '') || '/'
    const contextPath = context.pathname.replace(/\/+$/, '') || '/'
    if (MEDIA_EXT.test(itemPath)) return false
    if (item.host.toLowerCase() !== context.host.toLowerCase()) return itemPath !== '/' && contextPath !== '/'
    if (itemPath === '/' || contextPath === '/' || itemPath === contextPath) return false
    if (contextPath.startsWith(`${itemPath}/`) || itemPath.startsWith(`${contextPath}/`)) return false
    return true
  } catch {
    return false
  }
}

function inferType(url: string, mime?: string): string {
  const value = String(mime || '').toLowerCase()
  if (/mpegurl/.test(value)) return 'hls'
  if (/dash\+xml/.test(value)) return 'dash'
  if (value.startsWith('video/mp4')) return 'mp4'
  if (value.startsWith('video/webm')) return 'webm'
  if (value.startsWith('video/x-flv')) return 'flv'
  try {
    const ext = new URL(url).pathname.toLowerCase().split('.').pop() || ''
    if (ext === 'm3u8') return 'hls'
    if (ext === 'mpd') return 'dash'
    if (['mp4', 'webm', 'flv', 'mp3', 'm4a', 'aac', 'ogg', 'wav', 'flac'].includes(ext)) return ext
  } catch { /* ignore */ }
  return ''
}

export function playlistKindFromUrl(url: string, type?: string): PlaylistKind {
  const resolved = type || inferType(url)
  if (!MANIFESTS.has(resolved)) return 'unknown'
  try {
    const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || '').toLowerCase()
    const stem = name.replace(/\.(?:m3u8|mpd)$/i, '')
    return MASTER_STEM.test(stem) ? 'master' : 'media'
  } catch {
    return 'unknown'
  }
}

function pageContentHints(pageUrl?: string, pageTitle?: string): string[] {
  const hints: string[] = []
  try {
    for (const part of new URL(String(pageUrl || '')).pathname.toLowerCase().split('/').filter(Boolean)) {
      if (!PAGE_PATH_SKIP.has(part) && part.length >= 4) hints.push(part)
    }
  } catch { /* ignore */ }
  const codes = String(pageTitle || '').toLowerCase().match(/[a-z]{2,8}-\d{2,6}/g)
  if (codes) hints.push(...codes)
  return [...new Set(hints)]
}

function urlMatchesPage(url: string, hints: string[]): boolean {
  const text = String(url || '').toLowerCase()
  return hints.some((hint) => hint.length >= 4 && text.includes(hint))
}

export function displayTitleFor(item: MediaIdentityItem, pageTitle?: string): string {
  if ((item.role === 'main' || item.role === 'variant') && pageTitle) return pageTitle
  return filenameFromUrl(item.url)
}

export function roleLabel(role?: MediaRole): string {
  if (role === 'main') return 'Main video'
  if (role === 'variant') return 'Other playlist'
  if (role === 'preview') return 'Preview'
  if (role === 'heatmap') return 'Heatmap'
  if (role === 'related') return 'Related'
  if (role === 'ad') return 'Ad'
  return 'Detected'
}

function pickMain(pool: MediaIdentityItem[], hints: string[]): MediaIdentityItem | null {
  if (!pool.length) return null
  return pool.slice().sort((left, right) => {
    const pageDelta = Number(urlMatchesPage(right.url, hints)) - Number(urlMatchesPage(left.url, hints))
    if (pageDelta) return pageDelta
    const masterDelta = Number(right.playlistKind === 'master') - Number(left.playlistKind === 'master')
    if (masterDelta) return masterDelta
    const tsDelta = (left.timestamp || 0) - (right.timestamp || 0)
    if (tsDelta) return tsDelta
    return (right.size || 0) - (left.size || 0)
  })[0] || null
}

export function classifyMediaRole<T extends MediaIdentityItem>(
  items: T[],
  context: MediaIdentityContext = {}
): Array<T & { role: MediaRole; playlistKind: PlaylistKind; displayTitle: string }> {
  const pageTitle = context.pageTitle || ''
  const pageUrl = context.pageUrl || ''
  const hints = pageContentHints(pageUrl, pageTitle)
  const prepared: Array<T & { role: MediaRole; playlistKind: PlaylistKind }> = (Array.isArray(items) ? items : []).map((raw) => {
    const type = raw.type || inferType(raw.url, raw.mime || raw.mimeType || raw.contentType || undefined)
    const path = pathText(raw.url)
    let role: MediaRole = 'unknown'
    if (isAdLikeUrl(raw.url)) role = 'ad'
    else if (pageUrl && raw.pageUrl && isRelatedDocument(raw.pageUrl, pageUrl)) role = 'related'
    else if (HEATMAP.test(path)) role = 'heatmap'
    else if (TRAILER.test(path)) role = 'preview'
    return { ...raw, type, role, playlistKind: playlistKindFromUrl(raw.url, type) }
  })
  const hasManifest = prepared.some((item) => MANIFESTS.has(String(item.type)) && item.role !== 'related' && item.role !== 'ad')
  for (const item of prepared) {
    if (item.role !== 'unknown') continue
    const size = Number(item.size || 0)
    if (hasManifest && !MANIFESTS.has(String(item.type)) && !AUDIO.has(String(item.type)) && size > 0 && size < PREVIEW_SIZE) {
      item.role = 'preview'
    }
  }
  const contenders = prepared.filter((item) => item.role === 'unknown')
  const manifests = contenders.filter((item) => MANIFESTS.has(String(item.type)))
  const pool = manifests.length ? manifests : contenders.filter((item) => !AUDIO.has(String(item.type)))
  const main = pickMain(pool, hints)
  if (main) {
    for (const item of pool) {
      if (item === main) item.role = 'main'
      else if (MANIFESTS.has(String(item.type))) item.role = 'variant'
    }
  }
  return prepared.map((item) => ({ ...item, displayTitle: displayTitleFor(item, pageTitle) }))
}

export function selectDefaultMedia<T extends MediaIdentityItem>(items: T[]): T[] {
  return (Array.isArray(items) ? items : []).filter((item) => item.role === 'main')
}

export function selectSmartOverlayMedia<T extends MediaIdentityItem>(items: T[]): T[] {
  const list = Array.isArray(items) ? items : []
  const hidden = new Set(['heatmap', 'preview', 'related', 'ad'])
  let visible = list.filter((item) => !hidden.has(String(item.role)))
  if (!visible.length) visible = list.filter((item) => item.role === 'main')
  if (!visible.length) visible = list.filter((item) => (item.type === 'hls' || item.type === 'dash') && item.role !== 'ad')
  if (!visible.length) visible = list.filter((item) => item.role !== 'ad')
  const main = visible.filter((item) => item.role === 'main')
  const variants = visible.filter((item) => item.role === 'variant')
  const rest = visible.filter((item) => item.role !== 'main' && item.role !== 'variant')
  return [...main, ...variants.slice(0, 1), ...rest]
}

export function pickRefreshedSniffedCandidate<T extends MediaIdentityItem>(
  clicked: T | null | undefined,
  media: T[]
): T | null {
  if (!clicked?.url) return null
  const key = stableMediaUrl(clicked.url)
  const same = (Array.isArray(media) ? media : []).filter((item) => (
    item && item.type === clicked.type && stableMediaUrl(item.url) === key
  ))
  if (!same.length) return clicked
  return same.slice().sort((left, right) => (right.timestamp || 0) - (left.timestamp || 0))[0] || clicked
}
