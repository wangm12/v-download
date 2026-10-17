export interface ProbeStreamFacts {
  height?: number; codec_name?: string; avg_frame_rate?: string; r_frame_rate?: string; color_transfer?: string
}
export function frameRate(value: string | undefined): number | undefined {
  const [n, d = '1'] = (value ?? '').split('/')
  const fps = Number(n) / Number(d)
  return Number.isFinite(fps) && fps > 0 ? fps : undefined
}
export function videoFacts(stream: ProbeStreamFacts) {
  return { height: stream.height, fps: frameRate(stream.avg_frame_rate) ?? frameRate(stream.r_frame_rate), codec: stream.codec_name,
    dynamicRange: /^(smpte2084|arib-std-b67)$/.test(stream.color_transfer ?? '') ? 'hdr' as const :
      /^(bt709|gamma22|gamma28|smpte170m|smpte240m|linear|log|log_sqrt|iec61966-2-4|bt1361e|iec61966-2-1|bt2020-10|bt2020-12)$/.test(stream.color_transfer ?? '') ? 'sdr' as const : undefined }
}
