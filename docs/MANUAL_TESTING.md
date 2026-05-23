# Manual testing checklist

Short regression matrix for **V-Download** (desktop + extension) and **vdl-server** (Telegram bot). Use legal URLs you control or stable public samples; rotate when sites change.

## P0 — every release

- **YouTube** — single `watch?v=` via Cmd+V; format dialog; merged file plays.
- **YouTube** — small playlist (2–5); subfolders / grouping if enabled.
- **Douyin** — extension panel, download completes. On **vdl-server**, Playwright runs after fetch fails **by default** (`DOUYIN_PLAYWRIGHT=0` to disable); run `npx playwright install chromium` on the host.

**Regression short links** (paste / bot / `npm run test:douyin` in `vdl-server/`):

| Label | URL |
|-------|-----|
| agent | `https://v.douyin.com/9AFQLv6d_BE/` |
| hard | `https://v.douyin.com/1TdzlYAbtHQ/` |
| art | `https://v.douyin.com/jGfj2ndrEOs/` |
| cos | `https://v.douyin.com/yJ2HAITp1UQ/` |

## P1 — integrations (one URL each where you ship support)

- X / Twitter (tweet video)
- TikTok
- Bilibili
- Xiaohongshu (best-effort; login-sensitive)
- Instagram (usually needs synced cookies)

## P2 — desktop depth

- Direct `.mp4` / `.webm` or picker-sent URL
- HLS (`.m3u8`) via overlay / sniffer
- Queue: 2–3 concurrent; pause / resume / cancel

## Cookies and login (critical for Instagram / members YouTube)

- Extension posts cookies to `http://127.0.0.1:18765/cookies` and optionally `VDL_SERVER_URL/api/cookies`.
- **vdl-server:** for extension-written `cookies.txt` to drive yt-dlp, set **`COOKIE_MODE=file`**. Default `browser` uses the **server machine’s** Chrome profile, not the uploaded file.
- Log in in Chrome → wait for sync (extension alarm ~5 min) or reload extension → retry gated URL.

## vdl-server–only

- Public URL: bot completes; under-50MB in chat vs temp link / compress for large.
- Temp link: one-time token and expiry.
- Webhook (HTTPS `BASE_URL`) vs polling.

## End-to-end narratives

- **A — Desktop only:** app + yt-dlp/ffmpeg; YouTube paste + optional extension; queue controls.
- **B — Cookies → app:** logged-in YouTube in Chrome; gated content works after sync.
- **C — Bot only:** Telegram + public YouTube; no auth.
- **D — Full stack:** Chrome login → extension sync → vdl `COOKIE_MODE=file` → Telegram with login URL (e.g. Instagram).
- **E — Docker / prod:** same as C/D with real image and tunnel if used.

Record: URL, surface (paste / extension / bot), pass/fail, yt-dlp version, Chrome login state, cookie sync timing, notes.

See also [FUTURE_ENHANCEMENTS.md](./FUTURE_ENHANCEMENTS.md) for Douyin / headless Chromium backlog and optional CloakBrowser research.
