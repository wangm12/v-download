importScripts('cookie-sync-domains.js', 'media-patterns.js', 'download-transport.js')
const COOKIE_SYNC_DOMAINS = globalThis.COOKIE_SYNC_DOMAINS
const MP = globalThis.VDownloadMediaPatterns
const DT = globalThis.VDownloadDownloadTransport

const APP_URL = 'http://127.0.0.1:18765'
const APP_REQUEST_TIMEOUT_MS = 8_000
const APP_DOWNLOAD_TIMEOUT_MS = 2_500
const APP_PROBE_TIMEOUT_MS = 5_000
const LAST_DOWNLOAD_ERROR_TTL_MS = 10 * 60 * 1000
let appCapability = ''
let appCapabilityLoadPromise = Promise.resolve()
try {
  appCapabilityLoadPromise = new Promise((resolve) => {
    chrome.storage.local.get(['appCapability'], (v) => {
      if (!appCapability) appCapability = typeof v.appCapability === 'string' ? v.appCapability : ''
      resolve()
    })
  })
} catch {}
function appJsonHeaders() { return { 'Content-Type': 'application/json', 'X-VDownload-Capability': appCapability } }
async function fetchApp(path, init = {}, timeoutMs = APP_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(`${APP_URL}${path}`, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}
async function ensureCapability(force = false) {
  // Wait for the initial storage read before using a cached token. Without
  // this barrier, a stale callback can overwrite a freshly paired token while
  // the first download is already being posted.
  await appCapabilityLoadPromise
  if (force) appCapability = ''
  if (appCapability && !force) return true
  try {
    const poll = await fetchApp('/cookie-sync-poll?pair=1', {}, APP_PROBE_TIMEOUT_MS)
    if (!poll.ok) return false
    const data = await poll.json()
    if (typeof data.capability !== 'string' || data.capability.length < 32) return false
    appCapability = data.capability
    try {
      await chrome.storage.local.set({ appCapability })
    } catch {
      // The in-memory token is enough for the current request. Persistence is
      // best-effort and must not turn a successful handshake into HTTP 403.
    }
    return true
  } catch { return false }
}
async function postAppJson(path, body, options = {}) {
  const requestedMaxAttempts = Number.isInteger(options.maxAttempts) ? Math.max(1, options.maxAttempts) : 3
  let maxAttempts = requestedMaxAttempts
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(250, options.timeoutMs) : APP_REQUEST_TIMEOUT_MS
  let authRetryUsed = false
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // A cold-started development app can be listening before its pairing
    // probe is ready. Still send the request with the current in-memory
    // capability; dev mode authorizes the unpacked extension by origin and
    // packaged mode will return 403 and enter the forced refresh path below.
    await ensureCapability(false)
    try {
      const response = await fetchApp(path, { method: 'POST', headers: appJsonHeaders(), body: JSON.stringify(body) }, timeoutMs)
      if (response.status !== 401 && response.status !== 403 && !DT.isTransientStatus(response.status)) return response
      if (response.status === 401 || response.status === 403) {
        if (authRetryUsed || !(await ensureCapability(true))) return new Response(null, { status: 403 })
        authRetryUsed = true
        // Even a fast-path request with maxAttempts=1 gets one retry after
        // refreshing a stale pairing capability.
        if (attempt === maxAttempts - 1) maxAttempts++
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

const CONTENT_MEDIA_TYPES = new Set(['hls', 'dash', 'mpd', 'mp4', 'webm', 'flv', 'mkv', 'mp3', 'm4a', 'aac', 'opus', 'ogg', 'jpeg'])
function isSafeHttpUrl(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 8192) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
function isValidContentItem(item) {
  if (!item || typeof item !== 'object' || !isSafeHttpUrl(item.url)) return false
  if (item.type !== undefined && (typeof item.type !== 'string' || !CONTENT_MEDIA_TYPES.has(item.type.toLowerCase()))) return false
  if (item.pageUrl !== undefined && (!isSafeHttpUrl(item.pageUrl) || !isDouyinUrl(item.pageUrl))) return false
  if (item.quality !== undefined && (typeof item.quality !== 'string' || !/^(?:\d{1,4}|best)$/.test(item.quality))) return false
  if (item.autoStart !== undefined && typeof item.autoStart !== 'boolean') return false
  if (item.initiator !== undefined && typeof item.initiator !== 'string') return false
  if (item.title !== undefined && (typeof item.title !== 'string' || item.title.length > 512)) return false
  return true
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
      const ping = await fetchApp('/ping', {}, APP_PROBE_TIMEOUT_MS)
      if (ping.ok) {
        logBg('post-queue-ping-ok', { rid, attempt })
        for (let i = 0; i < requests.length; i++) {
          if (results[i].ok) continue
          const req = requests[i]
          try {
            const res = await postAppJson('/download', req, { maxAttempts: 2, timeoutMs: APP_DOWNLOAD_TIMEOUT_MS })
            const failure = res.ok ? null : DT.classifyFailure({ status: res.status })
            results[i] = { ok: res.ok, status: res.status, ...(failure || {}), error: res.ok ? undefined : `HTTP ${res.status}` }
            logBg('post-queue-download-post', { rid, i, status: res.status, ok: res.ok })
          } catch (error) {
            results[i] = { ok: false, status: null, ...DT.classifyFailure({ error }), error: 'Network request failed' }
            logBg('post-queue-download-catch', { rid, i, err: safeError(error) })
          }
        }
        const ok = results.every((result) => result.ok)
        logBg('post-queue-done', { rid, ok })
        if (ok) clearLastDownloadError()
        if (ok) return { ok, results }

        // A live /ping only means that the local server is listening. During
        // app startup its capability can still be refreshing, and a transient
        // POST failure must not be reported as a final no-op. Retry only when
        // the server classified the failure as retryable; invalid candidates
        // still fail immediately.
        const retryable = results.some((result) => {
          if (result.ok) return false
          if (result.retryable === true) return true
          return DT.shouldRetry({ status: result.status, attempt, maxAttempts })
        })
        if (!retryable || attempt === maxAttempts - 1) return { ok, results }
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

function postDownloadWhenAppReady(request, maxAttempts = 30, delayMs = 500) {
  return postDownloadsQueueWhenReady([request], maxAttempts, delayMs).then((result) => result.ok)
}

// tabMedia: Map<tabId, Map<frameId, Map<url, mediaEntry>>>
const tabMedia = new Map()
const MEDIA_CACHE_STORAGE_KEY = 'tabMediaCache'
let mediaCacheReady = false
let mediaCachePersistTimer = null

function storageSessionGet(key) {
  return new Promise((resolve) => {
    try {
      if (!chrome.storage.session?.get) { resolve({}); return }
      chrome.storage.session.get(key, (value) => resolve(value || {}))
    } catch {
      resolve({})
    }
  })
}

function storageSessionSet(value) {
  return new Promise((resolve) => {
    try {
      if (!chrome.storage.session?.set) { resolve(); return }
      chrome.storage.session.set(value, () => resolve())
    } catch {
      resolve()
    }
  })
}

function persistedMediaEntry(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.url !== 'string') return null
  const type = typeof raw.type === 'string' ? raw.type : MP.inferType(raw.url, raw.mime || raw.contentType)
  const entry = {
    url: raw.url,
    type,
    mime: typeof raw.mime === 'string' ? raw.mime : '',
    contentType: typeof raw.contentType === 'string' ? raw.contentType : '',
    size: Number.isFinite(Number(raw.size)) && Number(raw.size) > 0 ? Number(raw.size) : null,
    requestKind: typeof raw.requestKind === 'string' ? raw.requestKind : '',
    initiator: typeof raw.initiator === 'string' ? raw.initiator : '',
    pageUrl: typeof raw.pageUrl === 'string' ? raw.pageUrl : '',
    timestamp: Number.isFinite(Number(raw.timestamp)) ? Number(raw.timestamp) : 0,
    source: typeof raw.source === 'string' ? raw.source : 'network',
    confidence: Number.isFinite(Number(raw.confidence)) ? Number(raw.confidence) : 0,
  }
  return MP.isReliableCandidate(entry) ? entry : null
}

function serializeMediaCache() {
  const cache = {}
  for (const [tabId, frames] of tabMedia) {
    const serializedFrames = {}
    for (const [frameId, bucket] of frames) {
      serializedFrames[frameId] = Array.from(bucket.values()).map((entry) => ({
        url: entry.url,
        type: entry.type,
        mime: entry.mime || '',
        contentType: entry.contentType || '',
        size: entry.size || null,
        requestKind: entry.requestKind || '',
        initiator: entry.initiator || '',
        pageUrl: entry.pageUrl || '',
        timestamp: entry.timestamp || 0,
        source: entry.source || 'network',
        confidence: entry.confidence || 0,
      }))
    }
    cache[tabId] = serializedFrames
  }
  return cache
}

function scheduleMediaCachePersist() {
  if (!mediaCacheReady) return
  if (mediaCachePersistTimer) clearTimeout(mediaCachePersistTimer)
  mediaCachePersistTimer = setTimeout(() => {
    mediaCachePersistTimer = null
    void storageSessionSet({ [MEDIA_CACHE_STORAGE_KEY]: serializeMediaCache() })
  }, 250)
}

async function loadMediaCache() {
  const data = await storageSessionGet(MEDIA_CACHE_STORAGE_KEY)
  const saved = data?.[MEDIA_CACHE_STORAGE_KEY]
  if (saved && typeof saved === 'object') {
    for (const [tabKey, savedFrames] of Object.entries(saved)) {
      const tabId = Number(tabKey)
      if (!Number.isInteger(tabId) || !savedFrames || typeof savedFrames !== 'object') continue
      const frames = new Map()
      for (const [frameKey, savedEntries] of Object.entries(savedFrames)) {
        const frameId = Number(frameKey)
        if (!Number.isInteger(frameId) || !Array.isArray(savedEntries)) continue
        const bucket = new Map()
        for (const raw of savedEntries) {
          const entry = persistedMediaEntry(raw)
          if (entry) bucket.set(MP.canonicalizeUrl(entry.url), entry)
        }
        if (bucket.size) frames.set(frameId, bucket)
      }
      if (frames.size) tabMedia.set(tabId, frames)
    }
  }

  // Avoid retaining candidates for tabs that no longer exist after a browser
  // or extension restart. The session store survives a worker restart.
  try {
    const tabs = await chrome.tabs.query({})
    const openTabIds = new Set(tabs.map((tab) => tab.id).filter((id) => Number.isInteger(id)))
    for (const tabId of tabMedia.keys()) if (!openTabIds.has(tabId)) tabMedia.delete(tabId)
  } catch {
    /* best effort; TTL pruning still protects the cache */
  }

  pruneMedia()
  mediaCacheReady = true
  scheduleMediaCachePersist()
  try {
    const tabs = await chrome.tabs.query({})
    for (const tab of tabs) updateTabUI(tab)
  } catch {
    /* ignore startup badge refresh failures */
  }
}

const mediaCacheReadyPromise = loadMediaCache()
let lastClickTime = 0
let lastWakeBgAt = 0
const WAKE_DEBOUNCE_MS = 2000
const WAKE_TAB_RETENTION_MS = 6000

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
  scheduleMediaCachePersist()
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
  let changed = false
  for (const [tabId, frames] of tabMedia) {
    for (const [frameId, bucket] of frames) {
      for (const [url, entry] of bucket) {
        if ((entry.timestamp || 0) < cutoff) {
          bucket.delete(url)
          changed = true
        }
      }
      if (!bucket.size) {
        frames.delete(frameId)
        changed = true
      }
    }
    if (!frames.size) {
      tabMedia.delete(tabId)
      changed = true
    }
  }
  if (changed) scheduleMediaCachePersist()
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
    scheduleMediaCachePersist()
    updateBadge(tabId, 0)
  }
})

chrome.tabs.onRemoved.addListener((tabId) => {
  tabMedia.delete(tabId)
  scheduleMediaCachePersist()
})

function updateTabUI(tab) {
  if (!mediaCacheReady) {
    void mediaCacheReadyPromise.then(() => updateTabUI(tab))
    return
  }
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
    void mediaCacheReadyPromise.then(() => {
      if (details.tabId < 0) return
      if (isYouTubeUrl(details.url)) return
      if (isDouyinUrl(details.initiator || '') || isDouyinUrl(details.url)) return
      if (isXUrl(details.initiator || '') || /video\.twimg\.com/.test(details.url)) return
      if (details.statusCode < 200 || details.statusCode >= 400) return

      const mime = getHeader(details.responseHeaders, 'content-type') || ''
      const urlLooksMedia = /\.(m3u8|mpd|mp4|webm|flv|mkv|mp3|m4a|aac|opus|ogg)(?:[?#]|$)/i.test(details.url)
      const mimeLooksMedia = /^(?:video|audio)\//i.test(mime) || /mpegurl|dash\+xml/i.test(mime)
      if (details.type !== 'media' && !urlLooksMedia && !mimeLooksMedia) return
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
    })
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
    if (!isSafeHttpUrl(message.url)) {
      sendResponse({ ok: false, error: 'Invalid download URL' })
      return false
    }
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
      void mediaCacheReadyPromise.then(() => {
        const media = MP.mergeCandidates(getAllTabMedia(tabId))
        sendResponse({ media, tabUrl: tabs[0].url || '', tabTitle: tabs[0].title || '' })
      })
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
      const requests = items.map((item, i) => MP.isReliableCandidate(item) ? ({
        url: item.url,
        type: item.type,
        referer: isSafeHttpUrl(item.initiator) ? item.initiator : (isSafeHttpUrl(tabUrl) ? tabUrl : ''),
        title: items.length > 1 ? `${baseTitle} (${i + 1})` : baseTitle
      }) : null)
      const directResults = requests.map((request) => request ? ({ ok: false, status: null, error: 'Not sent' }) : ({ ok: false, status: 422, category: 'invalid-media-candidate', error: 'Invalid media candidate' }))
      const pendingIndexes = []
      try {
        for (let i = 0; i < requests.length; i++) {
          const request = requests[i]
          if (!request) continue
          let response
          try { response = await postAppJson('/download', request) } catch (error) {
            directResults[i] = { ok: false, status: null, category: DT.classifyFailure({ error }).category, error: 'Network request failed' }
            pendingIndexes.push(i)
            continue
          }
          const failure = response.ok ? null : DT.classifyFailure({ status: response.status })
          directResults[i] = { ok: response.ok, status: response.status, ...(failure || {}), error: response.ok ? undefined : `HTTP ${response.status}` }
          if (!response.ok && DT.shouldFallback({ status: response.status })) pendingIndexes.push(i)
        }
        const results = directResults
        if (results.every((result) => result.ok)) {
          clearLastDownloadError()
          sendResponse({ ok: true, results })
          return
        }
        if (pendingIndexes.length === 0) {
          sendResponse({ ok: false, partial: results.some((result) => result.ok), results, error: 'Some downloads were rejected by the app.' })
          return
        }
      } catch (error) {
        requests.forEach((request, i) => { if (request && !directResults[i].ok && !pendingIndexes.includes(i)) pendingIndexes.push(i) })
      }

      if (!surfacedWake) {
        launchWakeToFocusApp(tabId)
      }
      const pendingRequests = pendingIndexes.map((i) => requests[i])
      // A user-gesture protocol click is not proof that an app was launched.
      // Verify briefly, then return actionable feedback in dev where the
      // protocol is intentionally not registered. Background-launched
      // packaged wake keeps the normal cold-start retry window.
      // surfacedWake only proves that Chrome accepted the protocol URL; it
      // does not prove that the Electron server is ready. Keep the full cold
      // start window for both paths.
      const wakeAttempts = 48
      let posted = await postDownloadsQueueWhenReady(pendingRequests, wakeAttempts)
      let combined = DT.mergeRetryResults(directResults, pendingIndexes, posted.results)
      posted = { ok: combined.every((result) => result.ok), results: combined }
      if (!posted.ok) {
        setLastDownloadError(
          'Could not queue download after wake. Start the V-Download desktop app (make-dev does not register vdownload://), then retry.'
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
    void mediaCacheReadyPromise.then(() => {
      pruneMedia()
      const tabId = sender.tab?.id
      const frameId = sender.frameId ?? 0
      if (!tabId) {
        sendResponse({ media: [], source: 'none', frameId })
        return
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
        isYouTube: isYouTubeUrl(sender.tab?.url || ''),
        pageTitle: sender.tab?.title || ''
      })
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

    if (!isValidContentItem(item)) {
      logBg('download-from-content-bad-item', { tabId, hasItem: !!item })
      sendResponse({ ok: false, error: 'Invalid media item' })
      return false
    }

    const referer = isSafeHttpUrl(item.initiator) ? item.initiator : (isSafeHttpUrl(tabUrl) ? tabUrl : '')
    const title = (item.title && String(item.title).trim()) || tabTitle
    const pageUrl = isSafeHttpUrl(item.pageUrl) && isDouyinUrl(item.pageUrl) ? item.pageUrl : ''
    const request = pageUrl
      ? {
          url: pageUrl,
          quality: item.quality || undefined,
          autoStart: item.autoStart === true,
          referer,
          title
        }
      : {
          url: item.url,
          type: item.type,
          referer,
          title
        }

    logBg('download-from-content-start', {
      tabId,
      type: pageUrl ? 'page' : item.type,
      url: safeLogUrl(pageUrl || item.url),
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
        const res = await postAppJson('/download', request, { maxAttempts: 2, timeoutMs: APP_DOWNLOAD_TIMEOUT_MS })
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
        logBg('download-from-content-cold-wake', { tabId, surfacedWake, wakeOwnedByCaller: surfacedWake === true })
        if (!surfacedWake) {
          launchWakeToFocusApp(tabId)
        }
        // The user-gesture wake can launch Electron asynchronously. Wait for
        // the same full startup window instead of returning a silent failure
        // after six seconds.
        const queued = await postDownloadsQueueWhenReady([request], 48)
        const ok = queued.ok
        const failure = queued.results?.find((result) => !result.ok)
        logBg('download-from-content-after-wake', { ok, status: failure?.status ?? null, category: failure?.category || '' })
        if (ok) clearLastDownloadError()
        else {
          setLastDownloadError(
            'Could not send this stream to V-Download. Confirm the app is running and try again.'
          )
        }
        const error = failure?.category === 'authorization-required'
          ? 'V-Download rejected this Chrome extension. Reload the extension or install the matching extension folder, then retry.'
          : failure?.error || 'App is not running or did not accept the media.'
        safeSend({ ok, error: ok ? undefined : error })
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
    const res = await postAppJson('/download', payload, { maxAttempts: 2, timeoutMs: APP_DOWNLOAD_TIMEOUT_MS })
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
  let ok = await postDownloadsQueueWhenReady([payload], 48).then((result) => result.ok)
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
      logBg('launch-wake-protocol-unavailable', {
        err: chrome.runtime.lastError?.message,
        tabId
      })
      return
    }
    logBg('launch-wake-tab-created', { newTabId: created.id })
    const id = created.id
    setTimeout(() => {
      chrome.tabs.remove(id, () => void chrome.runtime.lastError)
    }, WAKE_TAB_RETENTION_MS)
  })
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

    const response = await postAppJson('/cookies', allCookies)

    console.log(`Synced ${allCookies.length} cookies across ${COOKIE_SYNC_DOMAINS.length} domains`)
    return response.ok
  } catch {
    return false
  }
}

async function pollPendingCookieSync() {
  try {
    const poll = await fetchApp('/cookie-sync-poll?pair=1', {}, APP_PROBE_TIMEOUT_MS)
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
  cleanupLastDownloadError()
})

chrome.runtime.onStartup.addListener(() => {
  cleanupLastDownloadError()
})

// Cookie sync is intentionally user-triggered. Keep only the lightweight
// pending-pair poll so the desktop app can wait for an explicit request.
chrome.alarms.create('cookie-sync-force-poll', { periodInMinutes: 1 })
chrome.alarms.create('last-download-error-gc', { periodInMinutes: 5 })
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'cookie-sync-force-poll') {
    void pollPendingCookieSync()
  } else if (alarm.name === 'last-download-error-gc') {
    cleanupLastDownloadError()
  }
})
