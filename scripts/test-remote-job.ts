import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveJobOwnedFile } from '../src/main/apiJobsModel'
import {
  canContinueRemoteJob,
  collectOwnedPaths,
  deriveJobRecord,
  emptyPlaylistError,
  isPathInside,
  remoteJobOutputDir,
  siblingTaskIds,
  type StoredRemoteJob,
} from '../src/main/remoteJobModel'

const root = join(tmpdir(), `vdl-remote-job-${Date.now()}`)
const downloadDir = join(root, 'library')
mkdirSync(downloadDir, { recursive: true })

function job(partial: Partial<StoredRemoteJob> = {}): StoredRemoteJob {
  const id = partial.id ?? 'abcd1234efgh5678'
  return {
    id,
    url: 'https://www.youtube.com/playlist?list=PLtest',
    title: null,
    error: null,
    downloadTaskIds: [],
    outputDir: remoteJobOutputDir(downloadDir, id),
    createdAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z',
    cancelled: false,
    attempts: {},
    lastTaskStatus: {},
    ...partial,
  }
}

const jobId = 'abcd1234efgh5678'
const jobDir = remoteJobOutputDir(downloadDir, jobId)
assert.equal(jobDir, join(downloadDir, 'remote-jobs', jobId))
assert.equal(isPathInside(downloadDir, jobDir), true)
assert.equal(isPathInside(downloadDir, downloadDir), true)
assert.equal(isPathInside(jobDir, downloadDir), false)

const hostnameDir = join(downloadDir, 'www.youtube.com')
mkdirSync(hostnameDir, { recursive: true })
writeFileSync(join(hostnameDir, 'other-job.mp4'), 'stolen')
writeFileSync(join(downloadDir, 'library-root.mp4'), 'library')

assert.deepEqual(collectOwnedPaths({ downloadDir, jobOutputDir: downloadDir, taskPaths: [downloadDir] }), [])
assert.deepEqual(collectOwnedPaths({ downloadDir, jobOutputDir: hostnameDir, taskPaths: [hostnameDir] }), [])
assert.deepEqual(
  collectOwnedPaths({ downloadDir, jobOutputDir: join(downloadDir, 'remote-jobs'), taskPaths: [join(downloadDir, 'remote-jobs')] }),
  [],
)
assert.deepEqual(
  collectOwnedPaths({
    downloadDir,
    jobOutputDir: jobDir,
    taskPaths: [hostnameDir, downloadDir, join(downloadDir, 'library-root.mp4')],
  }),
  [],
)

mkdirSync(jobDir, { recursive: true })
writeFileSync(join(jobDir, 'owned.mp4'), 'mine')
writeFileSync(join(hostnameDir, 'also-there.mp4'), 'nope')

const owned = collectOwnedPaths({
  downloadDir,
  jobOutputDir: jobDir,
  taskPaths: [hostnameDir, downloadDir, join(jobDir, 'owned.mp4')],
})
assert.deepEqual(owned, [jobDir])
assert.equal(resolveJobOwnedFile(owned, 'owned.mp4'), join(jobDir, 'owned.mp4'))
assert.equal(resolveJobOwnedFile(owned, 'other-job.mp4'), null)
assert.equal(resolveJobOwnedFile(owned, 'library-root.mp4'), null)
assert.equal(resolveJobOwnedFile([downloadDir], 'library-root.mp4'), join(downloadDir, 'library-root.mp4'))

rmSync(jobDir, { recursive: true, force: true })
const orphanedFile = join(downloadDir, 'remote-jobs', jobId, 'late.mp4')
mkdirSync(join(downloadDir, 'remote-jobs', jobId), { recursive: true })
writeFileSync(orphanedFile, 'late')
const fileOnly = collectOwnedPaths({
  downloadDir,
  jobOutputDir: join(downloadDir, 'remote-jobs', `${jobId}-missing`),
  taskPaths: [orphanedFile, join(downloadDir, 'library-root.mp4')],
})
assert.deepEqual(fileOnly, [])

const queued = deriveJobRecord(job(), [])
assert.equal(queued.status, 'queued')
assert.equal(queued.title, null)

const cancelled = deriveJobRecord(job({ cancelled: true, downloadTaskIds: ['t1'] }), [
  { id: 't1', status: 'downloading', progress: 10, title: 'X' },
])
assert.equal(cancelled.status, 'cancelled')

const collectionFail = deriveJobRecord(job({ downloadTaskIds: ['a', 'b'] }), [
  { id: 'a', status: 'error', progress: 0, title: 'A', error: 'boom' },
  { id: 'b', status: 'downloading', progress: 40, title: 'B' },
])
assert.equal(collectionFail.status, 'error')
assert.equal(typeof collectionFail.error === 'object' && collectionFail.error ? collectionFail.error.code : '', 'collection_item_failed')

const complete = deriveJobRecord(job({ downloadTaskIds: ['a', 'b'], title: 'List' }), [
  { id: 'a', status: 'complete', progress: 100, title: 'A' },
  { id: 'b', status: 'complete', progress: 100, title: 'B' },
])
assert.equal(complete.status, 'complete')
assert.equal(complete.progress, 100)

const pausedMapsQueued = deriveJobRecord(job({ downloadTaskIds: ['a'] }), [
  { id: 'a', status: 'paused', progress: 20, title: 'A' },
])
assert.equal(pausedMapsQueued.status, 'queued')

assert.equal(canContinueRemoteJob(job()), true)
assert.equal(canContinueRemoteJob(job({ cancelled: true })), false)
assert.equal(canContinueRemoteJob(job({ error: { code: 'download_failed', message: 'x' } })), false)
assert.equal(canContinueRemoteJob(null), false)

assert.deepEqual(siblingTaskIds(['a', 'b', 'c'], 'b'), ['a', 'c'])
assert.equal(emptyPlaylistError().code, 'empty_output')

rmSync(root, { recursive: true, force: true })
console.log('remote job adapter: ownership, status, enqueue guards passed')
