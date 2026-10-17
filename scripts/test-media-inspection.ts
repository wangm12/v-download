import assert from 'node:assert/strict'
import { hlsResources, inspectedProbeFacts } from '../src/main/mediaInspectionModel'
import { classifyResolverError } from '../src/main/mediaResolver'
import { classifyDownloadError } from '../src/main/downloadError'
import { classifyFailureMessage, shouldRetryError } from '../src/main/apiJobsModel'
const base = 'https://cdn.test/course/master.m3u8?token=a%2fb&label=hello%20world'
const parsed = hlsResources(`#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="stereo",NAME="English, original",LANGUAGE="en",URI="audio.m3u8?token=a%2fb"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Chinese",LANGUAGE="zh",URI="subs.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,FRAME-RATE=29.970,CODECS="avc1.4d401e,mp4a.40.2",AUDIO="stereo"
360.m3u8?token=a%2fb&label=hello%20world
#EXT-X-STREAM-INF:BANDWIDTH=1600000,RESOLUTION=1280x720
https://cdn2.test/720.m3u8
`, base)
assert.equal(parsed.master, true)
assert.equal(parsed.resources.length, 4)
assert.equal(parsed.resources[0].name, 'English, original')
assert.equal(parsed.resources[2].codecs, 'avc1.4d401e,mp4a.40.2')
assert.equal(parsed.resources[2].height, 360)
assert.equal(parsed.resources[2].fps, 29.97)
assert.equal(parsed.resources[2].url, 'https://cdn.test/course/360.m3u8?token=a%2fb&label=hello%20world')
assert.equal(parsed.resources[3].url, 'https://cdn2.test/720.m3u8')
assert.equal(hlsResources('#EXTM3U\n#EXTINF:4,\nsegment.ts\n#EXT-X-ENDLIST', base).resources.length, 0)
assert.equal(hlsResources('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nfile:///etc/passwd', base).resources.length, 0)
assert.equal(hlsResources('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhttps://user:secret@cdn.test/a', base).resources.length, 0)
assert.equal(hlsResources(Array(130).fill('#EXT-X-STREAM-INF:BANDWIDTH=1\na.m3u8').join('\n'), base).truncated, true)
const facts = inspectedProbeFacts({ format: { duration: '12.032' }, streams: [null, { index: 0, codec_type: 'video', codec_name: 'h264', width: 640, height: 360, avg_frame_rate: '30000/1001' }, { index: 1, codec_type: 'audio', codec_name: 'aac' }, { index: 2, codec_type: 'subtitle', tags: { language: 'eng' } }] })
assert.equal(facts.duration, 12.032)
assert.equal(facts.streams[0].height, 360)
assert.equal(facts.streams[0].fps, 30000 / 1001)
assert.equal(facts.streams[1].language, undefined)
assert.equal(facts.streams[2].kind, 'subtitle')
for (const message of ['HTTP Error 403: Forbidden', 'Server returned 403 Forbidden', 'HTTP status code: 403', 'Access denied']) {
  assert.equal(classifyDownloadError(message, false), 'ACCESS_DENIED')
  assert.equal(classifyResolverError(message).kind, 'access-denied')
  assert.equal(classifyFailureMessage(message).code, 'access_denied')
}
for (const message of ['HTTP Error 401: Unauthorized', 'HTTP Error 403: login required', 'AUTH_REQUIRED (403 Forbidden)', 'Fresh cookies are needed']) {
  assert.equal(classifyDownloadError(message, false), 'AUTH_REQUIRED')
  assert.equal(classifyResolverError(message).kind, 'auth')
  assert.equal(classifyFailureMessage(message).code, 'auth_required')
}
assert.equal(shouldRetryError('access_denied'), false)
console.log('media inspection and access refusal semantics: ok')
