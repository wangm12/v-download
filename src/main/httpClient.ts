import { ProxyAgent, fetch as undiciFetch } from 'undici'
import { createWriteStream } from 'node:fs'
import { mkdir, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_REDIRECTS = 3
const MAX_PROXY_DISPATCHERS = 8

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308])
const proxyDispatchers = new Map<string, ProxyAgent>()
let proxyDispatchersClosing = false
let proxyDispatchersClosePromise: Promise<void> | null = null

export type HttpRequestErrorCode = 'invalid-url' | 'timeout' | 'redirect' | 'body-limit'

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
  proxyUrl?: string
}

export interface ResponseBodyOptions {
  timeoutMs?: number
  maxBytes?: number
  signal?: AbortSignal | null
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

function dispatcherForProxy(proxyUrl: string): ProxyAgent {
  const existing = proxyDispatchers.get(proxyUrl)
  if (existing) {
    proxyDispatchers.delete(proxyUrl)
    proxyDispatchers.set(proxyUrl, existing)
    return existing
  }
  if (proxyDispatchersClosing) throw new Error('Proxy HTTP clients are shutting down')
  const dispatcher = new ProxyAgent(proxyUrl)
  proxyDispatchers.set(proxyUrl, dispatcher)
  if (proxyDispatchers.size > MAX_PROXY_DISPATCHERS) {
    const oldest = proxyDispatchers.entries().next().value as [string, ProxyAgent] | undefined
    if (oldest) {
      proxyDispatchers.delete(oldest[0])
      void oldest[1].close().catch(() => undefined)
    }
  }
  return dispatcher
}

/** Gracefully retire proxy connection pools after managed requests have stopped. */
export function closeProxyDispatchers(): Promise<void> {
  if (proxyDispatchersClosePromise) return proxyDispatchersClosePromise
  proxyDispatchersClosing = true
  const dispatchers = [...proxyDispatchers.values()]
  proxyDispatchers.clear()
  proxyDispatchersClosePromise = Promise.all(
    dispatchers.map((dispatcher) => dispatcher.close().catch(() => undefined))
  ).then(() => undefined)
  return proxyDispatchersClosePromise
}

async function fetchWithOptionalProxy(
  url: URL,
  init: RequestInit,
  proxyUrl?: string
): Promise<Response> {
  const resolved = typeof proxyUrl === 'string' ? proxyUrl.trim() : ''
  if (!resolved) return fetch(url, init)
  try {
    const dispatcher = dispatcherForProxy(resolved)
    return (await undiciFetch(url, {
      ...init,
      dispatcher,
    } as NonNullable<Parameters<typeof undiciFetch>[1]>)) as unknown as Response
  } catch (error) {
    console.warn(
      `[http] proxied fetch failed via ${resolved}:`,
      error instanceof Error ? error.message : error
    )
    throw error
  }
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
      const response = await fetchWithOptionalProxy(currentUrl, { ...requestInit, headers }, options.proxyUrl)
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

/** Read a small response body with a separate deadline and byte cap after headers arrive. */
export async function readResponseBytes(
  response: Response,
  options: ResponseBodyOptions = {}
): Promise<Uint8Array> {
  const timeoutMs = Math.max(1, Math.floor(options.timeoutMs ?? DEFAULT_TIMEOUT_MS))
  const maxBytes = options.maxBytes == null ? Number.POSITIVE_INFINITY : Math.max(0, options.maxBytes)
  const signal = options.signal
  if (signal?.aborted) throw new DOMException('HTTP response body aborted', 'AbortError')
  if (!response.body) return new Uint8Array()

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let rejectAbort: ((error: Error) => void) | undefined
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject })
  const abort = () => rejectAbort?.(new DOMException('HTTP response body aborted', 'AbortError'))
  signal?.addEventListener('abort', abort, { once: true })
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true
      reject(new HttpRequestError('timeout', `HTTP response body timed out after ${timeoutMs}ms`))
    }, timeoutMs)
  })

  const consume = async (): Promise<Uint8Array> => {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        throw new HttpRequestError('body-limit', `HTTP response body exceeded ${maxBytes} bytes`)
      }
      chunks.push(value)
    }
    const result = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      result.set(chunk, offset)
      offset += chunk.byteLength
    }
    return result
  }

  try {
    return await Promise.race([consume(), timeout, aborted])
  } finally {
    if (timer) clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
    if (timedOut || signal?.aborted || total > maxBytes) await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

export async function readResponseText(
  response: Response,
  options: ResponseBodyOptions = {}
): Promise<string> {
  const bytes = await readResponseBytes(response, options)
  return new TextDecoder().decode(bytes)
}

export interface StreamResponseOptions {
  signal?: AbortSignal
  idleTimeoutMs?: number
  maxBytes?: number
  onChunk?: (bytes: number) => void
}

/** Stream a media response to disk with cancellation, an idle deadline, and bounded disk use. */
export async function streamResponseToFile(
  response: Response,
  outputPath: string,
  options: StreamResponseOptions = {}
): Promise<number> {
  if (!response.body) throw new Error('HTTP response has no body')
  if (options.signal?.aborted) throw new DOMException('HTTP media stream aborted', 'AbortError')

  const idleTimeoutMs = Math.max(1, Math.floor(options.idleTimeoutMs ?? 30_000))
  const maxBytes = options.maxBytes == null ? Number.POSITIVE_INFINITY : Math.max(0, options.maxBytes)
  let total = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let idleError: HttpRequestError | null = null
  const source = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream)
  const touch = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      idleError = new HttpRequestError('timeout', `HTTP media stream was idle for ${idleTimeoutMs}ms`)
      source.destroy(idleError)
    }, idleTimeoutMs)
    timer.unref?.()
  }
  const meter = new Transform({
    transform(chunk: Buffer | string, _encoding, callback) {
      const bytes = Buffer.byteLength(chunk)
      total += bytes
      if (total > maxBytes) {
        callback(new HttpRequestError('body-limit', `HTTP media exceeded ${maxBytes} bytes`))
        return
      }
      touch()
      options.onChunk?.(bytes)
      callback(null, chunk)
    }
  })

  await mkdir(dirname(outputPath), { recursive: true })
  touch()
  try {
    await pipeline(source, meter, createWriteStream(outputPath), ...(options.signal ? [{ signal: options.signal }] : []))
    return total
  } catch (error) {
    await unlink(outputPath).catch(() => undefined)
    if (idleError) throw idleError
    throw error
  } finally {
    if (timer) clearTimeout(timer)
  }
}
