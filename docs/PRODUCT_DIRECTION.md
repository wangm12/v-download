# Product direction

## Decision

V-Download will remain a Downie-style downloader as its primary product. The core promise is fast, reliable capture from pasted URLs, the Chrome extension, and Douyin workflows—not a general-purpose media center.

**Shipped today:** the download queue, in-app Preferences, format/collection pickers, and extension page sniffing. There is **no** in-app Library or Sniff workspace (the shell contract tests forbid those nav entries).

These remain **backlog**, not current UI:

- **Library Phase A** — a completed-download home on top of existing SQLite rows and `downloadDir`, without a second media database.
- **Sniff (in-app)** — a dedicated session UI for browser-captured resources when yt-dlp cannot resolve a page. Capture today goes through the Chrome extension and the queue.
- **Native account login**, engine updates, onboarding, and lightweight localization reduce setup and recovery friction.

## Why this direction

The existing architecture and strongest differentiation are already concentrated in the downloader workflow: Chrome extension integration, Douyin-specific recovery, asynchronous info resolution, grouped queue scheduling, and structured recovery actions. A player, RSS reader, or music client would introduce a larger product surface while competing in categories that are not required for the primary download job.

Keeping the focus also lets the app improve the moment users care about most: getting a usable local file from a difficult or authenticated page with clear progress and recovery.

## Product guardrails

1. New features should make capture, resolution, download, recovery, or completed-file handling better.
2. Library work should reuse download records first; a separate media index is not justified until search and browsing needs exceed the queue database.
3. Post-processing should stay optional and file-oriented. It must preserve the original download.
4. Browser and native authentication remain complementary paths. Neither should make the other mandatory.
5. RSS, playback, tagging, and media-server features remain out of scope for the current product line.

## Revisit criteria

Reconsider a media-center pivot only if there is sustained evidence that users primarily return to browse and play an existing collection, rather than capture new media. Useful signals would include repeated Library sessions, requests for playback or metadata management, and a clear target audience for RSS or music workflows.

Until those signals exist, the next investments should deepen the downloader: extension sniff quality, engine freshness, authentication recovery, format/post-processing presets, the Library Phase A backlog, and user-facing output templates.

## Shipped (from this backlog)

| Item | Living doc |
|------|------------|
| **MCP facade** — `POST /mcp` and `GET /v1/jobs` on the Remote Job API listener; writes off by default | [REMOTE_JOB_API.md](./REMOTE_JOB_API.md) |
| **Shared resolve + note.md** — UI paste and Remote API use the same resolver; captions saved as markdown | [REMOTE_JOB_API.md](./REMOTE_JOB_API.md), [MANUAL_TESTING.md](./MANUAL_TESTING.md) |

Historical specs: [superpowers/archive/](./superpowers/archive/).

## Open backlog (from better-douyin review)

Public [better-douyin](https://github.com/anYuJia/better-douyin) is a Douyin-native desktop shell. Learn **library grouping, archive templates, and local AI control-surface packaging** — not their player, feed, IM, or platform connectors. Do not copy that repository's source (Non-Commercial license) into this MIT project.

| Priority | Item | Spec |
|----------|------|------|
| 1 | **Library Phase A** — completed-file home: disk scan + existing SQLite rows; file view / work view; search, filter, page, Reveal, delete, refresh | [2026-08-31-library-phase-a-design.md](superpowers/specs/2026-08-31-library-phase-a-design.md) |
| 2 | **Output templates** — filename / folder tokens and optional author folders, mapped to yt-dlp `-o` and existing Douyin/XHS sanitizers | [2026-08-31-output-templates-design.md](superpowers/specs/2026-08-31-output-templates-design.md) |
| Later | **Creator watch list** — save a Douyin profile already listable today; manual “check for new posts” first; conservative caps. No new signing or hidden crawl. | — |
| Polish | Template / Remote API field-level save feedback | — |

Douyin hydration and parser research: [download-reliability.md](./download-reliability.md).

## Explicit non-goals

These stay out of scope even if a Douyin client implements them:

- In-app immersive **playback** (system Open / Reveal only)
- Recommended feed, likes/favorites browsing, notices, friends/IM
- Auto like / comment / follow / DM / “AI social” automation
- Replacing Electron with Tauri, or hiding engines behind an open-shell split
- Completing or translating third-party private platform connectors, signing, or bypass logic
- A standalone `v-download-cli` — other apps should call the running desktop app on `:18766` ([REMOTE_JOB_API.md](./REMOTE_JOB_API.md))
