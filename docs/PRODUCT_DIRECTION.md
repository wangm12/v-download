# Product direction

## Decision

V-Download will remain a Downie-style downloader as its primary product. The core promise is fast, reliable capture from pasted URLs, browser-extension events, Douyin workflows, and sniff sessions—not a general-purpose media center.

The Library and Sniff experiences are supporting surfaces around that promise:

- **Library Phase A** gives completed downloads a searchable, grouped home without introducing a second media database.
- **Sniff** exposes browser-captured resources when yt-dlp cannot resolve a page directly.
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

Until those signals exist, the next investments should deepen the downloader: Sniff session quality, engine freshness, authentication recovery, format/post-processing presets, and Library search and batch operations.
