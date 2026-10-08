import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync as readSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { verifySqlitePrebuild } from './sqlite-runtime.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const arch = process.argv[2] || process.env.RELEASE_ARCH || process.env.npm_config_arch || 'arm64'
if (!['arm64', 'x64'].includes(arch)) { console.error('MAC RELEASE BUILD BLOCKED: choose arm64 or x64; use separate commands for separate releases'); process.exit(1) }
const stagingRoot = join(root, '.release-staging')
const staging = join(stagingRoot, 'current')
const marker = join(staging, '.v-download-managed-staging')
const lock = join(stagingRoot, '.build.lock')
const engineSource = join(root, 'resources', 'engines')
const stagedEngines = join(staging, 'engines')

async function safeRemoveManagedStage() {
  if (!existsSync(staging)) return
  if (!existsSync(marker)) throw new Error(`refusing to remove unmarked staging directory: ${staging}`)
  await rm(staging, { recursive: true, force: true })
}
function releaseLockSync() {
  if (!lockOwned) return
  try {
    if (existsSync(marker)) rmSync(staging, { recursive: true, force: true })
  } catch {
    /* still drop the lock so a killed build cannot block the next one */
  }
  try { rmSync(lock, { force: true }) } catch { /* ignore */ }
  lockOwned = false
}

async function acquireStagingLock() {
  if (existsSync(lock)) {
    const owner = readSync(lock, 'utf8').trim()
    throw new Error(`macOS release lock already exists${owner ? ` (recorded owner ${owner})` : ' with no recorded owner'}: ${lock}. Verify no build is running, then remove this stale lock manually.`)
  }
  await mkdir(stagingRoot, { recursive: true })
  await writeFile(lock, `${process.pid}\n`, { flag: 'wx' })
  lockOwned = true
}

async function stage() {
  try {
    await safeRemoveManagedStage()
    await mkdir(stagedEngines, { recursive: true })
    await writeFile(marker, `managed release staging for darwin-${arch}; do not edit\n`)
    const configPath = process.env.RELEASE_CONFIG || join(root, 'release-config.json')
    const releaseConfig = JSON.parse(await readFile(configPath, 'utf8'))
    const extensionId = process.env.CHROME_EXTENSION_ID || releaseConfig.chrome?.extensionId
    if (!/^[a-p]{32}$/.test(extensionId || '')) throw new Error('release config is missing a valid Chrome extension ID')
    await writeFile(join(staging, 'extension-config.json'), `${JSON.stringify({ extensionId }, null, 2)}\n`)
    for (const name of ['manifest.json']) await cp(join(engineSource, name), join(stagedEngines, name))
    const metadata = JSON.parse(await readFile(join(engineSource, 'metadata.json'), 'utf8'))
    const key = `darwin-${arch}`
    if (!metadata.architectures?.[key]) throw new Error(`engine metadata is missing ${key}`)
    await writeFile(join(stagedEngines, 'metadata.json'), `${JSON.stringify({ ...metadata, architectures: { [key]: metadata.architectures[key] } }, null, 2)}\n`)
    const sums = (await readFile(join(engineSource, 'SHA256SUMS'), 'utf8')).split(/\r?\n/).filter(Boolean).filter((line) => line.includes(`/darwin-${arch}/`))
    if (!sums.length) throw new Error(`engine checksums are missing for ${key}`)
    await writeFile(join(stagedEngines, 'SHA256SUMS'), `${sums.join('\n')}\n`)
    await cp(join(engineSource, key), join(stagedEngines, key), { recursive: true, errorOnExist: true })
    await mkdir(join(stagedEngines, 'po-token'), { recursive: true })
    await cp(join(engineSource, 'po-token', key), join(stagedEngines, 'po-token', key), { recursive: true, errorOnExist: true })
    const names = (await readdir(stagedEngines)).filter((name) => name === 'darwin-arm64' || name === 'darwin-x64')
    if (names.length !== 1 || names[0] !== key) throw new Error(`staging contains unexpected engine architectures: ${names.join(', ')}`)
    const providerDirs = await readdir(join(stagedEngines, 'po-token'))
    if (providerDirs.length !== 1 || providerDirs[0] !== key) throw new Error(`staging contains unexpected provider architectures: ${providerDirs.join(', ')}`)
  } catch (error) {
    await safeRemoveManagedStage().catch(() => {})
    throw error
  }
}
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`${command} failed with status ${result.status ?? 'unknown'}`)
}
function verifyTargetNativeDependencies() {
  const packageDirectory = join(root, 'node_modules', 'better-sqlite3')
  const path = verifySqlitePrebuild(packageDirectory, 'darwin', arch)
  console.log(`Verified better-sqlite3 N-API prebuild for darwin-${arch}: ${path}`)
}
function validatePackagedNativeModule() {
  const appDir = join(root, 'dist', arch === 'arm64' ? 'mac-arm64' : 'mac', 'V-Download.app')
  const packageDirectory = join(appDir, 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules', 'better-sqlite3')
  const native = verifySqlitePrebuild(packageDirectory, 'darwin', arch, { label: 'packaged better-sqlite3' })
  console.log(`Validated packaged better-sqlite3 N-API prebuild for darwin-${arch}: ${native}`)
}
function envForElectronBuilder() {
  const env = { ...process.env, RELEASE_ARCH: arch }
  for (const key of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'CSC_NAME', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']) {
    if (!String(env[key] ?? '').trim()) delete env[key]
  }
  return env
}
let lockOwned = false
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    releaseLockSync()
    process.exit(signal === 'SIGINT' ? 130 : 1)
  })
}
try {
  await acquireStagingLock()
  run(process.execPath, ['scripts/prepare-release.mjs'], { ...process.env, RELEASE_ARCH: arch })
  verifyTargetNativeDependencies()
  await stage()
  run('npm', ['run', 'build'], { ...process.env, RELEASE_ARCH: arch })
  run('npx', ['electron-builder', '--mac', `--${arch}`, '--publish', 'never'], envForElectronBuilder())
  validatePackagedNativeModule()
} catch (error) {
  console.error(`MAC RELEASE BUILD BLOCKED: ${error.message}`)
  process.exitCode = 1
} finally {
  if (lockOwned) await safeRemoveManagedStage().catch((error) => { console.error(`MAC RELEASE CLEANUP BLOCKED: ${error.message}`); process.exitCode = 1 })
  if (lockOwned) await rm(lock, { force: true })
}
