;(function () {
  'use strict'

  const MSG_TYPE = 'DOUYIN_VIDEO_DATA'
  let lastAwemeId = null

  // ── Helpers ──────────────────────────────────────────────────────────────

  function heightToLabel(h) {
    if (h >= 2160) return '4K'
    if (h >= 1440) return '1440p'
    if (h >= 1080) return '1080p'
    if (h >= 720) return '720p'
    return '576p'
  }

  function normalizeUrl(url) {
    if (!url) return ''
    return url.startsWith('//') ? 'https:' + url : url
  }

  function getFiberKey(el) {
    for (const key of Object.keys(el)) {
      if (key.startsWith('__reactFiber$')) return key
    }
    return null
  }

  // Walk fiber tree upward (max 25 levels) looking for a prop named "item" that
  // has an awemeId. Douyin places it at depth ~6 from [data-e2e="feed-active-video"].
  function extractItem(el) {
    const fiberKey = getFiberKey(el)
    if (!fiberKey) return null
    let fiber = el[fiberKey]
    for (let i = 0; i < 25 && fiber; i++) {
      const props = fiber.memoizedProps || fiber.pendingProps
      if (props && props.item) {
        const it = props.item
        if (it.awemeId || it.id) return it
      }
      fiber = fiber.return
    }
    return null
  }

  // ── Format extraction ────────────────────────────────────────────────────

  function buildFormats(video) {
    const list = video.bitRateList || []

    // If no bitRateList, build a single entry from top-level fields
    if (!list.length) {
      if (!video.playApi) return []
      return [{
        label: heightToLabel(video.height || 0),
        width: video.width || 0,
        height: video.height || 0,
        url: video.playApi,
        size: Number(video.dataSize) || 0,
        isH265: !!(video.isH265)
      }]
    }

    // Group by label + codec; keep highest-dataSize entry per group
    const groups = new Map()
    for (const entry of list) {
      if (!entry.playApi) continue
      const label = heightToLabel(entry.height || 0)
      const codec = entry.isH265 ? 'h265' : 'h264'
      const key = `${label}:${codec}`
      const size = Number(entry.dataSize) || 0
      const existing = groups.get(key)
      if (!existing || size > existing.size) {
        groups.set(key, {
          label,
          width: entry.width || 0,
          height: entry.height || 0,
          url: entry.playApi,
          size,
          isH265: codec === 'h265'
        })
      }
    }

    // Sort: H.264 first, then H.265; within codec sort by height descending
    const all = Array.from(groups.values())
    all.sort((a, b) => {
      if (a.isH265 !== b.isH265) return a.isH265 ? 1 : -1
      return b.height - a.height
    })

    // Cap: up to 4 H.264 + up to 2 H.265 = 6 video rows max
    const h264 = all.filter(f => !f.isH265).slice(0, 4)
    const h265 = all.filter(f => f.isH265).slice(0, 2)
    return [...h264, ...h265]
  }

  function buildCover(video) {
    const raw = video.cover || (Array.isArray(video.coverUrlList) && video.coverUrlList[0]) || ''
    const url = normalizeUrl(raw)
    if (!url) return null
    return { url, type: 'jpeg' }
  }

  function buildMusic(music) {
    if (!music) return null
    const rawUri = music.playUrl?.uri || music.playUrl?.url || ''
    const url = normalizeUrl(rawUri)
    if (!url) return null
    return {
      url,
      title: music.title || '',
      type: 'mp3'
    }
  }

  // ── Send ─────────────────────────────────────────────────────────────────

  function extractAndBroadcast(el) {
    let item
    try {
      item = extractItem(el)
    } catch (_) {
      return
    }
    if (!item) return

    const awemeId = String(item.awemeId || item.id || '')
    if (!awemeId) return

    const video = item.video || {}
    const music = item.music || null
    const author = item.author || item.authorInfo || {}

    const formats = buildFormats(video)
    const cover = buildCover(video)
    const musicData = buildMusic(music)

    window.postMessage({
      type: MSG_TYPE,
      source: 'douyin-bridge',
      data: {
        awemeId,
        desc: String(item.desc || '').substring(0, 200),
        author: String(author.nickname || '').substring(0, 80),
        formats,
        cover,
        music: musicData
      }
    }, '*')

    lastAwemeId = awemeId
  }

  // ── Polling ──────────────────────────────────────────────────────────────

  function poll() {
    const el = document.querySelector('[data-e2e="feed-active-video"]')
    if (!el) return
    const vid = el.getAttribute('data-e2e-vid') || ''
    if (vid && vid === lastAwemeId) return
    extractAndBroadcast(el)
  }

  setInterval(poll, 300)

  // ── SPA navigation reset ─────────────────────────────────────────────────

  const _push = history.pushState.bind(history)
  const _replace = history.replaceState.bind(history)
  history.pushState = function (...args) {
    lastAwemeId = null
    return _push(...args)
  }
  history.replaceState = function (...args) {
    lastAwemeId = null
    return _replace(...args)
  }
  window.addEventListener('popstate', () => { lastAwemeId = null })
})()
