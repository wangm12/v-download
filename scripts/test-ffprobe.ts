import assert from 'node:assert/strict'
import { probeMediaMetadata } from '../src/main/ffprobe'

async function main() {
  const options = { stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' }
  const probe = (code: string, signal?: AbortSignal) => probeMediaMetadata(process.execPath, ['-e', code], options, signal)
  assert.deepEqual(await probe('process.stdout.write(JSON.stringify({streams:[{codec_type:"video"}]}))'), {
    ok: true, metadata: { streams: [{ codec_type: 'video' }] }
  })
  assert.equal((await probe('process.stdout.write("not-json")')).ok, false)
  const failed = await probe('process.stderr.write("fixture read failure");process.exitCode=1')
  assert.ok(!failed.ok && failed.error.includes('fixture read failure'))
  const bounded = await probe('process.stdout.write("x".repeat(70*1024));setInterval(()=>{},1000)')
  assert.ok(!bounded.ok && bounded.error.includes('safety limit'))
  const abort = new AbortController()
  const cancelled = probe('setInterval(()=>{},1000)', abort.signal)
  setTimeout(() => abort.abort(), 100)
  const result = await cancelled
  assert.ok(!result.ok && result.cancelled)
  const preAborted = await probe('throw Error("must not start")', abort.signal)
  assert.ok(!preAborted.ok && preAborted.cancelled)
  console.log('ffprobe real subprocess: success, malformed JSON, read failure, bounded capture and cancellation passed')
}
void main()
