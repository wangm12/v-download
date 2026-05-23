# Future enhancements

Backlog and research notes for **V-Download** and related pieces (**vdl-server**, Douyin fallback). Nothing here is committed scope; use it for prioritization and onboarding.

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
| **vdl-server** Douyin issues | No Electron; fallback is **Node `fetch` only** — same anti-bot shell limits unless yt-dlp or cookies succeed. |

### Already landed (for historical reference)

- **Fetch order:** try **`https://www.douyin.com/video/{id}`** before iesdouyin/m share URLs (Node fetch often succeeds without Chromium).
- Resolved share URL appended only when not already in the list.
- Chromium: extend wait on each `did-finish-load` (reload chain), mobile UA for `www.douyin.com/video/`, broader `htmlLooksHydrated` (`aweme_id` in large HTML), skip second Chromium pass on the same URL when the first UA already hydrated.
- Clipboard / bot URL extraction; `playAddr` + loose `play_addr` / `aweme/v1/play` patterns; final canonical Chromium retry with extended timeout.

---

## Planned improvements (backlog)

### 1. Douyin URL order and parse coverage (high value, low risk)

- ~~Move **`https://www.douyin.com/video/{videoId}`** earlier in **`pageUrls`**~~ **Done** (desktop app + vdl-server): canonical is tried first; resolved ies URL is last when present.
- Capture a **stable sample** of hydrated iesdouyin HTML and extend **`parseDouyinPageHtml`** / **`JSON_MARKERS`** (or new script-tag extractors) for whatever embed shape replaces `_ROUTER_DATA` on that host.
- Optionally refine **`htmlLooksHydrated`** so “large but still unparseable” pages do not exit the poll loop too early.

### 2. Hydration timing and resilience

- Tune **timeouts** and polling interval after observing real-world `did-finish-load` + reload patterns.
- Document or gate **experimental** Chromium flags (GPU, etc.) only if we see platform-specific failures.

### 3. Optional: [CloakBrowser](https://github.com/CloakHQ/cloakbrowser) (Playwright + patched Chromium)

**What it is:** upstream ships a **custom Chromium** (~200MB, auto-downloaded) with **C++-level** fingerprint / anti-automation patches, exposed via a **Playwright** (or Puppeteer) compatible **`launch()`** API — not something you load inside Electron’s existing `BrowserWindow`.

**Possible fit:** may reduce **timeouts** or hard **bot / TLS / headless** friction when stock Electron Chromium is scored down; it does **not** replace **parser** work when HTML is already big but uses a schema we do not read.

**Costs / risks:**

- **Second Chromium** on disk and in RAM whenever used.
- **Binary license** separate from MIT wrapper — read [BINARY-LICENSE.md](https://github.com/CloakHQ/cloakbrowser/blob/main/BINARY-LICENSE.md); redistribution of the binary may be restricted; typical use is per-user cache download via npm.
- **macOS** builds may track fewer patches than Linux/Windows per upstream README; first-run **Gatekeeper** friction.
- Dependency alignment: **`cloakbrowser`** + **`playwright-core`** versions must stay compatible.

**Suggested approach:** treat as **optional** (env flag or Settings “Experimental”) only if, after (1), **`www.douyin.com`** hydration still fails often — implement by swapping or supplementing **`fetchDouyinHtmlWithChromium`** in [`douyinBrowserFetch.ts`](../src/main/douyinBrowserFetch.ts) with Playwright + persistent context and the same cookie bridge as today.

### 4. vdl-server parity

- Document that **Telegram bot** Douyin fallback has **no** hidden-browser path unless we add a headless stack server-side (operational cost, licensing, updates).
- Continue to rely on **yt-dlp + `COOKIE_MODE=file`** and shared parser improvements in [`vdl-server/src/douyin.ts`](../vdl-server/src/douyin.ts).

---

## Related files

| Area | Path |
|------|------|
| Douyin metadata + parse | [`src/main/douyin.ts`](../src/main/douyin.ts) |
| Electron Chromium hydration | [`src/main/douyinBrowserFetch.ts`](../src/main/douyinBrowserFetch.ts) |
| Queue / yt-dlp then fallback | [`src/main/downloadManager.ts`](../src/main/downloadManager.ts) |
| Clipboard URL extraction | [`src/renderer/src/utils/youtube.ts`](../src/renderer/src/utils/youtube.ts) |
| Bot URL extraction | [`vdl-server/src/bot/index.ts`](../vdl-server/src/bot/index.ts) |
| Manual test matrix | [MANUAL_TESTING.md](./MANUAL_TESTING.md) |
