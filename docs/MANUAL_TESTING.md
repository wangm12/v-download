# Manual testing checklist

Short regression matrix for **V-Download** (desktop + extension) and **vdl-server** (Telegram bot). Use legal URLs you control or stable public samples; rotate when sites change.

Debug logging: see [DEBUG.md](./DEBUG.md) (`make dev` session log + release `worklog.txt`).

## P0 — every release

- **YouTube** — single `watch?v=` via Cmd+V; format dialog; merged file plays.
- **YouTube** — small playlist (2–5); subfolders / grouping if enabled.
- **Douyin** — extension panel, download completes. On **vdl-server**, Playwright runs after fetch fails **by default** (`DOUYIN_PLAYWRIGHT=0` to disable); run `npx playwright install chromium` on the host.

## Reliability regressions (manual)

### Douyin profile picker (built-in)

1. Copy a creator URL (`https://www.douyin.com/user/…` on `douyin.com`) and paste into the app; confirm the **post picker** opens with the **API list immediately** (no background HTML/Chromium enrich). Use **Load more** / **Load all** when you want additional pages.
2. With **Douyin cookies** configured (include `msToken`, `ttwid`, `odin_tt`, `passport_csrf_token`), use **Load more** / **Load all** until the count stabilizes.
3. If API pagination stops early, click **Load in browser** (opt-in) — a **system browser window** opens (Chrome/Edge/Brave per Settings), with live cookies injected; a second window may appear if that browser is already running. Click **Open profile in browser** to scroll manually in your configured browser. Set **`V_DOWNLOAD_DOUYIN_PROFILE_RECOVERY=0`** to disable the automated recovery backend.
4. If Chromium spins on captcha widgets (noisy `rmc-captcha` logs), set **`V_DOWNLOAD_DOUYIN_PROFILE_CHROMIUM_MS`** (ms, ≥5000) to cap hydrate wait. Profile **Load in browser** uses Playwright + your configured system browser (not Electron).
5. Run **`npm run test:douyin-profile`** for parser/signing smoke tests (no network).
4. Select several posts → **Add to queue**; confirm tasks appear in the main list with correct titles/thumbnails.
5. If **Load more** is enabled, click it once and confirm new rows append without duplicates.
6. **Load all pages (capped)** stops at the documented cap; cancel by closing the modal mid-flight (no crash).

### Bulk lifecycle (Python escape hatch)

1. Start a Douyin bulk job from Preferences and confirm first status is `running` (files land under `downloadDir` or **Bulk output directory** / `-p` as configured).
2. From the format dialog on a `douyin.com/user/…` URL, use **Configure bulk in preferences** (URL prefilled) or **Bulk download profile** when `run.py` and `config.yml` paths are set.
3. While a job is active, refresh status repeatedly and confirm state remains observable (no missing job errors).
4. Trigger cancel while `running`; verify state moves to `cancelled` and does not flip back to `running`.
5. Start a second job after cancellation and verify it can finish (`completed` or `failed`) with fresh status output.

### Extension stale-error behavior

1. Force a localhost wake/download failure so the popup shows `lastDownloadError`.
2. Confirm the error banner includes the latest failure (not an older stale message).
3. Click dismiss; reopen popup and verify the banner stays hidden.
4. Simulate an old timestamped error in storage and confirm popup hides/cleans it instead of showing it.

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

### Direct media engine (ffmpeg vs yt-dlp)

Preferences → **Downloads** → **Direct media (sniff / extension)**.

1. **Auto + HLS** — For `mediaType` HLS or `.m3u8` URLs, the app uses **yt-dlp first** (no ffmpeg-first attempt) so `--concurrent-fragments` applies immediately. Logs should **not** show `[runTask] ffmpeg` before yt-dlp for pure HLS.
2. **Auto + progressive** (e.g. direct MP4) — ffmpeg may run first; if it fails or writes a tiny file, logs show fallback to yt-dlp.
3. **ffmpeg only** — Same URL; if ffmpeg cannot mux, task should **error** (no silent yt-dlp fallback).
4. **yt-dlp only** — Same URL; yt-dlp path without a leading ffmpeg attempt.
5. **Concurrent fragments** — Set to e.g. `8` vs `1`: affects **YouTube / DASH** page URLs as well as HLS when value is **> 1**. Compare throughput and any HTTP 429 behavior (qualitative).

### Download speed mode (Balanced / Turbo / Gentle)

Preferences → **Downloads** → **Download speed**.

1. **Balanced (default)** — After reset or fresh profile, mode reads `balanced`; applying it sets moderate concurrency, sleep, and fragments.
2. **Turbo** — First selection opens a disclaimer modal; confirm, then settings apply (higher fragments, `sleepInterval` 0, `directMediaEngine` yt-dlp). Re-open Preferences: Turbo stays selectable without modal.
3. **Gentle** — Low concurrency and higher sleep; useful if you hit rate limits.
4. **Optional external downloader** — Set `aria2c` only if installed; start one HLS job and confirm yt-dlp still completes or surfaces a clear error if the binary is missing.

See [download-engines.md](./download-engines.md) for the routing matrix.

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
