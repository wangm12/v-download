# Remote Job API

HTTP API on the **running V-Download desktop app**. Other programs enqueue a URL; the app **resolves it the same way as a paste in the UI** (gallery vs video vs text), then downloads with the same queue, cookies, yt-dlp/ffmpeg engines, and quality settings. Caption Markdown is **opt-in**: pass `"include_note": true` (default `false`). Without that flag the job is media only.

This is **not** the Chrome extension pairing server. The extension talks to `127.0.0.1:18765`. This API is a separate listener (default `:18766`).

| | Extension pairing | Remote Job API |
|---|---|---|
| Default bind | `127.0.0.1` only | `127.0.0.1` (optional `0.0.0.0`) |
| Default port | `18765` | `18766` |
| Auth | localhost pairing | `Authorization: Bearer <token>` |
| Purpose | cookies + send-to-app from Chrome | enqueue / poll / fetch files from any client |

The API is **off by default**. V-Download must stay running while you use it.

---

## Enable

1. Open V-Download → sidebar **Preferences** → **Advanced** → **Remote Job API**.
2. Turn **Enable Remote API** on. A Bearer token is generated if none exists.
3. Leave **Bind** on `127.0.0.1 (this Mac only)` unless another machine on your LAN / Tailscale must reach the app.
4. Keep **Port** at `18766` unless it conflicts. Port `18765` is reserved and rejected.

The token is stored in app settings (`0600` on the settings file). Copy or regenerate it from that panel. Regenerating invalidates the old token immediately.

---

## Base URL

```
http://<bind>:<port>
```

| Bind | Who can connect |
|---|---|
| `127.0.0.1` (default) | Only this Mac |
| `0.0.0.0` | LAN / Tailscale — clients use this Mac’s LAN or Tailscale IP, not `0.0.0.0` |

Examples:

```
http://127.0.0.1:18766
http://192.168.1.20:18766
```

HTTP only. No TLS. Trailing slashes on paths are ignored (`/v1/jobs/` = `/v1/jobs`).

---

## Authentication

Every `/v1/...` request needs:

```http
Authorization: Bearer <token>
```

- Header name is case-insensitive (`authorization` is fine).
- Scheme must be `Bearer ` (capital B, one space).
- Comparison is timing-safe. Wrong length or wrong value → `401`.
- Missing header → `401`.
- Empty stored token → every `/v1` request fails (server will not start without a token).

Health endpoints do **not** require a token.

Token shape: 16–128 characters, `[A-Za-z0-9_-]`. The app generates a 48-character hex string (24 random bytes).

---

## Conventions

| Topic | Rule |
|---|---|
| JSON requests | `Content-Type: application/json`. Body is parsed as JSON regardless; invalid JSON is `400`. |
| JSON responses | `Content-Type: application/json; charset=utf-8` |
| Request body limit | **64 KiB**. Over that → `413` `{ "error": { "code": "payload_too_large" } }` |
| Create-job body | `{ "url": "..." }` plus optional boolean `include_note` (default `false`). Any other key → `400` `unexpected_field`. |
| URL | `http` or `https`, 8–8192 characters after trim. |
| Job id | `[A-Za-z0-9_-]{8,32}`. The app issues 16 hex characters. |
| Errors | Always `{ "error": { "code": string, "message": string, "details"?: object } }` |
| File names | Basename only. `/`, `\`, `..`, NUL → `400` `invalid_name`. |

There is **no** webhook or quality/format field on create. Quality comes from Preferences (`defaultVideoQuality`). Jobs also show up in the Downloads queue. Set `include_note: true` to write caption Markdown (`note.md` in a gallery, sidecar `.md` next to a video, or a lone `.md` for text-only posts). Text-only posts without `include_note` fail with `no_media`.

`GET /v1/jobs` lists job snapshots (no file bodies). `POST /mcp` is a JSON-RPC MCP facade on the same listener and Bearer token.

---

## Quick start

```bash
export VDL_TOKEN='paste-token-from-preferences'
export VDL_HOST='http://127.0.0.1:18766'

# Is the server up? (no token)
curl -sS "$VDL_HOST/health"

