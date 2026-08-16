import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')
const hook = read('src/renderer/src/hooks/useUrlHandler.ts')
const app = read('src/renderer/src/App.tsx')
const row = read('src/renderer/src/components/DownloadItem.tsx')
const manager = read('src/main/infoResolutionManager.ts')
const downloads = read('src/main/downloadManager.ts')

assert.match(hook, /startInfoResolve/)
assert.match(hook, /onInfoResolveResult/)
assert.match(hook, /readyResultsRef/)
assert.doesNotMatch(app, /Fetching video info/)
assert.match(row, /status === 'resolving'/)
assert.match(row, /status === 'ready'/)
assert.match(row, /Select format/)
assert.match(manager, /maxConcurrent: MAX_CONCURRENT_RESOLVERS/)
assert.match(manager, /resumePersistedInfoResolves/)
assert.match(downloads, /status: 'resolving'/)
assert.match(downloads, /status: 'ready'/)
assert.match(downloads, /promoteInfoResolveTask/)

console.log('info resolution UI and persistence contract passed')
