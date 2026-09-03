import { buildJobView, parseJobId, parseJobUrl, type Artifact, type JobRecord } from './apiJobsModel'

export interface McpJobBackend {
  createJob(url: string): { id: string; status: string; url: string }
  getJob(id: string): JobRecord | null
  listJobs(): JobRecord[]
  artifactsFor(id: string): Artifact[]
  ownedPathsFor(id: string): string[]
  cancelJob(id: string): 'ok' | 'not_found' | 'not_cancellable'
  allowMcpWrite(): boolean
  requireMcpConfirm(): boolean
}

export const MCP_PROTOCOL_VERSION = '2025-03-26'
export const MCP_SERVER_NAME = 'v-download'
export const MCP_SERVER_VERSION = '1.1.7'
export const MCP_LOG_LIMIT_MAX = 300

export const MCP_TOOL_NAMES = [
  'health',
  'list_jobs',
  'get_job',
  'get_job_files',
  'enqueue_job',
  'cancel_job',
] as const

export type McpToolName = (typeof MCP_TOOL_NAMES)[number]

export interface McpLogEntry {
  timestamp: string
  tool: string
  category: 'read' | 'write'
  argumentSummary: string
  success: boolean
  elapsedMs: number
  errorCode?: string | null
  message: string
}

export interface McpClientConfig {
  text: string
  json: {
    mcpServers: {
      'v-download': {
        url: string
        headers: { Authorization: string }
      }
    }
  }
}

const WRITE_TOOLS = new Set<McpToolName>(['enqueue_job', 'cancel_job'])

const TOOL_SCHEMAS: Array<{
  name: McpToolName
  description: string
  inputSchema: Record<string, unknown>
}> = [
  {
    name: 'health',
    description: 'Check that the V-Download Remote Job API process is up.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_jobs',
    description: 'List Remote Job API jobs (id, status, url, title, progress). Does not return file bytes.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_job',
    description: 'Get one Remote Job API job snapshot by id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Job id' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_job_files',
    description: 'List artifact names and sizes for one job. Only files under that job’s remote-jobs folder.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Job id' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'enqueue_job',
    description: 'Enqueue a download URL. Write tool: requires allow-write and confirm:true when confirmation is on.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'http(s) URL to download' },
        confirm: { type: 'boolean', description: 'Must be true when confirmation is required' },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
  {
    name: 'cancel_job',
    description: 'Cancel a queued or downloading job. Write tool: requires allow-write and confirm:true when confirmation is on.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Job id' },
        confirm: { type: 'boolean', description: 'Must be true when confirmation is required' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
]

let logs: McpLogEntry[] = []
let lastClientName = 'unknown'

export function clearMcpLogs(): void {
  logs = []
}

export function recordMcpLog(entry: McpLogEntry): void {
  logs.unshift(entry)
  if (logs.length > MCP_LOG_LIMIT_MAX) logs = logs.slice(0, MCP_LOG_LIMIT_MAX)
}

export function getMcpLogs(limit = 50): McpLogEntry[] {
  const n = Math.min(MCP_LOG_LIMIT_MAX, Math.max(1, Math.floor(Number(limit) || 50)))
  return logs.slice(0, n)
}

export function buildMcpClientConfig(options: { host: string; port: number; token: string }): McpClientConfig {
  const host = options.host === '0.0.0.0' ? '127.0.0.1' : options.host
  const url = `http://${host}:${options.port}/mcp`
  const authorization = `Bearer ${options.token}`
  return {
    text: `URL: ${url}\nHeader: Authorization: ${authorization}`,
    json: {
      mcpServers: {
        'v-download': {
          url,
          headers: { Authorization: authorization },
        },
      },
    },
  }
}

export function summarizeMcpArguments(tool: string, args: Record<string, unknown> | undefined): string {
  const parts: string[] = [tool]
  if (!args) return parts.join(' ')
  if (typeof args.id === 'string') parts.push(`id=${args.id}`)
  if (typeof args.url === 'string') {
    try {
      parts.push(`host=${new URL(args.url).hostname}`)
    } catch {
      parts.push('host=?')
    }
  }
  if (args.confirm === true) parts.push('confirm')
  return parts.join(' ')
}

export function listJobSummaries(records: JobRecord[]): Array<{
  id: string
  status: string
  url: string
  title: string | null
  progress: number
  updatedAt: string
}> {
  return records.map((row) => ({
    id: row.id,
    status: row.status,
    url: row.url,
    title: row.title,
    progress: row.progress,
    updatedAt: row.updatedAt,
  }))
}

function jsonRpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }
}

function jsonRpcResult(id: unknown, result: unknown) {
  return { jsonrpc: '2.0', id, result }
}

function toolResult(payload: unknown, isError = false) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    isError,
  }
}

