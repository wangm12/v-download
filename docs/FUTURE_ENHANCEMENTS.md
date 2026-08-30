# Future enhancements

Backlog and research notes for **V-Download**. Nothing here is committed scope; use it for prioritization and onboarding.

---

## Douyin desktop fallback (context)

### How it works today

1. **yt-dlp** is tried first (with Douyin-specific headers and optional browser cookies).
2. On failure, **`getDouyinInfo`** in [`src/main/douyin.ts`](../src/main/douyin.ts) resolves short links (`v.douyin.com/...`), extracts a numeric **video id**, and tries several **page URLs** with mobile and desktop `fetch`.
3. **Node `fetch`** often receives an **anti-bot HTML shell** (empty `<body>`, `byted_acrawler`, `location.reload`) with **no** embedded `_ROUTER_DATA` / `item_list` / `play_addr` JSON.
4. **[`src/main/douyinBrowserFetch.ts`](../src/main/douyinBrowserFetch.ts)** loads the same URL in a **hidden Electron `BrowserWindow`** (persistent session partition, optional Netscape cookie injection) and polls `document.documentElement.outerHTML` until the page looks **hydrated** (heuristic markers), then parsing runs again.
5. If all plain fetches still fail, a **final Chromium pass** uses the canonical **`https://www.douyin.com/video/{videoId}`** URL, which often matches what the in-app parsers expect.
6. **`downloadDouyinVideo`** streams from the constructed `aweme.snssdk.com` play URL when metadata was recovered.

### Pain points observed in the wild

| Symptom | Likely cause |
|--------|----------------|
| Large HTML (~0.8–1.0 MB) but **No `_ROUTER_DATA` found** | Hydrated **iesdouyin.com** / **m.douyin.com** may omit `_ROUTER_DATA` — mitigated by **trying `www.douyin.com/video/{id}` first**; parsers may still need new markers if only ies HTML is available. |
| **Timed out waiting … to hydrate** | Slow reload after acrawler; mitigated by **deadline bumps on `did-finish-load`**, longer initial window, **mobile UA on canonical** in Chromium, and **one Chromium attempt per URL** (no duplicate desktop pass after shell). |

### Already landed (for historical reference)

- **Fetch order:** try **`https://www.douyin.com/video/{id}`** before iesdouyin/m share URLs (Node fetch often succeeds without Chromium).
- Resolved share URL appended only when not already in the list.
- Chromium: extend wait on each `did-finish-load` (reload chain), mobile UA for `www.douyin.com/video/`, broader `htmlLooksHydrated` (`aweme_id` in large HTML), skip second Chromium pass on the same URL when the first UA already hydrated.
- Clipboard URL extraction; `playAddr` + loose `play_addr` / `aweme/v1/play` patterns; final canonical Chromium retry with extended timeout.

---

## Planned improvements (backlog)

### 1. Douyin URL order and parse coverage (high value, low risk)

- ~~Move **`https://www.douyin.com/video/{videoId}`** earlier in **`pageUrls`**~~ **Done**: canonical is tried first; resolved ies URL is last when present.
- Capture a **stable sample** of hydrated iesdouyin HTML and extend **`parseDouyinPageHtml`** / **`JSON_MARKERS`** (or new script-tag extractors) for whatever embed shape replaces `_ROUTER_DATA` on that host.
- Optionally refine **`htmlLooksHydrated`** so “large but still unparseable” pages do not exit the poll loop too early.

### 2. Hydration timing and resilience

- Tune **timeouts** and polling interval after observing real-world `did-finish-load` + reload patterns.
- Document or gate **experimental** Chromium flags (GPU, etc.) only if we see platform-specific failures.

### 3. Optional: [CloakBrowser](https://github.com/CloakHQ/cloakbrowser) (Playwright + patched Chromium)

Already available as a Settings toggle. Keep treating it as **optional** if stock Electron Chromium is scored down. Costs: second Chromium on disk/RAM, separate binary license, Gatekeeper friction on macOS.

### 4. Optional CLI (not committed)

A future `v-download-cli` could wrap the same yt-dlp spawn path as Electron main. It is not required for the Remote Job API — other apps should call the running desktop app on `:18766`.

---

## Related files

| Area | Path |
|------|------|
| Douyin metadata + parse | [`src/main/douyin.ts`](../src/main/douyin.ts) |
| Electron Chromium hydration | [`src/main/douyinBrowserFetch.ts`](../src/main/douyinBrowserFetch.ts) |
| Queue / yt-dlp then fallback | [`src/main/downloadManager.ts`](../src/main/downloadManager.ts) |
| Remote Job API | [`src/main/remoteApiServer.ts`](../src/main/remoteApiServer.ts) |
| Clipboard URL extraction | [`src/renderer/src/utils/youtube.ts`](../src/renderer/src/utils/youtube.ts) |
| Manual test matrix | [MANUAL_TESTING.md](./MANUAL_TESTING.md) |
