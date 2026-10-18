/** Optional real Electron/engine E2E. Run after npm run build, on a desktop host. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { randomBytes, createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, readFile, stat, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startDownloadHarness } from './lib/download-harness.mjs'

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)))
const root = await mkdtemp(join(tmpdir(), 'vdownload-adaptive-e2e-'))
await import('node:fs/promises').then(({ chmod }) => chmod(root, 0o700))
const engineRoot = process.env.VDL_E2E_ENGINES || join(repo, 'resources/engines', `${process.platform}-${process.arch}`)
const ffmpeg = join(engineRoot, 'ffmpeg'), ffprobe = join(engineRoot, 'ffprobe')
const ytdlp = join(engineRoot, 'yt-dlp')
const runtime = join(repo, 'out/main/index.js')
const reportPath = process.argv[2] ? resolve(process.argv[2]) : undefined
const result = { cases: [], engineRoot, runtime, requests: [], cleanup: {} }
let harness
let fixture
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function command(executable, args, timeout = 30_000) {
  return await new Promise((resolveRun, reject) => {
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    child.stdout.on('data', (x) => { stdout += x })
    child.stderr.on('data', (x) => { stderr = (stderr + x).slice(-32_768) })
    const timer = setTimeout(() => { child.kill('SIGKILL') }, timeout)
    child.once('error', reject)
    child.once('close', (code) => { clearTimeout(timer); resolveRun({ code, stdout, stderr }) })
  })
}
const invoke = (...args) => harness.invoke(...args)
async function waitTask(id) {
  const end = Date.now() + 60_000
  while (Date.now() < end) {
    const task = (await invoke('get-downloads')).data.find((x) => x.id === id)
    if (task && ['complete', 'error', 'cancelled', 'paused'].includes(task.status)) return task
    await sleep(80)
  }
  throw new Error(`task timed out: ${id}`)
}

try {
  result.runtimeSHA256 = createHash('sha256').update(await readFile(runtime)).digest('hex')
  const built = await stat(runtime)
  for (const name of ['downloadManager.ts', 'ffmpegDownload.ts', 'selectedOutput.ts']) {
    assert.ok((await stat(join(repo, 'src/main', name))).mtimeMs <= built.mtimeMs, 'Run npm run build before this test')
  }
  for (const name of ['profile', 'session', 'temp', 'logs', 'output', 'media', 'probe-fallback']) await mkdir(join(root, name))
  fixture = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://fixture').pathname
    const entry = { path, method: req.method, status: 200 }
    result.requests.push(entry)
    if (req.headers.referer !== fixture.referer) {
      entry.status = 403; res.writeHead(403); res.end(); return
    }
    try {
      const data = await readFile(join(root, 'media', path))
      res.writeHead(200, { 'Content-Type': path.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'application/octet-stream', 'Content-Length': data.length })
      res.end(req.method === 'HEAD' ? undefined : data)
    } catch { entry.status = 404; res.writeHead(404); res.end() }
  })
  await new Promise((r) => fixture.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${fixture.address().port}`
  fixture.referer = `${base}/watch?source=full&context=preserved`
  for (const [name, width, height] of [['360', 640, 360], ['720', 1280, 720]]) {
    const directory = join(root, 'media', name)
    await mkdir(directory)
    await writeFile(join(directory, 'encryption.key'), randomBytes(16))
    await writeFile(join(directory, 'key-info'), `encryption.key\n${join(directory, 'encryption.key')}\n`)
    const encoded = await command(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${width}x${height}:rate=24`,
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '6', '-c:v', 'libx264', '-preset', 'ultrafast',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-g', '48', '-sc_threshold', '0', '-hls_time', '2', '-hls_playlist_type', 'vod',
      '-hls_key_info_file', join(directory, 'key-info'), join(directory, 'index.m3u8')])
    assert.equal(encoded.code, 0, encoded.stderr)
    assert.ok(!(await readFile(join(directory, 'index.m3u8'), 'utf8')).includes('RESOLUTION='))
  }
  await writeFile(join(root, 'media/master.m3u8'), '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=700000,RESOLUTION=640x360\n360/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2400000,RESOLUTION=1280x720\n720/index.m3u8\n')
  // Network probing can fail while probing a downloaded local file succeeds.
  // This verifies that deferred validation never disables the height bound.
  await symlink(ffmpeg, join(root, 'probe-fallback/ffmpeg'))
  await writeFile(join(root, 'probe-fallback/ffprobe'), `#!/bin/sh\nfor arg do last="$arg"; done\ncase "$last" in http:*) exit 1;; esac\nexec '${ffprobe.replaceAll("'", "'\\''")}' "$@"\n`, { mode: 0o700 })
  await writeFile(join(root, 'profile/settings.json'), JSON.stringify({
    downloadDir: join(root, 'output'), ytdlpPath: ytdlp, ffmpegPath: ffmpeg,
    defaultVideoQuality: '1080', cookiesPath: '', concurrency: 1, sleepInterval: 0,
    directMediaEngine: 'auto', warnBeforeQuit: false, remoteApiEnabled: false, onboardingCompleted: true
  }))
  harness = await startDownloadHarness({ root, repo, settings: JSON.parse(await readFile(join(root, 'profile/settings.json'), 'utf8')) })
  const cases = []
  for (const engine of ['auto', 'ytdlp', 'ffmpeg']) {
    cases.push([`${engine}-unknown-720-under-1080`, engine, '/720/index.m3u8', '1080', 720])
    cases.push([`${engine}-unknown-360-under-360`, engine, '/360/index.m3u8', '360', 360])
    cases.push([`${engine}-unknown-720-rejected-at-360`, engine, '/720/index.m3u8', '360', null])
    cases.push([`${engine}-master-selects-360`, engine, '/master.m3u8', '360', 360])
  }
  cases.push(['auto-deferred-probe-720-under-1080', 'auto', '/720/index.m3u8', '1080', 720, true])
  cases.push(['auto-deferred-probe-720-rejected-at-360', 'auto', '/720/index.m3u8', '360', null, true])
  cases.push(['auto-best-keeps-720', 'auto', '/720/index.m3u8', 'best', 720])
  cases.push(['auto-explicit-unknown-360', 'auto', '/360/index.m3u8', '360', 360, false, true])
  cases.push(['auto-explicit-unknown-720-rejected-at-360', 'auto', '/720/index.m3u8', '360', null, false, true])
  for (const [name, engine, url, quality, expectedHeight, failNetworkProbe, explicit] of cases) {
    const selectedFfmpeg = failNetworkProbe ? join(root, 'probe-fallback/ffmpeg') : ffmpeg
    for (const [key, value] of Object.entries({ directMediaEngine: engine, ffmpegPath: selectedFfmpeg })) {
      assert.equal((await invoke('update-settings', key, value)).ok, true, `setting ${key} must be applied`)
    }
    const currentSettings = (await invoke('get-settings')).data
    assert.equal(currentSettings.directMediaEngine, engine)
    assert.equal(currentSettings.ffmpegPath, selectedFfmpeg)
    const start = Date.now(), requestStart = result.requests.length
    const admitted = await invoke('start-download', {
      url: base + url, title: name, format: 'video', quality, mediaType: 'hls',
      referer: fixture.referer, outputDir: join(root, 'output', name), forceNew: true,
      ...(explicit ? { selection: { version: 1, target: 'video', maxHeight: Number(quality), videoCodec: 'any',
        dynamicRange: 'any', output: 'mp4', postprocess: 'none' } } : {})
    })
    assert.ok(admitted.data?.id, JSON.stringify(admitted))
    const task = await waitTask(admitted.data.id)
    assert.equal(Boolean(task.metadata?.downloadRequest), Boolean(explicit), 'legacy requests must exercise the no-snapshot path')
    const entry = { name, engine: currentSettings.directMediaEngine, settingsVerified: true, quality, status: task.status, error: task.error, elapsedMs: Date.now() - start, requests: result.requests.length - requestStart }
    assert.equal(task.status, expectedHeight ? 'complete' : 'error', JSON.stringify(entry))
    if (expectedHeight) {
      const probe = await command(ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,height', '-of', 'json', task.filePath])
      assert.equal(probe.code, 0, probe.stderr)
      const metadata = JSON.parse(probe.stdout)
      assert.ok(metadata.streams.some((s) => s.codec_type === 'video' && s.height === expectedHeight), JSON.stringify(metadata))
      assert.ok(metadata.streams.some((s) => s.codec_type === 'audio' && s.codec_name === 'aac'))
      assert.ok(Math.abs(Number(metadata.format.duration) - 6) < 0.2)
      const decode = await command(ffmpeg, ['-v', 'error', '-xerror', '-i', task.filePath, '-map', '0:v?', '-map', '0:a?', '-f', 'null', '-'])
      assert.equal(decode.code, 0, decode.stderr)
      entry.output = { ...metadata, sha256: createHash('sha256').update(await readFile(task.filePath)).digest('hex'), fullDecode: true }
    } else {
      assert.ok(!task.filePath, 'a mismatching output must not be published')
      assert.match(task.error, /quality|selection not satisfied/i)
    }
    result.cases.push(entry)
    console.log(`${name}: PASS (${entry.elapsedMs} ms)`)
  }
  assert.ok(result.requests.some((r) => r.path.endsWith('/encryption.key') && r.status === 200))
  assert.ok(!result.requests.some((r) => r.status === 403), 'full Referer must reach every manifest, key and segment request')
} catch (error) {
  result.failure = String(error)
  console.error(harness?.getLog().slice(-10_000))
  process.exitCode = 1
} finally {
  await harness?.close()
  if (fixture) { fixture.closeAllConnections(); await new Promise((r) => fixture.close(r)) }
  await rm(root, { recursive: true, force: true })
  result.cleanup = { isolatedProfileRemoved: true, fixtureClosed: true, personalProfileUsed: false }
  if (reportPath) { await mkdir(dirname(reportPath), { recursive: true }); await writeFile(reportPath, JSON.stringify(result, null, 2) + '\n') }
  if (result.failure) console.error(result.failure)
}
