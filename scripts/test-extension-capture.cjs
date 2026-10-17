const assert = require('node:assert/strict')
const { backgroundHarness } = require('./extension-background-harness.cjs')
;(async () => {
  const page = 'https://capture.fixture.test/watch?course=a%20b'
  const url = 'https://cdn.fixture.test/master.m3u8?token=a%2fb'
  const requestId = 'a'.repeat(48)
  const command = { requestId, pageUrl: page, title: 'Original task', planName: '360p', expiresAt: Date.now() + 600000 }
  const tabs = [{ id: 1, url: page, title: 'Original task' }]
  const storage = { appCapability: 'b'.repeat(64) }
  const requests = []
  const fetch = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : null
    requests.push({ url, body })
    if (url.endsWith('/media-capture-command')) return new Response(JSON.stringify({ command }))
    if (url.endsWith('/media-inspect')) return new Response(JSON.stringify({ data: { kind: 'hls-master', resources: [] } }))
    return new Response('{}')
  }
  const worker = backgroundHarness({ storage, tabs, fetch })
  const landing = `http://127.0.0.1:18765/media-capture-landing?requestId=${requestId}`
  assert.equal((await worker.message({ type: 'REQUEST_MEDIA_CAPTURE', requestId }, { tab: { id: 10, url: 'https://evil.test/' } })).ok, false)
  assert.equal((await worker.message({ type: 'REQUEST_MEDIA_CAPTURE', requestId }, { tab: { id: 10, url: landing } })).ok, true)
  tabs[0] = { id: 2, url: page, title: 'Original task' }
  const request = { requestId: 'owned', tabId: 2, frameId: 0, documentId: 'document-2', url, type: 'xmlhttprequest' }
  await worker.events.frameCommitted.emit({ tabId: 2, frameId: 0, url: page, documentId: 'document-2', timeStamp: Date.now() })
  await worker.events.beforeRequest.emit(request)
  await worker.events.completed.emit({ ...request, statusCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/vnd.apple.mpegurl' }] })
  const snapshot = await worker.message({ type: 'GET_MEDIA' })
  assert.equal(snapshot.capture.requestId, requestId)
  assert.equal(snapshot.media.length, 1)
  const item = snapshot.media[0]
  const sender = { url: 'chrome-extension://test-extension/popup.html' }
  assert.equal((await worker.message({ type: 'INSPECT_MEDIA', item }, { url: page })).ok, false)
  assert.equal((await worker.message({ type: 'INSPECT_MEDIA', item }, sender)).ok, true)
  assert.equal(requests.find(r => r.url.endsWith('/media-inspect')).body.referer, page)
  assert.equal((await worker.message({ type: 'INSPECT_MEDIA', item: { ...item, url: 'https://other.test/a.m3u8' } }, sender)).ok, false)
  assert.equal((await worker.message({ type: 'RECAPTURE_MEDIA', item, requestId }, sender)).ok, false)
  assert.equal((await worker.message({ type: 'DOWNLOAD_VIDEO', url }, { tab: tabs[0] })).ok, false, 'bound tabs must not accidentally create a new task through an overlay')
  const reloaded = backgroundHarness({ storage, tabs, fetch })
  assert.equal((await reloaded.message({ type: 'GET_MEDIA' })).capture.requestId, requestId)
  assert.equal((await worker.message({ type: 'RECAPTURE_MEDIA', item, requestId, confirmed: true }, sender)).ok, true)
  const sent = requests.find(r => r.url.endsWith('/media-capture-complete')).body
  assert.equal(sent.url, url)
  assert.equal(sent.sourceContext.pageUrl, page)
  assert.equal(sent.selection, undefined)
  assert.equal(sent.outputDir, undefined)
  assert.equal((await worker.message({ type: 'GET_MEDIA' })).capture, null)
  storage.mediaCaptureBindings = { 2: command }
  assert.equal((await worker.message({ type: 'CANCEL_MEDIA_CAPTURE' }, sender)).ok, true)
  assert.equal((await worker.message({ type: 'GET_MEDIA' })).capture, null)
  assert.ok(requests.some(r => r.url.endsWith('/media-capture-cancel') && r.body.requestId === requestId), 'leaving capture mode cancels its main-process session')
  await worker.events.frameCommitted.emit({ tabId: 2, frameId: 0, url: page, documentId: 'replacement-document', timeStamp: Date.now() })
  assert.equal((await worker.message({ type: 'INSPECT_MEDIA', item }, sender)).ok, false, 'a stale document cannot be inspected or submitted as the current candidate')
  console.log('extension inspection and bound capture workflow: ok')
})().catch(error => { console.error(error); process.exitCode = 1 })
