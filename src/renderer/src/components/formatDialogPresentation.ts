import type { VideoInfo } from '@/types'

export type PresentationKind = 'video' | 'audio' | 'other'
export type PresentationCandidate = NonNullable<VideoInfo['formats']>[number] & {
  kind: PresentationKind
  quality: number
  key: string
  recommended: boolean
}

export function safeQuality(value: string | undefined, fallback: string): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : Number(fallback) || 1080
}

function isAudio(format: NonNullable<VideoInfo['formats']>[number]) {
  return Boolean(format.acodec && format.acodec !== 'none' && (!format.vcodec || format.vcodec === 'none')) ||
    Boolean(format.abr || format.bitrate) && (!format.vcodec || format.vcodec === 'none')
}

export function hasOtherFormats(formats: VideoInfo['formats'] = []) {
  // Renderer-only format data has no safe callback contract for non-media rows.
  // Keep unsupported/ext-only candidates out of the tab rather than rendering an empty panel.
  return false
}

export function fallbackQuality(kind: 'video' | 'audio', defaultQuality: string, siteRule?: { format: 'best' | 'video' | 'audio'; quality: string }) {
  return safeQuality(siteRule && (siteRule.format === kind || siteRule.format === 'best') ? siteRule.quality : undefined, defaultQuality)
}

function candidateKey(format: NonNullable<VideoInfo['formats']>[number], kind: PresentationKind) {
  return [kind, format.height || '', format.width || '', format.abr || format.bitrate || format.tbr || '', format.ext || format.container || '', format.vcodec || '', format.acodec || ''].join('|')
}

export function getPresentationCandidates(
  formats: VideoInfo['formats'] = [],
  kind: PresentationKind,
  defaultQuality: string,
  siteRule?: { format: 'best' | 'video' | 'audio'; quality: string }
): PresentationCandidate[] {
  const merged = new Map<string, PresentationCandidate>()
  for (const format of formats.filter((item) => item.height || item.abr || item.bitrate || item.tbr || item.ext || item.container)) {
    const formatKind = isAudio(format) ? 'audio' : format.height || format.vcodec || format.acodec ? 'video' : 'other'
    if (formatKind !== kind) continue
    const quality = kind === 'audio'
      ? Math.round(format.abr ?? format.bitrate ?? format.tbr ?? safeQuality(defaultQuality, defaultQuality))
      : format.height ?? safeQuality(defaultQuality, defaultQuality)
    const key = candidateKey(format, kind)
    const existing = merged.get(key)
    const existingIsExact = Boolean(existing?.filesize && existing.filesize > 0)
    const formatIsExact = Boolean(format.filesize && format.filesize > 0)
    if (!existing || (formatIsExact && !existingIsExact) || (formatIsExact === existingIsExact && (format.filesize ?? format.filesize_approx ?? 0) > (existing.filesize ?? existing.filesize_approx ?? 0))) {
      merged.set(key, { ...format, kind, quality, key, recommended: false })
    }
  }
  const result = [...merged.values()].sort((a, b) => b.quality - a.quality || a.key.localeCompare(b.key))
  const preferred = siteRule && (siteRule.format === kind || siteRule.format === 'best') ? safeQuality(siteRule.quality, defaultQuality) : safeQuality(defaultQuality, defaultQuality)
  let best = result.find((candidate) => candidate.quality === preferred)
  if (!best) best = result.reduce<PresentationCandidate | undefined>((closest, candidate) => !closest || Math.abs(candidate.quality - preferred) < Math.abs(closest.quality - preferred) ? candidate : closest, undefined)
  return result.map((candidate) => ({ ...candidate, recommended: candidate.key === best?.key }))
}

export function formatAccessibleDownloadLabel(candidate: Pick<PresentationCandidate, 'kind' | 'quality'>, container: string) {
  return `Download ${candidate.kind === 'audio' ? `${candidate.quality} kbps` : `${candidate.quality}p`} ${container}`
}

export function getDefaultSelectedKey(candidates: Array<Pick<PresentationCandidate, 'key' | 'recommended'>>): string | null {
  return candidates.find((candidate) => candidate.recommended)?.key ?? candidates[0]?.key ?? null
}

export const INCLUDE_NOTE_CHECKBOX_LABEL = 'Save caption as Markdown'
export const DEFAULT_INCLUDE_NOTE = true

export function shouldPromptFormatDialog(options: { autoStart?: boolean }): boolean {
  return options.autoStart !== true
}
