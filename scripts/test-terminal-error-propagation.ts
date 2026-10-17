import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { classifyDownloadError, downloadProcessFailure } from '../src/main/downloadError'
import { spawnManagedProcess } from '../src/main/managedChildProcesses'

async function main(): Promise<void> {
for (const youtube of [false, true]) {
  for (const message of [
    'ERROR: [generic] missing: HTTP Error 404: Not Found (caused by <HTTPError 404: Not Found>)',
    '[in#0] Error opening input: Server returned 404 Not Found',
    'HTTP error 410 Gone',
  ]) assert.equal(classifyDownloadError(message, youtube), 'UNSUPPORTED')
  assert.equal(classifyDownloadError('HTTP Error 503: Service Unavailable', youtube), 'NETWORK_RETRYABLE')
}
assert.notEqual(classifyDownloadError('Requested media not found', false), 'ENGINE_MISSING')
assert.notEqual(classifyDownloadError(Object.assign(new Error('ENOENT: open output file'), { code: 'ENOENT', syscall: 'open' }), false), 'ENGINE_MISSING')
assert.equal(classifyDownloadError('ffmpeg not found. Please install it.', false), 'ENGINE_MISSING')
assert.equal(classifyDownloadError('ffmpeg and ffprobe not found. Please install them.', false), 'ENGINE_MISSING')
assert.equal(classifyDownloadError('Sign in: authentication required', false), 'AUTH_REQUIRED')
assert.equal(classifyDownloadError('Widevine DRM protected content', false), 'DRM_PROTECTED')
assert.equal(classifyDownloadError('YouTube missing PO token', true), 'PO_TOKEN_REQUIRED')
// Use a real failed process launch, preserving its errno/syscall and adapter string.
const missingEngine = await new Promise<Error>((resolve, reject) => {
  const child = spawn(`/v-download-missing-engine-${process.pid}/yt-dlp`, [], { stdio: 'ignore' })
  child.once('error', resolve)
  child.once('spawn', () => { child.kill(); reject(new Error('Expected an unavailable engine')) })
})
assert.equal(classifyDownloadError(missingEngine, false), 'ENGINE_MISSING')
assert.equal(classifyDownloadError(missingEngine.message, false), 'ENGINE_MISSING')
if (process.platform !== 'win32') {
  const supervised = await new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
    const child = spawnManagedProcess(`/v-download-missing-engine-${process.pid}/yt-dlp`, [], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString() })
    child.once('error', reject)
    child.once('close', (code) => resolve({ code, stderr }))
  })
  assert.notEqual(supervised.code, 0)
  assert.equal(classifyDownloadError(downloadProcessFailure(supervised.stderr, supervised.code), false), 'ENGINE_MISSING')
}
assert.equal(classifyDownloadError(downloadProcessFailure('v-download-managed-child: /engine: /missing/interpreter: bad interpreter: No such file or directory', 126), false), 'ENGINE_MISSING')
assert.equal(downloadProcessFailure('progress\nERROR: HTTP Error 404: Not Found\ncleanup', 1), 'ERROR: HTTP Error 404: Not Found')
assert.equal(downloadProcessFailure('x'.repeat(10_000), 1).length, 4096)
const source = await readFile(new URL('../src/main/downloadManager.ts', import.meta.url), 'utf8')
const errorTransitions = [...source.matchAll(/task\.status\s*=\s*'error'/g)]
assert.equal(errorTransitions.length, 1, 'all task error transitions must use setTaskError')
assert.match(source, /function setTaskError[\s\S]*db\.updateDownload\(task\.id, \{ status: 'error',[\s\S]*error_code: task\.errorCode/)
const completeBlocks = source.split(/task\.status\s*=\s*'complete'/).slice(1)
for (const block of completeBlocks) assert.match(block.slice(0, 500), /task\.errorCode\s*=\s*null/)
for (const block of source.split(/task\.status\s*=\s*'(?:cancelled|paused)'/).slice(1)) {
  assert.match(block.slice(0, 500), /task\.errorCode\s*=\s*null/)
  assert.match(block.slice(0, 700), /error_code:\s*null/)
}
assert.match(source, /status: 'queued', error: null, error_code: null/)
console.log('terminal error_code propagation assertions passed')
}
void main()
