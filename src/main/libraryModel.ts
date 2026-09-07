import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'
import { isIgnoredArtifactName, mediaClass } from './apiJobsModel'
import { queueIdentityKey } from './mediaIdentity'
import { isPathInside, REMOTE_JOB_DIR_NAME } from './remoteJobModel'

export type LibraryMediaKind = 'video' | 'image' | 'audio' | 'other'
export type LibraryMediaFilter = 'all' | 'video' | 'image' | 'audio'
export type LibrarySortField = 'date' | 'size'
export type LibrarySortDir = 'desc' | 'asc'

export const LIBRARY_PAGE_SIZES = [12, 24, 48, 96] as const
export const LIBRARY_DEFAULT_PAGE_SIZE = 24

export interface LibraryQueueRow {
  id: string
  url: string
  title: string
  status: string
  file_path: string | null
  file_size: number | null
  thumbnail: string | null
  channel: string | null
  playlist_id: string | null
  playlist_index: number | null
  extras: string | null
  created_at?: string
  updated_at?: string
}

export interface LibraryDiskFile {
  path: string
  size: number
  mtimeMs: number
  fileName: string
  mediaKind: LibraryMediaKind
}

export interface LibraryFileItem {
  id: string
  path: string | null
  fileName: string
  title: string
  channel: string | null
  mediaKind: LibraryMediaKind
  size: number
  mtimeMs: number
  missing: boolean
  thumbnail: string | null
  downloadId: string | null
  workKey: string
}

export interface LibraryWorkItem {
  key: string
  title: string
  channel: string | null
  cover: string | null
  items: LibraryFileItem[]
  size: number
  mtimeMs: number
  missing: boolean
}

export interface LibraryListQuery {
  offset?: number
  limit?: number
  query?: string
  mediaType?: LibraryMediaFilter
  sortBy?: LibrarySortField
  sortDir?: LibrarySortDir
}

export interface LibraryPage<T> {
  items: T[]
  total: number
}

export type LibraryDeleteGuard = { ok: true; paths: string[] } | { ok: false; error: string }

const TITLE_PEEL = [/\s*\(\d+\)$/u, /_cover$/iu, /_live_photo$/iu, /第\d+张$/u] as const
const STABLE_EXTRA_IDS = ['awemeId', 'ytdlpId', 'noteId'] as const

export function mediaKindFromName(name: string): LibraryMediaKind {
  const kind = mediaClass(name)
  if (kind === 'video' || kind === 'image' || kind === 'audio') return kind
  return 'other'
}

