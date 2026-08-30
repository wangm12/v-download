import { basename, dirname, extname, join, parse } from 'node:path'

export type TranscodePresetId = 'mp3' | 'aac' | 'opus' | 'flac' | 'wav' | 'mp4' | 'h265' | 'vp9'

export interface TranscodePreset {
  id: TranscodePresetId
  label: string
  description: string
  extension: string
  args: string[]
}

export const TRANSCODE_PRESETS: readonly TranscodePreset[] = [
  {
    id: 'mp3',
    label: 'Extract MP3',
    description: 'Audio only, high-quality MP3',
    extension: 'mp3',
    args: ['-vn', '-c:a', 'libmp3lame', '-q:a', '0'],
  },
  {
    id: 'aac',
    label: 'Extract AAC',
    description: 'Audio only, AAC in an M4A container',
    extension: 'm4a',
    args: ['-vn', '-c:a', 'aac', '-b:a', '256k'],
  },
  {
    id: 'opus',
    label: 'Extract Opus',
    description: 'Audio only, efficient Opus in a WebM container',
    extension: 'webm',
    args: ['-vn', '-c:a', 'libopus', '-b:a', '160k'],
  },
  {
    id: 'flac',
    label: 'Extract FLAC',
    description: 'Audio only, lossless FLAC',
    extension: 'flac',
    args: ['-vn', '-c:a', 'flac'],
  },
  {
    id: 'wav',
    label: 'Extract WAV',
    description: 'Audio only, uncompressed PCM',
    extension: 'wav',
    args: ['-vn', '-c:a', 'pcm_s16le'],
  },
  {
    id: 'mp4',
    label: 'H.264 MP4',
    description: 'Broadly compatible H.264 video with AAC audio',
    extension: 'mp4',
    args: ['-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'],
  },
  {
    id: 'h265',
    label: 'H.265 MP4',
    description: 'Smaller H.265 video with AAC audio',
    extension: 'mp4',
    args: ['-c:v', 'libx265', '-preset', 'medium', '-crf', '26', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'],
  },
  {
    id: 'vp9',
    label: 'VP9 WebM',
    description: 'Open VP9 video with Opus audio',
    extension: 'webm',
    args: ['-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-c:a', 'libopus', '-b:a', '160k'],
  },
]

const PRESETS = new Map(TRANSCODE_PRESETS.map((preset) => [preset.id, preset]))

export function getTranscodePreset(id: TranscodePresetId): TranscodePreset {
  const preset = PRESETS.get(id)
  if (!preset) throw new Error(`Unknown transcode preset: ${id}`)
  return preset
}

export function buildTranscodeArgs(inputPath: string, outputPath: string, id: TranscodePresetId): string[] {
  const preset = getTranscodePreset(id)
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    inputPath,
    '-map_metadata',
    '0',
    ...preset.args,
    outputPath,
  ]
}

export function createTranscodeOutputPath(inputPath: string, id: TranscodePresetId, existingPaths: ReadonlySet<string> = new Set()): string {
  const preset = getTranscodePreset(id)
  const parsed = parse(inputPath)
  const baseName = parsed.name || basename(inputPath, extname(inputPath)) || 'output'
  const suffix = `.transcoded`
  const first = join(dirname(inputPath), `${baseName}${suffix}.${preset.extension}`)
  if (!existingPaths.has(first)) return first

  for (let index = 1; index < 10_000; index++) {
    const candidate = join(dirname(inputPath), `${baseName}${suffix}-${index}.${preset.extension}`)
    if (!existingPaths.has(candidate)) return candidate
  }
  throw new Error('Could not create a unique transcode output path')
}
