const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { backgroundHarness } = require('./extension-background-harness.cjs')
const wire = 'https://cdn.fixture.test/master.m3u8?token=a%2fb&label=hello%20world'
const page = 'https://fixture.test/watch?lesson=early%20capture#player'
const iframe = 'https://frame.fixture.test/embed?lesson=early%20capture'
const now = Date.now()
const entry = { url: wire, startedAt: now - 30, finishedAt: now - 20, status: 200, size: 236 }

async function contentCapture({ readyState = 'loading', resources, initialError = false, bfcache = false }) {
  const sent = []
  let observeOptions
  let stopped = false
  let callback
  const lifecycle = new Map()
  const runtime = { lastError: null, sendMessage(message, done) {
    sent.push(message)
    runtime.lastError = initialError && sent.length === 1 ? { message: 'Receiving end does not exist' } : null
    done(runtime.lastError ? undefined : { ok: true })
    runtime.lastError = null
  } }
  const context = vm.createContext({ URL, URLSearchParams, location: { href: page, protocol: 'https:' },
    document: { readyState }, performance: { timeOrigin: now - 1000, now: () => 100,
      getEntriesByType: () => [{ name: page }] }, chrome: { runtime },
    setTimeout, clearTimeout, addEventListener(name, fn) { lifecycle.set(name, fn) }, removeEventListener(name) { lifecycle.delete(name) },
    PerformanceObserver: class { constructor(fn) { callback = fn } observe(options) { observeOptions = options } disconnect() { stopped = true } } })
  vm.runInContext(fs.readFileSync('extension/media-patterns.js', 'utf8'), context)
  vm.runInContext(fs.readFileSync('extension/content-media-capture.js', 'utf8'), context)
  callback({ getEntries: () => resources })
  const deadline = Date.now() + 1500
  while (sent.length < (initialError ? 2 : 1) && Date.now() < deadline) await new Promise(r => setTimeout(r, 20))
  assert.equal(observeOptions.buffered, true)
  if (bfcache) {
    lifecycle.get('pagehide')({ persisted: true })
    callback({ getEntries: () => resources })
    lifecycle.get('pageshow')({ persisted: true })
    assert.equal(observeOptions.buffered, false, 'BFCache restore observes only new requests')
    callback({ getEntries: () => [{ ...resources[0], name: wire + '&restored=1', startTime: 110, responseEnd: 120 }] })
    while (sent.length < 2 && Date.now() < deadline) await new Promise(r => setTimeout(r, 20))
  }
  context.__vdownloadResourceCapture()
  assert.equal(stopped, true)
  assert.equal(lifecycle.size, 0, 'disposing the collector releases its lifecycle listeners')
  return sent
}

