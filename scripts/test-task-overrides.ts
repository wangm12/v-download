import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  applyFolderChange,
  buildTaskOverridePayload,
  isAllowedTaskProxyUrl,
  parseExtraHeaders,
  shouldPersistDownloadDirOnFolderChange
} from '../src/renderer/src/components/taskOverridesPresentation.ts'
import { pickPersistedExtras } from '../src/main/persistedExtras.ts'
import {
  isRemoteJobTask,
  resolveTaskDownloadOverrides
} from '../src/main/taskOverrides.ts'

const root = process.cwd()
const formatDialog = readFileSync(join(root, 'src/renderer/src/components/FormatDialog.tsx'), 'utf8')

assert.equal(shouldPersistDownloadDirOnFolderChange(), false, 'folder Change must not persist the global download dir')
assert.doesNotMatch(
  formatDialog,
  /updateSettings\(\s*['"]downloadDir['"]/,
  'FormatDialog Change must not write settings.downloadDir'
)

const changed = applyFolderChange('/Users/me/Downloads', '/Volumes/Media/clips')
assert.equal(changed.downloadDir, '/Volumes/Media/clips')
assert.equal(changed.persistGlobal, false)

assert.equal(isAllowedTaskProxyUrl(''), true)
assert.equal(isAllowedTaskProxyUrl('   '), true)
assert.equal(isAllowedTaskProxyUrl('http://127.0.0.1:8080'), true)
assert.equal(isAllowedTaskProxyUrl('http://user:pass@127.0.0.1:8080'), false)
assert.equal(isAllowedTaskProxyUrl('ftp://127.0.0.1:21'), false)

const headers = parseExtraHeaders('Referer: https://www.youtube.com/\nX-Test: one\n\nInvalid line')
assert.equal(headers.Referer, 'https://www.youtube.com/')
assert.equal(headers['X-Test'], 'one')
assert.equal(headers['Invalid line'], undefined)

const withOverrides = buildTaskOverridePayload({
  downloadDir: '/Volumes/Media/clips',
  settingsDownloadDir: '/Users/me/Downloads',
  proxyUrl: 'http://127.0.0.1:8080',
  extraHeadersText: 'Referer: https://www.youtube.com/\nX-Test: one',
  existingHeaders: { 'User-Agent': 'V-Download-Ext' }
})
assert.equal(withOverrides.outputDir, '/Volumes/Media/clips')
assert.equal(withOverrides.proxyUrl, 'http://127.0.0.1:8080')
assert.equal(withOverrides.customHeaders?.Referer, 'https://www.youtube.com/')
assert.equal(withOverrides.customHeaders?.['X-Test'], 'one')
assert.equal(withOverrides.customHeaders?.['User-Agent'], 'V-Download-Ext')

const emptyOverride = buildTaskOverridePayload({
  downloadDir: '/Users/me/Downloads',
  settingsDownloadDir: '/Users/me/Downloads',
  proxyUrl: '   ',
  extraHeadersText: '',
  existingHeaders: { Referer: 'https://example.com/' }
})
assert.equal(emptyOverride.outputDir, undefined)
assert.equal(emptyOverride.proxyUrl, undefined)
assert.deepEqual(emptyOverride.customHeaders, { Referer: 'https://example.com/' })

const desktopResolved = resolveTaskDownloadOverrides({
  taskOutputDir: '/Volumes/Media/clips',
  taskProxyUrl: 'http://127.0.0.1:8080',
  taskHeaders: { Referer: 'https://www.youtube.com/' },
  settingsDownloadDir: '/Users/me/Downloads',
  settingsProxyUrl: 'http://127.0.0.1:9'
})
assert.equal(desktopResolved.outputDir, '/Volumes/Media/clips')
assert.equal(desktopResolved.proxyUrl, 'http://127.0.0.1:8080')
assert.deepEqual(desktopResolved.customHeaders, { Referer: 'https://www.youtube.com/' })

const fallbackResolved = resolveTaskDownloadOverrides({
  taskOutputDir: '',
  taskProxyUrl: '',
  taskHeaders: undefined,
  settingsDownloadDir: '/Users/me/Downloads',
  settingsProxyUrl: 'http://127.0.0.1:9'
})
assert.equal(fallbackResolved.outputDir, '/Users/me/Downloads')
assert.equal(fallbackResolved.proxyUrl, 'http://127.0.0.1:9')
assert.equal(fallbackResolved.customHeaders, undefined)

const remoteMeta = {
  remoteJobId: 'abcd1234efgh5678',
  remoteOutputDir: '/Users/me/Downloads/remote-jobs/abcd1234efgh5678',
  outputDir: '/Volumes/Media/clips',
  proxyUrl: 'http://127.0.0.1:8080',
  customHeaders: { Referer: 'https://desktop.example/' }
}
assert.equal(isRemoteJobTask(remoteMeta), true)
const remoteResolved = resolveTaskDownloadOverrides({
  remoteJobId: remoteMeta.remoteJobId,
  remoteOutputDir: remoteMeta.remoteOutputDir,
  taskOutputDir: remoteMeta.outputDir,
  taskProxyUrl: remoteMeta.proxyUrl,
  taskHeaders: remoteMeta.customHeaders,
  settingsDownloadDir: '/Users/me/Downloads',
  settingsProxyUrl: 'http://127.0.0.1:9'
})
assert.equal(remoteResolved.outputDir, '/Users/me/Downloads/remote-jobs/abcd1234efgh5678')
assert.equal(remoteResolved.proxyUrl, 'http://127.0.0.1:9', 'remote jobs ignore desktop proxy override')
assert.equal(remoteResolved.customHeaders, undefined, 'remote jobs ignore desktop header override')

const persisted = pickPersistedExtras({
  outputDir: '/Volumes/Media/clips',
  proxyUrl: 'http://127.0.0.1:8080',
  customHeaders: { Referer: 'https://www.youtube.com/' }
})
assert.equal(persisted.outputDir, '/Volumes/Media/clips')
assert.equal(persisted.proxyUrl, 'http://127.0.0.1:8080')
assert.equal((persisted.customHeaders as Record<string, string>).Referer, 'https://www.youtube.com/')

const manager = readFileSync(join(root, 'src/main/downloadManager.ts'), 'utf8')
assert.match(manager, /resolveTaskDownloadOverrides/, 'runTask must resolve per-task dest/proxy/headers')
assert.match(manager, /proxyUrl: taskProxyUrl/, 'yt-dlp must receive the resolved per-task proxy')
assert.doesNotMatch(
  manager,
  /proxyUrl: settings\.get\('proxyUrl'\)/,
  'runTask must not hard-code the global proxy when a per-task override exists'
)

const douyin = readFileSync(join(root, 'src/main/douyin.ts'), 'utf8')
assert.match(
  douyin,
  /async function resolveShortUrl\([\s\S]*?proxyUrl/,
  'Douyin short-URL resolve must accept proxyUrl'
)
assert.match(
  douyin,
  /fetchWithTimeout\(\s*url,\s*\{[\s\S]*?signal: options\?\.signal,\s*\},\s*\{\s*proxyUrl: options\?\.proxyUrl/,
  'Douyin aweme/detail must pass proxyUrl into fetchWithTimeout'
)
assert.match(
  douyin,
  /fetchDouyinHtml\(pageUrl, cookiesFilePath, uaMode, \{[\s\S]*?proxyUrl: options\?\.proxyUrl/,
  'Douyin page HTML fetch must receive proxyUrl'
)

const xhs = readFileSync(join(root, 'src/main/xiaohongshu.ts'), 'utf8')
assert.match(
  xhs,
  /fetchWithTimeout\(\s*url\.trim\(\),[\s\S]*?\{\s*proxyUrl\s*\}/,
  'XHS short-URL resolve must pass proxyUrl'
)
assert.match(
  xhs,
  /fetchWithTimeout\(\s*pageUrl,[\s\S]*?\{\s*proxyUrl\s*\}/,
  'XHS page HTML fetch must pass proxyUrl'
)
assert.match(
  xhs,
  /getXiaohongshuInfo\([\s\S]*?options\?: XiaohongshuFetchOptions/,
  'XHS info resolve must accept fetch options including proxyUrl'
)

console.log('task override tests passed')
