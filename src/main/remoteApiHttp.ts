import { createReadStream, existsSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
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
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_REMOTE_API_BODY_BYTES) {
        reject(Object.assign(new Error('payload_too_large'), { code: 'payload_too_large' }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function sendDispatch(res: ServerResponse, result: RemoteApiDispatch): void {
  if (result.type === 'json') {
    sendJson(res, result.status, result.body)
    return
  }
  if (result.type === 'file') {
    if (!existsSync(result.path)) {
      sendJson(res, 410, { error: { code: 'expired', message: 'Job files have expired' } })
      return
    }
    const st = statSync(result.path)
    res.writeHead(result.status, fileResponseHeaders(result.name, st.size))
    createReadStream(result.path).pipe(res)
    return
  }
  const zip = new ZipFile()
  for (const file of result.files) {
    if (!existsSync(file.path)) {
      sendJson(res, 410, { error: { code: 'expired', message: 'Job files have expired' } })
      return
    }
    zip.addFile(file.path, file.name)
  }
  zip.end()
  res.writeHead(result.status, archiveResponseHeaders(result.zipName))
  zip.outputStream.pipe(res)
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
      sendDispatch(res, result)
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'payload_too_large') {
        sendJson(res, 413, { error: { code: 'payload_too_large', message: 'Request body exceeds 64KiB' } })
        return
      }
      sendJson(res, 500, { error: { code: 'download_failed', message: 'Internal error' } })
    }
  }
}
