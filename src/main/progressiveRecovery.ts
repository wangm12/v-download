import { randomBytes } from 'node:crypto'
import { lookup as dnsLookup } from 'node:dns/promises'
import { createServer, type OutgoingHttpHeaders } from 'node:http'
import { connect, isIP, type Socket } from 'node:net'
import { delayWithAbort } from './httpClient'
import { isAdaptiveMediaInput } from './mediaResolver'
import { isRecoverableTransportFailure } from './downloadError'

type Address = { address: string; family: number }
type Lease = { proxyUrl: string; close: () => Promise<void> }
export type RecoveryRoute = { proxyUrl: string; verifyCertificate: boolean; attempt: number; mode: 'dns-edge' | 'configured-proxy' }

export function isProgressiveRecoveryInput(url: string, mediaType?: string): boolean {
  try {
    const parsed = new URL(url)
    return /^https?:$/.test(parsed.protocol) && !parsed.username && !parsed.password && !isAdaptiveMediaInput(mediaType, url) &&
      ['mp4', 'webm', 'mkv', 'flv', 'mp3', 'm4a'].includes((mediaType ?? '').toLowerCase())
  } catch { return false }
}

/**
 * One authenticated loopback lease, restricted to the original origin. HTTPS is
 * an opaque CONNECT tunnel: the downloader keeps the URL, Host and TLS hostname.
 * No global DNS/proxy changes, certificate interception or source-header rewriting.
 */
export async function openPinnedDownloadRoute(original: URL, address: Address): Promise<Lease> {
  const sockets = new Set<Socket>()
  const password = randomBytes(24).toString('hex')
  const authorization = `Basic ${Buffer.from(`vdownload:${password}`).toString('base64')}`
  const port = Number(original.port || (original.protocol === 'https:' ? 443 : 80))
  let closing: Promise<void> | undefined
  const track = (socket: Socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    socket.on('error', () => socket.destroy())
    socket.setTimeout(45_000, () => socket.destroy())
    return socket
  }
  const server = createServer((req, res) => {
    if (req.headers['proxy-authorization'] !== authorization) {
      res.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="V-Download task"', Connection: 'close' }); res.end(); return
    }
    let target: URL
    try { target = new URL(req.url ?? '') } catch { res.writeHead(400); res.end(); return }
    if (original.protocol !== 'http:' || target.origin !== original.origin || !['GET', 'HEAD'].includes(req.method ?? '')) {
      res.writeHead(502, { Connection: 'close' }); res.end('Recovery route is restricted to the original origin'); return
    }
    // A raw tunnel also preserves byte ranges and response framing for HTTP.
    const upstream = track(connect({ host: address.address, family: address.family, port }))
    const connectTimer = setTimeout(() => upstream.destroy(), 10_000)
    upstream.once('connect', () => {
      clearTimeout(connectTimer)
      const headers: OutgoingHttpHeaders = { ...req.headers, host: original.host, connection: 'close' }
      delete headers['proxy-authorization']; delete headers['proxy-connection']
      upstream.write(`${req.method} ${target.pathname}${target.search} HTTP/1.1\r\n${Object.entries(headers).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`).join('\r\n')}\r\n\r\n`)
      // Node's response serializer must not wrap the original HTTP response.
      upstream.pipe(req.socket)
    })
    upstream.once('close', () => { clearTimeout(connectTimer); req.socket.destroy() })
    req.socket.once('close', () => upstream.destroy())
  })
  server.on('connection', (socket) => {
    if (sockets.size >= 16) { socket.destroy(); return }
    track(socket)
  })
  server.on('connect', (req, client, head) => {
    const socket = client as Socket
    if (req.headers['proxy-authorization'] !== authorization) {
      socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="V-Download task"\r\nConnection: close\r\n\r\n'); return
    }
    let target: URL
    try { target = new URL(`https://${req.url}`) } catch { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return }
    if (original.protocol !== 'https:' || target.hostname !== original.hostname || Number(target.port || 443) !== port || target.username || target.password) {
      socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n'); return
    }
    const upstream = track(connect({ host: address.address, family: address.family, port }))
    const timer = setTimeout(() => upstream.destroy(), 10_000)
    upstream.once('connect', () => {
      clearTimeout(timer)
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length) upstream.write(head)
      socket.pipe(upstream); upstream.pipe(socket)
    })
    upstream.once('close', () => { clearTimeout(timer); socket.destroy() })
    socket.once('close', () => upstream.destroy())
  })
  server.headersTimeout = 10_000
  server.keepAliveTimeout = 1_000
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve() })
  })
  server.on('error', () => { for (const socket of sockets) socket.destroy() })
  return {
    proxyUrl: `http://vdownload:${password}@127.0.0.1:${(server.address() as { port: number }).port}`,
    close: () => closing ??= new Promise<void>((resolve) => {
      for (const socket of sockets) socket.destroy()
      server.close(() => resolve())
    })
  }
}

