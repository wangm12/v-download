import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { chmod, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { spawn } from 'node:child_process'
import { pipeline } from 'node:stream/promises'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const enginesRoot = join(root, 'resources/engines')
const manifest = JSON.parse(await readFile(join(enginesRoot, 'manifest.json'), 'utf8'))
const targetPlatform = process.env.RELEASE_PLATFORM || process.platform
const requested = process.env.RELEASE_ARCH || process.env.npm_config_arch || process.arch
const arches = requested === 'both' ? ['arm64', 'x64'] : [requested]
const supported = new Set(manifest.architectures)
const error = (message) => { throw new Error(message) }
const hash = async (path) => {
  const digest = createHash('sha256')
  await pipeline((await import('node:fs')).createReadStream(path), digest)
  return digest.digest('hex')
}

async function treeHash(directory) {
  const { readdir } = await import('node:fs/promises')
  const digest = createHash('sha256')
  async function walk(base, relative = '') {
    for (const entry of (await readdir(base, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(relative, entry.name)
      if (entry.isDirectory()) await walk(join(base, entry.name), path)
      else {
        digest.update(path)
        digest.update(await readFile(join(base, entry.name)))
      }
    }
  }
  await walk(directory)
  return digest.digest('hex')
}

const run = (file, args, options = {}) => new Promise((resolveRun, rejectRun) => {
  const child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options })
  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', (chunk) => { stdout += chunk })
  child.stderr?.on('data', (chunk) => { stderr += chunk })
  child.on('error', rejectRun)
  child.on('close', (code) => code === 0
    ? resolveRun(`${stdout}${stderr}`)
    : rejectRun(new Error(`${file} exited ${code}: ${stderr.slice(-500)}`)))
})

function assertVersion(output, version, name) {
  if (!output.includes(version)) error(`${name} version output does not contain pinned version ${version}`)
}

function assertBinaryIdentity(output, name) {
  if (name !== 'ffmpeg' && name !== 'ffprobe') return
  const identity = output.split(/\r?\n/).find((line) => /^(?:ffmpeg|ffprobe) version\b/i.test(line.trim()))
  if (!identity || !identity.trim().toLowerCase().startsWith(`${name} version`)) {
    error(`${name} binary identity is incorrect: ${identity?.trim() || 'version banner missing'}`)
  }
}

async function providerContract(target) {
  const port = 41000 + Math.floor(Math.random() * 1000)
  const child = spawn(target, ['server', '--host', '127.0.0.1', '--port', String(port)], { stdio: 'ignore' })
  try {
    for (let attempt = 0; attempt < 40; attempt++) {
      if (child.exitCode !== null) throw new Error(`provider exited before /ping (status ${child.exitCode})`)
      try {
        const response = await fetch(`http://127.0.0.1:${port}/ping`, { signal: AbortSignal.timeout(1000) })
        if (response.status >= 200 && response.status < 500) return
      } catch { /* wait for the loopback listener to become ready */ }
      await new Promise((resolveWait) => setTimeout(resolveWait, 100))
    }
    throw new Error('provider contract failed: /ping did not answer')
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM')
      await new Promise((resolveWait) => {
        const timer = setTimeout(() => {
          if (child.exitCode === null) child.kill('SIGKILL')
        }, 1000)
        child.once('close', () => { clearTimeout(timer); resolveWait() })
      })
    }
  }
}

function validate() {
  if (!['darwin', 'linux'].includes(targetPlatform)) error(`unsupported target platform ${targetPlatform}`)
  if (targetPlatform !== process.platform) error(`cannot fetch or execute ${targetPlatform} engines on ${process.platform}`)
  if (arches.some((arch) => !supported.has(arch))) error(`unsupported architecture ${arches.join(',')}`)
}

function sourceFor(item, platform, arch) {
  return item.platforms?.[platform]?.archives?.[arch] ?? item.archives?.[arch] ?? item
}

