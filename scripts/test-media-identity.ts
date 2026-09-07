import assert from 'node:assert/strict'
import {
  bulkQueueNotice,
  classifyMediaRole,
  decideQueueAdmission,
  displayTitleFor,
  findReusableDownload,
  hintDirectMediaUrl,
  pickRefreshedSniffedCandidate,
  queueIdentityKey,
  selectDefaultMedia,
  selectSmartOverlayMedia,
  shouldRedownloadExisting,
  stableMediaUrl,
  type MediaIdentityItem
} from '../src/main/mediaIdentity'

const pageTitle = 'IPZZ-046 Example Title - Jable.TV'
const pageUrl = 'https://jable.tv/videos/ipzz-046/'

const noisyPage: MediaIdentityItem[] = [
  { url: 'https://video.sacd.example/ol_c483855c0126bdf226177496.mp4', type: 'mp4', mimeType: 'video/mp4', size: 2_300_000 },
  { url: 'https://video.sacd.example/ae4d1ce037255c1fd44ba30b614.mp4', type: 'mp4', mimeType: 'video/mp4', size: 2_100_000 },
  { url: 'https://thumb-ah.flix.example/fh_heatmap_preview_v6_a-352x198.mp4', type: 'mp4', mimeType: 'video/mp4', size: 826_500 },
  { url: 'https://thumb-ah.flix.example/fh_heatmap_preview_v6_b-352x198.mp4', type: 'mp4', mimeType: 'video/mp4', size: 555_500 },
  { url: 'https://video.sacd.example/hls/master.m3u8', type: 'hls', mimeType: 'application/vnd.apple.mpegurl', timestamp: 20_000 },
  { url: 'https://video.sacd.example/hls/1080p.m3u8', type: 'hls', mimeType: 'application/vnd.apple.mpegurl', timestamp: 19_000 },
  { url: 'https://cdn.example/teaser-clip.mp4', type: 'mp4', mimeType: 'video/mp4', size: 1_800_000 }
]

const labeled = classifyMediaRole(noisyPage, { pageTitle, pageUrl })
const byUrl = Object.fromEntries(labeled.map((item) => [item.url, item]))

assert.equal(labeled.filter((item) => item.role === 'main').length, 1)
assert.equal(byUrl['https://video.sacd.example/hls/master.m3u8']?.role, 'main')
assert.equal(byUrl['https://video.sacd.example/hls/master.m3u8']?.playlistKind, 'master')
assert.equal(byUrl['https://video.sacd.example/hls/1080p.m3u8']?.role, 'variant')
assert.equal(byUrl['https://thumb-ah.flix.example/fh_heatmap_preview_v6_a-352x198.mp4']?.role, 'heatmap')
assert.equal(byUrl['https://video.sacd.example/ol_c483855c0126bdf226177496.mp4']?.role, 'preview')
assert.equal(byUrl['https://cdn.example/teaser-clip.mp4']?.role, 'preview')

const defaults = selectDefaultMedia(labeled)
assert.equal(defaults.length, 1)
assert.equal(defaults[0]?.url, 'https://video.sacd.example/hls/master.m3u8')
assert.equal(displayTitleFor(byUrl['https://video.sacd.example/hls/master.m3u8']!, pageTitle), pageTitle)
assert.equal(displayTitleFor(byUrl['https://thumb-ah.flix.example/fh_heatmap_preview_v6_a-352x198.mp4']!, pageTitle).includes('IPZZ-046'), false)

const related = classifyMediaRole([
  { url: 'https://cdn.example/other.m3u8', type: 'hls', mimeType: 'application/vnd.apple.mpegurl', pageUrl: 'https://jable.tv/videos/other-id/' },
  { url: 'https://video.sacd.example/hls/master.m3u8', type: 'hls', mimeType: 'application/vnd.apple.mpegurl', pageUrl }
], { pageTitle, pageUrl })
assert.equal(related.find((item) => item.url.includes('other.m3u8'))?.role, 'related')
assert.equal(related.find((item) => item.url.includes('master.m3u8'))?.role, 'main')

