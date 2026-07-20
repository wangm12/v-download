importScripts('cookie-sync-domains.js', 'media-patterns.js', 'download-transport.js')
const COOKIE_SYNC_DOMAINS = globalThis.COOKIE_SYNC_DOMAINS
const MP = globalThis.VDownloadMediaPatterns
const DT = globalThis.VDownloadDownloadTransport

const APP_URL = 'http://127.0.0.1:18765'
const VDL_SERVER_URL = 'http://127.0.0.1:30010'
const LAST_DOWNLOAD_ERROR_TTL_MS = 10 * 60 * 1000
let appCapability = ''
try { chrome.storage.local.get(['appCapability'], (v) => { appCapability = typeof v.appCapability === 'string' ? v.appCapability : '' }) } catch {}
function appJsonHeaders() { return { 'Content-Type': 'application/json', 'X-VDownload-Capability': appCapability } }
async function ensureCapability(force = false) {
  if (appCapability && !force) return true
  try {
    const poll = await fetch(`${APP_URL}/cookie-sync-poll?pair=1`)
    if (!poll.ok) return false
    const data = await poll.json()
    if (typeof data.capability !== 'string' || data.capability.length < 32) return false
    appCapability = data.capability
    await chrome.storage.local.set({ appCapability })
    return true
  } catch { return false }
}
async function postAppJson(path, body) {
  const maxAttempts = 3
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (!(await ensureCapability(false))) return new Response(null, { status: 403 })
    try {
      const response = await fetch(`${APP_URL}${path}`, { method: 'POST', headers: appJsonHeaders(), body: JSON.stringify(body) })
      if (response.status !== 401 && response.status !== 403 && !DT.isTransientStatus(response.status)) return response
      if (response.status === 401 || response.status === 403) {
        if (attempt === maxAttempts - 1 || !(await ensureCapability(true))) return new Response(null, { status: 403 })
      } else if (!DT.shouldRetry({ status: response.status, attempt, maxAttempts })) return response
    } catch (error) {
      if (!DT.shouldRetry({ error, attempt, maxAttempts })) throw error
    }
    await new Promise((resolve) => setTimeout(resolve, DT.retryDelay(attempt)))
  }
  return new Response(null, { status: 403 })
}

function safeLogUrl(u) { return MP.safeUrl(u) }
function safeError(err) {
  const name = String(err?.name || 'Error').replace(/[^A-Za-z]/g, '').slice(0, 24) || 'Error'
  return { name, message: 'Request failed' }
}

/** Service worker console: chrome://extensions → V-Download → “service worker” → Inspect */
function logBg(stage, data) {
  const line = { stage, t: new Date().toISOString(), ...data }
  console.info('[V-Download ext]', line)
}

function setLastDownloadError(message) {
  try {
    chrome.storage.local.set({
      lastDownloadError: { message: String(message), t: Date.now() }
    })
  } catch {
    /* ignore */
  }
}

function clearLastDownloadError() {
  try {
    chrome.storage.local.remove('lastDownloadError')
  } catch {
    /* ignore */
  }
}

function isFreshDownloadError(err) {
  if (!err || typeof err.message !== 'string') return false
  const ts = Number(err.t || 0)
  return Number.isFinite(ts) && Date.now() - ts < LAST_DOWNLOAD_ERROR_TTL_MS
}

function cleanupLastDownloadError() {
  try {
    chrome.storage.local.get(['lastDownloadError'], ({ lastDownloadError }) => {
      if (!lastDownloadError) return
      if (!isFreshDownloadError(lastDownloadError)) {
        chrome.storage.local.remove('lastDownloadError')
      }
    })
  } catch {
    /* ignore */
  }
}

const DEBOUNCE_MS = 2000

const ICON_ACTIVE = {
  16: 'icons/icon16.png',
  48: 'icons/icon48.png'
}

const FRAME_BUCKET_MAX = 80
const MEDIA_TTL_MS = 20 * 60 * 1000

