import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { classifyResolverError, filterPersistedHeaders, protocolFor, resolveMediaCandidates, sanitizeResolverError } from '../src/main/mediaResolver'

void (async () => {
const fixtureDir = join(process.cwd(), 'tests/fixtures/media')
const progressiveFixture = JSON.parse(await readFile(join(fixtureDir, 'progressive.json'), 'utf8')) as { url: string; headers: Record<string, string>; referer: string; contentLength: string }
const hlsFixture = await readFile(join(fixtureDir, 'master.m3u8'), 'utf8')
const dashFixture = await readFile(join(fixtureDir, 'manifest.mpd'), 'utf8')
const failureFixture = await readFile(join(fixtureDir, 'failure.m3u8'), 'utf8')
assert.match(hlsFixture, /EXT-X-STREAM-INF/)
assert.match(dashFixture, /<MPD/)
assert.match(failureFixture, /AUTH_REQUIRED/)
const candidates = resolveMediaCandidates([
  { url: progressiveFixture.url, mimeType: 'video/mp4', fileSize: Number(progressiveFixture.contentLength), source: 'extension', headers: progressiveFixture.headers, pageUrl: progressiveFixture.referer },
  { url: 'https://cdn.test/video.mp4', mimeType: 'video/mp4', height: 720, source: 'extension', headers: { ...progressiveFixture.headers, Referer: progressiveFixture.referer } },
  { url: 'https://cdn.test/video.mp4#duplicate', mimeType: 'video/mp4', height: 360 },
  { url: 'https://cdn.test/master.m3u8', mimeType: 'application/vnd.apple.mpegurl', source: 'sniffer' },
  { url: 'https://cdn.test/manifest.mpd', mimeType: 'application/dash+xml' },
  { url: 'https://cdn.test/segment-1.ts', mimeType: 'video/mp2t' },
  { url: 'https://analytics.test/pixel.mp4', fileSize: 100000 },
  { url: 'https://cdn.test/tiny.mp4', fileSize: 100 }
])
assert.equal(protocolFor('https://cdn.test/master.m3u8'), 'hls')
assert.equal(protocolFor('https://cdn.test/manifest.mpd'), 'dash')
assert.equal(candidates.length, 3)
const progressive = candidates.find((candidate) => candidate.url.includes('video.mp4'))
assert.equal(progressive?.url, 'https://cdn.test/video.mp4')
assert.equal(progressive?.headers?.Referer, 'https://page.test/')
assert.equal(progressive?.headers?.Range, 'bytes=0-')
assert.equal(progressive?.headers?.Cookie, 'session=fixture')
assert.equal(classifyResolverError('HTTP 503 timeout').kind, 'temporary-network')
assert.equal(classifyResolverError('DRM license required').kind, 'drm')
assert.equal(classifyResolverError('Sign in required').kind, 'auth')
assert.equal(classifyResolverError('AUTH_REQUIRED (403 Forbidden)').kind, 'auth')
const videoOnly = resolveMediaCandidates([{ url: 'https://cdn.test/video-only.mp4', mimeType: 'video/mp4', vcodec: 'h264', acodec: 'none', hasVideo: true, hasAudio: false, fileSize: 20000 } as never])[0]
const audioOnly = resolveMediaCandidates([{ url: 'https://cdn.test/audio-only.m4a', mimeType: 'audio/mp4', acodec: 'aac', vcodec: 'none', hasVideo: false, hasAudio: true, fileSize: 20000 } as never])[0]
assert.equal(videoOnly?.hasAudio, false)
assert.equal(videoOnly?.hasVideo, true)
assert.equal(videoOnly?.codec, 'h264')
assert.equal(audioOnly?.hasAudio, true)
assert.equal(audioOnly?.hasVideo, false)
assert.equal(audioOnly?.codec, 'aac')
const failure = classifyResolverError(failureFixture + ' Cookie=session=secret&sig=secret')
assert.equal(failure.kind, 'auth')
assert.doesNotMatch(failure.action, /secret|session=/i)
const sanitized = sanitizeResolverError('GET https://x.test/?token=tokenSecret&sig=sigSecret Cookie=session=sessionSecret; Authorization=Bearer bearerSecret xyz')
assert.doesNotMatch(sanitized, /tokenSecret|sigSecret|sessionSecret|bearerSecret|xyz/)
const persistedHeaders = filterPersistedHeaders({ Referer: 'https://page.test/', Range: 'bytes=0-', Cookie: 'session=secret', Authorization: 'Bearer secret', 'Proxy-Authorization': 'Basic secret', 'Set-Cookie': 'session=secret' })
assert.deepEqual(persistedHeaders, { Referer: 'https://page.test/', Range: 'bytes=0-' })
console.log('media resolver fixtures: ok')
})()
