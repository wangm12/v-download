;(function () {
  'use strict'

  const PL = globalThis.VDownloadOverlayPlacement || null
  const BTN_SIZE = PL ? PL.DEFAULT_BTN_SIZE : 32
  const BTN_INSET = PL ? PL.DEFAULT_INSET : 10

  const BTN_ATTR = 'data-vdl-x'
  const SVG_DOWNLOAD = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`

  const videoOverlayButtons = new WeakMap()

  function getTweetUrl(article) {
    if (!article) return null
    const links = article.querySelectorAll('a[href*="/status/"]')
    for (const link of links) {
      const m = link.href.match(/https:\/\/(x|twitter)\.com\/[^/]+\/status\/\d+/)
      if (m) return m[0]
    }
    return null
  }

  function isStatusPage() {
    return PL ? PL.isXStatusPage() : /\/(x|twitter)\.com\/[^/]+\/status\/\d+/.test(location.href)
  }

  function getPageType() {
    return isStatusPage() ? 'statusDetail' : 'timeline'
  }

  function getPlacementStrategy() {
    if (PL) return PL.getPlacementStrategy({ site: 'x', pageType: getPageType() })
    return 'topRight'
  }

  function getMediaRect(article) {
    const videoComp = article.querySelector('[data-testid="videoComponent"]')
    if (!videoComp) return null
    const video = videoComp.querySelector('video')
    const target = video || videoComp
    const r = target.getBoundingClientRect()
    if (r.width < 10 || r.height < 10) return null
    return r
  }

  function flashButton(btn, cls) {
    btn.classList.remove('vdl-x-sending', 'vdl-x-sent')
    if (cls) {
      btn.classList.add(cls)
      if (cls === 'vdl-x-sent') {
        setTimeout(() => btn.classList.remove(cls), 2000)
      }
    }
  }

  function triggerDownload(tweetUrl, btn) {
    if (!tweetUrl) return
    flashButton(btn, 'vdl-x-sending')
    chrome.runtime.sendMessage({ type: 'DOWNLOAD_VIDEO', url: tweetUrl, surfacedWake: true }, (resp) => {
      if (chrome.runtime.lastError) {
        flashButton(btn, null)
        return
      }
      flashButton(btn, resp && !resp.error ? 'vdl-x-sent' : null)
    })
  }

  function positionVideoOverlayButton(btn, article) {
    const rect = getMediaRect(article)
    if (!rect) {
      btn.classList.remove('vdl-x-video-visible')
      btn.classList.add('vdl-x-video-hidden')
      return
    }
    const strategy = getPlacementStrategy()
    const pos = PL
      ? PL.computeButtonPosition(rect, strategy, BTN_SIZE, BTN_INSET)
      : { top: rect.top + BTN_INSET, left: rect.right - BTN_INSET - BTN_SIZE }
    if (!pos) return
    btn.style.top = `${pos.top}px`
    btn.style.left = `${pos.left}px`
    btn.classList.add('vdl-x-video-visible')
    btn.classList.remove('vdl-x-video-hidden')
  }

  // ── Action bar download button ──────────────────────────────────────────

  function injectActionBarButton(article) {
    if (article.querySelector(`[${BTN_ATTR}="action"]`)) return
    if (!article.querySelector('video') && !article.querySelector('[data-testid="videoComponent"]')) return

    const tweetUrl = getTweetUrl(article)
    if (!tweetUrl) return

    const group = article.querySelector('[role="group"]')
    if (!group) return

    const wrap = document.createElement('div')
    wrap.className = 'vdl-x-btn-wrap'
    wrap.style.cssText = group.children[0]?.style?.cssText || ''

    const btn = document.createElement('button')
    btn.className = 'vdl-x-btn'
    btn.title = 'Download with V-Download'
    btn.innerHTML = SVG_DOWNLOAD
    btn.setAttribute(BTN_ATTR, 'action')

    btn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      triggerDownload(tweetUrl, btn)
    })

    wrap.appendChild(btn)

    const shareDiv = group.children[group.children.length - 1]
    if (shareDiv) {
      group.insertBefore(wrap, shareDiv)
    } else {
      group.appendChild(wrap)
    }
  }

  // ── Video overlay (top-left on media; timeline also has action bar) ──────

  function injectVideoOverlayButton(article) {
    if (article.querySelector(`[${BTN_ATTR}="video"]`)) return
    const videoComp = article.querySelector('[data-testid="videoComponent"]')
    if (!videoComp) return

    const tweetUrl = getTweetUrl(article)
    if (!tweetUrl) return

    const btn = document.createElement('button')
    btn.className = 'vdl-x-video-btn vdl-x-video-hidden'
    btn.title = 'Download with V-Download'
    btn.innerHTML = SVG_DOWNLOAD
    btn.setAttribute(BTN_ATTR, 'video')

    btn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      triggerDownload(tweetUrl, btn)
    })

    document.documentElement.appendChild(btn)
    videoOverlayButtons.set(article, btn)
    positionVideoOverlayButton(btn, article)
  }

  function updateVideoOverlayPositions() {
    for (const article of document.querySelectorAll('article[data-testid="tweet"]')) {
      const btn = videoOverlayButtons.get(article)
      if (btn) positionVideoOverlayButton(btn, article)
    }
  }

  // ── Scan & inject ──────────────────────────────────────────────────────

  function scanTweets() {
    const articles = document.querySelectorAll('article[data-testid="tweet"]')
    for (const article of articles) {
      const hasVideo =
        article.querySelector('video') ||
        article.querySelector('[data-testid="videoComponent"]')
      if (!hasVideo) continue
      injectActionBarButton(article)
      injectVideoOverlayButton(article)
    }
    updateVideoOverlayPositions()
  }

  // ── Debounced scan ──────────────────────────────────────────────────────

  let scanTimer = null
  function debouncedScan() {
    if (scanTimer) clearTimeout(scanTimer)
    scanTimer = setTimeout(scanTweets, 300)
  }

  // ── Init ────────────────────────────────────────────────────────────────

  function init() {
    scanTweets()

    const observer = new MutationObserver(debouncedScan)
    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    })

    let lastHref = location.href
    const navObserver = new MutationObserver(() => {
      if (location.href !== lastHref) {
        lastHref = location.href
        setTimeout(scanTweets, 500)
        setTimeout(scanTweets, 1500)
      }
    })
    navObserver.observe(document, { subtree: true, childList: true })

    window.addEventListener('scroll', () => {
      updateVideoOverlayPositions()
      if (scanTimer) clearTimeout(scanTimer)
      scanTimer = setTimeout(scanTweets, 400)
    }, { passive: true })

    window.addEventListener('resize', updateVideoOverlayPositions, { passive: true })

    setInterval(scanTweets, 3000)

    window.addEventListener('beforeunload', () => {
      observer.disconnect()
      navObserver.disconnect()
    })
  }

  if (document.body) {
    init()
  } else {
    document.addEventListener('DOMContentLoaded', init)
  }
})()
