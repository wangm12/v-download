/** Versioned output intent shared by desktop, collections and the extension. */
export interface DownloadSelection {
  version: 1
  target: 'video' | 'audio'
  maxHeight: number | 'best'
  videoCodec: 'any' | 'h264' | 'hevc' | 'vp9' | 'av1'
  maxFps?: number
  dynamicRange: 'any' | 'sdr' | 'hdr'
  audioLanguage?: string
  output: 'original' | 'mp4' | 'mp3' | 'm4a' | 'opus'
  audioBitrate?: number
  postprocess: 'none' | 'h264-mp4'
  /** Provider IDs are scoped to this URL, never copied into reusable plans. */
  exact?: { sourceUrl: string; formatId: string; kind: 'muxed' | 'video' | 'audio'; audioFormatId?: string }
}
export interface DownloadPlan {
  id: string
  name: string
  revision: number
  selection: DownloadSelection
  outputDir?: string
  filenameTemplate?: string
  includeNote: boolean
}
export interface DownloadPlanLibrary { version: 1; defaultId: string | null; custom: DownloadPlan[] }
export interface DownloadSelectionRequest {
  /** One original collection position, not the current filtered UI position. */
  entryIndex?: number
  selection?: DownloadSelection
  planId?: string
  planRevision?: number
  filenameTemplate?: string
  includeNote?: boolean
}

