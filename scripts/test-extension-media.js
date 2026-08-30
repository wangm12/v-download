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

const oldHls = { url: 'https://cdn.example.test/early.m3u8', type: 'hls', mime: 'application/vnd.apple.mpegurl', timestamp: 1_000 }
const recentSegment = { url: 'https://cdn.example.test/chunk.mp4', type: 'mp4', mime: 'video/mp4', size: 12_000_000, timestamp: 20_000 }
const staleSegment = { url: 'https://cdn.example.test/ad.mp4', type: 'mp4', mime: 'video/mp4', size: 400_000, timestamp: 1_000 }
const filtered = mp.filterSniffedForOverlay([oldHls, recentSegment, staleSegment], 19_500)
if (!filtered.some((x) => x.url.includes('early.m3u8'))) throw new Error('old HLS manifest was dropped by overlay cutoff')
if (!filtered.some((x) => x.url.includes('chunk.mp4'))) throw new Error('recent mp4 was dropped')
if (filtered.some((x) => x.url.includes('ad.mp4'))) throw new Error('stale mp4 segment leaked past overlay cutoff')
if (typeof mp.filterSniffedForOverlay !== 'function') throw new Error('filterSniffedForOverlay missing')

const previousHls = { url: 'https://ads.example.test/previous.m3u8', type: 'hls', mime: 'application/vnd.apple.mpegurl', timestamp: 1_000 }
const currentHls = { url: 'https://cdn.example.test/current.m3u8', type: 'hls', mime: 'application/vnd.apple.mpegurl', timestamp: 20_000 }
const afterSourceChange = mp.filterSniffedForOverlay([previousHls, currentHls, recentSegment], 19_500)
if (afterSourceChange.some((x) => x.url.includes('previous.m3u8'))) throw new Error('previous ad HLS leaked after a same-page source change')
if (!afterSourceChange.some((x) => x.url.includes('current.m3u8'))) throw new Error('current HLS was dropped after source change')

if (typeof mp.classifyMediaRole !== 'function') throw new Error('classifyMediaRole missing')
if (typeof mp.selectDefaultMedia !== 'function') throw new Error('selectDefaultMedia missing')
if (typeof mp.displayTitleFor !== 'function') throw new Error('displayTitleFor missing')

const pageTitle = 'IPZZ-046 Example Title - Jable.TV'
const pageUrl = 'https://jable.tv/videos/ipzz-046/'
const noisyPage = [
  { url: 'https://video.sacd.example/ol_c483855c0126bdf226177496.mp4', type: 'mp4', mime: 'video/mp4', size: 2_300_000 },
  { url: 'https://video.sacd.example/ae4d1ce037255c1fd44ba30b614.mp4', type: 'mp4', mime: 'video/mp4', size: 2_100_000 },
  { url: 'https://thumb-ah.flix.example/fh_heatmap_preview_v6_a-352x198.mp4', type: 'mp4', mime: 'video/mp4', size: 826_500 },
  { url: 'https://thumb-ah.flix.example/fh_heatmap_preview_v6_b-352x198.mp4', type: 'mp4', mime: 'video/mp4', size: 555_500 },
  { url: 'https://video.sacd.example/hls/master.m3u8', type: 'hls', mime: 'application/vnd.apple.mpegurl', timestamp: 20_000 },
  { url: 'https://video.sacd.example/hls/1080p.m3u8', type: 'hls', mime: 'application/vnd.apple.mpegurl', timestamp: 19_000 },
  { url: 'https://cdn.example/teaser-clip.mp4', type: 'mp4', mime: 'video/mp4', size: 1_800_000 }
]
const labeled = mp.classifyMediaRole(noisyPage, { pageTitle, pageUrl })
const byUrl = Object.fromEntries(labeled.map((item) => [item.url, item]))
if (labeled.filter((item) => item.role === 'main').length !== 1) throw new Error('expected exactly one main role')
if (byUrl['https://video.sacd.example/hls/master.m3u8']?.role !== 'main') throw new Error('HLS master was not chosen as main')
if (byUrl['https://video.sacd.example/hls/master.m3u8']?.playlistKind !== 'master') throw new Error('master playlistKind missing')
if (byUrl['https://video.sacd.example/hls/1080p.m3u8']?.role !== 'variant') throw new Error('second HLS was not marked variant')
if (byUrl['https://thumb-ah.flix.example/fh_heatmap_preview_v6_a-352x198.mp4']?.role !== 'heatmap') throw new Error('heatmap preview was not labeled')
if (byUrl['https://video.sacd.example/ol_c483855c0126bdf226177496.mp4']?.role !== 'preview') throw new Error('small MP4 beside HLS was not preview')
if (byUrl['https://cdn.example/teaser-clip.mp4']?.role !== 'preview') throw new Error('teaser URL was not preview')
const defaults = mp.selectDefaultMedia(labeled)
if (defaults.length !== 1 || defaults[0].url !== 'https://video.sacd.example/hls/master.m3u8') throw new Error('default selection must be the main HLS only')
if (mp.displayTitleFor(byUrl['https://video.sacd.example/hls/master.m3u8'], pageTitle) !== pageTitle) throw new Error('main display title should use the page title')
if (mp.displayTitleFor(byUrl['https://thumb-ah.flix.example/fh_heatmap_preview_v6_a-352x198.mp4'], pageTitle).includes('IPZZ-046')) throw new Error('heatmap should keep a filename, not the page title')

