import assert from 'node:assert/strict'
import { MCP_TOOL_NAMES as APP_TOOL_NAMES } from '../src/main/remoteMcpModel'
import {
  MCP_TOOL_NAMES,
  StdioFramer,
  defaultSettingsCandidates,
  dispatchStdioMessage,
  encodeMcpFrame,
  readRemoteApiTarget
} from './v-download-mcp-stdio.mjs'

assert.deepEqual([...MCP_TOOL_NAMES].sort(), [...APP_TOOL_NAMES].sort())

assert.deepEqual(
  defaultSettingsCandidates('/Users/demo', {} as NodeJS.ProcessEnv, 'darwin'),
  ['/Users/demo/Library/Application Support/V-Download/settings.json']
)
assert.deepEqual(
  defaultSettingsCandidates('/Users/demo', { V_DOWNLOAD_SETTINGS: '/tmp/settings.json' } as NodeJS.ProcessEnv, 'darwin'),
  ['/tmp/settings.json']
)

const disabled = readRemoteApiTarget(JSON.stringify({ remoteApiEnabled: false }))
assert.equal(disabled.ok, false)
if (!disabled.ok) assert.equal(disabled.error, 'remote_api_disabled')

const enabled = readRemoteApiTarget(JSON.stringify({
  remoteApiEnabled: true,
  remoteApiToken: 'a'.repeat(32),
  remoteApiPort: 18766
}))
assert.equal(enabled.ok, true)
if (enabled.ok) {
  assert.equal(enabled.url, 'http://127.0.0.1:18766/mcp')
  assert.equal(enabled.token, 'a'.repeat(32))
}

const envTarget = readRemoteApiTarget('{}', {
  V_DOWNLOAD_MCP_URL: 'http://127.0.0.1:19999/mcp',
  V_DOWNLOAD_MCP_TOKEN: 'envtoken-envtoken'
} as NodeJS.ProcessEnv)
assert.equal(envTarget.ok, true)
if (envTarget.ok) assert.equal(envTarget.url, 'http://127.0.0.1:19999/mcp')

const framer = new StdioFramer()
const framed = encodeMcpFrame({ jsonrpc: '2.0', id: 1, method: 'initialize' })
assert.deepEqual(framer.push(framed), [{ jsonrpc: '2.0', id: 1, method: 'initialize' }])
assert.deepEqual(framer.push(Buffer.from('{"jsonrpc":"2.0","id":2,"method":"ping"}\n')), [
  { jsonrpc: '2.0', id: 2, method: 'ping' }
])

async function main() {
const offline = await dispatchStdioMessage(
  { jsonrpc: '2.0', id: 3, method: 'tools/list' },
  { target: { ok: false, error: 'remote_api_disabled', message: 'off' }, fetchImpl: async () => { throw new Error('no') } }
)
assert.equal(offline.type, 'response')
if (offline.type === 'response') {
  const body = offline.body as { result?: { tools?: Array<{ name: string }> } }
  assert.deepEqual(body.result?.tools?.map((tool) => tool.name).sort(), [...MCP_TOOL_NAMES].sort())
}

const proxied = await dispatchStdioMessage(
  { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'health', arguments: {} } },
  {
    target: { ok: true, url: 'http://127.0.0.1:18766/mcp', token: 't'.repeat(24), enabled: true },
    fetchImpl: async (url, init) => {
      assert.equal(url, 'http://127.0.0.1:18766/mcp')
      assert.equal((init?.headers as { Authorization?: string }).Authorization, `Bearer ${'t'.repeat(24)}`)
      return {
        status: 200,
        ok: true,
        async json() {
          return { jsonrpc: '2.0', id: 4, result: { ok: true } }
        },
        async text() {
          return ''
        }
      }
    }
  }
)
assert.deepEqual(proxied, { type: 'response', body: { jsonrpc: '2.0', id: 4, result: { ok: true } } })

console.log('v-download mcp stdio tests passed')
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
