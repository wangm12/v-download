# Download reliability

Runbook for **V-Download**: what stays fragile, how to recover, and remaining Douyin parser research. Engine routing and settings live in [download-engines.md](download-engines.md). Profile picker / Python bulk: [douyin-bulk.md](douyin-bulk.md).

## Stack

- **yt-dlp** is the primary engine for supported sites (including YouTube). Check the engine path / version actually selected in Preferences before updating: bundled, managed, and explicitly configured executables are different inputs. Updating an unrelated PATH executable does not update the engine a task used.
- **Sessions**: Some public resources need fresh guest cookies without an account; restricted content may need an authorized account session. Use the existing native login, explicit cookie sync, or configured Netscape file / browser source as appropriate. Cookie presence does not prove that the target resource is accessible.
- **YouTube playlists:** **Native** (default) is one yt-dlp job; **fan-out** is one queued task per video. Routing detail: [download-engines.md](download-engines.md).
- **Douyin:** yt-dlp first, then the HTML / Chromium fallback below. Refresh cookies, try **CloakBrowser** (settings), and update yt-dlp when pages fail.
- **Optional bulk:** [douyin-bulk.md](douyin-bulk.md) — prefer the built-in picker; Python `run.py` is a power-user escape hatch.

## Chrome extension

- **`media-patterns.js`**: shared URL→type rules for the service worker and `<all_urls>` overlay so detection stays aligned.
- **`storage` + `lastDownloadError`**: when localhost wake/POST fails, a short message is stored for the **popup** banner.
- **Source identity**: preserve the original candidate URL, complete Referer and page / frame context. Deduplication keys must not replace the URL sent to the downloader. Candidate scores are derived from facts, not accumulated on every observation.
- **Inspection / recovery**: the popup and task details expose candidate facts and on-demand inspection. A failed task can request browser capture and explicitly accept a replacement source while keeping its ID, frozen plan and destination. Exact format IDs remain scoped to their source URL.

## Troubleshooting matrix

| Symptom | Likely cause | Action |
| --- | --- | --- |
| YouTube playlist stalls or returns HTTP 429 | Request burst is too high for current IP/session | Use native playlist mode, set `youtubePlaylistSleepRequests` to 1-3 seconds, retry after a short cooldown. |
| Douyin URL reports no playable formats | Stale cookies or extractor drift | Refresh browser cookies, sync again, update yt-dlp, then retry with CloakBrowser enabled. |
| Douyin gallery opens but only one file is saved | Fallback parser did not resolve gallery images | Re-run and verify metadata includes `_type: douyin_gallery` and `image_urls`; if missing, treat as parser regression. |
| Bulk run stays `running` with no progress | Python bulk subprocess is blocked or waiting on external state | Check status/stderr tail, `cancel` the job, then restart with corrected paths/config. |
| Extension banner keeps showing old failure | `lastDownloadError` is stale and not yet cleared | Dismiss in popup or wait for TTL cleanup; confirm new attempts write a fresh timestamped error only on failure. |
| HTTP 403 without a proven account requirement | Access was denied; source, session, signature or environment may be involved | Preserve the raw reason. Check / recapture the source instead of assuming every 403 means login. |
| HTTP 404 / 410 | Source missing or expired | Verify / replace the URL. Configure engines only when the failure actually identifies a missing executable. |
| Direct MP4 repeatedly disconnects near the end | Some CDN nodes or paths may terminate before the advertised length; retries can keep encountering the failing route | Preserve partial data and inspect actual bytes / range behavior. Do not publish truncated output. Same-host DNS-edge comparison can distinguish a route problem from an unavailable source; see the dated diagnostic below. |
| Original task's exact format is rejected after capture | Format ID belongs to a different URL | Select the new resource's format explicitly; do not silently downgrade the saved intent. |

The current classifier still groups some `fresh cookies` wording under `AUTH_REQUIRED`; the website plan separates guest bootstrap from account login. Do not treat that label alone as proof that an account is necessary.

## Interrupt / resume (yt-dlp)

- Invocations use **`--continue`** and a **temp directory** (`--paths temp:…`) so partial `.part` / fragment state can survive across runs when the OS has not cleared temp.
- **Reality**: if temp was wiped (reboot, disk cleaner, different temp root), yt-dlp may **restart from scratch** even though the DB still shows an older percent until new progress lines arrive.
- The UI **must not regress** to `0%` on the first stderr lines while a resume is warming up; the main process merges progress **monotonically** with the last known value for that task.
- The startup recovery prompt only targets interrupted work. Historical failed / canceled tasks are not silently included; browser source replacement is a new attempt and is not a promise of byte-level continuation.

