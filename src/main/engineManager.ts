import { app } from 'electron'
import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, rm, stat, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pipeline } from 'node:stream/promises'
import * as settings from './settings'
import { compareEngineVersions, parseAssetDigest, resolveEngineUpdateState, type EngineUpdateResult } from './engineManagerModel'

const execFileAsync = promisify(execFile)
const ENGINE_UPDATE_MANIFEST_ENV = 'VDOWNLOAD_ENGINE_UPDATE_MANIFEST_URL'
const GITHUB_RELEASE_URL = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest'
const CHECK_TIMEOUT_MS = 12_000

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
  return settings.get(name === 'yt-dlp' ? 'ytdlpPath' : 'ffmpegPath')
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
    if (!response.ok) throw new Error(`Engine update check failed (${response.status})`)
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

function descriptorFromGithubRelease(release: any): EngineDescriptor | null {
  const version = String(release?.tag_name ?? '').replace(/^v/i, '').trim()
  const asset = (Array.isArray(release?.assets) ? release.assets : []).find(
    (item: RemoteAsset) => item.name === 'yt-dlp_macos.zip' || item.name === 'yt-dlp_macos'
  ) as RemoteAsset | undefined
  const url = asset?.browser_download_url
  const sha256 = parseAssetDigest(asset?.digest)
  if (!version || !validHttpsUrl(url) || !sha256) return null
  return {
    name: 'yt-dlp',
    version,
    url,
    sha256,
    archiveMember: asset?.name?.endsWith('.zip') ? 'yt-dlp_macos' : undefined,
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
  const timer = setTimeout(() => controller.abort(), 60_000)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'V-Download engine manager' }
    })
    if (!response.ok || !response.body) throw new Error(`Engine download failed (${response.status})`)
    await writeFile(path, Buffer.from(await response.arrayBuffer()))
  } finally {
    clearTimeout(timer)
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

async function extractArchive(archivePath: string, descriptor: EngineDescriptor, destination: string): Promise<void> {
  const extractDir = `${destination}.extract`
  await rm(extractDir, { recursive: true, force: true })
  await mkdir(extractDir, { recursive: true })
  await execFileAsync('unzip', ['-q', '-o', archivePath, '-d', extractDir], { timeout: 30_000 })
  const member = descriptor.archiveMember || descriptor.name
  const extractedPath = join(extractDir, member)
  await verifyExecutable(extractedPath, descriptor)
  await rm(destination, { force: true })
  await rename(extractedPath, destination)
  await rm(extractDir, { recursive: true, force: true })
}

export async function updateEngine(name: EngineName): Promise<EngineStatus[]> {
  const descriptor = updateDescriptors.get(name)
  if (!descriptor) throw new Error(`No verified ${name} update is available`)
  if (compareEngineVersions(descriptor.version, '0') <= 0) throw new Error('Invalid engine version')

  const targetDir = join(app.getPath('userData'), 'engines', `${process.platform}-${process.arch}`)
  await mkdir(targetDir, { recursive: true })
  const archivePath = join(targetDir, `.${name}.download`)
  const targetPath = join(targetDir, process.platform === 'win32' ? `${name}.exe` : name)
  try {
    await downloadFile(descriptor.url, archivePath)
    if ((await sha256File(archivePath)) !== descriptor.sha256) throw new Error(`${name} archive checksum mismatch`)
    if (descriptor.archiveMember) {
      await extractArchive(archivePath, descriptor, targetPath)
    } else {
      await verifyExecutable(archivePath, descriptor)
      await rm(targetPath, { force: true })
      await rename(archivePath, targetPath)
    }
    await settings.set(name === 'yt-dlp' ? 'ytdlpPath' : 'ffmpegPath', targetPath)
    updateDescriptors.delete(name)
  } finally {
    await rm(archivePath, { force: true })
    await rm(`${targetPath}.extract`, { recursive: true, force: true })
  }
  return getEngineStatuses()
}