export function parseLibraryExtras(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw !== 'string' || !raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

export function normalizeLibraryTitle(name: string): string {
  let value = basename(String(name || '').trim())
  if (!value) return ''
  const ext = extname(value)
  if (ext && mediaKindFromName(value) !== 'other') {
    value = value.slice(0, -ext.length)
  }
  let previous = ''
  while (value && value !== previous) {
    previous = value
    for (const peel of TITLE_PEEL) {
      value = value.replace(peel, '')
    }
    value = value.trim()
  }
  return value
}

function extraWorkKey(extras: Record<string, unknown>): string | null {
  for (const key of STABLE_EXTRA_IDS) {
    const value = extras[key]
    if (typeof value === 'string' && value.trim()) {
      const prefix = key === 'awemeId' ? 'aweme' : key === 'ytdlpId' ? 'ytdlp' : 'note'
      return `${prefix}:${value.trim()}`
    }
  }
  return null
}

export function libraryWorkKey(input: {
  extras?: unknown
  playlistId?: string | null
  playlistIndex?: number | null
  url?: string | null
  channel?: string | null
  parentFolder?: string | null
  title?: string | null
}): string {
  const extras = parseLibraryExtras(input.extras)
  const extraKey = extraWorkKey(extras)
  if (extraKey) return extraKey

  const playlistId = String(input.playlistId || '').trim()
  const playlistIndex = input.playlistIndex
  if (playlistId && playlistIndex != null && Number.isFinite(playlistIndex)) {
    return `playlist:${playlistId}:${playlistIndex}`
  }

  const url = String(input.url || '').trim()
  if (url) {
    const identity = queueIdentityKey(url)
    if (identity) return `url:${identity}`
  }

  const folder = String(input.channel || input.parentFolder || '').trim()
  const title = normalizeLibraryTitle(input.title || '')
  return `title:${folder}:${title}`
}

export function resolveLibraryPath(candidate: string): string {
  const resolved = resolve(candidate)
  try {
    if (existsSync(resolved)) return realpathSync(resolved)
  } catch {
    /* keep resolved */
  }
  return resolved
}

export function remoteJobsRoot(downloadDir: string): string {
  return resolveLibraryPath(resolve(downloadDir, REMOTE_JOB_DIR_NAME))
}

export function isRemoteJobsPath(downloadDir: string, candidate: string): boolean {
  return isPathInside(remoteJobsRoot(downloadDir), resolveLibraryPath(candidate))
}

export function isLibraryOwnedPath(downloadDir: string, candidate: string): boolean {
  const root = resolveLibraryPath(downloadDir)
  const target = resolveLibraryPath(candidate)
  if (target === root) return false
  return isPathInside(root, target) && !isRemoteJobsPath(root, target)
}

export function parentFolderLabel(downloadDir: string, filePath: string | null | undefined): string | null {
  if (!filePath) return null
  const root = resolveLibraryPath(downloadDir)
  const parent = resolveLibraryPath(dirname(filePath))
  if (parent === root || !isPathInside(root, parent)) return null
  const relative = parent.slice(root.endsWith(sep) ? root.length : root.length + 1)
  const first = relative.split(sep).filter(Boolean)[0]
  return first || null
}

export function assertLibraryDeletePaths(downloadDir: string, paths: unknown): LibraryDeleteGuard {
  if (!Array.isArray(paths) || paths.length === 0) {
    return { ok: false, error: 'No paths to delete' }
  }
  const resolved: string[] = []
  for (const path of paths) {
    if (typeof path !== 'string' || !path.trim() || path.length > 4096) {
      return { ok: false, error: 'Invalid path' }
    }
    const target = resolveLibraryPath(path.trim())
    if (!isLibraryOwnedPath(downloadDir, target)) {
      return { ok: false, error: 'Path is outside the download folder' }
    }
    resolved.push(target)
  }
  return { ok: true, paths: [...new Set(resolved)] }
}

function rowTimestamp(row: LibraryQueueRow): number {
  const raw = row.updated_at || row.created_at || ''
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? parsed : 0
}

function siblingGroupKey(downloadDir: string, item: Pick<LibraryFileItem, 'path' | 'title' | 'fileName' | 'channel'>): string {
  const folder = item.path
    ? resolveLibraryPath(dirname(item.path))
    : `${resolveLibraryPath(downloadDir)}::${item.channel || ''}`
  return `${folder}::${normalizeLibraryTitle(item.title || item.fileName)}`
}

function workKeyStrength(key: string): number {
  if (key.startsWith('aweme:')) return 4
  if (key.startsWith('ytdlp:') || key.startsWith('note:')) return 3
  if (key.startsWith('playlist:')) return 2
  if (key.startsWith('url:')) return 1
  return 0
}

function promoteSiblingWorkKeys(downloadDir: string, items: LibraryFileItem[]): void {
  const groups = new Map<string, LibraryFileItem[]>()
  for (const item of items) {
    const key = siblingGroupKey(downloadDir, item)
    const list = groups.get(key)
    if (list) list.push(item)
    else groups.set(key, [item])
  }
  for (const group of groups.values()) {
    let winner = group[0]?.workKey || ''
    for (const item of group) {
      if (workKeyStrength(item.workKey) > workKeyStrength(winner)) winner = item.workKey
    }
    if (workKeyStrength(winner) === 0) continue
    for (const item of group) item.workKey = winner
  }
}

function isExistingOwnedDirectory(downloadDir: string, candidate: string): boolean {
  if (!candidate || !isLibraryOwnedPath(downloadDir, candidate)) return false
  try {
    return statSync(resolveLibraryPath(candidate)).isDirectory()
  } catch {
    return false
  }
}

function diskFilesUnderDir(diskByPath: Map<string, LibraryDiskFile>, dir: string): LibraryDiskFile[] {
  const root = resolveLibraryPath(dir)
  const files: LibraryDiskFile[] = []
  for (const file of diskByPath.values()) {
    const path = resolveLibraryPath(file.path)
    if (path === root) continue
    if (isPathInside(root, path)) files.push(file)
  }
  return files
}

function ownedFilePathsUnderDir(downloadDir: string, dir: string): string[] {
  const root = resolveLibraryPath(dir)
  const files: string[] = []
  const queue = [root]
  while (queue.length) {
    const current = queue.pop()!
    let names: string[]
    try {
      names = readdirSync(current)
    } catch {
      continue
    }
    for (const name of names) {
      if (isIgnoredArtifactName(name)) continue
      const real = resolveLibraryPath(join(current, name))
      if (!isLibraryOwnedPath(downloadDir, real)) continue
      try {
        const stats = statSync(real)
        if (stats.isDirectory()) {
          queue.push(real)
          continue
        }
        if (stats.isFile()) files.push(real)
      } catch {
        continue
      }
    }
  }
  return files
}

function fileItemFromRow(
  row: LibraryQueueRow,
  downloadDir: string,
  disk: LibraryDiskFile | undefined,
  options?: { id?: string; missing?: boolean }
): LibraryFileItem {
  const extras = parseLibraryExtras(row.extras)
  let path = disk?.path ?? (row.file_path && isLibraryOwnedPath(downloadDir, row.file_path) ? resolveLibraryPath(row.file_path) : null)
  if (path && !disk && isExistingOwnedDirectory(downloadDir, path)) {
    path = null
  }
  const fileName = disk?.fileName || (row.file_path ? basename(row.file_path) : row.title)
  const parentFolder = parentFolderLabel(downloadDir, path || row.file_path)
  return {
    id: options?.id ?? row.id,
    path,
    fileName,
    title: row.title || fileName,
    channel: row.channel || parentFolder,
    mediaKind: disk?.mediaKind ?? mediaKindFromName(fileName),
    size: disk?.size ?? row.file_size ?? 0,
    mtimeMs: disk?.mtimeMs ?? rowTimestamp(row),
    missing: options?.missing ?? !disk,
    thumbnail: row.thumbnail,
    downloadId: row.id,
    workKey: libraryWorkKey({
      extras,
      playlistId: row.playlist_id,
      playlistIndex: row.playlist_index,
      url: row.url,
      channel: row.channel,
      parentFolder,
      title: row.title || fileName
    })
  }
}

function fileItemFromDisk(file: LibraryDiskFile, downloadDir: string): LibraryFileItem {
  const parentFolder = parentFolderLabel(downloadDir, file.path)
  return {
    id: `disk:${file.path}`,
    path: file.path,
    fileName: file.fileName,
    title: file.fileName,
    channel: parentFolder,
    mediaKind: file.mediaKind,
    size: file.size,
    mtimeMs: file.mtimeMs,
    missing: false,
    thumbnail: null,
    downloadId: null,
    workKey: libraryWorkKey({
      parentFolder,
      channel: parentFolder,
      title: file.fileName
    })
  }
}

export function mergeLibraryCatalog(input: {
  downloadDir: string
  rows: LibraryQueueRow[]
  diskFiles: LibraryDiskFile[]
}): LibraryFileItem[] {
  const downloadDir = resolveLibraryPath(input.downloadDir)
  const diskByPath = new Map<string, LibraryDiskFile>()
  for (const file of input.diskFiles) {
    if (!isLibraryOwnedPath(downloadDir, file.path)) continue
    diskByPath.set(resolveLibraryPath(file.path), file)
  }

  const items: LibraryFileItem[] = []
  const usedDisk = new Set<string>()

  for (const row of input.rows) {
    if (String(row.status) !== 'complete') continue
    if (row.file_path && isRemoteJobsPath(downloadDir, row.file_path)) continue
    const resolved = row.file_path ? resolveLibraryPath(row.file_path) : ''
    if (resolved && isExistingOwnedDirectory(downloadDir, resolved)) {
      const children = diskFilesUnderDir(diskByPath, resolved)
      if (children.length) {
        for (const child of children) {
          const childPath = resolveLibraryPath(child.path)
          usedDisk.add(childPath)
          items.push(fileItemFromRow(row, downloadDir, child, { id: `${row.id}:${childPath}` }))
        }
        continue
      }
      items.push(fileItemFromRow(row, downloadDir, undefined, { missing: false }))
      continue
    }
    const disk = resolved ? diskByPath.get(resolved) : undefined
    if (disk) usedDisk.add(resolved)
    items.push(fileItemFromRow(row, downloadDir, disk))
  }

  for (const file of diskByPath.values()) {
    if (usedDisk.has(resolveLibraryPath(file.path))) continue
    items.push(fileItemFromDisk(file, downloadDir))
  }

  promoteSiblingWorkKeys(downloadDir, items)
  return items
}

function matchesQuery(item: LibraryFileItem, query: string): boolean {
  if (!query) return true
  const haystack = `${item.title}\0${item.channel || ''}\0${item.fileName}`.toLowerCase()
  return haystack.includes(query)
}

function matchesMedia(item: LibraryFileItem, mediaType: LibraryMediaFilter | undefined): boolean {
  return !mediaType || mediaType === 'all' || item.mediaKind === mediaType
}

function compareItems(left: { size: number; mtimeMs: number }, right: { size: number; mtimeMs: number }, sortBy: LibrarySortField, sortDir: LibrarySortDir): number {
  const field = sortBy === 'size' ? left.size - right.size : left.mtimeMs - right.mtimeMs
  return sortDir === 'asc' ? field : -field
}

export function normalizeLibraryQuery(query: LibraryListQuery | undefined): Required<LibraryListQuery> {
  const limitRaw = Number(query?.limit)
  const offsetRaw = Number(query?.offset)
  const sortBy = query?.sortBy === 'size' ? 'size' : 'date'
  const sortDir = query?.sortDir === 'asc' ? 'asc' : 'desc'
  const mediaType = query?.mediaType && query.mediaType !== 'all' ? query.mediaType : 'all'
  return {
    offset: Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0,
    limit: Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 96) : LIBRARY_DEFAULT_PAGE_SIZE,
    query: String(query?.query || '').trim(),
    mediaType,
    sortBy,
    sortDir
  }
}

