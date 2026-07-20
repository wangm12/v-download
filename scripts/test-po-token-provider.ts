import assert from 'node:assert/strict'
import { chmod, mkdtemp, writeFile, rm, readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'
import { ensurePoTokenProvider, stopPoTokenServer } from '../src/main/poTokenServer'

async function main(): Promise<void> {
const dir = await mkdtemp(join(tmpdir(), 'v-download-po-token-'))
const fake = join(dir, 'fake-provider.js')
const plugins = join(dir, 'yt_dlp_plugins')
const count = join(dir, 'count')
await writeFile(fake, `#!/usr/bin/env node
const http=require('http'),fs=require('fs'); const port=Number(process.argv[process.argv.indexOf('--port')+1]);
if(process.env.COUNT_FILE) fs.appendFileSync(process.env.COUNT_FILE,'1');
if(process.env.FAKE_MODE==='timeout') setTimeout(()=>{},10000); else if(process.env.FAKE_MODE==='crash') process.exit(17); else { const s=http.createServer((q,r)=>{if(q.url==='/ping'){r.statusCode=(process.env.FAKE_MODE==='healthfail'||process.env.FAKE_MODE==='notfound')?404:200;r.end('ok')}else{r.statusCode=404;r.end()}});s.listen(port,'127.0.0.1'); }
`)
await chmod(fake, 0o755)
await mkdir(plugins)
await writeFile(join(plugins, 'README'), 'fake plugin')
process.env.V_DOWNLOAD_PO_TOKEN_PROVIDER = fake
process.env.V_DOWNLOAD_PO_TOKEN_PLUGIN_DIR = plugins
process.env.COUNT_FILE = count
try {
  const ready = await ensurePoTokenProvider()
  assert.equal(ready.status, 'ready')
  assert.match(ready.provider?.extractorArgs ?? '', /^youtubepot-bgutilhttp:base_url=http:\/\/127\.0\.0\.1:\d+$/)
  assert.equal(ready.provider?.pluginDir, plugins)
  const reused = await ensurePoTokenProvider()
  assert.equal(reused.provider?.baseUrl, ready.provider?.baseUrl)
  assert.equal((await readFile(count, 'utf8')).length, 1)
  await stopPoTokenServer()
  process.env.V_DOWNLOAD_PO_TOKEN_PLUGIN_DIR = join(dir, 'missing-plugins')
  const noPlugins = await ensurePoTokenProvider()
  assert.equal(noPlugins.status, 'unavailable')
  process.env.V_DOWNLOAD_PO_TOKEN_PLUGIN_DIR = plugins
  const conflict = createServer().listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => conflict.once('listening', () => resolve()))
  const conflictPort = (conflict.address() as { port: number }).port
  process.env.V_DOWNLOAD_PO_TOKEN_PROVIDER_PORT = String(conflictPort)
  const conflicted = await ensurePoTokenProvider()
  assert.equal(conflicted.status, 'unavailable')
  await stopPoTokenServer()
  await new Promise<void>((resolve) => conflict.close(() => resolve()))
  delete process.env.V_DOWNLOAD_PO_TOKEN_PROVIDER_PORT
  const recovered = await ensurePoTokenProvider()
  assert.equal(recovered.status, 'ready')
  await stopPoTokenServer()
  process.env.FAKE_MODE = 'timeout'
  const timeout = await ensurePoTokenProvider()
  assert.equal(timeout.status, 'unavailable')
  await stopPoTokenServer()
  process.env.FAKE_MODE = 'healthfail'
  const healthFailure = await ensurePoTokenProvider()
  assert.equal(healthFailure.status, 'unavailable')
  await stopPoTokenServer()
  process.env.FAKE_MODE = 'notfound'
  const notFoundHealth = await ensurePoTokenProvider()
  assert.equal(notFoundHealth.status, 'unavailable')
  await stopPoTokenServer()
  process.env.FAKE_MODE = 'crash'
  const crash = await ensurePoTokenProvider()
  assert.equal(crash.status, 'unavailable')
  await stopPoTokenServer()
  delete process.env.FAKE_MODE
  delete process.env.V_DOWNLOAD_PO_TOKEN_PROVIDER_PORT
  // Keep the missing-provider case deterministic even when bundled production
  // resources exist under resources/engines/po-token.
  process.env.V_DOWNLOAD_PO_TOKEN_PROVIDER = join(dir, 'missing-provider')
  delete process.env.V_DOWNLOAD_PO_TOKEN_PLUGIN_DIR
  const missing = await ensurePoTokenProvider()
  assert.equal(missing.status, 'unavailable')
  console.log('PO token provider fake tests passed: ready, timeout, missing, cleanup, official extractor args')
} finally {
  delete process.env.V_DOWNLOAD_PO_TOKEN_PROVIDER
  delete process.env.V_DOWNLOAD_PO_TOKEN_PLUGIN_DIR
  delete process.env.FAKE_MODE
  delete process.env.V_DOWNLOAD_PO_TOKEN_PROVIDER_PORT
  await stopPoTokenServer()
  await rm(dir, { recursive: true, force: true })
}
}
void main()
