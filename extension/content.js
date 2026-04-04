(function () {
  'use strict'

  const BUTTON_ID = 'ytdl-download-btn'
  const CARD_ATTR = 'data-ytdl-card-dl'
  const SHORTS_ATTR = 'data-ytdl-shorts-dl'
  const SVG_DOWNLOAD = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`
  const SVG_DOWNLOAD_SM = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`
  const SVG_DOWNLOAD_SHORTS = `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M17 18v1H6v-1h11zm-.5-6.6-.7-.7-3.8 3.7V4h-1v10.4l-3.8-3.8-.7.7 5 5 5-4.9z"/></svg>`

  // ── Shared ──────────────────────────────────────────────────────────────

  function showFeedback(btn) {
    btn.classList.add('ytdl-btn-active')
    setTimeout(() => btn.classList.remove('ytdl-btn-active'), 800)
  }

  function sendDownload(url) {
    chrome.runtime.sendMessage({ type: 'DOWNLOAD_VIDEO', url })
  }

  // ── Watch page download button ──────────────────────────────────────────

  function injectWatchButton() {
    if (!isWatchPage()) return
    if (document.getElementById(BUTTON_ID)) return

    const btn = document.createElement('button')
    btn.id = BUTTON_ID
    btn.className = 'ytdl-btn'
    btn.title = 'Download with V-Download'
    btn.innerHTML = SVG_DOWNLOAD

    btn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      let url = window.location.href
      if (!/[?&]v=/.test(url)) {
        const player = document.querySelector('#movie_player')
        const playerUrl = player?.getVideoUrl?.()
        if (playerUrl && /[?&]v=/.test(playerUrl)) url = playerUrl
      }
      sendDownload(url)
      showFeedback(btn)
    })

    const owner = document.querySelector('#owner')
    if (owner) { owner.appendChild(btn); return }

    const topBtns = document.querySelector('#actions #top-level-buttons-computed')
    if (topBtns) { topBtns.insertBefore(btn, topBtns.firstChild); return }

    const actions = document.querySelector('#actions')
    if (actions) { actions.insertBefore(btn, actions.firstChild); return }
  }

  // ── Shorts detail page download button ─────────────────────────────────

  function isShortsPage() {
    return window.location.pathname.startsWith('/shorts/')
  }

  function injectShortsButton() {
    if (!isShortsPage()) return

    const reels = document.querySelectorAll('ytd-reel-video-renderer[is-active], ytd-reel-video-renderer')
    for (const reel of reels) {
      if (reel.querySelector(`[${SHORTS_ATTR}]`)) continue

      const actionBar = reel.querySelector('reel-action-bar-view-model')
      if (!actionBar) continue

      const videoUrl = window.location.href

      const wrapper = document.createElement('div')
      wrapper.setAttribute(SHORTS_ATTR, '1')
      wrapper.className = 'ytdl-shorts-action'

      const btn = document.createElement('button')
      btn.className = 'ytdl-shorts-btn'
      btn.title = 'Download with V-Download'
      btn.innerHTML = SVG_DOWNLOAD_SHORTS

      const label = document.createElement('span')
      label.className = 'ytdl-shorts-label'
      label.textContent = 'Download'

      btn.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        sendDownload(window.location.href)
        btn.classList.add('ytdl-btn-active')
        setTimeout(() => btn.classList.remove('ytdl-btn-active'), 800)
      })

      wrapper.appendChild(btn)
      wrapper.appendChild(label)
      actionBar.appendChild(wrapper)
    }
  }

  // ── Card download buttons (homepage, search, sidebar) ──────────────────

  function getCardVideoUrl(card) {
    const link = card.querySelector('a[href*="/watch?"], a[href*="/shorts/"]')
    return link?.href || null
  }

  function injectCardButton(menuBtnContainer, card) {
    if (menuBtnContainer.querySelector(`[${CARD_ATTR}]`)) return

    const videoUrl = getCardVideoUrl(card)
    if (!videoUrl) return

    const btn = document.createElement('button')
    btn.setAttribute(CARD_ATTR, '1')
    btn.className = 'ytdl-card-btn'
    btn.title = 'Download with V-Download'
    btn.innerHTML = SVG_DOWNLOAD_SM

    btn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      sendDownload(getCardVideoUrl(card) || videoUrl)
      btn.classList.add('ytdl-btn-active')
      setTimeout(() => btn.classList.remove('ytdl-btn-active'), 800)
    })

    menuBtnContainer.style.display = 'flex'
    menuBtnContainer.style.flexDirection = 'column'
    menuBtnContainer.style.alignItems = 'center'
    menuBtnContainer.style.gap = '0px'
    menuBtnContainer.style.height = 'auto'
    menuBtnContainer.appendChild(btn)

    const clippingParent = menuBtnContainer.closest('.shortsLockupViewModelHostOutsideMetadata')
    if (clippingParent) {
      clippingParent.style.overflow = 'visible'
    }
  }

  const CARD_SELECTORS = [
    'ytd-rich-item-renderer',
    'ytm-shorts-lockup-view-model-v2',
    'ytm-shorts-lockup-view-model',
    'ytd-reel-item-renderer',
    'ytd-video-renderer',
    'ytd-compact-video-renderer'
  ].join(', ')

  function scanCards() {
    const cards = document.querySelectorAll(CARD_SELECTORS)

    for (const card of cards) {
      if (card.querySelector(`[${CARD_ATTR}]`)) continue

      if (!getCardVideoUrl(card)) continue

      const menuBtn = card.querySelector('button[aria-label="More actions"]')
        || card.querySelector('button[aria-label="Action menu"]')
      if (!menuBtn) continue

      const container = menuBtn.closest('div')
      if (!container) continue

      injectCardButton(container, card)
    }
  }

  // ── Page type helpers ──────────────────────────────────────────────────

  function isWatchPage() {
    return window.location.pathname === '/watch'
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  function runAllInjections() {
    if (isWatchPage()) injectWatchButton()
    if (isShortsPage()) injectShortsButton()
    scanCards()
  }

  function onPageChange() {
    const delays = [300, 800, 1500, 3000, 5000]
    for (const ms of delays) {
      setTimeout(runAllInjections, ms)
    }
  }

  let lastUrl = ''
  let scanTimer = null
  const debouncedScan = () => {
    clearTimeout(scanTimer)
    scanTimer = setTimeout(() => {
      scanTimer = null
      runAllInjections()
    }, 300)
  }

  const navObserver = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href
      onPageChange()
    }
    debouncedScan()
  })

  const checkInterval = setInterval(runAllInjections, 2000)

  runAllInjections()
  onPageChange()

  navObserver.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true
  })

  let scrollTimer = null
  window.addEventListener('scroll', () => {
    clearTimeout(scrollTimer)
    scrollTimer = setTimeout(runAllInjections, 400)
  }, { passive: true })

  window.addEventListener('beforeunload', () => {
    clearInterval(checkInterval)
    navObserver.disconnect()
  })
})()