const heatmap = noisyPage.find((item) => item.url.includes('heatmap_preview_v6_a'))
const master = noisyPage.find((item) => item.url.includes('master.m3u8'))
if (mp.scoreCandidate({ ...heatmap, confidence: 0 }) >= mp.scoreCandidate({ ...master, confidence: 0 })) {
  throw new Error('heatmap should rank below HLS after identity penalties')
}

const related = mp.classifyMediaRole([
  { url: 'https://cdn.example/other.m3u8', type: 'hls', mime: 'application/vnd.apple.mpegurl', pageUrl: 'https://jable.tv/videos/other-id/' },
  { url: 'https://video.sacd.example/hls/master.m3u8', type: 'hls', mime: 'application/vnd.apple.mpegurl', pageUrl }
], { pageTitle, pageUrl })
if (related.find((item) => item.url.includes('other.m3u8'))?.role !== 'related') throw new Error('other-page stream was not related')
if (related.find((item) => item.url.includes('master.m3u8'))?.role !== 'main') throw new Error('same-page HLS lost main after related mix')

const originOnly = mp.classifyMediaRole([
  { url: 'https://video.sacd.example/hls/master.m3u8', type: 'hls', mime: 'application/vnd.apple.mpegurl', pageUrl: 'https://jable.tv' },
  { url: 'https://thumb-ah.flix.example/fh_heatmap_preview_v6_a-352x198.mp4', type: 'mp4', mime: 'video/mp4', size: 826_500, pageUrl: 'https://jable.tv' }
], { pageTitle, pageUrl })
if (originOnly.find((item) => item.url.includes('master.m3u8'))?.role !== 'main') {
  throw new Error(`origin-only pageUrl must not mark the page HLS as related, got ${originOnly.find((item) => item.url.includes('master.m3u8'))?.role}`)
}
if (originOnly.find((item) => item.url.includes('heatmap'))?.role !== 'heatmap') throw new Error('heatmap lost its label when pageUrl is site origin')

const progressiveOnly = mp.classifyMediaRole([
  { url: 'https://cdn.example/feature.mp4', type: 'mp4', mime: 'video/mp4', size: 80_000_000 },
  { url: 'https://cdn.example/fh_heatmap_preview_v6.mp4', type: 'mp4', mime: 'video/mp4', size: 600_000 }
], { pageTitle, pageUrl })
if (progressiveOnly.find((item) => item.url.includes('feature.mp4'))?.role !== 'main') throw new Error('largest non-preview MP4 should be main when no HLS exists')

