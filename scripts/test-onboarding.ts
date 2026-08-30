import assert from 'node:assert/strict'
import { normalizeProxyUrl } from '../src/main/settingsModel'

assert.equal(normalizeProxyUrl('http://127.0.0.1:8080'), 'http://127.0.0.1:8080')
assert.equal(normalizeProxyUrl('socks5://localhost:1080'), 'socks5://localhost:1080')
assert.equal(normalizeProxyUrl('https://user:password@example.com:443'), '')
assert.equal(normalizeProxyUrl('file:///tmp/proxy'), '')
assert.equal(normalizeProxyUrl(''), '')

console.log('onboarding settings tests passed')
