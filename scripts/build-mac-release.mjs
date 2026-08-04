import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync as readSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(new URL('..', import.meta.url).pathname)
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
async function stage() {
  if (existsSync(lock)) throw new Error(`another macOS release build is using ${lock}`)
  await mkdir(stagingRoot, { recursive: true })
  await writeFile(lock, `${process.pid}\n`, { flag: 'wx' })
  lockOwned = true
  try {
    await safeRemoveManagedStage()
    await mkdir(stagedEngines, { recursive: true })
    await writeFile(marker, `managed release staging for darwin-${arch}; do not edit\n`)
    const configPath = process.env.RELEASE_CONFIG || join(root, 'release-config.json')
    const releaseConfig = JSON.parse(await readFile(configPath, 'utf8'))
    const extensionId = process.env.CHROME_EXTENSION_ID || releaseConfig.chrome?.extensionId
    if (!/^[a-p]{32}$/.test(extensionId || '')) throw new Error('release config is missing a valid Chrome Web Store extension ID')
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
function capture(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (result.status !== 0) throw new Error(`${command} failed with status ${result.status ?? 'unknown'}`)
  return `${result.stdout}${result.stderr}`
}
function rebuildTargetNativeDependencies() {
  const electronVersion = JSON.parse(readSync(join(root, 'node_modules', 'electron', 'package.json'), 'utf8')).version
  console.log(`Rebuilding Electron native dependencies for darwin-${arch}, Electron ${electronVersion}`)
  run(join(root, 'node_modules', '.bin', 'electron-rebuild'), ['--version', electronVersion, '--module-dir', root, '--arch', arch, '--force', '--only', 'better-sqlite3'], { ...process.env, npm_config_arch: arch, npm_config_platform: 'darwin' })
}
function validatePackagedNativeModule() {
  const appDir = join(root, 'dist', arch === 'arm64' ? 'mac-arm64' : 'mac', 'V-Download.app')
  const native = join(appDir, 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node')
  if (!existsSync(native)) throw new Error(`packaged native module is missing: ${native}`)
  const description = capture('file', ['-b', native])
  const matches = arch === 'arm64' ? /arm64|Apple silicon/i.test(description) : /x86_64|Intel 64/i.test(description)
  if (!matches) throw new Error(`packaged better_sqlite3.node architecture does not match darwin-${arch}: ${description.trim()}`)
  console.log(`Validated packaged better_sqlite3.node for darwin-${arch}: ${description.trim()}`)
}
function restoreHostNativeDependencies() {
  console.log(`Restoring host Node-native better-sqlite3 for ${process.platform}-${process.arch} after Electron ${arch} packaging`)
  const env = { ...process.env, npm_config_arch: process.arch, npm_config_platform: process.platform }
  delete env.npm_config_target
  delete env.npm_config_runtime
  run('npm', ['rebuild', 'better-sqlite3', `--arch=${process.arch}`, `--platform=${process.platform}`], env)
}
let lockOwned = false
let nativeBuildMayHaveChanged = false
try {
  run(process.execPath, ['scripts/prepare-release.mjs'], { ...process.env, RELEASE_ARCH: arch })
  await stage()
  run('npm', ['run', 'build'], { ...process.env, RELEASE_ARCH: arch })
  nativeBuildMayHaveChanged = true
  rebuildTargetNativeDependencies()
  run('npx', ['electron-builder', '--mac', `--${arch}`], { ...process.env, RELEASE_ARCH: arch })
  validatePackagedNativeModule()
} catch (error) {
  console.error(`MAC RELEASE BUILD BLOCKED: ${error.message}`)
  process.exitCode = 1
} finally {
  if (nativeBuildMayHaveChanged) {
    try { restoreHostNativeDependencies() } catch (error) { console.error(`HOST DEPENDENCY RESTORE BLOCKED: ${error.message}`); process.exitCode = 1 }
  }
  if (lockOwned) await safeRemoveManagedStage().catch((error) => { console.error(`MAC RELEASE CLEANUP BLOCKED: ${error.message}`); process.exitCode = 1 })
  if (lockOwned) await rm(lock, { force: true })
  if (existsSync(stagingRoot) && (await readdir(stagingRoot)).length === 0) await rm(stagingRoot, { recursive: true, force: true })
}