function urlFor(source) { return source.url || source.archive }
function shaFor(source) { return source.sha256 }
function safeArchiveMember(member) {
  return typeof member === 'string' && member.length > 0 && !member.startsWith('/') && !member.split('/').includes('..')
}

function pinned(url, version) {
  return typeof url === 'string'
    && /^https:\/\/(github\.com|evermeet\.cx|ffmpeg\.martin-riedl\.de)\//.test(url)
    && !/(latest|main|master)/.test(url)
    && url.includes(version.replace(/^v/, ''))
}

async function download(url, expected, path) {
  if (!/^[a-f0-9]{64}$/.test(expected || '')) error(`invalid pinned checksum for ${url}`)
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) throw new Error(`download failed HTTP ${response.status}: ${url}`)
  await pipeline(response.body, createWriteStream(path))
  if (await hash(path) !== expected) throw new Error(`archive checksum mismatch: ${url}`)
}

async function downloadCached(source, tempDir, downloaded) {
  const url = urlFor(source)
  const digest = shaFor(source)
  const cached = downloaded.get(`${url}:${digest}`)
  if (cached) return cached
  const archive = join(tempDir, `${digest}.archive`)
  await download(url, digest, archive)
  downloaded.set(`${url}:${digest}`, archive)
  return archive
}

async function extractArchive(source, kind, archive, tempDir, dest, name) {
  const extraction = join(tempDir, `extract-${name}`)
  await rm(extraction, { recursive: true, force: true })
  await mkdir(extraction, { recursive: true })
  if (kind === 'zip') {
    await run('unzip', ['-q', '-o', archive, '-d', extraction])
  } else if (kind === 'tar.xz') {
    if (!safeArchiveMember(source.member)) error(`invalid tar member for ${name}`)
    await run('tar', ['-xJf', archive, '-C', extraction, source.member])
  } else {
    error(`unsupported archive kind ${kind} for ${name}`)
  }

  const member = source.member || manifest.engines[name].member
  if (!safeArchiveMember(member)) error(`missing archive member for ${name}`)
  const executableSource = join(extraction, member)
  await stat(executableSource)

  const destPath = join(dest, name)
  await rm(destPath, { force: true })
  if (targetPlatform === 'darwin' && name === 'yt-dlp') {
    const sidecar = join(extraction, '_internal')
    await stat(sidecar)
    await rm(join(dest, '_internal'), { recursive: true, force: true })
    await rename(sidecar, join(dest, '_internal'))
  }
  await rename(executableSource, destPath)
  await rm(extraction, { recursive: true, force: true })
  return destPath
}

function expectedExecutableArchitecture(arch) {
  return arch === 'arm64' ? /arm64|aarch64/i : /x86_64|x86-64|AMD64/i
}

function hasEncoder(output, encoder) {
  return output.split(/\r?\n/).some((line) => line.trim().split(/\s+/)[1] === encoder)
}

async function machArch(path) {
  return new Promise((resolveArch, rejectArch) => {
    const child = spawn('file', ['-b', path], { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk) => { output += chunk })
    child.on('error', rejectArch)
    child.on('close', (code) => code === 0 ? resolveArch(output) : rejectArch(new Error('file failed')))
  })
}

