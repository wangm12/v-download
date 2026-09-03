# MCP Facade Implementation Plan

> Archived. Living contract: [REMOTE_JOB_API.md](../../REMOTE_JOB_API.md). Spec: [2026-08-31-mcp-facade-design.md](./2026-08-31-mcp-facade-design.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve a localhost MCP JSON-RPC endpoint on the existing Remote Job API listener, plus `GET /v1/jobs`, write gates, copy-config UI, and redacted logs.

**Architecture:** Pure `remoteMcpModel.ts` (tools, logs, config text) + `dispatchRemoteApi` routes for `POST /mcp` and `GET /v1/jobs`. Same Bearer auth. Backend gains `listJobs` and MCP policy getters. Preferences stay in the existing Remote Job API card.

**Tech Stack:** Node `http` already used by `remoteApiHttp.ts`, JSON-RPC subset (no MCP SDK), existing `hasApiAuth`, React preferences, `tsx` tests.

## Global Constraints

- Same bind/port/token as Remote Job API; no second server.
- Writes default off; `confirm: true` required when confirm setting is on.
- Do not expose files outside `{downloadDir}/remote-jobs/{id}`.
- Do not log tokens, cookies, or raw query strings.
- No IM / WebSocket MCP.

---

## File map

- `src/main/remoteMcpModel.ts` — tools catalog, JSON-RPC helpers, log ring, client config, argument summary.
- `src/main/remoteApiHandler.ts` — `/mcp`, `GET /v1/jobs`, `GET /v1/mcp/logs`.
- `src/main/remoteJobService.ts` — `listJobs`, policy from settings.
- `src/main/settings.ts` + renderer settings types — `remoteApiMcpAllowWrite`, `remoteApiMcpRequireConfirm`.
- `src/main/ipc/settings.ts` + preload — `get-remote-mcp-logs`.
- `PreferencesPanel.tsx` — copy MCP config, toggles, logs.
- `docs/REMOTE_JOB_API.md` + README — document `/mcp` and list-jobs.
- `scripts/test-remote-mcp.ts` + extend `scripts/test-remote-api.ts`.

## Task 1: Failing MCP tests

- [ ] Add `scripts/test-remote-mcp.ts` for initialize, tools/list, write gates, log redaction, list_jobs.
- [ ] Extend remote-api tests for `GET /v1/jobs` 401/200.
- [ ] Run tests; confirm they fail for the right reason.

## Task 2: Model + dispatch

- [ ] Implement model + handler routes until `test:remote-mcp` and `test:remote-api` pass.
- [ ] Wire `listJobs` on the Electron backend.

## Task 3: Settings + UI

- [ ] Persist the two booleans.
- [ ] Copy config + logs in Preferences (same card).
- [ ] `test:presentation` still passes (section count unchanged).

## Task 4: Docs + npm script

- [ ] Document endpoints in `REMOTE_JOB_API.md`.
- [ ] Mention MCP in README settings / architecture.
- [ ] Add `test:remote-mcp` to `npm test`.
