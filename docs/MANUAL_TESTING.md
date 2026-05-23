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

## Monochrome redesign — mockup vs build

Use this matrix with [DESIGN_PLAN.md](./DESIGN_PLAN.md) and the PNGs under [`design/v-download-bw-redesign-pack/exports/png/`](../design/v-download-bw-redesign-pack/exports/png/) (or the combined [PDF](../design/v-download-bw-redesign-pack/exports/pdf/v-download-bw-redesign-mockups.pdf)). For each row, open the mockup, compare to the current app, and tick when the **Verify** criteria are met (or mark N/A if the phase is not shipped yet).

| Mockup | Screen | Phase | Verify in build |
|--------|--------|-------|-----------------|
| `00-cover.png` | Cover / direction | — | Stakeholder reference only; no in-app surface. |
| `01-main-queue-dashboard.png` | Main queue / dashboard | 1 | Three columns (sidebar, queue, inspector); monochrome tokens; selection updates inspector; bottom bar when on Downloads; **title bar**: inspector toggle + theme (Dark / Light / Device); sidebar brand uses app icon; collapsible sidebars. |
| `02-empty-first-launch.png` | Empty / first launch | 1–2 | Empty queue explains paste, drag, browser companion; matches spec tone. |
| `03-paste-url-flow.png` | Paste URL sheet | 2 | Dedicated sheet: URL validation, options (picker, cookies, subfolder, audio, destination) before scan. |
| `04-scanning-state.png` | Scanning | 2 | Observable steps (e.g. page loaded → streams → formats); Cancel + optional scan log. |
| `05-format-picker.png` | Format picker | 2 | Recommended rows, estimated sizes, single primary **Download selected** (not legacy table-only if spec differs). |
| `06-playlist-detected.png` | Playlist detected | 2 | Batch selection, preset format, destination grouping, duplicate skip, captions as designed. |
| `07-active-downloads.png` | Active downloads | 2–3 | Speed, ETA, progress; pause/resume; batch / priority controls per mockup. |
| `08-completed-detail.png` | Completed detail | 2–3 | Open file, Reveal in Finder, **copy source link**, remove; inspector or row parity with mockup. |
| `09-error-recovery.png` | Error recovery | 3 | Plain-language failure; actions: Sync browser cookies, Open source page, Retry, Show log. |
| `10-preferences-general.png` | Preferences — General | 3 | Preferences **in main window**; left nav + cards; General + Downloads fields present; `#/settings` deep link opens Preferences then clears hash. |
| `11-preferences-browser.png` | Preferences — Browser | 3 | Browser section: extension, cookie sync, profiles; cookie sync still drives `settings-changed` / queue. |
| `12-extension-guide.png` | Browser companion guide | 3 | Dedicated guide (install, pin, test, usage) without cluttering main prefs. |
| `13-compact-mode.png` | Compact mode | 3 | Optional mini window: quick capture, progress, Pause all, open full app. |
| `14-component-library.png` | Component library | ongoing | Spot-check buttons, pills, rows, borders against app; token drift audit. |
| `15-white-mode.png` | White / light mode | 4 | Title bar **Light** or **Use device setting** with OS in light mode: shell readable; contrast acceptable (iterate on row pills if needed). |

## Desktop — title bar and theme (P2)

- **Inspector toggle** (downloads view): collapses/expands right column; persists with other UI prefs.
- **Appearance menu:** **Dark**, **Light**, **Use device setting**; choice persists in `localStorage`; device tracks OS light/dark changes.
- **First paint:** no long flash of wrong theme before React mounts.

**Pass/fail log (optional):** Record date, build or commit, mockup IDs checked, and notes in your release doc or issue.

**Related:** [mockup-index.md](../design/v-download-bw-redesign-pack/specs/mockup-index.md) (short descriptions per file).
