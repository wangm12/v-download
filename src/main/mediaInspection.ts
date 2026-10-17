import type { MediaInspection, MediaSourceContext } from '@v-download/shared'
import { fetchWithTimeout, readResponseText } from './httpClient'
import { probeMediaMetadata } from './ffprobe'
import { directMediaHeaders, ffprobeExecutable } from './ffmpegDownload'
import { hlsResources, inspectedProbeFacts } from './mediaInspectionModel'
import { classifyResolverError, isAdaptiveMediaInput, sanitizeResolverError } from './mediaResolver'
import * as settings from './settings'

export interface CapturedMediaInput {
  url: string
  type?: string
  referer?: string
  headers?: Record<string, string>
  sourceContext?: MediaSourceContext
  /** Internal task override; extension requests cannot set a proxy. */
  proxyUrl?: string
}
let activeInspections = 0

/** Explicit user action only. No cache of expiring URLs or authentication facts. */
export async function inspectCapturedMedia(input: CapturedMediaInput, signal?: AbortSignal): Promise<MediaInspection> {
  if (activeInspections >= 2) throw new Error('Two media inspections are already running. Try again shortly.')
  activeInspections++
  try {
    const result: MediaInspection = { version: 1, inspectedAt: new Date().toISOString(), url: input.url,
      kind: isAdaptiveMediaInput(input.type, input.url) || !input.type ? 'unknown' : 'file', streams: [], resources: [], warnings: [] }
    const headers = directMediaHeaders(input.referer, input.headers)
    const proxyUrl = input.proxyUrl ?? settings.get('proxyUrl')
    if (isAdaptiveMediaInput(input.type, input.url)) {
      const response = await fetchWithTimeout(input.url, { headers, signal }, { timeoutMs: 8000, proxyUrl })
      if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}: ${classifyResolverError(`HTTP ${response.status}`).action}`) }
      const body = await readResponseText(response, { maxBytes: 512 * 1024, timeoutMs: 8000, signal })
      if (body.trimStart().startsWith('#EXTM3U')) {
        const parsed = hlsResources(body, response.url || input.url)
        result.kind = parsed.master ? 'hls-master' : 'hls-media'
        result.resources = parsed.resources
        if (parsed.truncated) result.warnings.push('Only the first 128 linked resources are shown.')
      } else if (/<(?:[\w.-]+:)?MPD(?:\s|>)/.test(body)) {
        result.kind = 'dash'
        result.warnings.push('DASH tracks are probed; representation relationships are not inferred from URLs.')
      } else result.warnings.push('The response was not a recognized HLS or DASH manifest.')
    }
    const probe = await probeMediaMetadata(ffprobeExecutable(settings.get('ffmpegPath')), [
      '-v', 'error', '-protocol_whitelist', 'http,https,httpproxy,tcp,tls,crypto',
      '-rw_timeout', '8000000', '-probesize', '1048576', '-analyzeduration', '1000000',
      '-headers', Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`).join(''),
      ...(proxyUrl ? ['-http_proxy', proxyUrl] : []),
      '-show_entries', 'stream=index,codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate:stream_tags=language:format=duration',
      '-of', 'json', input.url
    ], { stdio: ['ignore', 'pipe', 'pipe'] }, signal)
    if (probe.ok) {
      const facts = inspectedProbeFacts(probe.metadata)
      result.streams = facts.streams
      result.duration = facts.duration
      if (facts.truncated) result.warnings.push('Only the first 64 streams are shown.')
    } else {
      if (probe.cancelled) throw new Error('Media inspection cancelled')
      result.warnings.push(sanitizeResolverError(probe.error).slice(0, 512))
    }
    return result
  } finally { activeInspections-- }
}
