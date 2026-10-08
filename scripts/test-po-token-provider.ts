import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmod, mkdtemp, writeFile, rm, readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'
import { ensurePoTokenProvider, stopPoTokenServer } from '../src/main/poTokenServer'

const cases = ['reuse-and-shutdown', 'missing-plugins', 'port-conflict', 'timeout', 'healthfail', 'notfound', 'crash', 'missing-provider']

async function runCase(name: string): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'v-download-po-token-'))
  const fake = join(dir, 'fake-provider.js')
  const plugins = join(dir, 'yt_dlp_plugins')
  const count = join(dir, 'count')
  await writeFile(fake, [
    '#!/usr/bin/env node',
    "const http=require('http'),fs=require('fs'); const port=Number(process.argv[process.argv.indexOf('--port')+1]);",
    "if(process.env.COUNT_FILE) fs.appendFileSync(process.env.COUNT_FILE,'1');",
    "if(process.env.FAKE_MODE==='timeout') setTimeout(()=>{},10000); else if(process.env.FAKE_MODE==='crash') process.exit(17); else { const s=http.createServer((q,r)=>{if(q.url==='/ping'){r.statusCode=(process.env.FAKE_MODE==='healthfail'||process.env.FAKE_MODE==='notfound')?404:200;r.end('ok')}else{r.statusCode=404;r.end()}});s.listen(port,'127.0.0.1'); }"
  ].join('\n'))
  await chmod(fake, 0o755)
  await mkdir(plugins)
  await writeFile(join(plugins, 'README'), 'fake plugin')
  process.env.V_DOWNLOAD_PO_TOKEN_PROVIDER = fake
  process.env.V_DOWNLOAD_PO_TOKEN_PLUGIN_DIR = plugins
  process.env.COUNT_FILE = count
  const starts = async () => (await readFile(count, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return ''
    throw error
  })).length

  try {
    if (name === 'reuse-and-shutdown') {
      const [ready, concurrent] = await Promise.all([ensurePoTokenProvider(), ensurePoTokenProvider()])
      assert.equal(ready.status, 'ready')
      assert.equal(concurrent.provider?.baseUrl, ready.provider?.baseUrl)
      assert.match(ready.provider?.extractorArgs ?? '', /^youtubepot-bgutilhttp:base_url=http:\/\/127\.0\.0\.1:\d+$/)
      assert.equal(ready.provider?.pluginDir, plugins)
      const reused = await ensurePoTokenProvider()
      assert.equal(reused.provider?.baseUrl, ready.provider?.baseUrl)
      assert.equal(await starts(), 1)
      await stopPoTokenServer()
      const stopped = await ensurePoTokenProvider()
      assert.equal(stopped.status, 'unavailable')
      assert.match(stopped.reason ?? '', /shutdown/)
      assert.equal(await starts(), 1, 'shutdown must not admit another provider process')
    } else if (name === 'missing-plugins' || name === 'missing-provider') {
      if (name === 'missing-plugins') process.env.V_DOWNLOAD_PO_TOKEN_PLUGIN_DIR = join(dir, 'missing-plugins')
      else process.env.V_DOWNLOAD_PO_TOKEN_PROVIDER = join(dir, 'missing-provider')
      const missing = await ensurePoTokenProvider()
      assert.equal(missing.status, 'unavailable')
      assert.match(missing.reason ?? '', name === 'missing-plugins' ? /plugin tree/ : /resource is not installed/)
      assert.equal(await starts(), 0)
    } else if (name === 'port-conflict') {
      const conflict = createServer().listen(0, '127.0.0.1')
      await new Promise<void>((resolve) => conflict.once('listening', () => resolve()))
      process.env.V_DOWNLOAD_PO_TOKEN_PROVIDER_PORT = String((conflict.address() as { port: number }).port)
      try {
        const conflicted = await ensurePoTokenProvider()
        assert.equal(conflicted.status, 'unavailable')
        assert.match(conflicted.reason ?? '', /loopback port/)
        assert.equal(await starts(), 0)
      } finally {
        await new Promise<void>((resolve) => conflict.close(() => resolve()))
        delete process.env.V_DOWNLOAD_PO_TOKEN_PROVIDER_PORT
      }
      const recovered = await ensurePoTokenProvider()
      assert.equal(recovered.status, 'ready', 'a failed startup can recover before application shutdown')
      assert.equal(await starts(), 1)
    } else {
      assert.ok(['timeout', 'healthfail', 'notfound', 'crash'].includes(name))
      process.env.FAKE_MODE = name
      const failure = await ensurePoTokenProvider()
      assert.equal(failure.status, 'unavailable')
      assert.match(failure.reason ?? '', /startup timeout or health failure/)
      assert.equal(await starts(), 2, 'startup failure gets one bounded retry')
    }
  } finally {
    await stopPoTokenServer()
    delete process.env.V_DOWNLOAD_PO_TOKEN_PROVIDER
    delete process.env.V_DOWNLOAD_PO_TOKEN_PLUGIN_DIR
    delete process.env.FAKE_MODE
    delete process.env.V_DOWNLOAD_PO_TOKEN_PROVIDER_PORT
    delete process.env.COUNT_FILE
    await rm(dir, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  if (process.argv.includes('--case')) {
    await runCase(process.argv[process.argv.indexOf('--case') + 1])
    return
  }
  // Shutdown is permanent for an app process. Give each startup scenario a fresh
  // process; failed startup may still recover in that same process before stop.
  for (const scenario of cases) {
    const child = spawnSync(process.execPath, [...process.execArgv, process.argv[1], '--case', scenario], {
      encoding: 'utf8', timeout: 30_000
    })
    assert.equal(child.status, 0, scenario + ': ' + (child.error?.message ?? '') + '\n' + child.stdout + '\n' + child.stderr)
  }
  console.log('PO token provider fake tests passed: readiness, reuse, bounded retries, recovery, and permanent shutdown')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
