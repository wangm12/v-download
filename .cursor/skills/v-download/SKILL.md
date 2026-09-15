---
name: v-download
description: Enqueue and inspect downloads through the running V-Download desktop app (MCP tools health, list_jobs, get_job, get_job_files, enqueue_job, cancel_job, or the same REST API on 127.0.0.1:18766). Use when the user wants V-Download to download a URL, check remote job status, cancel a remote job, or connect an agent to the app's MCP server.
---

# V-Download

The desktop app does the download. Do not fetch media with curl, yt-dlp, or a browser.

## Before calling

1. V-Download must be running.
2. In the app, open sidebar **MCP** and turn on **Enable Remote API**.
3. Writes (`enqueue_job`, `cancel_job`) need **Allow MCP write tools**. If **Require confirm on writes** is on, pass `"confirm": true`.

Prefer MCP tools if a **v-download** server is connected. Otherwise use HTTP on `http://127.0.0.1:18766` with `Authorization: Bearer <token>` from that MCP panel. Never print the token.

`GET /health` has no auth. If it fails, tell the user to open V-Download and enable MCP.

## Tools

| Tool | Writes | Arguments |
|------|--------|-----------|
| `health` | no | none |
| `list_jobs` | no | none |
| `get_job` | no | `id` |
| `get_job_files` | no | `id` (names and sizes only) |
| `enqueue_job` | yes | `url` (http/https), optional `include_note`, `confirm` |
| `cancel_job` | yes | `id`, `confirm` |

`include_note` defaults to false. Set true only when the user asked to save the caption as Markdown.

## Workflow

1. `health`
2. `enqueue_job` with the URL
3. Poll `get_job` until `complete` / `error` / `cancelled`
4. `get_job_files` for artifact names. Open/reveal stays in the app or OS.

REST equivalents: `POST /v1/jobs`, `GET /v1/jobs`, `GET /v1/jobs/:id`, `POST /v1/jobs/:id/cancel`. Caption flag is `"include_note": true`.

## Errors to surface

- App not running / Remote API off → user must launch V-Download and enable **MCP**
- `write_disabled` → enable **Allow MCP write tools**
- `confirmation_required` → retry with `confirm: true`
- `no_media` → page had no downloadable media
