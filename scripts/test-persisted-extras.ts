import assert from 'node:assert/strict'
import { pickPersistedExtras } from '../src/main/persistedExtras'

const persisted = pickPersistedExtras({
  skipAdoptExisting: true,
  ytdlpId: '5fyy9t7v304',
  includeNote: true,
  mediaType: 'hls',
  referer: 'https://example.com/watch',
  unknownFlag: true
})

assert.equal(persisted.skipAdoptExisting, true)
assert.equal(persisted.ytdlpId, '5fyy9t7v304')
assert.equal(persisted.includeNote, true)
assert.equal(persisted.mediaType, 'hls')
assert.equal(persisted.referer, 'https://example.com/watch')
assert.equal(persisted.unknownFlag, undefined)

const empty = pickPersistedExtras({ skipAdoptExisting: false })
assert.equal(empty.skipAdoptExisting, undefined)

console.log('persisted extras tests passed')

const browserSource = { version: 1, pageUrl: 'https://site.test/watch?q=hello%20world#video', documentUrl: 'https://frame.test/embed?token=a%2fb', tabId: 4, frameId: 7, documentId: 'doc', navigationEpoch: 2, observedAt: 100 }
assert.deepEqual(pickPersistedExtras({ sourceContext: browserSource }).sourceContext, browserSource)
assert.throws(() => pickPersistedExtras({ sourceContext: { ...browserSource, headers: { Cookie: 'invalid-context-field' } } }))

const recaptured = pickPersistedExtras({ recaptureRevision: 2, recaptureAt: "2026-10-15T12:00:00Z", candidate: { url: "https://cdn.test/new.m3u8?token=a%2fb", protocol: "hls" }, customHeaders: { Cookie: "do-not-save", Referer: "https://source.test/player?chapter=one%20two" } })
assert.equal(recaptured.recaptureRevision, 2)
assert.equal((recaptured.candidate as { url: string }).url, "https://cdn.test/new.m3u8?token=a%2fb")
assert.deepEqual(recaptured.customHeaders, { Referer: "https://source.test/player?chapter=one%20two" })
assert.equal(pickPersistedExtras({ recaptureRevision: "../../other" }).recaptureRevision, undefined)
