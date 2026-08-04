const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_REDIRECTS = 3

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308])

export type HttpRequestErrorCode = 'invalid-url' | 'timeout' | 'redirect'

export class HttpRequestError extends Error {
  readonly code: HttpRequestErrorCode

  constructor(code: HttpRequestErrorCode, message: string) {
    super(message)
    this.name = 'HttpRequestError'
    this.code = code
  }
}

export interface FetchWithTimeoutOptions {
  timeoutMs?: number
  maxRedirects?: number
}

export function delayWithAbort(ms: number, signal?: AbortSignal | null): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException('HTTP request aborted', 'AbortError'))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, Math.max(0, ms))
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(new DOMException('HTTP request aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function parseHttpUrl(input: string | URL): URL {
  try {
    const url = input instanceof URL ? new URL(input.href) : new URL(input)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new HttpRequestError('invalid-url', `Unsupported URL protocol: ${url.protocol}`)
    }
    if (url.username || url.password) {
      throw new HttpRequestError('invalid-url', 'URLs with embedded credentials are not allowed')
    }
    return url
  } catch (error) {
    if (error instanceof HttpRequestError) throw error
    throw new HttpRequestError('invalid-url', 'Invalid HTTP(S) URL')
  }
}

/**
 * Fetch an HTTP(S) resource with one overall deadline and an explicit redirect cap.
 * The caller's AbortSignal remains authoritative; timeout aborts are reported separately.
 */
export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit = {},
  options: FetchWithTimeoutOptions = {}
): Promise<Response> {
  const timeoutMs = Math.max(1, Math.floor(options.timeoutMs ?? DEFAULT_TIMEOUT_MS))
  const maxRedirects = Math.max(0, Math.floor(options.maxRedirects ?? DEFAULT_MAX_REDIRECTS))
  const externalSignal = init.signal
  const controller = new AbortController()
  let timedOut = false

  const onExternalAbort = () => controller.abort()
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort()
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true })
  }

  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    let currentUrl = parseHttpUrl(input)
    let redirectCount = 0
    let stripSensitiveHeaders = false
    const requestInit: RequestInit = {
      ...init,
      redirect: 'manual',
      signal: controller.signal,
    }

    while (true) {
      const headers = new Headers(init.headers)
      if (stripSensitiveHeaders) {
        // Short links can cross subdomains. Do not forward credentials or a
        // user-supplied referer outside the origin that received them.
        headers.delete('authorization')
        headers.delete('cookie')
        headers.delete('origin')
        headers.delete('proxy-authorization')
        headers.delete('referer')
      }
      const response = await fetch(currentUrl, { ...requestInit, headers })
      if (!REDIRECT_STATUS.has(response.status)) return response

      const location = response.headers.get('location')
      await response.body?.cancel().catch(() => undefined)
      if (!location) {
        throw new HttpRequestError('redirect', `Redirect response ${response.status} has no location`)
      }
      if (redirectCount >= maxRedirects) {
        throw new HttpRequestError(
          'redirect',
          `Too many redirects (maximum ${maxRedirects})`
        )
      }

      const nextUrl = parseHttpUrl(new URL(location, currentUrl))
      if (nextUrl.origin !== currentUrl.origin) stripSensitiveHeaders = true
      currentUrl = nextUrl
      redirectCount++
    }
  } catch (error) {
    if (timedOut) {
      throw new HttpRequestError('timeout', `HTTP request timed out after ${timeoutMs}ms`)
    }
    if (externalSignal?.aborted) {
      throw new DOMException('HTTP request aborted', 'AbortError')
    }
    throw error
  } finally {
    clearTimeout(timer)
    externalSignal?.removeEventListener('abort', onExternalAbort)
  }
}