const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Expected a download selection object')
  return v as Record<string, unknown>
}
function onlyKeys(v: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(v).some((key) => !keys.includes(key))) throw new Error('Unknown download selection field')
}
function choice<T extends string>(value: unknown, choices: readonly T[]): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) throw new Error('Invalid download selection option')
  return value as T
}
function positive(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error('Expected a positive download selection number')
  return value
}
const formatId = (v: unknown): string => {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_.:-]+$/.test(v)) throw new Error('Invalid provider format ID')
  return v
}
export function readDownloadSelection(value: unknown): DownloadSelection {
  const v = object(value)
  onlyKeys(v, ['version','target','maxHeight','videoCodec','maxFps','dynamicRange','audioLanguage','output','audioBitrate','postprocess','exact'])
  if (v.version !== 1) throw new Error('Unsupported download selection version')
  const target = choice(v.target, ['video','audio'])
  const maxHeight = v.maxHeight === 'best' ? 'best' : positive(v.maxHeight)
  if (maxHeight !== 'best' && !Number.isInteger(maxHeight)) throw new Error('Video height must be an integer')
  const output = choice(v.output, ['original','mp4','mp3','m4a','opus'])
  const postprocess = choice(v.postprocess, ['none','h264-mp4'])
  if (target === 'video' && !['original','mp4'].includes(output)) throw new Error('Video selection requires a video output')
  if (target === 'audio' && (output === 'mp4' || postprocess !== 'none')) throw new Error('Audio selection requires an audio output')
  if (postprocess === 'h264-mp4' && output !== 'mp4') throw new Error('H.264 conversion requires MP4 output')
  const dynamicRange = choice(v.dynamicRange, ['any','sdr','hdr'])
  if (postprocess === 'h264-mp4' && dynamicRange === 'hdr') throw new Error('HDR preservation cannot be combined with the H.264 compatibility conversion')
  const result: DownloadSelection = {
    version: 1, target, maxHeight, videoCodec: choice(v.videoCodec, ['any','h264','hevc','vp9','av1']),
    ...(v.maxFps !== undefined ? { maxFps: positive(v.maxFps) } : {}), dynamicRange,
    ...(v.audioLanguage !== undefined ? { audioLanguage: choiceLanguage(v.audioLanguage) } : {}),
    output, ...(v.audioBitrate !== undefined ? { audioBitrate: positive(v.audioBitrate) } : {}), postprocess
  }
  if (target === 'audio') { result.maxHeight = 'best'; result.videoCodec = 'any'; result.dynamicRange = 'any'; delete result.maxFps }
  else delete result.audioBitrate
  if (target === 'audio' && output === 'original') delete result.audioBitrate
  if (result.audioBitrate !== undefined && (!Number.isInteger(result.audioBitrate) || result.audioBitrate > (output === 'mp3' ? 320 : 512))) throw new Error('Unsupported audio bitrate')
  if (v.exact !== undefined) {
    const e = object(v.exact)
    onlyKeys(e, ['sourceUrl','formatId','kind','audioFormatId'])
    if (typeof e.sourceUrl !== 'string' || !/^https?:$/.test(new URL(e.sourceUrl).protocol)) throw new Error('Exact selection requires its source URL')
    const kind = choice(e.kind, ['muxed','video','audio'])
    if ((target === 'audio') !== (kind === 'audio')) throw new Error('Exact format does not match the selected media target')
    if (kind !== 'video' && e.audioFormatId !== undefined) throw new Error('Only separate video formats can select a companion audio format')
    result.exact = { sourceUrl: e.sourceUrl, formatId: formatId(e.formatId), kind,
      ...(e.audioFormatId !== undefined ? { audioFormatId: formatId(e.audioFormatId) } : {}) }
  }
  return result
}
function choiceLanguage(v: unknown): string {
  if (typeof v !== 'string' || !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]+)*$/.test(v)) throw new Error('Invalid audio language')
  return v.toLowerCase()
}
export function defaultDownloadSelection(maxHeight: number | 'best' = 1080): DownloadSelection {
  return { version: 1, target: 'video', maxHeight, videoCodec: 'any', dynamicRange: 'any', output: 'original', postprocess: 'none' }
}
export function reusableSelection(selection: DownloadSelection): DownloadSelection {
  const { exact: _exact, ...policy } = readDownloadSelection(selection)
  return policy
}
export const BUILTIN_DOWNLOAD_PLANS: readonly DownloadPlan[] = [
  { id: 'builtin:archive', name: 'Original archive', revision: 1, selection: defaultDownloadSelection('best'), includeNote: true },
  { id: 'builtin:compatible', name: 'Compatible MP4', revision: 1, selection: { ...defaultDownloadSelection(1080), output: 'mp4', postprocess: 'h264-mp4' }, includeNote: true },
  { id: 'builtin:audio', name: 'Audio only', revision: 1, selection: { ...defaultDownloadSelection('best'), target: 'audio', output: 'mp3', audioBitrate: 192 }, includeNote: false }
]
export const EMPTY_DOWNLOAD_PLAN_LIBRARY: DownloadPlanLibrary = { version: 1, defaultId: null, custom: [] }
export function readDownloadPlan(value: unknown): DownloadPlan {
  const v = object(value)
  onlyKeys(v, ['id','name','revision','selection','outputDir','filenameTemplate','includeNote'])
  if (typeof v.id !== 'string' || !/^[A-Za-z0-9:_-]+$/.test(v.id) || typeof v.name !== 'string' || !v.name.trim()) throw new Error('A download plan needs an ID and name')
  if (!Number.isInteger(v.revision) || Number(v.revision) < 1 || typeof v.includeNote !== 'boolean') throw new Error('Invalid download plan revision or note option')
  const selection = readDownloadSelection(v.selection)
  if (selection.exact) throw new Error('Reusable plans cannot contain video-specific format IDs')
  for (const key of ['outputDir','filenameTemplate']) {
    if (v[key] !== undefined && (typeof v[key] !== 'string' || !(v[key] as string).trim() || (v[key] as string).includes('\0'))) throw new Error('Invalid download plan output option')
  }
  return { id: v.id, name: v.name.trim(), revision: Number(v.revision), selection,
    ...(v.outputDir !== undefined ? { outputDir: (v.outputDir as string).trim() } : {}),
    ...(v.filenameTemplate !== undefined ? { filenameTemplate: (v.filenameTemplate as string).trim() } : {}), includeNote: v.includeNote }
}
export function readDownloadPlanLibrary(value: unknown): DownloadPlanLibrary {
  const v = object(value)
  onlyKeys(v, ['version','defaultId','custom'])
  if (v.version !== 1 || !Array.isArray(v.custom) || (v.defaultId !== null && typeof v.defaultId !== 'string')) throw new Error('Invalid download plan library')
  const custom = v.custom.map(readDownloadPlan)
  if (custom.some((p) => p.id.startsWith('builtin:')) || new Set(custom.map((p) => p.id)).size !== custom.length) throw new Error('Duplicate or reserved download plan ID')
  const defaultId = v.defaultId as string | null
  if (defaultId !== null && ![...BUILTIN_DOWNLOAD_PLANS, ...custom].some((p) => p.id === defaultId)) throw new Error('Default download plan no longer exists')
  return { version: 1, defaultId, custom }
}
export function allDownloadPlans(library: DownloadPlanLibrary): DownloadPlan[] {
  return [...BUILTIN_DOWNLOAD_PLANS, ...library.custom].map((p) => readDownloadPlan(p))
}
/** Match a source format without baking provider IDs into a reusable policy. */
export function selectionFormatFilter(s: DownloadSelection, kind: 'video' | 'audio'): string {
  if (kind === 'audio') return s.audioLanguage ? `[language~="(?i)^${languagePattern(s.audioLanguage)}(?:-|$)"]` : ''
  // Missing provider codec facts may be verified from the downloaded stream before publication.
  // Known incompatible codecs still fail this filter; sourceVideoMatches remains strict.
  const codec = { any: '', h264: '[vcodec~=?"^(avc|h264)"]', hevc: '[vcodec~=?"^(hev|hvc|hevc|h265)"]', vp9: '[vcodec~=?"^(vp9|vp09)"]', av1: '[vcodec~=?"^(av01|av1)"]' }[s.videoCodec]
  return (s.maxHeight === 'best' ? '' : `[height<=?${s.maxHeight}]`) + codec +
    (s.maxFps ? `[fps<=?${s.maxFps}]` : '') +
    (s.dynamicRange === 'sdr' ? '[dynamic_range=SDR]' : s.dynamicRange === 'hdr' ? '[dynamic_range!=SDR][dynamic_range!=none]' : '')
}
export function selectionFormatSelector(selection: DownloadSelection): string {
  const s = readDownloadSelection(selection)
  const audio = `ba${selectionFormatFilter(s, 'audio')}`
  const exactId = (id: string) => `all[format_id="${id}"]`
  if (s.exact) return exactId(s.exact.formatId) + (s.exact.kind === 'video' ? `+${s.exact.audioFormatId ? exactId(s.exact.audioFormatId) : audio}` : '')
  if (s.target === 'audio') return `${audio}/b${selectionFormatFilter(s, 'audio')}`
  const video = selectionFormatFilter(s, 'video')
  return `bv${video}+${audio}/b${video}${selectionFormatFilter(s, 'audio')}`
}

