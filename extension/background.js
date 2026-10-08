importScripts('cookie-sync-domains.js', 'media-patterns.js', 'download-transport.js', 'douyin-policy.js')
const COOKIE_SYNC_DOMAINS = globalThis.COOKIE_SYNC_DOMAINS
const MP = globalThis.VDownloadMediaPatterns
const DT = globalThis.VDownloadDownloadTransport
const DP = globalThis.VDownloadDouyinPolicy

const APP_URL = 'http://127.0.0.1:18765'
const APP_REQUEST_TIMEOUT_MS = 8_000
const APP_DOWNLOAD_TIMEOUT_MS = 2_500
const APP_PROBE_TIMEOUT_MS = 5_000
const APP_RESPONSE_MAX_BYTES = 8 * 1024 * 1024
const MAX_APP_STARTUP_WAIT_MS = 4 * 60 * 1000
const APP_POST_COMPLETION_RESERVE_MS = 30_000
const MAX_APP_STARTUP_ATTEMPTS = Math.ceil(MAX_APP_STARTUP_WAIT_MS / 500)
const DOWNLOAD_BATCH_INITIAL_ATTEMPT_MS = 60_000
const LAST_DOWNLOAD_ERROR_TTL_MS = 10 * 60 * 1000
const DOUYIN_PROFILE_IMPORT_TTL_MS = 150_000
const DOUYIN_POST_UNAVAILABLE_ERROR = 'Douyin reports this post is unavailable or has been removed for the current account.'
let appCapability = ''
let appCapabilityLoadPromise = Promise.resolve()
let appCapabilityPairPromise = null
let appCapabilityStorageWrites = Promise.resolve()
const pendingDouyinProfileImports = new Map()
const PENDING_DOUYIN_PROFILE_IMPORTS_KEY = 'pendingDouyinProfileImports'
let pendingDouyinProfileImportsLoaded = false
let pendingDouyinProfileImportsLoadPromise = null
let pendingDouyinProfileImportWrites = Promise.resolve()
let pendingDouyinProfileImportsRecoveryPromise = null
let pendingDouyinProfileCleanupTimer = null
const pendingDouyinResolves = new Map()
const PENDING_DOUYIN_RESOLVES_KEY = 'pendingDouyinResolves'
let pendingDouyinResolvesLoaded = false
let pendingDouyinResolvesLoadPromise = null
let pendingDouyinResolveWrites = Promise.resolve()
let pendingDouyinResolvesRecoveryPromise = null
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
    const response = await fetch(`${APP_URL}${path}`, { ...init, signal: controller.signal })
    const body = await readAppResponseBody(response)
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  } finally {
    clearTimeout(timer)
  }
}

async function readAppResponseBody(response) {
  if (!response.body) return null
  const reader = response.body.getReader()
  const chunks = []
  let totalBytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > APP_RESPONSE_MAX_BYTES) {
        await reader.cancel()
        throw new Error('Local app response exceeded the size limit')
      }
      chunks.push(value)
    }
  } catch (error) {
    try { void reader.cancel() } catch {}
    throw error
  }
  if (!totalBytes) return null
  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}
