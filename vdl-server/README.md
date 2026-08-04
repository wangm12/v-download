# VDL Server

Video download Telegram bot powered by yt-dlp. Send a video URL, get it back in chat or as a download link.

## Features

- **Telegram Bot** — send a video link, get the video directly in chat (< 50MB) or a download link
- **Multi-platform** — YouTube, Douyin, TikTok, Bilibili, Xiaohongshu, X/Twitter, Instagram, and any site supported by yt-dlp
- **Douyin fallback** — server-side scraping when yt-dlp's extractor fails
- **Quality options** — full quality (download link) or compact (sent in chat)
- **Authenticated cookie upload** — `/api/cookies` is disabled by default and requires `COOKIE_SYNC_TOKEN`
- **Auto-cleanup** — configurable expiry for temporary download links
- **Cloudflare Tunnel** — stable public URL for webhook and download links

## Quick Start

```bash
cp .env.example .env
# Edit .env with your Telegram bot token and admin ID

npm install
npm run build
make server          # starts Cloudflare Tunnel + server
```

From the **repository root** (monorepo): configure `vdl-server/.env` first, then `make vdl-install`, `make vdl-build`, and `make vdl-server` or `make vdl-dev`. Run `make help` at the root for all `vdl-*` targets.

## Docker

Docker build uses the **repository root** as context so `file:../packages/shared` resolves (`docker-compose.yml` sets `context: ..`). Run compose from `vdl-server/` as usual:

```bash
cp .env.example .env
# Edit .env

make docker-build
make docker-up
make docker-logs     # tail logs
```

From the **repository root**: `make vdl-docker-build`, `make vdl-docker-up`, `make vdl-docker-down`, `make vdl-docker-logs` (same compose file; sub-make runs with `vdl-server` as the working directory).

## Architecture

```
vdl-server/
├── src/
│   ├── index.ts          # Fastify server entry point
│   ├── config.ts         # Environment configuration
│   ├── db.ts             # SQLite database (users, tasks)
│   ├── ytdlp.ts          # yt-dlp CLI wrapper
│   ├── compress.ts       # ffmpeg two-pass compression
│   ├── douyin.ts         # Douyin direct CDN fallback
│   ├── queue.ts          # Download task queue
│   ├── cleanup.ts        # Periodic cleanup for expired files
│   ├── bot/
│   │   └── index.ts      # Telegram bot (grammY)
│   └── storage/
│       └── temp-link.ts  # Temporary download links + one-time tokens
├── scripts/
│   └── start-with-tunnel.sh  # Cloudflare Tunnel + server launcher
├── public/               # Static files
├── Dockerfile
├── docker-compose.yml
├── Makefile
└── .env.example
```

## Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Start the bot |
| `/admin` | Admin panel — stats, users, errors, cancel tasks, clear files |

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | — | From @BotFather |
| `ADMIN_TELEGRAM_IDS` | No | — | Comma-separated Telegram user IDs |
| `PORT` | No | `3000` | Server port |
| `HOST` | No | `0.0.0.0` | Bind address |
| `BASE_URL` | No | `http://localhost:3000` | Public URL (set by tunnel script) |
| `COOKIE_MODE` | No | `browser` | `browser` (yt-dlp `--cookies-from-browser chrome` on the **server host**) or `file` (yt-dlp `--cookies` at `COOKIES_FILE_PATH`). Use **`file`** when an authenticated client uploads cookies to `/api/cookies`. |
| `COOKIES_FILE_PATH` | No | `./cookies.txt` | Path to Netscape cookie file (also used by the **Douyin HTML fallback** in `douyin.ts`, not only yt-dlp) |
| `COOKIE_SYNC_TOKEN` | No | disabled | Required as `Authorization: Bearer …` or `X-VDownload-Cookie-Token` for `/api/cookies`; keep the endpoint private and use HTTPS for remote access. |
| `DOUYIN_PLAYWRIGHT` | No | **on** (unset) | After plain `fetch` fails on Douyin, run **Playwright** on mobile share then canonical. Set to **`0` / `false` / `off`** to disable (recommended for **Docker** without Chromium). Requires **`npx playwright install chromium`** on the host. |
| `TEMP_DIR` | No | `./tmp` | Temp file directory |
| `TEMP_LINK_EXPIRY_HOURS` | No | `3` | Hours before download links expire |
| `MAX_FILE_SIZE_MB` | No | `500` | Max download size |

## Douyin troubleshooting

Douyin often needs a **real browser session** (cookies + risk checks). If yt-dlp prints **“Fresh cookies are needed”** and logs show **`No _ROUTER_DATA`** / **`could not extract video info`**, treat it as the same problem: the server is only getting **shell or incomplete HTML**, not the embedded video payload.

**Do this first (no code changes):**

1. **Keep `yt-dlp` current** on the host that runs the bot (`yt-dlp -U`).
2. **Refresh cookies** while logged into [douyin.com](https://www.douyin.com/) in Chrome (or whatever browser you export from). Use an authenticated client to `POST /api/cookies`, or overwrite `COOKIES_FILE_PATH` with a new Netscape export. Stale files cause both yt-dlp and the **direct Douyin fallback** to fail, because both reuse that file in `file` mode.
3. **`COOKIE_MODE=file`** (when logs show `Using cookie file: …`): the Douyin fallback **only** sends cookies from that file in a `Cookie` header on plain `fetch` — it does **not** run a headless browser unless you enable Playwright (below). The **v-download desktop app** can still do better on hard links because it uses Electron’s Chromium.
4. **Network / region**: Douyin may return tiny placeholder pages (~6KB) or large pages without parseable JSON from some IPs; a VPN or different network is sometimes required in addition to cookies.

**Playwright (server-side browser):** **Enabled by default** after the fetch loop fails (set **`DOUYIN_PLAYWRIGHT=0`** to turn off, e.g. minimal Docker). Install browsers once:

```bash
cd vdl-server && npm install && npx playwright install chromium
```

Then restart the bot. On Douyin, after the normal URL loop fails, it opens **`https://m.douyin.com/share/video/{id}`** then **`https://www.douyin.com/video/{id}`** in a persistent headless profile, injects Netscape cookies when `COOKIES_FILE_PATH` exists, and polls until the HTML looks hydrated. **Docker:** set **`DOUYIN_PLAYWRIGHT=0`** unless you extend the image with `npx playwright install-deps chromium` and `npx playwright install chromium` (large image).

**Smoke script:** from `vdl-server/`, run `npm run test:douyin` to exercise four sample short links (HTML fetch + parse only; same cookies as the bot). Playwright runs by default after fetch fails unless `DOUYIN_PLAYWRIGHT=0`.

**If it still fails after cookies, yt-dlp -U, and Playwright:**

- Some IPs or accounts remain hard-blocked; try **region-aligned** egress or a **stealth-patched** Chromium (e.g. CloakBrowser — see repo `docs/FUTURE_ENHANCEMENTS.md` / plan notes).

## Makefile Targets

These run when your shell cwd is `vdl-server/`. From the **monorepo root**, use `make vdl-*` (see root `make help`) to delegate here without `cd`.

| Target | Description |
|--------|-------------|
| `make dev` | Local dev with polling (no tunnel) |
| `make server` | Cloudflare Tunnel + production server |
| `make clean` | Delete all temp files |
| `make status` | Show temp file disk usage |
| `make docker-build` | Build Docker image |
| `make docker-up` | Start container |
| `make docker-down` | Stop container |
| `make docker-logs` | Tail container logs |
