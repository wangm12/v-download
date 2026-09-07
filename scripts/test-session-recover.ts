import assert from 'node:assert/strict'
import { planSessionRecover } from '../src/main/sessionRecover.ts'
import { parseSessionInterrupted } from '../src/preload/sessionInterrupted.ts'

assert.deepEqual(
  planSessionRecover([{ id: 'dl-1', status: 'downloading' }]),
  { recoveredIds: ['dl-1'] },
  'downloading → recovered'
)

for (const status of ['paused', 'cancelled', 'queued', 'error', 'complete', 'resolving', 'ready', 'interrupted']) {
  assert.deepEqual(
    planSessionRecover([{ id: `keep-${status}`, status }]),
    { recoveredIds: [] },
    `${status} → not recovered`
  )
}

assert.deepEqual(
  planSessionRecover([
    { id: 'hist-interrupted', status: 'interrupted' },
    { id: 'live-1', status: 'downloading' },
    { id: 'queued-1', status: 'queued' },
    { id: 'live-2', status: 'downloading' },
    { id: 'resolving-1', status: 'resolving' }
  ]),
  { recoveredIds: ['live-1', 'live-2'] },
  'recovered ids are only the ones that were downloading'
)

assert.deepEqual(planSessionRecover([]), { recoveredIds: [] }, 'empty input → []')

assert.deepEqual(
  parseSessionInterrupted({ count: 2, ids: ['a', 'b'] }),
  { count: 2, ids: ['a', 'b'] },
  'valid session-interrupted payload'
)
assert.equal(parseSessionInterrupted({ count: 0, ids: [] })?.count, 0)
assert.equal(parseSessionInterrupted(null), null)
assert.equal(parseSessionInterrupted({ count: -1, ids: [] }), null)
assert.equal(parseSessionInterrupted({ count: 1.5, ids: ['a'] }), null)
assert.equal(parseSessionInterrupted({ count: Infinity, ids: [] }), null)
assert.equal(parseSessionInterrupted({ count: 1, ids: [1] }), null)
assert.equal(parseSessionInterrupted({ count: 1, ids: 'a' }), null)

console.log('session-recover tests passed')