const originOnly = classifyMediaRole([
  { url: 'https://video.sacd.example/hls/master.m3u8', type: 'hls', mimeType: 'application/vnd.apple.mpegurl', pageUrl: 'https://jable.tv' },
  { url: 'https://thumb-ah.flix.example/fh_heatmap_preview_v6_a-352x198.mp4', type: 'mp4', mimeType: 'video/mp4', size: 826_500, pageUrl: 'https://jable.tv' }
], { pageTitle, pageUrl })
assert.equal(originOnly.find((item) => item.url.includes('master.m3u8'))?.role, 'main')
assert.equal(originOnly.find((item) => item.url.includes('heatmap'))?.role, 'heatmap')

const progressiveOnly = classifyMediaRole([
  { url: 'https://cdn.example/feature.mp4', type: 'mp4', mimeType: 'video/mp4', size: 80_000_000 },
  { url: 'https://cdn.example/fh_heatmap_preview_v6.mp4', type: 'mp4', mimeType: 'video/mp4', size: 600_000 }
], { pageTitle, pageUrl })
assert.equal(progressiveOnly.find((item) => item.url.includes('feature.mp4'))?.role, 'main')

const jableTitle = 'MIDE-725 任何要求都不在話下口交無敵的超手巧女孩 - Jable.TV'
const jableUrl = 'https://jable.tv/videos/mide-725/'
const contentHls = {
  url: 'https://video.sacd.example/hls/mide-725/index.m3u8?token=old',
  type: 'hls',
  mimeType: 'application/vnd.apple.mpegurl',
  timestamp: 10_000
}
const newerAdMaster = {
  url: 'https://ads.example/preroll/master.m3u8?exp=1',
  type: 'hls',
  mimeType: 'application/vnd.apple.mpegurl',
  timestamp: 40_000
}
const newerAdPlaylist = {
  url: 'https://ads.example/midroll/playlist.m3u8?exp=2',
  type: 'hls',
  mimeType: 'application/vnd.apple.mpegurl',
  timestamp: 41_000
}
const adLabeled = classifyMediaRole([contentHls, newerAdMaster, newerAdPlaylist], {
  pageTitle: jableTitle,
  pageUrl: jableUrl
})
assert.equal(adLabeled.find((item) => item.url.includes('mide-725'))?.role, 'main')
assert.equal(adLabeled.find((item) => item.url.includes('preroll'))?.role, 'ad')
assert.equal(adLabeled.find((item) => item.url.includes('midroll'))?.role, 'ad')
assert.equal(
  classifyMediaRole([{
    url: 'https://svacdn77.tsyndicate.com/hls/preroll.m3u8',
    type: 'hls',
    mimeType: 'application/vnd.apple.mpegurl'
  }], { pageTitle: jableTitle, pageUrl: jableUrl })[0]?.role,
  'ad'
)
assert.equal(selectDefaultMedia(adLabeled)[0]?.url, contentHls.url)

const smartRows = selectSmartOverlayMedia(adLabeled)
assert.equal(smartRows.length, 1)
assert.equal(smartRows[0]?.role, 'main')
assert.equal(smartRows.some((item) => item.role === 'ad'), false)

const refreshed = pickRefreshedSniffedCandidate(
  { url: contentHls.url, type: 'hls' },
  [
    { url: newerAdMaster.url, type: 'hls', timestamp: 90_000 },
    { url: 'https://video.sacd.example/hls/mide-725/index.m3u8?token=new', type: 'hls', timestamp: 80_000 }
  ]
)
assert.equal(refreshed?.url, 'https://video.sacd.example/hls/mide-725/index.m3u8?token=new')

assert.equal(
  stableMediaUrl('https://video.sacd.example/hls/mide-725/index.m3u8?token=old'),
  stableMediaUrl('https://video.sacd.example/hls/mide-725/index.m3u8?token=new')
)
assert.equal(
  queueIdentityKey('https://youtu.be/5fyy9t7v304'),
  queueIdentityKey('https://www.youtube.com/watch?v=5fyy9t7v304&si=abc')
)
assert.equal(queueIdentityKey('https://www.youtube.com/watch?v=5fyy9t7v304'), 'youtube:5fyy9t7v304')
assert.equal(queueIdentityKey('https://www.youtube.com/shorts/5fyy9t7v304'), 'youtube:5fyy9t7v304')
assert.equal(queueIdentityKey('https://music.youtube.com/watch?v=5fyy9t7v304'), 'youtube:5fyy9t7v304')
assert.notEqual(
  queueIdentityKey('https://www.youtube.com/playlist?list=PLtest'),
  queueIdentityKey('https://www.youtube.com/watch?v=5fyy9t7v304&list=PLtest')
)
assert.equal(
  queueIdentityKey('https://video.sacd.example/hls/mide-725/index.m3u8?token=old'),
  queueIdentityKey('https://video.sacd.example/hls/mide-725/index.m3u8?token=new')
)

