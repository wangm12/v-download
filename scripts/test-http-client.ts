import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { fetchWithTimeout, HttpRequestError } from '../src/main/httpClient'

async function main(): Promise<void> {
  let redirectTargetUrl = ''
  const server = createServer((request, response) => {
    if (request.url === '/redirect') {
      response.writeHead(302, { Location: '/ok' })
      response.end()
      return
    }
    if (request.url === '/same-origin-cookie-redirect') {
      response.writeHead(302, { Location: '/same-origin-cookie' })
      response.end()
      return
    }
    if (request.url === '/same-origin-cookie') {
      assert.equal(request.headers.cookie, 'same=1')
      response.writeHead(200, { 'Content-Type': 'text/plain' })
      response.end('same-origin-ok')
      return
    }
    if (request.url === '/loop') {
      response.writeHead(302, { Location: '/loop' })
      response.end()
      return
    }
    if (request.url === '/cross-origin-redirect') {
      response.writeHead(302, { Location: redirectTargetUrl })
      response.end()
      return
    }
    if (request.url === '/slow') {
      setTimeout(() => {
        if (response.destroyed) return
        response.writeHead(200, { 'Content-Type': 'text/plain' })
        response.end('slow')
      }, 250)
      return
    }
    response.writeHead(200, { 'Content-Type': 'text/plain' })
    response.end('ok')
  })
  const redirectTargetServer = createServer((request, response) => {
    assert.equal(request.headers.cookie, undefined)
    assert.equal(request.headers.authorization, undefined)
    response.writeHead(200, { 'Content-Type': 'text/plain' })
    response.end('cross-origin-ok')
  })

  const serverListening = once(server, 'listening')
  const redirectTargetListening = once(redirectTargetServer, 'listening')
  server.listen(0, '127.0.0.1')
  redirectTargetServer.listen(0, '127.0.0.1')
  await serverListening
  await redirectTargetListening
  const address = server.address()
  const redirectTargetAddress = redirectTargetServer.address()
  assert.ok(address && typeof address === 'object')
  assert.ok(redirectTargetAddress && typeof redirectTargetAddress === 'object')
  const baseUrl = `http://127.0.0.1:${address.port}`
  redirectTargetUrl = `http://127.0.0.1:${redirectTargetAddress.port}`

  try {
    const redirected = await fetchWithTimeout(`${baseUrl}/redirect`, {}, { timeoutMs: 1000 })
    assert.equal(await redirected.text(), 'ok')

    const sameOriginRedirect = await fetchWithTimeout(
      `${baseUrl}/same-origin-cookie-redirect`,
      { headers: { Cookie: 'same=1' } },
      { timeoutMs: 1000 }
    )
    assert.equal(await sameOriginRedirect.text(), 'same-origin-ok')

    const crossOriginRedirect = await fetchWithTimeout(
      `${baseUrl}/cross-origin-redirect`,
      {
        headers: { Cookie: 'secret=1', Authorization: 'Bearer secret' },
      },
      { timeoutMs: 1000 }
    )
    assert.equal(await crossOriginRedirect.text(), 'cross-origin-ok')

    await assert.rejects(
      fetchWithTimeout(`${baseUrl}/loop`, {}, { timeoutMs: 1000, maxRedirects: 2 }),
      (error: unknown) => error instanceof HttpRequestError && error.code === 'redirect'
    )

    await assert.rejects(
      fetchWithTimeout(`${baseUrl}/slow`, {}, { timeoutMs: 25 }),
      (error: unknown) => error instanceof HttpRequestError && error.code === 'timeout'
    )

    const controller = new AbortController()
    const aborted = fetchWithTimeout(
      `${baseUrl}/slow`,
      { signal: controller.signal },
      { timeoutMs: 1000 }
    )
    controller.abort()
    await assert.rejects(
      aborted,
      (error: unknown) => error instanceof DOMException && error.name === 'AbortError'
    )
  } finally {
    server.closeAllConnections?.()
    redirectTargetServer.closeAllConnections?.()
    await Promise.all([
      new Promise<void>((resolve) => server.close(() => resolve())),
      new Promise<void>((resolve) => redirectTargetServer.close(() => resolve())),
    ])
  }

  console.log('http client tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
