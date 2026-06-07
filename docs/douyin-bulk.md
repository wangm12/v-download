# Douyin profile bulk

## Built-in profile picker (default)

Pasting a **`https://www.douyin.com/user/...`** URL on `douyin.com` (strict host) opens an in-app **post picker**: load more / load-all (capped), multi-select, then **Add to queue**. Each row becomes a normal download task (`start-downloads-bulk` → `downloadManager`), grouped by creator name in the queue. Up to **2000** posts per batch; the queue runs **Settings → Concurrent downloads** at a time, in playlist order.

Listing uses main-process helpers ([`douyinProfile.ts`](../src/main/douyinProfile.ts)):

1. **First paint (fast):** signed web `aweme/post` JSON API — reference-aligned query params, msToken, X-Bogus, retries on empty 200 / 429.
2. **Load more / Load all:** API pagination with cursor.
3. **Load in browser (opt-in):** opens a visible **system browser** (Playwright, mapped from Settings → Browser profile) with **live cookies** from that profile, scrolls, and collects posts via API intercept + HTML fallback — never auto-opened.
4. **Open profile in browser:** opens the profile in your **configured** browser for manual scrolling (no auto-import).

Set `V_DOWNLOAD_DOUYIN_PROFILE_RECOVERY=0` to disable visible browser recovery.

## Cookies (required for reliable pagination)

**Primary for Douyin:** live cookies from the browser profile selected in **Settings → Browser profile for Douyin / TikTok** (same source yt-dlp uses: `--cookies-from-browser`). The app reads them via yt-dlp’s cookie extractor when listing posts or running **Load in browser**.

**Secondary:** extension sync to `cookies.txt` (**Settings → Sync browser cookies**) supplements API/load-more when live read fails.

For best results the configured browser should include at least:

| Cookie | Purpose |
|--------|---------|
| `msToken` | Web API query param (auto-fallback if missing) |
| `ttwid` | Session fingerprint |
| `odin_tt` | Auth |
| `passport_csrf_token` | CSRF |

Use **Settings → Sync browser cookies** or ensure Douyin is open in the configured browser at least once. On macOS, the first live cookie read may prompt for Keychain access. Stale cookies often cause `LOAD_MORE_FAILED` or `PAGINATION_RESTRICTED`.

**Note:** `douyinUseCloakBrowser` (Settings) affects single-video HTML hydrate only, not profile picker recovery.

## External Python tool (deprecated / power-user)

For full upstream feature parity (SQLite incremental DB, extra modes, etc.), you can still point at a local clone of [jiji262/douyin-downloader](https://github.com/jiji262/douyin-downloader). The app spawns `python3 run.py …` with aligned CLI flags and tracks the job (start / status / cancel).

> Prefer the **built-in picker** unless you need something the TS path does not cover yet.

### What V-Download passes to `run.py`

| Flag | Source |
|------|--------|
| `-c` / `--config` | `douyinBulkConfigPath` |
| `-u` / `--url` | URL from Preferences or from the format dialog “Bulk download profile” action |
| `-p` / `--path` | `douyinBulkOutputPath` if set, otherwise `downloadDir` |
| `-t` / `--thread` | `douyinBulkThreads` (1–32) |
| `--show-warnings` | When `douyinBulkVerboseWarnings` is enabled |

You still maintain **`config.yml`** yourself (cookies, `mode`, `number`, `browser_fallback`, etc.).

## Minimal profile-oriented `config.yml`

Adapted from the upstream README; adjust paths and cookie strategy to match your machine.

```yaml
# User / sec_uid style link (bulk URL can also be passed with -u from the app)
link:
  - https://www.douyin.com/user/MS4wLjABAAAAxxxxxxxx

# What to fetch — e.g. posts only for a profile bulk
mode:
  - post

# Limits — e.g. last N posts (names follow upstream schema)
number:
  post: 30

# Optional: let the tool try a real browser when API/HTML fails
browser_fallback: true

# Cookies: use upstream docs for cookie_fetcher / file paths
# https://github.com/jiji262/douyin-downloader
```

**Cookies** and **`cookie_fetcher`** flows are documented in the upstream repository; the Electron app does not generate or merge YAML beyond what you save on disk.

## UI entry points

1. **Paste a profile URL** — opens the picker (no Python install required).
2. **Preferences → Downloads → Douyin bulk** — optional `run.py` / `config.yml` escape hatch.
3. **Format dialog** — if the page URL looks like a profile, **Bulk download profile** / **Configure bulk in preferences** still link to the Python path when configured.

See also [download-engines.md](./download-engines.md) for how this relates to yt-dlp and the main queue.