# Enqueue
JOB=$(curl -sS -X POST "$VDL_HOST/v1/jobs" \
  -H "Authorization: Bearer $VDL_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}')
echo "$JOB"
# {"id":"a1b2c3d4e5f67890","status":"queued","url":"https://..."}

ID=$(printf '%s' "$JOB" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')

# Poll until complete / error / cancelled
curl -sS -H "Authorization: Bearer $VDL_TOKEN" "$VDL_HOST/v1/jobs/$ID"

# Single file
curl -sS -H "Authorization: Bearer $VDL_TOKEN" \
  -o out.mp4 "$VDL_HOST/v1/jobs/$ID/file"

# Or cancel while queued / downloading
curl -sS -X POST -H "Authorization: Bearer $VDL_TOKEN" \
  "$VDL_HOST/v1/jobs/$ID/cancel"
```

---

## Endpoints

### `GET /health`

Alias: `GET /api/health`

No auth. Process liveness only — does not prove a token is valid.

**200**

```json
{ "ok": true, "service": "v-download-remote-api" }
```

---

### `GET /v1/jobs`

List Remote Job API jobs. Newest `updatedAt` first. Auth required. Does **not** include file bytes or paths.

**200**

```json
{
  "jobs": [
    {
      "id": "a1b2c3d4e5f67890",
      "status": "queued",
      "url": "https://example.com/watch?v=1",
      "title": null,
      "progress": 0,
      "updatedAt": "2026-08-31T08:00:00.000Z"
    }
  ]
}
```

---

### `POST /mcp`

JSON-RPC 2.0 MCP endpoint for Claude Code / Codex / similar agents. Same Bearer token as `/v1`. `GET /mcp` returns `405`.

Methods: `initialize`, `ping`, `tools/list`, `tools/call`, `notifications/initialized`.

| Tool | Kind | Maps to |
|------|------|---------|
| `health` | read | `GET /health` |
| `list_jobs` | read | `GET /v1/jobs` |
| `get_job` | read | `GET /v1/jobs/:id` |
| `get_job_files` | read | artifact names/sizes for that job only |
| `enqueue_job` | write | `POST /v1/jobs` |
| `cancel_job` | write | `POST /v1/jobs/:id/cancel` |

Write tools are **off** until Preferences → Advanced → **Allow MCP write tools**. When **Require confirm on writes** is on (default), pass `"confirm": true` in the tool arguments. `enqueue_job` accepts the same optional `"include_note"` boolean as `POST /v1/jobs` (default `false`).

Copy the client config block from that same preferences card (`URL` + `Authorization: Bearer …`).

`GET /v1/mcp/logs?limit=50` (auth) returns a redacted in-memory call log. Tokens, cookies, and URL query strings are not stored.

---

### `POST /v1/jobs`

Create a job and return immediately. Download starts in the background.

**Request**

```json
{ "url": "https://example.com/watch?v=1", "include_note": false }
```

`include_note` is optional and defaults to `false`. `true` saves the parsed caption as Markdown.

**202**

```json
{
  "id": "a1b2c3d4e5f67890",
  "status": "queued",
  "url": "https://example.com/watch?v=1"
}
```

`url` in the response is the normalized URL (`new URL(...).toString()`).

**Errors**

| Status | `error.code` | When |
|---|---|---|
| 401 | `unauthorized` | Missing / wrong Bearer token |
| 400 | `invalid_url` | Missing body, not a JSON object, bad / non-http(s) URL, invalid JSON text |
| 400 | `unexpected_field` | Any key other than `url` / `include_note`, or a non-boolean `include_note` |
| 413 | `payload_too_large` | Body > 64 KiB |

---

### `GET /v1/jobs/:id`

Job snapshot. Poll this. There is no push channel.

**200** — see [Job object](#job-object).

**Errors**

| Status | `error.code` |
|---|---|
| 401 | `unauthorized` |
| 400 | `invalid_id` |
| 404 | `not_found` |

---

### `POST /v1/jobs/:id/cancel`

Cancel a job that is still `queued` or `downloading`. Cancels every underlying download task in that job.

**200**

```json
{ "id": "a1b2c3d4e5f67890", "status": "cancelled" }
```

**Errors**

| Status | `error.code` | When |
|---|---|---|
| 401 | `unauthorized` | |
| 400 | `invalid_id` | |
| 404 | `not_found` | |
| 409 | `not_cancellable` | Already `complete`, `error`, or `cancelled` |

---

### `GET /v1/jobs/:id/file`

Stream the **only** media file when `kind` is `"file"`.

**200** — raw bytes.

| Header | Value |
|---|---|
| `Content-Type` | From extension (see [MIME types](#mime-types)); else `application/octet-stream` |
| `Content-Length` | File size |
| `Content-Disposition` | `attachment; filename="..."; filename*=UTF-8''...` |
| `Accept-Ranges` | `bytes` **only** when the name ends in `.mp4` |

The server always sends the **whole** file. `Range` is not implemented; do not expect `206`.

**Errors**

| Status | `error.code` | When |
|---|---|---|
| 409 | `not_ready` | `queued` or `downloading` |
| 409 | `cancelled` | Job was cancelled |
| 409 | *(job error)* | Job `error` — body is that error (`download_failed`, `auth_required`, …) |
| 409 | `multiple_files` | `kind` is `gallery` or `collection`. Use `/files/:name` or `/archive`. `details`: `{ kind, count }` |
| 410 | `expired` | Status is `complete` but files are gone |
| 400 | `invalid_name` | Resolved name failed the safety check |
| 404 | `not_found` | Unknown job |

---

### `GET /v1/jobs/:id/files/:name`

One named artifact. `:name` is a single path segment (URL-decoded). Must match a name in `files[]`.

Example: `/v1/jobs/a1b2c3d4e5f67890/files/001.jpg`

**200** — same file headers as `/file`.

**Errors**

| Status | `error.code` | When |
|---|---|---|
| 400 | `invalid_name` | Unsafe or `..` / slash (including encoded `..%2F`) |
| 404 | `file_not_found` | Name not in this job’s `files` |
| 404 | `not_found` | Unknown job |
| 409 | `not_ready` | Not `complete` |
| 410 | `expired` | Files missing |

---

### `GET /v1/jobs/:id/archive`

ZIP of every media file. Works for `file`, `gallery`, and `collection`.

**200**

| Header | Value |
|---|---|
| `Content-Type` | `application/zip` |
| `Content-Disposition` | `attachment` with `{sanitized-title}.zip` |

No `Content-Length` (streamed zip).

**Errors**

| Status | `error.code` | When |
|---|---|---|
| 409 | `not_ready` | `queued` / `downloading` |
| 409 | `error` / `cancelled` / job error | Finished without files |
| 410 | `expired` | No files left on disk |

---

### Other paths

| Request | Result |
|---|---|
| `/` or anything not `/health`, `/api/health`, or `/v1/...` | `404` `not_found` (no auth if the path is not under `/v1`) |
| `/v1` or `/v1/jobs` with GET | `401` then `404` (auth runs first on `/v1`) |
| Unknown `/v1/jobs/:id/...` | `404` `not_found` |
| Unhandled exception | `500` `{ "error": { "code": "download_failed", "message": "Internal error" } }` |

---

## Job object

Returned by `GET /v1/jobs/:id`.

```json
{
  "id": "a1b2c3d4e5f67890",
  "status": "complete",
  "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "title": "Video title",
  "progress": 100,
  "kind": "file",
  "files": [
    {
      "name": "Video title.mp4",
      "contentType": "video/mp4",
      "sizeBytes": 12345678,
      "index": 1
    }
  ],
  "error": null,
  "expiresAt": null,
  "expired": false
}
```

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Job id |
| `status` | string | See [Status](#status) |
| `url` | string | Submitted URL |
| `title` | string \| null | Filled in as yt-dlp / the queue learns the title |
| `progress` | number | `0`–`100`, integer. Average of the job’s download tasks. `100` when `complete`. |
| `kind` | `file` \| `gallery` \| `collection` \| null | Set only when `status` is `complete` and files exist |
| `files` | array \| null | `null` until `complete`. `[]` if `expired`. Otherwise media files only |
| `error` | object \| null | Set when `status` is `error` or `cancelled` |
| `expiresAt` | null | Always `null` in the desktop app (no TTL) |
| `expired` | boolean | `true` when `status` is `complete` and the files were deleted from disk |

`kind`:

| Value | Meaning | How to download |
|---|---|---|
| `file` | One video/audio file | `GET .../file` or `.../archive` |
| `gallery` | Two or more **images** only | `GET .../files/:name` or `.../archive` |
| `collection` | Mixed media, or a playlist/channel fan-out | `GET .../files/:name` or `.../archive` |
| `null` | Not finished, or complete with no usable media | — |

Ignored on-disk junk (`.part`, `.ytdl`, `ffmpeg2pass*`, `compressed_*`, dotfiles) never appears in `files`.

---

## Status

```
queued → downloading → complete
                    ↘ error
                    ↘ cancelled
```

| `status` | Meaning |
|---|---|
| `queued` | Accepted; no download task yet, or tasks still waiting |
| `downloading` | At least one task is `downloading` or `resolving` |
| `complete` | Every task finished; media should be on disk |
| `error` | Failed (after retries), or a collection item failed |
| `cancelled` | Client called `/cancel`, or the queue cancelled the tasks |

Poll `GET /v1/jobs/:id` until `complete`, `error`, or `cancelled`. A few hundred milliseconds to a few seconds is enough; the create call is already `202`.

---

## How a URL is handled

The body cannot set format or quality. The job uses **Preferences → default video quality**. Single URLs run the same `resolveVideoInfo` path as a UI paste before enqueue (not a blind `format: video` task).

| URL class | What happens |
|---|---|
| Direct media (path ends in `.mp4`, `.m3u8`, `.mp3`, `.jpg`, …) | One download task |
| Xiaohongshu image note | Image folder; `note.md` only when `include_note` is true |
| Xiaohongshu / X / other text-only (resolver has title or description, no media) | Lone `.md` when `include_note` is true; otherwise `no_media` |
| Ordinary watch page with video | One yt-dlp task; sidecar `.md` only when `include_note` is true |
| YouTube playlist / channel / `@handle` | **Collection.** If playlist mode is *fan-out*, each entry becomes a task (max **50**). Otherwise one playlist task. |

Cookies and site logins are whatever the desktop app already has (Chrome cookie sync, native auth). The API does not accept a cookie header.

Files are written under:

```
{downloadDir}/remote-jobs/{jobId}/
```

Default `downloadDir` is `~/Downloads`. Only files under that job folder are exposed through `/file`, `/files/:name`, and `/archive`. The rest of the library is not readable via this API.

### Retries

Transient download failures retry up to **3** attempts (`2s`, then `4s` delay). These codes are **not** retried: `auth_required`, `unsupported_live`, `file_too_large`, `collection_too_large`, `cancelled`, `no_media`.

If one item in a multi-item collection fails for good, the job becomes `error` with `collection_item_failed` and sibling tasks are cancelled.

---

## Error codes

Wire shape:

```json
{
  "error": {
    "code": "auth_required",
    "message": "human-readable, truncated to 500 characters",
    "details": { "id": "…" }
  }
}
```

`details` is optional.

### HTTP / request

| `code` | Typical status | Meaning |
|---|---|---|
| `unauthorized` | 401 | Bearer missing or wrong |
| `not_found` | 404 | Unknown path or job |
| `invalid_url` | 400 | Bad or missing `url` / invalid JSON |
| `unexpected_field` | 400 | Extra key on create, or non-boolean `include_note` |
| `invalid_id` | 400 | `:id` does not match `[A-Za-z0-9_-]{8,32}` |
| `invalid_name` | 400 | Unsafe file name |
| `payload_too_large` | 413 | Body > 64 KiB |
| `not_ready` | 409 | Files requested too early |
| `not_cancellable` | 409 | Cancel after the job already finished |
| `multiple_files` | 409 | Used `/file` on a gallery/collection |
| `file_not_found` | 404 | `:name` is not one of this job’s files |
| `expired` | 410 | Complete, but files are gone |
| `cancelled` | 409 | `/file` on a cancelled job |

### Job failure (`status: "error"`)

| `code` | Meaning |
|---|---|
| `download_failed` | Generic yt-dlp / engine failure |
| `auth_required` | Login / fresh cookies needed |
| `unsupported_live` | Live stream |
| `file_too_large` | Over an internal size cap |
| `collection_too_large` | Playlist/channel longer than 50 items (fan-out). `details`: `{ itemCount, max }` |
| `collection_item_failed` | One item in a multi-file job failed. `details` may include `id`, `attempts` |
| `empty_output` | No media produced, or empty playlist |
| `no_media` | Text-only post and `include_note` was not set |
| `remux_failed` | HLS/DASH stayed as a playlist and never remuxed |

---

## MIME types

Used for `Content-Type` and `files[].contentType`:

| Extension | Type |
|---|---|
| `.mp4` | `video/mp4` |
| `.webm` | `video/webm` |
| `.mkv` | `video/x-matroska` |
| `.mov` | `video/quicktime` |
| `.avi` | `video/x-msvideo` |
| `.flv` | `video/x-flv` |
| `.ts` | `video/mp2t` |
| `.m4v` | `video/x-m4v` |
| `.m4a` | `audio/mp4` |
| `.mp3` | `audio/mpeg` |
| `.opus` | `audio/opus` |
| `.ogg` | `audio/ogg` |
| `.aac` | `audio/aac` |
| `.wav` | `audio/wav` |
| `.flac` | `audio/flac` |
| `.jpg` `.jpeg` | `image/jpeg` |
| `.png` | `image/png` |
| `.webp` | `image/webp` |
| `.gif` | `image/gif` |
| `.bmp` | `image/bmp` |
| `.avif` | `image/avif` |
| `.m3u8` `.m3u` | `application/vnd.apple.mpegurl` |
| `.mpd` | `application/dash+xml` |
| other | `application/octet-stream` |

---

## Client recipe

```
POST /v1/jobs          → 202 { id }
loop:
  GET /v1/jobs/:id
  if status == complete:
    if kind == "file":  GET .../file
    else:               GET .../archive  or  GET .../files/:name for each files[]
    stop
  if status == error or cancelled:
    read error; stop
  sleep 1s
```

Suggested poll interval: **1s**. Jobs stay in the desktop queue; deleting the row in the UI can make a later `/file` return `410 expired`.

---

## Security

- Treat the Bearer token like a password. Anyone who has it can enqueue downloads and read job files.
- Prefer `127.0.0.1`. `0.0.0.0` has no TLS and no per-client ACL — the token is the only gate.
- File names are constrained; path traversal (`../`, encoded slashes) is rejected.
- Artifact paths must sit under `{downloadDir}/remote-jobs/{id}`. The rest of the download library is not served.
- This API never receives browser cookies from the caller. Logged-in sites need cookie sync / native auth **in the app** first.

---

## What this API does not do

- List jobs or history
- Set quality, format, headers, cookies, or output path per request
- Pause / resume (only cancel)
- Webhooks or WebSocket progress
- HTTPS
- HTTP `Range` / `206` (full file only)
- Talk to the Chrome extension (`:18765`)

Hard pages that yt-dlp cannot parse should be captured with the **Chrome extension**, then sent to the app. Do not expect this API to sniff a watch page.

---

## TypeScript types

```ts
type JobStatus = 'queued' | 'downloading' | 'complete' | 'error' | 'cancelled'
type JobKind = 'file' | 'gallery' | 'collection'

interface JobError {
  code: string
  message: string
  details?: Record<string, unknown>
}

interface JobFile {
  name: string
  contentType: string
  sizeBytes: number
  index: number
}

interface JobCreated {
  id: string
  status: string
  url: string
}

interface JobView {
  id: string
  status: JobStatus | string
  url: string
  title: string | null
  progress: number
  kind: JobKind | null
  files: JobFile[] | null
  error: JobError | null
  expiresAt: string | null
  expired: boolean
}
```

---

## Settings (reference)

| Setting | Default | Notes |
|---|---|---|
| `remoteApiEnabled` | `false` | Server starts only when this is on **and** a token exists |
| `remoteApiToken` | `""` | Auto-generated on first enable or on Regenerate |
| `remoteApiBind` | `127.0.0.1` | or `0.0.0.0` |
| `remoteApiPort` | `18766` | `1024`–`65535`, not `18765` |

Changing any `remoteApi*` setting restarts the listener.

Implementation: [`src/main/remoteApiServer.ts`](../src/main/remoteApiServer.ts), [`src/main/remoteApiHandler.ts`](../src/main/remoteApiHandler.ts), [`src/main/remoteJobService.ts`](../src/main/remoteJobService.ts).
