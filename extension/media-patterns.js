/* Shared, dependency-free media candidate policy for MV3 and content scripts. */
;(function (g) {
  'use strict'
  const MIN_VIDEO_SIZE = 100000
  const TRACKING = /^(utm_|fbclid$|gclid$|dclid$|msclkid$|mc_cid$|mc_eid$|_ga$|beacon$|pixel$|tracking$|analytics$)/i
  const EPHEMERAL = /^(token|auth|authorization|signature|sig|expires|expire|expiry|exp|hdnts|policy|key-pair-id|t|s|st|e|key|hash|ts|timestamp|uid|session|sid|jwt|access_token|id_token)$/i
  const AD_PATH = /(^|[./_-])(ads?|advert|advertising|vast|preroll|midroll|postroll|ima|sponsor)([./_-]|$)/i
  const AD_HOST = /(^|\.)(doubleclick\.|googleadservices\.|googlesyndication\.|adservice\.|adsrvr\.|adnxs\.|exoclick\.|exdynsrv\.|trafficjunky\.|tsyndicate\.|juicyads\.|popads\.|adsterra\.|pubmatic\.|openx\.|criteo\.)/i
  const PAGE_PATH_SKIP = new Set(['videos', 'video', 'watch', 'v', 'embed', 'player', 'hls', 'mp4', 'media'])
  const SEGMENT = /(^|[./_-])(segment|seg|chunk|frag|fragment|init|initiate|part|sample|thumbnail|sprite)([0-9._-]|$)/i
  const MIME_TYPES = [
    ['application/vnd.apple.mpegurl', 'hls'], ['application/x-mpegurl', 'hls'], ['audio/mpegurl', 'hls'],
    ['application/dash+xml', 'dash'], ['video/mp4', 'mp4'], ['video/webm', 'webm'],
    ['video/x-flv', 'flv'], ['audio/mpeg', 'mp3'], ['audio/mp4', 'm4a'], ['audio/aac', 'aac'],
    ['audio/ogg', 'ogg'], ['audio/wav', 'wav'], ['audio/webm', 'webm'], ['audio/flac', 'flac']
  ]
  const EXTENSIONS = [
    ['m3u8', 'hls'], ['mpd', 'dash'], ['mp4', 'mp4'], ['webm', 'webm'], ['flv', 'flv'],
    ['mp3', 'mp3'], ['m4a', 'm4a'], ['aac', 'aac'], ['ogg', 'ogg'], ['wav', 'wav'], ['flac', 'flac']
  ]
  const AUDIO = new Set(['mp3', 'm4a', 'aac', 'ogg', 'wav', 'flac'])
  const MANIFESTS = new Set(['hls', 'dash'])
  const PREVIEW_SIZE = 5 * 1024 * 1024
  const HEATMAP = /(^|[./_-])(heatmap|sprite|thumbnail|preview_v)([0-9a-z._-]|$)/i
  const TRAILER = /(^|[./_-])(teaser|trailer)([0-9a-z._-]|$)/i
  const MASTER_STEM = /^(master|index|playlist)$/i

  function canonicalizeUrl(raw) {
    try {
      const u = new URL(raw)
      u.hash = ''
      const kept = []
      for (const [key, value] of u.searchParams) if (!TRACKING.test(key)) kept.push([key, value])
      u.search = new URLSearchParams(kept).toString()
      return u.toString()
    } catch { return String(raw || '') }
  }
  function stableMediaUrl(raw) {
    try {
      const u = new URL(raw)
      u.hash = ''
      const kept = []
      for (const [key, value] of u.searchParams) {
        if (TRACKING.test(key) || EPHEMERAL.test(key)) continue
        kept.push([key, value])
      }
      kept.sort((a, b) => a[0].localeCompare(b[0]))
      u.search = new URLSearchParams(kept).toString()
      return u.toString()
    } catch { return String(raw || '') }
  }
  function safeUrl(raw) { try { const u = new URL(raw); return `${u.origin}${u.pathname}` } catch { return '' } }
  function hostText(url) { try { return new URL(url).hostname.toLowerCase() } catch { return '' } }
  function isAdLikeUrl(url) {
    const host = hostText(url)
    const path = pathText(url)
    if (!host && !path) return false
    if (AD_HOST.test(host)) return true
    if (host.startsWith('ad.') || host.startsWith('ads.') || host.includes('.ads.')) return true
    return AD_PATH.test(host) || AD_PATH.test(path)
  }
  function contentType(headers) {
    if (!headers) return ''
    if (Array.isArray(headers)) return String((headers.find((h) => String(h.name).toLowerCase() === 'content-type') || {}).value || '').split(';')[0].toLowerCase()
    return String(headers['content-type'] || headers['Content-Type'] || '').split(';')[0].toLowerCase()
  }
  function inferType(url, mime) {
    const m = String(mime || '').toLowerCase()
    for (const [known, type] of MIME_TYPES) if (m === known || m.startsWith(known + ';')) return type
    try { const ext = new URL(url).pathname.toLowerCase().split('.').pop(); const hit = EXTENSIONS.find(([e]) => e === ext); if (hit) return hit[1] } catch {}
    return null
  }
  function isNoise(url) {
    try {
      const u = new URL(url), text = `${u.hostname}${u.pathname}`.toLowerCase()
      return /(^|[./_-])(pixel|beacon|analytics|tracking|collect|telemetry|mse|media-segment)([./_-]|$)/.test(text) || /(^|[./_-])(?:1x1|spacer|blank)([./_-]|$)/.test(text) || SEGMENT.test(u.pathname) || (/(?:^|[?&])(?:range|byterange|segment|chunk|part|fragment)=/i.test(u.search) && !/\.(?:mp4|webm|flv|mp3|m4a|aac|ogg|wav|flac)(?:[?#]|$)/i.test(u.pathname))
    } catch { return true }
  }
  function isReliableCandidate(input) {
    if (!input || !input.url || isNoise(input.url)) return false
    const type = input.type || inferType(input.url, input.mime || input.contentType)
    if (!type) return false
    const size = Number(input.size || 0)
    const explicitFile = /\.(?:mp4|webm|flv|mp3|m4a|aac|ogg|wav|flac)(?:[?#]|$)/i.test(input.url)
    if (!MANIFESTS.has(type) && !AUDIO.has(type) && size > 0 && size < MIN_VIDEO_SIZE && !(explicitFile && input.mime && /^video\//i.test(input.mime) && /(?:^|[?&])(?:range|byterange)=/i.test(input.url))) return false
    if (input.requestKind && !MANIFESTS.has(type) && !size && !/\.(?:mp4|webm|flv|mp3|m4a|aac|ogg|wav|flac)(?:[?#]|$)/i.test(input.url)) return false
    if (!MANIFESTS.has(type) && !input.mime && !input.contentType && !/\.(?:mp4|webm|flv|mp3|m4a|aac|ogg|wav|flac)(?:[?#]|$)/i.test(input.url)) return false
    return true
  }
  function pathText(url) {
    try { return new URL(url).pathname.toLowerCase() } catch { return String(url || '').toLowerCase() }
  }
  function filenameFromUrl(url) {
    try {
      const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || '')
      if (name) return name.length > 60 ? `${name.slice(0, 57)}...` : name
    } catch {}
    return String(url || '').length > 60 ? `${String(url).slice(0, 57)}...` : String(url || '')
  }
  function isRelatedDocument(itemUrl, contextUrl) {
    try {
      const item = new URL(itemUrl)
      const context = new URL(contextUrl)
      if (!/^https?:$/.test(item.protocol) || !/^https?:$/.test(context.protocol)) return false
      const itemPath = item.pathname.replace(/\/+$/, '') || '/'
      const contextPath = context.pathname.replace(/\/+$/, '') || '/'
      if (/\.(?:m3u8|mpd|mp4|webm|flv|mkv|mp3|m4a|aac|ogg|wav|flac)$/i.test(itemPath)) return false
      if (item.host.toLowerCase() !== context.host.toLowerCase()) return itemPath !== '/' && contextPath !== '/'
      if (itemPath === '/' || contextPath === '/' || itemPath === contextPath) return false
      if (contextPath.startsWith(`${itemPath}/`) || itemPath.startsWith(`${contextPath}/`)) return false
      return true
    } catch { return false }
  }
  function playlistKindFromUrl(url, type) {
    if (!MANIFESTS.has(type)) return 'unknown'
    try {
      const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || '').toLowerCase()
      const stem = name.replace(/\.(?:m3u8|mpd)$/i, '')
      return MASTER_STEM.test(stem) ? 'master' : 'media'
    } catch { return 'unknown' }
  }
  function identityPenalty(url) {
    const path = pathText(url)
    if (isAdLikeUrl(url)) return 30
    if (HEATMAP.test(path)) return 24
    if (TRAILER.test(path)) return 18
    return 0
  }
  function pageContentHints(pageUrl, pageTitle) {
    const hints = []
    try {
      const parts = new URL(String(pageUrl || '')).pathname.toLowerCase().split('/').filter(Boolean)
      for (const part of parts) {
        if (!PAGE_PATH_SKIP.has(part) && part.length >= 4) hints.push(part)
      }
    } catch {}
    const codes = String(pageTitle || '').toLowerCase().match(/[a-z]{2,8}-\d{2,6}/g)
    if (codes) hints.push(...codes)
    return Array.from(new Set(hints))
  }
  function urlMatchesPage(url, hints) {
    const text = String(url || '').toLowerCase()
    return hints.some((hint) => hint.length >= 4 && text.includes(hint))
  }
  function scoreCandidate(c) {
    const type = c.type || inferType(c.url, c.mime || c.contentType)
    const raw = (c.confidence || 0) + (MANIFESTS.has(type) ? 35 : 20) + (c.size > 0 ? Math.min(25, Math.log10(c.size) * 2) : 0) + (c.source === 'element' ? 12 : 0) + (/^https:/.test(c.url) ? 4 : 0)
    return Math.min(100, Math.max(0, raw - identityPenalty(c.url)))
  }
  function displayTitleFor(item, pageTitle) {
    if ((item.role === 'main' || item.role === 'variant') && pageTitle) return pageTitle
    return filenameFromUrl(item && item.url)
  }
  function pickMain(pool, hints) {
    if (!pool.length) return null
    return pool.slice().sort((a, b) => {
      const pageDelta = Number(urlMatchesPage(b.url, hints)) - Number(urlMatchesPage(a.url, hints))
      if (pageDelta) return pageDelta
      const masterDelta = Number(b.playlistKind === 'master') - Number(a.playlistKind === 'master')
      if (masterDelta) return masterDelta
      const tsDelta = (a.timestamp || 0) - (b.timestamp || 0)
      if (tsDelta) return tsDelta
      return (b.size || 0) - (a.size || 0)
    })[0]
  }
  function classifyMediaRole(items, context) {
    const list = Array.isArray(items) ? items : []
    const pageTitle = context && context.pageTitle ? String(context.pageTitle) : ''
    const pageUrl = context && context.pageUrl ? String(context.pageUrl) : ''
    const hints = pageContentHints(pageUrl, pageTitle)
    const prepared = list.map((raw) => {
      const type = raw.type || inferType(raw.url, raw.mime || raw.mimeType || raw.contentType)
      const path = pathText(raw.url)
      let role = 'unknown'
      if (isAdLikeUrl(raw.url)) role = 'ad'
      else if (pageUrl && raw.pageUrl && isRelatedDocument(raw.pageUrl, pageUrl)) role = 'related'
      else if (HEATMAP.test(path)) role = 'heatmap'
      else if (TRAILER.test(path)) role = 'preview'
      return { ...raw, type, role, playlistKind: playlistKindFromUrl(raw.url, type) }
    })
    const hasManifest = prepared.some((item) => MANIFESTS.has(item.type) && item.role !== 'related' && item.role !== 'ad')
    for (const item of prepared) {
      if (item.role !== 'unknown') continue
      const size = Number(item.size || 0)
      if (hasManifest && !MANIFESTS.has(item.type) && !AUDIO.has(item.type) && size > 0 && size < PREVIEW_SIZE) item.role = 'preview'
    }
    const contenders = prepared.filter((item) => item.role === 'unknown')
    const manifests = contenders.filter((item) => MANIFESTS.has(item.type))
    const pool = manifests.length ? manifests : contenders.filter((item) => !AUDIO.has(item.type))
    const main = pickMain(pool, hints)
    if (main) {
      for (const item of pool) {
        if (item === main) item.role = 'main'
        else if (MANIFESTS.has(item.type)) item.role = 'variant'
      }
    }
    for (const item of prepared) item.displayTitle = displayTitleFor(item, pageTitle)
    return prepared
  }
  function selectDefaultMedia(items) {
    return (Array.isArray(items) ? items : []).filter((item) => item.role === 'main')
  }
  function roleLabel(role) {
    if (role === 'main') return 'Main video'
    if (role === 'variant') return 'Other playlist'
    if (role === 'preview') return 'Preview'
    if (role === 'heatmap') return 'Heatmap'
    if (role === 'related') return 'Related'
    if (role === 'ad') return 'Ad'
    return 'Detected'
  }
  function selectSmartOverlayMedia(items) {
    const list = Array.isArray(items) ? items : []
    const hidden = new Set(['heatmap', 'preview', 'related', 'ad'])
    let visible = list.filter((item) => !hidden.has(item.role))
    if (!visible.length) visible = list.filter((item) => item.role === 'main')
    if (!visible.length) visible = list.filter((item) => (item.type === 'hls' || item.type === 'dash') && item.role !== 'ad')
    if (!visible.length) visible = list.filter((item) => item.role !== 'ad')
    const main = visible.filter((item) => item.role === 'main')
    const variants = visible.filter((item) => item.role === 'variant')
    const rest = visible.filter((item) => item.role !== 'main' && item.role !== 'variant')
    return main.concat(variants.slice(0, 1), rest)
  }
  function pickRefreshedSniffedCandidate(clicked, media) {
    if (!clicked || !clicked.url) return null
    const key = stableMediaUrl(clicked.url)
    const same = (Array.isArray(media) ? media : []).filter((item) => item && item.type === clicked.type && stableMediaUrl(item.url) === key)
    if (!same.length) return clicked
    return same.slice().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))[0] || clicked
  }
  function mergeCandidates(items) {
    const merged = new Map()
    for (const raw of Array.isArray(items) ? items : []) {
      if (!isReliableCandidate(raw)) continue
      const url = canonicalizeUrl(raw.url), type = raw.type || inferType(url, raw.mime || raw.contentType)
      const next = { ...raw, url, type, mime: raw.mime || raw.contentType || '', confidence: Number(raw.confidence || 0) }
      const key = `${url}|${type}`
      const prev = merged.get(key)
      if (!prev) merged.set(key, next)
      else merged.set(key, { ...prev, ...next, url: prev.url, size: Math.max(Number(prev.size || 0), Number(next.size || 0)) || null, timestamp: Math.max(prev.timestamp || 0, next.timestamp || 0), confidence: Math.max(scoreCandidate(prev), scoreCandidate(next)) })
    }
    return Array.from(merged.values()).map((c) => ({ ...c, confidence: Math.round(scoreCandidate(c)) })).sort((a, b) => b.confidence - a.confidence || (b.size || 0) - (a.size || 0) || a.url.localeCompare(b.url))
  }
  function filterSniffedForOverlay(sniffed, videoLoadTime) {
    const list = Array.isArray(sniffed) ? sniffed : []
    const cutoff = videoLoadTime ? videoLoadTime - 1000 : 0
    if (!cutoff) return list.slice()
    const hasFreshManifest = list.some((entry) => {
      const type = entry.type || inferType(entry.url, entry.mime || entry.contentType)
      return MANIFESTS.has(type) && Number(entry.timestamp || 0) >= cutoff
    })
    return list.filter((entry) => {
      const type = entry.type || inferType(entry.url, entry.mime || entry.contentType)
      const ts = Number(entry.timestamp || 0)
      if (MANIFESTS.has(type)) {
        if (isAdLikeUrl(entry.url)) return ts >= cutoff || !hasFreshManifest
        return true
      }
      return ts >= cutoff
    })
  }
  g.VDownloadMediaPatterns = { MIN_VIDEO_SIZE, AUDIO, MANIFESTS, canonicalizeUrl, stableMediaUrl, safeUrl, contentType, inferType, inferTypeFromUrl: (u) => inferType(u, ''), isNoise, isReliableCandidate, isAdLikeUrl, scoreCandidate, mergeCandidates, filterSniffedForOverlay, classifyMediaRole, selectDefaultMedia, selectSmartOverlayMedia, pickRefreshedSniffedCandidate, displayTitleFor, roleLabel, playlistKindFromUrl, validateBatch: (items) => Array.isArray(items) && items.length > 0 }
})(typeof globalThis !== 'undefined' ? globalThis : this)
