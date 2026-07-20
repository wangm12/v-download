import assert from 'node:assert/strict'
import { getQueueConcurrencyPolicy, planQueueAdmissions, type SchedulerTask } from '../src/main/groupedQueueScheduler'

const task = (id: string, playlistId: string | null, playlistIndex: number | null = null): SchedulerTask => ({ id, playlistId, playlistIndex })
const collection = (id: string, count: number, offset = 0) => Array.from({ length: count }, (_, i) => task(`${id}-${i + offset}`, id, i + offset))

assert.deepEqual(getQueueConcurrencyPolicy('turbo'), { individualLimit: 3, collectionLimit: 3, activeCollectionLimit: 3, theoreticalMax: 12 })
assert.deepEqual(getQueueConcurrencyPolicy('gentle'), { individualLimit: 1, collectionLimit: 1, activeCollectionLimit: 1, theoreticalMax: 2 })

const crossCollection = planQueueAdmissions([], [task('c-2', 'c', 2), task('a-0', 'a', 0), task('c-1', 'c', 1)], 'gentle')
assert.deepEqual(crossCollection, ['c-1'])
const crossCollectionBalanced = planQueueAdmissions([], [task('c-2', 'c', 2), task('a-0', 'a', 0), task('c-1', 'c', 1)], 'balanced')
assert.deepEqual(crossCollectionBalanced, ['c-1', 'c-2', 'a-0'])

const queued = [...collection('a', 4), ...collection('b', 4), ...collection('c', 4), ...collection('d', 4), task('i1', null), task('i2', null), task('i3', null), task('i4', null)]
const first = planQueueAdmissions([], queued, 'balanced')
assert.equal(first.length, 12)
assert.equal(first.filter((id) => id.startsWith('a-')).length, 3)
assert.equal(first.filter((id) => id.startsWith('b-')).length, 3)
assert.equal(first.filter((id) => id.startsWith('c-')).length, 3)
assert.equal(first.filter((id) => id.startsWith('d-')).length, 0)
assert.equal(first.filter((id) => id.startsWith('i')).length, 3)
assert.deepEqual(first.filter((id) => id.startsWith('a-')), ['a-0', 'a-1', 'a-2'])

const active = [...collection('a', 2), ...collection('b', 3), task('running-individual', null)]
const fill = planQueueAdmissions(active, [...collection('a', 3, 2), ...collection('b', 2, 3), ...collection('c', 2), task('next-individual', null)], 'balanced')
assert.equal(fill[0], 'a-2')
assert(!fill.includes('a-3'))
assert(!fill.some((id) => id.startsWith('b-')))
assert(fill.includes('next-individual'))
assert(fill.some((id) => id.startsWith('c-')))

const released = planQueueAdmissions([...collection('a', 3), task('running-individual', null)], [...collection('b', 1), ...collection('d', 2)], 'balanced')
assert(released.some((id) => id.startsWith('d-')))
assert(!released.some((id) => id.startsWith('b-')) || released.indexOf('b-0') < released.indexOf('d-0'))
assert.deepEqual(planQueueAdmissions([
  { ...task('paused', 'p'), status: 'paused' },
  { ...task('error', 'e'), status: 'error' },
  { ...task('cancelled', 'c'), status: 'cancelled' },
], [{ ...task('next', 'q'), status: 'queued' }], 'balanced'), ['next'])
console.log('grouped queue scheduler tests passed')
