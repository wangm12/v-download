# Shared resolve + note.md Implementation Plan

> Archived. Living docs: [REMOTE_JOB_API.md](../../REMOTE_JOB_API.md), [MANUAL_TESTING.md](../../MANUAL_TESTING.md). Spec: [2026-09-01-resolve-and-note-md-design.md](./2026-09-01-resolve-and-note-md-design.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or implement task-by-task with TDD. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** UI paste and Remote Job API share `resolveVideoInfo`; save parsed title/description as markdown.

**Architecture:** Pure helpers (`noteMarkdown.ts`, `parseXiaohongshuNote`, `taskOptionsFromResolveData`, yt-dlp dump parsers) drive classification. `enqueueJob` and `runTask` consume those results. No new HTTP fields.

**Tech Stack:** Existing Electron main TypeScript, `tsx` assert scripts, yt-dlp `--dump-json`.

## Global Constraints

- Create-job body stays `{ "url" }` only.
- No Readability / full-page archive, no `rednote.com`, no Twitter crawler.
- Video files stay as they are; galleries keep a folder + `note.md`; videos get a sidecar `.md`; text-only is a lone `.md`.
- Empty title heading is `Untitled`; empty-title basename is `untitled`.

---

## Files

- `src/main/noteMarkdown.ts` — render + path + write helpers
- `src/main/remoteResolveTask.ts` — map resolve JSON → addTask fields
- `src/main/xiaohongshu.ts` — `kind: 'text'`, `description` on gallery
- `src/main/ytdlp.ts` — `description` on VideoInfo; no-formats dump → text
- `src/main/videoInfoResolver.ts` — return text / gallery with description
- `src/main/remoteJobService.ts` — resolve before single-URL enqueue
- `src/main/downloadManager.ts` — persist note metadata; write md
- `src/renderer` — pass note metadata; text dialog
- `scripts/test-note-resolve.ts` + `package.json`
- Docs: `REMOTE_JOB_API.md`, `MANUAL_TESTING.md`

## Tasks

- [x] Failing offline tests for markdown, XHS text parse, resolve→task map, yt-dlp no-formats text
- [x] Implement helpers and wire resolver / enqueue / runTask / UI
- [x] Docs + `npm test`
