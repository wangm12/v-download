import { app } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { createWriteStream } from 'node:fs'
import { chmod, copyFile, mkdir, readFile, rm, stat, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pipeline } from 'node:stream/promises'
import { Readable, Transform } from 'node:stream'
import * as settings from './settings'
import { compareEngineVersions, parseAssetDigest, resolveEngineUpdateState, type EngineUpdateResult } from './engineManagerModel'
import { clearYtdlpVersionCache, getYtdlpPath } from './ytdlp'

const execFileAsync = promisify(execFile)
const ENGINE_UPDATE_MANIFEST_ENV = 'VDOWNLOAD_ENGINE_UPDATE_MANIFEST_URL'
const GITHUB_RELEASE_URL = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest'
const CHECK_TIMEOUT_MS = 12_000
const ENGINE_DOWNLOAD_IDLE_TIMEOUT_MS = 60_000
const MAX_ENGINE_ARCHIVE_BYTES = 1024 * 1024 * 1024

type EngineName = 'yt-dlp' | 'ffmpeg'
type EngineSource = 'bundled' | 'custom' | 'system' | 'missing'

interface RemoteAsset {
  name?: string
  browser_download_url?: string
  digest?: string | null
}

interface EngineDescriptor {
  name: EngineName
  version: string
  url: string
  sha256: string
  archiveMember?: string
  versionArgs: string[]
}

export interface EngineStatus {
  name: EngineName
  path: string
  source: EngineSource
  version: string | null
  bundledVersion: string | null
  latestVersion: string | null
  updateState: EngineUpdateResult['state']
  updateMessage?: string
  canUpdate: boolean
}

const updateDescriptors = new Map<EngineName, EngineDescriptor>()
const engineUpdatePromises = new Map<EngineName, Promise<EngineStatus[]>>()

function resourcesRoot(): string {
  return process.resourcesPath || join(process.cwd(), 'resources')
}

function manifestPath(): string {
  return join(resourcesRoot(), 'engines', 'manifest.json')
}

async function readBundledManifest(): Promise<Record<string, any>> {
  try {
    return JSON.parse(await readFile(manifestPath(), 'utf8')) as Record<string, any>
  } catch {
    return {}
  }
}

function currentEnginePath(name: EngineName): string {
  if (name === 'yt-dlp') return getYtdlpPath(settings.get('ytdlpPath'))
  return settings.get('ffmpegPath')
}

function bundledEnginePath(name: EngineName): string {
  const executable = process.platform === 'win32' ? `${name}.exe` : name
  return join(resourcesRoot(), 'engines', `${process.platform}-${process.arch}`, executable)
}

function sourceForPath(name: EngineName, path: string): EngineSource {
  if (!path) return 'missing'
  if (path === bundledEnginePath(name)) return 'bundled'
  if (path.includes(`${name}`) && path.includes('engines')) return 'custom'
  return 'system'
}

async function versionForPath(path: string, name: EngineName): Promise<string | null> {
  if (!path) return null
  try {
    const args = name === 'yt-dlp' ? ['--version'] : ['-version']
    const result = await execFileAsync(path, args, { timeout: 8_000, maxBuffer: 256 * 1024 })
    const text = `${result.stdout}\n${result.stderr}`
    if (name === 'yt-dlp') return text.trim().split(/\s+/)[0] || null
    return /ffmpeg version\s+([^\s]+)/i.exec(text)?.[1] ?? null
  } catch {
    return null
  }
}

function validHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
  } catch {
    return false
  }
}

async function fetchJson(url: string): Promise<any> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'V-Download engine manager'
      }
    })
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error(`Engine update check failed (${response.status})`)
    }
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

function descriptorFromGithubRelease(release: any): EngineDescriptor | null {
  const version = String(release?.tag_name ?? '').replace(/^v/i, '').trim()
  const assets = (Array.isArray(release?.assets) ? release.assets : []) as RemoteAsset[]

  let asset: RemoteAsset | undefined
  let archiveMember: string | undefined

  if (process.platform === 'darwin') {
    asset = assets.find((item) => item.name === 'yt-dlp_macos.zip' || item.name === 'yt-dlp_macos')
    archiveMember = asset?.name?.endsWith('.zip') ? 'yt-dlp_macos' : undefined
  } else if (process.platform === 'win32') {
    asset = assets.find((item) => item.name === 'yt-dlp.exe')
    archiveMember = undefined
  } else {
    const linuxTarget = process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux'
    asset = assets.find((item) => item.name === linuxTarget) ?? assets.find((item) => item.name === 'yt-dlp')
    archiveMember = undefined
  }

  const url = asset?.browser_download_url
  const sha256 = parseAssetDigest(asset?.digest)
  if (!version || !validHttpsUrl(url) || !sha256) return null
  return {
    name: 'yt-dlp',
    version,
    url,
    sha256,
    archiveMember,
    versionArgs: ['--version']
  }
}

