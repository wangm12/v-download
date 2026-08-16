import assert from 'node:assert/strict'
import { InfoResolutionScheduler } from '../src/main/infoResolutionScheduler'

async function main(): Promise<void> {
  const pending = new Map<string, () => void>()
  const started: string[] = []
  const worker = async (id: string): Promise<void> => {
    started.push(id)
    await new Promise<void>((resolve) => pending.set(id, resolve))
  }

  const scheduler = new InfoResolutionScheduler(worker, { maxConcurrent: 2 })
  assert.equal(scheduler.enqueue('one'), true)
  assert.equal(scheduler.enqueue('two'), true)
  assert.equal(scheduler.enqueue('three'), true)
  assert.deepEqual(started, ['one', 'two'], 'only two resolver workers start immediately')
  assert.deepEqual(scheduler.queuedIds, ['three'], 'third resolver stays FIFO queued')

  pending.get('one')!()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(started, ['one', 'two', 'three'], 'next resolver starts after a worker releases its slot')

  assert.equal(scheduler.enqueue('four'), true)
  assert.equal(scheduler.cancel('four'), true)
  assert.equal(scheduler.isQueued('four'), false, 'cancelled queued resolver never starts')

  pending.get('two')!()
  pending.get('three')!()
  await new Promise((resolve) => setImmediate(resolve))

  const retryPending: Array<() => void> = []
  const retryStarts: string[] = []
  const cancelled: string[] = []
  const retryScheduler = new InfoResolutionScheduler(async (id) => {
    retryStarts.push(id)
    await new Promise<void>((resolve) => retryPending.push(resolve))
  }, { maxConcurrent: 2, onCancelActive: (id) => cancelled.push(id) })
  retryScheduler.enqueue('retry-me')
  assert.equal(retryScheduler.retry('retry-me'), true)
  assert.deepEqual(cancelled, ['retry-me'], 'retry aborts the active attempt before re-queueing it')
  retryPending.shift()!()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(retryStarts, ['retry-me', 'retry-me'], 'retry schedules a fresh attempt')
  retryPending.shift()!()
  await new Promise((resolve) => setImmediate(resolve))

  console.log('info resolution scheduler: concurrency, FIFO, and queued cancellation passed')
}

void main()