async function ensureCapability(force = false) {
  // Wait for the initial storage read before using a cached token. Without
  // this barrier, a stale callback can overwrite a freshly paired token while
  // the first download is already being posted.
  await appCapabilityLoadPromise
  if (appCapability && !force) return true
  if (appCapabilityPairPromise) return appCapabilityPairPromise
  if (force) appCapability = ''
  const pairing = (async () => {
  try {
    let response = await fetchApp('/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    }, APP_PROBE_TIMEOUT_MS)
    logBg('pairing-fetch', { method: 'POST', path: '/pair', status: response.status, ok: response.ok })
    if (!response.ok) {
      // Keep compatibility with older desktop builds while the extension is
      // reloaded independently of the packaged app.
      response = await fetchApp('/cookie-sync-poll?pair=1', {}, APP_PROBE_TIMEOUT_MS)
      logBg('pairing-fetch-fallback', { method: 'GET', path: '/cookie-sync-poll', status: response.status, ok: response.ok })
    }
    if (!response.ok) return false
    const data = await response.json()
    if (typeof data.capability !== 'string' || data.capability.length < 32) return false
    await persistAppCapability(data.capability)
    return true
  } catch (error) {
    logBg('pairing-fetch-catch', { err: safeError(error) })
    return false
  }
  })()
  appCapabilityPairPromise = pairing
  try {
    return await pairing
  } finally {
    if (appCapabilityPairPromise === pairing) appCapabilityPairPromise = null
  }
}

function persistAppCapability(value) {
  appCapability = value
  const write = appCapabilityStorageWrites.catch(() => {}).then(() => new Promise((resolve) => {
    try {
      chrome.storage.local.set({ appCapability: value }, () => {
        if (chrome.runtime.lastError) logBg('pairing-persist-failed', { persisted: false })
        resolve()
      })
    } catch {
      logBg('pairing-persist-failed', { persisted: false })
      resolve()
    }
  }))
  appCapabilityStorageWrites = write.catch(() => {})
  return write
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

function douyinProfileSecUid(value) {
  if (typeof value !== 'string' || value.length > 8192) return ''
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    if (host !== 'douyin.com' && !host.endsWith('.douyin.com')) return ''
    const match = url.pathname.match(/\/user\/([^/?#]+)/i)
    return match?.[1] ? decodeURIComponent(match[1]) : ''
  } catch {
    return ''
  }
}

function isDouyinProfileTab(tab, secUid) {
  return Boolean(Number.isInteger(tab?.id) && secUid && douyinProfileSecUid(tab.url || '') === secUid)
}

function normalizeDouyinProfileImportCommand(raw) {
  if (!raw || typeof raw !== 'object' || raw.pending !== true) return null
  const requestId = String(raw.requestId || '').trim()
  const profileUrl = String(raw.profileUrl || '').trim()
  const secUid = douyinProfileSecUid(profileUrl)
  if (!/^[a-f0-9]{20,80}$/i.test(requestId) || !secUid) return null
  const existingAwemeIds = Array.isArray(raw.existingAwemeIds)
    ? Array.from(new Set(raw.existingAwemeIds.map((id) => String(id).trim()).filter((id) => /^\d{10,32}$/.test(id)))).slice(0, 2000)
    : []
  return {
    requestId,
    profileUrl,
    secUid,
    existingAwemeIds,
    maxScrolls: Number.isInteger(raw.maxScrolls) ? Math.max(8, Math.min(120, raw.maxScrolls)) : 96,
    idleRounds: Number.isInteger(raw.idleRounds) ? Math.max(2, Math.min(10, raw.idleRounds)) : 5,
    expiresAt: Number.isFinite(Number(raw.expiresAt)) && Number(raw.expiresAt) > 0
      ? Number(raw.expiresAt)
      : Date.now() + DOUYIN_PROFILE_IMPORT_TTL_MS,
    sentTabId: Number.isInteger(raw.sentTabId) ? raw.sentTabId : null,
    sentDispatched: raw.sentDispatched === true,
    dispatchPromise: null,
    resultPayload: raw.resultPayload && typeof raw.resultPayload === 'object' ? raw.resultPayload : null,
    resultAttempts: Number.isInteger(raw.resultAttempts) ? Math.max(0, raw.resultAttempts) : 0,
    resultTimer: null,
    resultPromise: null,
  }
}

function douyinProfileImportStorageArea() {
  try {
    if (chrome.storage.session?.get && chrome.storage.session?.set) return chrome.storage.session
  } catch {
    /* Older Chrome builds may not expose storage.session. */
  }
  return chrome.storage.local
}

function readDouyinProfileImportStorage() {
  return new Promise((resolve) => {
    try {
      const area = douyinProfileImportStorageArea()
      area.get([PENDING_DOUYIN_PROFILE_IMPORTS_KEY], (value) => resolve(value?.[PENDING_DOUYIN_PROFILE_IMPORTS_KEY]))
    } catch {
      resolve(null)
    }
  })
}

function writeDouyinProfileImportStorage(records) {
  return new Promise((resolve) => {
    try {
      const area = douyinProfileImportStorageArea()
      area.set({ [PENDING_DOUYIN_PROFILE_IMPORTS_KEY]: records }, () => resolve())
    } catch {
      resolve()
    }
  })
}

function readDouyinResolveStorage() {
  return new Promise((resolve) => {
    try {
      const area = douyinProfileImportStorageArea()
      area.get([PENDING_DOUYIN_RESOLVES_KEY], (value) => resolve(value?.[PENDING_DOUYIN_RESOLVES_KEY]))
    } catch {
      resolve(null)
    }
  })
}

function writeDouyinResolveStorage(records) {
  return new Promise((resolve) => {
    try {
      const area = douyinProfileImportStorageArea()
      area.set({ [PENDING_DOUYIN_RESOLVES_KEY]: records }, () => resolve())
    } catch {
      resolve()
    }
  })
}

async function hydratePendingDouyinProfileImports() {
  if (pendingDouyinProfileImportsLoaded) return
  if (!pendingDouyinProfileImportsLoadPromise) {
    pendingDouyinProfileImportsLoadPromise = (async () => {
      const saved = await readDouyinProfileImportStorage()
      const now = Date.now()
      if (Array.isArray(saved)) {
        for (const raw of saved) {
          const expiresAt = Number(raw?.expiresAt || 0)
          if (!Number.isFinite(expiresAt) || expiresAt <= now) continue
          const command = normalizeDouyinProfileImportCommand({ ...raw, pending: true })
          if (command) pendingDouyinProfileImports.set(command.requestId, command)
        }
      }
      pendingDouyinProfileImportsLoaded = true
      for (const command of pendingDouyinProfileImports.values()) {
        if (command.resultPayload) scheduleDouyinProfileResultRetry(command)
      }
    })().finally(() => {
      pendingDouyinProfileImportsLoadPromise = null
    })
  }
  await pendingDouyinProfileImportsLoadPromise
  prunePendingDouyinProfileImports()
  schedulePendingDouyinProfileCleanup()
  if (!pendingDouyinProfileImportsRecoveryPromise) {
    pendingDouyinProfileImportsRecoveryPromise = recoverPendingDouyinProfileImports().catch((error) => {
      logBg('douyin-profile-import-recovery-failed', { err: safeError(error) })
    })
  }
}

function prunePendingDouyinProfileImports(now = Date.now()) {
  let changed = false
  for (const [requestId, command] of pendingDouyinProfileImports) {
    if (Number.isFinite(command.expiresAt) && command.expiresAt > now) continue
    if (command.resultTimer) clearTimeout(command.resultTimer)
    pendingDouyinProfileImports.delete(requestId)
    changed = true
  }
  if (changed) void persistPendingDouyinProfileImports()
  return changed
}

function schedulePendingDouyinProfileCleanup() {
  if (pendingDouyinProfileCleanupTimer) clearTimeout(pendingDouyinProfileCleanupTimer)
  pendingDouyinProfileCleanupTimer = null
  let nextExpiry = Infinity
  for (const command of pendingDouyinProfileImports.values()) {
    if (command.expiresAt < nextExpiry) nextExpiry = command.expiresAt
  }
  if (!Number.isFinite(nextExpiry)) return
  pendingDouyinProfileCleanupTimer = setTimeout(() => {
    pendingDouyinProfileCleanupTimer = null
    prunePendingDouyinProfileImports()
    schedulePendingDouyinProfileCleanup()
  }, Math.max(1, nextExpiry - Date.now() + 1))
}

async function recoverPendingDouyinProfileImports() {
  const commands = Array.from(pendingDouyinProfileImports.values()).filter((command) =>
    !command.resultPayload && !command.sentDispatched && command.expiresAt > Date.now()
  )
  if (!commands.length) return
  const tabs = await new Promise((resolve) => {
    try {
      chrome.tabs.query({}, (result) => resolve(Array.isArray(result) ? result : []))
    } catch {
      resolve([])
    }
  })
  for (const command of commands) {
    if (pendingDouyinProfileImports.get(command.requestId) !== command || command.expiresAt <= Date.now()) continue
    const savedTab = tabs.find((tab) => tab.id === command.sentTabId && isDouyinProfileTab(tab, command.secUid))
    const matchingTab = savedTab || tabs.find((tab) => isDouyinProfileTab(tab, command.secUid))
    if (matchingTab?.id !== undefined) {
      await sendDouyinProfileImportToTab(matchingTab.id, command)
      continue
    }
    if (command.sentTabId !== null) {
      command.sentTabId = null
      command.sentDispatched = false
      await persistPendingDouyinProfileImports()
    }
    await dispatchDouyinProfileImport(command)
  }
}

function persistPendingDouyinProfileImports() {
  const records = Array.from(pendingDouyinProfileImports.values()).map((command) => ({
    requestId: command.requestId,
    profileUrl: command.profileUrl,
    existingAwemeIds: command.existingAwemeIds,
    maxScrolls: command.maxScrolls,
    idleRounds: command.idleRounds,
    expiresAt: command.expiresAt,
    sentTabId: command.sentTabId,
    sentDispatched: command.sentDispatched === true,
    resultPayload: command.resultPayload || undefined,
    resultAttempts: command.resultAttempts || 0,
  }))
  const write = pendingDouyinProfileImportWrites
    .catch(() => {})
    .then(() => writeDouyinProfileImportStorage(records))
  pendingDouyinProfileImportWrites = write.catch(() => {})
  return write
}

async function hydratePendingDouyinResolves() {
  if (pendingDouyinResolvesLoaded) return
  if (!pendingDouyinResolvesLoadPromise) {
    pendingDouyinResolvesLoadPromise = (async () => {
      const saved = await readDouyinResolveStorage()
      const now = Date.now()
      let discardedExpired = false
      const expiredOwnedTabs = []
      if (Array.isArray(saved)) {
        for (const raw of saved) {
          const command = normalizeDouyinResolveCommand({ ...raw, pending: true })
          if (!command) continue
          command.sentTabId = Number.isInteger(raw?.sentTabId) ? raw.sentTabId : null
          command.sentDispatched = raw?.sentDispatched === true
          command.targetTabId = Number.isInteger(raw?.targetTabId) ? raw.targetTabId : null
          command.openedByResolver = raw?.openedByResolver === true
          const expiresAt = Number(raw?.expiresAt || 0)
          if (!Number.isFinite(expiresAt) || expiresAt <= now) {
            discardedExpired = true
            if (command.openedByResolver && Number.isInteger(command.targetTabId)) {
              expiredOwnedTabs.push(command)
            }
            continue
          }
          const entry = {
            command,
            timer: null,
            resultRetryTimer: null,
            expiresAt,
            probingPageState: false,
            settlingPromise: null,
            dispatchWaiter: null,
            dispatchStartPromise: null,
            acknowledgementPromise: null,
            acknowledged: raw?.acknowledged === true,
            resultPayload: raw?.resultPayload && typeof raw.resultPayload === 'object' ? raw.resultPayload : null,
            resultAttempts: Number.isInteger(raw?.resultAttempts) ? Math.max(0, raw.resultAttempts) : 0,
            dispatchPromise: null,
          }
          pendingDouyinResolves.set(command.requestId, entry)
        }
      }
      pendingDouyinResolvesLoaded = true
      for (const entry of pendingDouyinResolves.values()) {
        scheduleDouyinResolveTimeout(entry)
      }
      // Load every still-valid occupant before transferring or closing tabs
      // owned by expired records. Otherwise an expired sibling could close a
      // resolver tab that a live request is still using.
      for (const command of expiredOwnedTabs) {
        await restoreDouyinResolveTab(command)
      }
      if (discardedExpired) await persistPendingDouyinResolves()
    })().finally(() => {
      pendingDouyinResolvesLoadPromise = null
    })
  }
  await pendingDouyinResolvesLoadPromise
  if (!pendingDouyinResolvesRecoveryPromise) {
    pendingDouyinResolvesRecoveryPromise = recoverPendingDouyinResolves().catch((error) => {
      logBg('douyin-resolve-recovery-failed', { err: safeError(error) })
    })
  }
}

function persistPendingDouyinResolves() {
  const records = Array.from(pendingDouyinResolves.values()).map((entry) => ({
    requestId: entry.command.requestId,
    url: entry.command.url,
    awemeId: entry.command.awemeId,
    sentTabId: entry.command.sentTabId,
    sentDispatched: entry.command.sentDispatched === true,
    targetTabId: entry.command.targetTabId,
    openedByResolver: entry.command.openedByResolver,
    acknowledged: entry.acknowledged === true,
    expiresAt: entry.expiresAt,
    resultPayload: entry.resultPayload || undefined,
    resultAttempts: entry.resultAttempts || 0,
    pending: true,
  }))
  const write = pendingDouyinResolveWrites
    .catch(() => {})
    .then(() => writeDouyinResolveStorage(records))
  pendingDouyinResolveWrites = write.catch(() => {})
  return write
}

async function fetchDouyinProfileImportCommand(requestId, inlineCommand) {
  await hydratePendingDouyinProfileImports()
  prunePendingDouyinProfileImports()
  const supplied = normalizeDouyinProfileImportCommand(
    inlineCommand && typeof inlineCommand === 'object'
      ? { ...inlineCommand, pending: true }
      : null
  )
  if (supplied?.requestId === requestId && supplied.expiresAt > Date.now()) {
    pendingDouyinProfileImports.set(supplied.requestId, supplied)
    schedulePendingDouyinProfileCleanup()
    persistPendingDouyinProfileImports()
    return supplied
  }
  const cached = pendingDouyinProfileImports.get(requestId)
  if (cached) return cached
  try {
    await ensureCapability(false)
    let response = await fetchApp(`/douyin-profile-import-poll?requestId=${encodeURIComponent(requestId)}`, {
      headers: appJsonHeaders()
    }, APP_REQUEST_TIMEOUT_MS)
    if (response.status === 401 || response.status === 403) {
      if (!(await ensureCapability(true))) return null
      response = await fetchApp(`/douyin-profile-import-poll?requestId=${encodeURIComponent(requestId)}`, {
        headers: appJsonHeaders()
      }, APP_REQUEST_TIMEOUT_MS)
    }
    if (!response.ok) return null
    const raw = await response.json()
    const command = normalizeDouyinProfileImportCommand(raw)
    if (!command || command.expiresAt <= Date.now()) return null
    pendingDouyinProfileImports.set(command.requestId, command)
    schedulePendingDouyinProfileCleanup()
    persistPendingDouyinProfileImports()
    return command
  } catch (error) {
    logBg('douyin-profile-import-poll-failed', { err: safeError(error) })
    return null
  }
}

async function sendDouyinProfileImportToTab(tabId, command) {
  prunePendingDouyinProfileImports()
  if (!Number.isInteger(tabId) || command.expiresAt <= Date.now()) return false
  if (command.resultPayload) return true
  if (command.dispatchPromise) return await command.dispatchPromise
  if (command.sentTabId !== null && command.sentDispatched) return command.sentTabId === tabId
  if (command.sentTabId !== null && command.sentTabId !== tabId) return false
  command.sentTabId = tabId
  command.sentDispatched = false
  const dispatch = (async () => {
    await persistPendingDouyinProfileImports()
    return await new Promise((resolve) => {
      try {
        chrome.tabs.update(tabId, { active: true }, () => void chrome.runtime.lastError)
        chrome.tabs.sendMessage(tabId, {
          type: 'START_DOUYIN_PROFILE_IMPORT',
          command: {
            requestId: command.requestId,
            profileUrl: command.profileUrl,
            existingAwemeIds: command.existingAwemeIds,
            maxScrolls: command.maxScrolls,
            idleRounds: command.idleRounds
          }
        }, { frameId: 0 }, async () => {
          if (chrome.runtime.lastError) {
            if (command.sentTabId === tabId) command.sentTabId = null
            command.sentDispatched = false
            await persistPendingDouyinProfileImports()
            logBg('douyin-profile-import-send-failed', { tabId })
            resolve(false)
            return
          }
          command.sentDispatched = true
          await persistPendingDouyinProfileImports()
          resolve(true)
        })
      } catch (error) {
        command.sentTabId = null
        command.sentDispatched = false
        void persistPendingDouyinProfileImports()
        logBg('douyin-profile-import-send-throw', { tabId, err: safeError(error) })
        resolve(false)
      }
    })
  })()
  command.dispatchPromise = dispatch
  try {
    return await dispatch
  } finally {
    if (command.dispatchPromise === dispatch) command.dispatchPromise = null
  }
}

async function dispatchDouyinProfileImport(command) {
  prunePendingDouyinProfileImports()
  if (command.expiresAt <= Date.now() || command.resultPayload) return false
  if (command.sentTabId !== null && command.sentDispatched) return true
  const tabs = await new Promise((resolve) => {
    chrome.tabs.query({}, (result) => resolve(Array.isArray(result) ? result : []))
  })
  const existing = tabs.find((tab) => isDouyinProfileTab(tab, command.secUid))
  if (existing?.id !== undefined) return await sendDouyinProfileImportToTab(existing.id, command)

  return await new Promise((resolve) => {
    chrome.tabs.create({ url: command.profileUrl, active: true }, (tab) => {
      if (chrome.runtime.lastError || tab?.id === undefined) {
        logBg('douyin-profile-import-tab-create-failed', {})
        resolve(false)
        return
      }
      // The content script sends a ready message after the profile document is loaded.
      resolve(true)
    })
  })
}

async function routeDouyinProfileReady(tabId, url) {
  await hydratePendingDouyinProfileImports()
  prunePendingDouyinProfileImports()
  const secUid = douyinProfileSecUid(url)
  if (!secUid) return false
  for (const command of pendingDouyinProfileImports.values()) {
    if (command.expiresAt > Date.now() && !command.resultPayload && command.secUid === secUid) {
      return await sendDouyinProfileImportToTab(tabId, command)
    }
  }
  return false
}

async function postDouyinProfileImportResult(message) {
  await hydratePendingDouyinProfileImports()
  const requestId = String(message?.requestId || '').trim()
  if (!/^[a-f0-9]{20,80}$/i.test(requestId)) return { ok: false, error: 'Invalid profile import request' }
  const payload = {
    requestId,
    ok: message?.ok === true,
    items: Array.isArray(message?.items) ? message.items.slice(0, 2000) : [],
    warnings: Array.isArray(message?.warnings) ? message.warnings.slice(0, 4) : [],
    error: typeof message?.error === 'string' ? message.error.slice(0, 512) : ''
  }
  const command = pendingDouyinProfileImports.get(requestId)
  if (command?.resultPromise) return await command.resultPromise
  const stablePayload = command?.resultPayload || payload
  if (command && !command.resultPayload) {
    command.resultPayload = stablePayload
    await persistPendingDouyinProfileImports()
  }

  const settle = async () => {
    let outcome = { ok: false, error: 'Could not deliver the Douyin profile result.' }
    let terminal = false
    try {
      const response = await postAppJson('/douyin-profile-import-result', stablePayload, {
        maxAttempts: 2,
        timeoutMs: APP_DOWNLOAD_TIMEOUT_MS,
      })
      outcome = { ok: response.ok, error: response.ok ? undefined : `HTTP ${response.status}` }
      terminal = response.ok || response.status === 404 || (response.status >= 400 && response.status < 500)
    } catch (error) {
      outcome = { ok: false, error: safeError(error).message }
    }

    if (command && pendingDouyinProfileImports.get(requestId) === command) {
      if (terminal || Date.now() >= command.expiresAt) {
        if (command.resultTimer) clearTimeout(command.resultTimer)
        pendingDouyinProfileImports.delete(requestId)
        await persistPendingDouyinProfileImports()
        schedulePendingDouyinProfileCleanup()
      } else {
        command.resultAttempts += 1
        scheduleDouyinProfileResultRetry(command)
        await persistPendingDouyinProfileImports()
      }
    }
    return outcome
  }
  const promise = settle()
  if (command) command.resultPromise = promise
  try {
    return await promise
  } finally {
    if (command?.resultPromise === promise) command.resultPromise = null
  }
}

function scheduleDouyinProfileResultRetry(command) {
  if (command.resultTimer) clearTimeout(command.resultTimer)
  const delay = Math.min(5_000, 500 * (2 ** Math.min(4, command.resultAttempts || 0)))
  command.resultTimer = setTimeout(() => {
    command.resultTimer = null
    if (command.resultPayload) void postDouyinProfileImportResult(command.resultPayload)
  }, Math.min(delay, Math.max(0, command.expiresAt - Date.now())))
}

// --- One-shot Douyin page resolver -----------------------------------------

function douyinResolveAwemeId(value) {
  if (typeof value !== 'string' || value.length > 8192) return ''
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    if (host !== 'douyin.com' && !host.endsWith('.douyin.com') && host !== 'iesdouyin.com' && !host.endsWith('.iesdouyin.com')) return ''
    const match = url.pathname.match(/\/(?:note|video|gallery|share\/(?:note|video))\/(\d{10,32})/i)
    return match?.[1] || ''
  } catch {
    return ''
  }
}

function isDouyinResolveTab(tab, awemeId) {
  return Boolean(Number.isInteger(tab?.id) && awemeId && douyinResolveAwemeId(tab.url || '') === awemeId)
}

function normalizeDouyinResolveCommand(raw) {
  if (!raw || typeof raw !== 'object' || raw.pending !== true) return null
  const requestId = String(raw.requestId || '').trim()
  const url = String(raw.url || '').trim()
  const awemeId = String(raw.awemeId || '').trim() || douyinResolveAwemeId(url)
  if (!/^[a-f0-9]{20,80}$/i.test(requestId) || !isSafeHttpUrl(url) || !isDouyinUrl(url) || !/^\d{10,32}$/.test(awemeId)) return null
  return {
    requestId,
    url,
    awemeId,
    sentTabId: null,
    sentDispatched: false,
    dispatchPromise: null,
    targetTabId: null,
    openedByResolver: false,
    probingPageState: false,
    expiresAt: Number.isFinite(Number(raw.expiresAt)) ? Number(raw.expiresAt) : 0,
  }
}

function clearDouyinResolveCommand(requestId) {
  const entry = pendingDouyinResolves.get(requestId)
  if (!entry) return null
  if (entry.timer) clearTimeout(entry.timer)
  if (entry.resultRetryTimer) clearTimeout(entry.resultRetryTimer)
  pendingDouyinResolves.delete(requestId)
  if (entry.dispatchWaiter) resolveDouyinDispatchWaiter(entry, { ok: false })
  void persistPendingDouyinResolves()
  return entry.command
}

function resolveDouyinDispatchWaiter(entry, result) {
  if (!entry?.dispatchWaiter) return
  const waiter = entry.dispatchWaiter
  entry.dispatchWaiter = null
  if (waiter.timer) clearTimeout(waiter.timer)
  waiter.resolve(result)
}

function waitForDouyinResolveDispatch(entry, timeoutMs = 12_000) {
  if (!entry) return Promise.resolve({ ok: false })
  if (entry.dispatchWaiter) return entry.dispatchWaiter.promise
  let resolve
  const promise = new Promise((done) => { resolve = done })
  const waiter = { promise, resolve, timer: null }
  entry.dispatchWaiter = waiter
  waiter.timer = setTimeout(() => resolveDouyinDispatchWaiter(entry, { ok: false }), timeoutMs)
  return promise
}

function scheduleDouyinResolveTimeout(entry) {
  if (entry.timer) clearTimeout(entry.timer)
  const delay = Math.max(0, entry.expiresAt - Date.now())
  entry.timer = setTimeout(() => {
    if (pendingDouyinResolves.get(entry.command.requestId) !== entry) return
    void postDouyinResolveResult({
      requestId: entry.command.requestId,
      ok: false,
      awemeId: entry.command.awemeId,
      error: 'Douyin page did not return media information in time.'
    })
  }, delay)
}

async function rememberDouyinResolveCommand(command) {
  await hydratePendingDouyinResolves()
  const existing = pendingDouyinResolves.get(command.requestId)
  if (existing) return existing.command
  const entry = {
    command,
    timer: null,
    resultRetryTimer: null,
    expiresAt: Date.now() + 35_000,
    probingPageState: false,
    settlingPromise: null,
    dispatchWaiter: null,
    dispatchStartPromise: null,
    acknowledgementPromise: null,
    acknowledged: false,
    resultPayload: null,
    resultAttempts: 0,
  }
  command.expiresAt = entry.expiresAt
  pendingDouyinResolves.set(command.requestId, entry)
  scheduleDouyinResolveTimeout(entry)
  await persistPendingDouyinResolves()
  return command
}

async function fetchDouyinResolveCommand(requestId, inlineCommand) {
  await hydratePendingDouyinResolves()
  const cached = pendingDouyinResolves.get(requestId)
  if (cached) return cached.command
  const supplied = normalizeDouyinResolveCommand(
    inlineCommand && typeof inlineCommand === 'object'
      ? { ...inlineCommand, pending: true }
      : null
  )
  if (supplied?.requestId === requestId) return await rememberDouyinResolveCommand(supplied)

  try {
    await ensureCapability(false)
    let response = await fetchApp(`/douyin-resolve-poll?requestId=${encodeURIComponent(requestId)}`, {
      headers: appJsonHeaders()
    }, APP_REQUEST_TIMEOUT_MS)
    if (response.status === 401 || response.status === 403) {
      if (!(await ensureCapability(true))) return null
      response = await fetchApp(`/douyin-resolve-poll?requestId=${encodeURIComponent(requestId)}`, {
        headers: appJsonHeaders()
      }, APP_REQUEST_TIMEOUT_MS)
    }
    if (!response.ok) return null
    const command = normalizeDouyinResolveCommand(await response.json())
    return command ? await rememberDouyinResolveCommand(command) : null
  } catch (error) {
    logBg('douyin-resolve-poll-failed', { err: safeError(error) })
    return null
  }
}

function updateDouyinResolveTabMute(tabId, muted) {
  return new Promise((resolve) => {
    if (!Number.isInteger(tabId)) { resolve(false); return }
    try {
      chrome.tabs.update(tabId, { muted: muted === true }, () => {
        resolve(!chrome.runtime.lastError)
      })
    } catch {
      resolve(false)
    }
  })
}

async function bindDouyinResolveTab(command, tabId, openedByResolver) {
  if (!Number.isInteger(tabId)) return false
  command.targetTabId = tabId
  command.openedByResolver = openedByResolver === true
  await persistPendingDouyinResolves()
  return true
}

async function restoreDouyinResolveTab(command) {
  if (!command?.openedByResolver || !Number.isInteger(command.targetTabId)) return
  const tabId = command.targetTabId
  const tab = await new Promise((resolve) => {
    try {
      chrome.tabs.get(tabId, (result) => resolve(chrome.runtime.lastError ? null : result))
    } catch {
      resolve(null)
    }
  })
  // Resolver ownership expires when the user navigates the tab elsewhere.
  // Never close a tab based only on a stale stored tab id.
  if (!isDouyinResolveTab(tab, command.awemeId)) return

  // Another live request can bind this tab while tabs.get is pending. Transfer
  // the ephemeral ownership to every such occupant, persist it, then re-read
  // the map after that await immediately before deciding whether to close.
  const liveOccupants = () => Array.from(pendingDouyinResolves.values())
    .map((entry) => entry.command)
    .filter((entry) => entry !== command && entry.targetTabId === tabId)
  let occupants = liveOccupants()
  let transferred = false
  for (const occupant of occupants) {
    if (occupant.openedByResolver === true) continue
    occupant.openedByResolver = true
    transferred = true
  }
  if (transferred) await persistPendingDouyinResolves()
  occupants = liveOccupants()
  if (!DP.shouldCloseCreatedTab(command, occupants)) return
  try {
    chrome.tabs.remove(tabId, () => void chrome.runtime.lastError)
  } catch {
    /* The resolver tab may already be gone. */
  }
}

async function sendDouyinResolveToTab(tabId, command) {
  if (!Number.isInteger(tabId)) return false
  const entry = pendingDouyinResolves.get(command.requestId)
  if (entry?.resultPayload) return true
  if (command.dispatchPromise) return await command.dispatchPromise
  if (command.sentTabId === tabId && command.sentDispatched) return true
  if (Number.isInteger(command.sentTabId) && command.sentTabId !== tabId) return false
  command.sentTabId = tabId
  command.sentDispatched = false
  const dispatch = (async () => {
    await persistPendingDouyinResolves()
    return await new Promise((resolve) => {
      try {
        chrome.tabs.sendMessage(tabId, {
          type: 'START_DOUYIN_RESOLVE',
          command: { requestId: command.requestId, url: command.url, awemeId: command.awemeId }
        }, { frameId: 0 }, async (response) => {
          if (chrome.runtime.lastError || response?.ok !== true) {
            if (command.sentTabId === tabId) command.sentTabId = null
            command.sentDispatched = false
            await persistPendingDouyinResolves()
            logBg('douyin-resolve-send-failed', { tabId })
            resolve(false)
            return
          }
          command.sentDispatched = true
          await persistPendingDouyinResolves()
          resolve(true)
        })
      } catch (error) {
        command.sentTabId = null
        command.sentDispatched = false
        void persistPendingDouyinResolves()
        logBg('douyin-resolve-send-throw', { tabId, err: safeError(error) })
        resolve(false)
      }
    })
  })()
  if (entry) entry.dispatchPromise = dispatch
  command.dispatchPromise = dispatch
  try {
    return await dispatch
  } finally {
    if (entry?.dispatchPromise === dispatch) entry.dispatchPromise = null
    if (command.dispatchPromise === dispatch) command.dispatchPromise = null
  }
}

async function dispatchDouyinResolve(command) {
  await hydratePendingDouyinResolves()
  const entry = pendingDouyinResolves.get(command.requestId)
  if (!entry) return { ok: false }
  if (entry.dispatchStartPromise) return await entry.dispatchStartPromise
  const dispatch = (async () => {
    const tabs = await new Promise((resolve) => {
      chrome.tabs.query({}, (result) => resolve(Array.isArray(result) ? result : []))
    })
    const existing = tabs.find((tab) => isDouyinResolveTab(tab, command.awemeId))
    if (existing?.id !== undefined) {
      const pending = []
      for (const otherEntry of pendingDouyinResolves.values()) {
        if (otherEntry.command !== command) pending.push(otherEntry.command)
      }
      await bindDouyinResolveTab(command, existing.id, DP.existingTabIsEphemeral(existing.id, pending))
      const ok = await sendDouyinResolveToTab(existing.id, command)
      return { ok }
    }

    const ready = waitForDouyinResolveDispatch(entry)
    void new Promise((resolve) => {
      try {
        chrome.tabs.create({ url: command.url, active: false }, async (tab) => {
          if (chrome.runtime.lastError || tab?.id === undefined) {
            logBg('douyin-resolve-tab-create-failed', {})
            resolveDouyinDispatchWaiter(entry, { ok: false })
            resolve(false)
            return
          }
          const decision = DP.createdTabBindDecision(command, tab.id)
          if (decision.action === 'discard') {
            try { chrome.tabs.remove(tab.id, () => void chrome.runtime.lastError) } catch {}
            resolve(true)
            return
          }
          await bindDouyinResolveTab(command, tab.id, true)
          await updateDouyinResolveTabMute(tab.id, true)
          // The Douyin content script reports readiness after document_idle;
          // sending earlier would race a newly created tab.
          resolve(true)
        })
      } catch (error) {
        logBg('douyin-resolve-tab-create-throw', { err: safeError(error) })
        resolveDouyinDispatchWaiter(entry, { ok: false })
        resolve(false)
      }
    })
    return await ready
  })()
  entry.dispatchStartPromise = dispatch
  try {
    return await dispatch
  } finally {
    if (entry.dispatchStartPromise === dispatch) entry.dispatchStartPromise = null
  }
}

async function recoverPendingDouyinResolves() {
  for (const entry of Array.from(pendingDouyinResolves.values())) {
    const command = entry.command
    if (pendingDouyinResolves.get(command.requestId) !== entry || entry.expiresAt <= Date.now()) continue
    if (entry.resultPayload) {
      if (!entry.acknowledged) {
        const acknowledgement = await postDouyinResolveAcknowledgement({ requestId: command.requestId, ok: true })
        if (!acknowledgement.ok) continue
      }
      await postDouyinResolveResult(entry.resultPayload)
      continue
    }
    if (entry.acknowledged) continue

    let tab = null
    if (Number.isInteger(command.targetTabId)) {
      tab = await new Promise((resolve) => {
        try {
          chrome.tabs.get(command.targetTabId, (result) => resolve(chrome.runtime.lastError ? null : result))
        } catch {
          resolve(null)
        }
      })
    }
    if (isDouyinResolveTab(tab, command.awemeId)) {
      if (command.sentDispatched) {
        await postDouyinResolveAcknowledgement({ requestId: command.requestId, ok: true })
        continue
      }
      const sent = await sendDouyinResolveToTab(tab.id, command)
      if (sent) {
        await postDouyinResolveAcknowledgement({ requestId: command.requestId, ok: true })
        continue
      }
    } else if (command.targetTabId !== null) {
      command.targetTabId = null
      command.sentTabId = null
      command.sentDispatched = false
      command.openedByResolver = false
      await persistPendingDouyinResolves()
    }

    const dispatch = await dispatchDouyinResolve(command)
    if (!dispatch?.ok) continue
    const acknowledgement = await postDouyinResolveAcknowledgement({ requestId: command.requestId, ok: true })
    if (acknowledgement.ok && dispatch.result) {
      await postDouyinResolveResult({ requestId: command.requestId, ...dispatch.result })
    }
  }
}

async function isUnavailableDouyinResolvePage(tabId) {
  if (!Number.isInteger(tabId)) return false
  // Douyin can render its unavailable-state copy a moment after document_idle.
  // Probe briefly before handing control to the normal page extractor.
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => /你要观看的(?:图文|视频)不存在|图文不存在|视频不存在|作品不存在|内容不存在|作品已删除|作品已下架/.test(String(document.body?.innerText || ''))
      })
      if (Array.isArray(results) && results.some((entry) => entry?.result === true)) return true
    } catch (error) {
      // Navigation may replace or close the short-lived background tab while
      // this probe is in flight. The content-script resolver remains the normal
      // path in that case.
      logBg('douyin-resolve-page-state-probe-failed', { tabId, err: safeError(error) })
      return false
    }
    if (attempt < 7) await new Promise((resolve) => setTimeout(resolve, 350))
  }
  return false
}

