import assert from 'node:assert/strict'
import { createServer, request, type Server } from 'node:http'
import { createServer as createTlsServer } from 'node:https'
import { connect as tlsConnect } from 'node:tls'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { ProgressiveRecovery, isProgressiveRecoveryInput, openPinnedDownloadRoute } from '../src/main/progressiveRecovery'
import { isRecoverableTransportFailure } from '../src/main/downloadError'

const listen = async (server: Server) => { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return (server.address() as { port: number }).port }
const close = (server: Server) => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()) })
const controller = () => new AbortController()
const immediate = async () => {}
const routes: Array<{ close: () => Promise<void> }> = []
const servers: Server[] = []
const proxyKeys = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']
const inheritedProxy = Object.fromEntries(proxyKeys.map((key) => [key, process.env[key]]))
let directory = ''
async function through(proxyUrl: string, target: URL, authenticated = true) {
  const proxy = new URL(proxyUrl)
  return await new Promise<{ status: number; data: Buffer; headers: Record<string, unknown> }>((resolve, reject) => {
    const req = request({ hostname: proxy.hostname, port: proxy.port, path: target.href, method: 'GET', headers: {
      ...(authenticated ? { 'Proxy-Authorization': `Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64')}` } : {}),
      Referer: 'https://source.test/watch?full=one%20two', Range: 'bytes=3-6', 'X-Source': 'preserved'
    } }, (res) => {
      const chunks: Buffer[] = []; res.on('data', (x) => chunks.push(x)); res.on('error', reject)
      res.on('end', () => resolve({ status: res.statusCode!, data: Buffer.concat(chunks), headers: res.headers }))
    }); req.on('error', reject); req.end()
  })
}

