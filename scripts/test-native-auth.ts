import assert from 'node:assert/strict'
import {
  cookieDomainMatchesHost,
  nativeAuthSiteForUrl,
  sanitizeNativeCookie
} from '../src/main/nativeAuthModel'

assert.equal(nativeAuthSiteForUrl('https://www.douyin.com/video/1'), 'douyin')
assert.equal(nativeAuthSiteForUrl('https://www.youtube.com/watch?v=1'), 'youtube')
assert.equal(nativeAuthSiteForUrl('https://example.com/video'), null)
assert.equal(cookieDomainMatchesHost('.douyin.com', 'www.douyin.com'), true)
assert.equal(cookieDomainMatchesHost('www.douyin.com', 'douyin.com'), false)
assert.deepEqual(
  sanitizeNativeCookie({ name: 'sid', value: 'secret', domain: '.douyin.com', path: '/', secure: true, expirationDate: 10 }),
  { name: 'sid', value: 'secret', domain: '.douyin.com', path: '/', secure: true, expirationDate: 10 }
)
assert.equal(sanitizeNativeCookie({ name: '', value: 'secret', domain: '.douyin.com', path: '/', secure: true }), null)

console.log('native auth model tests passed')