/** After vdownload://wake cold-starts the app, POST /download when localhost server is up. */
async function postDownloadsQueueWhenReady(requests, maxAttempts = 48, delayMs = 500) {
  const results = requests.map(() => ({ ok: false, status: null, error: 'Not sent' }))
  const rid = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  logBg('post-queue-start', {
    rid,
    n: requests.length,
    url0: safeLogUrl(requests[0]?.url),
    type0: requests[0]?.type
  })
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const ping = await fetch(`${APP_URL}/ping`)
      if (ping.ok) {
        logBg('post-queue-ping-ok', { rid, attempt })
        await syncCookies()
        for (let i = 0; i < requests.length; i++) {
          if (results[i].ok) continue
          const req = requests[i]
          const res = await postAppJson('/download', req)
          results[i] = { ok: res.ok, status: res.status, error: res.ok ? undefined : `HTTP ${res.status}` }
          logBg('post-queue-download-post', { rid, i, status: res.status, ok: res.ok })
        }
        const ok = results.every((result) => result.ok)
        logBg('post-queue-done', { rid, ok })
        if (ok) clearLastDownloadError()
        return { ok, results }
      }
      if (attempt === 0 || attempt % 10 === 0) {
        logBg('post-queue-ping-notok', { rid, attempt, status: ping.status })
      }
    } catch (e) {
      if (attempt === 0 || attempt % 10 === 0) {
        logBg('post-queue-attempt-catch', { rid, attempt, err: safeError(e) })
      }
    }
    await new Promise((r) => setTimeout(r, delayMs))
  }
  logBg('post-queue-timeout', { rid, maxAttempts, delayMs })
  setLastDownloadError(
    'V-Download did not respond on localhost after several attempts. Open the desktop app and try again.'
  )
  return { ok: false, results }
}

function postDownloadWhenAppReady(request) {
  return postDownloadsQueueWhenReady([request]).then((result) => result.ok)
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
  const key = MP.canonicalizeUrl(url)
  const previous = bucket.get(key)
  bucket.set(key, previous ? { ...previous, ...entry, size: Math.max(previous.size || 0, entry.size || 0) || null, timestamp: Math.max(previous.timestamp || 0, entry.timestamp || 0) } : entry)
  // Evict oldest entries if over cap
  if (bucket.size > FRAME_BUCKET_MAX) {
    const sorted = Array.from(bucket.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp)
    const toRemove = sorted.slice(0, bucket.size - FRAME_BUCKET_MAX)
    for (const [k] of toRemove) bucket.delete(k)
  }
  const tab = tabMedia.get(tabId)
  const all = []
  for (const [fid, frame] of tab) for (const [candidateUrl, candidate] of frame) all.push({ fid, candidateUrl, timestamp: candidate.timestamp || 0 })
  if (all.length > FRAME_BUCKET_MAX * 4) {
    all.sort((a, b) => a.timestamp - b.timestamp)
    for (const old of all.slice(0, all.length - FRAME_BUCKET_MAX * 4)) tab.get(old.fid)?.delete(old.candidateUrl)
  }
}

function getFrameMedia(tabId, frameId) {
  const tab = tabMedia.get(tabId)
  if (!tab) return []
  const bucket = tab.get(frameId)
  return bucket ? Array.from(bucket.values()) : []
}

