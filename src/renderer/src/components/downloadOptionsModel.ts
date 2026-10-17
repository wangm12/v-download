import {
  allDownloadPlans, defaultDownloadSelection, EMPTY_DOWNLOAD_PLAN_LIBRARY, reusableSelection,
  canonicalVideoCodec, type DownloadPlan, type DownloadSelection, type DownloadSelectionRequest
} from '@v-download/shared'
import type { SettingsData, VideoInfo } from '@/types'

export interface DownloadOptionsDraft extends DownloadSelectionRequest {
  selection: DownloadSelection
  outputDir: string
  filenameTemplate: string
  includeNote: boolean
}
export function legacyDownloadDraft(settings: SettingsData): DownloadOptionsDraft {
  return { selection: defaultDownloadSelection(settings.defaultVideoQuality === 'best' ? 'best' : Number(settings.defaultVideoQuality) || 1080),
    outputDir: settings.downloadDir, filenameTemplate: settings.filenameTemplate || '{title} [{id}]', includeNote: true }
}
export function draftFromPlan(plan: DownloadPlan, settings: SettingsData): DownloadOptionsDraft {
  return { selection: reusableSelection(plan.selection), planId: plan.id, planRevision: plan.revision,
    outputDir: plan.outputDir ?? settings.downloadDir, filenameTemplate: plan.filenameTemplate ?? settings.filenameTemplate ?? '{title} [{id}]', includeNote: plan.includeNote }
}
export function initialDownloadDraft(settings: SettingsData): DownloadOptionsDraft {
  const library = settings.downloadPlanLibrary ?? EMPTY_DOWNLOAD_PLAN_LIBRARY
  const plan = allDownloadPlans(library).find((p) => p.id === library.defaultId)
  return plan ? draftFromPlan(plan, settings) : legacyDownloadDraft(settings)
}
export function exactFormatSelection(selection: DownloadSelection, format: NonNullable<VideoInfo['formats']>[number], sourceUrl: string): DownloadSelection {
  if (!format.format_id || ['best','best-audio'].includes(format.format_id)) return reusableSelection(selection)
  const kind = selection.target === 'audio' ? 'audio' : format.acodec && format.acodec !== 'none' ? 'muxed' : 'video'
  const codec = canonicalVideoCodec(format.vcodec)
  return { ...selection,
    ...(selection.target === 'video' ? { maxHeight: format.height ?? selection.maxHeight, videoCodec: codec === 'unknown' ? 'any' : codec,
      ...(format.fps ? { maxFps: format.fps } : {}) } : {}),
    ...(selection.target === 'audio' && format.language ? { audioLanguage: format.language } : {}),
    exact: { sourceUrl, formatId: format.format_id, kind } }
}
