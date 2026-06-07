# Download reliability (architecture notes)

This document summarizes how **V-Download** stays reliable compared to ad‑hoc scripts, and where fragility remains.

## Stack

- **yt-dlp** is the primary engine for supported sites (including YouTube). Keep it **updated** (`brew upgrade yt-dlp` or your package manager); site extractors change often.
- **Cookies**: Logged-in or age-gated content needs cookies. Use the app’s **cookie sync** (Chrome companion) or a **Netscape cookies file** plus per-site settings (`cookiesFromBrowser` for Douyin, etc.).
- **YouTube playlists**
  - **Native** (default): one task, original list/channel URL, `metadata.nativeYoutubePlaylist`; yt-dlp runs with playlist options (`--yes-playlist`, optional `--sleep-requests`, `--max-downloads`). Output goes under the playlist subfolder when enabled.
  - **Fan-out**: one queued task per video (legacy, more parallel pressure on YouTube).
- **Douyin**
  - Primary path: yt-dlp with cookies; on failure the app may fall back to **HTML parsing** (`getDouyinInfo`) and direct video or **image gallery** download.
  - **Fragility**: Douyin changes layouts and bot-detection frequently. If downloads fail, **refresh cookies**, try **CloakBrowser** (settings), and **update yt-dlp**. Errors may include hints from the last parser attempt.
- **Optional bulk**: [jiji262/douyin-downloader](https://github.com/jiji262/douyin-downloader) can be wired via **Preferences → Douyin bulk** (`douyinBulkRunPyPath`, `douyinBulkConfigPath`). Use lifecycle IPC/API (`start`, `status`, `cancel`) so long runs can be observed and interrupted safely.

## Chrome extension

- **`media-patterns.js`**: shared URL→type rules for the service worker and `<all_urls>` overlay so detection stays aligned.
- **`storage` + `lastDownloadError`**: when localhost wake/POST fails, a short message is stored for the **popup** banner.
- **Dedup**: overlay still normalizes URLs for dedup keys; background uses the same pattern list for `webRequest` classification.

## vdl-server

The optional **vdl-server** bot now includes a Douyin `video | gallery` parser path and gallery fallback downloader. Keep in mind this remains site-layout sensitive, so validate with `vdl-server/scripts/test-douyin-urls.ts` whenever extractor logic changes.

## Troubleshooting matrix

| Symptom | Likely cause | Action |
| --- | --- | --- |
| YouTube playlist stalls or returns HTTP 429 | Request burst is too high for current IP/session | Use native playlist mode, set `youtubePlaylistSleepRequests` to 1-3 seconds, retry after a short cooldown. |
| Douyin URL reports no playable formats | Stale cookies or extractor drift | Refresh browser cookies, sync again, update yt-dlp, then retry with CloakBrowser enabled. |
| Douyin gallery opens but only one file is saved | Fallback parser did not resolve gallery images | Re-run and verify metadata includes `_type: douyin_gallery` and `image_urls`; if missing, treat as parser regression. |
| Bulk run stays `running` with no progress | Python bulk subprocess is blocked or waiting on external state | Check status/stderr tail, `cancel` the job, then restart with corrected paths/config. |
| Extension banner keeps showing old failure | `lastDownloadError` is stale and not yet cleared | Dismiss in popup or wait for TTL cleanup; confirm new attempts write a fresh timestamped error only on failure. |
| vdl-server succeeds on video posts but fails on Douyin notes/gallery | Server parser path drifted or site layout changed | Validate with `cd vdl-server && npm run test:douyin`; route note/gallery issues to server parity fixes. |

## Interrupt / resume (yt-dlp)

- Invocations use **`--continue`** and a **temp directory** (`--paths temp:…`) so partial `.part` / fragment state can survive across runs when the OS has not cleared temp.
- **Reality**: if temp was wiped (reboot, disk cleaner, different temp root), yt-dlp may **restart from scratch** even though the DB still shows an older percent until new progress lines arrive.
- The UI **must not regress** to `0%` on the first stderr lines while a resume is warming up; the main process merges progress **monotonically** with the last known value for that task.

## Operational checklist

1. Ensure yt-dlp and ffmpeg are on `PATH` (or set explicit paths in Preferences -> Advanced).
2. Refresh cookies after login/password/2FA changes before retrying gated URLs.
3. For large YouTube lists, prefer native playlist mode with non-zero sleep between requests.
4. For Douyin bulk runs, always use start/status/cancel flow instead of fire-and-forget execution.