async function routeDouyinResolveToReadyTab(command, tabId) {
  const entry = pendingDouyinResolves.get(command.requestId)
  if (!entry || entry.command !== command || entry.expiresAt <= Date.now()) return false
  if (entry.resultPayload) {
    if (!entry.acknowledged) void postDouyinResolveAcknowledgement({ requestId: command.requestId, ok: true })
    return entry.acknowledged
  }
  if (entry.probingPageState) return false
  entry.probingPageState = true
  try {
    if (await isUnavailableDouyinResolvePage(tabId)) {
      const failure = { ok: false, awemeId: command.awemeId, error: DOUYIN_POST_UNAVAILABLE_ERROR }
      if (entry.dispatchWaiter) resolveDouyinDispatchWaiter(entry, { ok: true, result: failure })
      else {
        void postDouyinResolveAcknowledgement({ requestId: command.requestId, ok: true })
          .then((acknowledgement) => acknowledgement.ok
            ? postDouyinResolveResult({ requestId: command.requestId, ...failure })
            : null)
      }
      return entry.acknowledged
    }
    const decision = DP.readyTabBindDecision(command, tabId)
    if (decision.action === 'ignore') return false
    if (!Number.isInteger(command.targetTabId) || command.targetTabId === tabId) {
      await bindDouyinResolveTab(command, tabId, decision.openedByResolver)
    }
    if (command.openedByResolver && command.targetTabId === tabId) {
      await updateDouyinResolveTabMute(tabId, true)
    }
    const sent = await sendDouyinResolveToTab(tabId, command)
    if (entry.dispatchWaiter) resolveDouyinDispatchWaiter(entry, { ok: sent })
    if (sent && !entry.acknowledged) {
      void postDouyinResolveAcknowledgement({ requestId: command.requestId, ok: true })
    }
    return sent && entry.acknowledged
  } finally {
    entry.probingPageState = false
  }
}