function getAllTabMedia(tabId) {
  pruneMedia()
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

function pruneMedia() {
  const cutoff = Date.now() - MEDIA_TTL_MS
  for (const [tabId, frames] of tabMedia) {
    for (const [frameId, bucket] of frames) {
      for (const [url, entry] of bucket) if ((entry.timestamp || 0) < cutoff) bucket.delete(url)
      if (!bucket.size) frames.delete(frameId)
    }
    if (!frames.size) tabMedia.delete(tabId)
  }
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

    const mime = getHeader(details.responseHeaders, 'content-type') || ''
    const contentLength = getHeader(details.responseHeaders, 'content-length')
    const parsedSize = contentLength == null || contentLength === '' ? null : Number(contentLength)
    if (parsedSize !== null && (!Number.isFinite(parsedSize) || parsedSize < 0)) return
    const mediaType = MP.inferType(details.url, mime)
    const candidate = { url: details.url, type: mediaType, mime, contentType: mime, size: parsedSize, requestKind: details.type, initiator: details.initiator || '', pageUrl: details.documentUrl || details.initiator || '', timestamp: Date.now(), source: 'network' }
    if (!MP.isReliableCandidate(candidate)) return
    const frameId = details.frameId ?? 0
    candidate.confidence = MP.scoreCandidate(candidate)
    addMediaEntry(details.tabId, frameId, details.url, candidate)

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
  if (message.type === 'CLEAR_LAST_DOWNLOAD_ERROR') {
    clearLastDownloadError()
    sendResponse({ ok: true })
    return false
  }

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
      const media = MP.mergeCandidates(getAllTabMedia(tabId))
      sendResponse({ media, tabUrl: tabs[0].url || '', tabTitle: tabs[0].title || '' })
    })
    return true
  }

  // Existing: popup triggers multi-item download
  if (message.type === 'DOWNLOAD_MEDIA') {
    const { items, tabUrl, tabTitle } = message
    const surfacedWake = message.surfacedWake === true
    if (!MP.validateBatch(items)) {
      sendResponse({ ok: false, error: 'Select at least one media item.', results: [] })
      return false
    }
    const baseTitle = tabTitle || 'download'
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tabId = tabs[0]?.id || null
      const requests = MP.mergeCandidates(items).map((item, i) => ({
        url: item.url,
        type: item.type,
        referer: item.initiator || tabUrl || '',
        title: items.length > 1 ? `${baseTitle} (${i + 1})` : baseTitle
      }))

      if (!requests.length) { sendResponse({ ok: false, error: 'No reliable media items selected.', results: [] }); return }
      const directResults = requests.map(() => ({ ok: false, status: null, error: 'Not sent' }))
      let pendingRequests = requests
      try {
        await syncCookies()
        for (let i = 0; i < requests.length; i++) {
          const request = requests[i]
        const response = await postAppJson('/download', request)
          directResults[i] = { ok: response.ok, status: response.status, error: response.ok ? undefined : `HTTP ${response.status}` }
        }
        const results = directResults
        if (results.every((result) => result.ok)) {
          clearLastDownloadError()
          sendResponse({ ok: true, results })
          return
        }
        sendResponse({ ok: false, partial: results.some((result) => result.ok), results, error: 'Some downloads were rejected by the app.' })
        return
      } catch {
        pendingRequests = requests.filter((_, i) => !directResults[i].ok)
      }

      if (!surfacedWake) {
        launchWakeToFocusApp(tabId)
      }
      let posted = await postDownloadsQueueWhenReady(pendingRequests)
      if (pendingRequests.length !== requests.length) {
        const combined = [...directResults]
        let j = 0
        for (let i = 0; i < combined.length; i++) if (!combined[i].ok && posted.results[j]) combined[i] = posted.results[j++]
        posted = { ok: combined.every((result) => result.ok), results: combined }
      }
      if (!posted.ok && surfacedWake) {
        logBg('download-media-fallback-bg-wake', { tabId })
        launchWakeToFocusApp(tabId, { force: true })
        const pending = requests.filter((_, i) => !posted.results[i]?.ok)
        const retry = await postDownloadsQueueWhenReady(pending)
        const combined = requests.map((_, i) => posted.results[i] || { ok: false, error: 'Not sent' })
        let retryIndex = 0
        for (let i = 0; i < combined.length; i++) if (!combined[i].ok && retry.results[retryIndex]) combined[i] = retry.results[retryIndex++]
        posted = { ok: combined.every((result) => result.ok), results: combined }
      }
      if (!posted.ok) {
        setLastDownloadError(
          'Could not queue download: app unreachable after wake. Check that V-Download is running.'
        )
      }
      sendResponse({
        ok: posted.ok,
        results: posted.results,
        error: posted.ok ? undefined : 'App is not running or did not accept the batch.'
      })
    })
    return true
  }

  // New: content overlay queries media for its specific frame, with tab-level fallback
  if (message.type === 'GET_FRAME_MEDIA') {
    pruneMedia()
    const tabId = sender.tab?.id
    const frameId = sender.frameId ?? 0
    if (!tabId) {
      sendResponse({ media: [], source: 'none', frameId })
      return true
    }
    const frameMedia = getFrameMedia(tabId, frameId)
    const tabMedia = getAllTabMedia(tabId)

    const mergedByKey = new Map()
    for (const m of frameMedia) {
      const key = `${MP.canonicalizeUrl(m.url)}|${m.type}`
      mergedByKey.set(key, m)
    }
    for (const m of tabMedia) {
      const key = `${MP.canonicalizeUrl(m.url)}|${m.type}`
      const prev = mergedByKey.get(key)
      if (!prev || (m.timestamp || 0) > (prev.timestamp || 0)) {
        mergedByKey.set(key, m)
      }
    }
    const media = MP.mergeCandidates(Array.from(mergedByKey.values()))

    let source = 'frame'
    if (frameMedia.length > 0 && tabMedia.length > 0) source = 'frame+tab'
    else if (frameMedia.length === 0 && tabMedia.length > 0) source = 'tab-fallback'
    else if (frameMedia.length === 0) source = 'none'

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
      url: safeLogUrl(item.url),
      referer: safeLogUrl(request.referer),
      title: (request.title || '').slice(0, 80)
    })

    let responded = false
    const safeSend = (payload) => {
      if (responded) return
      responded = true
      try {
        sendResponse(payload)
      } catch (e) {
        logBg('download-from-content-sendResponse-failed', { err: safeError(e) })
      }
    }

    ;(async () => {
      try {
        const cookiesOk = await syncCookies()
        logBg('download-from-content-sync-cookies', { cookiesOk })
        const res = await postAppJson('/download', request)
        logBg('download-from-content-fetch', { status: res.status, ok: res.ok })
        if (res.ok) {
          clearLastDownloadError()
          safeSend({ ok: true })
          return
        }
      } catch (e) {
        logBg('download-from-content-fetch-catch', { err: safeError(e) })
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
        if (ok) clearLastDownloadError()
        else {
          setLastDownloadError(
            'Could not send this stream to V-Download. Confirm the app is running and try again.'
          )
        }
        safeSend({ ok })
      } catch (err) {
        logBg('download-from-content-wake-catch', { err: safeError(err) })
        safeSend({ ok: false, error: 'Unable to send this stream. Please retry.' })
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
    const res = await postAppJson('/download', payload)
    if (res.ok) {
      clearLastDownloadError()
      return true
    }
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
  if (!ok) {
    setLastDownloadError('Could not open or reach V-Download from the extension.')
  } else {
    clearLastDownloadError()
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
    const appFetch = postAppJson('/cookies', allCookies)
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
    const poll = await fetch(`${APP_URL}/cookie-sync-poll?pair=1`)
    if (!poll.ok) return
    const data = await poll.json()
    if (typeof data.capability === 'string' && data.capability.length >= 32) { appCapability = data.capability; chrome.storage.local.set({ appCapability }) }
    if (!data.pending) return
    await syncCookies()
  } catch {
    // app not running
  }
}

chrome.runtime.onInstalled.addListener(() => {
  syncCookies()
  cleanupLastDownloadError()
})

chrome.runtime.onStartup.addListener(() => {
  syncCookies()
  cleanupLastDownloadError()
})

chrome.alarms.create('sync-cookies', { periodInMinutes: 5 })
chrome.alarms.create('cookie-sync-force-poll', { periodInMinutes: 1 })
chrome.alarms.create('last-download-error-gc', { periodInMinutes: 5 })
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'sync-cookies') {
    syncCookies()
  } else if (alarm.name === 'cookie-sync-force-poll') {
    void pollPendingCookieSync()
  } else if (alarm.name === 'last-download-error-gc') {
    cleanupLastDownloadError()
  }
})