function asArgs(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function invokeTool(backend: McpJobBackend, name: string, rawArgs: unknown): { payload: unknown; isError: boolean; errorCode?: string } {
  if (!MCP_TOOL_NAMES.includes(name as McpToolName)) {
    return { payload: { error: { code: 'method_not_found', message: `Unknown tool: ${name}` } }, isError: true, errorCode: 'method_not_found' }
  }
  const tool = name as McpToolName
  const args = asArgs(rawArgs)

  if (WRITE_TOOLS.has(tool)) {
    if (!backend.allowMcpWrite()) {
      return { payload: { error: { code: 'write_disabled', message: 'MCP write tools are disabled' } }, isError: true, errorCode: 'write_disabled' }
    }
    if (backend.requireMcpConfirm() && args.confirm !== true) {
      return { payload: { error: { code: 'confirmation_required', message: 'Pass confirm: true to run this write tool' } }, isError: true, errorCode: 'confirmation_required' }
    }
  }

  if (tool === 'health') {
    return { payload: { ok: true, service: 'v-download-remote-api' }, isError: false }
  }

  if (tool === 'list_jobs') {
    return { payload: { jobs: listJobSummaries(backend.listJobs()) }, isError: false }
  }

  if (tool === 'get_job') {
    const parsed = parseJobId(args.id)
    if (!parsed.ok) return { payload: { error: parsed.error }, isError: true, errorCode: parsed.error.code }
    const record = backend.getJob(parsed.id)
    if (!record) return { payload: { error: { code: 'not_found', message: 'Job not found' } }, isError: true, errorCode: 'not_found' }
    return { payload: buildJobView(record, { artifacts: backend.artifactsFor(record.id) }), isError: false }
  }

  if (tool === 'get_job_files') {
    const parsed = parseJobId(args.id)
    if (!parsed.ok) return { payload: { error: parsed.error }, isError: true, errorCode: parsed.error.code }
    const record = backend.getJob(parsed.id)
    if (!record) return { payload: { error: { code: 'not_found', message: 'Job not found' } }, isError: true, errorCode: 'not_found' }
    const owned = backend.ownedPathsFor(parsed.id)
    return {
      payload: {
        files: backend.artifactsFor(parsed.id),
        directory: owned[0] ?? null,
      },
      isError: false,
    }
  }

  if (tool === 'enqueue_job') {
    const parsed = parseJobUrl(args.url)
    if (!parsed.ok) return { payload: { error: parsed.error }, isError: true, errorCode: parsed.error.code }
    return { payload: backend.createJob(parsed.url), isError: false }
  }

  const parsed = parseJobId(args.id)
  if (!parsed.ok) return { payload: { error: parsed.error }, isError: true, errorCode: parsed.error.code }
  const result = backend.cancelJob(parsed.id)
  if (result === 'not_found') return { payload: { error: { code: 'not_found', message: 'Job not found' } }, isError: true, errorCode: 'not_found' }
  if (result === 'not_cancellable') {
    return { payload: { error: { code: 'not_cancellable', message: 'Job is already finished' } }, isError: true, errorCode: 'not_cancellable' }
  }
  return { payload: { id: parsed.id, status: 'cancelled' }, isError: false }
}

export function dispatchMcpJsonRpc(
  message: unknown,
  backend: McpJobBackend,
): { type: 'notification' } | { type: 'response'; body: unknown } {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return { type: 'response', body: jsonRpcError(null, -32600, 'Invalid Request') }
  }
  const req = message as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown }
  if (req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
    return { type: 'response', body: jsonRpcError(req.id ?? null, -32600, 'Invalid Request') }
  }
  const isNotification = !('id' in req)
  if (req.method.startsWith('notifications/')) {
    return isNotification ? { type: 'notification' } : { type: 'response', body: jsonRpcResult(req.id, {}) }
  }

  if (req.method === 'initialize') {
    const params = asArgs(req.params)
    const client = asArgs(params.clientInfo)
    if (typeof client.name === 'string' && client.name.trim()) lastClientName = client.name.trim().slice(0, 80)
    return {
      type: 'response',
      body: jsonRpcResult(req.id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
      }),
    }
  }

  if (req.method === 'ping') {
    return { type: 'response', body: jsonRpcResult(req.id, {}) }
  }

  if (req.method === 'tools/list') {
    return { type: 'response', body: jsonRpcResult(req.id, { tools: TOOL_SCHEMAS }) }
  }

  if (req.method === 'tools/call') {
    const params = asArgs(req.params)
    const name = typeof params.name === 'string' ? params.name : ''
    const started = Date.now()
    const args = asArgs(params.arguments)
    const called = invokeTool(backend, name, args)
    const category: 'read' | 'write' = WRITE_TOOLS.has(name as McpToolName) ? 'write' : 'read'
    recordMcpLog({
      timestamp: new Date().toISOString(),
      tool: name || 'unknown',
      category,
      argumentSummary: `${lastClientName} · ${summarizeMcpArguments(name || 'unknown', args)}`,
      success: !called.isError,
      elapsedMs: Date.now() - started,
      errorCode: called.errorCode ?? null,
      message: called.isError ? String((called.payload as { error?: { message?: string } }).error?.message ?? 'error') : 'ok',
    })
    return { type: 'response', body: jsonRpcResult(req.id, toolResult(called.payload, called.isError)) }
  }

  if (isNotification) return { type: 'notification' }
  return { type: 'response', body: jsonRpcError(req.id, -32601, `Method not found: ${req.method}`) }
}
