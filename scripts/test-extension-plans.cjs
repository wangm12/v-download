const assert = require('node:assert/strict')
const { backgroundHarness } = require('./extension-background-harness.cjs')
;(async () => {
  const calls = []
  const worker = backgroundHarness({ storage: { appCapability: 'a'.repeat(48), downloadPlanId: 'custom:audio', downloadPlanRevision: 2 }, fetch: async (url, init = {}) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(url.endsWith('/download-plans') ? { version: 1, defaultId: null, plans: [] } : { error: 'Download plan changed. Refresh.' }), { status: url.endsWith('/download-plans') ? 200 : 400 })
  } })
  assert.equal((await worker.message({ type: 'GET_DOWNLOAD_PLANS' })).ok, true)
  const query = calls.find(call => call.url.endsWith('/download-plans'))
  assert.equal(query.init.method, 'POST', 'plan reads must use an Origin-bearing browser request')
  assert.equal(query.init.headers['X-VDownload-Capability'], 'a'.repeat(48))
  let queries = 0
  const refreshed = backgroundHarness({ storage: { appCapability: 'a'.repeat(64) }, fetch: async (url, init = {}) => {
    if (url.endsWith('/pair')) return new Response(JSON.stringify({ capability: 'b'.repeat(64) }))
    assert.equal(init.method, 'POST')
    queries++
    return init.headers['X-VDownload-Capability'] === 'b'.repeat(64)
      ? new Response(JSON.stringify({ version: 1, defaultId: null, plans: [] })) : new Response('{}', { status: 403 })
  } })
  assert.equal((await refreshed.message({ type: 'GET_DOWNLOAD_PLANS' })).ok, true)
  assert.equal(queries, 2, 'stale credentials get exactly one authenticated retry')
  const result = await worker.message({ type: 'DOWNLOAD_MEDIA_FROM_CONTENT', item: { url: 'https://fixture.test/a.mp4', type: 'mp4' } }, { tab: { id: 1, url: 'https://fixture.test/' } })
  assert.equal(result.ok, false)
  assert.match(result.error, /plan changed/i)
  assert.equal(worker.wakes.length, 0, 'permanent policy errors never trigger app wake or cold retry')
  const downloads = calls.filter(call => call.url.endsWith('/download'))
  assert.equal(downloads.length, 1)
  assert.equal(JSON.parse(downloads[0].init.body).planId, 'custom:audio')
  assert.equal(JSON.parse(downloads[0].init.body).planRevision, 2)
  for (const surfacedWake of [true, false]) {
    let attempt = 0
    const bodies = []
    const cold = backgroundHarness({ storage: { appCapability: 'a'.repeat(48), downloadPlanId: 'custom:before', downloadPlanRevision: 1 }, fetch: async (url, init = {}) => {
      if (url.endsWith('/download')) {
        bodies.push(JSON.parse(init.body)); attempt++
        cold.storage.downloadPlanId = 'custom:after'
        if (attempt < 3) return new Response('{}', { status: 503 })
      }
      return new Response('{}', { status: 200 })
    } })
    assert.equal((await cold.message({ type: 'DOWNLOAD_MEDIA_FROM_CONTENT', surfacedWake, item: { url: 'https://fixture.test/cold.mp4', type: 'mp4' } }, { tab: { id: 1, url: 'https://fixture.test/' } })).ok, true)
    assert.equal(cold.wakes.length, surfacedWake ? 0 : 1, 'the caller and background never both wake the app')
    assert.ok(bodies.length >= 3)
    assert.ok(bodies.every(body => body.planId === 'custom:before' && body.planRevision === 1), 'cold retries retain the initial plan choice')
  }
  console.log('extension plans: shared worker validation, frozen revision and permanent error propagation passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
