/* Document-start fallback for requests Chrome did not deliver to a waking worker. */
;(() => {
  'use strict'
  const policy = globalThis.VDownloadMediaPatterns
  if (!policy || !/^https?:$/.test(location.protocol) || typeof PerformanceObserver !== 'function') return
  globalThis.__vdownloadResourceCapture?.()
  let stopped = false
  let paused = false
  let timer = null
  let busy = false
  let retries = 0
  let documentUrl = location.href
  // Late injection cannot attribute historical SPA requests to the current URL.
  const navigation = performance.getEntriesByType('navigation')[0]
  let cutoff = document.readyState === 'loading' && navigation?.name?.split('#')[0] === documentUrl.split('#')[0]
    ? 0 : performance.now()
  const pending = new Map()
  const delivered = new Map()
  const BATCH_SIZE = 32
  const MAX_PENDING = 128
  const MAX_DELIVERED = 256

  function synchronizeDocument() {
    if (documentUrl === location.href) return
    documentUrl = location.href
    cutoff = performance.now()
    pending.clear()
    delivered.clear()
  }
  function schedule(delay = 50) {
    if (!stopped && !paused && !timer) timer = setTimeout(() => { timer = null; flush() }, delay)
  }
  function flush() {
    if (stopped || paused || busy) return
    synchronizeDocument()
    if (!pending.size) return
    const entries = [...pending.values()].slice(0, BATCH_SIZE)
    const page = documentUrl
    busy = true
    const complete = (response) => {
      busy = false
      if (stopped || paused) return
      if (chrome.runtime.lastError || response?.ok !== true) {
        if (++retries > 3) { stop(); return }
        schedule(100 * 3 ** (retries - 1))
        return
      }
      retries = 0
      if (location.href !== page) synchronizeDocument()
      else for (const entry of entries) {
        if (pending.get(entry.url) === entry) pending.delete(entry.url)
        delivered.set(entry.url, entry.finishedAt)
        if (delivered.size > MAX_DELIVERED) delivered.delete(delivered.keys().next().value)
      }
      if (pending.size) schedule()
    }
    try { chrome.runtime.sendMessage({ type: 'OBSERVED_MEDIA_RESOURCES', documentUrl: page, entries }, complete) }
    catch { stop() }
  }
  function observe(entries) {
    if (stopped || paused) return
    synchronizeDocument()
    for (const entry of entries) {
      if (entry.entryType !== 'resource' || entry.startTime < cutoff || entry.responseEnd < entry.startTime) continue
      const url = entry.name
      const type = policy.inferTypeFromUrl(url)
      if (!type || !/^https?:\/\//i.test(url) || url.length > 8192) continue
      const status = Number.isInteger(entry.responseStatus) && entry.responseStatus > 0 ? entry.responseStatus : undefined
      if (status !== undefined && (status < 200 || status >= 400)) continue
      const size = Number.isSafeInteger(entry.encodedBodySize) && entry.encodedBodySize > 0 ? entry.encodedBodySize : null
      if (!policy.isReliableCandidate({ url, type, size, source: 'performance' })) continue
      const finishedAt = Math.round(performance.timeOrigin + entry.responseEnd)
      if (delivered.get(url) === finishedAt) continue
      pending.set(url, { url, startedAt: Math.round(performance.timeOrigin + entry.startTime), finishedAt,
        ...(size !== null ? { size } : {}), ...(status !== undefined ? { status } : {}) })
      if (pending.size > MAX_PENDING) pending.delete(pending.keys().next().value)
    }
    if (pending.size) schedule()
  }
  const observer = new PerformanceObserver((list) => observe(list.getEntries()))
  function stop() {
    stopped = true
    if (timer) clearTimeout(timer)
    observer.disconnect()
    pending.clear()
    delivered.clear()
    removeEventListener('pagehide', onPageHide)
    removeEventListener('pageshow', onPageShow)
  }
  function onPageHide(event) {
    if (!event.persisted) { stop(); return }
    paused = true
    if (timer) clearTimeout(timer)
    timer = null
    observer.disconnect()
    pending.clear()
    delivered.clear()
  }
  function onPageShow(event) {
    if (!event.persisted || stopped) return
    paused = false
    synchronizeDocument()
    cutoff = performance.now()
    observer.observe({ type: 'resource', buffered: false })
  }
  globalThis.__vdownloadResourceCapture = stop
  addEventListener('pagehide', onPageHide)
  addEventListener('pageshow', onPageShow)
  observer.observe({ type: 'resource', buffered: true })
})()
