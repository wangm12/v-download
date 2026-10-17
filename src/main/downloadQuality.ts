import { audioLanguageMatches, sourceVideoMatches, type DownloadSelection } from '@v-download/shared'
import { videoFacts, type ProbeStreamFacts } from './probeStreamFacts'
export type DownloadQuality = number | 'best'

/** Keep "best" distinct from a numeric height limit across engine adapters. */
export function normalizeDownloadQuality(value: string | number | undefined): DownloadQuality {
  if (value === 'best') return 'best'
  const height = Number(value)
  return Number.isFinite(height) && height >= 1 ? Math.floor(height) : 1080
}

type ProbeStream = ProbeStreamFacts & { index: number; codec_type: string; bit_rate?: string; tags?: { language?: string } }
type StreamSelection = { ok: true; streamMaps: number[] } | { ok: false; error: string }

/** Select one rendition and its associated audio, never all HLS programs. */
export function selectAdaptiveVideoStreams(metadata: unknown, quality: DownloadQuality, selection?: DownloadSelection): StreamSelection {
  const record = metadata as { streams?: unknown; programs?: unknown } | null
  const streamsFrom = (value: unknown): ProbeStream[] => Array.isArray(value)
    ? value.filter((s): s is ProbeStream => s != null && typeof s === 'object' &&
      Number.isInteger(s.index) && s.index >= 0 && typeof s.codec_type === 'string')
    : []
  if (selection?.exact) return { ok: false, error: 'Exact provider format IDs require the Auto or yt-dlp engine.' }
  const streams = streamsFrom(record?.streams)
  const limit = normalizeDownloadQuality(quality)
  const matchingAudio = (pool: ProbeStream[]) => pool.filter((s) => s.codec_type === 'audio' && (!selection?.audioLanguage || audioLanguageMatches(selection.audioLanguage, s.tags?.language)))
  if (selection?.target === 'audio') {
    const audio = matchingAudio(streams).sort((a, b) => (Number(b.bit_rate) || 0) - (Number(a.bit_rate) || 0))[0]
    return audio ? { ok: true, streamMaps: [audio.index] } : { ok: false, error: 'No audio stream satisfies the selected language.' }
  }
  const videos = streams.filter((s) => s.codec_type === 'video' &&
    typeof s.height === 'number' && s.height > 0 && (selection ? sourceVideoMatches(selection, videoFacts(s)) : (limit === 'best' || s.height <= limit)))
    .sort((a, b) => (b.height! - a.height!) || (Number(b.bit_rate) || 0) - (Number(a.bit_rate) || 0))
  const video = videos[0]
  if (!video) return { ok: false, error: `No video rendition satisfies the selected quality (${limit === 'best' ? 'best' : `${limit}p maximum`}).` }
  const programs = Array.isArray(record?.programs) ? record.programs : []
  const associated = programs.map((p) => streamsFrom(p?.streams))
    .find((group) => group.some((s) => s.index === video.index))
  const audioPool = associated?.some((s) => s.codec_type === 'audio') ? associated : streams
  const audio = matchingAudio(audioPool)
    .sort((a, b) => (Number(b.bit_rate) || 0) - (Number(a.bit_rate) || 0))[0]
  if (selection?.audioLanguage && !audio) return { ok: false, error: 'No audio stream satisfies the selected language.' }
  const subtitles = (associated ?? streams).filter((s) => s.codec_type === 'subtitle')
  return { ok: true, streamMaps: [...new Set([video.index, ...(audio ? [audio.index] : []), ...subtitles.map((s) => s.index)])] }
}
