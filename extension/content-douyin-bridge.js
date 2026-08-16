;(function () {
  'use strict'

  const MSG_TYPE = 'DOUYIN_VIDEO_DATA'
  const PROFILE_START_TYPE = 'V_DOWNLOAD_START_DOUYIN_PROFILE_IMPORT'
  const PROFILE_RESULT_TYPE = 'DOUYIN_PROFILE_IMPORT_RESULT'
  const RESOLVE_START_TYPE = 'V_DOWNLOAD_START_DOUYIN_RESOLVE'
  const RESOLVE_RESULT_TYPE = 'DOUYIN_RESOLVE_RESULT'
  let lastAwemeId = null
  let profileCollector = null
  let profileResponseHooksInstalled = false
  let resolveCollector = null
  let resolveResponseHooksInstalled = false
  const resolveItemsById = new Map()

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

  function profileSecUid(url) {
    if (typeof url !== 'string') return ''
    try {
      const u = new URL(url)
      const host = u.hostname.toLowerCase()
      if (host !== 'douyin.com' && !host.endsWith('.douyin.com')) return ''
      const match = u.pathname.match(/\/user\/([^/?#]+)/i)
      return match?.[1] ? decodeURIComponent(match[1]) : ''
    } catch {
      return ''
    }
  }

  function profileApiUrl(url) {
    return typeof url === 'string' && /\/aweme\/v1\/web\/aweme\/post\//i.test(url)
  }

  function profileImageArrays(item) {
    const imagePost = item?.image_post && typeof item.image_post === 'object' ? item.image_post : null
    return [
      item?.images,
      item?.image_list,
      item?.imageList,
      imagePost?.images,
      imagePost?.image_list,
      imagePost?.imageList
    ].filter((value) => Array.isArray(value) && value.length > 0)
  }

  function profileImageUrl(image) {
    if (!image || typeof image !== 'object') return ''
    const list = image.url_list || image.urlList
    if (!Array.isArray(list)) return ''
    const raw = list.find((value) => typeof value === 'string' && /^https?:\/\//i.test(value)) || ''
    return normalizeUrl(raw)
  }

  function profileRowFromItem(item) {
    if (!item || typeof item !== 'object') return null
    const awemeId = String(item.aweme_id || item.awemeId || item.id || '').trim()
    if (!/^\d{10,32}$/.test(awemeId)) return null

    const video = item.video && typeof item.video === 'object' ? item.video : {}
    const imageArrays = profileImageArrays(item)
    const hasImages = imageArrays.length > 0
    const awemeType = Number(item.aweme_type || item.awemeType)
    const mediaType = hasImages || awemeType === 68 ? 'gallery' : 'video'
    const cover =
      profileImageUrl(video.cover) ||
      profileImageUrl(imageArrays[0]?.[0])
    const duration = Number(video.duration)
    const imageCount = imageArrays[0]?.length || 0
    const author = item.author && typeof item.author === 'object' ? item.author : {}

    return {
      awemeId,
      mediaType,
      title: String(item.desc || '').trim().slice(0, 200) || `Aweme ${awemeId}`,
      author: String(author.nickname || '').trim().slice(0, 120),
      cover,
      ...(Number.isFinite(duration) && duration > 0 ? { durationSec: Math.floor(duration / 1000) } : {}),
      ...(mediaType === 'gallery' && imageCount > 0 ? { imageCount } : {}),
      pageUrl: `https://www.douyin.com/${mediaType === 'gallery' ? 'note' : 'video'}/${awemeId}`
    }
  }

  function profileItemsFromPayload(payload) {
    if (!payload || typeof payload !== 'object') return []
    const nested = payload.data && typeof payload.data === 'object' ? payload.data : null
    const list = Array.isArray(payload.aweme_list) ? payload.aweme_list : nested?.aweme_list
    return Array.isArray(list) ? list : []
  }

  function resolveItemId(item) {
    if (!item || typeof item !== 'object') return ''
    return String(item.aweme_id || item.awemeId || item.id || '').trim()
  }

  function resolveImageArrays(item) {
    const imagePost = item?.image_post && typeof item.image_post === 'object'
      ? item.image_post
      : item?.imagePost && typeof item.imagePost === 'object'
        ? item.imagePost
        : null
    return [
      item?.images,
      item?.image_list,
      item?.imageList,
      imagePost?.images,
      imagePost?.image_list,
      imagePost?.imageList
    ].find((value) => Array.isArray(value) && value.length > 0) || []
  }

  function resolveHttpUrls(value, depth = 0, out = []) {
    if (depth > 5 || value == null) return out
    if (typeof value === 'string') {
      const url = normalizeUrl(value)
      if (/^https?:\/\//i.test(url)) out.push(url)
      return out
    }
    if (Array.isArray(value)) {
      for (const item of value) resolveHttpUrls(item, depth + 1, out)
      return out
    }
    if (typeof value !== 'object') return out
    const record = value
    for (const key of ['url', 'url_list', 'urlList', 'src', 'play_addr', 'playAddr', 'download_addr', 'downloadAddr', 'play_url', 'playUrl', 'play_api', 'playApi']) {
      resolveHttpUrls(record[key], depth + 1, out)
    }
    return out
  }

  function resolveMotionUrls(image) {
    if (!image || typeof image !== 'object') return []
    const video = image.video || image.motion_video || image.motionVideo
    if (!video || typeof video !== 'object') return []
    const urls = resolveHttpUrls(video)
    return Array.from(new Set(urls))
  }

  function resolveStillUrl(image) {
    if (!image || typeof image !== 'object') return ''
    const urls = resolveHttpUrls(image.url_list || image.urlList)
    return urls[urls.length - 1] || ''
  }

  function resolveItemHasMedia(item) {
    if (!item || typeof item !== 'object') return false
    if (item.video && typeof item.video === 'object') {
      if (buildFormats(item.video).length > 0) return true
    }
    return resolveImageArrays(item).some((image) => resolveStillUrl(image) || resolveMotionUrls(image).length > 0)
  }

  function resolveItemFromValue(value, targetId, depth = 0, seen = new Set()) {
    if (depth > 80 || value == null || typeof value !== 'object' || seen.has(value)) return null
    seen.add(value)
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = resolveItemFromValue(item, targetId, depth + 1, seen)
        if (found) return found
      }
      return null
    }
    const record = value
    const id = resolveItemId(record)
    if (id === targetId && resolveItemHasMedia(record)) return record
    for (const key of Object.keys(record)) {
      const found = resolveItemFromValue(record[key], targetId, depth + 1, seen)
      if (found) return found
    }
    return null
  }

  function resolveCandidateFromProps(props, targetId) {
    if (!props || typeof props !== 'object') return null
    const candidates = [
      props.item,
      props.aweme,
      props.awemeDetail,
      props.aweme_detail,
      props.videoInfo,
      props.data?.aweme_detail,
      props.data?.aweme,
      props.data?.item
    ]
    for (const candidate of candidates) {
      const direct = resolveItemFromValue(candidate, targetId)
      if (direct) return direct
    }
    return null
  }

  function resolveItemFromElement(element, targetId) {
    const fiberKey = getFiberKey(element)
    if (!fiberKey) return null
    let fiber = element[fiberKey]
    for (let i = 0; i < 35 && fiber; i++) {
      const props = fiber.memoizedProps || fiber.pendingProps
      const found = resolveCandidateFromProps(props, targetId)
      if (found) return found
      fiber = fiber.return
    }
    return null
  }

  function findResolveItem(targetId) {
    const cached = resolveItemsById.get(targetId)
    if (cached) return cached

    const preferred = document.querySelectorAll(
      '[data-e2e*="note"],[data-e2e*="video"],[data-e2e*="detail"],[class*="note"],[class*="video"]'
    )
    const visited = new Set()
    const inspect = (element) => {
      if (!element || visited.has(element)) return null
      visited.add(element)
      try {
        const item = resolveItemFromElement(element, targetId)
        if (item) return item
      } catch {
        /* React internals can change while the SPA is rendering. */
      }
      return null
    }
    for (const element of preferred) {
      const item = inspect(element)
      if (item) {
        resolveItemsById.set(targetId, item)
        return item
      }
    }

    // Note pages do not expose the feed-active-video anchor. Walk a bounded
    // number of DOM nodes instead of depending on one Douyin layout class.
    const all = document.querySelectorAll('*')
    const limit = Math.min(all.length, 6000)
    for (let i = 0; i < limit; i++) {
      const item = inspect(all[i])
      if (item) {
        resolveItemsById.set(targetId, item)
        return item
      }
    }
    return null
  }

  function resolveApiUrl(url) {
    return typeof url === 'string' && /\/aweme\/v1\/(?:web\/)?aweme\/detail\//i.test(url)
  }

  function ingestResolvePayload(payload) {
    const targetId = resolveCollector?.awemeId
    if (!targetId) return null
    const item = resolveItemFromValue(payload, targetId)
    if (item) resolveItemsById.set(targetId, item)
    return item
  }

  function installResolveResponseHooks() {
    if (resolveResponseHooksInstalled) return
    resolveResponseHooksInstalled = true

    const originalFetch = window.fetch
    if (typeof originalFetch === 'function') {
      window.fetch = function (...args) {
        const result = originalFetch.apply(this, args)
        Promise.resolve(result).then((response) => {
          const input = args[0]
          const requestUrl = response?.url || (typeof input === 'string' ? input : input?.url) || ''
          if (!resolveApiUrl(requestUrl) || !response?.clone) return
          response.clone().json().then(ingestResolvePayload).catch(() => {})
        }).catch(() => {})
        return result
      }
    }

    const xhrOpen = XMLHttpRequest.prototype.open
    const xhrSend = XMLHttpRequest.prototype.send
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__vdownloadResolveUrl = String(url || '')
      return xhrOpen.call(this, method, url, ...rest)
    }
    XMLHttpRequest.prototype.send = function (...args) {
      this.addEventListener('load', () => {
        const requestUrl = this.responseURL || this.__vdownloadResolveUrl || ''
        if (!resolveApiUrl(requestUrl)) return
        try {
          const payload = this.responseType === 'json' ? this.response : JSON.parse(this.responseText || '{}')
          ingestResolvePayload(payload)
        } catch {
          /* ignore non-JSON responses */
        }
      })
      return xhrSend.apply(this, args)
    }
  }

  async function requestResolveDetail(awemeId) {
    try {
      const query = new URLSearchParams({
        aweme_id: awemeId,
        aid: '6383',
        channel: 'channel_pc_web',
        update_version_code: '170400',
        pc_client_type: '1'
      })
      const response = await fetch(`/aweme/v1/web/aweme/detail/?${query.toString()}`, {
        credentials: 'include',
        headers: { Accept: 'application/json, text/plain, */*' }
      })
      if (response.ok) {
        const payload = await response.json()
        return ingestResolvePayload(payload)
      }
    } catch {
      /* The page's own API request or React fiber may still provide the item. */
    }
    return null
  }

  function buildResolveResult(item, awemeId) {
    if (!item) return null
    const video = item.video && typeof item.video === 'object' ? item.video : {}
    const images = resolveImageArrays(item)
    const imageUrls = []
    let cover = ''
    for (const image of images) {
      const still = resolveStillUrl(image)
      const motion = resolveMotionUrls(image)[0] || ''
      if (!cover) cover = still || motion
      const selected = motion || still
      if (selected) imageUrls.push(selected)
    }
    const formats = buildFormats(video)
    if (imageUrls.length > 0) {
      const author = item.author || item.authorInfo || {}
      return {
        ok: true,
        awemeId,
        mediaType: 'gallery',
        title: String(item.desc || '').trim().slice(0, 200) || `Douyin Images ${awemeId}`,
        author: String(author.nickname || '').trim().slice(0, 120),
        cover,
        imageUrls: Array.from(new Set(imageUrls)).slice(0, 200),
        duration: 0
      }
    }
    const first = formats[0]
    if (!first?.url) return null
    const author = item.author || item.authorInfo || {}
    const duration = Number(video.duration)
    const videoCover = resolveStillUrl(video.cover) || resolveHttpUrls(video.coverUrlList)[0] || cover
    return {
      ok: true,
      awemeId,
      mediaType: 'video',
      title: String(item.desc || '').trim().slice(0, 200) || `Douyin Video ${awemeId}`,
      author: String(author.nickname || '').trim().slice(0, 120),
      cover: videoCover,
      videoUrl: first.url,
      videoUrlFallbacks: formats.slice(1, 8).map((format) => format.url),
      duration: Number.isFinite(duration) && duration > 0 ? Math.floor(duration / 1000) : 0
    }
  }

  /**
   * Current note pages sometimes keep the media in a client-only carousel and
   * do not expose an aweme object through a React fiber. The rendered DOM is a
   * safe last-mile fallback: large `aweme-images` assets are the note gallery,
   * while the centered visible video is the motion-photo MP4 when present.
   */
  function buildResolveDomResult(awemeId) {
    const images = []
    const imageNodes = Array.from(document.images)
    for (const image of imageNodes) {
      const url = normalizeUrl(image.currentSrc || image.src || '')
      if (!/^https?:\/\//i.test(url) || !/aweme-images/i.test(url)) continue
      if (Number(image.naturalWidth || 0) < 500 || Number(image.naturalHeight || 0) < 500) continue
      if (!images.includes(url)) images.push(url)
    }

    const viewportWidth = Math.max(window.innerWidth || 0, document.documentElement?.clientWidth || 0)
    const visibleVideos = Array.from(document.querySelectorAll('video'))
      .map((video) => {
        const url = normalizeUrl(video.currentSrc || video.src || '')
        const rect = video.getBoundingClientRect()
        return { url, rect }
      })
      .filter(({ url, rect }) =>
        /^https?:\/\//i.test(url) &&
        !/\.mp3(?:[?#]|$)/i.test(url) &&
        Number(rect.width) > 500 &&
        Number(rect.height) > 300 &&
        rect.right > 0 &&
        rect.left < viewportWidth
      )
      .sort((a, b) => Math.abs(a.rect.left + a.rect.width / 2 - viewportWidth / 2) - Math.abs(b.rect.left + b.rect.width / 2 - viewportWidth / 2))
      .map(({ url }) => url)
    const motionUrl = visibleVideos[0] || ''
    const mediaUrls = [...images]
    if (motionUrl) {
      const slideMatch = String(document.body?.innerText || '').match(/\b(\d{1,3})\s*\/\s*(\d{1,3})\b/)
      const slideIndex = Number(slideMatch?.[1] || 0)
      if (slideIndex > 0 && slideIndex <= mediaUrls.length) mediaUrls[slideIndex - 1] = motionUrl
      else if (mediaUrls.length > 0) mediaUrls[0] = motionUrl
      else mediaUrls.push(motionUrl)
    }
    const uniqueMediaUrls = Array.from(new Set(mediaUrls)).slice(0, 200)
    const title = String(document.title || '').replace(/\s*[-|｜]\s*抖音\s*$/i, '').trim()
    if (uniqueMediaUrls.length > 1) {
      return {
        ok: true,
        awemeId,
        mediaType: 'gallery',
        title: title.slice(0, 200) || `Douyin Images ${awemeId}`,
        author: '',
        cover: images[0] || motionUrl,
        imageUrls: uniqueMediaUrls,
        duration: 0
      }
    }
    if (motionUrl) {
      return {
        ok: true,
        awemeId,
        mediaType: 'video',
        title: title.slice(0, 200) || `Douyin Video ${awemeId}`,
        author: '',
        cover: images[0] || '',
        videoUrl: motionUrl,
        videoUrlFallbacks: [],
        duration: 0
      }
    }
    return null
  }

  function unavailableResolveError() {
    const text = String(document.body?.innerText || '')
    if (/你要观看的(?:图文|视频)不存在|图文不存在|视频不存在|作品不存在|内容不存在|作品已删除|作品已下架/.test(text)) {
      return 'Douyin reports this post is unavailable or has been removed for the current account.'
    }
    return ''
  }

  function finishResolve(collector, result, error) {
    if (resolveCollector !== collector) return
    resolveCollector = null
    clearTimeout(collector.timer)
    const payload = result || {
      ok: false,
      awemeId: collector.awemeId,
      mediaType: 'video',
      title: '',
      author: '',
      cover: '',
      imageUrls: [],
      videoUrl: '',
      videoUrlFallbacks: [],
      duration: 0,
      error: error || 'Chrome could not read media information from this Douyin page.'
    }
    window.postMessage({
      type: RESOLVE_RESULT_TYPE,
      source: 'douyin-resolve-bridge',
      requestId: collector.requestId,
      ...payload
    }, location.origin)
  }

  async function startResolve(command) {
    const requestId = String(command?.requestId || '').trim()
    const awemeId = String(command?.awemeId || '').trim()
    if (!requestId || !/^\d{10,32}$/.test(awemeId) || !new RegExp(`/(?:note|video|gallery|share/(?:note|video))/${awemeId}(?:[/?#]|$)`, 'i').test(location.href)) {
      window.postMessage({
        type: RESOLVE_RESULT_TYPE,
        source: 'douyin-resolve-bridge',
        requestId,
        ok: false,
        awemeId,
        mediaType: 'video',
        title: '',
        author: '',
        cover: '',
        imageUrls: [],
        videoUrl: '',
        videoUrlFallbacks: [],
        duration: 0,
        error: 'The active Chrome tab is not the requested Douyin page.'
      }, location.origin)
      return
    }

    if (resolveCollector) finishResolve(resolveCollector, null, 'A newer Douyin resolve replaced this request.')
    installResolveResponseHooks()
    const collector = { requestId, awemeId, timer: null }
    resolveCollector = collector
    collector.timer = setTimeout(() => finishResolve(collector, null, 'Chrome Douyin resolve timed out.'), 18_000)

    const unavailable = unavailableResolveError()
    if (unavailable) {
      finishResolve(collector, null, unavailable)
      return
    }

    let item = findResolveItem(awemeId)
    if (!item) item = await requestResolveDetail(awemeId)
    for (let round = 0; !item && round < 14 && resolveCollector === collector; round++) {
      await new Promise((resolve) => setTimeout(resolve, 450))
      item = findResolveItem(awemeId) || resolveItemsById.get(awemeId) || null
    }
    if (resolveCollector !== collector) return
    const result = buildResolveResult(item, awemeId) || buildResolveDomResult(awemeId)
    finishResolve(
      collector,
      result,
      result ? '' : unavailableResolveError() || 'Chrome could not find media data for this Douyin page.'
    )
  }

  function ingestProfilePayload(payload) {
    if (!profileCollector) return 0
    let added = 0
    for (const raw of profileItemsFromPayload(payload)) {
      const row = profileRowFromItem(raw)
      if (!row) continue
      profileCollector.seen.add(row.awemeId)
      if (profileCollector.existing.has(row.awemeId) || profileCollector.rows.has(row.awemeId)) continue
      profileCollector.rows.set(row.awemeId, row)
      added++
    }
    return added
  }

  function scrapeProfileCards() {
    if (!profileCollector) return 0
    let added = 0
    const anchors = document.querySelectorAll('a[href*="/video/"],a[href*="/note/"]')
    for (const anchor of anchors) {
      const href = anchor.href || anchor.getAttribute('href') || ''
      const match = href.match(/\/(video|note)\/(\d{10,32})/i)
      if (!match) continue
      const awemeId = match[2]
      profileCollector.seen.add(awemeId)
      if (profileCollector.existing.has(awemeId) || profileCollector.rows.has(awemeId)) continue
      const img = anchor.querySelector('img')
      const cover = normalizeUrl(img?.currentSrc || img?.src || '')
      const title = String(anchor.getAttribute('title') || anchor.textContent || '').replace(/\s+/g, ' ').trim()
      profileCollector.rows.set(awemeId, {
        awemeId,
        mediaType: match[1].toLowerCase() === 'note' ? 'gallery' : 'video',
        title: title.slice(0, 200) || `Aweme ${awemeId}`,
        author: '',
        cover,
        pageUrl: `https://www.douyin.com/${match[1].toLowerCase() === 'note' ? 'note' : 'video'}/${awemeId}`
      })
      added++
    }
    return added
  }

  function canScrollProfileElement(element) {
    return Boolean(
      element &&
      element.isConnected &&
      Number(element.scrollHeight) > Number(element.clientHeight) + 120
    )
  }

  function profileScrollTarget(collector) {
    if (canScrollProfileElement(collector.scrollTarget)) return collector.scrollTarget

    const candidates = Array.from(document.querySelectorAll('*')).filter(canScrollProfileElement)
    candidates.sort((a, b) => {
      const aClass = String(a.className || '')
      const bClass = String(b.className || '')
      const aProfileRoute = /(?:route-scroll-container|parent-route-container)/i.test(aClass) ? 1 : 0
      const bProfileRoute = /(?:route-scroll-container|parent-route-container)/i.test(bClass) ? 1 : 0
      if (aProfileRoute !== bProfileRoute) return bProfileRoute - aProfileRoute
      return (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight)
    })

    collector.scrollTarget = candidates[0] || null
    return collector.scrollTarget
  }

  function profileScrollMarker(collector) {
    const target = profileScrollTarget(collector)
    if (target) {
      return `element:${Math.round(target.scrollTop)}:${Math.round(target.scrollHeight)}:${Math.round(target.clientHeight)}`
    }
    return `window:${Math.round(window.scrollY || document.documentElement.scrollTop || 0)}`
  }

  function scrollProfilePage(collector) {
    const target = profileScrollTarget(collector)
    if (target) {
      const amount = Math.max(900, Math.floor(target.clientHeight * 0.85))
      const before = target.scrollTop
      try {
        target.scrollBy({ top: amount, left: 0, behavior: 'auto' })
      } catch {
        target.scrollTop += amount
      }
      // Some site scroll locks ignore scrollBy but still allow direct scrollTop.
      if (target.scrollTop === before) target.scrollTop = Math.min(target.scrollHeight, before + amount)
      return
    }
    window.scrollBy(0, Math.max(900, Math.floor(window.innerHeight * 0.85)))
  }

  function installProfileResponseHooks() {
    if (profileResponseHooksInstalled) return
    profileResponseHooksInstalled = true

    const originalFetch = window.fetch
    if (typeof originalFetch === 'function') {
      window.fetch = function (...args) {
        const result = originalFetch.apply(this, args)
        Promise.resolve(result).then((response) => {
          const input = args[0]
          const requestUrl = response?.url || (typeof input === 'string' ? input : input?.url) || ''
          if (!profileApiUrl(requestUrl) || !response?.clone) return
          response.clone().json().then(ingestProfilePayload).catch(() => {})
        }).catch(() => {})
        return result
      }
    }

    const xhrOpen = XMLHttpRequest.prototype.open
    const xhrSend = XMLHttpRequest.prototype.send
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__vdownloadProfileUrl = String(url || '')
      return xhrOpen.call(this, method, url, ...rest)
    }
    XMLHttpRequest.prototype.send = function (...args) {
      this.addEventListener('load', () => {
        const requestUrl = this.responseURL || this.__vdownloadProfileUrl || ''
        if (!profileApiUrl(requestUrl)) return
        try {
          const payload = this.responseType === 'json' ? this.response : JSON.parse(this.responseText || '{}')
          ingestProfilePayload(payload)
        } catch {
          /* ignore non-JSON responses */
        }
      })
      return xhrSend.apply(this, args)
    }
  }

  function finishProfileCollection(collector, error) {
    if (profileCollector !== collector) return
    profileCollector = null
    clearTimeout(collector.timer)
    const items = Array.from(collector.rows.values()).slice(0, 2000)
    const warnings = []
    if (error) warnings.push(error)
    else if (items.length === 0) {
      warnings.push(
        collector.seen.size > 0
          ? `Chrome checked ${collector.seen.size} posts, but none were newer than the ${collector.existing.size} already loaded.`
          : 'Chrome could not find posts in the logged-in Douyin tab. Complete any verification and retry.'
      )
    }
    window.postMessage({
      type: PROFILE_RESULT_TYPE,
      source: 'douyin-profile-bridge',
      requestId: collector.requestId,
      ok: !error,
      items,
      warnings,
      error: error || ''
    }, location.origin)
  }

  async function startProfileCollection(command) {
    const requestId = String(command?.requestId || '').trim()
    const targetSecUid = profileSecUid(String(command?.profileUrl || ''))
    if (!requestId || !targetSecUid || profileSecUid(location.href) !== targetSecUid) {
      window.postMessage({
        type: PROFILE_RESULT_TYPE,
        source: 'douyin-profile-bridge',
        requestId,
        ok: false,
        items: [],
        error: 'The active Chrome tab is not the requested Douyin profile.'
      }, location.origin)
      return
    }

    if (profileCollector) finishProfileCollection(profileCollector, 'A newer profile import replaced this request.')
    installProfileResponseHooks()
    const collector = {
      requestId,
      existing: new Set(Array.isArray(command.existingAwemeIds) ? command.existingAwemeIds.map((id) => String(id)) : []),
      rows: new Map(),
      seen: new Set(),
      scrollTarget: null,
      timer: null
    }
    profileCollector = collector
    const maxScrolls = Number.isInteger(command.maxScrolls) ? Math.max(8, Math.min(120, command.maxScrolls)) : 96
    const idleRounds = Number.isInteger(command.idleRounds) ? Math.max(2, Math.min(10, command.idleRounds)) : 5
    collector.timer = setTimeout(() => finishProfileCollection(collector, 'Chrome profile import timed out.'), 130_000)

    scrapeProfileCards()
    await new Promise((resolve) => setTimeout(resolve, 700))
    let stableRounds = 0
    let lastSeenCount = collector.seen.size
    for (let round = 0; round < maxScrolls && profileCollector === collector; round++) {
      const beforeScroll = profileScrollMarker(collector)
      scrollProfilePage(collector)
      await new Promise((resolve) => setTimeout(resolve, 900))
      scrapeProfileCards()
      const afterScroll = profileScrollMarker(collector)
      const sawMorePosts = collector.seen.size > lastSeenCount
      if (beforeScroll === afterScroll && !sawMorePosts) stableRounds++
      else stableRounds = 0
      lastSeenCount = collector.seen.size
      if (stableRounds >= idleRounds) break
    }
    if (profileCollector === collector) finishProfileCollection(collector, '')
  }

  installProfileResponseHooks()
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return
    if (event.data?.type === RESOLVE_START_TYPE && event.data.source === 'douyin-content') {
      void startResolve(event.data.command)
      return
    }
    if (event.data?.type !== PROFILE_START_TYPE || event.data.source !== 'douyin-content') return
    void startProfileCollection(event.data.command)
  })

  /** playApi (camel) or play_addr.url_list (snake) from fiber / API payloads */
  function playUrlFromBitrateEntry(entry) {
    if (!entry) return ''
    if (entry.playApi) return normalizeUrl(entry.playApi)
    const addr = entry.play_addr || entry.playAddr
    if (addr) {
      const list = addr.url_list || addr.urlList
      if (Array.isArray(list) && list[0]) return normalizeUrl(list[0])
      if (typeof addr.url === 'string') return normalizeUrl(addr.url)
    }
    return ''
  }

  function bitRateListFromVideo(video) {
    const list = video.bitRateList || video.bit_rate_list
    return Array.isArray(list) ? list : []
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
    const list = bitRateListFromVideo(video)

    // If no bitRateList, build a single entry from top-level fields
    if (!list.length) {
      const top =
        normalizeUrl(video.playApi || video.play_url || '') ||
        playUrlFromBitrateEntry(video)
      if (!top) return []
      const h265 = !!(video.isH265 || video.is_h265)
      return [{
        label: heightToLabel(video.height || 0),
        width: video.width || 0,
        height: video.height || 0,
        url: top,
        size: Number(video.dataSize || video.data_size) || 0,
        isH265: h265
      }]
    }

    // Group by label + codec; keep highest-dataSize entry per group
    const groups = new Map()
    for (const entry of list) {
      const url = playUrlFromBitrateEntry(entry)
      if (!url) continue
      const label = heightToLabel(entry.height || 0)
      const h265 = !!(entry.isH265 || entry.is_h265)
      const codec = h265 ? 'h265' : 'h264'
      const key = `${label}:${codec}`
      const size = Number(entry.dataSize || entry.data_size) || 0
      const existing = groups.get(key)
      if (!existing || size > existing.size) {
        groups.set(key, {
          label,
          width: entry.width || 0,
          height: entry.height || 0,
          url,
          size,
          isH265: h265
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
    const pu = music.playUrl || music.play_url
    const rawUri =
      (pu && (pu.uri || pu.url)) ||
      (typeof music.play_url === 'string' ? music.play_url : '') ||
      ''
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
    }, location.origin)

    lastAwemeId = awemeId
  }

  // ── Polling ──────────────────────────────────────────────────────────────

  function poll() {
    if (document.hidden) return
    const el = document.querySelector('[data-e2e="feed-active-video"]')
    if (!el) return
    const vid = el.getAttribute('data-e2e-vid') || ''
    if (vid && vid === lastAwemeId) return
    extractAndBroadcast(el)
  }

  const pollTimer = setInterval(poll, 600)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      lastAwemeId = null
      poll()
    }
  })

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
  window.addEventListener('beforeunload', () => clearInterval(pollTimer))
})()
