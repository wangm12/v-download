import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  JOB_ID_PATTERN,
  classifyArtifacts,
  classifyFailureMessage,
  classifyInputUrl,
  classifyYtdlpProbe,
  collectionTooLarge,
  contentTypeForName,
  isIgnoredArtifactName,
  isSafeFileName,
  listJobArtifacts,
  parseJobCreateBody,
  parseJobId,
  parseJobUrl,
  resolveJobFilePath,
  resolveJobOwnedFile,
  shouldRetryError,
  withRetries,
  buildJobView,
  contentDisposition,
} from '../src/main/apiJobsModel'
import { hasApiAuth } from '../src/main/apiAuth'

assert.equal(hasApiAuth({ authorization: 'Bearer secret-token' }, 'secret-token'), true)
assert.equal(hasApiAuth({ authorization: 'Bearer wrong' }, 'secret-token'), false)
assert.equal(hasApiAuth({ authorization: 'Bearer secret-token' }, ''), false)
assert.equal(hasApiAuth({}, 'secret-token'), false)
assert.equal(hasApiAuth({ authorization: 'secret-token' }, 'secret-token'), false)

const urlOk = parseJobUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
assert.equal(urlOk.ok, true)
if (urlOk.ok) assert.equal(urlOk.url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')

assert.equal(parseJobUrl('ftp://x').ok, false)
assert.equal(parseJobUrl('not-a-url').ok, false)
assert.equal(parseJobUrl('https://').ok, false)
assert.equal(parseJobUrl(`https://${'a'.repeat(8200)}`).ok, false)
assert.equal(parseJobUrl('  https://example.com/v  ').ok, true)

const created = parseJobCreateBody({ url: 'https://example.com/watch?v=1' })
assert.equal(created.ok, true)
assert.equal(parseJobCreateBody({ url: 'https://example.com/a', quality: 'full' }).ok, false)
assert.equal(parseJobCreateBody({ url: 'https://example.com/a', format: 'mp4' }).ok, false)
assert.equal(parseJobCreateBody(null).ok, false)
assert.equal(parseJobCreateBody('https://example.com/a').ok, false)

assert.equal(parseJobId('abc123xyz789').ok, true)
assert.equal(parseJobId('../etc').ok, false)
assert.equal(parseJobId('ab').ok, false)
assert.equal(JOB_ID_PATTERN.test('abc123xyz789'), true)

assert.equal(isSafeFileName('001.jpg'), true)
assert.equal(isSafeFileName('Some Video.mp4'), true)
assert.equal(isSafeFileName('../etc/passwd'), false)
assert.equal(isSafeFileName('a/b.jpg'), false)
assert.equal(isSafeFileName('a\\b.jpg'), false)
assert.equal(isSafeFileName(''), false)
assert.equal(isSafeFileName('.'), false)
assert.equal(isSafeFileName('..'), false)

const jobDir = join(tmpdir(), `vdl-api-test-${Date.now()}`)
mkdirSync(jobDir, { recursive: true })
writeFileSync(join(jobDir, 'video.mp4'), 'x')
assert.equal(resolveJobFilePath(jobDir, 'video.mp4'), join(jobDir, 'video.mp4'))
assert.equal(resolveJobFilePath(jobDir, '../video.mp4'), null)
assert.equal(resolveJobFilePath(jobDir, 'missing.mp4'), null)
assert.equal(resolveJobOwnedFile([join(jobDir, 'video.mp4')], 'video.mp4'), join(jobDir, 'video.mp4'))
assert.equal(resolveJobOwnedFile([jobDir], '../video.mp4'), null)
rmSync(jobDir, { recursive: true, force: true })

assert.equal(isIgnoredArtifactName('.DS_Store'), true)
assert.equal(isIgnoredArtifactName('video.part'), true)
assert.equal(isIgnoredArtifactName('video.ytdl'), true)
assert.equal(isIgnoredArtifactName('ffmpeg2pass-0.log'), true)
assert.equal(isIgnoredArtifactName('compressed_x.mp4'), true)
assert.equal(isIgnoredArtifactName('video.mp4'), false)

assert.equal(contentTypeForName('a.mp4'), 'video/mp4')
assert.equal(contentTypeForName('a.m4a'), 'audio/mp4')
assert.equal(contentTypeForName('a.jpg'), 'image/jpeg')
assert.equal(contentTypeForName('a.m3u8'), 'application/vnd.apple.mpegurl')

const oneVideo = classifyArtifacts([{ name: 'Some Video.mp4', sizeBytes: 100 }])
assert.equal(oneVideo.kind, 'file')
assert.equal(oneVideo.files?.length, 1)
assert.equal(oneVideo.error, undefined)

const oneImage = classifyArtifacts([{ name: '001.jpg', sizeBytes: 10 }])
assert.equal(oneImage.kind, 'file')

const gallery = classifyArtifacts([
  { name: '001.jpg', sizeBytes: 10 },
  { name: '002.png', sizeBytes: 11 },
])
assert.equal(gallery.kind, 'gallery')
assert.equal(gallery.files?.length, 2)
assert.equal(gallery.files?.[0].index, 1)
assert.equal(gallery.files?.[1].name, '002.png')

const collection = classifyArtifacts([
  { name: '001 - a.mp4', sizeBytes: 10 },
  { name: '002 - b.mp4', sizeBytes: 11 },
])
assert.equal(collection.kind, 'collection')

const mixed = classifyArtifacts([
  { name: 'clip.mp4', sizeBytes: 10 },
  { name: '001.jpg', sizeBytes: 5 },
])
assert.equal(mixed.kind, 'collection')

const empty = classifyArtifacts([])
assert.equal(empty.kind, null)
assert.equal(empty.error?.code, 'empty_output')

const hlsOnly = classifyArtifacts([{ name: 'index.m3u8', sizeBytes: 40 }])
assert.equal(hlsOnly.kind, null)
assert.equal(hlsOnly.error?.code, 'remux_failed')

const remuxed = classifyArtifacts([
  { name: 'index.m3u8', sizeBytes: 40 },
  { name: 'index.mp4', sizeBytes: 999 },
])
assert.equal(remuxed.kind, 'file')
assert.equal(remuxed.files?.[0].name, 'index.mp4')

const scanDir = join(tmpdir(), `vdl-scan-${Date.now()}`)
mkdirSync(join(scanDir, 'album'), { recursive: true })
writeFileSync(join(scanDir, 'album', '001.jpg'), 'img')
writeFileSync(join(scanDir, 'album', '002.jpg'), 'img')
writeFileSync(join(scanDir, 'album', 'note.part'), 'x')
const scanned = listJobArtifacts(scanDir)
assert.equal(scanned.length, 2)
assert.deepEqual(classifyArtifacts(scanned).kind, 'gallery')
rmSync(scanDir, { recursive: true, force: true })

assert.equal(classifyInputUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLxxx'), 'single')
assert.equal(classifyInputUrl('https://www.youtube.com/playlist?list=PLxxx'), 'collection')
assert.equal(classifyInputUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'single')
assert.equal(classifyInputUrl('https://youtu.be/dQw4w9WgXcQ'), 'single')
assert.equal(classifyInputUrl('https://cdn.example.com/master.m3u8'), 'direct')
assert.equal(classifyInputUrl('https://cdn.example.com/clip.mp4'), 'direct')
assert.equal(classifyInputUrl('https://www.youtube.com/@someone/videos'), 'collection')
assert.equal(classifyInputUrl('https://www.youtube.com/channel/UCxxxx'), 'collection')

assert.equal(
  classifyYtdlpProbe('https://www.youtube.com/watch?v=aaa&list=PLzzz', { _type: 'playlist', n_entries: 12 }),
  'single',
)
assert.equal(
  classifyYtdlpProbe('https://www.youtube.com/playlist?list=PLzzz', { _type: 'playlist', n_entries: 12 }),
  'collection',
)
assert.equal(classifyYtdlpProbe('https://example.com/v', { _type: 'video' }), 'single')

const tooBig = collectionTooLarge(80, 50)
assert.equal(tooBig.code, 'collection_too_large')
assert.equal(tooBig.details?.itemCount, 80)
assert.equal(tooBig.details?.max, 50)

assert.equal(classifyFailureMessage('Fresh cookies are needed').code, 'auth_required')
assert.equal(classifyFailureMessage('Please log in to download').code, 'auth_required')
assert.equal(classifyFailureMessage('This live event is upcoming').code, 'unsupported_live')
assert.equal(classifyFailureMessage('ERROR: unable to download').code, 'download_failed')

assert.equal(shouldRetryError('download_failed'), true)
assert.equal(shouldRetryError('remux_failed'), true)
assert.equal(shouldRetryError('auth_required'), false)
assert.equal(shouldRetryError('unsupported_live'), false)
assert.equal(shouldRetryError('file_too_large'), false)
assert.equal(shouldRetryError('collection_too_large'), false)

async function testRetries(): Promise<void> {
  let attempts = 0
  const retried = await withRetries(
    async () => {
      attempts += 1
      if (attempts < 3) throw Object.assign(new Error('net'), { code: 'download_failed' })
      return 'ok'
    },
    { sleep: async () => {} },
  )
  assert.equal(retried, 'ok')
  assert.equal(attempts, 3)

  let fatalAttempts = 0
  await assert.rejects(
    () => withRetries(
      async () => {
        fatalAttempts += 1
        throw Object.assign(new Error('login'), { code: 'auth_required' })
      },
      { sleep: async () => {} },
    ),
  )
  assert.equal(fatalAttempts, 1)
}

const viewReady = buildJobView({
  id: 'abc123xyz789',
  url: 'https://example.com/v',
  title: 'Some Video',
  status: 'complete',
  progress: 100,
  error: null,
  updatedAt: '2026-08-28T23:00:00.000Z',
}, {
  artifacts: [{ name: 'Some Video.mp4', sizeBytes: 88421000 }],
})
assert.equal(viewReady.kind, 'file')
assert.equal(viewReady.files?.length, 1)
assert.equal(viewReady.expired, false)
assert.equal(viewReady.expiresAt, null)

const viewExpired = buildJobView({
  id: 'abc123xyz789',
  url: 'https://example.com/v',
  title: 'Some Video',
  status: 'complete',
  progress: 100,
  error: null,
  updatedAt: '2026-08-28T20:00:00.000Z',
}, {
  artifacts: [],
})
assert.equal(viewExpired.status, 'complete')
assert.equal(viewExpired.expired, true)
assert.equal(viewExpired.expiresAt, null)
assert.deepEqual(viewExpired.files, [])

const viewPending = buildJobView({
  id: 'abc123xyz789',
  url: 'https://example.com/v',
  title: 'Working title',
  status: 'downloading',
  progress: 37,
  error: null,
  updatedAt: '2026-08-28T23:00:00.000Z',
}, {
  artifacts: [],
})
assert.equal(viewPending.kind, null)
assert.equal(viewPending.files, null)
assert.equal(viewPending.expiresAt, null)

const viewError = buildJobView({
  id: 'abc123xyz789',
  url: 'https://example.com/v',
  title: null,
  status: 'error',
  progress: 10,
  error: { code: 'collection_item_failed', message: 'item 2 failed', details: { index: 2, attempts: 3 } },
  updatedAt: '2026-08-28T23:00:00.000Z',
}, {
  artifacts: [{ name: '001 - a.mp4', sizeBytes: 10 }],
})
assert.equal(viewError.status, 'error')
assert.equal(viewError.error?.code, 'collection_item_failed')
assert.equal(viewError.kind, null)
assert.equal(viewError.files, null)

const galleryView = buildJobView({
  id: 'abc123xyz789',
  url: 'https://www.douyin.com/note/1',
  title: 'Album',
  status: 'complete',
  progress: 100,
  error: null,
  updatedAt: '2026-08-28T23:00:00.000Z',
}, {
  artifacts: [
    { name: '001.jpg', sizeBytes: 10 },
    { name: '002.jpg', sizeBytes: 11 },
  ],
})
assert.equal(galleryView.kind, 'gallery')
assert.equal(galleryView.files?.length, 2)

const disp = contentDisposition('视频.mp4')
assert.match(disp, /attachment;/)
assert.match(disp, /filename\*=UTF-8''/)

void testRetries().then(() => {
  console.log('api jobs model tests passed')
}).catch((err) => {
  console.error(err)
  process.exitCode = 1
})
