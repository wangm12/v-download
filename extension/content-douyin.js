;(function () {
  'use strict'

  // NOTE: content-douyin-bridge.js runs in MAIN world via manifest "world": "MAIN"
  // This script runs in ISOLATED world and receives data via postMessage.

  // ── Constants ─────────────────────────────────────────────────────────────

  const PL = globalThis.VDownloadOverlayPlacement || null

  const BTN_ID = 'dy-dl-btn'
  const PANEL_ID = 'dy-dl-panel'
  const BTN_SIZE = PL ? PL.DEFAULT_BTN_SIZE : 32
  const BTN_INSET = PL ? PL.DEFAULT_INSET : 10

  const SVG_DOWNLOAD = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`
  const SVG_VIDEO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>`
  const SVG_MUSIC = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`
  const SVG_IMAGE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`

  // ── State ──────────────────────────────────────────────────────────────────

  let currentData = null   // Latest DOUYIN_VIDEO_DATA payload
  let activePanel = null   // DOM node of the open panel, or null
  let rafId = null         // rAF loop handle
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

  // ── rAF loop ───────────────────────────────────────────────────────────────

  function startRaf() {
    if (rafId) return
    const tick = () => {
      const btn = document.getElementById(BTN_ID)
      if (btn) {
        positionButton(btn)
        if (activePanel) repositionPanel()
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
  }

  function stopRaf() {
    if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
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
    dlBtn.className = 'dy-dl-format-dl-btn'
    dlBtn.innerHTML = SVG_DOWNLOAD
    dlBtn.setAttribute('aria-label', `Download ${label}`)
    row.appendChild(dlBtn)

    const handle = (e) => {
      e.preventDefault()
      e.stopPropagation()
      logCs('format-row-click', { label: row.querySelector('.dy-dl-format-label')?.textContent || '?' })
      onClick()
    }
    // Capture phase: Douyin often stops propagation in bubble phase on the player tree.
    row.addEventListener('click', handle, true)
    dlBtn.addEventListener('click', handle, true)
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onClick()
      }
    })

    return row
  }

  function triggerDownload(url, type, rowSuffix) {
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
    const item = {
      url,
      type,
      initiator: 'https://www.douyin.com/',
      title: downloadTitle
    }
    const done = (ok) => {
      logCs('trigger-download-finished', { ok, awemeId: currentData?.awemeId || null })
      if (ok) {
        closePanel()
        flashButton('dy-dl-sent')
      } else {
        flashButton(null)
      }
    }
    try {
      const p = chrome.runtime.sendMessage({ type: 'DOWNLOAD_MEDIA_FROM_CONTENT', item, surfacedWake: true })
      if (p && typeof p.then === 'function') {
        p.then((resp) => {
          logCs('trigger-download-reply', { ok: !!(resp && resp.ok), error: resp?.error })
          done(resp && resp.ok)
        }).catch((err) => {
          logCs('trigger-download-promise-reject', { err: String(err) })
          done(false)
        })
      } else {
        chrome.runtime.sendMessage({ type: 'DOWNLOAD_MEDIA_FROM_CONTENT', item, surfacedWake: true }, (resp) => {
          if (chrome.runtime.lastError) {
            logCs('trigger-download-last-error', { message: chrome.runtime.lastError.message })
            done(false)
            return
          }
          logCs('trigger-download-callback-reply', { ok: !!(resp && resp.ok), error: resp?.error })
          done(resp && resp.ok)
        })
      }
    } catch (err) {
      logCs('trigger-download-send-throw', { err: String(err) })
      done(false)
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
          () => triggerDownload(fmt.url, 'mp4', `${fmt.label} ${codecBadge}`)
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
        () => triggerDownload(currentData.cover.url, 'jpeg', 'cover')
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
        () => triggerDownload(currentData.music.url, 'mp3', 'audio')
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

  window.addEventListener('message', (e) => {
    if (!e.data || e.data.type !== 'DOUYIN_VIDEO_DATA' || e.data.source !== 'douyin-bridge') return
    const data = e.data.data
    if (!data || !data.awemeId) return

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
    startRaf()

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

  // ── Periodic anchor check ──────────────────────────────────────────────────
  // Detect when feed-active-video appears (e.g. modal opened on profile page)

  function checkAnchor() {
    const btn = document.getElementById(BTN_ID)

    if (hasDouyinPlayer()) {
      const b = btn || ensureButton()
      positionButton(b)
      startRaf()
    } else if (btn) {
      btn.classList.remove('dy-dl-visible')
      btn.classList.add('dy-dl-hidden')
    }
  }

  setInterval(checkAnchor, 500)
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
})()
