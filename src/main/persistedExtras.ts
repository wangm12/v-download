import { filterPersistedHeaders } from './mediaResolver'

function isSerializedIdentity(value: unknown): value is string {
  return typeof value === 'string' && /^\d{1,40}$/.test(value)
}

function persistedIdentityEntry(value: unknown, key: 'ownedOutputFiles' | 'ownedOutputDirs'):
  | { path: string; dev: string; ino: string; size?: string; birthtimeNs?: string }
  | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const entry = value as Record<string, unknown>
  if (
    typeof entry.path !== 'string' || !entry.path || entry.path.length > 4096 ||
    !isSerializedIdentity(entry.dev) || !isSerializedIdentity(entry.ino)
  ) return null
  const out: { path: string; dev: string; ino: string; size?: string; birthtimeNs?: string } = {
    path: entry.path,
    dev: entry.dev,
    ino: entry.ino,
  }
  if (key === 'ownedOutputFiles' && isSerializedIdentity(entry.size)) out.size = entry.size
  if (isSerializedIdentity(entry.birthtimeNs)) out.birthtimeNs = entry.birthtimeNs
  return out
}

export function pickPersistedExtras(metadata?: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!metadata) return out
  if (metadata.infoResolve === true) out.infoResolve = true
  if (metadata.resolveAutoStart === true) out.resolveAutoStart = true
  if (typeof metadata.resolveTitle === 'string' && metadata.resolveTitle.trim()) out.resolveTitle = metadata.resolveTitle.trim()
  if (metadata.nativeYoutubePlaylist === true) out.nativeYoutubePlaylist = true
  if (metadata.remoteResolvedPlaylist === true) out.remoteResolvedPlaylist = true
  if (Array.isArray(metadata.nativePlaylistOwnedPaths)) {
    const paths: string[] = []
    let estimatedBytes = 0
    for (const path of metadata.nativePlaylistOwnedPaths) {
      if (typeof path !== 'string' || path.length === 0 || path.length > 4096) continue
      const cost = path.length * 2 + 16
      if (paths.length >= 10_000 || estimatedBytes + cost > 4 * 1024 * 1024) break
      paths.push(path)
      estimatedBytes += cost
    }
    out.nativePlaylistOwnedPaths = paths
  }
  if (Array.isArray(metadata.nativePlaylistPublishJournal)) {
    const entries: Array<Record<string, string>> = []
    let estimatedBytes = 0
    for (const value of metadata.nativePlaylistPublishJournal) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const entry = value as Record<string, unknown>
      if (
        typeof entry.sourcePath !== 'string' || !entry.sourcePath || entry.sourcePath.length > 4096 ||
        typeof entry.destinationPath !== 'string' || !entry.destinationPath || entry.destinationPath.length > 4096
      ) continue
      if (!isSerializedIdentity(entry.sourceDev) || !isSerializedIdentity(entry.sourceIno) || !isSerializedIdentity(entry.sourceSize)) continue
      const normalized: Record<string, string> = {
        sourcePath: entry.sourcePath,
        destinationPath: entry.destinationPath,
        sourceDev: entry.sourceDev,
        sourceIno: entry.sourceIno,
        sourceSize: entry.sourceSize,
      }
      for (const key of ['sourceBirthtimeNs', 'destinationDev', 'destinationIno', 'destinationSize', 'destinationBirthtimeNs']) {
        if (isSerializedIdentity(entry[key])) normalized[key] = entry[key] as string
      }
      if (Boolean(normalized.destinationDev) !== Boolean(normalized.destinationIno)) continue
      if (normalized.destinationDev && !normalized.destinationSize) continue
      const cost = Object.entries(normalized).reduce((total, [key, item]) => total + (key.length + item.length) * 2 + 8, 0)
      if (entries.length >= 10_000 || estimatedBytes + cost > 4 * 1024 * 1024) break
      entries.push(normalized)
      estimatedBytes += cost
    }
    out.nativePlaylistPublishJournal = entries
  }
  if (Array.isArray(metadata.ownedOutputPublishJournal)) {
    const entries: Array<Record<string, string>> = []
    let estimatedBytes = 0
    for (const value of metadata.ownedOutputPublishJournal) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const entry = value as Record<string, unknown>
      if (
        typeof entry.sourcePath !== 'string' || !entry.sourcePath || entry.sourcePath.length > 4096 ||
        typeof entry.destinationPath !== 'string' || !entry.destinationPath || entry.destinationPath.length > 4096 ||
        !isSerializedIdentity(entry.sourceDev) || !isSerializedIdentity(entry.sourceIno) || !isSerializedIdentity(entry.sourceSize)
      ) continue
      const normalized: Record<string, string> = {
        sourcePath: entry.sourcePath,
        destinationPath: entry.destinationPath,
        sourceDev: entry.sourceDev,
        sourceIno: entry.sourceIno,
        sourceSize: entry.sourceSize,
      }
      for (const key of ['sourceBirthtimeNs', 'destinationDev', 'destinationIno', 'destinationSize', 'destinationBirthtimeNs']) {
        if (isSerializedIdentity(entry[key])) normalized[key] = entry[key] as string
      }
      if (Boolean(normalized.destinationDev) !== Boolean(normalized.destinationIno)) continue
      if (normalized.destinationDev && !normalized.destinationSize) continue
      const cost = Object.entries(normalized).reduce((total, [key, item]) => total + (key.length + item.length) * 2 + 8, 0)
      if (entries.length >= 8 || estimatedBytes + cost > 32 * 1024) break
      entries.push(normalized)
      estimatedBytes += cost
    }
    out.ownedOutputPublishJournal = entries
  }
  for (const key of ['ownedOutputFiles', 'ownedOutputDirs'] as const) {
    if (!Array.isArray(metadata[key])) continue
    const paths: Array<{ path: string; dev: string; ino: string; size?: string; birthtimeNs?: string }> = []
    let estimatedBytes = 0
    for (const value of metadata[key] as unknown[]) {
      const entry = persistedIdentityEntry(value, key)
      if (!entry) continue
      const cost = Object.entries(entry).reduce((total, [name, item]) => total + (name.length + item.length) * 2 + 8, 0)
      if (paths.length >= 10_000 || estimatedBytes + cost > 4 * 1024 * 1024) break
      paths.push(entry)
      estimatedBytes += cost
    }
    out[key] = paths
  }
  if (metadata.candidate && typeof metadata.candidate === 'object') {
    const c = metadata.candidate as Record<string, unknown>
    if (typeof c.url === 'string' && /^https?:\/\//i.test(c.url)) {
      out.candidate = { url: c.url, formatId: typeof c.formatId === 'string' ? c.formatId : undefined, container: typeof c.container === 'string' ? c.container : undefined, protocol: typeof c.protocol === 'string' ? c.protocol : undefined, mimeType: typeof c.mimeType === 'string' ? c.mimeType : undefined }
    }
  }
  if (Array.isArray(metadata.douyinImageUrls)) out.douyinImageUrls = metadata.douyinImageUrls
  if (Array.isArray(metadata.xhsImageUrls)) out.xhsImageUrls = metadata.xhsImageUrls
  if (typeof metadata.mediaType === 'string' && metadata.mediaType.trim()) {
    out.mediaType = metadata.mediaType.trim()
  }
  if (typeof metadata.referer === 'string' && metadata.referer.trim()) {
    out.referer = metadata.referer.trim()
  }
  if (
    metadata.customHeaders &&
    typeof metadata.customHeaders === 'object' &&
    !Array.isArray(metadata.customHeaders)
  ) {
    const safeHeaders = filterPersistedHeaders(metadata.customHeaders as Record<string, string>)
    if (Object.keys(safeHeaders).length > 0) out.customHeaders = safeHeaders
  }
  if (metadata.douyinProfilePick === true) out.douyinProfilePick = true
  if (typeof metadata.awemeId === 'string') out.awemeId = metadata.awemeId
  if (typeof metadata.douyinMediaType === 'string') out.douyinMediaType = metadata.douyinMediaType
  if (typeof metadata.douyinProfileBatchSize === 'number') {
    out.douyinProfileBatchSize = metadata.douyinProfileBatchSize
  }
  if (typeof metadata.playlistTitle === 'string') out.playlistTitle = metadata.playlistTitle
  if (typeof metadata.ytdlpId === 'string' && metadata.ytdlpId.trim()) {
    out.ytdlpId = metadata.ytdlpId.trim()
  }
  if (typeof metadata.transcodePreset === 'string' && metadata.transcodePreset.trim()) {
    out.transcodePreset = metadata.transcodePreset.trim()
  }
  if (typeof metadata.remoteJobId === 'string' && metadata.remoteJobId.trim()) {
    out.remoteJobId = metadata.remoteJobId.trim()
  }
  if (typeof metadata.remoteOutputDir === 'string' && metadata.remoteOutputDir.trim()) {
    out.remoteOutputDir = metadata.remoteOutputDir.trim()
  }
  if (typeof metadata.outputDir === 'string' && metadata.outputDir.trim()) {
    out.outputDir = metadata.outputDir.trim()
  }
  if (typeof metadata.ownedOutputRoot === 'string' && metadata.ownedOutputRoot.trim()) {
    out.ownedOutputRoot = metadata.ownedOutputRoot.trim()
  }
  if (typeof metadata.proxyUrl === 'string' && metadata.proxyUrl.trim()) {
    out.proxyUrl = metadata.proxyUrl.trim()
  }
  if (typeof metadata.noteTitle === 'string') out.noteTitle = metadata.noteTitle
  if (typeof metadata.noteAuthor === 'string') out.noteAuthor = metadata.noteAuthor
  if (typeof metadata.noteUrl === 'string') out.noteUrl = metadata.noteUrl
  if (typeof metadata.noteDescription === 'string') out.noteDescription = metadata.noteDescription
  if (metadata.noteOnly === true) out.noteOnly = true
  if (metadata.includeNote === true) out.includeNote = true
  if (metadata.skipAdoptExisting === true) out.skipAdoptExisting = true
  return out
}
