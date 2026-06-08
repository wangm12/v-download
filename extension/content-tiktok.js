;(function () {
  'use strict'

  const PL = globalThis.VDownloadOverlayPlacement || null

  const BTN_ID = 'tt-dl-btn'
  const PANEL_ID = 'tt-dl-panel'
  const BTN_SIZE = PL ? PL.DEFAULT_BTN_SIZE : 32
  const BTN_INSET = PL ? PL.DEFAULT_INSET : 10

  const SVG_DOWNLOAD = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`
  const SVG_VIDEO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>`

  let activePanel = null
  let rafId = null
  let lastHref = location.href

  function getPlayerRect() {
    return PL ? PL.getTikTokPlayerRect() : null
  }

  function hasPlayer() {
    return !!getPlayerRect()
  }

  function getPlacementStrategy() {
    return PL ? PL.getPlacementStrategy({ site: 'tiktok', pageType: 'feed' }) : 'topRight'
  }

  function formatSize(bytes) {
    if (!bytes) return ''
    const mb = bytes / 1024 / 1024
    return mb >= 100 ? Math.round(mb) + ' MB' : mb.toFixed(1) + ' MB'
  }

  function flashButton(stateClass) {
    const btn = document.getElementById(BTN_ID)
    if (!btn) return
    btn.classList.remove('tt-dl-sending', 'tt-dl-sent')
    if (stateClass) {
      btn.classList.add(stateClass)
      setTimeout(() => btn && btn.classList.remove(stateClass), 1800)
    }
  }

  function ensureButton() {
    let btn = document.getElementById(BTN_ID)
    if (btn) return btn

    btn = document.createElement('button')
    btn.id = BTN_ID
    btn.className = 'tt-dl-btn tt-dl-hidden'
    btn.setAttribute('aria-label', 'Download video')
    btn.title = 'Download with V-Download'
    btn.innerHTML = SVG_DOWNLOAD

    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      e.preventDefault()
      if (activePanel) {
        closePanel()
      } else {
        openPanel(btn)
      }
    })

    document.documentElement.appendChild(btn)
    return btn
  }

  function positionButton(btn) {
    const rect = getPlayerRect()
    if (!rect) {
      btn.classList.remove('tt-dl-visible')
      btn.classList.add('tt-dl-hidden')
      return
    }
    const strategy = getPlacementStrategy()
    const pos = PL
      ? PL.computeButtonPosition(rect, strategy, BTN_SIZE, BTN_INSET)
      : { top: rect.top + BTN_INSET, left: rect.right - BTN_INSET - BTN_SIZE }
    if (!pos) return
    btn.style.top = pos.top + 'px'
    btn.style.left = pos.left + 'px'
    btn.classList.add('tt-dl-visible')
    btn.classList.remove('tt-dl-hidden')
  }

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

  function closePanel() {
    const panel = document.getElementById(PANEL_ID)
    if (panel) panel.remove()
    activePanel = null
  }

  function positionPanelRelativeTo(panel, btn) {
    const playerRect = getPlayerRect()
    if (!playerRect) return
    const panelW = panel.offsetWidth || 260
    const panelH = panel.offsetHeight || 200
    const btnRect = btn ? btn.getBoundingClientRect() : playerRect
    if (PL) {
      const pos = PL.computePanelPosition(playerRect, btnRect, panelW, panelH)
      PL.applyPanelStyles(panel, pos)
      return
    }
    panel.style.top = (playerRect.top + BTN_INSET + BTN_SIZE + 6) + 'px'
    panel.style.left = (playerRect.right - panelW - BTN_INSET) + 'px'
  }

  function repositionPanel() {
    const panel = document.getElementById(PANEL_ID)
    const btn = document.getElementById(BTN_ID)
    if (panel) positionPanelRelativeTo(panel, btn)
  }

  function isVideoPageUrl() {
    return /\/video\/\d+/.test(location.pathname)
  }

  function triggerPageDownload(btn) {
    flashButton('tt-dl-sending')
    chrome.runtime.sendMessage({ type: 'DOWNLOAD_VIDEO', url: location.href, surfacedWake: true }, (resp) => {
      flashButton(resp && !resp.error ? 'tt-dl-sent' : null)
      if (resp && !resp.error) closePanel()
    })
  }

  function triggerMediaDownload(item, btn) {
    flashButton('tt-dl-sending')
    chrome.runtime.sendMessage({ type: 'DOWNLOAD_MEDIA_FROM_CONTENT', item, surfacedWake: true }, (resp) => {
      flashButton(resp && resp.ok ? 'tt-dl-sent' : null)
      if (resp && resp.ok) closePanel()
    })
  }

  async function fetchFrameMedia() {
    return await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'GET_FRAME_MEDIA' }, (r) => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError)
        else resolve(r || {})
      })
    })
  }

  function buildRow(label, type, size, onClick) {
    const row = document.createElement('div')
    row.className = 'tt-dl-format-item'
    row.setAttribute('role', 'button')

    const icon = document.createElement('span')
    icon.className = 'tt-dl-format-icon'
    icon.innerHTML = SVG_VIDEO
    row.appendChild(icon)

    const info = document.createElement('div')
    info.className = 'tt-dl-format-info'
    const labelEl = document.createElement('div')
    labelEl.className = 'tt-dl-format-label'
    labelEl.textContent = label
    info.appendChild(labelEl)
    if (size) {
      const meta = document.createElement('div')
      meta.className = 'tt-dl-format-meta'
      const sz = document.createElement('span')
      sz.className = 'tt-dl-format-size'
      sz.textContent = size
      meta.appendChild(sz)
      info.appendChild(meta)
    }
    row.appendChild(info)

    const dlBtn = document.createElement('button')
    dlBtn.className = 'tt-dl-format-dl-btn'
    dlBtn.innerHTML = SVG_DOWNLOAD
    row.appendChild(dlBtn)

    const handle = (e) => {
      e.preventDefault()
      e.stopPropagation()
      onClick()
    }
    row.addEventListener('click', handle, true)
    dlBtn.addEventListener('click', handle, true)
    return row
  }

  async function openPanel(btn) {
    closePanel()

    const panel = document.createElement('div')
    panel.id = PANEL_ID
    panel.className = 'tt-dl-panel'

    const header = document.createElement('div')
    header.className = 'tt-dl-panel-header'
    header.textContent = 'Download'
    panel.appendChild(header)

    if (isVideoPageUrl()) {
      panel.appendChild(buildRow('Download Video', 'page', '', () => triggerPageDownload(btn)))
      document.documentElement.appendChild(panel)
      activePanel = panel
      requestAnimationFrame(() => positionPanelRelativeTo(panel, btn))
      return
    }

    const loading = document.createElement('div')
    loading.className = 'tt-dl-panel-empty'
    loading.textContent = 'Reading video data…'
    panel.appendChild(loading)
    document.documentElement.appendChild(panel)
    activePanel = panel
    requestAnimationFrame(() => positionPanelRelativeTo(panel, btn))

    try {
      const resp = await fetchFrameMedia()
      const media = (resp.media || []).slice(0, 12)
      panel.replaceChildren()

      const loadedHeader = document.createElement('div')
      loadedHeader.className = 'tt-dl-panel-header'
      loadedHeader.textContent = 'Download'
      panel.appendChild(loadedHeader)

      if (!media.length) {
        const empty = document.createElement('div')
        empty.className = 'tt-dl-panel-empty'
        empty.textContent = 'No downloads available'
        panel.appendChild(empty)
        return
      }

      for (const entry of media) {
        panel.appendChild(buildRow(
          (entry.type || 'media').toUpperCase(),
          entry.type || 'mp4',
          formatSize(entry.size),
          () => triggerMediaDownload({
            url: entry.url,
            type: entry.type || 'mp4',
            initiator: entry.initiator || 'https://www.tiktok.com/'
          }, btn)
        ))
      }
    } catch {
      panel.replaceChildren()
      const errHeader = document.createElement('div')
      errHeader.className = 'tt-dl-panel-header'
      errHeader.textContent = 'Download'
      panel.appendChild(errHeader)
      const err = document.createElement('div')
      err.className = 'tt-dl-panel-empty'
      err.textContent = 'Unable to fetch media info'
      panel.appendChild(err)
    }
  }

  function checkPlayer() {
    const btn = document.getElementById(BTN_ID)
    if (hasPlayer()) {
      const b = btn || ensureButton()
      positionButton(b)
      startRaf()
    } else if (btn) {
      btn.classList.remove('tt-dl-visible')
      btn.classList.add('tt-dl-hidden')
      stopRaf()
    }
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && activePanel) closePanel()
  })

  const navObserver = new MutationObserver(() => {
    if (location.href === lastHref) return
    lastHref = location.href
    closePanel()
    setTimeout(checkPlayer, 300)
    setTimeout(checkPlayer, 1000)
    setTimeout(checkPlayer, 2000)
  })
  navObserver.observe(document.documentElement, { subtree: false, childList: true })

  setInterval(checkPlayer, 500)
  setTimeout(checkPlayer, 300)
  setTimeout(checkPlayer, 1000)
  setTimeout(checkPlayer, 2500)
})()