async function installOne(name, item, arch, mode, targetDir, poDir, tempDir, downloaded, metadata, sums) {
  const source = sourceFor(item, targetPlatform, arch)
  const url = urlFor(source)
  const archiveSha256 = shaFor(source)
  const kind = source.kind || item.kind || 'raw'
  if (!pinned(url, item.version)) error(`un-pinned ${name} source: ${url}`)
  const target = join(name === 'bgutil-provider' ? poDir : targetDir, name)

  if (mode === 'fetch') {
    const archive = await downloadCached(source, tempDir, downloaded)
    if (kind === 'raw') {
      await rm(target, { force: true })
      await rename(archive, target)
      downloaded.delete(`${url}:${archiveSha256}`)
    } else {
      if (name === 'yt-dlp') {
        await rm(target, { force: true })
        await rm(join(targetDir, '_internal'), { recursive: true, force: true })
      }
      await extractArchive(source, kind, archive, tempDir, targetDir, name)
    }
    await chmod(target, 0o755)

    if (targetPlatform === 'linux' && name === 'ffmpeg' && kind === 'tar.xz' && source.licenseMember) {
      if (!safeArchiveMember(source.licenseMember)) error(`invalid license member for ${name}`)
      const extraction = join(tempDir, `license-${name}`)
      await mkdir(extraction, { recursive: true })
      await run('tar', ['-xJf', archive, '-C', extraction, source.licenseMember])
      const licenseTarget = join(targetDir, 'FFMPEG-LICENSE.txt')
      await copyFile(join(extraction, source.licenseMember), licenseTarget)
      await rm(extraction, { recursive: true, force: true })
      const licenseHash = await hash(licenseTarget)
      const licenseRelative = `resources/engines/${targetPlatform}-${arch}/FFMPEG-LICENSE.txt`
      if (!sums.includes(`${licenseHash}  ${licenseRelative}`)) sums.push(`${licenseHash}  ${licenseRelative}`)
      metadata.architectures[`${targetPlatform}-${arch}`]['ffmpeg-license'] = {
        sourceUrl: url,
        archiveSha256,
        installedSha256: licenseHash,
        path: licenseRelative.replace('resources/engines/', ''),
        license: 'GPL-3.0-or-later',
        buildIdentity: process.env.BUILD_ID || 'local',
      }
    }
  }

  await stat(target)
  const architecture = await machArch(target)
  if (!expectedExecutableArchitecture(arch).test(architecture)) error(`wrong architecture for ${target}: ${architecture.trim()}`)
  const versionOutput = await run(target, item.versionArgs)
  assertVersion(versionOutput, item.version, name)
  assertBinaryIdentity(versionOutput, name)
  if (targetPlatform === 'linux' && name === 'ffmpeg') {
    const encoderOutput = await run(target, ['-hide_banner', '-encoders'])
    for (const encoder of item.requiredEncoders || []) {
      if (!hasEncoder(encoderOutput, encoder)) error(`Linux ffmpeg is missing required encoder ${encoder}`)
    }
  }
  if (name === 'bgutil-provider') await providerContract(target)

  const installed = await hash(target)
  const relative = `resources/engines/${name === 'bgutil-provider' ? `po-token/${targetPlatform}-${arch}/${name}` : `${targetPlatform}-${arch}/${name}`}`
  sums.push(`${installed}  ${relative}`)
  const archMetadata = metadata.architectures[`${targetPlatform}-${arch}`]
  archMetadata[name] = {
    version: item.version,
    sourceUrl: url,
    archiveSha256,
    installedSha256: installed,
    architecture: arch,
    verifiedAt: new Date().toISOString(),
    buildIdentity: process.env.BUILD_ID || 'local',
  }

  if (targetPlatform === 'darwin' && name === 'yt-dlp') {
    const sidecar = join(targetDir, '_internal')
    await stat(join(sidecar, 'Python'))
    const sidecarHash = await treeHash(sidecar)
    const path = `resources/engines/darwin-${arch}/_internal`
    sums.push(`${sidecarHash}  ${path}`)
    archMetadata['yt-dlp-sidecar'] = {
      installedSha256: sidecarHash,
      path,
      requiredFile: 'Python',
      architecture: arch,
      buildIdentity: process.env.BUILD_ID || 'local',
    }
  }
}