async function routeDouyinResolveReady(tabId, url) {
  await hydratePendingDouyinResolves()
  const awemeId = douyinResolveAwemeId(url)
  if (!Number.isInteger(tabId) || !awemeId) return false
  const routes = []
  for (const entry of pendingDouyinResolves.values()) {
    const command = entry.command
    if (entry.expiresAt <= Date.now() || command.awemeId !== awemeId || (command.targetTabId !== null && command.targetTabId !== tabId)) continue
    routes.push(routeDouyinResolveToReadyTab(command, tabId))
  }
  if (!routes.length) return false
  const results = await Promise.all(routes)
  return results.some((handled) => handled === true)
}

async function postDouyinResolveAcknowledgement(message) {
  const requestId = String(message?.requestId || '').trim()
  if (!/^[a-f0-9]{20,80}$/i.test(requestId)) return { ok: false, error: 'Invalid Douyin resolve request' }
  const payload = {
    requestId,
    ok: message?.ok === true,
    error: typeof message?.error === 'string' ? message.error.slice(0, 360) : ''
  }
  const currentEntry = pendingDouyinResolves.get(requestId)
  if (payload.ok && currentEntry?.acknowledged) return { ok: true }
  if (currentEntry?.acknowledgementPromise) return await currentEntry.acknowledgementPromise
  const acknowledgement = (async () => {
    try {
      const response = await postAppJson('/douyin-resolve-ack', payload, { maxAttempts: 2 })
      if (response.ok && payload.ok) {
        await hydratePendingDouyinResolves()
        const entry = pendingDouyinResolves.get(requestId)
        if (entry) {
          entry.acknowledged = true
          entry.expiresAt = Date.now() + 20_000
          scheduleDouyinResolveTimeout(entry)
          await persistPendingDouyinResolves()
        }
      }
      return { ok: response.ok, error: response.ok ? undefined : `HTTP ${response.status}` }
    } catch (error) {
      return { ok: false, error: safeError(error).message }
    }
  })()
  if (currentEntry) currentEntry.acknowledgementPromise = acknowledgement
  try {
    return await acknowledgement
  } finally {
    if (currentEntry?.acknowledgementPromise === acknowledgement) currentEntry.acknowledgementPromise = null
  }
}

async function postDouyinResolveResult(message) {
  await hydratePendingDouyinResolves()
  const requestId = String(message?.requestId || '').trim()
  if (!/^[a-f0-9]{20,80}$/i.test(requestId)) return { ok: false, error: 'Invalid Douyin resolve request' }
  const imageUrls = Array.isArray(message?.imageUrls)
    ? message.imageUrls.filter((url) => isSafeHttpUrl(url)).slice(0, 200)
    : []
  const videoUrlFallbacks = Array.isArray(message?.videoUrlFallbacks)
    ? message.videoUrlFallbacks.filter((url) => isSafeHttpUrl(url)).slice(0, 8)
    : []
  const payload = {
    requestId,
    ok: message?.ok === true,
    awemeId: String(message?.awemeId || '').trim().slice(0, 32),
    mediaType: message?.mediaType === 'gallery' ? 'gallery' : 'video',
    title: typeof message?.title === 'string' ? message.title.slice(0, 200) : '',
    author: typeof message?.author === 'string' ? message.author.slice(0, 120) : '',
    cover: isSafeHttpUrl(message?.cover) ? message.cover : '',
    imageUrls,
    videoUrl: isSafeHttpUrl(message?.videoUrl) ? message.videoUrl : '',
    videoUrlFallbacks,
    duration: Number.isFinite(Number(message?.duration)) ? Math.max(0, Math.floor(Number(message.duration))) : 0,
    error: typeof message?.error === 'string' ? message.error.slice(0, 512) : ''
  }
  const entry = pendingDouyinResolves.get(requestId)
  if (entry?.settlingPromise) return await entry.settlingPromise
  const stablePayload = entry?.resultPayload || payload
  if (entry && !entry.resultPayload) {
    entry.resultPayload = stablePayload
    await persistPendingDouyinResolves()
  }

  const settle = async () => {
    let outcome = { ok: false, error: 'Could not deliver the Douyin result.' }
    let terminal = false
    try {
      const response = await postAppJson('/douyin-resolve-result', stablePayload, {
        maxAttempts: 2,
        timeoutMs: 2_500,
      })
      outcome = { ok: response.ok, error: response.ok ? undefined : `HTTP ${response.status}` }
      terminal = response.ok || response.status === 404 || (response.status >= 400 && response.status < 500)
    } catch (error) {
      outcome = { ok: false, error: safeError(error).message }
    }

    if (entry && pendingDouyinResolves.get(requestId) === entry) {
      if (terminal || Date.now() >= entry.expiresAt) {
        const current = clearDouyinResolveCommand(requestId)
        if (current) await restoreDouyinResolveTab(current)
      } else {
        entry.resultAttempts += 1
        const delay = Math.min(4_000, 500 * (2 ** Math.min(3, entry.resultAttempts - 1)))
        entry.resultRetryTimer = setTimeout(() => {
          entry.resultRetryTimer = null
          void postDouyinResolveResult(entry.resultPayload)
        }, Math.min(delay, Math.max(0, entry.expiresAt - Date.now())))
        await persistPendingDouyinResolves()
      }
    }
    return outcome
  }

  const promise = settle()
  if (entry) entry.settlingPromise = promise
  try {
    return await promise
  } finally {
    if (entry?.settlingPromise === promise) entry.settlingPromise = null
  }
}

