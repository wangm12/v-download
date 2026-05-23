# CLI and shared download core (roadmap)

Today, **vdl-server** embeds yt-dlp orchestration in [vdl-server/src/ytdlp.ts](../vdl-server/src/ytdlp.ts) and the desktop app in [src/main/ytdlp.ts](../src/main/ytdlp.ts). They are intentionally separate call sites.

## Intended direction (optional)

1. Extract a **`packages/downloader-core`** library: spawn yt-dlp, parse progress/JSON, inject cookie args from callers.
2. Add a thin **`v-download-cli`** (Node) for operators and CI: `download`, `info`, etc., delegating to the core.
3. **Electron main** and **vdl-server** either **import** the core (simplest) or **spawn** the CLI (process isolation).

## Hard constraints

- **Do not** depend on the macOS `V-Download.app` inside Linux Docker; any CLI must be **headless Node** (or an explicitly shipped binary) plus **yt-dlp** and **ffmpeg** in `PATH`.
- **Telegram policy** (50 MB, compression, temp links) stays in vdl-server; the core stays site-agnostic.

## What is already shared

Cookie Netscape formatting and extension cookie-domain list live in [`@v-download/shared`](../packages/shared/README.md).
