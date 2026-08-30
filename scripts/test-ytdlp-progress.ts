import assert from 'node:assert/strict'
import { parseMediaDurationSeconds, parseYtdlpProgressLine } from '../src/main/ytdlp'

const downloadLine = parseYtdlpProgressLine('[download]  12.3% of  50.00MiB at  1.00MiB/s ETA 00:05', '')
assert.equal(downloadLine.progress?.percent, 12.3)

assert.equal(
  parseMediaDurationSeconds('  Duration: 02:14:33.05, start: 0.000000, bitrate: N/A'),
  2 * 3600 + 14 * 60 + 33.05
)
assert.equal(parseMediaDurationSeconds('Duration: N/A, start: 0.000000, bitrate: N/A'), null)

const ffmpegLine = 'frame= 1840 fps= 42 q=-1.0 size=  327680kB time=00:12:20.00 bitrate=3628.4kbits/s speed=1.73x'
const knownDuration = 2 * 3600 + 14 * 60 + 33
const linear = parseYtdlpProgressLine(ffmpegLine, '', knownDuration)
assert.ok(linear.progress, 'ffmpeg HLS remux must report progress')
assert.equal(linear.phase, 'video')
assert.ok(
  Math.abs((linear.progress?.percent ?? 0) - (740 / knownDuration) * 100) < 0.3,
  `12:20 of 2:14:33 should be ~9%, got ${linear.progress?.percent}`
)
assert.ok((linear.progress?.percent ?? 100) < 15, 'known long VOD must not jump to 90% after 12 minutes')

const unknown = parseYtdlpProgressLine(ffmpegLine, '')
assert.ok((unknown.progress?.percent ?? 100) <= 2, `unknown duration must not fake 90%, got ${unknown.progress?.percent}`)
assert.match(String(unknown.progress?.total || ''), /12:20/)

const earlyFfmpeg = parseYtdlpProgressLine(
  'frame=  12 fps=  0 q=-1.0 size=    128kB time=00:00:00.48 bitrate=2184.6kbits/s speed=0.12x',
  '',
  knownDuration
)
assert.ok((earlyFfmpeg.progress?.percent ?? 1) < 1, 'first second of a long VOD stays near 0%')

console.log('yt-dlp progress parsing uses real duration instead of an asymptotic curve')
