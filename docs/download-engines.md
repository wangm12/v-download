# Download engines and routing

This document describes how **V-Download** chooses between **yt-dlp**, **ffmpeg**, **Douyin-specific code**, and **external bulk tools**. It complements [MANUAL_TESTING.md](./MANUAL_TESTING.md).

## Glossary

| Term | Meaning |
|------|--------|
| **Task concurrency** | Setting `concurrency` — max parallel **download tasks** in the app queue (`downloadManager`). |
| **Concurrent fragments** | Setting `concurrentFragments` — yt-dlp `--concurrent-fragments` for **fragmented** streams (HLS, DASH, ISM) when the value is **> 1**, for **all** yt-dlp jobs (page URLs and direct media). |
| **Direct media** | A task with `mediaType` set (sniffed CDN URL or extension-detected type): `hls`, `mp4`, `webm`, `flv`, `mkv`, `mp3`, `m4a`, etc. Not a full watch page. |
| **Page URL** | A normal site URL resolved by yt-dlp extractors (e.g. YouTube watch page). |
| **Download speed mode** | Preferences preset: `balanced` (default), `turbo`, or `gentle` — adjusts `concurrency`, `sleepInterval`, `concurrentFragments`, and `directMediaEngine` together. |

## Source → engine matrix

| Source | Discovery | Bytes / mux |
|--------|-----------|-------------|
| Generic page URL (no `mediaType`) | yt-dlp | yt-dlp |
| Sniffed / pasted direct URL, **`mediaType` HLS / `.m3u8`** | — | **yt-dlp first** when `directMediaEngine` is `auto` (skips ffmpeg-first for parallel fragments); **ffmpeg** first only when engine is `ffmpeg` or for non-HLS direct types in `auto` |
| Sniffed / pasted direct URL (other `mediaType`) | — | **ffmpeg** then yt-dlp if `directMediaEngine` is `auto` and ffmpeg fails; **ffmpeg only** or **yt-dlp only** per setting |
| jpeg / image direct | — | yt-dlp (ffmpeg path skipped) |
| Douyin page | yt-dlp; Douyin module if needed | yt-dlp or `douyin.ts` fetch fallback |
| Douyin image gallery (`douyinImageUrls`) | `douyin.ts` | `douyin.ts` gallery writer (parallel image fetches, capped concurrency) |
| Douyin creator profile (`/user/…` paste) | Built-in [`douyinProfile`](../src/main/douyinProfile.ts) list + picker | One **queue task per selected** post URL (yt-dlp + Douyin fallback) |
| Douyin creator bulk (Preferences Python, optional) | External [douyin-downloader](https://github.com/jiji262/douyin-downloader) | Same subprocess writes files (`-p` aligned with app settings; see [douyin-bulk.md](./douyin-bulk.md)) |
| YouTube playlist | yt-dlp JSON / flat playlist | One yt-dlp job (`native`) or many tasks (`fanout`) |

## Bulk download meanings

1. **Many URLs in the queue** — Each row is a task; `concurrency` controls how many run at once. No separate “bulk mode”.
2. **YouTube playlist bulk** — Controlled by `youtubePlaylistMode` (`native` vs `fanout`).
3. **Douyin profile/creator** — Paste `https://www.douyin.com/user/…` → in-app **picker** (load more / capped load-all, multi-select, add to queue). Optional Python bulk: [douyin-bulk.md](./douyin-bulk.md).

## ffmpeg vs yt-dlp for direct media

- **ffmpeg**: lighter for a known-good progressive URL; remux-first (`-c copy` where possible); AAC in MP4 from HLS uses `aac_adtstoasc` bitstream filter when writing `.mp4`. HLS→MP4 copy **does not** use `+faststart` (avoids a slow moov rewrite at the end of long muxes); progressive MP4 copy still uses `+faststart` for quicker playback start. HTTP(S) inputs set `-http_persistent 1`; output mux uses `-max_muxing_queue_size 4096` to reduce stalls; MP3 encode uses `-threads 0`.
- **yt-dlp**: better for odd manifests, cookies, and **parallel fragments** via `--concurrent-fragments` (`concurrentFragments` setting when **> 1**).

When **Auto** is selected, **HLS** (including `.m3u8` URLs) is routed **straight to yt-dlp** so fragment concurrency applies. Other direct types still try **ffmpeg first**, then yt-dlp on failure or empty output (partial file is removed before retry).

**User retry** (`Retry` / `resume`) reloads the task from the DB. **`mediaType`**, **`referer`**, and **`customHeaders`** are stored in the `extras` JSON column so the same routing applies after restart or after in-memory `taskExtraMeta` was cleared. Tasks created before this persistence shipped may lack `extras.mediaType` until re-enqueued.

## yt-dlp tuning (429 / throughput)

- **`sleepInterval`** maps to yt-dlp `--sleep-interval` for **page URLs** only (not extension direct-media tasks).
- **`downloadSpeedMode`** presets (Preferences) set recommended combinations; **Turbo** requires a one-time risk acknowledgement (HTTP 429 / throttling).
- **`ytdlpExternalDownloader`** (optional) maps to `--downloader` (e.g. `aria2c`); must be on `PATH`.
- **Retry backoff**: `downloadSpeedMode` selects default `--retry-sleep` lines (fragment + HTTP backoff) passed to yt-dlp for all jobs.

## Direct-media progress and thumbnails

- **Progress without known duration** — ffmpeg stderr reports decoded `time=` but not total length. The UI maps that to **1–99%** with an asymptotic curve so the bar does **not** sit at a false 95% ceiling while mux continues; **100%** is set only when the process finishes successfully.
- **Speed in the list** — ffmpeg’s `speed=4x` is **relative to realtime**, not link throughput. When the same progress line includes `bitrate=…kbits/s`, the app shows that as **MiB/s** / **KiB/s** (same style as yt-dlp) so the dock and row are not misread as “4× your internet speed.” If bitrate is missing, the speed field stays empty for that tick.
- **List preview image** — If a task has **no** `thumbnail` (typical for raw m3u8 / extension URLs), the app may spawn a **short** ffmpeg job (`~2s` seek, one JPEG frame, scaled to 320px wide) in the background and store a **data URL** in the DB, then push `download-progress` so the row updates when ready. Failures are silent (play placeholder remains).

## Settings reference

| Key | Role |
|-----|------|
| `downloadSpeedMode` | `balanced` \| `turbo` \| `gentle` — last preset applied from Preferences |
| `turboRiskAcknowledged` | After user confirms Turbo disclaimer once |
| `directMediaEngine` | `auto` \| `ffmpeg` \| `ytdlp` |
| `concurrentFragments` | Integer 1–32; passed as `--concurrent-fragments` when **> 1** for **all** yt-dlp downloads |
| `concurrency` | Integer 1–10 parallel tasks |
| `sleepInterval` | 0–30; yt-dlp `--sleep-interval` for page URLs |
| `ytdlpExternalDownloader` | Optional short name for `--downloader` (e.g. `aria2c`) |
| `ffmpegPath` / `ytdlpPath` | Binaries used by the main process |
| `douyinBulkOutputPath` | Optional `-p` for douyin-downloader; empty uses `downloadDir` |
| `douyinBulkThreads` | 1–32; passed as `-t` / `--thread` to douyin-downloader |
| `douyinBulkVerboseWarnings` | Adds `--show-warnings` for richer subprocess stderr |
