;(function () {
  'use strict'

  // ── Constants ───────────────────────────────────────────────────────────

  const MIN_VIDEO_WIDTH = 100
  const MIN_VIDEO_HEIGHT = 100
  const BTN_ATTR = 'data-vdl-overlay'
  const LIST_MODE_KEY = 'vdownload_overlay_list_mode'

  // Query params to keep when building dedup key (original URL always used for download)
  const QUERY_WHITELIST = new Set(['token', 'sig', 'signature', 'expires', 'expire', 'key', 'id'])

  const SVG_DOWNLOAD = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`
  const SVG_VIDEO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>`

  // ── State ───────────────────────────────────────────────────────────────

  // Videos already processed
  const processed = new WeakSet()

  // Per-video state plus one page-level positioning scheduler.
  const videoState = new WeakMap()
  const positionQueue = new Set()
  let positionRafId = null
  let visiblePositionRequested = false

  function flushPositionQueue() {
    positionRafId = null
    if (visiblePositionRequested) {
      visiblePositionRequested = false
      for (const video of document.querySelectorAll('video')) {
        const state = videoState.get(video)
        if (state?.isInViewport || activePanelVideo === video) positionQueue.add(video)
      }
    }
    const queued = Array.from(positionQueue)
    positionQueue.clear()
    for (const queuedVideo of queued) {
      const state = videoState.get(queuedVideo)
      if (!state) continue
      if (typeof state.revealButton === 'function') state.revealButton()
      else state.syncPosition()
    }
  }

  function schedulePositionFlush() {
    if (!positionRafId) positionRafId = requestAnimationFrame(flushPositionQueue)
  }

  function queueVideoPosition(video) {
    if (!video) return
    positionQueue.add(video)
    schedulePositionFlush()
  }

  function queueVisibleVideoPositions() {
    visiblePositionRequested = true
    schedulePositionFlush()
  }

  // Currently open panel (only one at a time)
  let activePanel = null
  let activePanelVideo = null
  let activePanelCleanup = null

  // ── Placement (shared with site-specific content scripts) ───────────────

  const PL = globalThis.VDownloadOverlayPlacement || null

  function isYouTubePage() {
    return PL ? PL.isYouTubePage() : /^https?:\/\/(www\.)?youtube\.com/.test(location.href)
  }

  function isDouyinPage() {
    return PL ? PL.isDouyinPage() : /^https?:\/\/([a-z0-9-]+\.)?(douyin|iesdouyin)\.com/i.test(location.href)
  }

  function isTikTokPage() {
    return PL ? PL.isTikTokPage() : /^https?:\/\/([a-z0-9-]+\.)?tiktok\.com/i.test(location.href)
  }

  function isXPage() {
    return PL ? PL.isXPage() : /^https?:\/\/(www\.)?(x\.com|twitter\.com)/.test(location.href)
  }

  function isYouTubeWatchPage() {
    return PL ? PL.isYouTubeWatchPage() : (() => {
      try {
        const u = new URL(location.href)
        return u.pathname === '/watch' && u.searchParams.has('v')
      } catch {
        return false
      }
    })()
  }

  function getPlacementStrategy() {
    if (PL) return PL.getPlacementStrategy(PL.getSiteContext())
    return 'topRight'
  }

  function getAnchorRect(video) {
    if (PL) {
      const ctx = PL.getSiteContext()
      const anchored = PL.getPlayerRect(ctx, video)
      if (anchored) return anchored
    }
    return video.getBoundingClientRect()
  }

  // ── URL helpers ──────────────────────────────────────────────────────────

  function normalizeUrlForDedup(rawUrl) {
    try {
      const u = new URL(rawUrl)
      u.hash = ''
      const keep = new URLSearchParams()
      for (const [k, v] of u.searchParams) {
        if (QUERY_WHITELIST.has(k.toLowerCase())) keep.set(k, v)
      }
      u.search = keep.toString()
      return u.toString()
    } catch {
      return rawUrl
    }
  }

  function getListMode() {
    try {
      const v = localStorage.getItem(LIST_MODE_KEY)
      return v === 'all' ? 'all' : 'smart'
    } catch {
      return 'smart'
    }
  }

  function setListMode(mode) {
    try {
      localStorage.setItem(LIST_MODE_KEY, mode === 'all' ? 'all' : 'smart')
    } catch {
      // ignore storage failures
    }
  }

  function buildDedupKey(url, type, listMode) {
    const base = listMode === 'all' ? url : normalizeUrlForDedup(url)
    return `${base}|${type}`
  }

  function inferTypeFromUrl(url) {
    const mp = typeof globalThis !== 'undefined' ? globalThis.VDownloadMediaPatterns : null
    if (mp && typeof mp.inferTypeFromUrl === 'function') return mp.inferTypeFromUrl(url)
    if (/\.m3u8(\?|#|$)/i.test(url)) return 'hls'
    if (/\.mp4(\?|#|$)/i.test(url)) return 'mp4'
    if (/\.webm(\?|#|$)/i.test(url)) return 'webm'
    if (/\.flv(\?|#|$)/i.test(url)) return 'flv'
    return 'mp4'
  }

  function formatSize(bytes) {
    if (!bytes) return null
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`
    return `${(bytes / 1073741824).toFixed(2)} GB`
  }

  function isBlobOrStream(url) {
    return url && (url.startsWith('blob:') || url.startsWith('mediastream:'))
  }

  // ── Build format options list ─────────────────────────────────────────────

  function buildOptions(video, sniffed, videoLoadTime, listMode) {
    const shared = globalThis.VDownloadMediaPatterns
    sniffed = shared && shared.mergeCandidates ? shared.mergeCandidates(sniffed) : (sniffed || [])
    const relevant = shared && typeof shared.filterSniffedForOverlay === 'function'
      ? shared.filterSniffedForOverlay(sniffed, videoLoadTime)
      : sniffed
    const seen = new Map() // dedup key → original entry
    const options = []
    const elementOptions = []
    const isBlobSrc = isBlobOrStream(video.currentSrc)
    const hasManifest = relevant.some((e) => e.type === 'hls' || e.type === 'dash')
    const skipElementSources = isBlobSrc && hasManifest

    // 1. From video element sources. MSE/HLS players use blob: src; prefer
    // sniffed manifests in that case instead of empty/unusable element URLs.
    const srcs = []
    if (!skipElementSources && video.currentSrc && !isBlobOrStream(video.currentSrc)) {
      srcs.push({ url: video.currentSrc, mimeType: '' })
    }
    if (!skipElementSources) {
      for (const source of video.querySelectorAll('source')) {
        const src = source.src
        if (src && !isBlobOrStream(src)) {
          srcs.push({ url: src, mimeType: source.type || '' })
        }
      }
    }

    const hasResolution = video.videoWidth > 0 && video.videoHeight > 0
    const resLabel = hasResolution ? `${video.videoHeight}p` : null

    for (const { url, mimeType } of srcs) {
      const sharedCandidate = { url, mime: mimeType, contentType: mimeType, source: 'element', size: null }
      const shared = globalThis.VDownloadMediaPatterns
      if (!shared || !shared.isReliableCandidate(sharedCandidate)) continue
      const type = shared.inferType(url, mimeType)
      const key = buildDedupKey(url, type, listMode)
      if (seen.has(key)) continue
      seen.set(key, true)
      const option = {
        url,
        type,
        label: resLabel ? `${type} (${resLabel})` : type,
        size: null,
        source: 'element',
        confidence: 100
      }
      options.push(option)
      elementOptions.push(option)
    }

    // 2. From background sniffed media. Manifests are kept even if they
    // arrived before this overlay attached; cutoff still drops stale segments.

    // "All" mode: keep near-complete list for manual selection (Downie-like).
    if (listMode === 'all') {
      const sorted = [...relevant].sort((a, b) => {
        const tsDelta = (b.timestamp || 0) - (a.timestamp || 0)
        if (tsDelta !== 0) return tsDelta
        return (b.size || 0) - (a.size || 0)
      })
      for (const entry of sorted.slice(0, 120)) {
        const key = buildDedupKey(entry.url, entry.type, listMode)
        if (seen.has(key)) continue
        seen.set(key, true)
        options.push({
          url: entry.url,
          type: entry.type,
          label: entry.type.toUpperCase(),
          size: entry.size,
          initiator: entry.initiator,
          pageUrl: entry.pageUrl,
          source: 'sniffed',
          confidence: Math.min(100, Number(entry.confidence || 0))
        })
      }
      return applyIdentity(options, listMode)
    }

    // Smart filtering: hide noisy MSE/HLS segments by heuristics.

    const hasHls = relevant.some((e) => e.type === 'hls')
    const SEGMENT_THRESHOLD = 5 * 1024 * 1024 // 5MB: below this + blob src = likely segment

    const byType = new Map()
    for (const entry of relevant) {
      if (!byType.has(entry.type)) byType.set(entry.type, [])
      byType.get(entry.type).push(entry)
    }

    for (const [type, entries] of byType) {
      // Prefer newer sniffed entries to avoid stale ad URLs after stream switches.
      entries.sort((a, b) => {
        const tsDelta = (b.timestamp || 0) - (a.timestamp || 0)
        if (tsDelta !== 0) return tsDelta
        return (b.size || 0) - (a.size || 0)
      })

      let filtered = entries

      if (type === 'hls' || type === 'dash') {
        // Keep every manifest. Identity ranking — not recency — decides Main.
        filtered = entries
      } else if (hasHls) {
        // HLS present: non-HLS entries below threshold are segments → drop them
        filtered = entries.filter((e) => !e.size || e.size >= SEGMENT_THRESHOLD)
        filtered = filtered.slice(0, 2)
      } else if (isBlobSrc && entries.length > 2) {
        // blob: src + many entries of same type = MSE player chunks
        // Only keep the single largest (might be a full file) if it's meaningfully large
        const newestLarge = entries.find((e) => e.size && e.size >= SEGMENT_THRESHOLD)
        if (newestLarge) {
          filtered = [newestLarge]
        } else {
          // All small → these are segments, not useful for download
          filtered = []
        }
      } else {
        // Normal case: few entries, likely real files
        filtered = entries.slice(0, 3)
      }

      for (const entry of filtered) {
        const key = buildDedupKey(entry.url, entry.type, listMode)
        if (seen.has(key)) continue
        seen.set(key, true)
        const option = {
          url: entry.url,
          type: entry.type,
          label: entry.type.toUpperCase(),
          size: entry.size,
          initiator: entry.initiator,
          pageUrl: entry.pageUrl,
          source: entry.source || 'network',
          confidence: Math.min(100, Number(entry.confidence || 0))
        }
        options.push(option)
        // Keep the best same-type network candidate available if the user
        // deliberately picked an element URL first. The click path performs
        // this fallback exactly once after the original request fails.
        for (const element of elementOptions) {
          if (element.type === option.type && option.source !== 'element' && !element.fallbackNetwork) {
            element.fallbackNetwork = option
          }
        }
      }
    }

    // In Smart mode, a sniffed network URL is generally more actionable than
    // a declarative <video>/<source> URL. Keep element rows visible, but put
    // usable network rows first so the common click chooses the better path.
    return applyIdentity(options.sort((a, b) => {
      const aActionable = a.source !== 'element'
      const bActionable = b.source !== 'element'
      if (aActionable !== bActionable) return aActionable ? -1 : 1
      return 0
    }), listMode)
  }

  function identityOptionLabel(item) {
    const type = String(item.type || '').toUpperCase()
    if (item.role === 'main') return `Main · ${type}`
    if (item.role === 'variant') return `Other playlist · ${type}`
    if (item.role === 'preview') return `Preview · ${type}`
    if (item.role === 'heatmap') return `Heatmap · ${type}`
    if (item.role === 'related') return `Related · ${type}`
    if (item.role === 'ad') return `Ad · ${type}`
    return item.label || type
  }

  function applyIdentity(options, listMode) {
    const shared = globalThis.VDownloadMediaPatterns
    if (!shared || typeof shared.classifyMediaRole !== 'function') return options
    const labeled = shared.classifyMediaRole(options, { pageTitle: document.title, pageUrl: location.href })
    const visible = listMode === 'smart' && typeof shared.selectSmartOverlayMedia === 'function'
      ? shared.selectSmartOverlayMedia(labeled)
      : labeled
    return visible.map((item) => ({ ...item, label: identityOptionLabel(item) }))
  }

  // ── Panel DOM builders ───────────────────────────────────────────────────

  function buildPanelItem(opt, onDownload) {
    const item = document.createElement('div')
    item.className = 'vdl-format-item'
    item.setAttribute('role', 'button')
    item.tabIndex = 0
    item.setAttribute('aria-label', `Download ${opt.label}`)

    const icon = document.createElement('span')
    icon.className = 'vdl-format-icon'
    icon.innerHTML = opt.type === 'hls' ? SVG_VIDEO : SVG_VIDEO

    const info = document.createElement('div')
    info.className = 'vdl-format-info'

    const label = document.createElement('div')
    label.className = opt.role === 'main' ? 'vdl-format-label vdl-role-main' : 'vdl-format-label'
    label.textContent = opt.label

    const meta = document.createElement('div')
    meta.className = 'vdl-format-meta'

    const badge = document.createElement('span')
    badge.className = `vdl-format-type vdl-type-${opt.type}`
    badge.textContent = opt.type.toUpperCase()
    meta.appendChild(badge)

    if (opt.size) {
      const sz = document.createElement('span')
      sz.className = 'vdl-format-size'
      sz.textContent = formatSize(opt.size)
      meta.appendChild(sz)
    }
    const source = document.createElement('span')
    source.className = 'vdl-format-size'
    source.textContent = `${opt.source || 'network'} · ${Math.min(100, Number(opt.confidence || 0))}/100`
    meta.appendChild(source)

    info.appendChild(label)
    info.appendChild(meta)

    const dlBtn = document.createElement('button')
    dlBtn.className = 'vdl-format-dl-btn'
    dlBtn.setAttribute('aria-label', `Download ${opt.label}`)
    dlBtn.title = 'Download'
    dlBtn.innerHTML = SVG_DOWNLOAD
    dlBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      onDownload(opt)
    })

    item.addEventListener('click', () => onDownload(opt))
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onDownload(opt)
      }
    })

    const setState = (state, message) => {
      item.dataset.downloadState = state || ''
      dlBtn.disabled = state === 'sending'
      dlBtn.setAttribute('aria-label', message || 'Download')
      dlBtn.title = message || 'Download'
      label.textContent = message || opt.label
    }
    item._ytdlSetState = setState

    item.appendChild(icon)
    item.appendChild(info)
    item.appendChild(dlBtn)
    return item
  }

  let frameSnapshotPromise = null
  let frameSnapshotCache = null
  let frameSnapshotAt = 0
  const FRAME_SNAPSHOT_CACHE_MS = 500

  function fetchFrameMediaSnapshot({ force = false } = {}) {
    const now = Date.now()
    if (!force && frameSnapshotCache && now - frameSnapshotAt < FRAME_SNAPSHOT_CACHE_MS) {
      return Promise.resolve(frameSnapshotCache)
    }
    if (frameSnapshotPromise) return frameSnapshotPromise
    frameSnapshotPromise = new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'GET_FRAME_MEDIA' }, (r) => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError)
        else resolve(r || {})
      })
    }).then((result) => {
      frameSnapshotCache = result
      frameSnapshotAt = Date.now()
      return result
    }).finally(() => {
      frameSnapshotPromise = null
    })
    return frameSnapshotPromise
  }

  function sniffedFingerprint(media) {
    return (media || [])
      .map((m) => `${m.type || ''}|${normalizeUrlForDedup(m.url || '')}|${m.timestamp || 0}`)
      .sort()
      .join('\n')
  }

  function showPanel(video, btn, sniffed, isYouTube, blobDetected, sourceLabel, videoLoadTime) {
    closeActivePanel()

    const panel = document.createElement('div')
    panel.className = 'vdl-format-panel'

    // Header
    const header = document.createElement('div')
    header.className = 'vdl-panel-header'
    const headerTitle = document.createElement('span')
    headerTitle.textContent = 'Download'
    header.appendChild(headerTitle)
    let listMode = getListMode()
    if (!isYouTube) {
      const modeBtn = document.createElement('button')
      modeBtn.type = 'button'
      modeBtn.className = 'vdl-panel-mode-btn'
      modeBtn.title = 'Toggle Smart/All media list'
      modeBtn.textContent = listMode === 'all' ? 'All' : 'Smart'
      header.appendChild(modeBtn)
    }
    if (sourceLabel && sourceLabel !== 'frame') {
      const badge = document.createElement('span')
      badge.className = 'vdl-panel-source-badge'
      badge.textContent = sourceLabel === 'tab-fallback' ? 'tab' : sourceLabel
      header.appendChild(badge)
    }
    panel.appendChild(header)

    // Content area
    if (isYouTube) {
      // YouTube watch: single option delegated to Electron/yt-dlp
      const item = document.createElement('div')
      item.className = 'vdl-format-item'
      item.setAttribute('role', 'button')
      item.tabIndex = 0
      item.setAttribute('aria-label', 'Download video')
      const icon = document.createElement('span')
      icon.className = 'vdl-format-icon'
      icon.innerHTML = SVG_VIDEO
      const info = document.createElement('div')
      info.className = 'vdl-format-info'
      const lbl = document.createElement('div')
      lbl.className = 'vdl-format-label'
      lbl.textContent = 'Download Video'
      const meta2 = document.createElement('div')
      meta2.className = 'vdl-format-meta'
      const badge2 = document.createElement('span')
      badge2.className = 'vdl-format-type vdl-type-yt'
      badge2.textContent = 'YouTube'
      meta2.appendChild(badge2)
      info.appendChild(lbl)
      info.appendChild(meta2)
      const dlBtn = document.createElement('button')
      dlBtn.className = 'vdl-format-dl-btn'
      dlBtn.setAttribute('aria-label', 'Download video')
      dlBtn.innerHTML = SVG_DOWNLOAD
      const doYTDownload = () => {
        closeActivePanel()
        flashButton(btn, 'vdl-sending')
        const wakeFromGesture = globalThis.__vdownloadWakeFromUserGesture
        const surfacedWake = typeof wakeFromGesture === 'function' ? wakeFromGesture() === true : false
        chrome.runtime.sendMessage({ type: 'DOWNLOAD_VIDEO', url: location.href, surfacedWake }, (resp) => {
          const failed = Boolean(chrome.runtime.lastError || !resp || resp.error || resp.ok === false)
          flashButton(btn, failed ? 'vdl-error' : 'vdl-sent')
        })
      }
      dlBtn.addEventListener('click', (e) => { e.stopPropagation(); doYTDownload() })
      item.addEventListener('click', doYTDownload)
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          doYTDownload()
        }
      })
      item.appendChild(icon)
      item.appendChild(info)
      item.appendChild(dlBtn)
      panel.appendChild(item)
    } else {
      const content = document.createElement('div')
      panel.appendChild(content)
      const itemStates = new Map()
      const inFlightUrls = new Set()
      const submittedUrls = new Set()

      let latestSniffed = Array.isArray(sniffed) ? sniffed : []
      let lastSniffedKey = sniffedFingerprint(latestSniffed)

      const renderOptions = () => {
        content.innerHTML = ''
        const options = buildOptions(video, latestSniffed, videoLoadTime, listMode)

        if (options.length === 0) {
          const empty = document.createElement('div')
          empty.className = 'vdl-panel-empty'
          empty.textContent = 'Use the toolbar popup to pick media'
          content.appendChild(empty)
          return options
        }

        const getLatestSniffedOption = async (clickedOpt) => {
          if (clickedOpt.source !== 'sniffed') return clickedOpt
          try {
            const resp = await fetchFrameMediaSnapshot({ force: true })
            const media = globalThis.VDownloadMediaPatterns?.filterSniffedForOverlay
              ? globalThis.VDownloadMediaPatterns.filterSniffedForOverlay(resp.media || [], videoLoadTime)
              : (resp.media || [])
            const picked = globalThis.VDownloadMediaPatterns?.pickRefreshedSniffedCandidate
              ? globalThis.VDownloadMediaPatterns.pickRefreshedSniffedCandidate(clickedOpt, media)
              : clickedOpt
            if (!picked) return null
            return {
              ...clickedOpt,
              url: picked.url,
              type: picked.type || clickedOpt.type,
              initiator: picked.initiator || clickedOpt.initiator || ''
            }
          } catch {
            return clickedOpt
          }
        }

        for (const opt of options) {
          const row = buildPanelItem(opt, async (clickedOpt) => {
            const key = buildDedupKey(clickedOpt.url, clickedOpt.type, listMode)
            const previous = itemStates.get(key)
            if (previous === 'sending' || previous === 'queued') return
            const clickedUrlKey = `${clickedOpt.type}|${clickedOpt.url}`
            const fallbackUrlKey = clickedOpt.fallbackNetwork
              ? `${clickedOpt.fallbackNetwork.type}|${clickedOpt.fallbackNetwork.url}`
              : ''
            if (submittedUrls.has(clickedUrlKey) || submittedUrls.has(fallbackUrlKey)) return
            itemStates.set(key, 'sending')
            row._ytdlSetState('sending', 'Sending…')
            flashButton(btn, 'vdl-sending')

            // This is still the original candidate click. Open the protocol here,
            // before the async snapshot, so the background can safely avoid a
            // second wake attempt.
            const wakeFromGesture = globalThis.__vdownloadWakeFromUserGesture
            // Must happen synchronously in this click task. Any await before
            // anchor.click() can consume Chrome's transient user activation.
            const surfacedWake = typeof wakeFromGesture === 'function' ? wakeFromGesture() === true : false

            // A refresh can race with a player transition and briefly return
            // no candidates. The row already contains a validated URL, so
            // keep sending that candidate instead of waking the app and then
            // silently abandoning the click.
            const latestOpt = await getLatestSniffedOption(clickedOpt) || clickedOpt
            const item = {
              url: latestOpt.url,
              type: latestOpt.type,
              initiator: latestOpt.initiator || ''
            }
            const send = (candidate) => new Promise((resolve) => {
              const urlKey = `${candidate.type}|${candidate.url}`
              if (submittedUrls.has(urlKey) || inFlightUrls.has(urlKey)) return resolve({ ok: false, duplicate: true })
              inFlightUrls.add(urlKey)
              // Compatibility shape: DOWNLOAD_MEDIA_FROM_CONTENT', item, surfacedWake }
              chrome.runtime.sendMessage({ type: 'DOWNLOAD_MEDIA_FROM_CONTENT', item: candidate, surfacedWake }, (resp) => {
                inFlightUrls.delete(urlKey)
                const result = chrome.runtime.lastError
                  ? { ok: false, error: chrome.runtime.lastError.message || 'retry' }
                  : (resp || { ok: false, error: 'retry' })
                if (result.ok) submittedUrls.add(urlKey)
                resolve(result)
              })
            })
            let resp = await send(item)
            const fallback = clickedOpt.source === 'element' && clickedOpt.fallbackNetwork
            if (!resp.ok && fallback && fallback.url !== item.url && !submittedUrls.has(`${fallback.type}|${fallback.url}`)) {
              row._ytdlSetState('sending', 'Retrying network…')
              resp = await send({ url: fallback.url, type: fallback.type, initiator: fallback.initiator || '' })
            }
            if (resp.ok) {
              itemStates.set(key, 'queued')
              row._ytdlSetState('queued', 'Added to queue')
              flashButton(btn, 'vdl-sent')
            } else {
              itemStates.set(key, 'error')
              // Preserve the established surfaced error wording (Error — retry) for callers
              // that do not provide a useful response error.
              row._ytdlSetState('error', `Error — ${resp.error || 'retry'}`)
              flashButton(btn, 'vdl-error')
            }
          })
          content.appendChild(row)
        }
        return options
      }

      let renderedOptions = renderOptions()
      const modeBtn = header.querySelector('.vdl-panel-mode-btn')
      if (modeBtn) {
        modeBtn.addEventListener('click', (e) => {
          e.preventDefault()
          e.stopPropagation()
          listMode = listMode === 'all' ? 'smart' : 'all'
          modeBtn.textContent = listMode === 'all' ? 'All' : 'Smart'
          setListMode(listMode)
          renderedOptions = renderOptions()
          reposPanel(panel, btn)
        })
      }

      if (blobDetected) {
        const note = document.createElement('div')
        note.className = 'vdl-panel-note'
        note.textContent = renderedOptions.length > 0
          ? (listMode === 'all'
              ? 'All mode: showing more stream candidates; pick manually.'
              : 'Page stream — downloading via sniffed address')
          : 'This video uses encrypted streaming. Use the toolbar popup to pick media.'
        panel.appendChild(note)
      }

      // While panel stays open, poll frame media and refresh list when new resources arrive.
      const pollId = setInterval(async () => {
        if (document.hidden || !(activePanel && activePanelVideo === video)) return
        try {
          const resp = await fetchFrameMediaSnapshot()
          const media = resp.media || []
          const nextKey = sniffedFingerprint(media)
          if (nextKey !== lastSniffedKey) {
            latestSniffed = media
            lastSniffedKey = nextKey
            renderedOptions = renderOptions()
            reposPanel(panel, btn)
          }
        } catch {
          // ignore transient extension/runtime fetch errors
        }
      }, 2500)
      activePanelCleanup = () => {
        clearInterval(pollId)
      }
    }

    panel._ytdlAnchorRect = getAnchorRect(video)
    positionPanel(panel, btn, video)
    overlayButtonHostForVideo(video).appendChild(panel)
    activePanel = panel
    activePanelVideo = video
  }

  // Initial panel placement: measures panel dimensions, then removes (caller must re-append).
  function positionPanel(panel, btn, video) {
    const btnRect = btn.getBoundingClientRect()

    // Temporarily place off-screen to measure
    panel.style.visibility = 'hidden'
    panel.style.top = '-9999px'
    panel.style.left = '-9999px'
    overlayButtonHostForVideo(video).appendChild(panel)
    const pw = panel.offsetWidth || 240
    const ph = panel.offsetHeight || 120
    panel.remove()

    applyPanelPosition(panel, btnRect, pw, ph, panel._ytdlAnchorRect || null)
    panel.style.visibility = ''
  }

  // Lightweight reposition for rAF loop: panel is already in DOM, no removal.
  function reposPanel(panel, btn, anchorRect) {
    const btnRect = btn.getBoundingClientRect()
    const pw = panel.offsetWidth || 240
    const ph = panel.offsetHeight || 120
    applyPanelPosition(panel, btnRect, pw, ph, anchorRect || panel._ytdlAnchorRect || null)
  }

  function applyPanelPosition(panel, btnRect, pw, ph, anchorRect) {
    if (PL) {
      const pos = PL.computePanelPosition(anchorRect || btnRect, btnRect, pw, ph)
      PL.applyPanelStyles(panel, pos)
      return
    }
    const vw = window.innerWidth
    const vh = window.innerHeight
    let top = btnRect.bottom + 6
    let left = btnRect.right - pw
    if (left < 6) left = 6
    if (left + pw > vw - 6) left = vw - pw - 6
    if (top + ph > vh - 6) top = btnRect.top - ph - 6
    if (top < 6) top = 6
    panel.style.top = `${top}px`
    panel.style.left = `${left}px`
  }

  let scrollAnchorRect = null

  function closeActivePanel() {
    scrollAnchorRect = null
    if (activePanelCleanup) {
      try { activePanelCleanup() } catch {}
      activePanelCleanup = null
    }
    if (activePanel) {
      activePanel.remove()
      activePanel = null
      activePanelVideo = null
    }
  }

  // ── Flash feedback on overlay button ────────────────────────────────────

  function flashButton(btn, cls) {
    btn.classList.remove('vdl-sending', 'vdl-sent', 'vdl-error')
    if (cls) {
      btn.classList.add(cls)
      setTimeout(() => btn.classList.remove(cls), 1200)
    }
  }

  // ── Page-level suppression for YouTube non-watch pages ──────────────────

  let suppressed = false

  function updateSuppression() {
    if (isYouTubePage() && !isYouTubeWatchPage()) {
      if (!suppressed) {
        suppressed = true
        hideAllOverlays()
      }
    } else {
      if (suppressed) {
        suppressed = false
        showEligibleOverlays()
      }
    }
  }

  function hideAllOverlays() {
    for (const video of document.querySelectorAll('video')) {
      const state = videoState.get(video)
      if (!state) continue
      if (typeof state.hideButton === 'function') state.hideButton()
      else {
        state.btn.classList.remove('vdl-visible')
        state.btn.classList.add('vdl-hidden')
      }
      state.stopCandidateRefresh?.()
    }
    closeActivePanel()
  }

  function showEligibleOverlays() {
    for (const video of document.querySelectorAll('video')) {
      const state = videoState.get(video)
      if (!state) continue
      state.rearmCandidateDiscovery?.()
      state.revealButton()
    }
  }

  // ── Overlay button per video ─────────────────────────────────────────────

  function createOverlayForVideo(video) {
    if (processed.has(video)) return
    processed.add(video)

    const BTN_SIZE = PL ? PL.DEFAULT_BTN_SIZE : 32
    const BTN_INSET = PL ? PL.DEFAULT_INSET : 10
    const placementStrategy = getPlacementStrategy()

    const btn = document.createElement('button')
    btn.className = 'vdl-overlay-btn vdl-hidden'
    btn.setAttribute('aria-label', 'Download with V-Download')
    btn.setAttribute('aria-hidden', 'true')
    btn.title = 'Download with V-Download'
    btn.innerHTML = SVG_DOWNLOAD
    btn.setAttribute(BTN_ATTR, '1')
    overlayButtonHostForVideo(video).appendChild(btn)

    let isInViewport = false
    let prevRect = null
    let lastVideoFingerprint = ''
    let hasReliableCandidate = false
    let candidateRefreshTimer = null
    let sourceChangeTimer = null
    const isYTResolver = () => isYouTubePage() && isYouTubeWatchPage()
    function hideButton() {
      btn.classList.remove('vdl-visible')
      btn.classList.add('vdl-hidden')
      btn.setAttribute('aria-hidden', 'true')
    }
    function revealButton() {
      if (!hasReliableCandidate || !isInViewport || suppressed) {
        hideButton()
        return
      }
      if (!syncPosition()) {
        hideButton()
        return
      }
      btn.classList.remove('vdl-hidden')
      btn.classList.add('vdl-visible')
      btn.removeAttribute('aria-hidden')
    }
    function setCandidateVisibility(available) {
      hasReliableCandidate = isYTResolver() || available
      if (!hasReliableCandidate) {
        hideButton()
      } else if (isInViewport && !suppressed) {
        revealButton()
        queueVideoPosition(video)
      } else {
        hideButton()
      }
    }
    let candidateRefreshInFlight = false
    let lastCandidateRefreshAt = 0
    const refreshCandidateVisibility = async () => {
      if (document.hidden) return
      if (isYTResolver()) { setCandidateVisibility(true); return }
      const elementCandidate = Array.from(video.querySelectorAll('source')).some((source) => {
        const candidate = { url: source.src, mime: source.type || '', source: 'element' }
        return globalThis.VDownloadMediaPatterns?.isReliableCandidate(candidate)
      }) || globalThis.VDownloadMediaPatterns?.isReliableCandidate({ url: video.currentSrc, source: 'element' })
      if (elementCandidate) { setCandidateVisibility(true); return }
      const now = Date.now()
      if (candidateRefreshInFlight || now - lastCandidateRefreshAt < 3500) return
      candidateRefreshInFlight = true
      lastCandidateRefreshAt = now
      try {
        const resp = await fetchFrameMediaSnapshot()
        setCandidateVisibility((resp.media || []).some((candidate) => globalThis.VDownloadMediaPatterns?.isReliableCandidate(candidate)))
      } catch { setCandidateVisibility(false) }
      finally { candidateRefreshInFlight = false }
    }
    const startCandidateRefresh = () => {
      if (candidateRefreshTimer || isYTResolver() || !isInViewport || suppressed || document.hidden) return
      candidateRefreshTimer = setInterval(() => {
        if (document.hidden || !isInViewport || suppressed || hasReliableCandidate) return
        void refreshCandidateVisibility()
      }, 5000)
    }
    const stopCandidateRefresh = () => {
      if (candidateRefreshTimer) clearInterval(candidateRefreshTimer)
      candidateRefreshTimer = null
    }

    let videoLoadTime = Date.now()
    const currentFingerprint = () =>
      [
        video.currentSrc || '',
        video.src || '',
        video.duration || 0,
        video.videoWidth || 0,
        video.videoHeight || 0
      ].join('|')
    const onSourceChange = () => {
      videoLoadTime = Date.now()
      lastVideoFingerprint = currentFingerprint()
      if (activePanel && activePanelVideo === video) {
        closeActivePanel()
      }
      setCandidateVisibility(false)
      if (isInViewport && !suppressed) startCandidateRefresh()
      void refreshCandidateVisibility()
    }
    lastVideoFingerprint = currentFingerprint()
    video.addEventListener('loadstart', onSourceChange)
    video.addEventListener('loadeddata', onSourceChange)
    video.addEventListener('loadedmetadata', onSourceChange)
    video.addEventListener('durationchange', onSourceChange)
    video.addEventListener('emptied', onSourceChange)
    const scheduleSourceChange = () => {
      if (sourceChangeTimer) return
      sourceChangeTimer = setTimeout(() => {
        sourceChangeTimer = null
        onSourceChange()
      }, 120)
    }
    const sourceObserver = new MutationObserver(scheduleSourceChange)
    sourceObserver.observe(video, { attributes: true, attributeFilter: ['src', 'poster'] })
    sourceObserver.observe(video, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'type']
    })

    function syncPosition() {
      if (suppressed) return false

      const anchorRect = getAnchorRect(video)
      const rect = anchorRect || video.getBoundingClientRect()
      const fp = currentFingerprint()
      if (fp !== lastVideoFingerprint) {
        lastVideoFingerprint = fp
        videoLoadTime = Date.now()
        // Stream switched (e.g. ad -> main content): drop stale panel options.
        if (activePanel && activePanelVideo === video) {
          closeActivePanel()
        }
      }

      if (activePanel && activePanelVideo === video) {
        const gone = PL
          ? PL.anchorOffscreen(rect)
          : (rect.width < 10 || rect.height < 10 ||
            rect.bottom < 0 || rect.top > window.innerHeight)
        const moved = PL
          ? PL.anchorMovedSignificantly(prevRect, rect)
          : (prevRect && (
            Math.abs(rect.top - prevRect.top) > 30 ||
            Math.abs(rect.width - prevRect.width) > 50
          ))
        if (gone || moved) {
          closeActivePanel()
        } else {
          if (activePanel) activePanel._ytdlAnchorRect = rect
          reposPanel(activePanel, btn, rect)
        }
      }
      prevRect = rect

      if (rect.width < 10 || rect.height < 10) return false

      const btnPos = PL
        ? PL.computeButtonPosition(rect, placementStrategy, BTN_SIZE, BTN_INSET)
        : {
          top: rect.top + BTN_INSET,
          left: rect.right - BTN_INSET - BTN_SIZE
        }
      if (!btnPos) return false
      btn.style.setProperty('--vdl-overlay-x', `${btnPos.left}px`)
      btn.style.setProperty('--vdl-overlay-y', `${btnPos.top}px`)
      return true
    }

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        isInViewport = entry.isIntersecting
        if (isInViewport && !suppressed && hasReliableCandidate) {
          revealButton()
          queueVideoPosition(video)
          stopCandidateRefresh()
        } else {
          hideButton()
          if (activePanel && activePanelVideo === video) closeActivePanel()
          positionQueue.delete(video)
          if (isInViewport && !suppressed && !hasReliableCandidate) startCandidateRefresh()
        }
      }
    }, { threshold: 0.1 })

    observer.observe(video)
    void refreshCandidateVisibility()
    const onWindowResize = () => {
      queueVideoPosition(video)
    }
    window.addEventListener('resize', onWindowResize)

    btn.addEventListener('click', async (e) => {
      e.preventDefault()
      e.stopPropagation()

      if (activePanel && activePanelVideo === video) {
        closeActivePanel()
        return
      }

      closeActivePanel()

      let sniffed = []
      let isYouTube = isYouTubePage() && isYouTubeWatchPage()
      let sourceLabel = ''
      let errorMsg = null

      if (!isYouTube) {
        try {
          const resp = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({ type: 'GET_FRAME_MEDIA' }, (r) => {
              if (chrome.runtime.lastError) reject(chrome.runtime.lastError)
              else resolve(r)
            })
          })
          sniffed = (globalThis.VDownloadMediaPatterns && globalThis.VDownloadMediaPatterns.mergeCandidates)
            ? globalThis.VDownloadMediaPatterns.mergeCandidates(resp.media || [])
            : (resp.media || [])
          sourceLabel = resp.source || ''
          isYouTube = resp.isYouTube && isYouTubeWatchPage()
        } catch (err) {
          errorMsg = 'Unable to fetch media info'
          console.warn('[ytdl overlay] GET_FRAME_MEDIA failed:', err)
        }
      }

      if (errorMsg) {
        const panel = document.createElement('div')
        panel.className = 'vdl-format-panel'
        const errDiv = document.createElement('div')
        errDiv.className = 'vdl-panel-error'
        errDiv.textContent = errorMsg
        panel.appendChild(errDiv)
        positionPanel(panel, btn, video)
        overlayButtonHostForVideo(video).appendChild(panel)
        activePanel = panel
        activePanelVideo = video
        return
      }

      const blobDetected = isBlobOrStream(video.currentSrc)

      showPanel(video, btn, sniffed, isYouTube, blobDetected, sourceLabel, videoLoadTime)
    })

    const cleanup = () => {
      if (cleanup.done) return
      cleanup.done = true
      observer.disconnect()
      positionQueue.delete(video)
      stopCandidateRefresh()
      if (sourceChangeTimer) clearTimeout(sourceChangeTimer)
      btn.remove()
      video.removeEventListener('loadstart', onSourceChange)
      video.removeEventListener('loadeddata', onSourceChange)
      video.removeEventListener('loadedmetadata', onSourceChange)
      video.removeEventListener('durationchange', onSourceChange)
      video.removeEventListener('emptied', onSourceChange)
      sourceObserver.disconnect()
      window.removeEventListener('resize', onWindowResize)
      if (activePanel && activePanelVideo === video) closeActivePanel()
      processed.delete(video)
      videoState.delete(video)
    }

    videoState.set(video, {
      btn, cleanup, observer,
      get hasReliableCandidate() { return hasReliableCandidate },
      get isInViewport() { return isInViewport },
      syncPosition,
      revealButton,
      hideButton,
      rearmCandidateDiscovery: () => {
        if (!hasReliableCandidate && isInViewport && !suppressed) {
          startCandidateRefresh()
          void refreshCandidateVisibility()
        }
      },
      stopCandidateRefresh
    })
  }

  // ── Video eligibility check ──────────────────────────────────────────────

  function layoutArea(el) {
    if (PL && typeof PL.layoutArea === 'function') return PL.layoutArea(el)
    if (!el || typeof el.getBoundingClientRect !== 'function') return 0
    const rect = el.getBoundingClientRect()
    return Math.max(0, rect.width) * Math.max(0, rect.height)
  }

  function largestVideoIn(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return null
    const minArea = MIN_VIDEO_WIDTH * MIN_VIDEO_HEIGHT
    if (PL && typeof PL.pickLargestVisible === 'function') {
      return PL.pickLargestVisible(root.querySelectorAll('video'), minArea)
    }
    let best = null
    let bestArea = 0
    for (const candidate of root.querySelectorAll('video')) {
      const area = layoutArea(candidate)
      if (area < minArea) continue
      if (area > bestArea) {
        bestArea = area
        best = candidate
      }
    }
    return best
  }

  function collectYouTubeMainVideos(root, into) {
    if (!root || typeof root.querySelectorAll !== 'function') return
    for (const video of root.querySelectorAll('#movie_player video.html5-main-video, video.html5-main-video')) {
      if (!into.includes(video)) into.push(video)
    }
  }

  function getYouTubePrimaryVideo() {
    const scoped = overlayScopeRoot()
    const mains = []
    collectYouTubeMainVideos(scoped, mains)
    if (scoped !== document) collectYouTubeMainVideos(document, mains)

    const minArea = MIN_VIDEO_WIDTH * MIN_VIDEO_HEIGHT
    const bestMain = PL && typeof PL.pickLargestVisible === 'function'
      ? PL.pickLargestVisible(mains, minArea)
      : (() => {
          let best = null
          let bestArea = 0
          for (const video of mains) {
            const area = layoutArea(video)
            if (area < minArea) continue
            if (area > bestArea) {
              bestArea = area
              best = video
            }
          }
          return best
        })()
    if (bestMain) return bestMain

    const player = (scoped.querySelector && (
      scoped.querySelector('.html5-video-player.ytp-fullscreen') ||
      scoped.querySelector('#movie_player') ||
      scoped.querySelector('.html5-video-player')
    )) ||
      document.querySelector('.html5-video-player.ytp-fullscreen') ||
      document.querySelector('#movie_player') ||
      document.querySelector('.html5-video-player')
    return largestVideoIn(player) || largestVideoIn(scoped) || largestVideoIn(document)
  }

  function overlayScopeRoot() {
    if (PL && typeof PL.overlayScopeRoot === 'function') return PL.overlayScopeRoot(document)
    return document.fullscreenElement || document
  }

  function overlayButtonHostForVideo(video) {
    const fullscreen = document.fullscreenElement
    if (fullscreen && shouldReparentOverlayVideo(video, fullscreen)) return overlayButtonHost()
    return document.documentElement
  }

  function overlayButtonHost() {
    if (PL && typeof PL.overlayButtonHost === 'function') return PL.overlayButtonHost(document)
    return document.fullscreenElement || document.documentElement
  }

  function shouldReparentOverlayVideo(video, fullscreenEl) {
    if (PL && typeof PL.shouldReparentOverlayVideo === 'function') {
      return PL.shouldReparentOverlayVideo(video, fullscreenEl)
    }
    if (!video || !fullscreenEl) return false
    if (video === fullscreenEl) return true
    return typeof fullscreenEl.contains === 'function' && fullscreenEl.contains(video)
  }

  function reparentOverlayButtons() {
    const fullscreen = document.fullscreenElement
    for (const video of document.querySelectorAll('video')) {
      const state = videoState.get(video)
      if (!state?.btn) continue
      const host = fullscreen && shouldReparentOverlayVideo(video, fullscreen)
        ? overlayButtonHost()
        : document.documentElement
      if (state.btn.parentElement !== host) host.appendChild(state.btn)
      state.syncPosition()
    }
    if (activePanel) {
      const host = fullscreen && activePanelVideo && shouldReparentOverlayVideo(activePanelVideo, fullscreen)
        ? overlayButtonHost()
        : document.documentElement
      if (activePanel.parentElement !== host) host.appendChild(activePanel)
      const state = activePanelVideo ? videoState.get(activePanelVideo) : null
      if (state?.btn) reposPanel(activePanel, state.btn)
    }
    queueVisibleVideoPositions()
  }

  function isEligibleVideo(video) {
    if (processed.has(video)) return false
    if (isDouyinPage()) return false
    if (isTikTokPage()) return false
    if (isXPage()) return false
    if (isYouTubePage()) {
      if (!isYouTubeWatchPage()) return false
      const primary = getYouTubePrimaryVideo()
      if (primary && video !== primary) return false
    }

    const rect = video.getBoundingClientRect()
    if (rect.width >= MIN_VIDEO_WIDTH && rect.height >= MIN_VIDEO_HEIGHT) return true
    if (video.videoWidth >= MIN_VIDEO_WIDTH && video.videoHeight >= MIN_VIDEO_HEIGHT) return true
    return false
  }

  function tryAttach(video) {
    if (!isEligibleVideo(video)) return
    createOverlayForVideo(video)
  }

  // ── Global click / key handlers for panel dismissal ──────────────────────

  document.addEventListener('click', (e) => {
    if (!activePanel) return
    if (!activePanel.contains(e.target) && !e.target.closest(`[${BTN_ATTR}]`)) {
      closeActivePanel()
    }
  }, true)

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && activePanel) closeActivePanel()
  })

  window.addEventListener('scroll', () => {
    queueVisibleVideoPositions()
    if (!activePanel || !activePanelVideo) return
    const site = PL ? PL.getSiteContext().site : 'generic'
    if (PL && !PL.shouldDismissPanelOnScroll(site)) return
    const rect = getAnchorRect(activePanelVideo)
    if (!scrollAnchorRect) {
      scrollAnchorRect = rect
      return
    }
    if (!rect || (PL ? PL.anchorMovedSignificantly(scrollAnchorRect, rect) : false)) {
      closeActivePanel()
      return
    }
    scrollAnchorRect = rect
    const state = videoState.get(activePanelVideo)
    if (state && state.btn) reposPanel(activePanel, state.btn, rect)
  }, { passive: true, capture: true })

  // ── MutationObserver + initial scan ─────────────────────────────────────

  function scanVideos() {
    if (isYouTubeWatchPage()) {
      const primary = getYouTubePrimaryVideo()
      if (!primary) return
      for (const video of document.querySelectorAll('video')) {
        if (video !== primary) videoState.get(video)?.cleanup()
      }
      tryAttach(primary)
      return
    }
    for (const video of document.querySelectorAll('video')) {
      tryAttach(video)
    }
  }

  let scanScheduled = false
  function scheduleScan(delay = 0) {
    if (scanScheduled) return
    scanScheduled = true
    setTimeout(() => {
      scanScheduled = false
      scanVideos()
    }, delay)
  }

  let lastHref = location.href
  function handleNavigation() {
    if (location.href === lastHref) return
    lastHref = location.href
    closeActivePanel()
    updateSuppression()
    scheduleScan(800)
    setTimeout(() => scheduleScan(2000), 2000)
  }

  const originalPushState = history.pushState
  const originalReplaceState = history.replaceState
  history.pushState = function (...args) {
    const result = originalPushState.apply(this, args)
    handleNavigation()
    return result
  }
  history.replaceState = function (...args) {
    const result = originalReplaceState.apply(this, args)
    handleNavigation()
    return result
  }
  window.addEventListener('popstate', handleNavigation)

  const mutationObserver = new MutationObserver((mutations) => {
    handleNavigation()
    let needsScan = false
    for (const mutation of mutations) {
      for (const node of mutation.removedNodes) {
        if (node.nodeType !== 1) continue
        const removed = node.tagName === 'VIDEO' ? [node] : (node.querySelectorAll ? Array.from(node.querySelectorAll('video')) : [])
        for (const video of removed) videoState.get(video)?.cleanup()
      }
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue
        if (node.tagName === 'VIDEO') {
          tryAttach(node)
        } else if (node.querySelector) {
          for (const v of node.querySelectorAll('video')) tryAttach(v)
        }
        needsScan = true
      }
    }
    // Batch bursts from SPA renders instead of scanning the entire document
    // once per mutation callback.
    if (needsScan) scheduleScan(120)
  })

  function init() {
    if (PL && typeof PL.shouldBootGenericOverlay === 'function') {
      if (!PL.shouldBootGenericOverlay()) return
    } else if (isDouyinPage() || isTikTokPage() || isXPage()) {
      return
    }
    updateSuppression()
    scanVideos()

    mutationObserver.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    })

    document.addEventListener('fullscreenchange', () => {
      if (isYouTubeWatchPage()) scanVideos()
      reparentOverlayButtons()
    })

    // Low-frequency fallback for lazy players that render without a useful
    // mutation record. Newly inserted nodes are handled by the observer.
    const scanInterval = setInterval(() => {
      if (document.hidden) return
      scheduleScan()
    }, 8000)

    window.addEventListener('beforeunload', () => {
      clearInterval(scanInterval)
      mutationObserver.disconnect()
      window.removeEventListener('popstate', handleNavigation)
      if (history.pushState !== originalPushState) history.pushState = originalPushState
      if (history.replaceState !== originalReplaceState) history.replaceState = originalReplaceState
    })
  }

  if (document.body) {
    init()
  } else {
    document.addEventListener('DOMContentLoaded', init)
  }
})()
