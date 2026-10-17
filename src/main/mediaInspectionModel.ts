import type { InspectedStream, ManifestResource } from '@v-download/shared'

const positive = (v: unknown): number | undefined => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : undefined
}
const text = (v: unknown): string | undefined => typeof v === 'string' && v ? v.slice(0, 256) : undefined

/** HLS attribute lists contain quoted commas (not CSV or URL query strings). */
function attributes(line: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /(?:^|,)\s*([A-Z0-9-]+)=(?:"([^"\r\n]*)"|([^,\r\n]*))/g
  for (const match of line.matchAll(re)) out[match[1]] = match[2] ?? match[3].trim()
  return out
}

export function hlsResources(body: string, baseUrl: string): { master: boolean; resources: ManifestResource[]; truncated: boolean } {
  const resources: ManifestResource[] = []
  const lines = body.split(/\r?\n/)
  let pending: Record<string, string> | undefined
  let master = false
  let truncated = false
  const add = (uri: string | undefined, relation: ManifestResource['relation'], attrs: Record<string, string>) => {
    if (!uri) return
    let url: URL
    try { url = new URL(uri, baseUrl) } catch { return }
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return
    if (resources.length >= 128) { truncated = true; return }
    const [width, height] = (attrs.RESOLUTION ?? '').split('x').map(positive)
    resources.push({ url: url.href, relation, ...(width && height ? { width, height } : {}),
      ...(positive(attrs['FRAME-RATE']) ? { fps: positive(attrs['FRAME-RATE']) } : {}),
      ...(positive(attrs.BANDWIDTH) ? { bandwidth: positive(attrs.BANDWIDTH) } : {}),
      ...(attrs.CODECS ? { codecs: attrs.CODECS.slice(0, 256) } : {}),
      ...(attrs.LANGUAGE ? { language: attrs.LANGUAGE.slice(0, 64) } : {}),
      ...(attrs.NAME ? { name: attrs.NAME.slice(0, 128) } : {}),
      ...(attrs['GROUP-ID'] ? { group: attrs['GROUP-ID'].slice(0, 128) } : {}) })
  }
  for (const raw of lines) {
    const line = raw.trim()
    if (line.startsWith('#EXT-X-STREAM-INF:')) { master = true; pending = attributes(line.slice(18)); continue }
    if (line.startsWith('#EXT-X-MEDIA:')) {
      master = true
      const attrs = attributes(line.slice(13))
      if (attrs.TYPE === 'AUDIO' || attrs.TYPE === 'SUBTITLES') add(attrs.URI, attrs.TYPE === 'AUDIO' ? 'audio' : 'subtitle', attrs)
    } else if (line && !line.startsWith('#') && pending) { add(line, 'variant', pending); pending = undefined }
  }
  return { master, resources, truncated }
}

export function inspectedProbeFacts(raw: unknown): { streams: InspectedStream[]; duration?: number; truncated: boolean } {
  if (!raw || typeof raw !== 'object') return { streams: [], truncated: false }
  const data = raw as { streams?: Array<Record<string, unknown>>; format?: { duration?: unknown } }
  const all = Array.isArray(data.streams) ? data.streams : []
  const streams: InspectedStream[] = []
  for (const s of all.slice(0, 64)) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) continue
    if (!['video', 'audio', 'subtitle'].includes(String(s.codec_type))) continue
    const rate = String(s.avg_frame_rate ?? s.r_frame_rate ?? '').split('/').map(Number)
    const fps = rate.length === 2 ? positive(rate[0] / rate[1]) : positive(rate[0])
    const tags = s.tags as { language?: unknown } | undefined
    streams.push({ index: Number(s.index) || 0, kind: s.codec_type as InspectedStream['kind'],
      ...(text(s.codec_name) ? { codec: text(s.codec_name) } : {}),
      ...(positive(s.width) ? { width: positive(s.width) } : {}), ...(positive(s.height) ? { height: positive(s.height) } : {}),
      ...(fps ? { fps } : {}), ...(text(tags?.language) ? { language: text(tags?.language) } : {}) })
  }
  return { streams, ...(positive(data.format?.duration) ? { duration: positive(data.format?.duration) } : {}), truncated: all.length > 64 }
}