async function installProviderPlugin(arch, mode, poDir, tempDir, downloaded, metadata, sums) {
  const item = manifest.engines['bgutil-provider']
  const plugin = item.plugin
  if (!pinned(plugin.archive, plugin.version)) error('un-pinned bgutil plugin')
  const pluginDir = join(poDir, 'yt_dlp_plugins')
  if (mode === 'fetch') {
    const archive = await downloadCached({ url: plugin.archive, sha256: plugin.sha256 }, tempDir, downloaded)
    await rm(pluginDir, { recursive: true, force: true })
    await mkdir(pluginDir, { recursive: true })
    await run('unzip', ['-q', '-o', archive, '-d', poDir])
    downloaded.delete(`${plugin.archive}:${plugin.sha256}`)
  }
  await stat(pluginDir)
  const pluginHash = await treeHash(pluginDir)
  const relative = `resources/engines/po-token/${targetPlatform}-${arch}/yt_dlp_plugins`
  sums.push(`${pluginHash}  ${relative}`)
  metadata.architectures[`${targetPlatform}-${arch}`]['bgutil-plugin'] = {
    version: plugin.version,
    sourceUrl: plugin.archive,
    archiveSha256: plugin.sha256,
    installedSha256: pluginHash,
    installPath: relative,
    architecture: arch,
    buildIdentity: process.env.BUILD_ID || 'local',
  }
}

async function verifyOneArch(arch, metadata, sumsText) {
  const key = `${targetPlatform}-${arch}`
  const archMetadata = metadata.architectures?.[key]
  if (!archMetadata) error(targetPlatform === 'darwin'
    ? `missing metadata entry for darwin-${arch}`
    : `missing metadata entry for linux-${arch}`)
  const targetDir = join(enginesRoot, key)
  const poDir = join(enginesRoot, 'po-token', key)
  for (const [name, item] of Object.entries(manifest.engines)) {
    const target = join(name === 'bgutil-provider' ? poDir : targetDir, name)
    const entry = archMetadata[name]
    if (!entry?.installedSha256) error(`missing metadata checksum for ${target}`)
    const got = await hash(target)
    const relative = `resources/engines/${name === 'bgutil-provider' ? `po-token/${key}/${name}` : `${key}/${name}`}`
    if (got !== entry.installedSha256) error(`metadata checksum mismatch ${target}`)
    if (!sumsText.split(/\r?\n/).includes(`${got}  ${relative}`)) error(`missing SHA256SUMS entry for ${relative}`)
    const source = sourceFor(item, targetPlatform, arch)
    if (entry.version !== item.version) error(`engine metadata version mismatch ${name} ${key}`)
    if (entry.sourceUrl !== urlFor(source) || entry.archiveSha256 !== shaFor(source)) error(`engine metadata source mismatch ${name} ${key}`)
    const versionOutput = await run(target, item.versionArgs)
    assertVersion(versionOutput, item.version, name)
    assertBinaryIdentity(versionOutput, name)
  if (targetPlatform === 'linux' && name === 'ffmpeg') {
    const encoderOutput = await run(target, ['-hide_banner', '-encoders'])
    for (const encoder of item.requiredEncoders || []) {
      if (!hasEncoder(encoderOutput, encoder)) error(`Linux ffmpeg is missing required encoder ${encoder}`)
      }
    }
    if (name === 'bgutil-provider') await providerContract(target)
  }

  const pluginDir = join(poDir, 'yt_dlp_plugins')
  const pluginEntry = archMetadata['bgutil-plugin']
  if (!pluginEntry?.installedSha256) error(`missing metadata checksum for provider plugin ${pluginDir}`)
  const pluginHash = await treeHash(pluginDir)
  const pluginRelative = `resources/engines/po-token/${key}/yt_dlp_plugins`
  if (pluginHash !== pluginEntry.installedSha256) error(`provider plugin metadata checksum mismatch ${pluginDir}`)
  if (pluginEntry.version !== manifest.engines['bgutil-provider'].plugin.version) error(`provider plugin version mismatch ${key}`)
  if (!sumsText.split(/\r?\n/).includes(`${pluginHash}  ${pluginRelative}`)) error(`missing SHA256SUMS entry for provider plugin ${pluginDir}`)

  if (targetPlatform === 'darwin') {
    const sidecar = join(targetDir, '_internal')
    const sidecarEntry = archMetadata['yt-dlp-sidecar']
    if (!sidecarEntry?.installedSha256) error(`missing yt-dlp sidecar metadata for ${sidecar}`)
    await stat(join(sidecar, 'Python'))
    const sidecarHash = await treeHash(sidecar)
    if (sidecarHash !== sidecarEntry.installedSha256 || !sumsText.split(/\r?\n/).includes(`${sidecarHash}  resources/engines/darwin-${arch}/_internal`)) {
      error(`missing or invalid yt-dlp sidecar ${sidecar}`)
    }
  } else {
    const licensePath = join(targetDir, 'FFMPEG-LICENSE.txt')
    const licenseEntry = archMetadata['ffmpeg-license']
    if (!licenseEntry?.installedSha256) error(`missing metadata checksum for ${licensePath}`)
    const licenseHash = await hash(licensePath)
    const licenseRelative = `resources/engines/${key}/FFMPEG-LICENSE.txt`
    if (licenseHash !== licenseEntry.installedSha256 || !sumsText.split(/\r?\n/).includes(`${licenseHash}  ${licenseRelative}`)) {
      error(`missing or invalid FFmpeg license ${licensePath}`)
    }
    const licenseText = await readFile(licensePath, 'utf8')
    if (!licenseText.includes('GNU GENERAL PUBLIC LICENSE') || !licenseText.includes('Version 3')) error(`unexpected FFmpeg license contents ${licensePath}`)
  }
}