function descriptorFromManagedManifest(name: EngineName, item: any): EngineDescriptor | null {
  const version = String(item?.version ?? '').replace(/^v/i, '').trim()
  const url = item?.url ?? item?.archive
  const sha256 = String(item?.sha256 ?? '').toLowerCase()
  if (!version || !validHttpsUrl(url) || !/^[a-f0-9]{64}$/.test(sha256)) return null
  return {
    name,
    version,
    url,
    sha256,
    archiveMember: typeof item.member === 'string' ? item.member : undefined,
    versionArgs: name === 'yt-dlp' ? ['--version'] : ['-version']
  }
}

async function managedDescriptors(): Promise<Map<EngineName, EngineDescriptor>> {
  const result = new Map<EngineName, EngineDescriptor>()
  const endpoint = process.env[ENGINE_UPDATE_MANIFEST_ENV]?.trim()
  if (!endpoint || !validHttpsUrl(endpoint)) return result
  try {
    const payload = await fetchJson(endpoint)
    for (const name of ['yt-dlp', 'ffmpeg'] as const) {
      const descriptor = descriptorFromManagedManifest(name, payload?.engines?.[name])
      if (descriptor) result.set(name, descriptor)
    }
  } catch {
    /* A managed manifest is optional; the built-in yt-dlp check still runs. */
  }
  return result
}

function updateStateFor(status: { version: string | null; latestVersion: string | null }): EngineUpdateResult {
  if (!status.version) return { state: 'unknown' }
  return resolveEngineUpdateState({ currentVersion: status.version, latestVersion: status.latestVersion })
}

export async function getEngineStatuses(): Promise<EngineStatus[]> {
  const manifest = await readBundledManifest()
  const statuses: EngineStatus[] = []
  for (const name of ['yt-dlp', 'ffmpeg'] as const) {
    const path = currentEnginePath(name)
    const source = sourceForPath(name, path)
    const version = await versionForPath(path, name)
    const bundledVersion = typeof manifest.engines?.[name]?.version === 'string' ? manifest.engines[name].version : null
    statuses.push({
      name,
      path,
      source,
      version,
      bundledVersion,
      latestVersion: null,
      updateState: version ? 'unknown' : 'unknown',
      canUpdate: false
    })
  }
  return statuses
}

export async function checkEngineUpdates(): Promise<EngineStatus[]> {
  const statuses = await getEngineStatuses()
  updateDescriptors.clear()
  const managed = await managedDescriptors()

  let githubDescriptor: EngineDescriptor | null = null
  try {
    githubDescriptor = descriptorFromGithubRelease(await fetchJson(GITHUB_RELEASE_URL))
  } catch {
    /* Network failures should not make the installed engines unusable. */
  }

  for (const status of statuses) {
    const descriptor = managed.get(status.name) ?? (status.name === 'yt-dlp' ? githubDescriptor : null)
    if (!descriptor) {
      status.updateState = status.version ? 'unknown' : 'unknown'
      status.updateMessage = status.name === 'ffmpeg'
        ? 'FFmpeg updates are supplied through the app engine manifest.'
        : 'No signed update metadata was available.'
      continue
    }
    const state = updateStateFor({ version: status.version, latestVersion: descriptor.version })
    status.latestVersion = descriptor.version
    status.updateState = state.state
    status.canUpdate = state.state === 'available'
    if (status.canUpdate) updateDescriptors.set(status.name, descriptor)
  }
  return statuses
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline((await import('node:fs')).createReadStream(path), hash)
  return hash.digest('hex')
}

async function downloadFile(url: string, path: string): Promise<void> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const touch = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => controller.abort(), ENGINE_DOWNLOAD_IDLE_TIMEOUT_MS)
  }
  touch()
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'V-Download engine manager' }
    })
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error(`Engine download failed (${response.status})`)
    }
    let receivedBytes = 0
    const cap = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        receivedBytes += chunk.length
        if (receivedBytes > MAX_ENGINE_ARCHIVE_BYTES) {
          callback(new Error(`Engine archive exceeded ${MAX_ENGINE_ARCHIVE_BYTES} bytes`))
          return
        }
        touch()
        callback(null, chunk)
      }
    })
    await pipeline(
      Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>),
      cap,
      createWriteStream(path),
      { signal: controller.signal }
    )
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function verifyExecutable(path: string, descriptor: EngineDescriptor): Promise<void> {
  await stat(path)
  await chmod(path, 0o755)
  const output = await execFileAsync(path, descriptor.versionArgs, { timeout: 10_000, maxBuffer: 256 * 1024 })
  if (!`${output.stdout}\n${output.stderr}`.includes(descriptor.version)) {
    throw new Error(`${descriptor.name} version verification failed`)
  }
}