## 2026-10-18: Xiaohongshu CDN tail disconnect investigation

On installed build **1.1.11**, the initial local history contained 10 direct MP4 downloads from `sns-video-zl.xhscdn.com`: 8 complete, 2 failed. Both failures were `NETWORK_RETRYABLE`, with `RemoteDisconnected` after 10 yt-dlp retries. Their displayed progress was about 98% / 85%; monotonic progress can include the earlier FFmpeg attempt and is not an exact measure of bytes currently downloaded by the fallback engine. This is separate from the preceding unknown-resolution HLS fix.

Independent yt-dlp CLI downloads reproduced both failures. Ordinary early byte ranges returned 206 and the requested bytes; some tail ranges disconnected or returned 200 with the entire response rather than the requested range. Default-route curl over HTTP/2 also failed (exit 92): one object advertised 11,251,761 bytes but delivered 11,010,048; the other advertised 1,842,777 but delivered 1,572,864. This establishes an incomplete transfer beyond the App UI, rather than a resolution-selection error. These observations do not establish that an HTTP HEAD 404 means a GET is unavailable; the same objects returned successful GET responses.

Selecting other addresses from the **same hostname's current DNS answers**, with the original URL, signature, Referer, Origin and TLS hostname verification intact, delivered both full objects. For the smaller object, one explicitly selected address still failed while two others succeeded. Final complete reference downloads were 11,251,761 / 1,842,777 bytes; both H.264 720p + AAC files passed strict full FFmpeg decoding, with durations 108.433333 / 13.6 seconds. All 8 existing completed files also passed strict full local decoding; no source-duration comparison was performed for those 8 files.

**Observation:** success varies with the selected same-host DNS address. **Inference:** some CDN nodes or paths to them are unreliable for these objects. The precise CDN/server/intermediary cause and the address used by every App retry remain unknown. The sample does not establish a general failure rate. No configured environment proxy or enabled macOS HTTP/SOCKS proxy was observed; the default interface was `en0`, which alone does not exclude every possible network intermediary.

At the diagnostic baseline, the App preserved failed task staging and Auto could fall back from FFmpeg to yt-dlp, but it had no explicit DNS-edge rotation; balanced mode supplied fragment sleeps without HTTP retry sleeps. The following implementation addresses that gap. The diagnostic itself did not change installed software or personal task state.

Evidence: [sanitized live diagnostic](reviews/assets/cdn-tail-failure-2026-10-18/diagnostic.json). No source signatures, full URLs, page titles, cookies or media were saved into repository evidence. Temporary reference downloads were removed; personal tasks, settings and installed software were not modified.

### Implemented recovery and review

`progressiveRecovery.ts` owns a per-run recovery budget and temporary connection routes. Eligible direct-file downloads keep the same task, source URL, request headers, selection and destination. After a retryable transport failure, the downloader can try up to three distinct addresses from the original hostname's current DNS results, with 0.5 / 1.5 / 3 second delays. Each authenticated loopback route permits only the original origin; HTTPS remains an opaque CONNECT tunnel with the original TLS hostname, and recovery invokes yt-dlp with certificate verification enabled. No global DNS, certificate or proxy setting changes.

An explicit configured proxy stays authoritative: at most two fresh attempts through that proxy, with no local DNS rotation. Ambient proxy variables disable automatic pinning rather than bypass the selected environment. Literal-IP URLs retain the original engine retry budget because they have no DNS alternatives. Explicit FFmpeg and custom external downloader choices retain their existing paths. HLS/DASH, playlists and site-page resolution do not enter this new direct-file recovery path. HTTP 401/403/404/410/429, certificate failures and selection mismatches do not trigger DNS rotation.

The regular direct-file yt-dlp attempt has two HTTP retries with a 15-second idle timeout; pinned attempts have no inner HTTP retry so a bad edge cannot consume the whole budget. Balanced/gentle HTTP retries now have delays as well. The original failed partial remains in its original temp location. **Cross-edge attempts download into distinct, per-run temporary directories**, because an old yt-dlp `.part` is not bound to a strong ETag. Thus changed versions cannot be spliced together across edges; automatic cross-edge recovery currently trades extra transfer bytes for correctness. Durable validator-bound cross-edge byte resumption is not implemented.

