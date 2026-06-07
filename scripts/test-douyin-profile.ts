/**
 * Douyin profile parser + signing smoke tests (run: npm run test:douyin-profile).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { filterDouyinCookies } from '../src/main/browserCookies'
import { mapBrowserToPlaywrightLaunch } from '../src/main/cookiesBrowser'
import { extractProfilePostsFromHtml, awemeItemToProfileRow } from '../src/main/douyinProfileHtml'
import { buildSignedAwemePostUrl, resolveMsToken } from '../src/main/douyinProfileSign'
import { signDouyinUrlWithXBogus } from '../src/main/douyinProfileXbogus'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturePath = join(__dirname, '..', 'tests', 'fixtures', 'douyin-profile-embed.html')

test('extractProfilePostsFromHtml parses RENDER_DATA embed', () => {
  const html = readFileSync(fixturePath, 'utf-8')
  const { rows, hasMore, maxCursor } = extractProfilePostsFromHtml(html, 50)
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.awemeId, '71234567890123456')
  assert.equal(rows[0]?.author, 'TestAuthor')
  assert.equal(rows[0]?.mediaType, 'video')
  assert.equal(hasMore, true)
  assert.equal(maxCursor, '1234')
})

test('resolveMsToken generates fallback when no cookie file', () => {
  const token = resolveMsToken(undefined)
  assert.ok(token.length === 164 || token.length === 184)
})

test('signDouyinUrlWithXBogus appends X-Bogus param', () => {
  const signed = signDouyinUrlWithXBogus('https://www.douyin.com/aweme/v1/web/aweme/post/?aid=6383')
  assert.match(signed, /X-Bogus=[A-Za-z0-9+/=_-]+/)
})

test('buildSignedAwemePostUrl includes post-specific query fields', () => {
  const url = buildSignedAwemePostUrl('MS4wLjABAAAAtest', '0', 35, undefined)
  assert.match(url, /show_live_replay_strategy=1/)
  assert.match(url, /publish_video_strategy_type=2/)
  assert.match(url, /msToken=/)
  assert.match(url, /X-Bogus=/)
})

test('filterDouyinCookies keeps Douyin domains only', () => {
  const filtered = filterDouyinCookies([
    { name: 'msToken', value: 'abc', domain: '.douyin.com', path: '/', secure: true },
    { name: 'sid', value: 'x', domain: '.google.com', path: '/', secure: true },
    { name: 'ttwid', value: 'y', domain: 'www.douyin.com', path: '/', secure: true },
  ])
  assert.equal(filtered.length, 2)
  assert.ok(filtered.every((c) => /douyin/i.test(c.domain)))
})

test('awemeItemToProfileRow maps API aweme_list item', () => {
  const row = awemeItemToProfileRow({
    aweme_id: '71234567890123456',
    desc: 'Test post',
    author: { nickname: 'TestAuthor' },
    video: { duration: 15000, cover: { url_list: ['https://example.com/c.jpg'] } },
  })
  assert.ok(row)
  assert.equal(row?.awemeId, '71234567890123456')
  assert.equal(row?.author, 'TestAuthor')
  assert.equal(row?.mediaType, 'video')
})

test('mapBrowserToPlaywrightLaunch supports chrome and rejects safari', () => {
  assert.deepEqual(mapBrowserToPlaywrightLaunch('chrome'), { channel: 'chrome' })
  assert.equal(mapBrowserToPlaywrightLaunch('safari'), null)
  assert.equal(mapBrowserToPlaywrightLaunch('firefox'), null)
})
