#!/usr/bin/env node
/**
 * Cursor stdio bridge for the V-Download HTTP MCP listener.
 * Reads the Bearer token from the running app's settings.json — do not log it.
 */
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'

export const MCP_PROTOCOL_VERSION = '2025-03-26'
export const MCP_SERVER_NAME = 'v-download'
export const MCP_SERVER_VERSION = '1.1.7'

export const MCP_TOOL_NAMES = [
  'health',
  'list_jobs',
  'get_job',
  'get_job_files',
  'enqueue_job',
  'cancel_job'
]

const WRITE_TOOLS = new Set(['enqueue_job', 'cancel_job'])

const TOOL_SCHEMAS = [
  {
    name: 'health',
    description: 'Check that the V-Download Remote Job API process is up.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'list_jobs',
    description: 'List Remote Job API jobs (id, status, url, title, progress). Does not return file bytes.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'get_job',
    description: 'Get one Remote Job API job snapshot by id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Job id' } },
      required: ['id'],
      additionalProperties: false
    }
  },
  {
    name: 'get_job_files',
    description: 'List artifact names and sizes for one job. Only files under that job’s remote-jobs folder.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Job id' } },
      required: ['id'],
      additionalProperties: false
    }
  },
  {
    name: 'enqueue_job',
    description: 'Enqueue a download URL. Write tool: requires allow-write and confirm:true when confirmation is on.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'http(s) URL to download' },
        confirm: { type: 'boolean', description: 'Must be true when confirmation is required' },
        include_note: { type: 'boolean', description: 'When true, save caption as Markdown next to the media' }
      },
      required: ['url'],
      additionalProperties: false
    }
  },
  {
    name: 'cancel_job',
    description: 'Cancel a queued or downloading job. Write tool: requires allow-write and confirm:true when confirmation is on.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Job id' },
        confirm: { type: 'boolean', description: 'Must be true when confirmation is required' }
      },
      required: ['id'],
      additionalProperties: false
    }
  }
]

export function defaultSettingsCandidates(home = homedir(), env = process.env, platform = process.platform) {
  if (env.V_DOWNLOAD_SETTINGS) return [env.V_DOWNLOAD_SETTINGS]
  if (platform === 'darwin') {
    return [join(home, 'Library', 'Application Support', 'V-Download', 'settings.json')]
  }
  if (platform === 'win32') {
    const root = env.APPDATA || join(home, 'AppData', 'Roaming')
    return [join(root, 'V-Download', 'settings.json')]
  }
  const xdg = env.XDG_CONFIG_HOME || join(home, '.config')
  return [join(xdg, 'V-Download', 'settings.json')]
}

export function readRemoteApiTarget(settingsText, env = process.env) {
  if (env.V_DOWNLOAD_MCP_URL && env.V_DOWNLOAD_MCP_TOKEN) {
    return {
      ok: true,
      url: env.V_DOWNLOAD_MCP_URL,
      token: env.V_DOWNLOAD_MCP_TOKEN,
      enabled: true
    }
  }
  let parsed
  try {
    parsed = JSON.parse(settingsText)
  } catch {
    return { ok: false, error: 'settings_invalid', message: 'V-Download settings.json is not valid JSON.' }
  }
  const token = typeof parsed.remoteApiToken === 'string' ? parsed.remoteApiToken : ''
  const port = Number(parsed.remoteApiPort)
  const enabled = parsed.remoteApiEnabled === true
  if (!enabled) {
    return {
      ok: false,
      error: 'remote_api_disabled',
      message: 'Open V-Download → MCP and turn on Enable Remote API.'
    }
  }
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) {
    return { ok: false, error: 'missing_token', message: 'Remote API is on but no Bearer token is stored.' }
  }
  const safePort = Number.isFinite(port) && port !== 18765 ? Math.min(65535, Math.max(1024, Math.floor(port))) : 18766
  return {
    ok: true,
    url: `http://127.0.0.1:${safePort}/mcp`,
    token,
    enabled: true
  }
}

export function indexOfHeaderEnd(buf) {
  const crlf = buf.indexOf('\r\n\r\n')
  if (crlf >= 0) return crlf + 4
  const lf = buf.indexOf('\n\n')
  if (lf >= 0) return lf + 2
  return -1
}

export function encodeMcpFrame(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8')
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf8'), body])
}

export class StdioFramer {
  constructor() {
    this.buf = Buffer.alloc(0)
  }

  push(chunk) {
    this.buf = Buffer.concat([this.buf, Buffer.from(chunk)])
    const messages = []
    for (;;) {
      const next = this.shift()
      if (next === undefined) break
      messages.push(next)
    }
    return messages
  }

