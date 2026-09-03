# Output templates — design

**Status:** spec only (not implemented)  
**Product:** file-oriented naming only ([PRODUCT_DIRECTION.md](../../PRODUCT_DIRECTION.md) guardrail 3)  
**Plan:** [../plans/2026-08-31-output-templates.md](../plans/2026-08-31-output-templates.md)

## Problem

Save location is a single directory plus `playlistSubfolder`. yt-dlp already uses hardcoded `-o` strings in [`ytdlp.ts`](../../../src/main/ytdlp.ts):

- playlist: `%(playlist_index)03d - %(title)s.%(ext)s`
- titled: `{sanitizedTitle}.%(ext)s`
- default: `%(title).200B [%(id)s].%(ext)s`

Douyin / XHS / ffmpeg paths use [`sanitizeDownloadBasename`](../../../src/main/sanitizeDownloadBasename.ts) and often `{title}.mp4`. Profile bulk sets `playlistId` to the author name ([`DouyinProfilePickerDialog.tsx`](../../../src/renderer/src/components/DouyinProfilePickerDialog.tsx)) so the folder is author-shaped only for that flow.

Users cannot say “always `{author}/{date}_{title}_{id}`” for every site.

## Goal

One settings language for **folder** and **filename**, applied by:

1. yt-dlp `-o` (and `--paths`)
2. Non-yt-dlp writers (Douyin stream, gallery, XHS, ffmpeg direct)

`playlistSubfolder` stays. Author archive is an extra optional segment, not a replacement.

## Settings (add to `SettingsSchema`)

| Key | Default | Meaning |
|-----|---------|---------|
| `filenameTemplate` | `{title} [{id}]` | Basename without extension |
| `folderNameTemplate` | `{author}` | Subfolder when `archiveByAuthor` is on |
| `archiveByAuthor` | `false` | Create `folderNameTemplate` under `downloadDir` when author/channel is known |
| `playlistSubfolder` | existing `true` | Unchanged: playlist id / title folder |

Remote Job API jobs keep writing under `{downloadDir}/remote-jobs/{id}` and **ignore** author/playlist templates (sandbox must not move).

## Tokens

User-facing tokens (chip UI). Never accept raw `%(` interpolation from the user.

| Token | yt-dlp | App fallback (Douyin/XHS/ffmpeg) |
|-------|--------|----------------------------------|
| `{title}` | `%(title).200B` | `sanitizeDownloadBasename(title)` |
| `{id}` | `%(id)s` | aweme id / URL id / task id |
| `{author}` | `%(uploader)s` | `channel` / author nickname; empty → skip folder segment |
| `{date}` | `%(upload_date>%Y-%m-%d)s` or download local date if unknown | `YYYY-MM-DD` local |
| `{time}` | local time if we cannot get upload time | `HHmmss` local |
| `{site}` | extractor-ish host label (`youtube`, `douyin`, …) | host from URL |
| `{ext}` | `%(ext)s` (filename only; do not put in folder) | real extension |

Illegal path characters → `-`. Empty `{author}` with `archiveByAuthor`: write to `downloadDir` (or playlist folder), do not create a folder named `unknown` unless the user typed that literal.

## Path composition

```
{downloadDir}
  / {folderNameTemplate}?          if archiveByAuthor and template renders non-empty
  / {playlistFolder}?              if playlistSubfolder and this is a playlist/profile batch
  / {filenameTemplate}.{ext}
```

Profile bulk should use the **same** folder template instead of a one-off `playlistId = author` when `archiveByAuthor` is on (avoid `Author/Author/file`). When `archiveByAuthor` is off, keep today’s author-as-playlist-folder behavior for profile picks so existing users do not flatten overnight — or migrate: treat profile batch as a playlist named from `folderNameTemplate` or profile label. **Decision:** profile pick uses `folderNameTemplate` when `archiveByAuthor` is true; otherwise keep current `playlistId = profileLabel/author`.

## Live Photo / extras (Phase A of templates)

No new settings toggle required for still vs video. If both are saved, use `{id}` / index suffixes already used by gallery downloaders. A later `{media_type}` token can distinguish `video` / `image` / `audio` once Library lands.

Skip-existing: yt-dlp `--continue` already; Douyin adopt-existing path stays. Surface “skipped, file exists” on the queue row when adopt/skip happens (copy only; no new engine).

## UI

Preferences → Downloads / Save files:

- Filename field + token chips
- Archive by author toggle + folder field + chips
- Live preview: `~/Downloads/DemoAuthor/2026-08-31_Title [id].mp4`
- Validate: unknown `{token}` → inline error, do not save
- Persist via existing `update-settings`

## Tests

- Token render: empty author omits folder
- User string cannot inject `%(` or `..` path segments
- yt-dlp argv contains exactly one `-o` derived from the template
- Remote jobs still land in `remote-jobs/{id}`
- `sanitizeDownloadBasename` still applied on custom writers

## Acceptance

- User sets `{author}/{title} [{id}]` and a YouTube + Douyin download both honor it
- Playlist downloads still nest when `playlistSubfolder` is on
- Turning templates off (defaults) remains collision-safe (`[id]` in default filename)