export function pageLibraryItems<T>(items: readonly T[], query?: LibraryListQuery): LibraryPage<T> {
  const { offset, limit } = normalizeLibraryQuery(query)
  return {
    items: items.slice(offset, offset + limit),
    total: items.length
  }
}

export function queryLibraryFiles(items: LibraryFileItem[], query?: LibraryListQuery): LibraryPage<LibraryFileItem> {
  const parsed = normalizeLibraryQuery(query)
  const needle = parsed.query.toLowerCase()
  const filtered = items
    .filter((item) => matchesMedia(item, parsed.mediaType) && matchesQuery(item, needle))
    .sort((left, right) => compareItems(left, right, parsed.sortBy, parsed.sortDir))
  return pageLibraryItems(filtered, parsed)
}

export function workCover(items: LibraryFileItem[]): string | null {
  const thumb = items.find((item) => item.thumbnail)?.thumbnail
  if (thumb) return thumb
  const image = items.find((item) => !item.missing && item.mediaKind === 'image' && item.path)
  if (image?.path) return image.path
  const video = items.find((item) => !item.missing && item.mediaKind === 'video' && item.path)
  return video?.path || null
}

export function groupLibraryWorks(items: LibraryFileItem[]): LibraryWorkItem[] {
  const groups = new Map<string, LibraryFileItem[]>()
  for (const item of items) {
    const list = groups.get(item.workKey)
    if (list) list.push(item)
    else groups.set(item.workKey, [item])
  }
  const works: LibraryWorkItem[] = []
  for (const [key, group] of groups) {
    const sorted = group.slice().sort((left, right) => compareItems(left, right, 'date', 'desc'))
    works.push({
      key,
      title: normalizeLibraryTitle(sorted.find((item) => item.downloadId)?.title || sorted[0]?.title || sorted[0]?.fileName || 'Untitled'),
      channel: sorted.find((item) => item.channel)?.channel || null,
      cover: workCover(sorted),
      items: sorted,
      size: sorted.reduce((sum, item) => sum + item.size, 0),
      mtimeMs: Math.max(0, ...sorted.map((item) => item.mtimeMs)),
      missing: sorted.every((item) => item.missing)
    })
  }
  return works
}