export type DownloadPlanMutation =
  | { action: 'save'; plan: DownloadPlan; expectedRevision: number }
  | { action: 'delete'; id: string; expectedRevision: number }
  | { action: 'default'; id: string | null }

export function mutateDownloadPlanLibrary(library: DownloadPlanLibrary, mutation: DownloadPlanMutation): DownloadPlanLibrary {
  const next = readDownloadPlanLibrary(library)
  if (!mutation || typeof mutation !== 'object') throw new Error('Invalid download plan operation')
  if (mutation.action === 'default') next.defaultId = mutation.id
  else if (mutation.action === 'save' || mutation.action === 'delete') {
    const id = mutation.action === 'save' ? mutation.plan?.id : mutation.id
    if (typeof id !== 'string' || id.startsWith('builtin:')) throw new Error('Built-in download plans cannot be edited')
    const previous = next.custom.find((p) => p.id === id)
    if (!Number.isInteger(mutation.expectedRevision) || mutation.expectedRevision < 0 || (previous?.revision ?? 0) !== mutation.expectedRevision) throw new Error('The download plan changed. Refresh before saving.')
    if (mutation.action === 'delete') {
      if (!previous) throw new Error('Download plan not found')
      next.custom = next.custom.filter((p) => p.id !== id)
      if (next.defaultId === id) next.defaultId = null
    } else {
      const plan = readDownloadPlan({ ...mutation.plan, revision: mutation.expectedRevision + 1 })
      next.custom = [...next.custom.filter((p) => p.id !== id), plan]
    }
  } else throw new Error('Unknown download plan operation')
  return readDownloadPlanLibrary(next)
}

export function canonicalVideoCodec(value: string | undefined): DownloadSelection['videoCodec'] | 'unknown' {
  if (/^(avc|h264)/i.test(value ?? '')) return 'h264'
  if (/^(hev|hvc|h265)/i.test(value ?? '')) return 'hevc'
  if (/^(vp9|vp09)/i.test(value ?? '')) return 'vp9'
  if (/^(av01|av1)/i.test(value ?? '')) return 'av1'
  return 'unknown'
}
export interface SourceVideoFacts { height?: number; fps?: number; codec?: string; dynamicRange?: 'sdr' | 'hdr' }
export function sourceVideoMatches(selection: DownloadSelection, facts: SourceVideoFacts): boolean {
  return (selection.maxHeight === 'best' || (facts.height !== undefined && facts.height <= selection.maxHeight)) &&
    (selection.videoCodec === 'any' || canonicalVideoCodec(facts.codec) === selection.videoCodec) &&
    (selection.maxFps === undefined || (facts.fps !== undefined && facts.fps <= selection.maxFps + 0.01)) &&
    (selection.dynamicRange === 'any' || facts.dynamicRange === selection.dynamicRange)
}

/** Provider BCP-47 tags and ffprobe ISO-639 tags describe the same language. */
const languageAliases: readonly string[][] = [['en','eng'],['zh','zho','chi'],['ja','jpn']]
function languagePattern(language: string): string {
  const [base, ...region] = language.toLowerCase().split('-')
  const aliases = languageAliases.find((group) => group.includes(base)) ?? [base]
  return `(?:${aliases.join('|')})${region.length ? '-' + region.join('-') : ''}`
}
export function audioLanguageMatches(requested: string, actual: string | undefined): boolean {
  return typeof actual === 'string' && new RegExp(`^${languagePattern(requested)}(?:-|$)`, 'i').test(actual)
}
