;(function () {
  'use strict'

  // NOTE: content-douyin-bridge.js runs in MAIN world via manifest "world": "MAIN"
  // This script runs in ISOLATED world and receives data via postMessage.

  // ── Constants ─────────────────────────────────────────────────────────────

  const PL = globalThis.VDownloadOverlayPlacement || null

  const BTN_ID = 'dy-dl-btn'
  const PANEL_ID = 'dy-dl-panel'
  const DOUYIN_RESOLVE_START_TYPE = 'V_DOWNLOAD_START_DOUYIN_RESOLVE'
  const DOUYIN_RESOLVE_RESULT_TYPE = 'DOUYIN_RESOLVE_RESULT'
  const BTN_SIZE = PL ? PL.DEFAULT_BTN_SIZE : 32
  const BTN_INSET = PL ? PL.DEFAULT_INSET : 10

  const SVG_DOWNLOAD = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`
  const SVG_VIDEO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>`
  const SVG_MUSIC = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`
  const SVG_IMAGE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`

  // ── State ──────────────────────────────────────────────────────────────────

  let currentData = null   // Latest DOUYIN_VIDEO_DATA payload
  let activePanel = null   // DOM node of the open panel, or null
  let lastHref = location.href
  let lastLoggedAwemeId = null

  // Page DevTools (douyin tab): filter "[V-Download douyin CS]"
  // Extension worker: chrome://extensions → V-Download → service worker → Inspect — "[V-Download ext]"
  function logCs(stage, extra) {
    const line = Object.assign({ stage, t: new Date().toISOString() }, extra || {})
    console.info('[V-Download douyin CS]', line)
  }

  function truncateUrlCs(u, max) {
    const m = max || 56
    if (!u || typeof u !== 'string') return ''
    return u.length <= m ? u : `${u.slice(0, m)}…`
  }

  /** Safe filename-ish segments; avoids every download sharing the tab title. */
  function sanitizeFsSegment(s) {
    return String(s || '')
      .replace(/[/\\?*:|"<>]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 96)
  }

  /**
   * Author + short desc + aweme id (+ optional row suffix). Falls back to timestamp if needed.
   */
  function buildDownloadBasename(rowSuffix) {
    const d = currentData
    if (!d) {
      return `douyin-${Date.now()}`
    }
    const author = sanitizeFsSegment(d.author)
    const desc = sanitizeFsSegment(d.desc).slice(0, 56)
    const id = String(d.awemeId || '').trim()
    const parts = []
    if (author) parts.push(author)
    if (desc) parts.push(desc)
    if (id) parts.push(id)
    let base = parts.filter(Boolean).join(' — ')
    if (!base) base = id ? `douyin-${id}` : `douyin-${Date.now()}`
    if (rowSuffix) {
      const suf = sanitizeFsSegment(rowSuffix)
      if (suf) base = `${base} — ${suf}`
    }
    return base.slice(0, 200)
  }

  // ── Utility ────────────────────────────────────────────────────────────────

  function formatSize(bytes) {
    if (!bytes) return ''
    const mb = bytes / 1024 / 1024
    return mb >= 100 ? Math.round(mb) + ' MB' : mb.toFixed(1) + ' MB'
  }

  function hasDouyinPlayer() {
    if (PL) return !!PL.getDouyinPlayerRect(PL.getSiteContext())
    return !!document.querySelector('[data-e2e="feed-active-video"]')
  }

  function getPlayerRect() {
    if (PL) return PL.getDouyinPlayerRect(PL.getSiteContext())
    const anchor = document.querySelector('[data-e2e="feed-active-video"]')
    if (!anchor) return null
    const player = anchor.querySelector('.xgplayer') || anchor.querySelector('video')
    const el = player || anchor
    const r = el.getBoundingClientRect()
    if (r.width < 10 || r.height < 10) return null
    return r
  }

  function getPlacementStrategy() {
    if (PL) return PL.getPlacementStrategy(PL.getSiteContext())
    return 'topRight'
  }

  // ── Download button ────────────────────────────────────────────────────────

  function ensureButton() {
    let btn = document.getElementById(BTN_ID)
    if (btn) return btn

    btn = document.createElement('button')
    btn.id = BTN_ID
    btn.className = 'dy-dl-btn dy-dl-hidden'
    btn.setAttribute('aria-label', 'Download video')
    btn.innerHTML = SVG_DOWNLOAD

    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      e.preventDefault()
      logCs('float-btn-click', { willClose: !!activePanel })
      if (activePanel) {
        closePanel()
      } else {
        showPanel(btn)
      }
    })

    document.documentElement.appendChild(btn)
    return btn
  }

  function positionButton(btn) {
    const rect = getPlayerRect()
    if (!rect) {
      btn.classList.remove('dy-dl-visible')
      btn.classList.add('dy-dl-hidden')
      return
    }
    const strategy = getPlacementStrategy()
    const pos = PL
      ? PL.computeButtonPosition(rect, strategy, BTN_SIZE, BTN_INSET)
      : { top: rect.top + BTN_INSET, left: rect.right - BTN_INSET - BTN_SIZE }
    if (!pos) return
    btn.style.top = pos.top + 'px'
    btn.style.left = pos.left + 'px'
    btn.classList.add('dy-dl-visible')
    btn.classList.remove('dy-dl-hidden')
  }

  // ── Panel ──────────────────────────────────────────────────────────────────

  function buildRow(iconSvg, label, sizeStr, typeClass, typeBadge, onClick) {
    const row = document.createElement('div')
    row.className = 'dy-dl-format-item'
    row.setAttribute('role', 'button')
    row.setAttribute('tabindex', '0')

    const icon = document.createElement('span')
    icon.className = 'dy-dl-format-icon'
    icon.innerHTML = iconSvg
    row.appendChild(icon)

    const info = document.createElement('div')
    info.className = 'dy-dl-format-info'

    const labelEl = document.createElement('div')
    labelEl.className = 'dy-dl-format-label'
    labelEl.textContent = label
    info.appendChild(labelEl)

    const metaEl = document.createElement('div')
    metaEl.className = 'dy-dl-format-meta'

    if (typeBadge) {
      const badge = document.createElement('span')
      badge.className = `dy-dl-format-type dy-dl-type-${typeClass}`
      badge.textContent = typeBadge
      metaEl.appendChild(badge)
    }

    if (sizeStr) {
      const sizeEl = document.createElement('span')
      sizeEl.className = 'dy-dl-format-size'
      sizeEl.textContent = sizeStr
      metaEl.appendChild(sizeEl)
    }

    info.appendChild(metaEl)
    row.appendChild(info)

    const dlBtn = document.createElement('button')
    dlBtn.type = 'button'
    dlBtn.className = 'dy-dl-format-dl-btn'
    dlBtn.innerHTML = SVG_DOWNLOAD
    dlBtn.setAttribute('aria-label', `Download ${label}`)
    row.appendChild(dlBtn)

    // A Douyin feed can stop events while they bubble through its player tree.
    // Keep one activation path for the row and its child button, and lock it
    // briefly so pointerup + click (or row + button capture) cannot enqueue twice.
    const handledEvents = new WeakSet()
    let activationLocked = false
    const handle = (e) => {
      if (e && typeof e === 'object') {
        if (handledEvents.has(e)) return
        handledEvents.add(e)
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation?.()
      }
      if (activationLocked || row.dataset.downloadState === 'sending' || row.dataset.downloadState === 'queued') return
      activationLocked = true
      setTimeout(() => { activationLocked = false }, 500)
      logCs('format-row-click', { label: row.querySelector('.dy-dl-format-label')?.textContent || '?' })
      onClick(row)
    }

    // Capture phase handles normal clicks. pointerup is the fallback for pages
    // that interfere with click synthesis; the short lock deduplicates both.
    row.addEventListener('pointerup', handle, true)
    row.addEventListener('click', handle, true)
    dlBtn.addEventListener('pointerup', handle, true)
    dlBtn.addEventListener('click', handle, true)
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        handle(e)
      }
    })

    // Used by the window-level delegated capture listener below. This catches
    // cases where a site-level document listener stops propagation before the
    // event reaches the generated row.
    row._dyActivate = handle

    row._dySetState = (state, message) => {
      row.dataset.downloadState = state || ''
      dlBtn.disabled = state === 'sending'
      row.setAttribute('aria-busy', state === 'sending' ? 'true' : 'false')
      dlBtn.setAttribute('aria-label', message || `Download ${label}`)
      dlBtn.title = message || `Download ${label}`
      labelEl.textContent = message || label
    }

    return row
  }

  function getPanelRowFromEvent(e) {
    const path = typeof e?.composedPath === 'function' ? e.composedPath() : []
    for (const node of path) {
      if (!node || node.nodeType !== 1) continue
      if (node.classList?.contains('dy-dl-format-item')) return node
    }
    return null
  }

  function handlePanelEvent(e) {
    if (!activePanel || (e.type !== 'pointerup' && e.type !== 'click')) return
    const row = getPanelRowFromEvent(e)
    if (!row || !activePanel.contains(row) || typeof row._dyActivate !== 'function') return
    row._dyActivate(e)
  }

  // Register before the panel is created so page-level handlers cannot swallow
  // the generated controls before their own listeners see the event.
  window.addEventListener('pointerup', handlePanelEvent, true)
  window.addEventListener('click', handlePanelEvent, true)

  function buildDouyinPageUrl() {
    const awemeId = String(currentData?.awemeId || '').trim()
    return /^\d{6,32}$/.test(awemeId) ? `https://www.douyin.com/video/${awemeId}` : ''
  }

  function triggerDownload(url, type, rowSuffix, row, preferredQuality) {
    if (!url || !String(url).trim()) {
      logCs('trigger-download-skip', { reason: 'empty-url', type })
      return
    }
    const downloadTitle = buildDownloadBasename(rowSuffix)
    logCs('trigger-download-start', {
      type,
      url: truncateUrlCs(String(url), 64),
      awemeId: currentData?.awemeId || null,
      downloadTitle: downloadTitle.slice(0, 80)
    })
    flashButton('dy-dl-sending')
    row?._dySetState?.('sending', 'Sending…')
    const wakeFromGesture = globalThis.__vdownloadWakeFromUserGesture
    const surfacedWake = typeof wakeFromGesture === 'function' ? wakeFromGesture() === true : false
    const pageUrl = type === 'mp4' ? buildDouyinPageUrl() : ''
    const quality = Number(preferredQuality) > 0 ? String(Math.round(Number(preferredQuality))) : ''
    const item = {
      url,
      type,
      initiator: 'https://www.douyin.com/',
      title: downloadTitle,
      ...(pageUrl ? { pageUrl, ...(quality ? { quality } : {}), autoStart: true } : {})
    }
    const done = (ok, error) => {
      logCs('trigger-download-finished', { ok, error, awemeId: currentData?.awemeId || null })
      if (ok) {
        row?._dySetState?.('queued', 'Added to queue')
        closePanel()
        flashButton('dy-dl-sent')
      } else {
        row?._dySetState?.('error', `Error — ${error || 'retry'}`)
        flashButton(null)
      }
    }
    try {
      // The background listener intentionally uses sendResponse + return true.
      // Use the callback form here because Chrome's Promise wrapper can resolve
      // before a delayed MV3 response on some versions, making a real failure
      // look like a silent no-op.
      chrome.runtime.sendMessage({ type: 'DOWNLOAD_MEDIA_FROM_CONTENT', item, surfacedWake }, (resp) => {
        if (chrome.runtime.lastError) {
          const error = chrome.runtime.lastError.message || 'retry'
          logCs('trigger-download-last-error', { message: error })
          done(false, error)
          return
        }
        const error = resp?.error || ''
        logCs('trigger-download-callback-reply', { ok: !!(resp && resp.ok), error })
        done(!!(resp && resp.ok), error)
      })
    } catch (err) {
      logCs('trigger-download-send-throw', { err: String(err) })
      done(false, 'Unable to contact extension')
    }
  }

  function flashButton(stateClass) {
    const btn = document.getElementById(BTN_ID)
    if (!btn) return
    btn.classList.remove('dy-dl-sending', 'dy-dl-sent')
    if (stateClass) {
      btn.classList.add(stateClass)
      setTimeout(() => {
        if (btn) btn.classList.remove(stateClass)
      }, 1800)
    }
  }

  function showPanel(btn) {
    logCs('show-panel', { hasData: !!currentData, awemeId: currentData?.awemeId || null })
    if (!currentData) {
      // Bridge hasn't sent data yet — show a "loading" panel
      const panel = document.createElement('div')
      panel.id = PANEL_ID
      panel.className = 'dy-dl-panel'
      const msg = document.createElement('div')
      msg.className = 'dy-dl-panel-empty'
      msg.textContent = 'Reading video data…'
      panel.appendChild(msg)
      document.documentElement.appendChild(panel)
      activePanel = panel
      requestAnimationFrame(() => positionPanelRelativeTo(panel, btn))
      return
    }

    const panel = document.createElement('div')
    panel.id = PANEL_ID
    panel.className = 'dy-dl-panel'

    // Header
    const header = document.createElement('div')
    header.className = 'dy-dl-panel-header'

    const titleEl = document.createElement('span')
    titleEl.textContent = 'Download'
    header.appendChild(titleEl)

    if (currentData.author) {
      const authorEl = document.createElement('span')
      authorEl.className = 'dy-dl-panel-author'
      authorEl.textContent = currentData.author
      header.appendChild(authorEl)
    }
    panel.appendChild(header)

    let hasOptions = false

    // Video format rows
    const formats = currentData.formats || []
    if (formats.length > 0) {
      // Separator label
      const videoSep = document.createElement('div')
      videoSep.className = 'dy-dl-section-label'
      videoSep.textContent = 'Video'
      panel.appendChild(videoSep)

      for (const fmt of formats) {
        const typeClass = fmt.isH265 ? 'h265' : 'mp4'
        const codecBadge = fmt.isH265 ? 'H.265' : 'H.264'
        const row = buildRow(
          SVG_VIDEO,
          fmt.label,
          formatSize(fmt.size),
          typeClass,
          codecBadge,
          (row) => triggerDownload(fmt.url, 'mp4', `${fmt.label} ${codecBadge}`, row, fmt.height)
        )
        panel.appendChild(row)
        hasOptions = true
      }
    }

    // Cover image row
    if (currentData.cover && currentData.cover.url) {
      const imageSep = document.createElement('div')
      imageSep.className = 'dy-dl-section-label'
      imageSep.textContent = 'Image'
      panel.appendChild(imageSep)

      const row = buildRow(
        SVG_IMAGE,
        'Cover Image',
        '',
        'image',
        'JPEG',
        (row) => triggerDownload(currentData.cover.url, 'jpeg', 'cover', row)
      )
      panel.appendChild(row)
      hasOptions = true
    }

    // Music row
    if (currentData.music && currentData.music.url) {
      const musicSep = document.createElement('div')
      musicSep.className = 'dy-dl-section-label'
      musicSep.textContent = 'Audio'
      panel.appendChild(musicSep)

      const musicTitle = currentData.music.title || 'Music'
      const row = buildRow(
        SVG_MUSIC,
        musicTitle.length > 40 ? musicTitle.substring(0, 38) + '…' : musicTitle,
        '',
        'audio',
        'MP3',
        (row) => triggerDownload(currentData.music.url, 'mp3', 'audio', row)
      )
      panel.appendChild(row)
      hasOptions = true
    }

    if (!hasOptions) {
      const empty = document.createElement('div')
      empty.className = 'dy-dl-panel-empty'
      empty.textContent = 'No downloads available'
      panel.appendChild(empty)
    }

    document.documentElement.appendChild(panel)
    activePanel = panel

    // Position after measuring
    requestAnimationFrame(() => positionPanelRelativeTo(panel, btn))
  }

  function positionPanelRelativeTo(panel, btn) {
    const playerRect = getPlayerRect()
    if (!playerRect) return

    const panelW = panel.offsetWidth || 260
    const panelH = panel.offsetHeight || 200
    const btnRect = btn
      ? btn.getBoundingClientRect()
      : (PL ? PL.getDouyinPanelAnchorRect(playerRect, BTN_SIZE, BTN_INSET) : playerRect)

    if (PL) {
      const pos = PL.computePanelPosition(playerRect, btnRect, panelW, panelH)
      PL.applyPanelStyles(panel, pos)
      return
    }

    const vw = window.innerWidth
    const vh = window.innerHeight
    let top = playerRect.top + BTN_INSET + BTN_SIZE + 6
    let left = playerRect.right - panelW - BTN_INSET
    if (left < 8) left = 8
    if (left + panelW > vw - 8) left = vw - panelW - 8
    if (top + panelH > vh - 8) top = vh - panelH - 8
    if (top < 8) top = 8
    panel.style.top = top + 'px'
    panel.style.left = left + 'px'
  }

  function repositionPanel() {
    const panel = document.getElementById(PANEL_ID)
    const btn = document.getElementById(BTN_ID)
    if (!panel) return
    positionPanelRelativeTo(panel, btn)
  }

  function closePanel() {
    const panel = document.getElementById(PANEL_ID)
    if (panel) panel.remove()
    activePanel = null
  }

  // ── Message listener (receive from bridge) ─────────────────────────────────

  const BRIDGE_MEDIA_TYPES = new Set(['mp4', 'mp3', 'jpeg'])
  function isBridgeUrl(value) {
    if (typeof value !== 'string' || value.length < 1 || value.length > 8192) return false
    try {
      const u = new URL(value)
      return u.protocol === 'http:' || u.protocol === 'https:'
    } catch {
      return false
    }
  }

  function normalizeBridgeData(raw) {
    if (!raw || typeof raw !== 'object') return null
    const awemeId = String(raw.awemeId || '').trim()
    if (!awemeId || awemeId.length > 128) return null
    const formats = Array.isArray(raw.formats)
      ? raw.formats.slice(0, 8).map((format) => {
        if (!format || typeof format !== 'object' || !isBridgeUrl(format.url)) return null
        const type = String(format.type || 'mp4').toLowerCase()
        if (!BRIDGE_MEDIA_TYPES.has(type)) return null
        return {
          label: String(format.label || type).slice(0, 64),
          width: Number.isFinite(Number(format.width)) ? Number(format.width) : 0,
          height: Number.isFinite(Number(format.height)) ? Number(format.height) : 0,
          url: format.url,
          size: Number.isFinite(Number(format.size)) && Number(format.size) > 0 ? Number(format.size) : 0,
          isH265: format.isH265 === true,
        }
      }).filter(Boolean)
      : []
    const cover = raw.cover && isBridgeUrl(raw.cover.url) ? { url: raw.cover.url, type: 'jpeg' } : null
    const music = raw.music && isBridgeUrl(raw.music.url)
      ? { url: raw.music.url, title: String(raw.music.title || '').slice(0, 128), type: 'mp3' }
      : null
    return {
      awemeId,
      desc: String(raw.desc || '').slice(0, 200),
      author: String(raw.author || '').slice(0, 80),
      formats,
      cover,
      music,
    }
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.origin !== location.origin) return
    if (e.data?.type === DOUYIN_RESOLVE_RESULT_TYPE && e.data.source === 'douyin-resolve-bridge') {
      chrome.runtime.sendMessage({
        type: 'DOUYIN_RESOLVE_RESULT',
        requestId: e.data.requestId,
        ok: e.data.ok === true,
        awemeId: e.data.awemeId,
        mediaType: e.data.mediaType,
        title: e.data.title,
        author: e.data.author,
        cover: e.data.cover,
        imageUrls: Array.isArray(e.data.imageUrls) ? e.data.imageUrls.slice(0, 200) : [],
        videoUrl: e.data.videoUrl,
        videoUrlFallbacks: Array.isArray(e.data.videoUrlFallbacks) ? e.data.videoUrlFallbacks.slice(0, 8) : [],
        duration: e.data.duration,
        error: typeof e.data.error === 'string' ? e.data.error.slice(0, 512) : ''
      }, () => void chrome.runtime.lastError)
      return
    }
    if (e.data?.type === 'DOUYIN_PROFILE_IMPORT_RESULT' && e.data.source === 'douyin-profile-bridge') {
      chrome.runtime.sendMessage({
        type: 'DOUYIN_PROFILE_IMPORT_RESULT',
        requestId: e.data.requestId,
        ok: e.data.ok === true,
        items: Array.isArray(e.data.items) ? e.data.items.slice(0, 2000) : [],
        warnings: Array.isArray(e.data.warnings) ? e.data.warnings.slice(0, 4) : [],
        error: typeof e.data.error === 'string' ? e.data.error.slice(0, 512) : ''
      }, () => void chrome.runtime.lastError)
      return
    }
    if (!e.data || e.data.type !== 'DOUYIN_VIDEO_DATA' || e.data.source !== 'douyin-bridge') return
    const data = normalizeBridgeData(e.data.data)
    if (!data) return

    // New video — close stale panel
    if (currentData && currentData.awemeId !== data.awemeId && activePanel) {
      closePanel()
    }

    currentData = data

    if (lastLoggedAwemeId !== data.awemeId) {
      lastLoggedAwemeId = data.awemeId
      logCs('bridge-video', {
        awemeId: data.awemeId,
        nFormats: (data.formats || []).length,
        hasCover: !!(data.cover && data.cover.url),
        hasMusic: !!(data.music && data.music.url)
      })
    }

    const btn = ensureButton()
    positionButton(btn)
    if (activePanel) repositionPanel()

    // User may have opened the panel while waiting for bridge data — replace loading UI.
    if (activePanel) {
      const empty = activePanel.querySelector('.dy-dl-panel-empty')
      if (empty && empty.textContent === 'Reading video data…') {
        closePanel()
        const b = document.getElementById(BTN_ID)
        if (b) showPanel(b)
      }
    }
  })

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'START_DOUYIN_RESOLVE') return false
    const command = message.command && typeof message.command === 'object' ? message.command : null
    if (!command) {
      sendResponse({ ok: false, error: 'Missing Douyin resolve command' })
      return false
    }
    window.postMessage({
      type: DOUYIN_RESOLVE_START_TYPE,
      source: 'douyin-content',
      command: {
        requestId: String(command.requestId || ''),
        url: String(command.url || ''),
        awemeId: String(command.awemeId || '')
      }
    }, location.origin)
    sendResponse({ ok: true })
    return false
  })

  // The service worker waits for this signal before sending a resolver
  // command. This avoids racing a newly-created, still-loading Douyin tab.
  chrome.runtime.sendMessage({ type: 'DOUYIN_RESOLVE_READY', url: location.href }, () => void chrome.runtime.lastError)

  // ── Periodic anchor check ──────────────────────────────────────────────────
  // Detect when feed-active-video appears (e.g. modal opened on profile page)

  function checkAnchor() {
    if (document.hidden) return
    const btn = document.getElementById(BTN_ID)

    if (hasDouyinPlayer()) {
      const b = btn || ensureButton()
      positionButton(b)
      if (activePanel) repositionPanel()
    } else if (btn) {
      btn.classList.remove('dy-dl-visible')
      btn.classList.add('dy-dl-hidden')
    }
  }

  const anchorInterval = setInterval(checkAnchor, 1500)
  setTimeout(checkAnchor, 300)
  setTimeout(checkAnchor, 1000)

  // ── Panel dismissal (no click-outside — Douyin's player captures many clicks) ──

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && activePanel) closePanel()
  })

  // Close panel on scroll but not button (Douyin scroll is the swiper, not window)
  window.addEventListener('scroll', () => { if (activePanel) closePanel() }, { passive: true })

  // ── SPA navigation ─────────────────────────────────────────────────────────

  const navObserver = new MutationObserver(() => {
    if (location.href === lastHref) return
    lastHref = location.href
    closePanel()
    currentData = null

    setTimeout(() => {
      if (hasDouyinPlayer()) return
      const btn = document.getElementById(BTN_ID)
      if (btn) {
        btn.classList.remove('dy-dl-visible')
        btn.classList.add('dy-dl-hidden')
      }
    }, 300)
  })

  navObserver.observe(document.documentElement, { subtree: false, childList: true })

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkAnchor()
  })

  window.addEventListener('beforeunload', () => clearInterval(anchorInterval))

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'START_DOUYIN_PROFILE_IMPORT') return false
    const command = message.command
    if (!command || typeof command.requestId !== 'string') {
      sendResponse({ ok: false, error: 'Invalid profile import command' })
      return false
    }
    window.postMessage(
      {
        type: 'V_DOWNLOAD_START_DOUYIN_PROFILE_IMPORT',
        source: 'douyin-content',
        command,
      },
      location.origin
    )
    sendResponse({ ok: true })
    return false
  })

  const notifyProfileReady = () => {
    chrome.runtime.sendMessage(
      { type: 'DOUYIN_PROFILE_READY', url: location.href },
      () => void chrome.runtime.lastError
    )
  }
  setTimeout(notifyProfileReady, 250)
  setTimeout(notifyProfileReady, 1200)
})()
