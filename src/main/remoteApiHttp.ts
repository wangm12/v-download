import { createReadStream, statSync, type ReadStream, type Stats } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { ZipFile } from 'yazl'
import {
  archiveResponseHeaders,
  dispatchRemoteApi,
  fileResponseHeaders,
  MAX_REMOTE_API_BODY_BYTES,
  type RemoteApiDispatch,
  type RemoteJobBackend,
} from './remoteApiHandler'

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    req.on('data', (chunk: Buffer) => {
      if (settled) return
      size += chunk.length
      if (size > MAX_REMOTE_API_BODY_BYTES) {
        settled = true
        reject(Object.assign(new Error('payload_too_large'), { code: 'payload_too_large' }))
        // Drain the rest of the bounded request so the caller can receive the
        // existing 413 JSON response instead of a connection reset.
        req.resume()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      resolve(Buffer.concat(chunks, size).toString('utf-8'))
    })
    req.on('error', (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
    req.on('aborted', () => {
      if (settled) return
      settled = true
      reject(new Error('Request body was aborted'))
    })
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.destroyed || res.writableEnded || res.headersSent) return
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

async function sendStream(res: ServerResponse, source: NodeJS.ReadableStream): Promise<void> {
  try {
    await pipeline(source, res)
  } catch {
    // pipeline destroys both sides on read/write failure or client disconnect.
    // Headers may already be sent, so there is no reliable JSON replacement.
    if (!res.destroyed) res.destroy()
  }
}

async function sendDispatch(res: ServerResponse, result: RemoteApiDispatch): Promise<void> {
  if (result.type === 'empty') {
    res.writeHead(result.status, { Allow: 'POST' })
    res.end()
    return
  }
  if (result.type === 'json') {
    if (result.status === 405) {
      const payload = JSON.stringify(result.body)
      res.writeHead(result.status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(payload),
        Allow: 'POST',
      })
      res.end(payload)
      return
    }
    sendJson(res, result.status, result.body)
    return
  }
  if (result.type === 'file') {
    let st: Stats
    try {
      st = statSync(result.path)
    } catch {
      sendJson(res, 410, { error: { code: 'expired', message: 'Job files have expired' } })
      return
    }
    if (!st.isFile()) {
      sendJson(res, 410, { error: { code: 'expired', message: 'Job files have expired' } })
      return
    }
    res.writeHead(result.status, fileResponseHeaders(result.name, st.size))
    await sendStream(res, createReadStream(result.path))
    return
  }
  const zip = new ZipFile()
  const zipOutput = zip.outputStream as Readable
  const activeStreams = new Set<ReadStream>()
  zip.on('error', (error: Error) => {
    if (!zipOutput.destroyed) zipOutput.destroy(error)
  })
  for (const file of result.files) {
    let st: Stats
    try {
      st = statSync(file.path)
    } catch {
      sendJson(res, 410, { error: { code: 'expired', message: 'Job files have expired' } })
      return
    }
    if (!st.isFile()) {
      sendJson(res, 410, { error: { code: 'expired', message: 'Job files have expired' } })
      return
    }
    zip.addReadStreamLazy(file.name, {
      size: st.size,
      mtime: st.mtime,
      mode: st.mode,
      compress: false,
    }, (callback) => {
      const input = createReadStream(file.path)
      activeStreams.add(input)
      input.once('close', () => activeStreams.delete(input))
      input.once('error', (error) => {
        activeStreams.delete(input)
        zip.emit('error', error)
      })
      callback(null, input)
    })
  }
  res.writeHead(result.status, archiveResponseHeaders(result.zipName))
  res.once('close', () => {
    if (res.writableFinished) return
    for (const input of activeStreams) input.destroy()
    if (!zipOutput.destroyed) zipOutput.destroy()
  })
  const transfer = sendStream(res, zipOutput)
  zip.end()
  await transfer
}

export function createRemoteApiHttpHandler(backend: RemoteJobBackend) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const url = req.url || '/'
      const method = req.method || 'GET'
      let body: unknown
      if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
        const raw = await readBody(req)
        if (raw.length > 0) {
          try {
            body = JSON.parse(raw)
          } catch {
            sendJson(res, 400, { error: { code: 'invalid_url', message: 'JSON object with url is required' } })
            return
          }
        }
      }
      const result = dispatchRemoteApi({ method, url, headers: req.headers, body }, backend)
      await sendDispatch(res, result)
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'payload_too_large') {
        sendJson(res, 413, { error: { code: 'payload_too_large', message: 'Request body exceeds 64KiB' } })
        return
      }
      sendJson(res, 500, { error: { code: 'download_failed', message: 'Internal error' } })
    }
  }
}