  shift() {
    const headerEnd = indexOfHeaderEnd(this.buf)
    if (headerEnd < 0) {
      const nl = this.buf.indexOf(0x0a)
      if (nl >= 0 && this.buf[0] === 0x7b) {
        const line = this.buf.subarray(0, nl).toString('utf8').trim()
        this.buf = this.buf.subarray(nl + 1)
        if (!line) return this.shift()
        return JSON.parse(line)
      }
      return undefined
    }
    const header = this.buf.subarray(0, headerEnd).toString('utf8')
    const match = header.match(/Content-Length:\s*(\d+)/i)
    if (!match) throw new Error('missing Content-Length')
    const len = Number(match[1])
    if (this.buf.length < headerEnd + len) return undefined
    const body = this.buf.subarray(headerEnd, headerEnd + len).toString('utf8')
    this.buf = this.buf.subarray(headerEnd + len)
    return JSON.parse(body)
  }
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }
}

function jsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id, result }
}

function toolResult(payload, isError = false) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    isError
  }
}

function localResponse(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return { type: 'response', body: jsonRpcError(null, -32600, 'Invalid Request') }
  }
  const req = message
  if (req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
    return { type: 'response', body: jsonRpcError(req.id ?? null, -32600, 'Invalid Request') }
  }
  const isNotification = !Object.prototype.hasOwnProperty.call(req, 'id')
  if (req.method.startsWith('notifications/')) {
    return isNotification ? { type: 'notification' } : { type: 'response', body: jsonRpcResult(req.id, {}) }
  }
  if (req.method === 'initialize') {
    return {
      type: 'response',
      body: jsonRpcResult(req.id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION }
      })
    }
  }
  if (req.method === 'ping') {
    return { type: 'response', body: jsonRpcResult(req.id, {}) }
  }
  if (req.method === 'tools/list') {
    return { type: 'response', body: jsonRpcResult(req.id, { tools: TOOL_SCHEMAS }) }
  }
  if (req.method === 'tools/call') {
    const name = req.params && typeof req.params.name === 'string' ? req.params.name : ''
    const kind = WRITE_TOOLS.has(name) ? 'write' : 'read'
    return {
      type: 'response',
      body: jsonRpcResult(
        req.id,
        toolResult({
          error: {
            code: 'app_offline',
            message: `V-Download is not reachable for ${kind} tool ${name || 'unknown'}. Open the app, sidebar MCP, and enable Remote API.`
          }
        }, true)
      )
    }
  }
  if (isNotification) return { type: 'notification' }
  return { type: 'response', body: jsonRpcError(req.id, -32601, `Method not found: ${req.method}`) }
}

export async function dispatchStdioMessage(message, options) {
  const target = options.target
  if (!target?.ok) return localResponse(message)
  try {
    const res = await options.fetchImpl(target.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${target.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(message)
    })
    if (res.status === 204) return { type: 'notification' }
    if (!res.ok) {
      const text = await res.text()
      const id = message && typeof message === 'object' ? message.id : null
      return {
        type: 'response',
        body: jsonRpcError(id ?? null, -32000, `Remote MCP HTTP ${res.status}: ${text.slice(0, 200)}`)
      }
    }
    const body = await res.json()
    return { type: 'response', body }
  } catch {
    return localResponse(message)
  }
}

function loadTarget() {
  if (process.env.V_DOWNLOAD_MCP_URL && process.env.V_DOWNLOAD_MCP_TOKEN) {
    return readRemoteApiTarget('{}', process.env)
  }
  for (const path of defaultSettingsCandidates()) {
    try {
      return readRemoteApiTarget(readFileSync(path, 'utf8'))
    } catch {
      /* try next */
    }
  }
  return {
    ok: false,
    error: 'settings_missing',
    message: 'Open V-Download → MCP and turn on Enable Remote API.'
  }
}

function writeFrame(message) {
  process.stdout.write(encodeMcpFrame(message))
}

async function main() {
  const framer = new StdioFramer()
  process.stdin.on('data', (chunk) => {
    let messages
    try {
      messages = framer.push(chunk)
    } catch (error) {
      process.stderr.write(`v-download-mcp-stdio: parse error: ${error instanceof Error ? error.message : error}\n`)
      return
    }
    for (const message of messages) {
      void dispatchStdioMessage(message, { target: loadTarget(), fetchImpl: globalThis.fetch.bind(globalThis) }).then((result) => {
        if (result.type === 'response') writeFrame(result.body)
      })
    }
  })
  process.stdin.on('end', () => process.exit(0))
  process.stdin.resume()
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main()
}