export function queryLibraryWorks(items: LibraryFileItem[], query?: LibraryListQuery): LibraryPage<LibraryWorkItem> {
  const parsed = normalizeLibraryQuery(query)
  const needle = parsed.query.toLowerCase()
  const works = groupLibraryWorks(items)
    .filter((work) => {
      if (parsed.mediaType !== 'all' && !work.items.some((item) => item.mediaKind === parsed.mediaType)) return false
      if (!needle) return true
      if (`${work.title}\0${work.channel || ''}`.toLowerCase().includes(needle)) return true
      return work.items.some((item) => matchesQuery(item, needle))
    })
    .sort((left, right) => compareItems(left, right, parsed.sortBy, parsed.sortDir))
  return pageLibraryItems(works, parsed)
}

export function planLibraryDelete(input: {
  downloadDir: string
  paths: string[]
  recordIds?: string[]
  rows: Array<{ id: string; file_path: string | null }>
}): { ok: true; unlinkPaths: string[]; deleteIds: string[] } | { ok: false; error: string } {
  const extraIds = (input.recordIds || []).map((id) => String(id || '').trim()).filter(Boolean)
  const guarded = input.paths.length ? assertLibraryDeletePaths(input.downloadDir, input.paths) : { ok: true as const, paths: [] as string[] }
  if (!guarded.ok) return guarded
  if (guarded.paths.length === 0 && extraIds.length === 0) {
    return { ok: false, error: 'No paths to delete' }
  }
  const owned = new Set(guarded.paths)
  const unlinkPaths = guarded.paths.filter((path) => !isExistingOwnedDirectory(input.downloadDir, path))
  const deleteIds = new Set<string>()
  for (const row of input.rows) {
    if (!row.file_path) {
      if (extraIds.includes(row.id)) deleteIds.add(row.id)
      continue
    }
    const rowPath = resolveLibraryPath(row.file_path)
    if (owned.has(rowPath)) {
      deleteIds.add(row.id)
      continue
    }
    if (isExistingOwnedDirectory(input.downloadDir, rowPath)) {
      const remaining = ownedFilePathsUnderDir(input.downloadDir, rowPath).filter((path) => !owned.has(path))
      if (remaining.length === 0) deleteIds.add(row.id)
      continue
    }
    if (extraIds.includes(row.id)) deleteIds.add(row.id)
  }
  return { ok: true, unlinkPaths, deleteIds: [...deleteIds] }
}