// Do not dispatch from tabs.onUpdated: Chrome can report `complete` before
// content-douyin.js has installed its message listener. The content script's
// explicit DOUYIN_RESOLVE_READY signal is the authoritative ready boundary.

const CONTENT_MEDIA_TYPES = new Set(['hls', 'dash', 'mpd', 'mp4', 'webm', 'flv', 'mkv', 'mp3', 'm4a', 'aac', 'opus', 'ogg', 'wav', 'flac', 'jpeg'])
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
  if (item.initiator !== undefined && (typeof item.initiator !== 'string' || item.initiator.length > 8192)) return false
  if (item.title !== undefined && (typeof item.title !== 'string' || item.title.length > 512)) return false
  return true
}

/** Service worker console: chrome://extensions → V-Download → “service worker” → Inspect */
function logBg(stage, data) {
  const line = { stage, t: new Date().toISOString(), ...data }
  console.info('[V-Download ext]', line)
}

function setLastDownloadError(message) {
  const value = { message: String(message).slice(0, 1024), t: Date.now() }
  const revision = ++lastDownloadErrorRevision
  const write = lastDownloadErrorWrites.catch(() => {}).then(() => new Promise((resolve) => {
    try {
      chrome.storage.local.set({ lastDownloadError: value }, () => {
        if (revision === lastDownloadErrorRevision && chrome.runtime.lastError) {
          logBg('download-error-persist-failed', { persisted: false })
        }
        resolve()
      })
    } catch {
      resolve()
    }
  }))
  lastDownloadErrorWrites = write.catch(() => {})
  return write
}

function clearLastDownloadError() {
  ++lastDownloadErrorRevision
  const write = lastDownloadErrorWrites.catch(() => {}).then(() => new Promise((resolve) => {
    try {
      chrome.storage.local.remove('lastDownloadError', () => resolve())
    } catch {
      resolve()
    }
  }))
  lastDownloadErrorWrites = write.catch(() => {})
  return write
}

let lastDownloadErrorRevision = 0
let lastDownloadErrorWrites = Promise.resolve()

function isFreshDownloadError(err) {
  if (!err || typeof err.message !== 'string') return false
  const ts = Number(err.t || 0)
  return Number.isFinite(ts) && Date.now() - ts < LAST_DOWNLOAD_ERROR_TTL_MS
}

function cleanupLastDownloadError() {
  const revision = lastDownloadErrorRevision
  try {
    chrome.storage.local.get(['lastDownloadError'], ({ lastDownloadError }) => {
      if (!lastDownloadError) return
      if (revision !== lastDownloadErrorRevision) return
      if (!isFreshDownloadError(lastDownloadError)) {
        clearLastDownloadError()
      }
    })
  } catch {
    /* ignore */
  }
}

const DEBOUNCE_MS = 2000
const DOWNLOAD_POST_CONCURRENCY = 8

const ICON_ACTIVE = {
  16: 'icons/icon16.png',
  48: 'icons/icon48.png'
}

const FRAME_BUCKET_MAX = 80
const MEDIA_TTL_MS = 20 * 60 * 1000
const MEDIA_CACHE_MAX_ENTRIES = 600
const MEDIA_CACHE_MAX_STORAGE_BYTES = 3 * 1024 * 1024

/** After vdownload://wake cold-starts the app, POST /download when localhost server is up. */
async function forEachConcurrent(items, limit, operation) {
  let nextIndex = 0
  const workerCount = Math.min(Math.max(1, limit), items.length)
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++
      await operation(items[index], index)
    }
  }))
}

async function postDownloadsQueueWhenReady(
  requests,
  maxAttempts = MAX_APP_STARTUP_ATTEMPTS,
  delayMs = 500,
  deadlineAt = Date.now() + MAX_APP_STARTUP_WAIT_MS
) {
  const deadline = Math.min(deadlineAt, Date.now() + MAX_APP_STARTUP_WAIT_MS)
  const results = requests.map(() => ({ ok: false, status: null, error: 'Not sent' }))
  const rid = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  logBg('post-queue-start', {
    rid,
    n: requests.length,
    url0: safeLogUrl(requests[0]?.url),
    type0: requests[0]?.type
  })
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const remainingMs = deadline - Date.now()
    if (remainingMs <= APP_POST_COMPLETION_RESERVE_MS) break
    try {
      const ping = await fetchApp(
        '/ping',
        {},
        Math.min(APP_PROBE_TIMEOUT_MS, remainingMs - APP_POST_COMPLETION_RESERVE_MS)
      )
      if (ping.ok) {
        if (deadline - Date.now() <= APP_POST_COMPLETION_RESERVE_MS) break
        logBg('post-queue-ping-ok', { rid, attempt })
        await forEachConcurrent(requests, DOWNLOAD_POST_CONCURRENCY, async (req, i) => {
          if (results[i].ok) return
          if (!req) return
          const postBudget = deadline - Date.now() - APP_POST_COMPLETION_RESERVE_MS
          if (postBudget <= 250) {
            results[i] = {
              ok: false,
              status: null,
              category: 'network-retryable',
              retryable: true,
              error: 'Request deadline reached'
            }
            return
          }
          try {
            const res = await postAppJson('/download', req, {
              maxAttempts: 2,
              timeoutMs: Math.min(APP_DOWNLOAD_TIMEOUT_MS, postBudget)
            })
            const failure = res.ok ? null : DT.classifyFailure({ status: res.status })
            results[i] = { ok: res.ok, status: res.status, ...(failure || {}), error: res.ok ? undefined : `HTTP ${res.status}` }
            logBg('post-queue-download-post', { rid, i, status: res.status, ok: res.ok })
          } catch (error) {
            results[i] = { ok: false, status: null, ...DT.classifyFailure({ error }), error: 'Network request failed' }
            logBg('post-queue-download-catch', { rid, i, err: safeError(error) })
          }
        })
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
    const sleepMs = Math.min(delayMs, Math.max(0, deadline - Date.now() - APP_POST_COMPLETION_RESERVE_MS))
    if (sleepMs > 0) await new Promise((r) => setTimeout(r, sleepMs))
  }
  logBg('post-queue-timeout', { rid, maxAttempts, delayMs })
  setLastDownloadError(
    'V-Download did not respond on localhost after several attempts. Open the desktop app and try again.'
  )
  return { ok: false, results }
}

function postDownloadWhenAppReady(request, maxAttempts = MAX_APP_STARTUP_ATTEMPTS, delayMs = 500) {
  return postDownloadsQueueWhenReady([request], maxAttempts, delayMs).then((result) => result.ok)
}

// tabMedia: Map<tabId, Map<frameId, Map<url, mediaEntry>>>
const tabMedia = new Map()
const MEDIA_CACHE_STORAGE_KEY = 'tabMediaCache'
const MEDIA_REQUEST_EPOCHS_STORAGE_KEY = 'tabMediaRequestEpochs'
let mediaCacheReady = false
let mediaCacheHydrating = true
const mediaCacheNavigationTombstones = new Set()
const removedTabIdsDuringHydration = new Set()
const tabNavigationEpochs = new Map()
const tabNavigationRevisions = new Map()
const pendingMediaRequestEpochs = new Map()
const MAX_PENDING_MEDIA_REQUEST_EPOCHS = 2048
const failedMediaRequestIdsDuringHydration = new Set()
let mediaCachePersistTimer = null
let mediaCachePersistWrites = Promise.resolve()
let mediaRequestEpochPersistTimer = null
let mediaRequestEpochPersistWrites = Promise.resolve()
let mediaRequestEpochPersistAfterHydration = false

function tabNavigationEpoch(tabId) {
  return tabNavigationEpochs.get(tabId) || 0
}

function tabNavigationRevision(tabId) {
  return tabNavigationRevisions.get(tabId) || 0
}

function invalidateTabMediaForNavigation(tabId, nextUrl = '') {
  if (!Number.isInteger(tabId)) return
  tabNavigationEpochs.set(tabId, tabNavigationEpoch(tabId) + 1)
  tabNavigationRevisions.set(tabId, tabNavigationRevision(tabId) + 1)
  if (mediaCacheHydrating) mediaCacheNavigationTombstones.add(tabId)
  tabMedia.delete(tabId)
  if (nextUrl) knownTabPageUrls.set(tabId, nextUrl)
  scheduleMediaCachePersist()
  scheduleMediaRequestEpochPersist()
}

function normalizedPageUrl(value) {
  try { return new URL(value).href } catch { return '' }
}

const knownTabPageUrls = new Map()

function topFramePageMatches(tabId, pageUrl, fullPageUrl = false) {
  const knownUrl = knownTabPageUrls.get(tabId)
  if (!knownUrl || !pageUrl) return true
  let expected
  let actual
  try {
    expected = new URL(knownUrl)
    actual = new URL(pageUrl)
  } catch {
    return true
  }
  if (expected.origin !== actual.origin) return false
  return !fullPageUrl || expected.href === actual.href
}

function mediaRequestEpochSnapshot() {
  const tabs = {}
  const requests = []
  for (const [requestId, context] of pendingMediaRequestEpochs) {
    if (context.awaitingHydration) continue
    tabs[context.tabId] = {
      epoch: tabNavigationEpoch(context.tabId),
      pageUrl: String(knownTabPageUrls.get(context.tabId) || '').slice(0, 2048)
    }
    requests.push({
      requestId: String(requestId).slice(0, 128),
      tabId: context.tabId,
      epoch: context.epoch,
      requestKind: String(context.requestKind || '').slice(0, 16),
      startedAt: Number(context.startedAt) || 0
    })
  }
  return { tabs, requests }
}

function scheduleMediaRequestEpochPersist() {
  // Do not overwrite the stored snapshot with a partial in-memory map while
  // cold-start hydration is still reading it. Apply one final write after the
  // saved state and startup events have been reconciled.
  if (mediaCacheHydrating) {
    mediaRequestEpochPersistAfterHydration = true
    return
  }
  if (mediaRequestEpochPersistTimer) return
  mediaRequestEpochPersistTimer = setTimeout(() => {
    mediaRequestEpochPersistTimer = null
    const snapshot = mediaRequestEpochSnapshot()
    const write = mediaRequestEpochPersistWrites
      .catch(() => {})
      .then(() => storageSessionSet({ [MEDIA_REQUEST_EPOCHS_STORAGE_KEY]: snapshot }))
    mediaRequestEpochPersistWrites = write.catch(() => {})
  }, 50)
}

function restoreMediaRequestEpochSnapshot(saved) {
  if (!saved || typeof saved !== 'object') return
  if (saved.tabs && typeof saved.tabs === 'object') {
    for (const [tabKey, state] of Object.entries(saved.tabs)) {
      const tabId = Number(tabKey)
      if (!Number.isInteger(tabId) || !state || typeof state !== 'object') continue
      if (removedTabIdsDuringHydration.has(tabId)) continue
      const savedEpoch = Number(state.epoch)
      const baseEpoch = Number.isInteger(savedEpoch) && savedEpoch >= 0 ? savedEpoch : 0
      // Keep the persisted baseline while incorporating navigation callbacks
      // that ran before the asynchronous session read completed.
      tabNavigationEpochs.set(tabId, baseEpoch + tabNavigationRevision(tabId))
      if (!knownTabPageUrls.has(tabId) && typeof state.pageUrl === 'string') {
        knownTabPageUrls.set(tabId, state.pageUrl.slice(0, 2048))
      }
    }
  }
  if (!Array.isArray(saved.requests)) return
  for (const raw of saved.requests.slice(-MAX_PENDING_MEDIA_REQUEST_EPOCHS)) {
    const requestId = typeof raw?.requestId === 'string' ? raw.requestId.slice(0, 128) : ''
    const tabId = Number(raw?.tabId)
    const epoch = Number(raw?.epoch)
    if (!requestId || !Number.isInteger(tabId) || !Number.isInteger(epoch) || epoch < 0) continue
    if (removedTabIdsDuringHydration.has(tabId) || failedMediaRequestIdsDuringHydration.has(requestId) || pendingMediaRequestEpochs.has(requestId)) continue
    const tabState = saved.tabs?.[tabId] || saved.tabs?.[String(tabId)]
    pendingMediaRequestEpochs.set(requestId, {
      tabId,
      epoch,
      pageUrl: Number(tabState?.epoch) === epoch && typeof tabState?.pageUrl === 'string' ? tabState.pageUrl.slice(0, 2048) : '',
      requestKind: typeof raw.requestKind === 'string' ? raw.requestKind.slice(0, 16) : '',
      startedAt: Number.isFinite(Number(raw.startedAt)) ? Number(raw.startedAt) : 0,
      awaitingHydration: false,
      navigationRevision: tabNavigationRevision(tabId)
    })
  }
}

function reconcileHydrationPendingMediaRequests() {
  let changed = false
  for (const [requestId, context] of pendingMediaRequestEpochs) {
    if (!context.awaitingHydration) continue
    if (context.navigationRevision !== tabNavigationRevision(context.tabId)) {
      pendingMediaRequestEpochs.delete(requestId)
      changed = true
      continue
    }
    const pageUrl = knownTabPageUrls.get(context.tabId) || ''
    if (!pageUrl) {
      pendingMediaRequestEpochs.delete(requestId)
      changed = true
      continue
    }
    if (context.frameId === 0 && context.documentUrl && normalizedPageUrl(context.documentUrl) !== normalizedPageUrl(pageUrl)) {
      pendingMediaRequestEpochs.delete(requestId)
      changed = true
      continue
    }
    context.epoch = tabNavigationEpoch(context.tabId)
    context.pageUrl = pageUrl.slice(0, 2048)
    context.awaitingHydration = false
    changed = true
  }
  return changed
}

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
      chrome.storage.session.set(value, () => {
        if (chrome.runtime.lastError) logBg('session-storage-write-failed', { key: Object.keys(value || {})[0] || '' })
        resolve()
      })
    } catch {
      resolve()
    }
  })
}

