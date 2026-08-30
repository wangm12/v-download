import { hasApiAuth } from './apiAuth'
import {
  buildJobView,
  contentDisposition,
  contentTypeForName,
  isSafeFileName,
  parseJobCreateBody,
  parseJobId,
  resolveJobOwnedFile,
  type Artifact,
  type JobError,
  type JobRecord,
  type JobView,
} from './apiJobsModel'
import { sanitizeDownloadBasename } from './sanitizeDownloadBasename'

export const MAX_REMOTE_API_BODY_BYTES = 64 * 1024

export interface RemoteJobBackend {
  getToken(): string
  createJob(url: string): { id: string; status: string; url: string }
  getJob(id: string): JobRecord | null
  artifactsFor(id: string): Artifact[]
  ownedPathsFor(id: string): string[]
  cancelJob(id: string): 'ok' | 'not_found' | 'not_cancellable'
}

export type RemoteApiDispatch =
  | { type: 'json'; status: number; body: unknown }
  | { type: 'file'; status: number; path: string; name: string }
  | { type: 'archive'; status: number; files: Array<{ path: string; name: string }>; zipName: string }

export interface RemoteApiRequest {
  method: string
  url: string
  headers: Record<string, string | string[] | undefined>
  body?: unknown
}

function jsonError(status: number, error: JobError): RemoteApiDispatch {
  return { type: 'json', status, body: { error } }
}

function viewFor(backend: RemoteJobBackend, record: JobRecord): JobView {
  return buildJobView(record, { artifacts: backend.artifactsFor(record.id) })
}

function parsePath(url: string): { pathname: string; segments: string[] } {
  const parsed = new URL(url, 'http://127.0.0.1')
  const pathname = parsed.pathname.replace(/\/+$/, '') || '/'
  return { pathname, segments: pathname.split('/').filter(Boolean) }
}

function streamNamedFile(backend: RemoteJobBackend, id: string, name: string): RemoteApiDispatch {
  const path = resolveJobOwnedFile(backend.ownedPathsFor(id), name)
  if (!path) return jsonError(400, { code: 'invalid_name', message: 'Invalid file name' })
  return { type: 'file', status: 200, path, name }
}

