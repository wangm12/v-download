# Shared resolve + note.md — design

**Status:** implemented  
**Product:** UI paste and Remote Job API use the same resolver; save parsed caption/description as markdown  
**Does not replace:** [library-phase-a](../specs/2026-08-31-library-phase-a-design.md), [output-templates](../specs/2026-08-31-output-templates-design.md)

## Problem

`POST /v1/jobs` and MCP `enqueue_job` call `addTask({ format: 'video' })` without `resolveVideoInfo`. Xiaohongshu image notes therefore hit yt-dlp and fail with `No video formats found`. The desktop paste path already classifies Xiaohongshu galleries.

Users also want the **parsed post text** saved as markdown whenever the resolver already has it. This is not a general webpage archive.

## Goal

One resolve path for **Preferences paste** and **Remote Job API / MCP**:

| After resolve | Media | Markdown | Job result |
|---------------|--------|----------|------------|
| Xiaohongshu gallery | Images in `Title/` | `Title/note.md` | complete |
| Xiaohongshu video, YouTube, X-with-video, other yt-dlp media | Existing yt-dlp/ffmpeg file | Sidecar `Title.md` next to the media file | complete |
| Title or description, no media (Xiaohongshu text note, X text-only if yt-dlp still emits metadata) | none | `Title.md` in the download dir | complete |
| No media and no title/description | none | none | error (same as today) |

UI and API behave the same.

## Non-goals

- Readability / full-page article extraction for arbitrary URLs
- `rednote.com`
- Live Photo, CDN format rewrite, account feeds, search
- Changing video files into per-task folders
- Forcing a `.md` on playlist fan-out items that have no description
- A Twitter-specific crawler; text-only X succeeds only if yt-dlp metadata exists after a no-formats error
- New create-job body fields (still `{ "url" }` only)

## Classification

`resolveVideoInfo` remains the only classifier. It does not trust the client’s idea of “video vs images”.

1. Xiaohongshu URL → `getXiaohongshuInfo`
   - `imageList` and not a video note → `_type: 'xhs_gallery'` (unchanged)
   - video note → fall through to yt-dlp (unchanged)
   - title and/or `desc`, no images, no video → `_type: 'text'` (new). Do not call yt-dlp.
2. Douyin gallery → unchanged (`douyin_gallery`)
3. Else yt-dlp `getVideoInfo`
   - formats present → `_type: 'video'` (or playlist entries as today)
   - exit is `No video formats found` (or equivalent) **and** JSON still has `id`/`title`/`description` → treat as `_type: 'text'`
   - otherwise error

`parseVideoInfoFromJson` must pass through `description` (yt-dlp field). Douyin text uses the existing caption/`desc` already stored as title when that is all we have; if a longer `desc` is already on the parsed object, use that for markdown and keep the short title for the filename.

## Markdown

One helper, e.g. `renderNoteMarkdown({ title, author, url, description })`:

```markdown
# <title>

- Author: <author>   <!-- omit line if empty -->
- URL: <url>

<body>
```

`body` is `description` / Xiaohongshu `desc`. If description is empty, the heading and metadata lines are enough. If title is empty, use `Untitled` in the heading and `untitled` for the basename.

No HTML-to-md conversion. Do not invent tags, dates, or like counts.

## File names

Reuse `sanitizeDownloadBasename`.

- Gallery (Xiaohongshu or Douyin): write `note.md` **inside** the existing image folder after images succeed (or immediately if a future gallery has zero images but that path is not in this spec).
- Sidecar for a single media file: same basename as the completed file, `.md` (e.g. `Foo.mp4` → `Foo.md`). If the stem cannot be derived, fall back to sanitized title.
- Text-only: `sanitizeDownloadBasename(title).md` in the task output directory (user download dir, or the Remote Job `remote-jobs/{id}` folder when that is the task output).

Do not overwrite a different task’s file. If the target `.md` already exists for this task retry, overwrite that sidecar.

## Remote Job API

[`enqueueJob`](../../../src/main/remoteJobService.ts) for a **single** URL (not playlist fan-out) must:

1. Call `resolveVideoInfo(url)` with the same cookies/proxy as the UI.
2. On resolve error, fail the job with that message (including the Xiaohongshu no-video / cookie hint). Do not enqueue a blind video task.
3. On gallery: `addTask` with `xhsImageUrls` or `douyinImageUrls`, real title, plus note fields.
4. On video: `addTask` as today but with title/thumbnail/duration from resolve and note fields.
5. On text: `addTask` with note fields only (no yt-dlp). `runTask` writes the md and completes.

Playlist / collection fan-out stays as today (yt-dlp list + video tasks). Write a sidecar md for a fan-out item only if that item’s resolve/info already has a description; do not add a second resolve storm in this spec.

MCP `enqueue_job` stays a wrapper of `POST /v1/jobs`. No new tools.

## Download manager

`runTask` order:

1. If `xhsImageUrls` / `douyinImageUrls` → existing gallery download, then write `note.md` in that folder.
2. Else if media should run (not `_type: 'text'` / not note-only metadata) → existing yt-dlp/ffmpeg path, then write sidecar md if note fields are non-empty.
3. Else if note fields have title or description → write `Title.md`, mark complete.
4. Else error.

Retry of a video task that later should have been a gallery is out of scope; new enqueues after this change classify correctly. Users delete the old `title=download` rows.

## Tests

- Offline: Xiaohongshu URL helpers unchanged; new `kind: 'text'` parser fixture; `renderNoteMarkdown` omits empty author; `No video formats found` + description → text, not error.
- Offline: Remote enqueue path (handler/service test) builds gallery metadata for an `xhs_gallery` resolve result and does not default `title` to `download`.
- `npm test` includes the new script.
- Manual: `npx tsx scripts/test-xhs-url.ts --download 'https://xhslink.cn/o/7OA0OYWB0EB'` still gets six images; after this work the folder also contains `note.md`. Paste and `POST /v1/jobs` for the same URL both succeed as gallery.

## Docs

Update [REMOTE_JOB_API.md](../../REMOTE_JOB_API.md): jobs use the same resolver as paste; artifacts may be an image folder or a lone `.md`. One line in [MANUAL_TESTING.md](../../MANUAL_TESTING.md) under Xiaohongshu / Remote API.