function mediaCacheStorageBudgetBytes() {
  // Reserve half of storage.session for pending command/result receipts. Older
  // Chrome releases expose only 1 MiB here; newer releases allow roughly 10 MiB.
  try {
    const quota = Number(chrome.storage.session?.QUOTA_BYTES)
    if (Number.isFinite(quota) && quota > 0) return Math.min(MEDIA_CACHE_MAX_STORAGE_BYTES, Math.floor(quota / 2))
  } catch {}
  return 512 * 1024
}

function persistedMediaEntry(raw) {
  if (!raw || typeof raw !== 'object' || !isSafeHttpUrl(raw.url)) return null
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
    pageUrlIsDocument: raw.pageUrlIsDocument === true,
    timestamp: Number.isFinite(Number(raw.timestamp)) ? Number(raw.timestamp) : 0,
    source: typeof raw.source === 'string' ? raw.source : 'network',
    confidence: Number.isFinite(Number(raw.confidence)) ? Number(raw.confidence) : 0,
  }
  return MP.isReliableCandidate(entry) ? entry : null
}

function serializeMediaCache() {
  const candidates = []
  for (const [tabId, frames] of tabMedia) {
    for (const [frameId, bucket] of frames) {
      for (const entry of bucket.values()) {
        const value = {
          url: entry.url,
          type: entry.type,
          mime: String(entry.mime || '').slice(0, 128),
          contentType: String(entry.contentType || '').slice(0, 128),
          size: entry.size || null,
          requestKind: String(entry.requestKind || '').slice(0, 32),
          initiator: String(entry.initiator || '').slice(0, 2048),
          pageUrl: String(entry.pageUrl || '').slice(0, 2048),
          pageUrlIsDocument: entry.pageUrlIsDocument === true,
          timestamp: entry.timestamp || 0,
          source: String(entry.source || 'network').slice(0, 32),
          confidence: entry.confidence || 0,
        }
        const serialized = JSON.stringify(value)
        candidates.push({ tabId, frameId, value, cost: (serialized.length + 64) * 2, timestamp: value.timestamp })
      }
    }
  }
  candidates.sort((a, b) => b.timestamp - a.timestamp)
  const cache = {}
  let usedBytes = 128
  const maxBytes = mediaCacheStorageBudgetBytes()
  for (const candidate of candidates) {
    if (usedBytes + candidate.cost > maxBytes) continue
    const tab = cache[candidate.tabId] || (cache[candidate.tabId] = {})
    if (knownTabPageUrls.has(candidate.tabId)) tab.__pageUrl = knownTabPageUrls.get(candidate.tabId)
    const frame = tab[candidate.frameId] || (tab[candidate.frameId] = [])
    frame.push(candidate.value)
    usedBytes += candidate.cost
  }
  return cache
}

function scheduleMediaCachePersist() {
  if (!mediaCacheReady) return
  if (mediaCachePersistTimer) clearTimeout(mediaCachePersistTimer)
  mediaCachePersistTimer = setTimeout(() => {
    mediaCachePersistTimer = null
    const snapshot = serializeMediaCache()
    const write = mediaCachePersistWrites
      .catch(() => {})
      .then(() => storageSessionSet({ [MEDIA_CACHE_STORAGE_KEY]: snapshot }))
    mediaCachePersistWrites = write.catch(() => {})
  }, 250)
}

async function loadMediaCache() {
  const data = await storageSessionGet([MEDIA_CACHE_STORAGE_KEY, MEDIA_REQUEST_EPOCHS_STORAGE_KEY])
  const saved = data?.[MEDIA_CACHE_STORAGE_KEY]
  const savedRequestEpochs = data?.[MEDIA_REQUEST_EPOCHS_STORAGE_KEY]
  restoreMediaRequestEpochSnapshot(savedRequestEpochs)
  let tabs = []
  let haveTabSnapshot = false
  try {
    tabs = await chrome.tabs.query({})
    haveTabSnapshot = true
  } catch {
    /* best effort; TTL pruning still protects the cache */
  }
  const openTabs = new Map()
  for (const tab of tabs) {
    if (Number.isInteger(tab.id)) {
      openTabs.set(tab.id, tab)
      if (typeof tab.url !== 'string') continue

      // A tabs.query result can be stale relative to an onUpdated event that
      // arrived while storage.session was hydrating. Preserve event state.
      if (mediaCacheNavigationTombstones.has(tab.id)) {
        if (!knownTabPageUrls.has(tab.id)) knownTabPageUrls.set(tab.id, tab.url)
        continue
      }

      const savedFrames = saved?.[tab.id] || saved?.[String(tab.id)]
      const savedCachePageUrl = typeof savedFrames?.__pageUrl === 'string' ? savedFrames.__pageUrl : ''
      const persistedRequestPageUrl = typeof savedRequestEpochs?.tabs?.[tab.id]?.pageUrl === 'string'
        ? savedRequestEpochs.tabs[tab.id].pageUrl
        : (typeof savedRequestEpochs?.tabs?.[String(tab.id)]?.pageUrl === 'string'
          ? savedRequestEpochs.tabs[String(tab.id)].pageUrl
          : '')
      const previousUrl = knownTabPageUrls.get(tab.id) || persistedRequestPageUrl || savedCachePageUrl
      if (previousUrl && normalizedPageUrl(previousUrl) !== normalizedPageUrl(tab.url)) {
        invalidateTabMediaForNavigation(tab.id, tab.url)
      } else if (!knownTabPageUrls.has(tab.id)) {
        knownTabPageUrls.set(tab.id, tab.url)
      }
    }
  }
  if (haveTabSnapshot) {
    for (const [requestId, context] of pendingMediaRequestEpochs) {
      if (!openTabs.has(context.tabId)) pendingMediaRequestEpochs.delete(requestId)
    }
    for (const tabId of [...knownTabPageUrls.keys()]) {
      if (!openTabs.has(tabId)) knownTabPageUrls.delete(tabId)
    }
    for (const tabId of [...tabNavigationEpochs.keys()]) {
      if (!openTabs.has(tabId)) tabNavigationEpochs.delete(tabId)
    }
    for (const tabId of [...tabNavigationRevisions.keys()]) {
      if (!openTabs.has(tabId)) tabNavigationRevisions.delete(tabId)
    }
  }
  if (saved && typeof saved === 'object') {
    for (const [tabKey, savedFrames] of Object.entries(saved)) {
      const tabId = Number(tabKey)
      if (!Number.isInteger(tabId) || !savedFrames || typeof savedFrames !== 'object') continue
      if (haveTabSnapshot && !openTabs.has(tabId)) continue
      if (mediaCacheNavigationTombstones.has(tabId)) continue
      const savedPageUrl = typeof savedFrames.__pageUrl === 'string' ? savedFrames.__pageUrl : ''
      const currentPageUrl = knownTabPageUrls.get(tabId) || openTabs.get(tabId)?.url
      // Entries written before page ownership was persisted cannot safely be
      // attributed after a worker restart when the tab's page URL is unknown.
      if (currentPageUrl && !savedPageUrl) continue
      if (savedPageUrl && currentPageUrl && normalizedPageUrl(savedPageUrl) !== normalizedPageUrl(currentPageUrl)) continue
      const frames = new Map()
      for (const [frameKey, savedEntries] of Object.entries(savedFrames)) {
        const frameId = Number(frameKey)
        if (frameKey === '__pageUrl' || !Number.isInteger(frameId) || !Array.isArray(savedEntries)) continue
        const bucket = new Map()
        for (const raw of savedEntries) {
          const entry = persistedMediaEntry(raw)
          if (frameId === 0 && entry?.pageUrl && !topFramePageMatches(tabId, entry.pageUrl, entry.pageUrlIsDocument)) continue
          if (entry) bucket.set(MP.canonicalizeUrl(entry.url), entry)
        }
        if (bucket.size) frames.set(frameId, bucket)
      }
      if (frames.size) tabMedia.set(tabId, frames)
    }
  }

  pruneMedia()
  reconcileHydrationPendingMediaRequests()
  mediaCacheReady = true
  scheduleMediaCachePersist()
  mediaCacheHydrating = false
  failedMediaRequestIdsDuringHydration.clear()
  removedTabIdsDuringHydration.clear()
  if (mediaRequestEpochPersistAfterHydration) {
    mediaRequestEpochPersistAfterHydration = false
    scheduleMediaRequestEpochPersist()
  }
  mediaCacheNavigationTombstones.clear()
  for (const tab of tabs) updateTabUI(tab)
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
  if (!isSafeHttpUrl(url)) return
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
  pruneMedia()
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
  const allEntries = []
  for (const [tabId, frames] of tabMedia) {
    for (const [frameId, bucket] of frames) {
      for (const [url, entry] of bucket) allEntries.push({ tabId, frameId, url, timestamp: entry.timestamp || 0 })
    }
  }
  if (allEntries.length > MEDIA_CACHE_MAX_ENTRIES) {
    allEntries.sort((a, b) => a.timestamp - b.timestamp)
    for (const entry of allEntries.slice(0, allEntries.length - MEDIA_CACHE_MAX_ENTRIES)) {
      tabMedia.get(entry.tabId)?.get(entry.frameId)?.delete(entry.url)
      changed = true
    }
    for (const [tabId, frames] of tabMedia) {
      for (const [frameId, bucket] of frames) if (!bucket.size) frames.delete(frameId)
      if (!frames.size) tabMedia.delete(tabId)
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

    if (isSafeHttpUrl(downloadUrl) && isYouTubeUrl(downloadUrl)) {
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

  if (isTikTokUrl(tab.url)) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const btn = document.getElementById('tt-dl-btn')
          if (btn) btn.click()
        }
      })
    } catch {}
  }
})

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId)
    updateTabUI(tab)
  } catch {}
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (typeof tab.url === 'string') knownTabPageUrls.set(tabId, tab.url)
  if (changeInfo.url || changeInfo.status === 'complete') {
    updateTabUI(tab)
  }
  if (changeInfo.url) {
    invalidateTabMediaForNavigation(tabId, changeInfo.url)
    updateBadge(tabId, 0)
  }
})