/** Per-run owner; addresses and route credentials never enter persisted task data. */
export class ProgressiveRecovery {
  readonly enabled: boolean
  private readonly original: URL
  private addresses: Address[] | undefined
  private attempt = 0
  private lease: Lease | undefined
  private closed = false
  private readonly onAbort = () => { void this.close() }

  constructor(private readonly options: {
    url: string; mediaType?: string; enabled: boolean; proxyUrl?: string; signal: AbortSignal
    onRetry?: (attempt: number, mode: RecoveryRoute['mode']) => void
    lookup?: (hostname: string) => Promise<Address[]>
    delay?: (ms: number, signal: AbortSignal) => Promise<void>
  }) {
    this.original = new URL(options.url)
    const ambientProxy = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'].some((name) => process.env[name]?.trim())
    const literalAddress = isIP(this.original.hostname.replace(/^\[|\]$/g, '')) !== 0
    this.enabled = options.enabled && isProgressiveRecoveryInput(options.url, options.mediaType) &&
      (Boolean(options.proxyUrl?.trim()) || (!ambientProxy && !literalAddress))
    if (this.enabled) options.signal.addEventListener('abort', this.onAbort, { once: true })
  }

  async next(failure: string): Promise<RecoveryRoute | null> {
    if (this.lease) { await this.lease.close(); this.lease = undefined }
    if (!this.enabled || this.closed || this.options.signal.aborted || !isRecoverableTransportFailure(failure)) return null
    const configuredProxy = this.options.proxyUrl?.trim()
    let address: Address | undefined
    if (configuredProxy) {
      if (this.attempt >= 2) return null
    } else {
      if (!this.addresses) {
        const signal = AbortSignal.any([this.options.signal, AbortSignal.timeout(10_000)])
        this.addresses = await new Promise<Address[]>((resolve, reject) => {
          const aborted = () => reject(new DOMException('DNS recovery cancelled or timed out', 'AbortError'))
          signal.addEventListener('abort', aborted, { once: true })
          const lookup = this.options.lookup ?? ((host: string) => dnsLookup(host, { all: true }))
          void lookup(this.original.hostname).then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted))
          if (signal.aborted) aborted()
        })
        this.addresses = this.addresses.filter((item, index, all) => isIP(item.address) === item.family && all.findIndex((other) => other.address === item.address) === index).slice(0, 3)
      }
      address = this.addresses[this.attempt]
      if (!address) return null
    }
    const attempt = ++this.attempt
    const mode = configuredProxy ? 'configured-proxy' : 'dns-edge'
    this.options.onRetry?.(attempt, mode)
    await (this.options.delay ?? delayWithAbort)([500, 1_500, 3_000][attempt - 1]!, this.options.signal)
    if (this.closed || this.options.signal.aborted) return null
    if (!configuredProxy) this.lease = await openPinnedDownloadRoute(this.original, address!)
    if (this.closed || this.options.signal.aborted) { await this.lease?.close(); return null }
    return { proxyUrl: configuredProxy || this.lease!.proxyUrl, verifyCertificate: !configuredProxy, attempt, mode }
  }

  async close(): Promise<void> {
    this.closed = true
    this.options.signal.removeEventListener('abort', this.onAbort)
    await this.lease?.close()
  }
}