async function extractArchive(
  archivePath: string,
  descriptor: EngineDescriptor,
  destination: string,
  extractDir: string
): Promise<void> {
  await mkdir(extractDir, { recursive: true })
  await execFileAsync('unzip', ['-q', '-o', archivePath, '-d', extractDir], { timeout: 30_000 })
  const member = descriptor.archiveMember || descriptor.name
  const extractedPath = join(extractDir, member)
  if (!extractedPath.startsWith(`${extractDir}${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new Error(`${descriptor.name} archive member path is invalid`)
  }
  await verifyExecutable(extractedPath, descriptor)
  await rename(extractedPath, destination)
}

async function updateEngineOnce(name: EngineName): Promise<EngineStatus[]> {
  const descriptor = updateDescriptors.get(name)
  if (!descriptor) throw new Error(`No verified ${name} update is available`)
  if (compareEngineVersions(descriptor.version, '0') <= 0) throw new Error('Invalid engine version')

  const targetDir = join(app.getPath('userData'), 'engines', `${process.platform}-${process.arch}`)
  await mkdir(targetDir, { recursive: true })
  const transactionId = randomUUID()
  const archivePath = join(targetDir, `.${name}.${transactionId}.download`)
  const stagedPath = join(targetDir, `.${name}.${transactionId}.candidate`)
  const extractDir = `${stagedPath}.extract`
  const backupPath = join(targetDir, `.${name}.${transactionId}.backup`)
  const targetPath = join(targetDir, process.platform === 'win32' ? `${name}.exe` : name)
  let hadOriginal = false
  let installed = false
  try {
    await downloadFile(descriptor.url, archivePath)
    if ((await sha256File(archivePath)) !== descriptor.sha256) throw new Error(`${name} archive checksum mismatch`)
    if (descriptor.archiveMember) {
      await extractArchive(archivePath, descriptor, stagedPath, extractDir)
    } else {
      await verifyExecutable(archivePath, descriptor)
      await rename(archivePath, stagedPath)
    }

    try {
      await copyFile(targetPath, backupPath, fsConstants.COPYFILE_EXCL)
      hadOriginal = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }

    try {
      await rename(stagedPath, targetPath)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (process.platform !== 'win32' || (code !== 'EEXIST' && code !== 'EPERM' && code !== 'EACCES')) throw error
      await rm(targetPath, { force: true })
      await rename(stagedPath, targetPath)
    }
    installed = true

    try {
      settings.setEnginePathStrict(name === 'yt-dlp' ? 'ytdlpPath' : 'ffmpegPath', targetPath)
    } catch (error) {
      if (hadOriginal && process.platform === 'win32') await rm(targetPath, { force: true })
      if (!hadOriginal) await rm(targetPath, { force: true })
      installed = false
      if (hadOriginal) {
        await rename(backupPath, targetPath)
        hadOriginal = false
      }
      throw error
    }

    if (name === 'yt-dlp') clearYtdlpVersionCache(targetPath)
    await rm(backupPath, { force: true }).then(() => { hadOriginal = false }).catch(() => undefined)
    updateDescriptors.delete(name)
  } catch (error) {
    if (hadOriginal) {
      if (process.platform === 'win32') await rm(targetPath, { force: true }).catch(() => undefined)
      await rename(backupPath, targetPath).catch(() => undefined)
    } else if (installed) {
      await rm(targetPath, { force: true }).catch(() => undefined)
    }
    throw error
  } finally {
    await rm(archivePath, { force: true })
    await rm(stagedPath, { force: true })
    await rm(extractDir, { recursive: true, force: true })
  }
  return getEngineStatuses()
}

export function updateEngine(name: EngineName): Promise<EngineStatus[]> {
  const existing = engineUpdatePromises.get(name)
  if (existing) return existing
  const update = updateEngineOnce(name)
  engineUpdatePromises.set(name, update)
  const clear = () => {
    if (engineUpdatePromises.get(name) === update) engineUpdatePromises.delete(name)
  }
  void update.then(clear, clear)
  return update
}