chrome.tabs.onRemoved.addListener((tabId) => {
  if (mediaCacheHydrating) removedTabIdsDuringHydration.add(tabId)
  invalidateTabMediaForNavigation(tabId)
  knownTabPageUrls.delete(tabId)
  tabNavigationEpochs.delete(tabId)
  tabNavigationRevisions.delete(tabId)
  for (const [requestId, context] of pendingMediaRequestEpochs) {
    if (context.tabId === tabId) pendingMediaRequestEpochs.delete(requestId)
  }
  scheduleMediaRequestEpochPersist()
  void hydratePendingDouyinProfileImports().then(async () => {
    let changed = false
    for (const command of pendingDouyinProfileImports.values()) {
      if (command.sentTabId !== tabId || command.resultPayload) continue
      command.sentTabId = null
      command.sentDispatched = false
      changed = true
    }
    if (changed) await persistPendingDouyinProfileImports()
  })
  void hydratePendingDouyinResolves().then(() => {
    for (const entry of pendingDouyinResolves.values()) {
      if (entry.command.targetTabId !== tabId || entry.resultPayload) continue
      void postDouyinResolveResult({
        requestId: entry.command.requestId,
        ok: false,
        awemeId: entry.command.awemeId,
        error: 'The Douyin page closed before it returned media information.'
      })
    }
  })
})

function ignoreTransientTabActionError(action) {
  try {
    const result = action()
    if (result && typeof result.catch === 'function') void result.catch(() => {})
  } catch {
    // A tab may close between an onUpdated/onActivated callback and a badge
    // update. That is expected browser churn, not an extension error.
  }
}

function updateTabUI(tab) {
  if (!mediaCacheReady) {
    void mediaCacheReadyPromise.then(() => updateTabUI(tab))
    return
  }
  if (!tab.active || !Number.isInteger(tab.id)) return
  const isYT = tab.url && isYouTubeUrl(tab.url)
  const isDouyin = tab.url && isDouyinUrl(tab.url)
  const isX = tab.url && isXUrl(tab.url)
  const isTikTok = tab.url && isTikTokUrl(tab.url)

  const noPopup = isYT || isDouyin || isX || isTikTok
  ignoreTransientTabActionError(() => chrome.action.setPopup({ tabId: tab.id, popup: noPopup ? '' : 'popup.html' }))
  ignoreTransientTabActionError(() => chrome.action.setIcon({ tabId: tab.id, path: ICON_ACTIVE }))

  if (!isYT) {
    const count = (isDouyin || isX || isTikTok) ? 0 : getAllTabMedia(tab.id).length
    updateBadge(tab.id, count)
  }
}

function refreshAllTabsUI() {
  void chrome.tabs.query({}).then((tabs) => {
    tabs.forEach(updateTabUI)
  }).catch(() => {})
}

function updateBadge(tabId, count) {
  if (count > 0) {
    ignoreTransientTabActionError(() => chrome.action.setBadgeText({ tabId, text: String(count) }))
    ignoreTransientTabActionError(() => chrome.action.setBadgeBackgroundColor({ tabId, color: '#27272A' }))
    ignoreTransientTabActionError(() => chrome.action.setIcon({ tabId, path: ICON_ACTIVE }))
  } else {
    ignoreTransientTabActionError(() => chrome.action.setBadgeText({ tabId, text: '' }))
  }
}

// --- webRequest sniffer (frame-aware) ---

chrome.webRequest.onCompleted.addListener(
  (details) => {
    const requestId = String(details.requestId || '')
    const requestContextAtEvent = pendingMediaRequestEpochs.get(requestId)
    if (requestContextAtEvent && !(mediaCacheHydrating && requestContextAtEvent.awaitingHydration)) {
      pendingMediaRequestEpochs.delete(requestId)
      scheduleMediaRequestEpochPersist()
    }
    void mediaCacheReadyPromise.then(() => {
      if (details.tabId < 0) return
      // If completion woke a cold worker before session storage finished
      // loading, retrieve the persisted in-flight request context now.
      const requestContext = requestContextAtEvent || pendingMediaRequestEpochs.get(requestId)
      if (requestContext) {
        pendingMediaRequestEpochs.delete(requestId)
        scheduleMediaRequestEpochPersist()
        if (requestContext.tabId !== details.tabId || requestContext.epoch !== tabNavigationEpoch(details.tabId)) return
        const currentPageUrl = knownTabPageUrls.get(details.tabId) || ''
        if (!requestContext.pageUrl || !currentPageUrl || normalizedPageUrl(requestContext.pageUrl) !== normalizedPageUrl(currentPageUrl)) return
      }
      if (!isSafeHttpUrl(details.url)) return
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
      const documentUrl = typeof details.documentUrl === 'string' ? details.documentUrl.slice(0, 2048) : ''
      const trustedPageUrl = documentUrl || requestContext?.pageUrl || ''
      // With no in-flight ownership record, only accept a top-frame request
      // when Chrome supplied a full document URL that still matches the tab.
      // An initiator is only an origin and cannot identify an SPA route.
      if (!requestContext) {
        if ((details.frameId ?? 0) !== 0 || !documentUrl) return
        const currentPageUrl = knownTabPageUrls.get(details.tabId)
        if (!currentPageUrl || normalizedPageUrl(documentUrl) !== normalizedPageUrl(currentPageUrl)) return
      }
      const candidate = {
        url: details.url,
        type: mediaType,
        mime: mime.slice(0, 128),
        contentType: mime.slice(0, 128),
        size: parsedSize,
        requestKind: details.type,
        initiator: typeof details.initiator === 'string' ? details.initiator.slice(0, 8192) : '',
        pageUrl: trustedPageUrl || (typeof details.initiator === 'string' ? details.initiator.slice(0, 2048) : ''),
        pageUrlIsDocument: Boolean(documentUrl || requestContext?.pageUrl),
        timestamp: Date.now(),
        source: 'network'
      }
      if (!MP.isReliableCandidate(candidate)) return
      const frameId = details.frameId ?? 0
      if (frameId === 0 && !topFramePageMatches(details.tabId, candidate.pageUrl, candidate.pageUrlIsDocument)) return
      candidate.confidence = MP.scoreCandidate(candidate)
      addMediaEntry(details.tabId, frameId, details.url, candidate)

      updateBadge(details.tabId, getAllTabMedia(details.tabId).length)
    })
  },
  { urls: ['<all_urls>'], types: ['media', 'xmlhttprequest', 'other'] },
  ['responseHeaders']
)

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0 || !['media', 'xmlhttprequest', 'other'].includes(details.type)) return
    if (pendingMediaRequestEpochs.size >= MAX_PENDING_MEDIA_REQUEST_EPOCHS) {
      const oldestNonMedia = Array.from(pendingMediaRequestEpochs.entries()).find(([, context]) => context.requestKind !== 'media')?.[0]
      const oldest = oldestNonMedia ?? pendingMediaRequestEpochs.keys().next().value
      if (oldest !== undefined) pendingMediaRequestEpochs.delete(oldest)
    }
    pendingMediaRequestEpochs.set(String(details.requestId), {
      tabId: details.tabId,
      epoch: tabNavigationEpoch(details.tabId),
      pageUrl: String(knownTabPageUrls.get(details.tabId) || '').slice(0, 2048),
      requestKind: String(details.type || '').slice(0, 16),
      startedAt: Date.now(),
      awaitingHydration: mediaCacheHydrating,
      navigationRevision: tabNavigationRevision(details.tabId),
      frameId: Number.isInteger(details.frameId) ? details.frameId : -1,
      documentUrl: Number.isInteger(details.frameId) && details.frameId === 0 && typeof details.documentUrl === 'string'
        ? details.documentUrl.slice(0, 2048)
        : ''
    })
    scheduleMediaRequestEpochPersist()
  },
  { urls: ['<all_urls>'], types: ['media', 'xmlhttprequest', 'other'] }
)

chrome.webRequest.onErrorOccurred.addListener((details) => {
  const requestId = String(details.requestId || '')
  pendingMediaRequestEpochs.delete(requestId)
  if (mediaCacheHydrating && requestId) {
    if (failedMediaRequestIdsDuringHydration.size >= MAX_PENDING_MEDIA_REQUEST_EPOCHS) {
      const oldest = failedMediaRequestIdsDuringHydration.values().next().value
      if (oldest !== undefined) failedMediaRequestIdsDuringHydration.delete(oldest)
    }
    failedMediaRequestIdsDuringHydration.add(requestId)
  }
  scheduleMediaRequestEpochPersist()
}, { urls: ['<all_urls>'], types: ['media', 'xmlhttprequest', 'other'] })

function getHeader(headers, name) {
  if (!headers) return null
  const header = headers.find((h) => typeof h?.name === 'string' && h.name.toLowerCase() === name.toLowerCase())
  return header ? header.value : null
}

