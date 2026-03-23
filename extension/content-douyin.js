;(function () {
  'use strict'

  // NOTE: content-douyin-bridge.js runs in MAIN world via manifest "world": "MAIN"
  // This script runs in ISOLATED world and receives data via postMessage.

  // ── Constants ─────────────────────────────────────────────────────────────

  const BTN_ID = 'dy-dl-btn'
  const PANEL_ID = 'dy-dl-panel'
  const BTN_INSET = 10

  const SVG_DOWNLOAD = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`
  const SVG_VIDEO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>`
  const SVG_MUSIC = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`
  const SVG_IMAGE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`

  // ── State ──────────────────────────────────────────────────────────────────

  let currentData = null   // Latest DOUYIN_VIDEO_DATA payload
  let activePanel = null   // DOM node of the open panel, or null
  let rafId = null         // rAF loop handle
  let lastHref = location.href

  // ── Utility ────────────────────────────────────────────────────────────────

  function formatSize(bytes) {
    if (!bytes) return ''
    const mb = bytes / 1024 / 1024
    return mb >= 100 ? Math.round(mb) + ' MB' : mb.toFixed(1) + ' MB'
  }

  function getAnchor() {
    return document.querySelector('[data-e2e="feed-active-video"]')
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
    const anchor = getAnchor()
    if (!anchor) {
      btn.classList.remove('dy-dl-visible')
      btn.classList.add('dy-dl-hidden')
      return
    }
    const rect = anchor.getBoundingClientRect()
    if (rect.width < 10 || rect.height < 10) {
      btn.classList.remove('dy-dl-visible')
      btn.classList.add('dy-dl-hidden')
      return
    }
    btn.style.top = (rect.top + BTN_INSET) + 'px'
    btn.style.left = (rect.right - BTN_INSET - 32) + 'px'
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
      e.stopPropagation()
      onClick()
    }
    row.addEventListener('click', handle)
    dlBtn.addEventListener('click', handle)
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') onClick() })

    return row
  }

  function triggerDownload(url, type) {
    closePanel()
    flashButton('dy-dl-sending')
    const item = { url, type, initiator: 'https://www.douyin.com/' }
    chrome.runtime.sendMessage({ type: 'DOWNLOAD_MEDIA_FROM_CONTENT', item }, (resp) => {
      if (chrome.runtime.lastError) {
        flashButton(null)
        return
      }
      flashButton(resp && resp.ok ? 'dy-dl-sent' : null)
    })
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
      // Auto-dismiss after 1.5s to let bridge catch up
      setTimeout(() => { if (activePanel === panel) closePanel() }, 1500)
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
          () => triggerDownload(fmt.url, 'mp4')
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
        () => triggerDownload(currentData.cover.url, 'jpeg')
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
        () => triggerDownload(currentData.music.url, 'mp3')
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

  function positionPanelRelativeTo(panel, _btn) {
    const anchor = getAnchor()
    if (!anchor) return

    const rect = anchor.getBoundingClientRect()
    const panelW = panel.offsetWidth || 260
    const panelH = panel.offsetHeight || 200
    const vw = window.innerWidth
    const vh = window.innerHeight

    let top = rect.top + BTN_INSET + 32 + 6
    let left = rect.right - panelW - BTN_INSET

    if (left < 8) left = 8
    if (left + panelW > vw - 8) left = vw - panelW - 8
    if (top + panelH > vh - 8) top = vh - panelH - 8
    if (top < 8) top = 8

    panel.style.top = top + 'px'
    panel.style.left = left + 'px'
  }

  function repositionPanel() {
    const panel = document.getElementById(PANEL_ID)
    if (!panel) return
    const anchor = getAnchor()
    if (!anchor) return

    const rect = anchor.getBoundingClientRect()
    const panelW = panel.offsetWidth || 260
    const panelH = panel.offsetHeight || 200
    const vw = window.innerWidth
    const vh = window.innerHeight

    let top = rect.top + BTN_INSET + 32 + 6
    let left = rect.right - panelW - BTN_INSET

    if (left < 8) left = 8
    if (left + panelW > vw - 8) left = vw - panelW - 8
    if (top + panelH > vh - 8) top = vh - panelH - 8
    if (top < 8) top = 8

    panel.style.top = top + 'px'
    panel.style.left = left + 'px'
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

    const btn = ensureButton()
    positionButton(btn)
    startRaf()
  })

  // ── Eager button init ─────────────────────────────────────────────────────
  // Show button immediately when the anchor exists, even before bridge data arrives

  function eagerInit() {
    if (document.getElementById(BTN_ID)) return  // Already created
    if (!getAnchor()) return
    const btn = ensureButton()
    positionButton(btn)
    startRaf()
  }

  // Try immediately and retry a few times until anchor appears
  setTimeout(eagerInit, 500)
  setTimeout(eagerInit, 1500)
  setTimeout(eagerInit, 3000)

  // ── Panel / button dismissal ───────────────────────────────────────────────

  document.addEventListener('click', (e) => {
    if (!activePanel) return
    const btn = document.getElementById(BTN_ID)
    if (activePanel.contains(e.target)) return
    if (btn && btn.contains(e.target)) return
    closePanel()
  }, true)

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
    const btn = document.getElementById(BTN_ID)
    if (btn) {
      btn.classList.remove('dy-dl-visible')
      btn.classList.add('dy-dl-hidden')
    }
    // Stop rAF until bridge sends new data on the new page
    stopRaf()
  })

  navObserver.observe(document.documentElement, { subtree: false, childList: true })
})()
