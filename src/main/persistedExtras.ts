import { filterPersistedHeaders } from './mediaResolver'

export function pickPersistedExtras(metadata?: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!metadata) return out
  if (metadata.infoResolve === true) out.infoResolve = true
  if (metadata.resolveAutoStart === true) out.resolveAutoStart = true
  if (typeof metadata.resolveTitle === 'string' && metadata.resolveTitle.trim()) out.resolveTitle = metadata.resolveTitle.trim()
  if (metadata.nativeYoutubePlaylist === true) out.nativeYoutubePlaylist = true
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
