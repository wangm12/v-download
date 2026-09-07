import assert from 'node:assert/strict'
import {
  compareEngineVersions,
  parseAssetDigest,
  resolveEngineUpdateState,
  selectPreferredEnginePath
} from '../src/main/engineManagerModel'

assert.equal(compareEngineVersions('2026.07.04', '2026.08.01') < 0, true)
assert.equal(compareEngineVersions('8.1.2', '8.1.2'), 0)
assert.equal(compareEngineVersions('8.1.10', '8.1.2') > 0, true)
assert.equal(parseAssetDigest('sha256:b0724470a0cf6dae5175a87eee05d6e75c5a0c10d2c3015166bd4d34e92b1b7b'), 'b0724470a0cf6dae5175a87eee05d6e75c5a0c10d2c3015166bd4d34e92b1b7b')
assert.equal(parseAssetDigest('md5:abc'), null)
assert.deepEqual(
  resolveEngineUpdateState({ currentVersion: '2026.07.04', latestVersion: '2026.08.01' }),
  { state: 'available', version: '2026.08.01' }
)
assert.deepEqual(
  resolveEngineUpdateState({ currentVersion: '2026.08.01', latestVersion: '2026.07.04' }),
  { state: 'current', version: '2026.08.01' }
)

assert.equal(
  selectPreferredEnginePath({
    requestedPath: '/opt/homebrew/bin/yt-dlp',
    requestedExists: true,
    requestedVersion: '2026.04.07.233742',
    bundledPath: '/app/resources/engines/darwin-arm64/yt-dlp',
    bundledExists: true,
    bundledVersion: '2026.07.04'
  }),
  '/app/resources/engines/darwin-arm64/yt-dlp'
)
assert.equal(
  selectPreferredEnginePath({
    requestedPath: '/user/engines/yt-dlp',
    requestedExists: true,
    requestedVersion: '2026.08.19',
    bundledPath: '/app/resources/engines/darwin-arm64/yt-dlp',
    bundledExists: true,
    bundledVersion: '2026.07.04'
  }),
  '/user/engines/yt-dlp'
)
assert.equal(
  selectPreferredEnginePath({
    requestedPath: '/opt/homebrew/bin/yt-dlp',
    requestedExists: true,
    requestedVersion: null,
    bundledPath: '/app/resources/engines/darwin-arm64/yt-dlp',
    bundledExists: true,
    bundledVersion: '2026.07.04'
  }),
  '/app/resources/engines/darwin-arm64/yt-dlp'
)
assert.equal(
  selectPreferredEnginePath({
    requestedPath: '/opt/homebrew/bin/yt-dlp',
    requestedExists: true,
    requestedVersion: '2026.04.07',
    bundledPath: '/missing/yt-dlp',
    bundledExists: false,
    bundledVersion: null
  }),
  '/opt/homebrew/bin/yt-dlp'
)

console.log('engine manager model tests passed')