async function main(): Promise<void> {
try {
  for (const key of proxyKeys) delete process.env[key]
  for (const type of ['mp4', 'webm', 'mkv', 'flv', 'mp3', 'm4a']) assert.equal(isProgressiveRecoveryInput('https://media.test/file', type), true)
  for (const [url, type] of [['https://media.test/file.m3u8', 'mp4'], ['https://media.test/file', 'hls'], ['file:///tmp/a.mp4', 'mp4'], ['https://user:secret@media.test/file', 'mp4']]) assert.equal(isProgressiveRecoveryInput(url, type), false)
  for (const text of ["Connection aborted RemoteDisconnected", 'ContentTooShortError', '2672725 bytes read, 1439161 more expected', 'HTTP Error 503', 'Read timed out', 'NameResolutionError', 'Connection aborted for https://media.test/file?part=403']) assert.equal(isRecoverableTransportFailure(text), true)
  for (const text of ['HTTP Error 403: Forbidden', 'HTTP Error 404', 'HTTP Error 429', 'SSL certificate verify failed', 'Requested format is not available', 'Source selection not satisfied', 'Invalid data found when processing input']) assert.equal(isRecoverableTransportFailure(text), false)

  let received: Record<string, unknown> | undefined
  const origin = createServer((req, res) => {
    received = { path: req.url, host: req.headers.host, referer: req.headers.referer, range: req.headers.range, source: req.headers['x-source'], proxyAuth: req.headers['proxy-authorization'] }
    res.writeHead(206, { 'Content-Length': '4', 'Content-Range': 'bytes 3-6/10', ETag: '"source-v1"' }); res.end('3456')
  }); servers.push(origin)
  const port = await listen(origin)
  const original = new URL(`http://media.test:${port}/clip.mp4?sign=a%2Bb&raw=one%20two`)
  const pinned = await openPinnedDownloadRoute(original, { address: '127.0.0.1', family: 4 }); routes.push(pinned)
  const answer = await through(pinned.proxyUrl, original)
  assert.equal(answer.status, 206); assert.equal(answer.data.toString(), '3456'); assert.equal(answer.headers.etag, '"source-v1"')
  assert.deepEqual(received, { path: '/clip.mp4?sign=a%2Bb&raw=one%20two', host: `media.test:${port}`, referer: 'https://source.test/watch?full=one%20two', range: 'bytes=3-6', source: 'preserved', proxyAuth: undefined })
  assert.equal((await through(pinned.proxyUrl, original, false)).status, 407)
  assert.equal((await through(pinned.proxyUrl, new URL(`http://other.test:${port}/clip`))).status, 502)
  await pinned.close()
  await assert.rejects(through(pinned.proxyUrl, original), /ECONNREFUSED/)

  let lookupCount = 0
  const attempts: number[] = []
  const recovery = new ProgressiveRecovery({ url: original.href, mediaType: 'mp4', enabled: true, signal: controller().signal,
    lookup: async () => { lookupCount++; return [1, 1, 2, 3, 4].map((n) => ({ address: `127.0.0.${n}`, family: 4 })) }, delay: immediate,
    onRetry: (attempt) => attempts.push(attempt) })
  routes.push(recovery)
  const one = await recovery.next('Connection aborted')
  assert.equal(one?.mode, 'dns-edge'); assert.equal(one?.verifyCertificate, true)
  await recovery.next('RemoteDisconnected'); await recovery.next('Read timed out')
  assert.equal(await recovery.next('Connection aborted'), null)
  assert.deepEqual(attempts, [1, 2, 3]); assert.equal(lookupCount, 1)
  await recovery.close()

  const proxyRecovery = new ProgressiveRecovery({ url: original.href, mediaType: 'mp4', enabled: true, proxyUrl: 'http://selected.proxy:9999', signal: controller().signal,
    lookup: async () => { throw Error('must never resolve around caller proxy') }, delay: immediate })
  routes.push(proxyRecovery)
  for (let n = 0; n < 2; n++) assert.equal((await proxyRecovery.next('Connection aborted'))?.proxyUrl, 'http://selected.proxy:9999')
  assert.equal(await proxyRecovery.next('Connection aborted'), null)
  process.env.HTTP_PROXY = 'http://environment.proxy:1234'
  const environment = new ProgressiveRecovery({ url: original.href, mediaType: 'mp4', enabled: true, signal: controller().signal })
  routes.push(environment); assert.equal(environment.enabled, false); assert.equal(await environment.next('Connection aborted'), null)
  delete process.env.HTTP_PROXY
  for (const url of ['http://127.0.0.1/clip.mp4', 'http://[::1]/clip.mp4']) {
    const literal = new ProgressiveRecovery({ url, mediaType: 'mp4', enabled: true, signal: controller().signal })
    routes.push(literal); assert.equal(literal.enabled, false); assert.equal(await literal.next('Connection aborted'), null)
  }
  const abort = controller()
  const waiting = new ProgressiveRecovery({ url: original.href, mediaType: 'mp4', enabled: true, signal: abort.signal, lookup: async () => [{ address: '127.0.0.1', family: 4 }],
    onRetry: () => abort.abort() })
  routes.push(waiting)
  await assert.rejects(waiting.next('Connection aborted'), /abort/i)
  const dnsAbort = controller()
  const dnsWaiting = new ProgressiveRecovery({ url: original.href, mediaType: 'mp4', enabled: true, signal: dnsAbort.signal, lookup: () => new Promise(() => {}) })
  routes.push(dnsWaiting)
  const pending = dnsWaiting.next('Connection aborted'); dnsAbort.abort()
  await assert.rejects(pending, /cancelled/i)

  // Real TLS through CONNECT, trusted test CA. A wrong hostname must fail.
  directory = await mkdtemp(join(tmpdir(), 'vdownload-recovery-tls-'))
  await writeFile(join(directory, 'certificate.cnf'), '[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=media.test\n[ext]\nsubjectAltName=DNS:media.test\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,digitalSignature,keyEncipherment\n')
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-config', join(directory, 'certificate.cnf'), '-keyout', join(directory, 'key.pem'), '-out', join(directory, 'cert.pem')], { stdio: 'ignore' })
  const key = await readFile(join(directory, 'key.pem')), cert = await readFile(join(directory, 'cert.pem'))
  const secure = createTlsServer({ key, cert }, (_req, res) => res.end('verified'))
  servers.push(secure); const tlsPort = await listen(secure)
  const tlsRoute = await openPinnedDownloadRoute(new URL(`https://media.test:${tlsPort}/clip`), { address: '127.0.0.1', family: 4 }); routes.push(tlsRoute)
  async function tunnel(servername: string): Promise<void> {
    const proxy = new URL(tlsRoute.proxyUrl)
    await new Promise<void>((resolve, reject) => {
      const req = request({ hostname: proxy.hostname, port: proxy.port, method: 'CONNECT', path: `media.test:${tlsPort}`, headers: { 'Proxy-Authorization': `Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64')}` } })
      req.on('error', reject)
      req.once('connect', (res, socket) => {
        assert.equal(res.statusCode, 200)
        const tls = tlsConnect({ socket, servername, ca: cert })
        tls.once('error', (error) => { tls.destroy(); reject(error) })
        tls.once('secureConnect', () => { assert.equal(tls.authorized, true); tls.destroy(); resolve() })
      }); req.end()
    })
  }
  await tunnel('media.test')
  await assert.rejects(tunnel('wrong.test'), /Hostname\/IP does not match/)
  console.log('Progressive recovery: restricted authenticated routes, exact URL/headers/ranges, budgets, proxy policy, cancellation and real TLS hostname checks passed')
} finally {
  for (const route of routes) await route.close()
  for (const server of servers) await close(server)
  if (directory) await rm(directory, { recursive: true, force: true })
  for (const key of proxyKeys) { if (inheritedProxy[key] === undefined) delete process.env[key]; else process.env[key] = inheritedProxy[key] }
}

}
void main().catch((error) => { console.error(error); process.exitCode = 1 })
