import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync as readSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(new URL('..', import.meta.url).pathname)

// Parse target arch and format from CLI
const argv = process.argv.slice(2)
let arch = process.env.RELEASE_ARCH || process.env.npm_config_arch
let targetFormat = 'all' // 'all', 'deb', or 'AppImage'

for (const arg of argv) {
  if (arg === 'arm64' || arg === 'x64') {
    arch = arg
  } else if (arg.startsWith('--arch=')) {
    arch = arg.slice('--arch='.length)
  } else if (arg.startsWith('--target=')) {
    targetFormat = arg.slice('--target='.length)
  }
}

if (!arch) {
  arch = process.arch === 'arm64' ? 'arm64' : 'x64'
}

if (!['arm64', 'x64'].includes(arch)) {
  console.error('LINUX RELEASE BUILD BLOCKED: choose arm64 or x64')
  process.exit(1)
}

const stagingRoot = join(root, '.release-staging')
const staging = join(stagingRoot, 'current')
const marker = join(staging, '.v-download-managed-staging')
const lock = join(stagingRoot, '.linux-build.lock')
const engineSource = join(root, 'resources', 'engines')
const stagedEngines = join(staging, 'engines')

let lockOwned = false
let nativeBuildMayHaveChanged = false

async function safeRemoveManagedStage() {
  if (!existsSync(staging)) return
  if (!existsSync(marker)) throw new Error(`refusing to remove unmarked staging directory: ${staging}`)
  await rm(staging, { recursive: true, force: true })
}

function pidIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function releaseLockSync() {
  if (!lockOwned) return
  try {
    if (existsSync(marker)) rmSync(staging, { recursive: true, force: true })
  } catch {
    /* still drop the lock */
  }
  try {
    rmSync(lock, { force: true })
  } catch {
    /* ignore */
  }
  lockOwned = false
}

async function acquireStagingLock() {
  if (existsSync(lock)) {
    const pid = Number(readSync(lock, 'utf8').trim())
    if (pidIsAlive(pid)) throw new Error(`another Linux release build is running with pid ${pid}`)
    await rm(lock, { force: true })
  }
  await mkdir(stagingRoot, { recursive: true })
  await writeFile(lock, `${process.pid}\n`, { flag: 'wx' })
  lockOwned = true
}

async function stage() {
  await acquireStagingLock()
  try {
    await safeRemoveManagedStage()
    await mkdir(stagedEngines, { recursive: true })
    await writeFile(marker, `managed Linux release staging for linux-${arch}; do not edit\n`)

    const configPath = process.env.RELEASE_CONFIG || join(root, 'release-config.json')
    let extensionId = process.env.CHROME_EXTENSION_ID
    if (!extensionId && existsSync(configPath)) {
      try {
        const releaseConfig = JSON.parse(await readFile(configPath, 'utf8'))
        extensionId = releaseConfig.chrome?.extensionId
      } catch {
        /* fallback to placeholder for local testing */
      }
    }

    if (!extensionId || !/^[a-p]{32}$/.test(extensionId)) {
      extensionId = 'abcdefghijklmnopabcdefghijklmnop'
    }
    await writeFile(join(staging, 'extension-config.json'), `${JSON.stringify({ extensionId }, null, 2)}\n`)

    // Stage manifest if available
    for (const name of ['manifest.json', 'metadata.json', 'SHA256SUMS']) {
      const src = join(engineSource, name)
      if (existsSync(src)) {
        await cp(src, join(stagedEngines, name))
      }
    }

    // Stage linux engines if present; otherwise ensure directory exists
    const key = `linux-${arch}`
    const srcArch = join(engineSource, key)
    const dstArch = join(stagedEngines, key)
    if (existsSync(srcArch)) {
      await cp(srcArch, dstArch, { recursive: true })
    } else {
      await mkdir(dstArch, { recursive: true })
    }

    const srcPo = join(engineSource, 'po-token', key)
    const dstPo = join(stagedEngines, 'po-token', key)
    if (existsSync(srcPo)) {
      await mkdir(join(stagedEngines, 'po-token'), { recursive: true })
      await cp(srcPo, dstPo, { recursive: true })
    } else {
      await mkdir(dstPo, { recursive: true })
    }
  } catch (error) {
    await safeRemoveManagedStage().catch(() => {})
    throw error
  }
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with status ${result.status ?? 'unknown'}`)
}

function rebuildTargetNativeDependencies() {
  if (process.platform !== 'linux') {
    console.log(`Note: Building on host platform '${process.platform}'. Native better-sqlite3 Linux rebuild requires a Linux host or container.`)
    return
  }
  const electronVersion = JSON.parse(readSync(join(root, 'node_modules', 'electron', 'package.json'), 'utf8')).version
  console.log(`Rebuilding Electron native dependencies for linux-${arch}, Electron ${electronVersion}`)
  run(
    join(root, 'node_modules', '.bin', 'electron-rebuild'),
    ['--version', electronVersion, '--module-dir', root, '--arch', arch, '--force', '--only', 'better-sqlite3'],
    { ...process.env, npm_config_arch: arch, npm_config_platform: 'linux' }
  )
}

function restoreHostNativeDependencies() {
  console.log(`Restoring host Node-native better-sqlite3 for ${process.platform}-${process.arch}`)
  const env = { ...process.env, npm_config_arch: process.arch, npm_config_platform: process.platform }
  delete env.npm_config_target
  delete env.npm_config_runtime
  run('npm', ['rebuild', 'better-sqlite3', `--arch=${process.arch}`, `--platform=${process.platform}`], env)
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    releaseLockSync()
    process.exit(signal === 'SIGINT' ? 130 : 1)
  })
}

try {
  console.log(`=== Starting V-Download Linux release build (${arch}, target: ${targetFormat}) ===`)
  await stage()

  console.log('Compiling application bundle...')
  run('npm', ['run', 'build'], { ...process.env, RELEASE_ARCH: arch })

  if (process.platform === 'linux') {
    nativeBuildMayHaveChanged = true
    rebuildTargetNativeDependencies()
  }

  // Configure electron-builder targets
  const builderArgs = ['electron-builder', '--linux']
  if (targetFormat === 'deb') {
    builderArgs.push('deb')
  } else if (targetFormat === 'AppImage' || targetFormat === 'appimage') {
    builderArgs.push('AppImage')
  } else {
    builderArgs.push('deb', 'AppImage')
  }
  builderArgs.push(`--${arch}`, '--publish', 'never')

  console.log(`Invoking electron-builder: ${builderArgs.join(' ')}`)
  run('npx', builderArgs, { ...process.env, RELEASE_ARCH: arch })

  console.log(`=== Linux release build completed successfully for linux-${arch} ===`)
} catch (error) {
  console.error(`LINUX RELEASE BUILD BLOCKED: ${error.message}`)
  process.exitCode = 1
} finally {
  if (nativeBuildMayHaveChanged) {
    try {
      restoreHostNativeDependencies()
    } catch (error) {
      console.error(`HOST DEPENDENCY RESTORE BLOCKED: ${error.message}`)
      process.exitCode = 1
    }
  }
  if (lockOwned) {
    await safeRemoveManagedStage().catch((error) => {
      console.error(`LINUX RELEASE CLEANUP BLOCKED: ${error.message}`)
      process.exitCode = 1
    })
    await rm(lock, { force: true })
  }
  if (existsSync(stagingRoot) && (await readdir(stagingRoot)).length === 0) {
    await rm(stagingRoot, { recursive: true, force: true })
  }
}