const reused = findReusableDownload([
  { url: 'https://video.sacd.example/hls/mide-725/index.m3u8?token=old', status: 'complete' }
], 'https://video.sacd.example/hls/mide-725/index.m3u8?token=new')
assert.equal(reused?.status, 'complete')
assert.equal(
  findReusableDownload([
    { url: 'https://youtu.be/5fyy9t7v304', status: 'complete' }
  ], 'https://www.youtube.com/watch?v=5fyy9t7v304')?.status,
  'complete'
)
assert.equal(
  findReusableDownload([
    { url: 'https://www.youtube.com/watch?v=5fyy9t7v304', status: 'error' }
  ], 'https://youtu.be/5fyy9t7v304')?.status,
  'error'
)
const newest = findReusableDownload([
  { url: 'https://youtu.be/5fyy9t7v304', status: 'complete', created_at: '2026-01-01T00:00:00.000Z' },
  { url: 'https://www.youtube.com/watch?v=5fyy9t7v304', status: 'complete', created_at: '2026-09-01T00:00:00.000Z' }
], 'https://youtu.be/5fyy9t7v304')
assert.equal(newest?.created_at, '2026-09-01T00:00:00.000Z')

assert.equal(decideQueueAdmission({ forceNew: true }).action, 'create')
assert.equal(decideQueueAdmission({}).action, 'create')
assert.equal(decideQueueAdmission({ existing: { status: 'resolving' } }).action, 'focus')
assert.equal(decideQueueAdmission({ existing: { status: 'ready' } }).notice?.actions.includes('select-format'), true)
assert.equal(decideQueueAdmission({ existing: { status: 'downloading' } }).action, 'focus')
assert.equal(decideQueueAdmission({ existing: { status: 'queued' } }).notice?.message, 'Already in your queue.')
assert.deepEqual(
  decideQueueAdmission({ existing: { status: 'complete', file_path: '/tmp/keep.mp4' }, filePresent: true }),
  {
    action: 'focus',
    notice: {
      tone: 'neutral',
      message: 'Already downloaded.',
      actions: ['reveal', 'download-again']
    }
  }
)
assert.equal(
  decideQueueAdmission({ existing: { status: 'complete', file_path: '/tmp/gone.mp4' }, filePresent: false }).action,
  'requeue'
)
assert.equal(decideQueueAdmission({ existing: { status: 'error' } }).action, 'retry')
assert.equal(decideQueueAdmission({ existing: { status: 'cancelled' } }).action, 'retry')
assert.equal(bulkQueueNotice(0), undefined)
assert.equal(bulkQueueNotice(1)?.message, '1 already in your queue.')
assert.equal(bulkQueueNotice(3)?.message, '3 already in your queue.')
assert.equal(
  shouldRedownloadExisting({ status: 'complete', file_path: '/tmp/gone.mp4' }, () => false),
  true,
  'trashed complete file must start a new download'
)
assert.equal(
  shouldRedownloadExisting({ status: 'complete', file_path: null }, () => true),
  true,
  'complete row without a path must start a new download'
)
assert.equal(
  shouldRedownloadExisting({ status: 'complete', file_path: '/tmp/keep.mp4' }, (path) => path === '/tmp/keep.mp4'),
  false,
  'complete row with a real file still dedupes'
)
assert.equal(
  shouldRedownloadExisting({ status: 'downloading', file_path: null }, () => false),
  false,
  'in-flight rows stay reused'
)
assert.equal(
  hintDirectMediaUrl('https://cdn.example/hls/stream?sig=1', 'hls'),
  'https://cdn.example/hls/stream?sig=1#.m3u8'
)
assert.equal(
  hintDirectMediaUrl('https://cdn.example/index.m3u8?sig=1', 'hls'),
  'https://cdn.example/index.m3u8?sig=1'
)

console.log('media identity tests passed')
