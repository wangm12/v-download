const fs = require('fs')
const vm = require('vm')
const code = fs.readFileSync('extension/media-patterns.js', 'utf8')
const context = { console, URL, URLSearchParams, globalThis: {} }
vm.runInNewContext(code, context)
const mp = context.globalThis.VDownloadMediaPatterns
if (mp.validateBatch([]) || mp.validateBatch('not-an-array')) throw new Error('empty batch was accepted')
const items = []
for (let i = 0; i < 120; i++) items.push({ url: `https://cdn.example.test/segment-${i}.m4s?utm_source=x`, type: 'mp4', size: 1200 })
for (let i = 0; i < 120; i++) items.push({ url: `https://cdn.example.test/media?id=${i}&range=${i * 1000}-${i * 2000}`, type: 'mp4', mime: 'video/mp4', size: 1400 })
for (let i = 0; i < 120; i++) items.push({ url: `https://cdn.example.test/media?id=${i}`, type: 'mp4', mime: 'video/mp4', requestKind: 'xmlhttprequest', size: null })
items.push(
  { url: 'https://cdn.example.test/video.mp4?token=abc&utm_campaign=noise', type: 'mp4', size: 12_000_000, source: 'network' },
  { url: 'https://cdn.example.test/video.mp4?utm_medium=noise&token=abc', type: 'mp4', size: 15_000_000, source: 'element' },
  { url: 'https://cdn.example.test/master.m3u8?token=abc', type: 'hls', mime: 'application/vnd.apple.mpegurl' },
  { url: 'https://cdn.example.test/master.mpd?token=abc', type: 'dash', mime: 'application/dash+xml' },
  { url: 'https://cdn.example.test/audio.mp3?sig=secret', type: 'mp3', size: 500_000 }
  , { url: 'https://cdn.example.test/short-audio.m4a', type: 'm4a', mime: 'audio/mp4', size: 1200 }
  , { url: 'https://cdn.example.test/direct.mp4?range=0-1000', type: 'mp4', mime: 'video/mp4', size: 1200 }
)
const result = mp.mergeCandidates(items)
if (result.length !== 6) throw new Error(`expected 6 reliable candidates, got ${result.length}`)
if (!result.some((x) => x.type === 'hls') || !result.some((x) => x.type === 'dash')) throw new Error('manifest candidates were filtered')
if (result.filter((x) => x.type === 'mp4' && x.url.includes('/video.mp4')).length !== 1) throw new Error('canonical duplicate did not merge')
if (result.some((x) => /segment|utm_|tracking/i.test(x.url))) throw new Error('noise leaked into candidates')
if (mp.isReliableCandidate({ url: 'https://example.test/watch?id=123', source: 'element' })) throw new Error('arbitrary element URL accepted')
const safe = mp.safeUrl('https://cdn.example.test/video.mp4?token=secret&signature=private')
if (/[?&]|secret|private/i.test(safe)) throw new Error('safe URL leaked query values')
if (!result.every((x) => x.confidence > 0 && typeof x.type === 'string')) throw new Error('metadata/ranking is unstable')
console.log(`extension media utility: ${result.length} reliable candidates; manifests and duplicates verified`)
