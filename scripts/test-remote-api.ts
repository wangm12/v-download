import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { dispatchRemoteApi, type RemoteJobBackend } from '../src/main/remoteApiHandler'
import { createRemoteApiHttpHandler } from '../src/main/remoteApiHttp'
import {
  buildJobView,
  listJobArtifacts,
  type Artifact,
  type JobRecord,
} from '../src/main/apiJobsModel'

const token = 'unit-test-token-123456'
const root = join(tmpdir(), `vdl-remote-${Date.now()}`)
mkdirSync(root, { recursive: true })

const jobs = new Map<string, JobRecord>()
const artifactDirs = new Map<string, string>()

function ownedPaths(id: string): string[] {
  const dir = artifactDirs.get(id)
  return dir && existsSync(dir) ? [dir] : []
}

const backend: RemoteJobBackend = {
  getToken: () => token,
  createJob: (url) => {
    const id = 'createdjob1'
    jobs.set(id, {
      id,
      url,
      title: 'Queued',
      status: 'queued',
      progress: 0,
      error: null,
      updatedAt: new Date().toISOString(),
    })
    return { id, status: 'queued', url }
  },
  getJob: (id) => jobs.get(id) ?? null,
  artifactsFor: (id) => {
    const dir = artifactDirs.get(id)
    return dir ? listJobArtifacts(dir) : []
  },
  ownedPathsFor: ownedPaths,
  cancelJob: (id) => {
    const job = jobs.get(id)
    if (!job) return 'not_found'
    if (job.status === 'complete' || job.status === 'error' || job.status === 'cancelled') return 'not_cancellable'
    job.status = 'cancelled'
    return 'ok'
  },
}

jobs.set('queuedjob1', {
  id: 'queuedjob1',
  url: 'https://example.com/watch?v=1',
  title: null,
  status: 'queued',
  progress: 0,
  error: null,
  updatedAt: new Date().toISOString(),
})

const galleryDir = join(root, 'galleryjob1')
mkdirSync(galleryDir, { recursive: true })
writeFileSync(join(galleryDir, '001.jpg'), 'img-one')
writeFileSync(join(galleryDir, '002.jpg'), 'img-two')
jobs.set('galleryjob1', {
  id: 'galleryjob1',
  url: 'https://www.douyin.com/note/1',
  title: 'Album',
  status: 'complete',
  progress: 100,
  error: null,
  updatedAt: new Date().toISOString(),
})
artifactDirs.set('galleryjob1', galleryDir)

const fileDir = join(root, 'filejob123')
mkdirSync(fileDir, { recursive: true })
writeFileSync(join(fileDir, 'Clip.mp4'), 'video-bytes')
jobs.set('filejob123', {
  id: 'filejob123',
  url: 'https://example.com/v',
  title: 'Clip',
  status: 'complete',
  progress: 100,
  error: null,
  updatedAt: new Date().toISOString(),
})
artifactDirs.set('filejob123', fileDir)

jobs.set('errjob1234', {
  id: 'errjob1234',
  url: 'https://example.com/v',
  title: null,
  status: 'error',
  progress: 10,
  error: { code: 'collection_item_failed', message: 'item 2 failed', details: { index: 2, attempts: 3 } },
  updatedAt: new Date().toISOString(),
})

jobs.set('expiredjob1', {
  id: 'expiredjob1',
  url: 'https://example.com/v',
  title: 'Gone',
  status: 'complete',
  progress: 100,
  error: null,
  updatedAt: new Date().toISOString(),
})

const auth = { authorization: `Bearer ${token}` }

const denied = dispatchRemoteApi({ method: 'POST', url: '/v1/jobs', body: { url: 'https://example.com/watch?v=1' } }, backend)
assert.equal(denied.type, 'json')
if (denied.type === 'json') {
  assert.equal(denied.status, 401)
  assert.equal((denied.body as { error: { code: string } }).error.code, 'unauthorized')
}

const badUrl = dispatchRemoteApi({
  method: 'POST',
  url: '/v1/jobs',
  headers: auth,
  body: { url: 'ftp://x' },
}, backend)
assert.equal(badUrl.type, 'json')
if (badUrl.type === 'json') assert.equal(badUrl.status, 400)

const extra = dispatchRemoteApi({
  method: 'POST',
  url: '/v1/jobs',
  headers: auth,
  body: { url: 'https://example.com/watch?v=1', quality: '1080' },
}, backend)
assert.equal(extra.type, 'json')
if (extra.type === 'json') {
  assert.equal(extra.status, 400)
  assert.equal((extra.body as { error: { code: string } }).error.code, 'unexpected_field')
}

