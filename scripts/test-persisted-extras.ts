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