// --- Message handlers ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CLEAR_LAST_DOWNLOAD_ERROR') {
    clearLastDownloadError()
    sendResponse({ ok: true })
    return false
  }

  if (message.type === 'REQUEST_DOUYIN_PROFILE_IMPORT') {
    ;(async () => {
      const requestId = String(message.requestId || '').trim()
      const command = await fetchDouyinProfileImportCommand(requestId, message.command)
      if (!command) {
        sendResponse({ ok: false, error: 'V-Download profile import request expired or is unavailable.' })
        return
      }
      const dispatched = await dispatchDouyinProfileImport(command)
      sendResponse(
        dispatched
          ? { ok: true }
          : { ok: false, error: 'Could not find or open the Douyin profile tab.' }
      )
    })().catch(() => sendResponse({ ok: false, error: 'Could not start Douyin profile import.' }))
    return true
  }

  if (message.type === 'REQUEST_DOUYIN_RESOLVE') {
    ;(async () => {
      const requestId = String(message.requestId || '').trim()
      const command = await fetchDouyinResolveCommand(requestId, message.command)
      if (!command) {
        const error = 'V-Download Douyin request expired or is unavailable.'
        await postDouyinResolveAcknowledgement({ requestId, ok: false, error })
        sendResponse({ ok: false, error })
        return
      }
      const dispatch = await dispatchDouyinResolve(command)
      const dispatched = dispatch?.ok === true
      const error = dispatched ? '' : 'Could not find or open the Douyin page.'
      const acknowledged = await postDouyinResolveAcknowledgement({ requestId, ok: dispatched, error })
      if (!dispatched || !acknowledged.ok) {
        const current = clearDouyinResolveCommand(requestId)
        if (current) await restoreDouyinResolveTab(current)
      } else if (dispatch.result) {
        await postDouyinResolveResult({ requestId, ...dispatch.result })
      }
      sendResponse(
        dispatched && acknowledged.ok
          ? { ok: true }
          : { ok: false, error: acknowledged.error || error || 'Could not acknowledge the Douyin resolver.' }
      )
    })().catch(async () => {
      const requestId = String(message.requestId || '').trim()
      const error = 'Could not start Douyin resolve.'
      await postDouyinResolveAcknowledgement({ requestId, ok: false, error })
      sendResponse({ ok: false, error })
    })
    return true
  }

  if (message.type === 'DOUYIN_RESOLVE_READY') {
    routeDouyinResolveReady(sender.tab?.id, message.url || sender.tab?.url || '')
      .then((ok) => sendResponse({ ok: ok === true }))
      .catch(() => sendResponse({ ok: false }))
    return true
  }

  if (message.type === 'DOUYIN_RESOLVE_RESULT') {
    void postDouyinResolveResult(message).then((result) => sendResponse(result))
    return true
  }

  if (message.type === 'DOUYIN_PROFILE_READY') {
    routeDouyinProfileReady(sender.tab?.id, message.url || sender.tab?.url || '')
      .then((ok) => sendResponse({ ok }))
      .catch(() => sendResponse({ ok: false }))
    return true
  }

  if (message.type === 'DOUYIN_PROFILE_IMPORT_RESULT') {
    void postDouyinProfileImportResult(message).then((result) => sendResponse(result))
    return true
  }

  if (message.type === 'FORCE_COOKIE_SYNC') {
    ;(async () => {
      const result = await syncCookies()
      sendResponse({
        ok: result.ok,
        error: result.ok ? undefined : result.error,
      })
      const tabId = sender.tab?.id
      const url = sender.tab?.url ?? ''
      if (
        result.ok &&
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
      .then((result) => sendResponse(result.ok ? { ok: true } : { ok: false, error: result.error }))
      .catch(() => sendResponse({ ok: false, error: 'Unable to queue download' }))
    return true
  }

  // Existing: popup queries all media for the active tab
  if (message.type === 'GET_MEDIA') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        sendResponse({ media: [], tabUrl: '', tabTitle: '', error: 'Could not read the active tab.' })
        return
      }
      const activeTab = Array.isArray(tabs) ? tabs[0] : null
      const tabId = activeTab?.id
      if (!Number.isInteger(tabId)) {
        sendResponse({ media: [], tabUrl: '', tabTitle: '' })
        return
      }
      void mediaCacheReadyPromise.then(() => {
        const media = MP.mergeCandidates(getAllTabMedia(tabId))
        sendResponse({ media, tabUrl: activeTab?.url || '', tabTitle: activeTab?.title || '' })
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
    const operationDeadline = Date.now() + MAX_APP_STARTUP_WAIT_MS
    const firstAttemptDeadline = Math.min(
      operationDeadline - APP_POST_COMPLETION_RESERVE_MS,
      Date.now() + DOWNLOAD_BATCH_INITIAL_ATTEMPT_MS
    )
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const activeTab = Array.isArray(tabs) ? tabs[0] : null
      const tabId = Number.isInteger(activeTab?.id) ? activeTab.id : null
      const requests = items.map((item, i) => MP.isReliableCandidate(item) ? ({
        url: item.url,
        type: item.type,
        referer: isSafeHttpUrl(item.initiator) ? item.initiator : (isSafeHttpUrl(tabUrl) ? tabUrl : ''),
        title: items.length > 1 ? `${baseTitle} (${i + 1})` : baseTitle
      }) : null)
      const directResults = requests.map((request) => request ? ({ ok: false, status: null, error: 'Not sent' }) : ({ ok: false, status: 422, category: 'invalid-media-candidate', error: 'Invalid media candidate' }))
      const pendingIndexes = []
      try {
        await forEachConcurrent(requests, DOWNLOAD_POST_CONCURRENCY, async (request, i) => {
          if (!request) return
          if (Date.now() >= firstAttemptDeadline) {
            directResults[i] = {
              ok: false,
              status: null,
              category: 'network-retryable',
              retryable: true,
              error: 'Initial request window elapsed'
            }
            pendingIndexes.push(i)
            return
          }
          let response
          try {
            response = await postAppJson('/download', request, {
              maxAttempts: 1,
              timeoutMs: Math.min(APP_DOWNLOAD_TIMEOUT_MS, Math.max(250, firstAttemptDeadline - Date.now())),
            })
          } catch (error) {
            directResults[i] = { ok: false, status: null, category: DT.classifyFailure({ error }).category, error: 'Network request failed' }
            pendingIndexes.push(i)
            return
          }
          const failure = response.ok ? null : DT.classifyFailure({ status: response.status })
          directResults[i] = { ok: response.ok, status: response.status, ...(failure || {}), error: response.ok ? undefined : `HTTP ${response.status}` }
          if (!response.ok && DT.shouldFallback({ status: response.status })) pendingIndexes.push(i)
        })
        pendingIndexes.sort((a, b) => a - b)
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
      let posted = await postDownloadsQueueWhenReady(
        pendingRequests,
        MAX_APP_STARTUP_ATTEMPTS,
        500,
        operationDeadline
      )
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
      if (!Number.isInteger(tabId)) {
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
        const queued = await postDownloadsQueueWhenReady([request])
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

function httpHost(url) {
  try {
    const parsed = new URL(url)
    return /^https?:$/.test(parsed.protocol) ? parsed.hostname.toLowerCase() : ''
  } catch {
    return ''
  }
}

function hostIsOrSubdomain(host, domain) {
  return host === domain || host.endsWith(`.${domain}`)
}

function isYouTubeUrl(url) {
  const host = httpHost(url)
  return host === 'youtu.be' || hostIsOrSubdomain(host, 'youtube.com')
}

function isDouyinUrl(url) {
  const host = httpHost(url)
  return hostIsOrSubdomain(host, 'douyin.com') || hostIsOrSubdomain(host, 'iesdouyin.com')
}

function isXUrl(url) {
  const host = httpHost(url)
  return hostIsOrSubdomain(host, 'x.com') || hostIsOrSubdomain(host, 'twitter.com')
}

function isTikTokUrl(url) {
  return hostIsOrSubdomain(httpHost(url), 'tiktok.com')
}

function getXStatusUrl(rawUrl) {
  try {
    const url = new URL(rawUrl)
    const host = url.hostname.toLowerCase()
    if (!hostIsOrSubdomain(host, 'x.com') && !hostIsOrSubdomain(host, 'twitter.com')) return null
    const match = url.pathname.match(/^(?:\/[^/]+\/status\/\d+|\/i\/web\/status\/\d+)(?:\/|$)/)
    return match ? `${url.origin}${match[0].replace(/\/$/, '')}` : null
  } catch {
    return null
  }
}

async function sendDownloadRequest(request, tabId, opts = {}) {
  const { surfacedWake = false } = opts
  const payload = typeof request === 'object' && request !== null ? request : { url: String(request) }
  try {
    const res = await postAppJson('/download', payload, { maxAttempts: 2, timeoutMs: APP_DOWNLOAD_TIMEOUT_MS })
    if (res.ok) {
      clearLastDownloadError()
      return { ok: true }
    }
  } catch {
    /* app not running */
  }
  if (!surfacedWake) {
    launchWakeToFocusApp(tabId)
  }
  const queued = await postDownloadsQueueWhenReady([payload])
  if (!queued.ok) {
    setLastDownloadError('Could not open or reach V-Download from the extension.')
    const failure = queued.results?.find((result) => !result.ok)
    return {
      ok: false,
      error: failure?.category === 'authorization-required'
        ? 'V-Download rejected this Chrome extension. Reload the extension or install the matching extension folder, then retry.'
        : failure?.error || 'App is not running or did not accept the download.'
    }
  } else {
    clearLastDownloadError()
  }
  return { ok: true }
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
    if (chrome.runtime.lastError || !Number.isInteger(created?.id)) {
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
    let result = {}
    try { result = await response.json() } catch { /* empty error response */ }
    if (!response.ok) {
      const error = typeof result.error === 'string' ? result.error : `App rejected cookie sync (HTTP ${response.status})`
      logBg('cookie-sync-failed', { status: response.status, error, received: allCookies.length })
      return { ok: false, error }
    }

    console.log(`Synced ${result.count ?? allCookies.length} cookies across ${COOKIE_SYNC_DOMAINS.length} domains${result.skipped ? ` (${result.skipped} skipped)` : ''}`)
    return { ok: true, skipped: Number(result.skipped) || 0 }
  } catch {
    return { ok: false, error: 'Could not reach V-Download on localhost' }
  }
}

async function pollPendingCookieSync() {
  try {
    await appCapabilityLoadPromise
    const poll = await fetchApp('/cookie-sync-poll?pair=1', {}, APP_PROBE_TIMEOUT_MS)
    if (!poll.ok) return
    const data = await poll.json()
    if (typeof data.capability === 'string' && data.capability.length >= 32) {
      await persistAppCapability(data.capability)
    }
    if (!data.pending) return
    await syncCookies()
  } catch {
    // app not running
  }
}

chrome.runtime.onInstalled.addListener(() => {
  cleanupLastDownloadError()
  refreshAllTabsUI()
})

chrome.runtime.onStartup.addListener(() => {
  cleanupLastDownloadError()
  refreshAllTabsUI()
})

// Cookie sync is intentionally user-triggered. Keep only the lightweight
// pending-pair poll so the desktop app can wait for an explicit request.
chrome.alarms.create('cookie-sync-force-poll', { periodInMinutes: 1 })
chrome.alarms.create('last-download-error-gc', { periodInMinutes: 5 })
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'cookie-sync-force-poll') {
    void pollPendingCookieSync()
    void hydratePendingDouyinProfileImports()
    void hydratePendingDouyinResolves()
  } else if (alarm.name === 'last-download-error-gc') {
    cleanupLastDownloadError()
  }
})
