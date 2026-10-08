import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync as readSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { verifySqlitePrebuild } from './sqlite-runtime.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))

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
// Mac and Linux builders share `.release-staging/current` through electron-builder.yml.
// Use the same lock as build-mac-release.mjs so parallel builds cannot delete or mix stages.
const lock = join(stagingRoot, '.build.lock')
const engineSource = join(root, 'resources', 'engines')
const stagedEngines = join(staging, 'engines')

let lockOwned = false

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
    const owner = readSync(lock, 'utf8').trim()
    throw new Error(`Linux release lock already exists${owner ? ` (recorded owner ${owner})` : ' with no recorded owner'}: ${lock}. Verify no build is running, then remove this stale lock manually.`)
  }
  await mkdir(stagingRoot, { recursive: true })
  await writeFile(lock, `${process.pid}\n`, { flag: 'wx' })
  lockOwned = true
}

async function stage() {
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
        /* validation below reports an actionable configuration error */
      }
    }

    if (!extensionId || !/^[a-p]{32}$/.test(extensionId)) {
      throw new Error('a valid CHROME_EXTENSION_ID is required for Linux packaging')
    }
    await writeFile(join(staging, 'extension-config.json'), `${JSON.stringify({ extensionId }, null, 2)}\n`)

    const key = `linux-${arch}`
    const metadata = JSON.parse(await readFile(join(engineSource, 'metadata.json'), 'utf8'))
    const architectureMetadata = metadata.architectures?.[key]
    if (!architectureMetadata) throw new Error(`verified engine metadata is missing ${key}`)

    const requiredFiles = [
      join(engineSource, key, 'yt-dlp'),
      join(engineSource, key, 'ffmpeg'),
      join(engineSource, key, 'ffprobe'),
      join(engineSource, key, 'FFMPEG-LICENSE.txt'),
      join(engineSource, 'po-token', key, 'bgutil-provider'),
      join(engineSource, 'po-token', key, 'yt_dlp_plugins'),
    ]
    for (const path of requiredFiles) {
      if (!existsSync(path)) throw new Error(`required Linux engine resource is missing: ${path}`)
    }

    for (const name of ['manifest.json']) await cp(join(engineSource, name), join(stagedEngines, name))
    await writeFile(join(stagedEngines, 'metadata.json'), `${JSON.stringify({ ...metadata, architectures: { [key]: architectureMetadata } }, null, 2)}\n`)
    const sums = (await readFile(join(engineSource, 'SHA256SUMS'), 'utf8'))
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((line) => line.includes(`/linux-${arch}/`))
    if (sums.length < requiredFiles.length) throw new Error(`Linux engine checksums are incomplete for ${key}`)
    await writeFile(join(stagedEngines, 'SHA256SUMS'), `${sums.join('\n')}\n`)

    const srcArch = join(engineSource, key)
    const dstArch = join(stagedEngines, key)
    await cp(srcArch, dstArch, { recursive: true })

    const srcPo = join(engineSource, 'po-token', key)
    const dstPo = join(stagedEngines, 'po-token', key)
    await mkdir(join(stagedEngines, 'po-token'), { recursive: true })
    await cp(srcPo, dstPo, { recursive: true })

    const stagedNames = await readdir(stagedEngines)
    const stagedArchitectures = stagedNames.filter((name) => /^(?:darwin|linux)-(?:arm64|x64)$/.test(name))
    if (stagedArchitectures.length !== 1 || stagedArchitectures[0] !== key) {
      throw new Error(`staging contains unexpected engine architectures: ${stagedArchitectures.join(', ')}`)
    }
  } catch (error) {
    await safeRemoveManagedStage().catch(() => {})
    throw error
  }
}

function verifyOrFetchLinuxEngines() {
  const engineScript = join(root, 'scripts', 'engines.mjs')
  const env = { ...process.env, RELEASE_PLATFORM: 'linux', RELEASE_ARCH: arch }
  const verify = spawnSync(process.execPath, [engineScript, 'verify'], { cwd: root, env, stdio: 'inherit' })
  if (verify.status === 0) return

  console.log(`Verified linux-${arch} engines are unavailable; fetching the pinned Linux engine set.`)
  run(process.execPath, [engineScript, 'fetch'], env)
  run(process.execPath, [engineScript, 'verify'], env)
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with status ${result.status ?? 'unknown'}`)
}

function verifyTargetNativeDependencies() {
  const packageDirectory = join(root, 'node_modules', 'better-sqlite3')
  const path = verifySqlitePrebuild(packageDirectory, 'linux', arch)
  console.log(`Verified better-sqlite3 N-API prebuild for linux-${arch}: ${path}`)
}

async function validatePackagedNativeDependencies() {
  const directories = await readdir(join(root, 'dist'), { withFileTypes: true })
  const candidates = directories
    .filter((entry) => entry.isDirectory() && /^linux(?:-.*)?-unpacked$/.test(entry.name))
    .map((entry) => join(root, 'dist', entry.name, 'resources', 'app.asar.unpacked', 'node_modules', 'better-sqlite3'))
  let lastError
  for (const packageDirectory of candidates) {
    try {
      const native = verifySqlitePrebuild(packageDirectory, 'linux', arch, { label: 'packaged better-sqlite3' })
      console.log(`Validated packaged better-sqlite3 N-API prebuild for linux-${arch}: ${native}`)
      return
    } catch (error) {
      lastError = error
    }
  }
  throw lastError || new Error(`electron-builder produced no unpacked Linux app for linux-${arch}`)
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    releaseLockSync()
    process.exit(signal === 'SIGINT' ? 130 : 1)
  })
}

try {
  console.log(`=== Starting V-Download Linux release build (${arch}, target: ${targetFormat}) ===`)
  await acquireStagingLock()
  verifyTargetNativeDependencies()
  verifyOrFetchLinuxEngines()
  await stage()

  console.log('Compiling application bundle...')
  run('npm', ['run', 'build'], { ...process.env, RELEASE_ARCH: arch })

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
  await validatePackagedNativeDependencies()

  console.log(`=== Linux release build completed successfully for linux-${arch} ===`)
} catch (error) {
  console.error(`LINUX RELEASE BUILD BLOCKED: ${error.message}`)
  process.exitCode = 1
} finally {
  if (lockOwned) {
    await safeRemoveManagedStage().catch((error) => {
      console.error(`LINUX RELEASE CLEANUP BLOCKED: ${error.message}`)
      process.exitCode = 1
    })
    await rm(lock, { force: true })
  }
}
