importScripts('cookie-sync-domains.js')
const COOKIE_SYNC_DOMAINS = globalThis.COOKIE_SYNC_DOMAINS

const APP_URL = 'http://127.0.0.1:18765'
const VDL_SERVER_URL = 'http://127.0.0.1:30010'

function truncateUrl(u, max = 72) {
  if (!u || typeof u !== 'string') return ''
  return u.length <= max ? u : `${u.slice(0, max)}…`
}

/** Service worker console: chrome://extensions → V-Download → “service worker” → Inspect */
function logBg(stage, data) {
  const line = { stage, t: new Date().toISOString(), ...data }
  console.info('[V-Download ext]', line)
}

const DEBOUNCE_MS = 2000

const ICON_ACTIVE = {
  16: 'icons/icon16.png',
  48: 'icons/icon48.png'
}

const MEDIA_PATTERNS = [
  { pattern: /\.m3u8(\?|#|$)/i, type: 'hls' },
  { pattern: /\.mp4(\?|#|$)/i, type: 'mp4' },
  { pattern: /\.webm(\?|#|$)/i, type: 'webm' },
  { pattern: /\.flv(\?|#|$)/i, type: 'flv' }
]
const MIN_VIDEO_SIZE = 100000
const SIZE_EXEMPT_TYPES = new Set(['hls'])
const FRAME_BUCKET_MAX = 50

/** After vdownload://wake cold-starts the app, POST /download when localhost server is up. */
async function postDownloadsQueueWhenReady(requests, maxAttempts = 48, delayMs = 500) {
  const rid = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  logBg('post-queue-start', {
    rid,
    n: requests.length,
    url0: truncateUrl(requests[0]?.url),
    type0: requests[0]?.type
  })
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const ping = await fetch(`${APP_URL}/ping`)
      if (ping.ok) {
        logBg('post-queue-ping-ok', { rid, attempt })
        await syncCookies()
        for (let i = 0; i < requests.length; i++) {
          const req = requests[i]
          const res = await fetch(`${APP_URL}/download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req)
          })
          logBg('post-queue-download-post', { rid, i, status: res.status, ok: res.ok })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
        }
        logBg('post-queue-done', { rid, ok: true })
        return true
      }
      if (attempt === 0 || attempt % 10 === 0) {
        logBg('post-queue-ping-notok', { rid, attempt, status: ping.status })
      }
    } catch (e) {
      if (attempt === 0 || attempt % 10 === 0) {
        logBg('post-queue-attempt-catch', { rid, attempt, err: String(e) })
      }
    }
    await new Promise((r) => setTimeout(r, delayMs))
  }
  logBg('post-queue-timeout', { rid, maxAttempts, delayMs })
  return false
}

function postDownloadWhenAppReady(request) {
  return postDownloadsQueueWhenReady([request])
}

// tabMedia: Map<tabId, Map<frameId, Map<url, mediaEntry>>>
const tabMedia = new Map()
let lastClickTime = 0
let lastWakeBgAt = 0
const WAKE_DEBOUNCE_MS = 2000

// --- Frame-aware storage helpers ---

function getFrameBucket(tabId, frameId) {
  if (!tabMedia.has(tabId)) tabMedia.set(tabId, new Map())
  const tab = tabMedia.get(tabId)
  if (!tab.has(frameId)) tab.set(frameId, new Map())
  return tab.get(frameId)
}

function addMediaEntry(tabId, frameId, url, entry) {
  const bucket = getFrameBucket(tabId, frameId)
  if (bucket.has(url)) return
  bucket.set(url, entry)
  // Evict oldest entries if over cap
  if (bucket.size > FRAME_BUCKET_MAX) {
    const sorted = Array.from(bucket.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp)
    const toRemove = sorted.slice(0, bucket.size - FRAME_BUCKET_MAX)
    for (const [k] of toRemove) bucket.delete(k)
  }
}

function getFrameMedia(tabId, frameId) {
  const tab = tabMedia.get(tabId)
  if (!tab) return []
  const bucket = tab.get(frameId)
  return bucket ? Array.from(bucket.values()) : []
}

function getAllTabMedia(tabId) {
  const tab = tabMedia.get(tabId)
  if (!tab) return []
  const seen = new Set()
  const result = []
  for (const bucket of tab.values()) {
    for (const [url, entry] of bucket) {
      if (!seen.has(url)) {
        seen.add(url)
        result.push(entry)
      }
    }
  }
  return result
}

// --- Action / tab event handlers ---

/** Best-effort: same anchor trick as wake-sync.js so the page origin owns the external-protocol prompt. */
function injectPageWakeGesture(tabId) {
  if (tabId == null) return Promise.resolve()
  return chrome.scripting
    .executeScript({
      target: { tabId },
      func: () => {
        try {
          const a = document.createElement('a')
          a.href = 'vdownload://wake'
          a.target = '_blank'
          a.rel = 'noopener noreferrer'
          const root = document.documentElement || document.body
          if (!root) return
          root.appendChild(a)
          a.click()
          root.removeChild(a)
        } catch (_) {}
      }
    })
    .then(() => {})
    .catch(() => {})
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.url) return
  const now = Date.now()
  if (now - lastClickTime < DEBOUNCE_MS) return
  lastClickTime = now

  if (isYouTubeUrl(tab.url)) {
    let downloadUrl = tab.url

    if (!/[?&]v=/.test(tab.url)) {
      try {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const player = document.querySelector('#movie_player')
            return player?.getVideoUrl?.() || null
          }
        })
        if (result?.result) downloadUrl = result.result
      } catch {}
    }

    if (/[?&]v=/.test(downloadUrl)) {
      await injectPageWakeGesture(tab.id)
      await sendDownloadRequest({ url: downloadUrl }, tab.id, { surfacedWake: true })
    }
  }

  if (isDouyinUrl(tab.url)) {
    try {
      await syncCookies()
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const btn = document.getElementById('dy-dl-btn')
          if (btn) btn.click()
        }
      })
    } catch {}
  }

  if (isXUrl(tab.url)) {
    const statusUrl = getXStatusUrl(tab.url)
    if (statusUrl) {
      await injectPageWakeGesture(tab.id)
      await sendDownloadRequest({ url: statusUrl }, tab.id, { surfacedWake: true })
    }
  }
})

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId)
    updateTabUI(tab)
  } catch {}
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    updateTabUI(tab)
  }
  if (changeInfo.url) {
    tabMedia.delete(tabId)
    updateBadge(tabId, 0)
  }
})

chrome.tabs.onRemoved.addListener((tabId) => {
  tabMedia.delete(tabId)
})

function updateTabUI(tab) {
  if (!tab.active || !tab.id) return
  const isYT = tab.url && isYouTubeUrl(tab.url)
  const isDouyin = tab.url && isDouyinUrl(tab.url)
  const isX = tab.url && isXUrl(tab.url)

  const noPopup = isYT || isDouyin || isX
  chrome.action.setPopup({ tabId: tab.id, popup: noPopup ? '' : 'popup.html' })
  chrome.action.setIcon({ tabId: tab.id, path: ICON_ACTIVE })

  if (!isYT) {
    const count = (isDouyin || isX) ? 0 : getAllTabMedia(tab.id).length
    updateBadge(tab.id, count)
  }
}

function updateBadge(tabId, count) {
  if (count > 0) {
    chrome.action.setBadgeText({ tabId, text: String(count) })
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#27272A' })
    chrome.action.setIcon({ tabId, path: ICON_ACTIVE })
  } else {
    chrome.action.setBadgeText({ tabId, text: '' })
  }
}

// --- webRequest sniffer (frame-aware) ---

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.tabId < 0) return
    if (isYouTubeUrl(details.url)) return
    if (isDouyinUrl(details.initiator || '') || isDouyinUrl(details.url)) return
    if (isXUrl(details.initiator || '') || /video\.twimg\.com/.test(details.url)) return
    if (details.statusCode < 200 || details.statusCode >= 400) return

    let mediaType = null
    for (const { pattern, type } of MEDIA_PATTERNS) {
      if (pattern.test(details.url)) {
        mediaType = type
        break
      }
    }

    if (!mediaType) {
      const contentType = getHeader(details.responseHeaders, 'content-type')
      if (contentType) {
        if (contentType.includes('mpegurl') || contentType.includes('x-mpegurl')) {
          mediaType = 'hls'
        } else if (contentType.includes('video/mp4')) {
          mediaType = 'mp4'
        } else if (contentType.includes('video/webm')) {
          mediaType = 'webm'
        } else if (contentType.includes('video/x-flv')) {
          mediaType = 'flv'
        }
      }
    }
    if (!mediaType) return

    if (!SIZE_EXEMPT_TYPES.has(mediaType)) {
      const contentLength = getHeader(details.responseHeaders, 'content-length')
      if (contentLength && parseInt(contentLength) < MIN_VIDEO_SIZE) return
    }

    const contentLength = getHeader(details.responseHeaders, 'content-length')
    const frameId = details.frameId ?? 0
    addMediaEntry(details.tabId, frameId, details.url, {
      url: details.url,
      type: mediaType,
      size: contentLength ? parseInt(contentLength) : null,
      initiator: details.initiator || '',
      timestamp: Date.now()
    })

    updateBadge(details.tabId, getAllTabMedia(details.tabId).length)
  },
  { urls: ['<all_urls>'], types: ['media', 'xmlhttprequest', 'other'] },
  ['responseHeaders']
)

function getHeader(headers, name) {
  if (!headers) return null
  const header = headers.find((h) => h.name.toLowerCase() === name.toLowerCase())
  return header ? header.value : null
}

// --- Message handlers ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'FORCE_COOKIE_SYNC') {
    ;(async () => {
      const ok = await syncCookies()
      sendResponse({
        ok,
        error: ok ? undefined : 'App did not accept cookies (is V-Download running on this machine?)',
      })
      const tabId = sender.tab?.id
      const url = sender.tab?.url ?? ''
      if (
        ok &&
        tabId !== undefined &&
        url.startsWith(`${APP_URL}/cookie-sync-landing`)
      ) {
        setTimeout(() => {
          chrome.tabs.remove(tabId, () => void chrome.runtime.lastError)
        }, 450)
      }
    })()
    return true
  }

  // Existing: YouTube content.js download button
  if (message.type === 'DOWNLOAD_VIDEO') {
    const surfacedWake = message.surfacedWake === true
    sendDownloadRequest({ url: message.url }, sender.tab?.id, { surfacedWake })
      .then((ok) => sendResponse(ok ? { ok: true } : { error: true }))
      .catch(() => sendResponse({ error: true }))
    return true
  }

  // Existing: popup queries all media for the active tab
  if (message.type === 'GET_MEDIA') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id
      if (!tabId) {
        sendResponse({ media: [], tabUrl: '', tabTitle: '' })
        return
      }
      const media = getAllTabMedia(tabId)
      sendResponse({ media, tabUrl: tabs[0].url || '', tabTitle: tabs[0].title || '' })
    })
    return true
  }

  // Existing: popup triggers multi-item download
  if (message.type === 'DOWNLOAD_MEDIA') {
    const { items, tabUrl, tabTitle } = message
    const surfacedWake = message.surfacedWake === true
    const baseTitle = tabTitle || 'download'
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tabId = tabs[0]?.id || null
      const requests = items.map((item, i) => ({
        url: item.url,
        type: item.type,
        referer: item.initiator || tabUrl || '',
        title: items.length > 1 ? `${baseTitle} (${i + 1})` : baseTitle
      }))

      try {
        await syncCookies()
        const firstRes = await fetch(`${APP_URL}/download`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requests[0])
        })
        if (firstRes.ok) {
          for (let i = 1; i < requests.length; i++) {
            await fetch(`${APP_URL}/download`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(requests[i])
            })
          }
          sendResponse({ ok: true })
          return
        }
      } catch {
        // App not running — launch via protocol then POST all when ready (including first item)
      }

      if (!surfacedWake) {
        launchWakeToFocusApp(tabId)
      }
      let posted = await postDownloadsQueueWhenReady(requests)
      if (!posted && surfacedWake) {
        logBg('download-media-fallback-bg-wake', { tabId })
        launchWakeToFocusApp(tabId, { force: true })
        posted = await postDownloadsQueueWhenReady(requests)
      }
      sendResponse({ ok: posted })
    })
    return true
  }

  // New: content overlay queries media for its specific frame, with tab-level fallback
  if (message.type === 'GET_FRAME_MEDIA') {
    const tabId = sender.tab?.id
    const frameId = sender.frameId ?? 0
    if (!tabId) {
      sendResponse({ media: [], source: 'none', frameId })
      return true
    }
    let media = getFrameMedia(tabId, frameId)
    let source = 'frame'
    if (media.length === 0) {
      media = getAllTabMedia(tabId)
      source = 'tab-fallback'
    }
    sendResponse({
      media,
      source,
      frameId,
      isYouTube: isYouTubeUrl(sender.tab.url || ''),
      pageTitle: sender.tab.title || ''
    })
    return true
  }

  // Content scripts → localhost: use return true + sendResponse (Promise return is flaky in some Chrome MV3 builds).
  if (message.type === 'DOWNLOAD_MEDIA_FROM_CONTENT') {
    const { item } = message
    const surfacedWake = message.surfacedWake === true
    const tabId = sender.tab?.id
    const tabUrl = sender.tab?.url || ''
    const tabTitle = sender.tab?.title || 'download'

    if (!item || !item.url) {
      logBg('download-from-content-bad-item', { tabId, hasItem: !!item })
      sendResponse({ ok: false, error: 'Missing item or url' })
      return false
    }

    const request = {
      url: item.url,
      type: item.type,
      referer: item.initiator || tabUrl,
      title: (item.title && String(item.title).trim()) || tabTitle
    }

    logBg('download-from-content-start', {
      tabId,
      type: item.type,
      url: truncateUrl(item.url),
      referer: truncateUrl(request.referer, 48),
      title: (request.title || '').slice(0, 80)
    })

    let responded = false
    const safeSend = (payload) => {
      if (responded) return
      responded = true
      try {
        sendResponse(payload)
      } catch (e) {
        logBg('download-from-content-sendResponse-failed', { err: String(e) })
      }
    }

    ;(async () => {
      try {
        const cookiesOk = await syncCookies()
        logBg('download-from-content-sync-cookies', { cookiesOk })
        const res = await fetch(`${APP_URL}/download`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request)
        })
        logBg('download-from-content-fetch', { status: res.status, ok: res.ok })
        if (res.ok) {
          safeSend({ ok: true })
          return
        }
      } catch (e) {
        logBg('download-from-content-fetch-catch', { err: String(e) })
      }
      try {
        logBg('download-from-content-cold-wake', { tabId, surfacedWake })
        if (!surfacedWake) {
          launchWakeToFocusApp(tabId)
        }
        let ok = await postDownloadWhenAppReady(request)
        if (!ok && surfacedWake) {
          logBg('download-from-content-fallback-bg-wake', { tabId })
          launchWakeToFocusApp(tabId, { force: true })
          ok = await postDownloadWhenAppReady(request)
        }
        logBg('download-from-content-after-wake', { ok })
        safeSend({ ok })
      } catch (err) {
        logBg('download-from-content-wake-catch', { err: String(err) })
        safeSend({ ok: false, error: String(err) })
      }
    })()
    return true
  }

  return false
})

function isYouTubeUrl(url) {
  return /^https?:\/\/(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)/.test(url)
}

function isDouyinUrl(url) {
  return /^https?:\/\/([a-z0-9-]+\.)?(douyin|iesdouyin)\.com/i.test(url)
}

function isXUrl(url) {
  return /^https?:\/\/(www\.)?(x\.com|twitter\.com)/.test(url)
}

function getXStatusUrl(url) {
  const m = url.match(/https:\/\/(x|twitter)\.com\/[^/]+\/status\/\d+/)
  return m ? m[0] : null
}

async function sendDownloadRequest(request, tabId, opts = {}) {
  const { surfacedWake = false } = opts
  const payload = typeof request === 'object' && request !== null ? request : { url: String(request) }
  try {
    await syncCookies()
    const res = await fetch(`${APP_URL}/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    if (res.ok) return true
  } catch {
    /* app not running */
  }
  if (!surfacedWake) {
    launchWakeToFocusApp(tabId)
  }
  let ok = await postDownloadWhenAppReady(payload)
  if (!ok && surfacedWake) {
    logBg('sendDownload-fallback-bg-wake', { tabId })
    launchWakeToFocusApp(tabId, { force: true })
    ok = await postDownloadWhenAppReady(payload)
  }
  return ok
}

/** Wake desktop app without queuing a download (extension POSTs to localhost after boot). */
function launchWakeToFocusApp(tabId, opts = {}) {
  const { force = false } = opts
  const now = Date.now()
  if (!force && now - lastWakeBgAt < WAKE_DEBOUNCE_MS) {
    logBg('launch-wake-skipped-debounce', { tabId, msSince: now - lastWakeBgAt })
    return
  }
  lastWakeBgAt = now
  logBg('launch-wake', { tabId, force })
  const wakeUrl = 'vdownload://wake'
  chrome.tabs.create({ url: wakeUrl, active: true }, (created) => {
    if (chrome.runtime.lastError || !created?.id) {
      logBg('launch-wake-fallback-inject', {
        err: chrome.runtime.lastError?.message,
        tabId
      })
      protocolLaunchInjectTab(wakeUrl, tabId)
      return
    }
    logBg('launch-wake-tab-created', { newTabId: created.id })
    const id = created.id
    setTimeout(() => {
      chrome.tabs.remove(id, () => void chrome.runtime.lastError)
    }, 2000)
  })
}

/** Legacy fallback: navigate an existing tab (fragile on some SPAs). */
function protocolLaunchInjectTab(ytdlUrl, tabId) {
  const execTabId = tabId || undefined
  if (execTabId) {
    chrome.scripting
      .executeScript({
        target: { tabId: execTabId },
        func: (u) => {
          window.location.href = u
        },
        args: [ytdlUrl]
      })
      .catch(() => {})
  } else {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.scripting
          .executeScript({
            target: { tabId: tabs[0].id },
            func: (u) => {
              window.location.href = u
            },
            args: [ytdlUrl]
          })
          .catch(() => {})
      }
    })
  }
}

async function syncCookies() {
  try {
    const allCookies = []
    for (const domain of COOKIE_SYNC_DOMAINS) {
      const cookies = await chrome.cookies.getAll({ domain })
      allCookies.push(...cookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        expirationDate: c.expirationDate
      })))
    }

    const body = JSON.stringify(allCookies)
    const headers = { 'Content-Type': 'application/json' }

    let appOk = false
    const appFetch = fetch(`${APP_URL}/cookies`, { method: 'POST', headers, body })
      .then((r) => {
        appOk = r.ok
        return r
      })
      .catch(() => {})

    await Promise.allSettled([
      appFetch,
      fetch(`${VDL_SERVER_URL}/api/cookies`, { method: 'POST', headers, body }).catch(() => {}),
    ])

    console.log(`Synced ${allCookies.length} cookies across ${COOKIE_SYNC_DOMAINS.length} domains`)
    return appOk
  } catch {
    return false
  }
}

async function pollPendingCookieSync() {
  try {
    const poll = await fetch(`${APP_URL}/cookie-sync-poll`)
    if (!poll.ok) return
    const data = await poll.json()
    if (!data.pending) return
    await syncCookies()
  } catch {
    // app not running
  }
}

chrome.runtime.onInstalled.addListener(() => {
  syncCookies()
})

chrome.runtime.onStartup.addListener(() => {
  syncCookies()
})

chrome.alarms.create('sync-cookies', { periodInMinutes: 5 })
chrome.alarms.create('cookie-sync-force-poll', { periodInMinutes: 1 })
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'sync-cookies') {
    syncCookies()
  } else if (alarm.name === 'cookie-sync-force-poll') {
    void pollPendingCookieSync()
  }
})
