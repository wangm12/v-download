# MCP facade over Remote Job API — design

**Status:** shipped — contract is [REMOTE_JOB_API.md](../../REMOTE_JOB_API.md)  
**Product:** agent control of the **same** queue, not a second downloader  
**Plan:** [2026-08-31-mcp-facade.md](./2026-08-31-mcp-facade.md)

## Problem

[`docs/REMOTE_JOB_API.md`](../../REMOTE_JOB_API.md) already gives Bearer `/v1/jobs` on `:18766`. Claude Code / Codex / similar tools speak **MCP**, not ad-hoc REST. The REST surface also has no list-jobs endpoint and no call log.

## Goal

When Remote Job API is enabled, the **same** HTTP server also serves a localhost MCP endpoint:

- `POST /mcp` — JSON-RPC 2.0 (`initialize`, `tools/list`, `tools/call`, `ping`, `notifications/initialized`)
- Same `Authorization: Bearer` as `/v1`
- Tools wrap existing job operations only
- Writes off by default; confirmation required when enabled
- Preferences: copy client config, write toggle, confirm toggle, redacted logs
- `GET /v1/jobs` — list snapshots (no file bodies)

No extra port. No `@modelcontextprotocol` dependency (Electron-main stays a small Node handler). No library-wide file server. No IM WebSocket.

## Tools

| Tool | Category | Maps to |
|------|----------|---------|
| `health` | read | `GET /health` body |
| `list_jobs` | read | new `GET /v1/jobs` |
| `get_job` | read | `GET /v1/jobs/:id` |
| `get_job_files` | read | artifact **names + sizes** (+ job output directory for local agents). Not the rest of `downloadDir`. |
| `enqueue_job` | write | `POST /v1/jobs` `{ url }` |
| `cancel_job` | write | `POST /v1/jobs/:id/cancel` |

Write tools require `remoteApiMcpAllowWrite === true`. If `remoteApiMcpRequireConfirm === true` (default), arguments must include `confirm: true`.

## Settings

| Key | Default |
|-----|---------|
| `remoteApiMcpAllowWrite` | `false` |
| `remoteApiMcpRequireConfirm` | `true` |

MCP is on whenever `remoteApiEnabled` is on (no third listener).

## Wire protocol (subset)

- HTTP 401 if Bearer missing/wrong (same `hasApiAuth`)
- Request: `{ "jsonrpc":"2.0", "id": …, "method":"…", "params": … }`
- `initialize` result: `protocolVersion: "2025-03-26"`, `capabilities.tools`, `serverInfo: { name: "v-download", version }`
- `tools/call` result: `{ content: [{ type: "text", text: "<json>" }], isError?: true }`
- Notification (no `id`): HTTP 204
- `GET /mcp`: 405, `Allow: POST`

## Logs

In-memory ring (300). Fields: `timestamp`, `tool`, `category`, `argumentSummary` (host + job id only), `success`, `elapsedMs`, `errorCode`, `message`. Never store Bearer tokens, cookies, or full URLs with query strings.

`GET /v1/mcp/logs?limit=` (auth) and IPC `get-remote-mcp-logs` for Preferences.

## Client config (copy)

```
URL: http://127.0.0.1:18766/mcp
Header: Authorization: Bearer <token>
```

Plus a JSON snippet for `mcpServers.v-download`.

## UI

Stay inside the existing **Remote Job API** preferences card (do not add a 14th section title). Toggles + copy + last N log lines. Pause polling when Advanced is not visible.

## Tests

- 401 without token on `/mcp` and `/v1/jobs`
- `tools/list` names
- `enqueue_job` fails when write disabled; fails without `confirm` when required; succeeds when both set
- `get_job_files` never returns a path outside that job’s `remote-jobs/{id}` tree
- Log redaction
- `GET /v1/jobs` returns created jobs, no `files` blobs