async function main() {
  validate()
  const mode = process.argv[2] === 'verify' ? 'verify' : 'fetch'
  const targetDirs = arches.map((arch) => `${targetPlatform}-${arch}`)
  const metadata = mode === 'fetch'
    ? await readFile(join(enginesRoot, 'metadata.json'), 'utf8').then(JSON.parse).catch(() => ({ schemaVersion: 1, architectures: {} }))
    : JSON.parse(await readFile(join(enginesRoot, 'metadata.json'), 'utf8'))
  metadata.generatedAt = new Date().toISOString()
  metadata.buildIdentity = process.env.BUILD_ID || metadata.buildIdentity || 'local'
  metadata.architectures ||= {}
  if (mode === 'fetch') {
    for (const targetDir of targetDirs) metadata.architectures[targetDir] = {}
  }

  const priorSums = mode === 'fetch'
    ? await readFile(join(enginesRoot, 'SHA256SUMS'), 'utf8').catch(() => '')
    : ''
  const sums = mode === 'fetch'
    ? priorSums.split(/\r?\n/).filter(Boolean).filter((line) => !arches.some((arch) => line.includes(`/${targetPlatform}-${arch}/`) || line.endsWith(`${targetPlatform}-${arch}/_internal`)))
    : []
  const downloaded = new Map()

  if (mode === 'fetch') {
    for (const arch of arches) {
      const targetDir = join(enginesRoot, `${targetPlatform}-${arch}`)
      const poDir = join(enginesRoot, 'po-token', `${targetPlatform}-${arch}`)
      await mkdir(targetDir, { recursive: true })
      await mkdir(poDir, { recursive: true })
      const tempDir = join(enginesRoot, `.download-${targetPlatform}-${arch}`)
      await rm(tempDir, { recursive: true, force: true })
      await mkdir(tempDir, { recursive: true })
      try {
        for (const [name, item] of Object.entries(manifest.engines)) {
          await installOne(name, item, arch, mode, targetDir, poDir, tempDir, downloaded, metadata, sums)
        }
        await installProviderPlugin(arch, mode, poDir, tempDir, downloaded, metadata, sums)
      } finally {
        await rm(tempDir, { recursive: true, force: true })
      }
    }
    await writeFile(join(enginesRoot, 'SHA256SUMS'), `${sums.join('\n')}\n`)
    await writeFile(join(enginesRoot, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`)
  } else {
    const sumsText = await readFile(join(enginesRoot, 'SHA256SUMS'), 'utf8')
    for (const arch of arches) await verifyOneArch(arch, metadata, sumsText)
  }
}

main().catch((err) => {
  console.error(`ENGINE ERROR: ${err instanceof Error ? err.message : String(err)}`)
  process.exitCode = 1
})
