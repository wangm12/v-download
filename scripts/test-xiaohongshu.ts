import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  extractNoteId,
  formatXhsResolveError,
  isXiaohongshuUrl,
  isXhsNoVideoFormatsError,
  isXhsShortUrl,
} from '../src/main/xiaohongshu'

const resolver = readFileSync('src/main/videoInfoResolver.ts', 'utf8')
assert.match(resolver, /formatXhsResolveError/)
assert.match(resolver, /xhsHint \?\? \(await getXiaohongshuInfo/)

assert.equal(isXiaohongshuUrl('https://xhslink.cn/o/7OA0OYWB0EB'), true)
assert.equal(isXiaohongshuUrl('https://xhslink.com/a/AbCdEf'), true)
assert.equal(isXiaohongshuUrl('https://www.xiaohongshu.com/explore/68b1b8d6000000001d00c2d4'), true)
assert.equal(isXiaohongshuUrl('https://youtube.com/watch?v=1'), false)

assert.equal(isXhsShortUrl('https://xhslink.cn/o/7OA0OYWB0EB'), true)
assert.equal(isXhsShortUrl('https://xhslink.com/a/AbCdEf'), true)
assert.equal(isXhsShortUrl('https://www.xiaohongshu.com/explore/68b1b8d6000000001d00c2d4'), false)

assert.equal(
  extractNoteId('https://www.xiaohongshu.com/explore/68b1b8d6000000001d00c2d4?xsec_token=abc'),
  '68b1b8d6000000001d00c2d4'
)
assert.equal(
  extractNoteId('https://www.xiaohongshu.com/discovery/item/68b1b8d6000000001d00c2d4'),
  '68b1b8d6000000001d00c2d4'
)
assert.equal(
  extractNoteId(
    'https://www.xiaohongshu.com/user/profile/5c31698d0000000007018a31/68b1b8d6000000001d00c2d4?xsec_token=abc'
  ),
  '68b1b8d6000000001d00c2d4'
)
assert.equal(extractNoteId('https://xhslink.cn/o/7OA0OYWB0EB'), null)

const ytdlpImageError =
  'ERROR: [XiaoHongShu] 68b1b8d6000000001d00c2d4: No video formats found! please report this issue on https://github.com/yt-dlp/yt-dlp/issues'
assert.equal(isXhsNoVideoFormatsError(ytdlpImageError), true)
assert.equal(isXhsNoVideoFormatsError('HTTP 403 Forbidden'), false)

const formatted = formatXhsResolveError(
  ytdlpImageError,
  'Note data missing — paste the full explore link (with xsec_token) or sync Xiaohongshu cookies'
)
assert.match(formatted, /no video formats/i)
assert.match(formatted, /xsec_token/)
assert.doesNotMatch(formatted, /github\.com\/yt-dlp/)

const formattedNoHint = formatXhsResolveError(ytdlpImageError, '')
assert.match(formattedNoHint, /image note|image gallery/i)
assert.doesNotMatch(formattedNoHint, /github\.com\/yt-dlp/)

console.log('xiaohongshu url and error helpers passed')
