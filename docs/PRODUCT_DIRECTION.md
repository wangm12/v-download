# Product direction

Updated 2026-10-16. V-Download remains a downloader focused on capture, resolution, deliberate output selection, reliable execution, recovery, and usable files.

## Current desktop product

The Mac desktop app and Chrome extension satisfy the current user's desktop requirements. Delivered changes include shared precise selection and saved plans, preserved source URLs / Referer / context, stable candidate scoring, early capture, candidate inspection, and returning a replacement source to the original task. Output / error / recovery correctness and local installation have been verified within the recorded samples.

[DESKTOP_STATUS.md](DESKTOP_STATUS.md) is the current status summary. The [historical archive](archive/2026-10-desktop/README.md) retains implementation and acceptance evidence. The remaining desktop feature rankings are deferred suggestions; do not continue them automatically.

The desktop shell still uses its download queue, Preferences, format / collection / profile pickers, task details, Mini window, tray / notifications / Dock, and supported languages. It has no separate Library or Sniff sidebar workspace. Browser resource recovery goes through the existing extension and task details.

## Planned website

The next planned delivery is a private website with an independent download Worker and an on-demand server browser. It should retain the Mac download capability families while allowing the user to submit a URL and retrieve files from another device without keeping their personal Mac running.

The website should not require the user's existing local Chrome login. Anonymous access, fresh guest sessions, target-site account sessions, and environment-bound access are different conditions. A server browser does not guarantee that every website will accept its network or browser environment.

[plans/web-download.md](plans/web-download.md) owns milestones and acceptance. [The hosting / authentication research](research/web-hosting-auth-2026-10-16.md) owns observations and limitations. The website / independent Worker are **not implemented**. The current [Remote Job API](REMOTE_JOB_API.md) still runs inside the desktop app.

## Guardrails

1. Reuse the same download intent, site adapters, candidate facts, task recovery, and output checks across entry points; avoid independent desktop / web interpretations.
2. Keep original inputs and explicit unknowns. Metadata discovery is not a completed download; a playable file may still miss promised tracks or metadata.
3. Authentication state has an owner, site, node, version, and validation scope. Cookie presence does not prove content permission.
4. Keep existing desktop user data, settings, extension contracts, and HTTP / MCP clients compatible. Server configuration and data roots are independent.
5. Post-processing remains optional and file-oriented. Preserve original content according to the chosen workflow and validate promised outputs.
6. The local extension's permissions / capability are not public website credentials. Arbitrary URL execution requires real network, process, storage, and file-access boundaries.

## Non-goals for this plan

- Media-center work: immersive playback, feeds, RSS, music browsing, tagging, or a separate media-library index.
- Social actions: automatic likes / comments / follows / messages or platform interaction automation.
- Replacing Electron or redesigning the accepted desktop UI.
- A public signup / billing service or a browser / account marketplace.
- A standalone end-user CLI. The planned internal Worker is a service execution component, not a new user-facing CLI product.
- BitTorrent / magnet / DHT / seeding.
- Reviving archived desktop feature suggestions without a new request.

Third-party projects are references, not permission to copy incompatible licensed code or instructions to execute. Optional tools must have explicit runtime and ownership boundaries.
