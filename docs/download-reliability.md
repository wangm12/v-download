# Download reliability

Runbook for **V-Download**: what stays fragile, how to recover, and remaining Douyin parser research. Engine routing and settings live in [download-engines.md](./download-engines.md). Profile picker / Python bulk: [douyin-bulk.md](./douyin-bulk.md).

## Stack

- **yt-dlp** is the primary engine for supported sites (including YouTube). Keep it **updated** (`brew upgrade yt-dlp` or your package manager); site extractors change often.
- **Cookies**: Logged-in or age-gated content needs cookies. Use the app’s **cookie sync** (Chrome companion) or a **Netscape cookies file** plus per-site settings (`cookiesFromBrowser` for Douyin, etc.).
- **YouTube playlists:** **Native** (default) is one yt-dlp job; **fan-out** is one queued task per video. Routing detail: [download-engines.md](./download-engines.md).
- **Douyin:** yt-dlp first, then the HTML / Chromium fallback below. Refresh cookies, try **CloakBrowser** (settings), and update yt-dlp when pages fail.
- **Optional bulk:** [douyin-bulk.md](./douyin-bulk.md) — prefer the built-in picker; Python `run.py` is a power-user escape hatch.

## Chrome extension

- **`media-patterns.js`**: shared URL→type rules for the service worker and `<all_urls>` overlay so detection stays aligned.
- **`storage` + `lastDownloadError`**: when localhost wake/POST fails, a short message is stored for the **popup** banner.
- **Dedup**: overlay still normalizes URLs for dedup keys; background uses the same pattern list for `webRequest` classification.

## Troubleshooting matrix

| Symptom | Likely cause | Action |
| --- | --- | --- |
| YouTube playlist stalls or returns HTTP 429 | Request burst is too high for current IP/session | Use native playlist mode, set `youtubePlaylistSleepRequests` to 1-3 seconds, retry after a short cooldown. |
| Douyin URL reports no playable formats | Stale cookies or extractor drift | Refresh browser cookies, sync again, update yt-dlp, then retry with CloakBrowser enabled. |
| Douyin gallery opens but only one file is saved | Fallback parser did not resolve gallery images | Re-run and verify metadata includes `_type: douyin_gallery` and `image_urls`; if missing, treat as parser regression. |
| Bulk run stays `running` with no progress | Python bulk subprocess is blocked or waiting on external state | Check status/stderr tail, `cancel` the job, then restart with corrected paths/config. |
| Extension banner keeps showing old failure | `lastDownloadError` is stale and not yet cleared | Dismiss in popup or wait for TTL cleanup; confirm new attempts write a fresh timestamped error only on failure. |

## Interrupt / resume (yt-dlp)

- Invocations use **`--continue`** and a **temp directory** (`--paths temp:…`) so partial `.part` / fragment state can survive across runs when the OS has not cleared temp.
- **Reality**: if temp was wiped (reboot, disk cleaner, different temp root), yt-dlp may **restart from scratch** even though the DB still shows an older percent until new progress lines arrive.
- The UI **must not regress** to `0%` on the first stderr lines while a resume is warming up; the main process merges progress **monotonically** with the last known value for that task.

## Operational checklist

1. Ensure yt-dlp and ffmpeg are on `PATH` (or set explicit paths in Preferences -> Advanced).
2. Refresh cookies after login/password/2FA changes before retrying gated URLs.
3. For large YouTube lists, prefer native playlist mode with non-zero sleep between requests.
4. For Douyin bulk runs, always use start/status/cancel flow instead of fire-and-forget execution.

## Douyin fallback (single video)

When yt-dlp cannot resolve a Douyin page:

1. **`getDouyinInfo`** in [`src/main/douyin.ts`](../src/main/douyin.ts) expands short links (`v.douyin.com/...`), extracts a numeric video id, and tries **`https://www.douyin.com/video/{id}`** first, then ies/m share URLs, with mobile and desktop `fetch`.
2. Node `fetch` often gets an anti-bot HTML shell (empty `<body>`, `byted_acrawler`) with no `_ROUTER_DATA` / `play_addr` JSON.
3. [`src/main/douyinBrowserFetch.ts`](../src/main/douyinBrowserFetch.ts) loads the URL in a hidden Electron window (persistent partition, optional Netscape cookies) and polls until the page looks hydrated, then parses again.
4. A final Chromium pass uses the canonical `www.douyin.com/video/{id}` URL if earlier fetches failed.
5. **`downloadDouyinVideo`** streams from the constructed `aweme.snssdk.com` play URL when metadata was recovered.

**CloakBrowser** (Settings, or `V_DOWNLOAD_CLOAKBROWSER=1`) is an optional patched Chromium if stock Electron still times out. It stays optional: extra binary on disk, separate license, Gatekeeper friction on macOS. See the README CloakBrowser section.

### Remaining research

- Capture a stable hydrated **iesdouyin** HTML sample and extend `parseDouyinPageHtml` / `JSON_MARKERS` for embeds that omit `_ROUTER_DATA`.
- Optionally refine `htmlLooksHydrated` so large but still unparseable pages do not exit the poll loop too early.
- Tune hydration timeouts after real `did-finish-load` + reload patterns. Gate experimental Chromium flags only if a platform-specific failure needs them.

### Related code

| Area | Path |
|------|------|
| Douyin metadata + parse | [`src/main/douyin.ts`](../src/main/douyin.ts) |
| Electron Chromium hydration | [`src/main/douyinBrowserFetch.ts`](../src/main/douyinBrowserFetch.ts) |
| Queue / yt-dlp then fallback | [`src/main/downloadManager.ts`](../src/main/downloadManager.ts) |
| Clipboard URL extraction | [`src/renderer/src/utils/youtube.ts`](../src/renderer/src/utils/youtube.ts) |
