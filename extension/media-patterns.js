/* Shared, dependency-free media candidate policy for MV3 and content scripts. */
;(function (g) {
  'use strict'
  const MIN_VIDEO_SIZE = 100000
  const TRACKING = /^(utm_|fbclid$|gclid$|dclid$|msclkid$|mc_cid$|mc_eid$|_ga$|beacon$|pixel$|tracking$|analytics$)/i
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
  function safeUrl(raw) { try { const u = new URL(raw); return `${u.origin}${u.pathname}` } catch { return '' } }
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
  function scoreCandidate(c) {
    const type = c.type || inferType(c.url, c.mime || c.contentType)
    return Math.min(100, (c.confidence || 0) + (MANIFESTS.has(type) ? 35 : 20) + (c.size > 0 ? Math.min(25, Math.log10(c.size) * 2) : 0) + (c.source === 'element' ? 12 : 0) + (/^https:/.test(c.url) ? 4 : 0))
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
  g.VDownloadMediaPatterns = { MIN_VIDEO_SIZE, AUDIO, MANIFESTS, canonicalizeUrl, safeUrl, contentType, inferType, inferTypeFromUrl: (u) => inferType(u, ''), isNoise, isReliableCandidate, scoreCandidate, mergeCandidates, validateBatch: (items) => Array.isArray(items) && items.length > 0 }
})(typeof globalThis !== 'undefined' ? globalThis : this)
