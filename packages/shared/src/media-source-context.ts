/** Browser provenance is independent of the media URL and never grants authentication. */
export interface MediaSourceContext {
  version: 1
  /** Top-level page the user opened. */
  pageUrl?: string
  /** Actual requesting frame URL, when the browser supplied it. */
  documentUrl?: string
  pageTitle?: string
  initiator?: string
  tabId?: number
  frameId?: number
  documentId?: string
  navigationEpoch?: number
  observedAt?: number
}

const URL_FIELDS = ['pageUrl', 'documentUrl', 'initiator'] as const
const NUMBER_FIELDS = ['tabId', 'frameId', 'navigationEpoch', 'observedAt'] as const
export function readMediaSourceContext(value: unknown): MediaSourceContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid media source context')
  const input = value as Record<string, unknown>
  const keys = new Set<string>(['version', ...URL_FIELDS, ...NUMBER_FIELDS, 'pageTitle', 'documentId'])
  if (input.version !== 1 || Object.keys(input).some((key) => !keys.has(key))) throw new Error('Unsupported media source context')
  const output: MediaSourceContext = { version: 1 }
  for (const key of URL_FIELDS) {
    if (input[key] === undefined) continue
    const url = input[key]
    if (typeof url !== 'string' || url.length > 8192 || /[\u0000-\u0020\u007f]/.test(url)) throw new Error('Invalid media source URL')
    if (!/^https?:$/.test(new URL(url).protocol)) throw new Error('Invalid media source URL')
    output[key] = url
  }
  for (const key of NUMBER_FIELDS) {
    if (input[key] === undefined) continue
    if (!Number.isSafeInteger(input[key]) || Number(input[key]) < 0) throw new Error('Invalid media source identity')
    output[key] = Number(input[key])
  }
  for (const key of ['pageTitle', 'documentId'] as const) {
    const text = input[key]
    if (text === undefined) continue
    if (typeof text !== 'string' || text.length > (key === 'documentId' ? 128 : 2048) || /[\u0000-\u001f\u007f]/.test(text)) throw new Error('Invalid media source text')
    output[key] = text
  }
  if (!output.pageUrl && !output.documentUrl && !output.initiator) throw new Error('Missing media source page')
  return output
}

/** Use the complete requesting document before any origin-only fallback. */
export function mediaSourceReferer(context: MediaSourceContext): string | undefined {
  return (context.documentUrl ?? context.pageUrl ?? context.initiator)?.split('#', 1)[0]
}
