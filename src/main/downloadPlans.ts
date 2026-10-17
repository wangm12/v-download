import { allDownloadPlans, readDownloadSelection, readDownloadPlanLibrary, type DownloadSelection, type DownloadSelectionRequest } from '@v-download/shared'
import { isAbsolute, resolve } from 'path'
import * as settings from './settings'
import { validateOutputTemplate } from './outputTemplateModel'
import { selectionKey, type DownloadRequestSnapshot } from './downloadRequestSnapshot'
export { readDownloadRequestSnapshot, selectionKey, admissionIdentity, type DownloadRequestSnapshot } from './downloadRequestSnapshot'

type Request = DownloadSelectionRequest & {
  url: string; format?: string; quality?: string; outputDir?: string; metadata?: Record<string, unknown>
}

/** Sole policy boundary: explicit request > selected plan > default plan > legacy request. */
export function prepareDownloadRequest<T extends Request>(options: T, inherited?: DownloadRequestSnapshot): T & { selectionKey: string | null } {
  const library = readDownloadPlanLibrary(settings.get('downloadPlanLibrary'))
  const planId = options.planId ?? (options.selection || inherited || options.metadata?.remoteJobId ? null : library.defaultId)
  if (options.planId !== undefined && (typeof options.planId !== 'string' || !options.planId)) throw new Error('Invalid download plan ID')
  const plan = planId ? allDownloadPlans(library).find((p) => p.id === planId) : undefined
  if (planId && !plan) throw new Error('The selected download plan no longer exists. Choose another plan.')
  if (options.planRevision !== undefined && (!plan || options.planRevision !== plan.revision)) throw new Error('The download plan changed. Refresh and select it again.')
  const raw = options.selection ?? plan?.selection ?? inherited?.selection
  const metadata = { ...(options.metadata ?? {}) }
  delete metadata.downloadRequest
  if (!raw) return { ...options, metadata, selectionKey: selectionKey(undefined, metadata.sourceContext) }
  const entryIndex = options.entryIndex ?? inherited?.entryIndex
  if (entryIndex !== undefined && (!Number.isInteger(entryIndex) || entryIndex < 1)) throw new Error('Invalid collection entry index')
  const selection = readDownloadSelection(raw)
  if (selection.exact && selection.exact.sourceUrl !== options.url) throw new Error('This exact format belongs to another video. Select its format again.')
  const gallery = metadata.douyinImageUrls || metadata.xhsImageUrls || metadata.douyinMediaType === 'image' || metadata.mediaType === 'note'
  if (gallery) assertGallerySelection(selection)
  const outputDir = options.outputDir ?? plan?.outputDir ?? inherited?.outputDir ?? settings.get('downloadDir')
  if (!isAbsolute(outputDir)) throw new Error('The download plan requires an absolute output folder')
  const filenameTemplate = options.filenameTemplate ?? plan?.filenameTemplate ?? inherited?.filenameTemplate ?? settings.get('filenameTemplate')
  const validTemplate = validateOutputTemplate(filenameTemplate, 'filename')
  if (!validTemplate.ok) throw new Error('Invalid download plan filename template')
  const snapshot: DownloadRequestSnapshot = {
    version: 1, ...(entryIndex !== undefined ? { entryIndex } : {}), selection, ...(plan ? { plan: { id: plan.id, name: plan.name, revision: plan.revision } } : inherited?.plan ? { plan: { ...inherited.plan } } : {}),
    outputDir: resolve(outputDir), filenameTemplate,
    includeNote: options.includeNote ?? plan?.includeNote ?? inherited?.includeNote ?? metadata.includeNote === true,
    archiveByAuthor: inherited?.archiveByAuthor ?? settings.get('archiveByAuthor'),
    folderNameTemplate: inherited?.folderNameTemplate ?? settings.get('folderNameTemplate'),
    playlistSubfolder: inherited?.playlistSubfolder ?? settings.get('playlistSubfolder')
  }
  metadata.downloadRequest = snapshot
  metadata.includeNote = snapshot.includeNote
  metadata.outputDir = snapshot.outputDir
  return { ...options, format: selection.target === 'audio' ? (selection.output === 'original' ? 'audio' : selection.output) : 'video',
    quality: String(selection.target === 'video' ? selection.maxHeight : selection.audioBitrate ?? 'best'),
    outputDir: snapshot.outputDir, metadata, selectionKey: selectionKey(snapshot, metadata.sourceContext) }
}

/** Native site video fallbacks must validate intent too; provider IDs and conversion stay in yt-dlp. */
export function supportsDirectSiteVideoSelection(selection: DownloadSelection | undefined): boolean {
  return !selection || (selection.target === 'video' && !selection.exact && !selection.audioLanguage && selection.postprocess === 'none')
}
export function assertGallerySelection(selection: DownloadSelection | undefined): void {
  if (selection && (selection.target === 'audio' || selection.exact || selection.videoCodec !== 'any' || selection.maxFps !== undefined || selection.dynamicRange !== 'any' || selection.output !== 'original' || selection.postprocess !== 'none')) throw new Error('This media selection requires video or audio. Choose Original archive for image galleries or notes.')
}
