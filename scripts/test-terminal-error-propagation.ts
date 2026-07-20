import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

async function main(): Promise<void> {
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