const created = dispatchRemoteApi({
  method: 'POST',
  url: '/v1/jobs',
  headers: auth,
  body: { url: 'https://example.com/watch?v=1' },
}, backend)
assert.equal(created.type, 'json')
if (created.type === 'json') {
  assert.equal(created.status, 202)
  assert.equal((created.body as { id: string }).id, 'createdjob1')
}

const pending = dispatchRemoteApi({ method: 'GET', url: '/v1/jobs/queuedjob1', headers: auth }, backend)
assert.equal(pending.type, 'json')
if (pending.type === 'json') {
  assert.equal(pending.status, 200)
  assert.equal((pending.body as { status: string; kind: null }).status, 'queued')
  assert.equal((pending.body as { kind: null }).kind, null)
}

const notReady = dispatchRemoteApi({ method: 'GET', url: '/v1/jobs/queuedjob1/file', headers: auth }, backend)
assert.equal(notReady.type, 'json')
if (notReady.type === 'json') assert.equal(notReady.status, 409)

const cancelled = dispatchRemoteApi({ method: 'POST', url: '/v1/jobs/queuedjob1/cancel', headers: auth }, backend)
assert.equal(cancelled.type, 'json')
if (cancelled.type === 'json') assert.equal((cancelled.body as { status: string }).status, 'cancelled')
const cancelAgain = dispatchRemoteApi({ method: 'POST', url: '/v1/jobs/queuedjob1/cancel', headers: auth }, backend)
assert.equal(cancelAgain.type, 'json')
if (cancelAgain.type === 'json') assert.equal(cancelAgain.status, 409)

const badId = dispatchRemoteApi({ method: 'GET', url: '/v1/jobs/short', headers: auth }, backend)
assert.equal(badId.type, 'json')
if (badId.type === 'json') assert.equal(badId.status, 400)

const gallery = dispatchRemoteApi({ method: 'GET', url: '/v1/jobs/galleryjob1', headers: auth }, backend)
assert.equal(gallery.type, 'json')
if (gallery.type === 'json') {
  assert.equal((gallery.body as { kind: string }).kind, 'gallery')
  assert.equal((gallery.body as { files: unknown[] }).files.length, 2)
  assert.equal((gallery.body as { expiresAt: null }).expiresAt, null)
}

const multi = dispatchRemoteApi({ method: 'GET', url: '/v1/jobs/galleryjob1/file', headers: auth }, backend)
assert.equal(multi.type, 'json')
if (multi.type === 'json') {
  assert.equal(multi.status, 409)
  assert.equal((multi.body as { error: { code: string } }).error.code, 'multiple_files')
}

const traversal = dispatchRemoteApi({ method: 'GET', url: '/v1/jobs/galleryjob1/files/..%2Fetc%2Fpasswd', headers: auth }, backend)
assert.equal(traversal.type, 'json')
if (traversal.type === 'json') assert.equal(traversal.status, 400)

const oneImage = dispatchRemoteApi({ method: 'GET', url: '/v1/jobs/galleryjob1/files/001.jpg', headers: auth }, backend)
assert.equal(oneImage.type, 'file')
if (oneImage.type === 'file') assert.equal(oneImage.name, '001.jpg')

const archive = dispatchRemoteApi({ method: 'GET', url: '/v1/jobs/galleryjob1/archive', headers: auth }, backend)
assert.equal(archive.type, 'archive')
if (archive.type === 'archive') {
  assert.equal(archive.status, 200)
  assert.equal(archive.files.length, 2)
}

const single = dispatchRemoteApi({ method: 'GET', url: '/v1/jobs/filejob123/file', headers: auth }, backend)
assert.equal(single.type, 'file')

const expired = dispatchRemoteApi({ method: 'GET', url: '/v1/jobs/expiredjob1', headers: auth }, backend)
assert.equal(expired.type, 'json')
if (expired.type === 'json') {
  assert.equal((expired.body as { expired: boolean }).expired, true)
  assert.deepEqual((expired.body as { files: unknown[] }).files, [])
}
const expiredFile = dispatchRemoteApi({ method: 'GET', url: '/v1/jobs/expiredjob1/file', headers: auth }, backend)
assert.equal(expiredFile.type, 'json')
if (expiredFile.type === 'json') assert.equal(expiredFile.status, 410)

const failed = dispatchRemoteApi({ method: 'GET', url: '/v1/jobs/errjob1234', headers: auth }, backend)
assert.equal(failed.type, 'json')
if (failed.type === 'json') {
  assert.equal((failed.body as { error: { code: string } }).error.code, 'collection_item_failed')
}

