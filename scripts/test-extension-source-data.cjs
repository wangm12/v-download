const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { backgroundHarness } = require('./extension-background-harness.cjs')
const context = vm.createContext({ URL, URLSearchParams })
vm.runInContext(fs.readFileSync('extension/media-patterns.js', 'utf8'), context)
const mp = context.VDownloadMediaPatterns
const wire = 'https://cdn.fixture.test/media.m3u8?token=a%2fb&label=hello%20world&utm_source=capture'
const page = 'https://site.fixture.test/watch/lesson?course=long%20course#player'
const documentUrl = 'https://player.fixture.test/embed/lesson?entry=one%20two#video'
const sourceContext = { version: 1, pageUrl: page, documentUrl, tabId: 1, frameId: 7, documentId: 'document-7', navigationEpoch: 2, observedAt: 100 }
let rows = [{ url: wire, type: 'hls', source: 'network', sourceContext, confidence: 99, timestamp: 100 }]
for (let i = 0; i < 10; i++) {
  rows = mp.mergeCandidates(rows.concat(rows))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].url, wire)
  assert.equal(rows[0].confidence, 39, 'rank depends on source facts, never the previous rank')
}
assert.equal(mp.classifyMediaRole(rows, { pageUrl: page })[0].role, 'main', 'the requesting iframe is still owned by the captured top-level page')
assert.equal(mp.mergeCandidates([...rows, { ...rows[0], sourceContext: { ...sourceContext, frameId: 8 } }]).length, 2, 'the same resource in another frame retains its own provenance')
const independent = [1, 2, 3].map(i => ({ url: `https://cdn.fixture.test/episode-${i}/master.m3u8`, type: 'hls', source: 'network', timestamp: i }))
independent.push({ url: 'https://cdn.fixture.test/independent.mp4', type: 'mp4', size: 200000, source: 'network' })
const labeled = mp.classifyMediaRole(mp.mergeCandidates(independent), { pageUrl: page, pageTitle: 'Lesson' })
assert.equal(labeled.filter(c => c.role === 'variant').length, 0)
assert.equal(mp.selectSmartOverlayMedia(labeled).length, 4, 'unknown relationships and short independent MP4s remain visible')
const refresh = mp.pickRefreshedSniffedCandidate(rows[0], [{ ...rows[0], url: wire.replace('token=a%2fb', 'token=new'), sourceContext: { ...sourceContext, frameId: 8 }, timestamp: 200 }])
assert.equal(refresh.url, wire, 'refresh cannot switch to a different frame')
assert.equal(mp.documentCandidate({ url: wire, type: 'hls' }, rows, documentUrl).url, wire, 'DOM and network observations of the same document can share one candidate')
assert.equal(mp.documentCandidate({ url: wire, type: 'hls' }, rows, page), undefined, 'the same media URL in an iframe cannot claim the top-level element')
;(async () => {
  const sent = []
  const worker = backgroundHarness({ storage: { appCapability: 'a'.repeat(48) }, tabs: [{ id: 1, url: page, title: 'Lesson' }], getFrame: async () => ({ documentId: 'document-7', url: documentUrl }), fetch: async (url, init = {}) => {
    if (url.endsWith('/download')) sent.push(JSON.parse(init.body))
    return new Response('{}', { status: 200 })
  } })
  await worker.message({ type: 'GET_MEDIA' })
  const request = { requestId: 'owned-1', tabId: 1, frameId: 7, documentId: 'document-7', url: wire, type: 'xmlhttprequest', initiator: 'https://player.fixture.test' }
  await worker.events.beforeRequest.emit(request)
  await worker.events.completed.emit({ ...request, statusCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/vnd.apple.mpegurl' }] })
  const found = await worker.message({ type: 'GET_MEDIA' })
  assert.equal(found.media.length, 1)
  assert.equal(found.media[0].url, wire)
  assert.equal(found.media[0].sourceContext.documentUrl, documentUrl)
  assert.equal(found.media[0].sourceContext.frameId, 7)
  assert.equal((await worker.message({ type: 'DOWNLOAD_MEDIA', items: found.media, tabUrl: page, tabTitle: 'Lesson' })).ok, true)
  assert.equal(sent[0].url, wire)
  assert.equal(sent[0].referer, documentUrl.split('#')[0])
  assert.equal(sent[0].sourceContext.pageUrl, page)
  assert.equal(sent[0].sourceContext.documentId, 'document-7')
  const content = await worker.message({ type: 'DOWNLOAD_MEDIA_FROM_CONTENT', item: mp.mediaItemForDownload(found.media[0]) }, { tab: { id: 1, url: page, title: 'Lesson' }, frameId: 0, url: page })
  assert.equal(content.ok, true, JSON.stringify(content))
  assert.deepEqual(sent[1], sent[0], 'popup and overlay preserve the same captured source')
  const { documentId: _capturedId, ...withoutId } = found.media[0].sourceContext
  await worker.message({ type: 'DOWNLOAD_MEDIA_FROM_CONTENT', item: mp.mediaItemForDownload({ ...found.media[0], sourceContext: withoutId }) },
    { tab: { id: 1, url: page, title: 'Lesson' }, frameId: 0, documentId: 'top-document', url: page })
  assert.equal(sent[2].sourceContext.documentId, undefined, 'missing iframe identity cannot be filled with the top-level sender document')
  await worker.message({ type: 'DOWNLOAD_MEDIA_FROM_CONTENT', item: { url: wire, type: 'hls', sourceContext: { version: 1, documentUrl: page } } },
    { tab: { id: 1, url: page, title: 'Lesson' }, frameId: 0, documentId: 'top-document', url: page })
  assert.equal(sent[3].sourceContext.documentId, 'top-document', 'DOM-only source claims gain IDs only from their own document')
  assert.equal(sent[3].sourceContext.pageUrl, page)
  const invalid = await worker.message({ type: 'DOWNLOAD_MEDIA', items: [{ ...found.media[0], sourceContext: { version: 2 } }], tabUrl: page })
  assert.equal(invalid.ok, false, 'invalid batch provenance responds instead of hanging')
  const stale = { ...request, requestId: 'stale-frame' }
  await worker.events.beforeRequest.emit(stale)
  await worker.events.frameHistory.emit({ tabId: 1, frameId: 7 })
  await worker.events.completed.emit({ ...stale, statusCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/vnd.apple.mpegurl' }] })
  assert.equal((await worker.message({ type: 'GET_MEDIA' })).media.length, 0, 'a changed iframe cannot inherit the old route candidate')
  const savedCandidate = { ...found.media[0], timestamp: Date.now() }
  const restored = (extra = {}) => backgroundHarness({ fetch: async () => new Response('{}'),
    tabs: [{ id: 1, url: page, title: 'Lesson' }],
    getFrame: async () => ({ documentId: 'document-7', url: documentUrl }),
    storage: { tabMediaCache: { 1: { __pageUrl: page, 7: [savedCandidate] } },
      tabMediaRequestEpochs: { tabs: { 1: { epoch: 2, pageUrl: page } }, requests: [{ requestId: 'restored', tabId: 1,
        epoch: 2, requestKind: 'xmlhttprequest', startedAt: Date.now(), frameId: 7, documentId: 'document-7', documentUrl }] } }, ...extra })
  const restarted = restored()
  assert.equal((await restarted.message({ type: 'GET_MEDIA' })).media[0].sourceContext.documentUrl, documentUrl, 'worker cache restoration retains full provenance')
  const navigating = restored()
  await navigating.events.frameHistory.emit({ tabId: 1, frameId: 7 })
  assert.equal((await navigating.message({ type: 'GET_MEDIA' })).media.length, 0, 'hydration cannot resurrect an invalidated iframe')
  const changedFrame = restored({ getFrame: async () => ({ documentId: 'document-7', url: documentUrl + '&route=new' }) })
  await changedFrame.events.frameHistory.emit({ tabId: 1, frameId: 7 })
  await changedFrame.events.completed.emit({ ...request, requestId: 'restored', statusCode: 200,
    responseHeaders: [{ name: 'content-type', value: 'application/vnd.apple.mpegurl' }] })
  assert.equal((await changedFrame.message({ type: 'GET_MEDIA' })).media.length, 0, 'restored requests verify the live frame route before accepting a late completion')
  const nextPage = page.replace('lesson?', 'next?')
  await worker.events.frameCommitted.emit({ tabId: 1, frameId: 0, url: nextPage })
  const early = { ...request, requestId: 'early-new-document', frameId: 0, documentId: 'new-document' }
  await worker.events.beforeRequest.emit(early)
  await worker.events.tabUpdated.emit(1, { url: nextPage }, { id: 1, url: nextPage, title: 'Next' })
  await worker.events.completed.emit({ ...early, statusCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/vnd.apple.mpegurl' }] })
  assert.equal((await worker.message({ type: 'GET_MEDIA' })).media[0].sourceContext.pageUrl, nextPage, 'late tabs.onUpdated cannot erase requests owned by the newly committed document')
  console.log('extension source data: raw URLs, idempotent scoring, independent candidates, network capture and both submit paths passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