const jableTitle = 'MIDE-725 任何要求都不在話下口交無敵的超手巧女孩 - Jable.TV'
const jableUrl = 'https://jable.tv/videos/mide-725/'
const contentHls = { url: 'https://video.sacd.example/hls/mide-725/index.m3u8?token=old', type: 'hls', mime: 'application/vnd.apple.mpegurl', timestamp: 10_000 }
const newerAdMaster = { url: 'https://ads.example/preroll/master.m3u8?exp=1', type: 'hls', mime: 'application/vnd.apple.mpegurl', timestamp: 40_000 }
const newerAdPlaylist = { url: 'https://ads.example/midroll/playlist.m3u8?exp=2', type: 'hls', mime: 'application/vnd.apple.mpegurl', timestamp: 41_000 }
const adLabeled = mp.classifyMediaRole([contentHls, newerAdMaster, newerAdPlaylist], { pageTitle: jableTitle, pageUrl: jableUrl })
if (adLabeled.find((item) => item.url.includes('mide-725'))?.role !== 'main') {
  throw new Error(`content HLS must stay main when newer ads arrive, got ${adLabeled.find((item) => item.url.includes('mide-725'))?.role}`)
}
if (adLabeled.find((item) => item.url.includes('preroll'))?.role !== 'ad') throw new Error('preroll HLS should be labeled ad')
if (adLabeled.find((item) => item.url.includes('midroll'))?.role !== 'ad') throw new Error('midroll HLS should be labeled ad')
if (mp.selectDefaultMedia(adLabeled)[0]?.url !== contentHls.url) throw new Error('default selection followed the ad instead of the page video')

const smartRows = mp.selectSmartOverlayMedia(adLabeled)
if (smartRows.length !== 1 || smartRows[0].role !== 'main' || smartRows.some((item) => item.role === 'ad')) {
  throw new Error('Smart overlay must keep the main video and hide ad playlists')
}

const staleAd = { url: 'https://ads.example/preroll/master.m3u8', type: 'hls', mime: 'application/vnd.apple.mpegurl', timestamp: 1_000 }
const currentAd = { url: 'https://ads.example/midroll/playlist.m3u8', type: 'hls', mime: 'application/vnd.apple.mpegurl', timestamp: 20_000 }
const olderContent = { url: 'https://video.sacd.example/hls/mide-725/index.m3u8', type: 'hls', mime: 'application/vnd.apple.mpegurl', timestamp: 1_000 }
const afterAds = mp.filterSniffedForOverlay([staleAd, currentAd, olderContent], 19_500)
if (afterAds.some((x) => x.url.includes('preroll'))) throw new Error('stale ad HLS leaked past overlay cutoff')
if (!afterAds.some((x) => x.url.includes('mide-725'))) throw new Error('page HLS was dropped when a newer ad playlist appeared')

const refreshed = mp.pickRefreshedSniffedCandidate(
  { url: contentHls.url, type: 'hls' },
  [
    { url: newerAdMaster.url, type: 'hls', timestamp: 90_000 },
    { url: 'https://video.sacd.example/hls/mide-725/index.m3u8?token=new', type: 'hls', timestamp: 80_000 }
  ]
)
if (refreshed?.url !== 'https://video.sacd.example/hls/mide-725/index.m3u8?token=new') {
  throw new Error(`click refresh swapped onto an ad, got ${refreshed?.url}`)
}
if (mp.stableMediaUrl(contentHls.url) !== mp.stableMediaUrl('https://video.sacd.example/hls/mide-725/index.m3u8?token=new')) {
  throw new Error('token-only HLS changes must share one identity')
}

console.log(`extension media utility: ${result.length} reliable candidates; manifests, duplicates, and identity labels verified`)