const view = buildJobView(jobs.get('galleryjob1')!, { artifacts: listJobArtifacts(galleryDir) as Artifact[] })
assert.equal(view.kind, 'gallery')
assert.equal(view.expiresAt, null)

async function testHttp(): Promise<void> {
  const httpServer = createServer(createRemoteApiHttpHandler(backend))
  await new Promise<void>((resolve, reject) => {
    httpServer.listen(0, '127.0.0.1', () => resolve())
    httpServer.once('error', reject)
  })
  const address = httpServer.address()
  assert.ok(address && typeof address === 'object')
  const port = address.port

  async function inject(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`http://127.0.0.1:${port}${path}`, init)
  }

  const health = await inject('/health')
  assert.equal(health.status, 200)
  assert.equal((await health.json() as { ok: boolean; service: string }).service, 'v-download-remote-api')

  const apiHealth = await inject('/api/health')
  assert.equal(apiHealth.status, 200)

  const missingRoute = await inject('/v1/unknown', { headers: { authorization: `Bearer ${token}` } })
  assert.equal(missingRoute.status, 404)

  const missingJob = await inject('/v1/jobs/missingjob1', { headers: { authorization: `Bearer ${token}` } })
  assert.equal(missingJob.status, 404)

  const wrongToken = await inject('/v1/jobs', {
    method: 'POST',
    headers: { authorization: 'Bearer wrong-token', 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.com/a' }),
  })
  assert.equal(wrongToken.status, 401)

  const invalidJson = await inject('/v1/jobs', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: '{not-json',
  })
  assert.equal(invalidJson.status, 400)

  const httpDenied = await inject('/v1/jobs', { method: 'POST', body: JSON.stringify({ url: 'https://example.com/a' }) })
  assert.equal(httpDenied.status, 401)

  const httpCreated = await inject('/v1/jobs', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.com/watch?v=1' }),
  })
  assert.equal(httpCreated.status, 202)

  const httpQueued = await inject('/v1/jobs/queuedjob1', { headers: { authorization: `Bearer ${token}` } })
  assert.equal(httpQueued.status, 200)
  assert.equal((await httpQueued.json() as { status: string }).status, 'cancelled')

  const httpSingle = await inject('/v1/jobs/filejob123/file', { headers: { authorization: `Bearer ${token}` } })
  assert.equal(httpSingle.status, 200)
  assert.equal(httpSingle.headers.get('content-type'), 'video/mp4')
  assert.equal(await httpSingle.text(), 'video-bytes')

  const httpCancelMissing = await inject('/v1/jobs/missingjob1/cancel', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  })
  assert.equal(httpCancelMissing.status, 404)

  const httpGallery = await inject('/v1/jobs/galleryjob1', { headers: { authorization: `Bearer ${token}` } })
  assert.equal(httpGallery.status, 200)
  assert.equal((await httpGallery.json() as { kind: string }).kind, 'gallery')

  const httpFile = await inject('/v1/jobs/galleryjob1/file', { headers: { authorization: `Bearer ${token}` } })
  assert.equal(httpFile.status, 409)

  const httpOne = await inject('/v1/jobs/galleryjob1/files/001.jpg', { headers: { authorization: `Bearer ${token}` } })
  assert.equal(httpOne.status, 200)
  assert.equal(httpOne.headers.get('content-type'), 'image/jpeg')

  const httpZip = await inject('/v1/jobs/galleryjob1/archive', { headers: { authorization: `Bearer ${token}` } })
  assert.equal(httpZip.status, 200)
  assert.equal(httpZip.headers.get('content-type'), 'application/zip')
  const zipBytes = Buffer.from(await httpZip.arrayBuffer())
  assert.ok(zipBytes.length > 0)

  const httpTraverse = await inject('/v1/jobs/galleryjob1/files/..%2Fetc%2Fpasswd', { headers: { authorization: `Bearer ${token}` } })
  assert.equal(httpTraverse.status, 400)

  const httpExpired = await inject('/v1/jobs/expiredjob1/file', { headers: { authorization: `Bearer ${token}` } })
  assert.equal(httpExpired.status, 410)

  await new Promise<void>((resolve, reject) => httpServer.close((err) => (err ? reject(err) : resolve())))
  rmSync(root, { recursive: true, force: true })
}

void testHttp().then(() => {
  console.log('remote api tests passed')
}).catch((err) => {
  console.error(err)
  process.exitCode = 1
})