`downloadManager.ts` retains the existing queue slot and abort controller while replacing the closed engine child; cancel, pause and shutdown also close the task route. The prepared route is a distinct internal value in `ytdlp.ts`, so user-proxy normalization continues rejecting embedded credentials while allowing the task-owned authenticated route. No route credentials enter saved settings or task metadata. `downloadError.ts` owns HTTP-status and incomplete-body interpretation. Attempt changes reset stale progress; the existing progress IPC string gains the additive `retrying` phase, shown as “Reconnecting…” / “正在重连…” / “正在重新連線…”. No database migration, extension reload or settings migration is required.

Validation:

- Full `npm test`, typechecks, build and whitespace checks passed. The regular suite now includes restricted route/authentication, exact query/Referer/Range preservation, budget, proxy policy, abort during backoff/DNS and real TLS checks (trusted local test CA; incorrect hostname rejected).
- [12 controlled real-engine E2E scenarios](reviews/assets/cdn-tail-failure-2026-10-18/recovery-e2e.json): tail truncation followed by a healthy edge, Auto routing, changed ETag, an ignored nonzero Range, configured-proxy recovery, permanent truncation, 403/404, cancellation, MP3 extraction, strict saved 360p rejection and two concurrent independent retries. Successful video bytes match the complete current source exactly; successful outputs also pass full decoding. Route counts return to baseline after each terminal task.
- [17 HLS regression scenarios](reviews/assets/cdn-tail-failure-2026-10-18/hls-regression-e2e.json) retain the preceding unknown-resolution behavior and strict 360p upper bound across Auto / yt-dlp / FFmpeg, including unavailable remote probes.
- [Two real HTTPS CDN replays](reviews/assets/cdn-tail-failure-2026-10-18/live-recovery.json) complete and fully decode through actual DNS-pinned routes, with TLS verification and saved 1080p bounds. To exercise the recovery path deterministically, only the initial child failure is injected; subsequent DNS, route, TLS, selected real engine, transfers and validators are real. The wrapper's version is forwarded and its selected setting is asserted, preventing a silent switch to the bundled engine. Personal tasks and settings are read-only in these replays.

Self-review found and fixed two boundary issues: internal authenticated routes were initially rejected by user-settings proxy normalization, and literal-IP URLs initially had a reduced retry budget without a possible DNS alternative. The final implementation distinguishes those owners and preserves the normal literal-IP path. Review also verified source/selection identity, isolated temporary files, cancellation, concurrency and absence of persistent route credentials. Windows/Linux runtime behavior, long-term success rates and process-family CPU/memory remain unmeasured. A redirect to another origin is deliberately unsupported by the pinned lease; all available addresses can still fail, leaving an actionable failure and original partials for manual retry or browser recapture. No arbitrary host substitution or signature editing is performed.

### Local installation and final verification

Installed **1.1.7 / build 1.1.12**, arm64, at `/Applications/V-Download.app`. Apple Development signature with hardened runtime passed deep/strict verification; the DMG passed integrity checks and read-only mount verification. Packaged main SHA-256 equals the tested build: `943d77bf9b3a7789743c86998793231a64e8946f1d487941cfc07c75fd4966b9`. This remains a local development build without notarization or a published update feed.

Before replacement, the App exited normally and a private offline rollback backup was retained (its local path is omitted). Before first launch, all **290** baseline data files and all **10** task rows were byte-for-byte unchanged. Launch did not automatically retry historical failures. Explicitly clicking Retry on the two failed rows completed both downloads; the installed UI showed **10 Downloads · 10 Complete**. Both new files passed strict full decoding; task identity, source, plan, quality and destination fields were preserved. The other eight rows and settings bytes stayed unchanged; SQLite integrity was `ok`. In this final installed retry, the normal route was healthy and neither task needed automatic DNS recovery; the separate deterministic live replays above verify that path rather than attributing these two completions to a route change that did not occur.

The signed local DMG was retained and verified by SHA-256; its machine-specific path is omitted. [Installed validation and data-preservation evidence](reviews/assets/cdn-tail-failure-2026-10-18/installed-validation.json) retains build facts and media validation without source URLs, task identifiers, page tokens, titles or personal media hashes. The earlier cleared HLS task remains cleared; no historical backup was restored.

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
