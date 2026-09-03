import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { dispatchRemoteApi, type RemoteJobBackend } from '../src/main/remoteApiHandler'
import {
  MCP_PROTOCOL_VERSION,
  MCP_TOOL_NAMES,
  buildMcpClientConfig,
  clearMcpLogs,
  getMcpLogs,
  summarizeMcpArguments,
} from '../src/main/remoteMcpModel'
import { buildJobView, listJobArtifacts, type Artifact, type JobRecord } from '../src/main/apiJobsModel'

const token = 'unit-test-token-123456'
const root = join(tmpdir(), `vdl-mcp-${Date.now()}`)
mkdirSync(root, { recursive: true })

const jobs = new Map<string, JobRecord>()
const artifactDirs = new Map<string, string>()
let allowWrite = false
let requireConfirm = true

function ownedPaths(id: string): string[] {
  const dir = artifactDirs.get(id)
  return dir ? [dir] : []
}

const backend: RemoteJobBackend = {
  getToken: () => token,
  createJob: (url) => {
    const id = 'createdjob1'
    jobs.set(id, {
      id,
      url,
      title: 'Queued',
      status: 'queued',
      progress: 0,
      error: null,
      updatedAt: new Date().toISOString(),
    })
    return { id, status: 'queued', url }
  },
  getJob: (id) => jobs.get(id) ?? null,
  listJobs: () => [...jobs.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  artifactsFor: (id) => {
    const dir = artifactDirs.get(id)
    return dir ? listJobArtifacts(dir) : []
  },
  ownedPathsFor: ownedPaths,
  cancelJob: (id) => {
    const job = jobs.get(id)
    if (!job) return 'not_found'
    if (job.status === 'complete' || job.status === 'error' || job.status === 'cancelled') return 'not_cancellable'
    job.status = 'cancelled'
    return 'ok'
  },
  allowMcpWrite: () => allowWrite,
  requireMcpConfirm: () => requireConfirm,
}

const fileDir = join(root, 'filejob123')
mkdirSync(fileDir, { recursive: true })
writeFileSync(join(fileDir, 'Clip.mp4'), 'video-bytes')
jobs.set('filejob123', {
  id: 'filejob123',
  url: 'https://example.com/watch?v=1&token=SECRET',
  title: 'Clip',
  status: 'complete',
  progress: 100,
  error: null,
  updatedAt: new Date().toISOString(),
})
artifactDirs.set('filejob123', fileDir)

const auth = { authorization: `Bearer ${token}` }

function mcpCall(method: string, params?: unknown, id: number | string = 1) {
  return dispatchRemoteApi({
    method: 'POST',
    url: '/mcp',
    headers: auth,
    body: { jsonrpc: '2.0', id, method, params },
  }, backend)
}

function textPayload(result: ReturnType<typeof dispatchRemoteApi>): Record<string, unknown> {
  assert.equal(result.type, 'json')
  if (result.type !== 'json') throw new Error('expected json')
  const body = result.body as { result?: { content?: Array<{ text?: string }>; isError?: boolean } }
  const text = body.result?.content?.[0]?.text
  assert.ok(typeof text === 'string', 'expected text content')
  return { parsed: JSON.parse(text) as Record<string, unknown>, isError: Boolean(body.result?.isError), status: result.status }
}

clearMcpLogs()

const denied = dispatchRemoteApi({ method: 'POST', url: '/mcp', body: { jsonrpc: '2.0', id: 1, method: 'initialize' } }, backend)
assert.equal(denied.type, 'json')
if (denied.type === 'json') {
  assert.equal(denied.status, 401)
}

const getMcp = dispatchRemoteApi({ method: 'GET', url: '/mcp', headers: auth }, backend)
assert.equal(getMcp.type, 'json')
if (getMcp.type === 'json') assert.equal(getMcp.status, 405)

const initialized = mcpCall('initialize', {
  protocolVersion: MCP_PROTOCOL_VERSION,
  capabilities: {},
  clientInfo: { name: 'test', version: '1' },
})
assert.equal(initialized.type, 'json')
if (initialized.type === 'json') {
  assert.equal(initialized.status, 200)
  const result = (initialized.body as { result: { protocolVersion: string; serverInfo: { name: string } } }).result
  assert.equal(result.protocolVersion, MCP_PROTOCOL_VERSION)
  assert.equal(result.serverInfo.name, 'v-download')
}

const notify = dispatchRemoteApi({
  method: 'POST',
  url: '/mcp',
  headers: auth,
  body: { jsonrpc: '2.0', method: 'notifications/initialized' },
}, backend)
assert.equal(notify.type, 'empty')
if (notify.type === 'empty') assert.equal(notify.status, 204)

const listed = mcpCall('tools/list')
assert.equal(listed.type, 'json')
if (listed.type === 'json') {
  const tools = (listed.body as { result: { tools: Array<{ name: string }> } }).result.tools
  assert.deepEqual(tools.map((t) => t.name).sort(), [...MCP_TOOL_NAMES].sort())
}

const health = textPayload(mcpCall('tools/call', { name: 'health', arguments: {} }))
assert.equal(health.isError, false)
assert.equal((health.parsed as { ok: boolean }).ok, true)

const listedJobs = textPayload(mcpCall('tools/call', { name: 'list_jobs', arguments: {} }))
assert.equal(listedJobs.isError, false)
const jobIds = ((listedJobs.parsed as { jobs: Array<{ id: string }> }).jobs ?? []).map((j) => j.id)
assert.ok(jobIds.includes('filejob123'))
assert.equal(((listedJobs.parsed as { jobs: Array<{ files?: unknown }> }).jobs[0] as { files?: unknown } | undefined)?.files, undefined)

const restList = dispatchRemoteApi({ method: 'GET', url: '/v1/jobs', headers: auth }, backend)
assert.equal(restList.type, 'json')
if (restList.type === 'json') {
  assert.equal(restList.status, 200)
  const jobsBody = restList.body as { jobs: Array<{ id: string; files?: unknown }> }
  assert.ok(jobsBody.jobs.some((j) => j.id === 'filejob123'))
  assert.ok(jobsBody.jobs.every((j) => j.files === undefined))
}

const restListDenied = dispatchRemoteApi({ method: 'GET', url: '/v1/jobs' }, backend)
assert.equal(restListDenied.type, 'json')
if (restListDenied.type === 'json') assert.equal(restListDenied.status, 401)

const files = textPayload(mcpCall('tools/call', { name: 'get_job_files', arguments: { id: 'filejob123' } }))
assert.equal(files.isError, false)
const fileNames = ((files.parsed as { files: Array<{ name: string }> }).files ?? []).map((f) => f.name)
assert.deepEqual(fileNames, ['Clip.mp4'])
const directory = String((files.parsed as { directory?: string }).directory ?? '')
assert.ok(directory === fileDir || directory.endsWith('filejob123'))

allowWrite = false
requireConfirm = true
const writeOff = textPayload(mcpCall('tools/call', { name: 'enqueue_job', arguments: { url: 'https://example.com/watch?v=2', confirm: true } }))
assert.equal(writeOff.isError, true)
assert.equal((writeOff.parsed as { error: { code: string } }).error.code, 'write_disabled')

allowWrite = true
const noConfirm = textPayload(mcpCall('tools/call', { name: 'enqueue_job', arguments: { url: 'https://example.com/watch?v=2' } }))
assert.equal(noConfirm.isError, true)
assert.equal((noConfirm.parsed as { error: { code: string } }).error.code, 'confirmation_required')

const enqueued = textPayload(mcpCall('tools/call', { name: 'enqueue_job', arguments: { url: 'https://example.com/watch?v=2', confirm: true } }))
assert.equal(enqueued.isError, false)
assert.equal((enqueued.parsed as { id: string }).id, 'createdjob1')

const cancelled = textPayload(mcpCall('tools/call', { name: 'cancel_job', arguments: { id: 'createdjob1', confirm: true } }))
assert.equal(cancelled.isError, false)
assert.equal((cancelled.parsed as { status: string }).status, 'cancelled')

const summary = summarizeMcpArguments('enqueue_job', {
  url: 'https://example.com/watch?v=1&token=SECRET',
  confirm: true,
  authorization: 'Bearer leak',
})
assert.ok(summary.includes('example.com'))
assert.ok(!summary.includes('SECRET'))
assert.ok(!summary.includes('Bearer'))

const logs = getMcpLogs(20)
assert.ok(logs.length > 0)
assert.ok(logs.every((entry) => !JSON.stringify(entry).includes(token)))
assert.ok(logs.every((entry) => !JSON.stringify(entry).includes('SECRET')))

const logHttp = dispatchRemoteApi({ method: 'GET', url: '/v1/mcp/logs?limit=10', headers: auth }, backend)
assert.equal(logHttp.type, 'json')
if (logHttp.type === 'json') {
  assert.equal(logHttp.status, 200)
  const body = logHttp.body as { logs: unknown[] }
  assert.ok(Array.isArray(body.logs))
  assert.ok(body.logs.length > 0)
}

const config = buildMcpClientConfig({
  host: '127.0.0.1',
  port: 18766,
  token,
})
assert.ok(config.text.includes('http://127.0.0.1:18766/mcp'))
assert.ok(config.text.includes(`Bearer ${token}`))
assert.equal(config.json.mcpServers['v-download']?.url, 'http://127.0.0.1:18766/mcp')

const view = buildJobView(jobs.get('filejob123')!, { artifacts: listJobArtifacts(fileDir) as Artifact[] })
assert.equal(view.kind, 'file')

rmSync(root, { recursive: true, force: true })
console.log('remote mcp tests passed')
