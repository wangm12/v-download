import assert from 'node:assert/strict'
import {
  TRANSCODE_PRESETS,
  buildTranscodeArgs,
  createTranscodeOutputPath,
  getTranscodePreset,
} from '../src/main/transcodeModel'

assert.equal(TRANSCODE_PRESETS.length, 8)
assert.equal(getTranscodePreset('mp3').extension, 'mp3')
assert.equal(getTranscodePreset('h265').label, 'H.265 MP4')

const mp3Args = buildTranscodeArgs('/downloads/example.mp4', '/downloads/example.transcoded.mp3', 'mp3')
assert.deepEqual(mp3Args, [
  '-hide_banner',
  '-loglevel',
  'error',
  '-y',
  '-i',
  '/downloads/example.mp4',
  '-map_metadata',
  '0',
  '-vn',
  '-c:a',
  'libmp3lame',
  '-q:a',
  '0',
  '/downloads/example.transcoded.mp3',
])

const h265Args = buildTranscodeArgs('/downloads/example.webm', '/downloads/example.transcoded.mp4', 'h265')
assert.ok(h265Args.includes('libx265'))
assert.ok(h265Args.includes('-movflags'))
assert.equal(createTranscodeOutputPath('/downloads/example.mp4', 'mp4'), '/downloads/example.transcoded.mp4')
assert.equal(
  createTranscodeOutputPath('/downloads/example.mp4', 'mp4', new Set(['/downloads/example.transcoded.mp4'])),
  '/downloads/example.transcoded-1.mp4'
)

assert.throws(() => getTranscodePreset('unknown' as never), /Unknown transcode preset/)

console.log('transcode model tests passed')
