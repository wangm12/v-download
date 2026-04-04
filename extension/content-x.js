;(function () {
  'use strict'

  const BTN_ATTR = 'data-vdl-x'
  const SVG_DOWNLOAD = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`

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
    return /\/(x|twitter)\.com\/[^/]+\/status\/\d+/.test(location.href)
  }

  function getStatusUrlFromPage() {
    const m = location.href.match(/https:\/\/(x|twitter)\.com\/[^/]+\/status\/\d+/)
    return m ? m[0] : null
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
    chrome.runtime.sendMessage({ type: 'DOWNLOAD_VIDEO', url: tweetUrl }, (resp) => {
      if (chrome.runtime.lastError) {
        flashButton(btn, null)
        return
      }
      flashButton(btn, resp && !resp.error ? 'vdl-x-sent' : null)
    })
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

  // ── Video overlay download button ───────────────────────────────────────

  function injectVideoOverlayButton(article) {
    if (article.querySelector(`[${BTN_ATTR}="video"]`)) return
    const videoComp = article.querySelector('[data-testid="videoComponent"]')
    if (!videoComp) return

    const tweetUrl = getTweetUrl(article)
    if (!tweetUrl) return

    const container = videoComp.querySelector('div[style*="position"]') || videoComp
    if (getComputedStyle(container).position === 'static') {
      container.style.position = 'relative'
    }

    const btn = document.createElement('button')
    btn.className = 'vdl-x-video-btn'
    btn.title = 'Download with V-Download'
    btn.innerHTML = SVG_DOWNLOAD
    btn.setAttribute(BTN_ATTR, 'video')

    btn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      triggerDownload(tweetUrl, btn)
    })

    container.appendChild(btn)
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
      if (scanTimer) clearTimeout(scanTimer)
      scanTimer = setTimeout(scanTweets, 400)
    }, { passive: true })

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