export function dispatchRemoteApi(request: RemoteApiRequest, backend: RemoteJobBackend): RemoteApiDispatch {
  const method = request.method.toUpperCase()
  const { pathname, segments } = parsePath(request.url)

  if (method === 'GET' && (pathname === '/api/health' || pathname === '/health')) {
    return { type: 'json', status: 200, body: { ok: true, service: 'v-download-remote-api' } }
  }

  if (!pathname.startsWith('/v1')) {
    return jsonError(404, { code: 'not_found', message: 'Not found' })
  }

  if (!hasApiAuth(request.headers ?? {}, backend.getToken())) {
    return jsonError(401, { code: 'unauthorized', message: 'Authorization Bearer token required' })
  }

  if (method === 'POST' && pathname === '/v1/jobs') {
    const parsed = parseJobCreateBody(request.body)
    if (!parsed.ok) return jsonError(400, parsed.error)
    const created = backend.createJob(parsed.url)
    return { type: 'json', status: 202, body: created }
  }

  if (segments[0] !== 'v1' || segments[1] !== 'jobs' || !segments[2]) {
    return jsonError(404, { code: 'not_found', message: 'Not found' })
  }

  const parsedId = parseJobId(segments[2])
  if (!parsedId.ok) return jsonError(400, parsedId.error)
  const id = parsedId.id
  const action = segments[3]
  const fileNameSeg = segments[4]

  if (method === 'GET' && !action) {
    const task = backend.getJob(id)
    if (!task) return jsonError(404, { code: 'not_found', message: 'Job not found' })
    return { type: 'json', status: 200, body: viewFor(backend, task) }
  }

  if (method === 'POST' && action === 'cancel' && !fileNameSeg) {
    const result = backend.cancelJob(id)
    if (result === 'not_found') return jsonError(404, { code: 'not_found', message: 'Job not found' })
    if (result === 'not_cancellable') {
      return jsonError(409, { code: 'not_cancellable', message: 'Job is already finished' })
    }
    return { type: 'json', status: 200, body: { id, status: 'cancelled' } }
  }

  const task = backend.getJob(id)
  if (!task) return jsonError(404, { code: 'not_found', message: 'Job not found' })
  const view = viewFor(backend, task)

  if (method === 'GET' && action === 'file' && !fileNameSeg) {
    if (view.status === 'queued' || view.status === 'downloading') {
      return jsonError(409, { code: 'not_ready', message: 'Job is not complete' })
    }
    if (view.status === 'cancelled') {
      return jsonError(409, { code: 'cancelled', message: 'Job was cancelled' })
    }
    if (view.status === 'error') {
      return jsonError(409, view.error ?? { code: 'download_failed', message: 'Job failed' })
    }
    if (view.expired) return jsonError(410, { code: 'expired', message: 'Job files have expired' })
    if (view.kind !== 'file' || !view.files?.[0]) {
      return jsonError(409, {
        code: 'multiple_files',
        message: 'This job has multiple files; GET /v1/jobs/:id/files/:name or /archive',
        details: { kind: view.kind, count: view.files?.length ?? 0 },
      })
    }
    return streamNamedFile(backend, id, view.files[0].name)
  }

  if (method === 'GET' && action === 'files' && fileNameSeg && !segments[5]) {
    let name = fileNameSeg
    try { name = decodeURIComponent(fileNameSeg) } catch { /* keep raw */ }
    if (!isSafeFileName(name)) {
      return jsonError(400, { code: 'invalid_name', message: 'Invalid file name' })
    }
    if (view.status === 'queued' || view.status === 'downloading') {
      return jsonError(409, { code: 'not_ready', message: 'Job is not complete' })
    }
    if (view.expired) return jsonError(410, { code: 'expired', message: 'Job files have expired' })
    if (view.status !== 'complete') {
      return jsonError(409, view.error ?? { code: 'not_ready', message: 'Job is not complete' })
    }
    if (!view.files?.some((file) => file.name === name)) {
      return jsonError(404, { code: 'file_not_found', message: 'File is not part of this job' })
    }
    return streamNamedFile(backend, id, name)
  }

  if (method === 'GET' && action === 'archive' && !fileNameSeg) {
    if (view.status === 'queued' || view.status === 'downloading') {
      return jsonError(409, { code: 'not_ready', message: 'Job is not complete' })
    }
    if (view.status === 'error' || view.status === 'cancelled') {
      return jsonError(409, view.error ?? { code: view.status, message: `Job is ${view.status}` })
    }
    if (view.expired || !view.files?.length) {
      return jsonError(410, { code: 'expired', message: 'Job files have expired' })
    }
    const files: Array<{ path: string; name: string }> = []
    for (const file of view.files) {
      const path = resolveJobOwnedFile(backend.ownedPathsFor(id), file.name)
      if (!path) return jsonError(410, { code: 'expired', message: 'Job files have expired' })
      files.push({ path, name: file.name })
    }
    return {
      type: 'archive',
      status: 200,
      files,
      zipName: `${sanitizeDownloadBasename(view.title || id)}.zip`,
    }
  }

  return jsonError(404, { code: 'not_found', message: 'Not found' })
}

export function fileResponseHeaders(name: string, size: number): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': contentTypeForName(name),
    'Content-Length': String(size),
    'Content-Disposition': contentDisposition(name),
  }
  if (name.toLowerCase().endsWith('.mp4')) headers['Accept-Ranges'] = 'bytes'
  return headers
}

export function archiveResponseHeaders(zipName: string): Record<string, string> {
  return {
    'Content-Type': 'application/zip',
    'Content-Disposition': contentDisposition(zipName),
  }
}
