/** Explicit local diagnostic: VDL_REPLAY_TASK_IDS=id,id node ... <sanitized-report.json> */
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { mkdtemp, chmod, writeFile, readFile, rm, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { tmpdir, homedir } from 'node:os'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startDownloadHarness } from './lib/download-harness.mjs'

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)))
const ids = (process.env.VDL_REPLAY_TASK_IDS || '').split(',').filter(Boolean)
assert.ok(ids.length > 0 && ids.length <= 3, 'Explicitly select 1–3 local task IDs to replay in an isolated profile')
const profile = process.env.VDL_REPLAY_PROFILE || join(homedir(), 'Library/Application Support/v-download')
const settings = JSON.parse(await readFile(join(profile, 'settings.json'), 'utf8'))
const database = new Database(join(profile, 'downloads.db'), { readonly: true, fileMustExist: true })
const inputs = ids.map((id) => database.prepare('SELECT id,url,quality,extras FROM downloads WHERE id=?').get(id))
database.close(); assert.ok(inputs.every(Boolean), 'Selected task does not exist')
const root = await mkdtemp(join(tmpdir(), 'vdownload-live-recovery-')); await chmod(root, 0o700)
const result = { cases: [], initialFailureInjected: true, explanation: 'Initial child emits a controlled disconnect; subsequent DNS, authenticated route, TLS verification, engine transfer and output validation are real.', personalTasksModified: false, personalSettingsModified: false }
const report = process.argv[2] ? resolve(process.argv[2]) : undefined
let harness
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const hash = (data) => createHash('sha256').update(data).digest('hex')
async function run(executable, args) {
  return await new Promise((resolveRun, reject) => {
    const p = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = ''
    p.stdout.on('data', (x) => { stdout += x }); p.stderr.resume()
    const timer = setTimeout(() => p.kill('SIGKILL'), 60_000)
    p.once('error', reject); p.once('close', (code) => { clearTimeout(timer); resolveRun({ code, stdout }) })
  })
}
try {
  result.runtimeSHA256 = hash(await readFile(join(repo, 'out/main/index.js')))
  const wrapper = join(root, 'engine-wrapper')
  const quoted = `'${settings.ytdlpPath.replaceAll("'", "'\\''")}'`
  await writeFile(wrapper, `#!/bin/sh\nhas_proxy=0\nfor arg do\n [ "$arg" = '--version' ] && exec ${quoted} "$@"\n [ "$arg" = '--proxy' ] && has_proxy=1\n [ "$arg" = '--no-check-certificate' ] && bypass=1\ndone\nif [ "$has_proxy" = '0' ]; then echo 'ERROR: Connection aborted (controlled initial attempt)' >&2; exit 1; fi\nif [ "$bypass" = '1' ]; then echo 'ERROR: certificate verification bypass requested' >&2; exit 91; fi\nexec ${quoted} "$@"\n`, { mode: 0o700 })
  harness = await startDownloadHarness({ root, repo, settings: { downloadDir: join(root, 'output'),
    ytdlpPath: wrapper, ffmpegPath: settings.ffmpegPath, defaultVideoQuality: '1080', concurrency: 1,
    sleepInterval: 0, directMediaEngine: 'ytdlp', warnBeforeQuit: false, remoteApiEnabled: false, onboardingCompleted: true } })
  assert.equal((await harness.invoke('get-settings')).data.ytdlpPath, wrapper, 'controlled first-attempt wrapper must remain the selected engine')
  const baseline = (await harness.invoke('harness-state')).openServers
  for (const input of inputs) {
    await harness.invoke('harness-state')
    const metadata = JSON.parse(input.extras || '{}'), start = Date.now()
    const selection = { version: 1, target: 'video', maxHeight: 1080, videoCodec: 'any', dynamicRange: 'any', output: 'mp4', postprocess: 'none' }
    const admitted = await harness.invoke('start-download', { url: input.url, title: `live-${input.id.slice(0, 8)}`, format: 'video', quality: '1080', mediaType: 'mp4',
      referer: metadata.referer, customHeaders: metadata.customHeaders, outputDir: join(root, 'output', input.id), selection, forceNew: true })
    assert.ok(admitted.data?.id, 'Live replay admission failed')
    const id = admitted.data.id; let task, retries = 0
    for (const end = Date.now() + 120_000; Date.now() < end;) {
      retries += (await harness.invoke('harness-state')).events.filter((x) => x.id === id && x.phase === 'retrying').length
      task = (await harness.invoke('get-downloads')).data.find((x) => x.id === id)
      if (task && ['error', 'complete', 'cancelled'].includes(task.status)) break
      await sleep(100)
    }
    assert.equal(task?.status, 'complete', `Live task ${input.id.slice(0, 8)} failed (${task?.errorCode || 'no terminal state'})`)
    assert.ok(retries >= 1 && retries <= 3, `Expected 1–3 recovery attempts, observed ${retries}`)
    const probe = await run(join(dirname(settings.ffmpegPath), 'ffprobe'), ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height:format=duration,size', '-of', 'json', task.filePath])
    assert.equal(probe.code, 0)
    const facts = JSON.parse(probe.stdout)
    assert.ok(facts.streams.some((x) => x.codec_type === 'video' && x.height <= 1080))
    assert.ok(facts.streams.some((x) => x.codec_type === 'audio'))
    const decode = await run(settings.ffmpegPath, ['-v', 'error', '-xerror', '-i', task.filePath, '-map', '0:v?', '-map', '0:a?', '-f', 'null', '-'])
    assert.equal(decode.code, 0)
    assert.equal((await harness.invoke('harness-state')).openServers, baseline)
    result.cases.push({ originalTaskId: input.id, inputURLSHA256: hash(input.url), status: task.status, retries, elapsedMs: Date.now() - start,
      output: facts, fullDecode: true, outputSHA256: hash(await readFile(task.filePath)), originalTLSHostnameVerified: true })
    console.log(`${input.id.slice(0, 8)}: real TLS recovery + complete download + full decode PASS`)
  }
} catch (error) { result.failure = String(error); console.error(result.failure); process.exitCode = 1 }
finally {
  await harness?.close(); await rm(root, { recursive: true, force: true }); result.cleanup = { isolatedProfileRemoved: true, temporaryDownloadsRemoved: true }
  if (report) { await mkdir(dirname(report), { recursive: true }); await writeFile(report, JSON.stringify(result, null, 2) + '\n') }
}
