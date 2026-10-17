import { videoFacts } from './probeStreamFacts'
import { basename, dirname, extname, join } from 'path'
import { mkdir } from 'fs/promises'
import { audioLanguageMatches, sourceVideoMatches, type DownloadSelection } from '@v-download/shared'
import { probeMediaMetadata } from './ffprobe'
import { ffprobeExecutable } from './ffmpegDownload'
import * as settings from './settings'
import { transcodeFile } from './transcodeManager'

type Stream = { index: number; codec_type: string; codec_name?: string; height?: number; avg_frame_rate?: string; r_frame_rate?: string; color_transfer?: string; tags?: { language?: string } }
async function probe(path: string, signal?: AbortSignal): Promise<Stream[]> {
  const result = await probeMediaMetadata(ffprobeExecutable(settings.get('ffmpegPath')), [
    '-v', 'error', '-show_entries', 'stream=index,codec_type,codec_name,height,avg_frame_rate,r_frame_rate,color_transfer:stream_tags=language', '-of', 'json', path
  ], { stdio: ['ignore','pipe','pipe'], env: process.env, detached: process.platform !== 'win32' }, signal)
  if (!result.ok) throw signal?.aborted ? new DOMException('Selection validation cancelled', 'AbortError') : new Error(result.error)
  const streams = (result.metadata as { streams?: Stream[] } | null)?.streams
  if (!Array.isArray(streams)) throw new Error('The output has no readable media streams')
  return streams
}
/** Run before owned publication, for single and multi-output tasks alike. */
export async function prepareSelectedOutput(inputPath: string, selection: DownloadSelection | undefined, signal?: AbortSignal, onConverting?: () => void): Promise<string> {
  if (!selection) return inputPath
  if (signal?.aborted) throw new DOMException('Selection validation cancelled', 'AbortError')
  const streams = await probe(inputPath, signal)
  const videos = streams.filter((s) => s.codec_type === 'video')
  const audios = streams.filter((s) => s.codec_type === 'audio')
  if (selection.target === 'video') {
    if (!videos.some((s) => sourceVideoMatches(selection, videoFacts(s)))) {
      const requested = [selection.maxHeight === 'best' ? 'best height' : `height ≤ ${selection.maxHeight}p`, selection.videoCodec !== 'any' ? selection.videoCodec : '', selection.maxFps ? `FPS ≤ ${selection.maxFps}` : '', selection.dynamicRange !== 'any' ? selection.dynamicRange.toUpperCase() : ''].filter(Boolean).join(', ')
      const observed = videos.map((stream) => { const facts = videoFacts(stream); return `${facts.height ?? 'unknown'}p / ${facts.codec ?? 'unknown codec'} / ${facts.fps ?? 'unknown'} FPS / ${facts.dynamicRange?.toUpperCase() ?? 'unknown HDR'}` }).join('; ') || 'no video streams'
      throw new Error(`Source selection not satisfied. Requested: ${requested}. Observed: ${observed}.`)
    }
  } else if (videos.length || !audios.length) throw new Error('The requested audio-only output contains no audio or still contains video')
  if (selection.audioLanguage && !audios.some((s) => audioLanguageMatches(selection.audioLanguage!, s.tags?.language))) throw new Error(`The output cannot verify requested audio language ${selection.audioLanguage}. Available tags: ${audios.map((s) => s.tags?.language ?? 'unknown').join(', ') || 'none'}.`)
  if (selection.target === 'audio' && selection.output !== 'original') {
    const codec = { mp3: 'mp3', m4a: 'aac', opus: 'opus', mp4: '' }[selection.output]
    if (!audios.some((s) => s.codec_name === codec)) throw new Error(`The output does not contain the requested ${selection.output} audio codec`)
  }
  if (selection.postprocess !== 'h264-mp4') return inputPath
  const destination = join(dirname(inputPath), '.conversion', `${basename(inputPath.replace(/\.part$/i,''), extname(inputPath.replace(/\.part$/i,'')))}.mp4`)
  await mkdir(dirname(destination), { recursive: true })
  onConverting?.()
  await transcodeFile({ inputPath, outputPath: destination, preset: 'mp4', signal })
  const converted = await probe(destination, signal)
  if (!converted.some((s) => s.codec_type === 'video' && s.codec_name === 'h264') ||
    (audios.length > 0 && !converted.some((s) => s.codec_type === 'audio' && s.codec_name === 'aac')) ||
    converted.filter((s) => s.codec_type === 'subtitle').length !== streams.filter((s) => s.codec_type === 'subtitle').length) throw new Error('The compatibility conversion did not preserve the expected media tracks')
  return destination
}
