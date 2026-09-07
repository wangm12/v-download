import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { isIgnoredArtifactName } from './apiJobsModel'
import {
  isLibraryOwnedPath,
  isRemoteJobsPath,
  mediaKindFromName,
  resolveLibraryPath,
  type LibraryDiskFile
} from './libraryModel'

const SCAN_CACHE_MS = 4000

interface ScanCache {
  downloadDir: string
  files: LibraryDiskFile[]
  expiresAt: number
}

let scanCache: ScanCache | null = null

export function resetLibraryScanCache(): void {
  scanCache = null
}

function listDirectorySafe(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

function walkDownloadDir(downloadDir: string): LibraryDiskFile[] {
  const root = resolveLibraryPath(downloadDir)
  if (!existsSync(root)) return []
  const files: LibraryDiskFile[] = []
  const queue = [root]

  while (queue.length) {
    const current = queue.pop()!
    for (const name of listDirectorySafe(current)) {
      if (isIgnoredArtifactName(name)) continue
      const candidate = join(current, name)
      let real = candidate
      try {
        real = realpathSync(candidate)
      } catch {
        continue
      }
      if (!isLibraryOwnedPath(root, real)) continue
      if (isRemoteJobsPath(root, real)) continue

      let stats
      try {
        stats = statSync(real)
      } catch {
        continue
      }
      if (stats.isDirectory()) {
        queue.push(real)
        continue
      }
      if (!stats.isFile()) continue
      files.push({
        path: real,
        size: stats.size,
        mtimeMs: stats.mtimeMs,
        fileName: basename(real),
        mediaKind: mediaKindFromName(basename(real))
      })
    }
  }
  return files
}

export function scanLibraryDisk(downloadDir: string, options?: { forceRefresh?: boolean }): LibraryDiskFile[] {
  const root = resolveLibraryPath(downloadDir)
  const now = Date.now()
  if (!options?.forceRefresh && scanCache && scanCache.downloadDir === root && scanCache.expiresAt > now) {
    return scanCache.files
  }
  const files = walkDownloadDir(root)
  scanCache = {
    downloadDir: root,
    files,
    expiresAt: now + SCAN_CACHE_MS
  }
  return files
}
