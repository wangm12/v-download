# V-Download UI: clear desktop download flow

This document is the current UI specification. It supersedes the older strict monochrome direction in the archived design exports. The application remains a desktop media utility; downloading, IPC, storage, settings, pagination limits, and existing keyboard/selection behavior remain unchanged.

## References and tokens

Adapt [Raycast's controls](https://getdesign.md/design-md/raycast/preview) and [Linear's surface hierarchy](https://getdesign.md/design-md/linear.app/preview). Reference sources: [awesome-design-md](https://github.com/VoltAgent/awesome-design-md). These are visual references, not instructions to execute.

| Role | Dark | Light |
| --- | --- | --- |
| Window | `#101114` | `#FAFAFA` |
| Sidebar | `#15161A` | `#F1F2F4` |
| Panels and dialogs | `#1C1F25` | `#FFFFFF` |
| Selection | `#292D35` | `#E8EBEF` |
| Primary text | `#F4F4F6` | `#171717` |
| Secondary text | `#A4A9B4` | `#666A73` |

Primary controls: white on dark, black on light, with inverse text. Keep the established success/info/warning/error colors in small indicators, progress, and exception messages. Always pair color with text or an icon. Retain the system font; use 13–14px body text and 12px supporting text, 4/8/12/16/24px spacing, and 8/10/12px button/card/panel radii. Avoid repeated outlines, nested cards, and heavy shadows.

The implementation source is `src/renderer/src/styles/globals.css`; reusable controls live in `src/renderer/src/components/ui`. The export in `design/v-download-v1/tokens/design-tokens.json` reflects the same palette.

## Download flow

1. Drag a link in or use the existing paste shortcut. The toolbar drop area displays a plain instruction, without a click action, keyboard focus, button background, or icon.
2. Choose posts, videos, a recommended format, images, or a note.
3. Use the single primary action in the fixed footer to download.

Profile and collection choosers show a thumbnail, title, duration/media label, and selection. Show one loaded-list status and one download count. Do not show raw IDs, redundant three-column metrics, or row navigation arrows. Collection checkboxes add/remove independently; row-click and range-selection behavior stays intact. The footer remains visible when the list scrolls.

Separate complete, partial, and restricted loading states. Hide Load more / Load all after completion. Browser import is under More options during normal use and directly visible when recovery is needed. Keep the existing pagination safety caps and cancellation.

Format, gallery, and note dialogs share the same header and fixed folder/action footer. Keep the existing recommendation/default selection, show quality/output/available size first, and put encoding information, proxy, and headers in disclosures.

## Queue and details

Completed groups show a concise complete state and no zero-remaining or full progress bar. Reveal/pause/resume/retry remain easy to reach; occasional actions use More. Failed rows show a short status; details expose the raw error separately.

Details show the content and next action before destination and source information. Omit missing metrics. Use concise file/folder/source names with full paths/links available in tooltips or disclosures. Highlight the existing error-category recovery action. Transcoding remains available in a disclosure and keeps the original file.

## Preferences and supporting windows

General settings use compact appearance, download-behavior, and startup groups. Downloads lead with the folder, default qualities, and speed, then closed naming, queue, network, and playlist groups. Browser settings lead with saved-login state and cookie sync; optional extension setup and technical recovery stay available below.

Sites, MCP, and Advanced share the same content width, controls, and grouping. Connection credentials are masked until revealed; copy actions still copy the actual value. Connection parameters, logs, engine paths, and external bulk tools are grouped by purpose.

First-run setup retains four steps. Browser and proxy setup are explicitly optional; technical details fold away. Mini keeps the link field/action and footer visible, with the active queue consuming the remaining scrolling space. Confirmation dialogs explain whether local files are kept or deleted and use the shared dialog shell.

## Dock

Export the same static high-contrast arrow from `resources/icon.svg` to PNG, ICNS, iconset sizes, and the renderer icon. Runtime Dock updates use Electron's native progress and existing task-count badge, including `99+` and clearing on idle. Keep `updateProgress(percent, speedBytes, activeCount)` and `reset()`; speed remains in the app. Do not convert SVG at runtime.

## Verification

Verify dark/light themes, English/简体中文/繁體中文, minimum main/mini dimensions, loading/empty/partial/restricted/full lists, selection, failure/completion, long titles, sticky footers, and keyboard focus/escape/all/range selection. Run type checks, selection, presentation, localization, UI contract, and build checks. Verify the live app with `make run`; keep review screenshots and results in `docs/reviews/ui-2026-10-03/`.