;(async () => {
  const resource = { entryType: 'resource', name: wire, startTime: 2, responseEnd: 3, responseStatus: 200, encodedBodySize: 236 }
  const captured = await contentCapture({ resources: [resource, { ...resource, name: 'https://cdn.fixture.test/404.m3u8', responseStatus: 404 }], initialError: true })
  assert.equal(captured.length, 2)
  assert.equal(captured[1].entries.length, 1)
  assert.equal(captured[1].entries[0].url, wire, 'buffered document-start resources retain raw transport encoding')
  const late = await contentCapture({ readyState: 'complete', resources: [resource, { ...resource, name: wire + '&new=1', startTime: 110, responseEnd: 120 }] })
  assert.equal(late[0].entries.length, 1, 'late injection cannot replay unattributed historical resources')
  assert.match(late[0].entries[0].url, /new=1$/)
  const restoredPage = await contentCapture({ resources: [resource], bfcache: true })
  assert.equal(restoredPage.length, 2)
  assert.match(restoredPage[1].entries[0].url, /restored=1$/)

  let frame = { url: iframe, documentId: 'frame-document' }
  const worker = backgroundHarness({ tabs: [{ id: 1, url: page, title: 'Early resources' }], getFrame: async () => frame, fetch: async () => new Response('{}') })
  const sender = { tab: { id: 1, url: page, title: 'Early resources' }, frameId: 7, documentId: 'frame-document', url: iframe }
  const report = { type: 'OBSERVED_MEDIA_RESOURCES', documentUrl: iframe, entries: [entry] }
  await worker.events.frameCommitted.emit({ tabId: 1, frameId: 7, url: iframe, documentId: 'frame-document', timeStamp: now })
  assert.equal((await worker.message(report, sender)).accepted, 1, 'a real resource observation needs no matching webRequest event')
  let rows = (await worker.message({ type: 'GET_MEDIA' })).media
  assert.equal(rows.length, 1)
  assert.equal(rows[0].source, 'performance')
  assert.equal(rows[0].sourceContext.documentUrl, iframe)
  assert.equal(rows[0].sourceContext.documentId, 'frame-document')
  assert.equal(rows[0].mime, '', 'Resource Timing cannot claim response MIME')
  assert.equal((await worker.message({ ...report, entries: Array(33).fill(entry) }, sender)).ok, false)
  assert.equal((await worker.message(report, { ...sender, url: page })).ok, false)
  assert.equal((await worker.message({ ...report, entries: [{ ...entry, status: 404 }] }, sender)).accepted, 0)
  frame = { url: iframe + '&route=new', documentId: 'frame-document' }
  assert.equal((await worker.message(report, sender)).accepted, 0, 'stale iframe URLs cannot gain current-source claims')
  frame = { url: iframe, documentId: 'frame-document', documentLifecycle: 'cached' }
  assert.equal((await worker.message(report, sender)).accepted, 0, 'a retained BFCache document cannot claim the current frame')
  frame = { url: iframe, documentId: 'replacement-document', documentLifecycle: 'active' }
  assert.equal((await worker.message(report, sender)).accepted, 0, 'reusing a frame ID cannot reattribute the old document')
  frame = { url: iframe, documentId: 'frame-document' }
  const request = { requestId: 'full-response', tabId: 1, frameId: 7, documentId: 'frame-document', documentUrl: iframe,
    type: 'xmlhttprequest', url: wire, initiator: 'https://frame.fixture.test' }
  await worker.events.beforeRequest.emit(request)
  await worker.events.completed.emit({ ...request, statusCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/vnd.apple.mpegurl' }] })
  rows = (await worker.message({ type: 'GET_MEDIA' })).media
  assert.equal(rows.length, 1, 'network and performance observations share discovery identity')
  assert.equal(rows[0].source, 'network')
  await worker.message({ ...report, entries: [{ ...entry, finishedAt: Date.now() }] }, sender)
  rows = (await worker.message({ type: 'GET_MEDIA' })).media
  assert.equal(rows.length, 1)
  assert.equal(rows[0].source, 'network', 'a late performance report cannot discard response headers')
  const cached = { ...rows[0], sourceContext: { ...rows[0].sourceContext, navigationEpoch: 4 } }
  const restarted = backgroundHarness({ tabs: [{ id: 1, url: page }], getFrame: async () => frame,
    storage: { tabMediaCache: { 1: { __pageUrl: page, __navigationEpoch: 4, 7: [cached] } } }, fetch: async () => new Response('{}') })
  await restarted.message(report, sender)
  const restoredRows = (await restarted.message({ type: 'GET_MEDIA' })).media
  assert.equal(restoredRows.length, 1, 'a worker restart preserves discovery identity without requiring an in-flight network request')
  assert.equal(restoredRows[0].sourceContext.navigationEpoch, 4)
  await worker.events.frameHistory.emit({ tabId: 1, frameId: 7, url: iframe, timeStamp: Date.now() })
  assert.equal((await worker.message(report, sender)).accepted, 0, 'timings from before an SPA transition remain stale')
  console.log('extension early capture: buffered resources, bounded retries, sender ownership, navigation cutoffs and network precedence passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
