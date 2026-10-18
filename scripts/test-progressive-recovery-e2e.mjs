import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, chmod, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startDownloadHarness } from './lib/download-harness.mjs'

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)))
const root = await mkdtemp(join(tmpdir(), 'vdownload-recovery-e2e-')); await chmod(root, 0o700)
const engines = join(repo, 'resources/engines', `${process.platform}-${process.arch}`)
const ffmpeg = join(engines, 'ffmpeg'), ffprobe = join(engines, 'ffprobe'), ytdlp = join(engines, 'yt-dlp')
const reportPath = process.argv[2] ? resolve(process.argv[2]) : undefined
const result = { cases: [], requests: [], controlledDNS: true, personalProfileUsed: false }
const servers = []; let harness, good, source, port, ignoreReady = false
const hash = (data) => createHash('sha256').update(data).digest('hex')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function run(executable, args) {
  return await new Promise((resolveRun, reject) => {
    const p = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = '', stderr = ''
    p.stdout.on('data', (x) => { stdout += x }); p.stderr.on('data', (x) => { stderr = (stderr + x).slice(-16000) })
    const timer = setTimeout(() => p.kill('SIGKILL'), 60_000)
    p.once('error', reject); p.once('close', (code) => { clearTimeout(timer); resolveRun({ code, stdout, stderr }) })
  })
}
function respond(bad) {
  return async (req, res) => {
    const url = new URL(req.url, 'http://fixture'), host = req.headers.host?.split(':')[0]
    const entry = { host, path: url.pathname, badEdge: bad, range: req.headers.range || null, refererPreserved: req.headers.referer === source }
    result.requests.push(entry)
    if (!entry.refererPreserved) { entry.status = 403; res.writeHead(403); res.end(); return }
    const denied = /deny(403|404)/.exec(url.pathname)
    if (denied) { entry.status = Number(denied[1]); res.writeHead(entry.status); res.end(); return }
    const truncated = host?.startsWith('permanent.') || (bad && !(host?.startsWith('ignore.') && ignoreReady))
    if (truncated) {
      entry.status = 200; entry.etag = '"old-version"'
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': good.length, ETag: entry.etag })
      if (req.method === 'HEAD') { res.end(); return }
      const prefix = Buffer.from(good.subarray(0, Math.floor(good.length * 0.65)))
      if (host?.startsWith('etag.')) prefix[20000] ^= 0xff
      res.write(prefix, () => setTimeout(() => res.destroy(), 30)); return
    }
    let start = 0, end = good.length - 1
    const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '')
    const ignore = host?.startsWith('ignore.')
    if (match && !ignore) { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])) }
    if (start > end) { entry.status = 416; res.writeHead(416, { 'Content-Range': `bytes */${good.length}` }); res.end(); return }
    entry.status = match && !ignore ? 206 : 200; entry.etag = '"current-version"'
    res.writeHead(entry.status, { 'Content-Type': 'video/mp4', 'Content-Length': end - start + 1, ETag: entry.etag,
      'Accept-Ranges': 'bytes', ...(entry.status === 206 ? { 'Content-Range': `bytes ${start}-${end}/${good.length}` } : {}) })
    res.end(req.method === 'HEAD' ? undefined : good.subarray(start, end + 1))
  }
}
try {
  result.runtimeSHA256 = hash(await readFile(join(repo, 'out/main/index.js')))
  await mkdir(join(root, 'media'))
  const encoded = await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '6', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', join(root, 'media/input.mp4')])
  assert.equal(encoded.code, 0, encoded.stderr); good = await readFile(join(root, 'media/input.mp4'))
  const healthy = createServer(respond(false)); servers.push(healthy)
  await new Promise((r, reject) => { healthy.once('error', reject); healthy.listen(0, '127.0.0.1', r) }); port = healthy.address().port
  const broken = createServer(respond(true)); servers.push(broken)
  await new Promise((r, reject) => { broken.once('error', reject); broken.listen(port, '::1', r) })
  source = `http://source.test/watch?full=one%20two&context=preserved`
  const domains = ['cut', 'auto', 'etag', 'ignore', 'permanent', 'cancel', 'cap', 'audio', 'parallel-a', 'parallel-b']
  const dnsRoutes = Object.fromEntries(domains.map((d) => [`${d}.recovery.test`, [{ address: '::1', family: 6 }, { address: '127.0.0.1', family: 4 }]]))
  harness = await startDownloadHarness({ root, repo, dnsRoutes, settings: { downloadDir: join(root, 'output'),
    ytdlpPath: ytdlp, ffmpegPath: ffmpeg, defaultVideoQuality: '1080', concurrency: 1, sleepInterval: 0,
    directMediaEngine: 'ytdlp', warnBeforeQuit: false, remoteApiEnabled: false, onboardingCompleted: true } })
  const invoke = harness.invoke, baselineServers = (await invoke('harness-state')).openServers
  const cases = [
    ['cut', 'ytdlp', 'complete'], ['auto', 'auto', 'complete'], ['etag', 'ytdlp', 'complete'],
    ['ignore', 'ytdlp', 'complete'], ['permanent', 'ytdlp', 'error'],
    ['deny403', 'ytdlp', 'error'], ['deny404', 'ytdlp', 'error'], ['cancel', 'ytdlp', 'cancelled'],
    ['cap', 'ytdlp', 'error'], ['audio', 'ytdlp', 'complete']
  ]
  for (const [name, engine, expected] of cases) {
    await invoke('harness-state'); ignoreReady = false
    for (const [key, value] of Object.entries({ directMediaEngine: engine, proxyUrl: name === 'ignore' ? `http://[::1]:${port}` : '' })) assert.equal((await invoke('update-settings', key, value)).ok, true)
    const before = result.requests.length, start = Date.now()
    const url = name.startsWith('deny') ? `http://localhost:${port}/${name}.mp4` : `http://${name}.recovery.test:${port}/input.mp4?signature=exact%2Bvalue&context=one%20two`
    const selection = name === 'cap' ? { version: 1, target: 'video', maxHeight: 360, videoCodec: 'any', dynamicRange: 'any', output: 'mp4', postprocess: 'none' } : undefined
    const admitted = await invoke('start-download', { url, title: name, quality: name === 'cap' ? '360' : '1080', format: name === 'audio' ? 'mp3' : 'video', mediaType: 'mp4', referer: source,
      forceNew: true, outputDir: join(root, 'output', name), ...(selection ? { selection } : {}) })
    assert.ok(admitted.data?.id, JSON.stringify(admitted)); const id = admitted.data.id
    let task, cancelled = false; const progress = []; const end = Date.now() + 90_000
    while (Date.now() < end) {
      const state = await invoke('harness-state')
      const events = state.events.filter((x) => x.id === id); progress.push(...events)
      if (events.some((x) => x.phase === 'retrying')) {
        if (name === 'ignore') ignoreReady = true
        if (name === 'cancel' && !cancelled) { cancelled = true; await invoke('cancel-download', id) }
      }
      task = (await invoke('get-downloads')).data.find((x) => x.id === id)
      if (task && ['error', 'complete', 'cancelled'].includes(task.status)) break
      await sleep(60)
    }
    const entry = { name, engine, status: task?.status, error: task?.error, errorCode: task?.errorCode, milliseconds: Date.now() - start, retriesObserved: progress.filter((x) => x.phase === 'retrying').length }
    assert.equal(task?.status, expected, JSON.stringify(entry))
    const requests = result.requests.slice(before)
    assert.ok(requests.every((x) => x.refererPreserved))
    if (expected === 'complete') {
      const probe = await run(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,height:format=duration', '-of', 'json', task.filePath])
      assert.equal(probe.code, 0, probe.stderr); entry.output = JSON.parse(probe.stdout)
      assert.ok(Math.abs(Number(entry.output.format.duration) - 6) < 0.2)
      if (name === 'audio') assert.ok(entry.output.streams.every((x) => x.codec_type === 'audio' && x.codec_name === 'mp3'))
      else {
        assert.ok(entry.output.streams.some((x) => x.height === 720))
        assert.equal(hash(await readFile(task.filePath)), hash(good), 'cross-edge output must equal the complete current source, never mixed partials')
      }
      const decode = await run(ffmpeg, ['-v', 'error', '-xerror', '-i', task.filePath, '-map', '0:v?', '-map', '0:a?', '-f', 'null', '-'])
      assert.equal(decode.code, 0, decode.stderr); entry.fullDecode = true
      assert.ok(entry.retriesObserved >= 1)
    } else assert.ok(!task.filePath, 'failed/cancelled attempts cannot publish files')
    if (name === 'cap') assert.match(task.error, /selection not satisfied/i)
    if (name === 'deny403') { assert.equal(task.errorCode, 'ACCESS_DENIED'); assert.equal(entry.retriesObserved, 0) }
    if (name === 'deny404') { assert.equal(task.errorCode, 'UNSUPPORTED'); assert.equal(entry.retriesObserved, 0) }
    if (name === 'ignore') {
      assert.ok(!(await invoke('harness-state')).lookups.includes('ignore.recovery.test'), 'configured proxy must not be bypassed with local DNS')
      assert.ok(requests.some((x) => x.range && !x.range.startsWith('bytes=0-') && x.status === 200), 'fixture must actually ignore a nonzero resume Range')
    }
    if (name === 'etag') {
      assert.ok(requests.some((x) => x.etag === '"old-version"') && requests.some((x) => x.etag === '"current-version"'))
      assert.ok(!requests.some((x) => !x.badEdge && x.range && !x.range.startsWith('bytes=0-')), 'different edges must not splice old partial bytes')
    }
    for (const event of progress.filter((x) => x.phase === 'retrying')) assert.equal(event.progress, 0)
    await sleep(120)
    assert.equal((await invoke('harness-state')).openServers, baselineServers, 'all task-scoped routes must close')
    result.cases.push(entry); console.log(`${name}: PASS (${entry.milliseconds} ms)`)
  }
  await invoke('update-settings', 'concurrency', 2)
  const parallel = []
  for (const name of ['parallel-a', 'parallel-b']) {
    const admitted = await invoke('start-download', { url: `http://${name}.recovery.test:${port}/input.mp4`, title: name,
      quality: '1080', format: 'video', mediaType: 'mp4', referer: source, forceNew: true, outputDir: join(root, 'output', name) })
    parallel.push(admitted.data.id)
  }
  let done = [], maxRoutes = 0
  for (const end = Date.now() + 60_000; Date.now() < end;) {
    const state = await invoke('harness-state'); maxRoutes = Math.max(maxRoutes, state.openServers - baselineServers)
    done = (await invoke('get-downloads')).data.filter((x) => parallel.includes(x.id))
    if (done.length === 2 && done.every((x) => ['error', 'complete'].includes(x.status))) break
    await sleep(60)
  }
  assert.equal(done.length, 2); assert.ok(maxRoutes <= 2)
  assert.notEqual(done[0].filePath, done[1].filePath)
  for (const task of done) {
    assert.equal(task.status, 'complete'); assert.equal(hash(await readFile(task.filePath)), hash(good))
    const decode = await run(ffmpeg, ['-v', 'error', '-xerror', '-i', task.filePath, '-f', 'null', '-']); assert.equal(decode.code, 0, decode.stderr)
    result.cases.push({ name: task.title, status: task.status, outputSHA256: hash(good), fullDecode: true, maxConcurrentTaskRoutes: maxRoutes })
  }
  await sleep(120); assert.equal((await invoke('harness-state')).openServers, baselineServers)
  console.log('parallel retries: PASS (independent routes and outputs)')
} catch (error) {
  result.failure = String(error); process.exitCode = 1
  console.error(harness?.getLog().slice(-12000)); console.error(result.failure)
} finally {
  await harness?.close()
  for (const server of servers) { server.closeAllConnections(); await new Promise((r) => server.close(r)) }
  await rm(root, { recursive: true, force: true }); result.cleanup = { profileRemoved: true, fixtureClosed: true }
  if (reportPath) { await mkdir(dirname(reportPath), { recursive: true }); await writeFile(reportPath, JSON.stringify(result, null, 2) + '\n') }
}
