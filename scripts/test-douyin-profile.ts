/**
 * Douyin profile parser + signing smoke tests (run: npm run test:douyin-profile).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { isDouyinShortUrl, parseDouyinProfileUrl } from '@v-download/shared'
import { filterDouyinCookies } from '../src/main/browserCookies'
import { extractSecUidFromProfileUrl } from '../src/main/douyinProfile'
import { resolveDouyinShareUrl } from '../src/main/douyinUrlResolution'
import { douyinProfileUrlFromInfo, isDouyinProfileHomeUrl, normalizeDouyinProfileUrl } from '../src/renderer/src/utils/douyinBulk'
import { mapBrowserToPlaywrightLaunch } from '../src/main/cookiesBrowser'
import { extractProfilePostsFromHtml, awemeItemToProfileRow } from '../src/main/douyinProfileHtml'
import { buildSignedAwemePostUrl, resolveMsToken } from '../src/main/douyinProfileSign'
import { signDouyinUrlWithXBogus } from '../src/main/douyinProfileXbogus'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturePath = join(__dirname, '..', 'tests', 'fixtures', 'douyin-profile-embed.html')

const sharedSecUid = 'MS4wLjABAAAAyn8Tq021DEzJS2nlPRwEpiPoI4SZHWfPKwnfoxqJkHQUro6Jlt-CjXJDNblpMHyv'
const canonicalProfile = `https://www.douyin.com/user/${sharedSecUid}`
const mobileProfileShare = `https://www.iesdouyin.com/share/user/${sharedSecUid}?from_ssr=1&sec_uid=${sharedSecUid}&from=web_code_link`

test('creator pages and mobile user shares have the same profile identity', () => {
  for (const url of [canonicalProfile, mobileProfileShare, `https://m.douyin.com/share/user/${sharedSecUid}/`, `www.douyin.com/user/${sharedSecUid}`]) {
    assert.deepEqual(parseDouyinProfileUrl(url), { secUid: sharedSecUid, url: canonicalProfile })
    assert.equal(extractSecUidFromProfileUrl(url), sharedSecUid)
    assert.equal(isDouyinProfileHomeUrl(url), true)
    assert.equal(normalizeDouyinProfileUrl(url), canonicalProfile)
  }
  assert.equal(normalizeDouyinProfileUrl(`https://www.iesdouyin.com/share/user/12345?sec_uid=${sharedSecUid}`), canonicalProfile)
})

test('video shares, malformed profiles, and unrelated hosts do not open the profile picker', () => {
  for (const url of [
    'https://v.douyin.com/6kPf28FmLv4/',
    `https://www.iesdouyin.com/share/video/71234567890123456?sec_uid=${sharedSecUid}`,
    `https://www.douyin.com/note/71234567890123456?sec_uid=${sharedSecUid}`,
    `https://douyin.com.example.org/user/${sharedSecUid}`,
    `https://example.org/share/user/${sharedSecUid}`,
    `https://douyin.com@evil.example/user/${sharedSecUid}`,
    'https://www.douyin.com/user/',
    'https://www.douyin.com/user/%2Fvideo',
    'https://www.douyin.com/user/%ZZ',
  ]) {
    assert.equal(parseDouyinProfileUrl(url), null, url)
    assert.equal(isDouyinProfileHomeUrl(url), false, url)
  }
})

test('resolved profiles route to the creator picker, while videos keep their format flow', () => {
  assert.equal(douyinProfileUrlFromInfo({ _type: 'douyin_profile', webpage_url: mobileProfileShare }), canonicalProfile)
  assert.equal(douyinProfileUrlFromInfo({ _type: 'video', webpage_url: canonicalProfile }), null)
  assert.equal(douyinProfileUrlFromInfo({ _type: 'douyin_profile', webpage_url: 'https://example.org/user/test' }), null)
  assert.equal(douyinProfileUrlFromInfo(undefined), null)
})

test('short links follow user and video redirects and release the unread response body', async () => {
  const originalFetch = globalThis.fetch
  const shortUrl = 'https://v.douyin.com/6kPf28FmLv4/'
  let target = mobileProfileShare
  let cancelledBodies = 0
  const calls: string[] = []
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push(url)
    assert.equal(init?.method, 'GET')
    const response = url === shortUrl
      ? new Response(null, { status: 302, headers: { Location: target } })
      : new Response(new ReadableStream({ cancel: () => { cancelledBodies++ } }), { status: 200 })
    Object.defineProperty(response, 'url', { value: url })
    return response
  }) as typeof fetch
  try {
    const resolvedProfile = await resolveDouyinShareUrl(shortUrl)
    assert.deepEqual(calls, [shortUrl, mobileProfileShare])
    assert.equal(normalizeDouyinProfileUrl(resolvedProfile), canonicalProfile)
    assert.equal(cancelledBodies, 1)

    target = 'https://www.iesdouyin.com/share/video/71234567890123456/'
    calls.length = 0
    const resolvedVideo = await resolveDouyinShareUrl(shortUrl)
    assert.equal(resolvedVideo, target)
    assert.equal(normalizeDouyinProfileUrl(resolvedVideo), null)
    assert.equal(cancelledBodies, 2)

    calls.length = 0
    assert.equal(await resolveDouyinShareUrl(canonicalProfile), canonicalProfile)
    assert.equal(await resolveDouyinShareUrl(target), target)
    assert.deepEqual(calls, [])

    const controller = new AbortController()
    controller.abort()
    await assert.rejects(resolveDouyinShareUrl(shortUrl, { signal: controller.signal }), { name: 'AbortError' })
    assert.deepEqual(calls, [])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('only real v.douyin.com share URLs trigger short-link inspection', () => {
  assert.equal(isDouyinShortUrl('https://v.douyin.com/6kPf28FmLv4/'), true)
  assert.equal(isDouyinShortUrl('https://v.douyin.com/VideoShare'), true)
  assert.equal(isDouyinShortUrl('https://evil-v.douyin.com/VideoShare'), false)
  assert.equal(isDouyinShortUrl('https://v.douyin.com.evil.example/VideoShare'), false)
  assert.equal(isDouyinShortUrl('https://www.douyin.com/video/1234567890'), false)
})

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
