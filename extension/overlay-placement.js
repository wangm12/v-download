;(function () {
  'use strict'

  const MIN_RECT_SIZE = 10
  const EDGE_MARGIN = 6
  const LEFT_EDGE_FLIP_THRESHOLD = 210

  const DEFAULT_BTN_SIZE = 32
  const DEFAULT_INSET = 10

  // ── Site detection ───────────────────────────────────────────────────────

  function isDouyinPage() {
    return /^https?:\/\/([a-z0-9-]+\.)?(douyin|iesdouyin)\.com/i.test(location.href)
  }

  function isTikTokPage() {
    return /^https?:\/\/([a-z0-9-]+\.)?tiktok\.com/i.test(location.href)
  }

  function isXPage() {
    return /^https?:\/\/(www\.)?(x\.com|twitter\.com)/.test(location.href)
  }

  function isXStatusPage() {
    return /\/(x|twitter)\.com\/[^/]+\/status\/\d+/.test(location.href)
  }

  function isYouTubePage() {
    return /^https?:\/\/(www\.)?youtube\.com/.test(location.href) ||
      /^https?:\/\/music\.youtube\.com/.test(location.href)
  }

  function isYouTubeWatchPage() {
    try {
      const u = new URL(location.href)
      return u.pathname === '/watch' && u.searchParams.has('v')
    } catch {
      return false
    }
  }

  function isBilibiliPage() {
    return /^https?:\/\/([a-z0-9-]+\.)?bilibili\.com/i.test(location.href)
  }

  function isBilibiliWatchPage() {
    try {
      const u = new URL(location.href)
      return /^\/video\/(BV|av)/i.test(u.pathname) || u.pathname.startsWith('/bangumi/play/')
    } catch {
      return false
    }
  }

  function getDouyinPageType() {
    if (document.querySelector('.video-detail-container')) return 'detail'
    if (document.querySelector('#slideMode')) return 'modal'
    return 'feed'
  }

  function getSiteContext() {
    if (isDouyinPage()) {
      return { site: 'douyin', pageType: getDouyinPageType() }
    }
    if (isTikTokPage()) {
      return { site: 'tiktok', pageType: 'feed' }
    }
    if (isXPage()) {
      return { site: 'x', pageType: isXStatusPage() ? 'statusDetail' : 'timeline' }
    }
    if (isYouTubePage()) {
      return { site: 'youtube', pageType: isYouTubeWatchPage() ? 'watch' : 'other' }
    }
    if (isBilibiliPage()) {
      return { site: 'bilibili', pageType: isBilibiliWatchPage() ? 'watch' : 'other' }
    }
    return { site: 'generic', pageType: 'default' }
  }

  // ── Rect helpers ───────────────────────────────────────────────────────────

  function rectFromElement(el) {
    if (!el) return null
    const r = el.getBoundingClientRect()
    if (r.width < MIN_RECT_SIZE || r.height < MIN_RECT_SIZE) return null
    return r
  }

  function pickLargestRect(elements) {
    let best = null
    let bestArea = 0
    for (const el of elements) {
      const r = rectFromElement(el)
      if (!r) continue
      const area = r.width * r.height
      if (area > bestArea) {
        bestArea = area
        best = r
      }
    }
    return best
  }

  function playerFromAnchor(anchor, selectors) {
    if (!anchor) return null
    for (const sel of selectors) {
      const el = anchor.querySelector(sel)
      const r = rectFromElement(el)
      if (r) return r
    }
    return rectFromElement(anchor)
  }

  // ── Site-specific player rects ─────────────────────────────────────────────

  function getDouyinPlayerRect(ctx) {
    const pageType = ctx?.pageType || getDouyinPageType()

    if (pageType === 'detail') {
      const container = document.querySelector('.video-detail-container')
      return playerFromAnchor(container, ['.xgplayer', 'video'])
    }

    if (pageType === 'modal') {
      const modal = document.querySelector('#slideMode')
      if (modal) {
        const active =
          modal.querySelector('.dySwiperSlide-active') ||
          modal.querySelector('[class*="active"]') ||
          modal.querySelector('video')?.closest('.dySwiperSlide') ||
          modal
        const r = playerFromAnchor(active, ['.xgplayer', 'video'])
        if (r) return r
      }
    }

    const feed = document.querySelector('[data-e2e="feed-active-video"]')
    return playerFromAnchor(feed, ['.xgplayer', 'video'])
  }

  function getTikTokPlayerRect() {
    const feedVideo = document.querySelector('[data-e2e="feed-video"]')
    if (feedVideo) {
      const r = playerFromAnchor(feedVideo, ['div[class*="DivPlayerContainer"]', 'video'])
      if (r) return r
    }

    const containers = document.querySelectorAll('div[class*="DivPlayerContainer"]')
    const visible = []
    for (const el of containers) {
      const r = rectFromElement(el)
      if (!r) continue
      if (r.bottom > 0 && r.top < window.innerHeight && r.width > 100) {
        visible.push(el)
      }
    }
    if (visible.length) {
      return pickLargestRect(visible)
    }

    const feedColumn = document.querySelector('div[class*="DivVideoFeedV2"]')
    if (feedColumn) {
      const r = playerFromAnchor(feedColumn, ['div[class*="DivPlayerContainer"]', 'video'])
      if (r) return r
    }

    return null
  }

  function getYouTubePlayerRect(video) {
    const player = document.querySelector('.html5-video-player') ||
      video?.closest('.html5-video-player')
    return rectFromElement(player) || (video ? rectFromElement(video) : null)
  }

  function getBilibiliPlayerRect(video) {
    const player = document.querySelector('.bpx-player-container') ||
      document.querySelector('#bilibili-player') ||
      video?.closest('.bpx-player-container')
    return rectFromElement(player) || (video ? rectFromElement(video) : null)
  }

  function getPlayerRect(ctx, video) {
    const context = ctx || getSiteContext()

    switch (context.site) {
      case 'douyin':
        return getDouyinPlayerRect(context)
      case 'tiktok':
        return getTikTokPlayerRect()
      case 'youtube':
        return getYouTubePlayerRect(video)
      case 'bilibili':
        return getBilibiliPlayerRect(video)
      default:
        return video ? rectFromElement(video) : null
    }
  }

  // ── Placement strategies ───────────────────────────────────────────────────

  function getPlacementStrategy(_ctx) {
    return 'topRight'
  }

  function getStrategyInsets(strategy) {
    switch (strategy) {
      case 'topLeftLarge':
        return { inset: 20, controlsOffset: 0, leftOffset: 0, topOffset: 0, actionColumnOffset: 0 }
      case 'topRightLarge':
        return { inset: 20, controlsOffset: 0, leftOffset: 0, topOffset: 0, actionColumnOffset: 0 }
      case 'topRightActionClear':
        return { inset: 10, controlsOffset: 0, leftOffset: 0, topOffset: 0, actionColumnOffset: 72 }
      case 'bottomRightAboveControls':
        return { inset: 10, controlsOffset: 52, leftOffset: 0, topOffset: 0, actionColumnOffset: 0 }
      case 'leftOfPlayer':
        return { inset: 10, controlsOffset: 0, leftOffset: 50, topOffset: 70, actionColumnOffset: 0 }
      case 'centerRight':
        return { inset: 10, controlsOffset: 0, leftOffset: 0, topOffset: 0, actionColumnOffset: 0 }
      case 'topLeft':
      case 'topRight':
      case 'bottomRight':
      default:
        return { inset: 10, controlsOffset: 0, leftOffset: 0, topOffset: 0, actionColumnOffset: 0 }
    }
  }

  function computeButtonPosition(rect, strategy, btnSize, insetOverride) {
    if (!rect) return null

    const btn = btnSize || DEFAULT_BTN_SIZE
    const cfg = getStrategyInsets(strategy)
    const inset = insetOverride != null ? insetOverride : cfg.inset

    let top
    let left

    switch (strategy) {
      case 'topLeft':
      case 'topLeftLarge':
        top = rect.top + inset
        left = rect.left + inset
        break

      case 'topRight':
      case 'topRightLarge':
        top = rect.top + inset
        left = rect.right - inset - btn - (cfg.actionColumnOffset || 0)
        break

      case 'topRightActionClear':
        top = rect.top + inset
        left = rect.right - inset - btn - cfg.actionColumnOffset
        break

      case 'bottomRightAboveControls':
        top = rect.bottom - inset - btn - cfg.controlsOffset
        left = rect.right - inset - btn
        break

      case 'bottomRight':
        top = rect.bottom - inset - btn
        left = rect.right - inset - btn
        break

      case 'leftOfPlayer':
        top = rect.top + cfg.topOffset
        left = rect.left - cfg.leftOffset - btn
        break

      case 'centerRight':
        top = rect.top + (rect.height - btn) / 2
        left = rect.right - inset - btn
        break

      default:
        top = rect.top + inset
        left = rect.left + inset
        break
    }

    return { top, left }
  }

  function computePanelPosition(_anchorRect, btnRect, panelW, panelH, options) {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const pw = panelW || 240
    const ph = panelH || 120
    const margin = (options && options.margin) || EDGE_MARGIN
    const preferBelow = !options || options.preferBelow !== false

    const ref = btnRect
    if (!ref) return { top: margin, left: vw - pw - margin }

    let top = preferBelow ? ref.bottom + 6 : ref.top - ph - 6
    // Right-align panel with the download button (top-right placement)
    let left = ref.right - pw

    // Button near left edge: open panel to the right of the button instead
    if (ref.left < LEFT_EDGE_FLIP_THRESHOLD && left < margin) {
      left = ref.right + 6
    }

    if (left < margin) left = margin
    if (left + pw > vw - margin) left = vw - pw - margin
    if (top + ph > vh - margin) top = ref.top - ph - 6
    if (top < margin) top = margin

    return { top, left }
  }

  function applyPanelStyles(panel, pos) {
    if (!panel || !pos) return
    panel.style.top = `${pos.top}px`
    panel.style.left = `${pos.left}px`
  }

  function anchorMovedSignificantly(prevRect, rect, threshold) {
    const t = threshold != null ? threshold : 30
    if (!prevRect || !rect) return true
    return (
      Math.abs(rect.top - prevRect.top) > t ||
      Math.abs(rect.left - prevRect.left) > t ||
      Math.abs(rect.width - prevRect.width) > t * 1.5
    )
  }

  function anchorOffscreen(rect) {
    if (!rect) return true
    return rect.width < MIN_RECT_SIZE ||
      rect.height < MIN_RECT_SIZE ||
      rect.bottom < 0 ||
      rect.top > window.innerHeight
  }

  function shouldDismissPanelOnScroll(site) {
    // Vertical feeds manage panel dismissal themselves; generic sites use movement-based rules.
    return site !== 'douyin' && site !== 'tiktok'
  }

  function getDouyinPanelAnchorRect(playerRect, btnSize, insetOverride) {
    const strategy = getPlacementStrategy({ site: 'douyin', pageType: getDouyinPageType() })
    const btnPos = computeButtonPosition(playerRect, strategy, btnSize || DEFAULT_BTN_SIZE, insetOverride)
    if (!btnPos) return playerRect
    const size = btnSize || DEFAULT_BTN_SIZE
    return {
      top: btnPos.top,
      left: btnPos.left,
      right: btnPos.left + size,
      bottom: btnPos.top + size,
      width: size,
      height: size
    }
  }

  globalThis.VDownloadOverlayPlacement = {
    MIN_RECT_SIZE,
    EDGE_MARGIN,
    LEFT_EDGE_FLIP_THRESHOLD,
    DEFAULT_BTN_SIZE,
    DEFAULT_INSET,
    isDouyinPage,
    isTikTokPage,
    isXPage,
    isXStatusPage,
    isYouTubePage,
    isYouTubeWatchPage,
    isBilibiliPage,
    isBilibiliWatchPage,
    getSiteContext,
    getDouyinPageType,
    getPlayerRect,
    getDouyinPlayerRect,
    getTikTokPlayerRect,
    getYouTubePlayerRect,
    getBilibiliPlayerRect,
    getPlacementStrategy,
    computeButtonPosition,
    computePanelPosition,
    applyPanelStyles,
    anchorMovedSignificantly,
    anchorOffscreen,
    shouldDismissPanelOnScroll,
    getDouyinPanelAnchorRect,
    rectFromElement
  }
})()
