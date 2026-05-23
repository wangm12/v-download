# V-Download black and white redesign specification

## Product direction

The application is built around the same simple downloader pipeline:

1. Capture a URL or browser page.
2. Scan the page for video, audio, captions, and playlists.
3. Recommend the best output format.
4. Download into a visible queue.
5. Recover failed downloads with plain-language actions.

This revised phase removes the previous decorative color palette. The interface should feel more restrained, premium, and utility-focused: black surfaces, white primary actions, gray supporting text, and state labels that do not rely on hue.

## Monochrome visual principles

### Palette

Use only black, white, and neutral grays.

- App background: `#050505`
- Window: `#0B0B0B`
- Sidebar / inspector: `#0D0D0D`
- Card surface: `#111111`
- Raised surface: `#161616`
- Elevated surface: `#1C1C1C`
- Primary text: `#FFFFFF`
- Secondary text: `#A4A4A4`
- Tertiary text: `#707070`
- Borders: `rgba(255,255,255,0.12)` to `rgba(255,255,255,0.22)`
- Primary action: white fill with black text

### State treatment

Do not use green, red, yellow, purple, or blue for status. State is communicated with labels, shape, border treatment, and hierarchy.

- Complete: neutral pill with a small white dot and label `Complete`.
- Downloading: stronger neutral pill and progress bar.
- Queued: softer neutral pill.
- Needs login / failed: dashed border treatment plus direct action label.
- Selected: higher-contrast card surface and stronger border.

### Simplicity rules

- One primary action per surface.
- Avoid gradients except subtle black-to-gray thumbnail placeholders.
- Avoid glow, neon, and colorful shadows.
- Keep thumbnails neutral until real video thumbnails are loaded.
- Use contrast and alignment instead of color to create priority.

## Information architecture

### Sidebar

The sidebar is the permanent control center. It contains:

- Primary action: Paste URL.
- Library filters: All downloads, Active, Completed, Failed.
- Capture modes: Browser capture, Playlists, Audio only.
- Download folder summary and available space.

### Center queue

The queue is the main workspace. It contains:

- Search and filters.
- Clipboard/drop banner.
- Download rows with thumbnail, title, format, progress, status, and contextual actions.
- Batch controls when playlists or multiple downloads are selected.

### Right inspector

The inspector replaces many small modal decisions. It shows details for the selected item:

- Preview thumbnail.
- Output format.
- Duration, size, speed, remaining time, or failure cause.
- Destination.
- Contextual actions such as Open, Reveal in Finder, Change format, Retry, Sync cookies.

## Key screens

### Main queue / dashboard

The default working state uses a three-column layout. Paste URL is always visible, clipboard detection appears as a drop banner, and selected-row details appear in the inspector.

### Empty state / first launch

The first-run screen teaches three capture methods: paste a URL, drag a link into the window, or use the browser companion for logged-in pages.

### Paste URL flow

The sheet validates the link before scanning and keeps options practical: show format picker, use browser cookies, create subfolder, audio only, and destination.

### Scanning state

Scanning must feel observable rather than stuck. Show steps for page loaded, detecting streams, and checking formats, with Cancel and Show scan log actions.

### Format picker

The format picker helps users choose with recommended rows, estimated sizes, and a single primary action: Download selected.

### Playlist detected

The playlist screen supports batch selection, preset format, destination grouping, duplicate skipping, and caption options.

### Active downloads

Active downloads emphasize speed, remaining time, progress, pause/resume, and priority controls.

### Completed detail

Completed downloads prioritize Open file, Reveal in Finder, Copy source link, and Remove history.

### Error recovery

Failures should be written as user-facing problems, not technical logs. Use clear action labels such as Sync browser cookies, Open source page, Retry now, and Show log.

### Preferences

Preferences are split into stable sections: General, Downloads, Browser, Sites, and Advanced.

### Browser companion guide

The guide explains installation, pinning, testing, and usage without cluttering Preferences.

### Compact mode

Compact mode supports quick capture, active progress, Pause all, and Open full app.

## Component rules

### Buttons

- Primary action: white fill, black text.
- Secondary action: transparent or low-contrast neutral surface.
- Destructive/recovery action: no red; use plain label, dashed or stronger border, and clear copy.

### Status pills

Use neutral pills only. Pair every status with text. Do not communicate status by color alone.

### Download rows

Each row should contain thumbnail, title, metadata, progress when relevant, status pill, and limited contextual actions.

### Inspector

The inspector should always reflect the selected row and never feel empty. When no row is selected, show global tips or current download folder information.

### Modals

Use modals only for focused decisions: Paste URL, Format picker, and Browser setup guide.

## Copy guidelines

| Current wording | New wording |
|---|---|
| Show Format Dialog | Show format picker before download |
| Playlist/Channel Subfolder | Create playlist and channel subfolders |
| Sync cookies | Sync browser cookies |
| Browser for Douyin | Browser profile for Douyin / TikTok |
| Auto | Best available |
| Scanning page for media... | Scanning page for media |

## Suggested keyboard shortcuts

| Shortcut | Action |
|---|---|
| Command+V | Paste and scan URL |
| Command+O | Open selected file |
| Command+R | Retry selected download |
| Space | Pause/resume selected download |
| Command+, | Preferences |
| Delete | Remove selected history item |

## Implementation priority

### Phase 1 - Monochrome shell

- Apply black and white tokens.
- Implement sidebar, queue, and inspector layout.
- Redesign download row states without color-coded statuses.
- Add persistent Paste URL action and clipboard/drop banner.

### Phase 2 - Capture and format flows

- Add Paste URL sheet.
- Add scanning progress state.
- Replace format dialog with recommended format picker.
- Add playlist detection and batch selection.

### Phase 3 - Recovery and settings

- Add login-required recovery flow.
- Rebuild Preferences into grouped sections.
- Add browser companion guide.
- Add compact capture window.

### Phase 4 - Polish

- Add light surface variant.
- Add motion and transition rules.
- Add keyboard shortcuts.
- Add accessible focus rings and reduced-motion behavior.

## Accessibility notes

- Maintain visible focus states for buttons, rows, and inputs.
- Pair all statuses with labels; never depend on color.
- Keep row title text at least 13-14 px.
- Use high contrast for primary actions and recovery buttons.
- Support reduced motion for scanner and progress animations.
