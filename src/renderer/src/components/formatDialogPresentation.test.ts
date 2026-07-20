import { fallbackQuality, formatAccessibleDownloadLabel, getPresentationCandidates, hasOtherFormats } from './formatDialogPresentation'

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

const video = [
  { format_id: 'small', height: 720, width: 1280, ext: 'mp4', vcodec: 'h264', acodec: 'aac' },
  { format_id: 'duplicate', height: 720, width: 1280, ext: 'mp4', vcodec: 'h264', acodec: 'aac', filesize: 10 },
  { format_id: 'large', height: 1080, width: 1920, ext: 'mp4', vcodec: 'h264', acodec: 'aac' }
]
const sorted = getPresentationCandidates(video, 'video', '720')
equal(sorted.map((item) => item.quality), [1080, 720])
equal(sorted.filter((item) => item.recommended).length, 1)
equal(sorted[1].filesize, 10)
equal(formatAccessibleDownloadLabel(sorted[0], 'MP4'), 'Download 1080p MP4')
equal(getPresentationCandidates(video, 'audio', '320').length, 0)
equal(getPresentationCandidates(video, 'video', '720', { format: 'video', quality: '1080' }).find((item) => item.recommended)?.quality, 1080)
equal(fallbackQuality('video', '720', { format: 'audio', quality: '1080' }), 720)
equal(fallbackQuality('audio', '128', { format: 'video', quality: '320' }), 128)
const audio = [{ format_id: 'a1', bitrate: 128, ext: 'm4a', acodec: 'aac', filesize_approx: 20 }, { format_id: 'a2', abr: 320, ext: 'm4a', acodec: 'aac', filesize: 30 }]
const audioCandidates = getPresentationCandidates(audio, 'audio', '128')
equal(audioCandidates.map((item) => item.quality), [320, 128])
equal(audioCandidates[0].acodec, 'aac')
equal(audioCandidates[0].filesize, 30)
const exactPreferred = getPresentationCandidates([{ height: 720, ext: 'mp4', filesize_approx: 100 }, { height: 720, ext: 'mp4', filesize: 40 }], 'video', '720')
equal(exactPreferred[0].filesize, 40)
equal(hasOtherFormats([{ format_id: 'story', ext: 'webp' }]), false)
equal(hasOtherFormats(video), false)
console.log('format dialog presentation tests passed')
