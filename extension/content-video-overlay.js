;(function () {
  'use strict'

  // ── Constants ───────────────────────────────────────────────────────────

  const MIN_VIDEO_WIDTH = 100
  const MIN_VIDEO_HEIGHT = 100
  const BTN_ATTR = 'data-ytdl-overlay'

  // Query params to keep when building dedup key (original URL always used for download)
  const QUERY_WHITELIST = new Set(['token', 'sig', 'signature', 'expires', 'expire', 'key', 'id'])

  const SVG_DOWNLOAD = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`
  const SVG_VIDEO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>`

  // ── State ───────────────────────────────────────────────────────────────

  // Videos already processed
  const processed = new WeakSet()

  // Per-video state: button el, rAF id, IntersectionObserver, cleanup fn
  const videoState = new WeakMap()

  // Currently open panel (only one at a time)
  let activePanel = null
  let activePanelVideo = null

  // ── Site detection ───────────────────────────────────────────────────────

  function isYouTubePage() {
    return /^https?:\/\/(www\.)?youtube\.com/.test(location.href)
  }

  function isDouyinPage() {
    return /^https?:\/\/(www\.)?douyin\.com/.test(location.href)
  }

  function isYouTubeWatchPage() {
    try {
      const u = new URL(location.href)
      return u.pathname === '/watch' && u.searchParams.has('v')
    } catch {
      return false
    }
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

  function inferTypeFromUrl(url) {
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

  function buildOptions(video, sniffed, videoLoadTime) {
    const seen = new Map() // dedup key → original entry
    const options = []

    // 1. From video element sources
    const srcs = []
    if (video.currentSrc && !isBlobOrStream(video.currentSrc)) {
      srcs.push({ url: video.currentSrc, mimeType: '' })
    }
    for (const source of video.querySelectorAll('source')) {
      const src = source.src
      if (src && !isBlobOrStream(src)) {
        srcs.push({ url: src, mimeType: source.type || '' })
      }
    }

    const hasResolution = video.videoWidth > 0 && video.videoHeight > 0
    const resLabel = hasResolution ? `${video.videoHeight}p` : null

    for (const { url, mimeType } of srcs) {
      const type = inferTypeFromUrl(url) || (mimeType.includes('webm') ? 'webm' : 'mp4')
      const key = normalizeUrlForDedup(url) + '|' + type
      if (seen.has(key)) continue
      seen.set(key, true)
      options.push({
        url,
        type,
        label: resLabel ? `${type} (${resLabel})` : type,
        size: null,
        source: 'element'
      })
    }

    // 2. From background sniffed media
    // Filter by recency: only show entries loaded after this video started playing.
    const cutoff = videoLoadTime ? videoLoadTime - 3000 : 0
    const relevant = videoLoadTime
      ? sniffed.filter((e) => e.timestamp >= cutoff)
      : sniffed

    // Smart filtering: detect whether sniffed entries are real downloadable files
    // or MSE/HLS/DASH player segments (small chunks that aren't useful for download).
    //
    // Detection heuristics:
    //  1. If HLS manifest exists → small mp4/flv are its segments, filter them out
    //  2. If video.currentSrc is blob: and we have many small same-type entries →
    //     they're MSE player chunks, not downloadable files
    //  3. For each type group, keep at most 2 entries (largest ones = likely full files or highest quality)

    const hasHls = relevant.some((e) => e.type === 'hls')
    const isBlobSrc = isBlobOrStream(video.currentSrc)
    const SEGMENT_THRESHOLD = 5 * 1024 * 1024 // 5MB: below this + blob src = likely segment

    const byType = new Map()
    for (const entry of relevant) {
      if (!byType.has(entry.type)) byType.set(entry.type, [])
      byType.get(entry.type).push(entry)
    }

    for (const [type, entries] of byType) {
      // Sort by size descending (null/unknown → end)
      entries.sort((a, b) => (b.size || 0) - (a.size || 0))

      let filtered = entries

      if (type === 'hls') {
        // Always show HLS manifests (usually just 1)
        filtered = entries.slice(0, 2)
      } else if (hasHls) {
        // HLS present: non-HLS entries below threshold are segments → drop them
        filtered = entries.filter((e) => !e.size || e.size >= SEGMENT_THRESHOLD)
        filtered = filtered.slice(0, 2)
      } else if (isBlobSrc && entries.length > 2) {
        // blob: src + many entries of same type = MSE player chunks
        // Only keep the single largest (might be a full file) if it's meaningfully large
        const largest = entries[0]
        if (largest && largest.size && largest.size >= SEGMENT_THRESHOLD) {
          filtered = [largest]
        } else {
          // All small → these are segments, not useful for download
          filtered = []
        }
      } else {
        // Normal case: few entries, likely real files
        filtered = entries.slice(0, 3)
      }

      for (const entry of filtered) {
        const key = normalizeUrlForDedup(entry.url) + '|' + entry.type
        if (seen.has(key)) continue
        seen.set(key, true)
        options.push({
          url: entry.url,
          type: entry.type,
          label: entry.type.toUpperCase(),
          size: entry.size,
          initiator: entry.initiator,
          source: 'sniffed'
        })
      }
    }

    return options
  }

  // ── Panel DOM builders ───────────────────────────────────────────────────

  function buildPanelItem(opt, onDownload) {
    const item = document.createElement('div')
    item.className = 'ytdl-format-item'

    const icon = document.createElement('span')
    icon.className = 'ytdl-format-icon'
    icon.innerHTML = opt.type === 'hls' ? SVG_VIDEO : SVG_VIDEO

    const info = document.createElement('div')
    info.className = 'ytdl-format-info'

    const label = document.createElement('div')
    label.className = 'ytdl-format-label'
    label.textContent = opt.label

    const meta = document.createElement('div')
    meta.className = 'ytdl-format-meta'

    const badge = document.createElement('span')
    badge.className = `ytdl-format-type ytdl-type-${opt.type}`
    badge.textContent = opt.type.toUpperCase()
    meta.appendChild(badge)

    if (opt.size) {
      const sz = document.createElement('span')
      sz.className = 'ytdl-format-size'
      sz.textContent = formatSize(opt.size)
      meta.appendChild(sz)
    }

    info.appendChild(label)
    info.appendChild(meta)

    const dlBtn = document.createElement('button')
    dlBtn.className = 'ytdl-format-dl-btn'
    dlBtn.title = 'Download'
    dlBtn.innerHTML = SVG_DOWNLOAD
    dlBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      onDownload(opt)
    })

    item.addEventListener('click', () => onDownload(opt))

    item.appendChild(icon)
    item.appendChild(info)
    item.appendChild(dlBtn)
    return item
  }

  function showPanel(video, btn, sniffed, isYouTube, blobDetected, sourceLabel, videoLoadTime) {
    closeActivePanel()

    const panel = document.createElement('div')
    panel.className = 'ytdl-format-panel'

    // Header
    const header = document.createElement('div')
    header.className = 'ytdl-panel-header'
    const headerTitle = document.createElement('span')
    headerTitle.textContent = 'Download'
    header.appendChild(headerTitle)
    if (sourceLabel && sourceLabel !== 'frame') {
      const badge = document.createElement('span')
      badge.className = 'ytdl-panel-source-badge'
      badge.textContent = sourceLabel === 'tab-fallback' ? 'tab' : sourceLabel
      header.appendChild(badge)
    }
    panel.appendChild(header)

    // Content area
    if (isYouTube) {
      // YouTube watch: single option delegated to Electron/yt-dlp
      const item = document.createElement('div')
      item.className = 'ytdl-format-item'
      const icon = document.createElement('span')
      icon.className = 'ytdl-format-icon'
      icon.innerHTML = SVG_VIDEO
      const info = document.createElement('div')
      info.className = 'ytdl-format-info'
      const lbl = document.createElement('div')
      lbl.className = 'ytdl-format-label'
      lbl.textContent = 'Download Video'
      const meta2 = document.createElement('div')
      meta2.className = 'ytdl-format-meta'
      const badge2 = document.createElement('span')
      badge2.className = 'ytdl-format-type ytdl-type-yt'
      badge2.textContent = 'YouTube'
      meta2.appendChild(badge2)
      info.appendChild(lbl)
      info.appendChild(meta2)
      const dlBtn = document.createElement('button')
      dlBtn.className = 'ytdl-format-dl-btn'
      dlBtn.innerHTML = SVG_DOWNLOAD
      const doYTDownload = () => {
        closeActivePanel()
        flashButton(btn, 'ytdl-sending')
        chrome.runtime.sendMessage({ type: 'DOWNLOAD_VIDEO', url: location.href }, (resp) => {
          flashButton(btn, resp && !resp.error ? 'ytdl-sent' : null)
        })
      }
      dlBtn.addEventListener('click', (e) => { e.stopPropagation(); doYTDownload() })
      item.addEventListener('click', doYTDownload)
      item.appendChild(icon)
      item.appendChild(info)
      item.appendChild(dlBtn)
      panel.appendChild(item)
    } else {
      const options = buildOptions(video, sniffed, videoLoadTime)

      if (options.length === 0) {
        const empty = document.createElement('div')
        empty.className = 'ytdl-panel-empty'
        empty.textContent = 'No downloads available'
        panel.appendChild(empty)
      } else {
        for (const opt of options) {
          panel.appendChild(buildPanelItem(opt, (clickedOpt) => {
            closeActivePanel()
            flashButton(btn, 'ytdl-sending')
            const item = {
              url: clickedOpt.url,
              type: clickedOpt.type,
              initiator: clickedOpt.initiator || ''
            }
            chrome.runtime.sendMessage({ type: 'DOWNLOAD_MEDIA_FROM_CONTENT', item }, (resp) => {
              if (chrome.runtime.lastError) {
                flashButton(btn, null)
                return
              }
              flashButton(btn, resp && resp.ok ? 'ytdl-sent' : null)
            })
          }))
        }
      }

      if (blobDetected) {
        const note = document.createElement('div')
        note.className = 'ytdl-panel-note'
        note.textContent = options.length > 0
          ? 'Page stream — downloading via sniffed address'
          : 'This video uses encrypted streaming. Try the toolbar popup for available media.'
        panel.appendChild(note)
      }
    }

    positionPanel(panel, btn)
    document.documentElement.appendChild(panel)
    activePanel = panel
    activePanelVideo = video
  }

  // Initial panel placement: measures panel dimensions, then removes (caller must re-append).
  function positionPanel(panel, btn) {
    const btnRect = btn.getBoundingClientRect()

    // Temporarily place off-screen to measure
    panel.style.visibility = 'hidden'
    panel.style.top = '-9999px'
    panel.style.left = '-9999px'
    document.documentElement.appendChild(panel)
    const pw = panel.offsetWidth || 240
    const ph = panel.offsetHeight || 120
    panel.remove()

    applyPanelPosition(panel, btnRect, pw, ph)
    panel.style.visibility = ''
  }

  // Lightweight reposition for rAF loop: panel is already in DOM, no removal.
  function reposPanel(panel, btn) {
    const btnRect = btn.getBoundingClientRect()
    const pw = panel.offsetWidth || 240
    const ph = panel.offsetHeight || 120
    applyPanelPosition(panel, btnRect, pw, ph)
  }

  function applyPanelPosition(panel, btnRect, pw, ph) {
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

  function closeActivePanel() {
    if (activePanel) {
      activePanel.remove()
      activePanel = null
      activePanelVideo = null
    }
  }

  // ── Flash feedback on overlay button ────────────────────────────────────

  function flashButton(btn, cls) {
    btn.classList.remove('ytdl-sending', 'ytdl-sent')
    if (cls) {
      btn.classList.add(cls)
      setTimeout(() => btn.classList.remove(cls), 1200)
    }
  }

  // ── Overlay button per video ─────────────────────────────────────────────

  function createOverlayForVideo(video) {
    if (processed.has(video)) return
    processed.add(video)

    const BTN_SIZE = 32
    const BTN_INSET = 10 // pixels from video edge

    const btn = document.createElement('button')
    btn.className = 'ytdl-overlay-btn ytdl-hidden'
    btn.title = 'Download with V-Download'
    btn.innerHTML = SVG_DOWNLOAD
    btn.setAttribute(BTN_ATTR, '1')
    document.documentElement.appendChild(btn)

    let rafId = null
    let isInViewport = false
    let prevRect = null

    // Track when this video last loaded a new source.
    // Used to filter sniffed media to only the current video on scroll-heavy sites.
    let videoLoadTime = Date.now()
    const onSourceChange = () => { videoLoadTime = Date.now() }
    video.addEventListener('loadstart', onSourceChange)
    video.addEventListener('loadeddata', onSourceChange)

    function syncPosition() {
      const rect = video.getBoundingClientRect()

      // Auto-dismiss panel if video moved significantly or became invisible
      if (activePanel && activePanelVideo === video) {
        const gone = rect.width < 10 || rect.height < 10 ||
          rect.bottom < 0 || rect.top > window.innerHeight
        const moved = prevRect && (
          Math.abs(rect.top - prevRect.top) > 30 ||
          Math.abs(rect.width - prevRect.width) > 50
        )
        if (gone || moved) {
          closeActivePanel()
        } else {
          reposPanel(activePanel, btn)
        }
      }
      prevRect = { top: rect.top, width: rect.width }

      if (rect.width < 10 || rect.height < 10) return

      // Position inside the video, top-right corner with inset
      btn.style.top = `${rect.top + BTN_INSET}px`
      btn.style.left = `${rect.right - BTN_SIZE - BTN_INSET}px`
    }

    function startRaf() {
      if (rafId) return
      const loop = () => {
        syncPosition()
        const panelOpen = activePanel && activePanelVideo === video
        if (isInViewport || panelOpen) {
          rafId = requestAnimationFrame(loop)
        } else {
          rafId = null
        }
      }
      rafId = requestAnimationFrame(loop)
    }

    function stopRaf() {
      if (rafId) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
    }

    // IntersectionObserver: show/hide button as video enters/leaves viewport
    // Button is ALWAYS visible (low opacity) when video is in viewport.
    // Many players have overlay layers that block mouseenter on <video>,
    // so we don't rely on hover-to-show. The button itself (position:fixed)
    // is always clickable above any player overlays.
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        isInViewport = entry.isIntersecting
        if (isInViewport) {
          btn.classList.remove('ytdl-hidden')
          btn.classList.add('ytdl-visible')
          syncPosition()
          startRaf()
        } else {
          btn.classList.remove('ytdl-visible')
          btn.classList.add('ytdl-hidden')
          if (activePanel && activePanelVideo === video) closeActivePanel()
          stopRaf()
        }
      }
    }, { threshold: 0.1 })

    observer.observe(video)

    // Click: open format panel
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()

      // Toggle: clicking again closes
      if (activePanel && activePanelVideo === video) {
        closeActivePanel()
        return
      }

      // Show loading state briefly
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
          sniffed = resp.media || []
          sourceLabel = resp.source || ''
          isYouTube = resp.isYouTube && isYouTubeWatchPage()
        } catch (err) {
          errorMsg = 'Unable to fetch media info'
          console.warn('[ytdl overlay] GET_FRAME_MEDIA failed:', err)
        }
      }

      if (errorMsg) {
        const panel = document.createElement('div')
        panel.className = 'ytdl-format-panel'
        const errDiv = document.createElement('div')
        errDiv.className = 'ytdl-panel-error'
        errDiv.textContent = errorMsg
        panel.appendChild(errDiv)
        positionPanel(panel, btn)
        document.documentElement.appendChild(panel)
        activePanel = panel
        activePanelVideo = video
        return
      }

      // Detect blob/mediastream currentSrc
      const blobDetected = isBlobOrStream(video.currentSrc)

      showPanel(video, btn, sniffed, isYouTube, blobDetected, sourceLabel, videoLoadTime)
    })

    // Cleanup
    const cleanup = () => {
      observer.disconnect()
      stopRaf()
      btn.remove()
      video.removeEventListener('loadstart', onSourceChange)
      video.removeEventListener('loadeddata', onSourceChange)
      if (activePanel && activePanelVideo === video) closeActivePanel()
    }

    videoState.set(video, { btn, cleanup, observer })
  }

  // ── Video eligibility check ──────────────────────────────────────────────

  function isEligibleVideo(video) {
    if (processed.has(video)) return false
    // Douyin has its own dedicated overlay; skip to avoid duplicates
    if (isDouyinPage()) return false
    // On YouTube, only inject on the main watch page and only on actual player videos
    if (isYouTubePage() && !isYouTubeWatchPage()) return false

    // Size check via getBoundingClientRect (rendered size)
    const rect = video.getBoundingClientRect()
    if (rect.width >= MIN_VIDEO_WIDTH && rect.height >= MIN_VIDEO_HEIGHT) return true

    // Fallback to intrinsic dimensions (before first paint)
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
    if (activePanel) closeActivePanel()
  }, { passive: true })

  // ── MutationObserver + initial scan ─────────────────────────────────────

  function scanVideos() {
    for (const video of document.querySelectorAll('video')) {
      tryAttach(video)
    }
  }

  const mutationObserver = new MutationObserver((mutations) => {
    let needsScan = false
    for (const mutation of mutations) {
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
    // Also re-check existing videos in case they gained size after initial scan
    if (needsScan) {
      for (const video of document.querySelectorAll('video')) {
        if (!processed.has(video)) tryAttach(video)
      }
    }
  })

  // SPA navigation: watch for URL changes and re-scan
  let lastHref = location.href
  const navObserver = new MutationObserver(() => {
    if (location.href !== lastHref) {
      lastHref = location.href
      // Clean up panels from previous page
      closeActivePanel()
      // Re-scan after short delay for new content to render
      setTimeout(scanVideos, 800)
      setTimeout(scanVideos, 2000)
    }
  })

  function init() {
    scanVideos()

    mutationObserver.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    })

    navObserver.observe(document, { subtree: true, childList: true })

    // Periodic scan to catch late-rendered videos (e.g. lazy players)
    const scanInterval = setInterval(() => {
      for (const video of document.querySelectorAll('video')) {
        if (!processed.has(video)) tryAttach(video)
      }
    }, 3000)

    window.addEventListener('beforeunload', () => {
      clearInterval(scanInterval)
      mutationObserver.disconnect()
      navObserver.disconnect()
    })
  }

  if (document.body) {
    init()
  } else {
    document.addEventListener('DOMContentLoaded', init)
  }
})()
