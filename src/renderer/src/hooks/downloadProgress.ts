import { readDownloadSelection, readMediaSourceContext } from '@v-download/shared'
import type { Download, DownloadStatus } from '@/types'

/** Only merge IPC fields that are actually present — never wipe title/thumbnail with undefined. */
export function progressPatchFromIpc(data: Record<string, unknown>): Partial<Download> {
  const patch: Partial<Download> = {}
  if (data.mediaUrl === null || typeof data.mediaUrl === 'string') patch.mediaUrl = data.mediaUrl
  if (data.recaptureAt === null || typeof data.recaptureAt === 'string') patch.recaptureAt = data.recaptureAt
  if (data.sourceContext === null) patch.sourceContext = null
  else if (data.sourceContext !== undefined) { try { patch.sourceContext = readMediaSourceContext(data.sourceContext) } catch { /* Ignore malformed source claims. */ } }
  if (data.selection === null) patch.selection = null
  else if (data.selection !== undefined) { try { patch.selection = readDownloadSelection(data.selection) } catch { /* Ignore malformed optional selection fields. */ } }
  if (data.planName === null || typeof data.planName === 'string') patch.planName = data.planName
  if (data.planId === null || typeof data.planId === 'string') patch.planId = data.planId
  if (data.outputDir === null || typeof data.outputDir === 'string') patch.outputDir = data.outputDir
  if (typeof data.progress === 'number') patch.progress = data.progress
  if (typeof data.status === 'string') patch.status = data.status as DownloadStatus
  if (typeof data.format === 'string') patch.format = data.format
  if (typeof data.quality === 'string') patch.quality = data.quality
  if ('speed' in data) patch.speed = (data.speed as string) || null
  if ('eta' in data) patch.eta = (data.eta as string) || null
  if ('totalSize' in data) patch.totalSize = (data.totalSize as string) || null
  if ('phase' in data) patch.phase = (data.phase as string) || null
  const filePath = 'filePath' in data ? data.filePath : data.file_path
  if (filePath === null || typeof filePath === 'string') patch.file_path = filePath
  if (typeof data.title === 'string' && data.title.trim()) patch.title = data.title
  if (data.thumbnail === null || typeof data.thumbnail === 'string') patch.thumbnail = data.thumbnail
  if (data.duration === null || typeof data.duration === 'number') patch.duration = data.duration
  if (data.channel === null || typeof data.channel === 'string') patch.channel = data.channel
  if (data.error === null || typeof data.error === 'string') patch.error = data.error
  if ('errorCode' in data || 'error_code' in data) patch.error_code = (data.errorCode ?? data.error_code ?? null) as Download['error_code']
  return patch
}
