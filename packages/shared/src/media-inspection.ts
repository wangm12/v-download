/** Facts from a user-requested inspection; missing fields remain unknown. */
export interface InspectedStream {
  index: number
  kind: 'video' | 'audio' | 'subtitle'
  codec?: string
  width?: number
  height?: number
  fps?: number
  language?: string
}
export interface ManifestResource {
  url: string
  relation: 'variant' | 'audio' | 'subtitle'
  width?: number
  height?: number
  fps?: number
  bandwidth?: number
  codecs?: string
  language?: string
  name?: string
  group?: string
}
export interface MediaInspection {
  version: 1
  inspectedAt: string
  url: string
  kind: 'hls-master' | 'hls-media' | 'dash' | 'file' | 'unknown'
  duration?: number
  streams: InspectedStream[]
  resources: ManifestResource[]
  warnings: string[]
}
export interface MediaCaptureCommand {
  requestId: string
  pageUrl: string
  title: string
  planName?: string
  expiresAt: number
  exactSource: boolean
}
