import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const root = process.cwd()
const updater = readFileSync(join(root, 'src/main/updater.ts'), 'utf8')
const main = readFileSync(join(root, 'src/main/index.ts'), 'utf8')
const docs = readFileSync(join(root, 'docs/RELEASE.md'), 'utf8')

assert.match(updater, /await import\(['"]electron-updater['"]\)/)
assert.match(updater, /if \(!config\) return false/)
assert.match(updater, /if \(initialized \|\| !app\.isPackaged\) return false/)
assert.match(updater, /url\.protocol !== 'https:'/)
assert.match(updater, /url\.username \|\| url\.password/)
assert.match(updater, /setFeedURL\(\{ provider: 'generic', url: config\.providerUrl \}\)/)
assert.doesNotMatch(updater, /https:\/\/[^'"`\s]+/)
assert.doesNotMatch(updater, /token|secret|password\s*:/i)
assert.match(updater, /redacted-url/)
assert.match(main, /void initializeUpdater\(mainWindow\)/)
assert.match(main, /registerUpdaterHandlers\(\)/)
assert.match(docs, /VDOWNLOAD_UPDATE_PROVIDER_URL/)
assert.match(docs, /HTTPS/)

console.log('updater contract passed (lazy, packaged/configured, HTTPS-only, redacted errors, additive IPC)')
