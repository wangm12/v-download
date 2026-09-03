# Library Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a completed-download Library (file view + work view) on top of existing SQLite rows and `downloadDir`, without a second database or in-app player.

**Architecture:** Main process scans `downloadDir` (excluding `remote-jobs/`), merges with `downloads` rows, and groups works by aweme/playlist/url/title. Renderer is a new main view that only calls a small preload contract. Deletes and reveals stay inside `downloadDir`.

**Tech Stack:** Electron main, better-sqlite3, existing `openFile` / `openFileLocation`, React queue chrome, `tsx` scripts for unit tests.

## Global Constraints

- Reuse `downloads` / `playlists`; no new media index table in Phase A.
- Never index or delete outside `settings.downloadDir`.
- Exclude `{downloadDir}/remote-jobs/` from default lists.
- No in-app player; OS Open / Reveal only.
- Do not copy better-douyin source.

---

## File map

- Create `src/main/libraryModel.ts` — work keys, title normalize, path guards, merge.
- Create `src/main/libraryScan.ts` — directory listing + ignore rules.
- Create `src/main/ipc/library.ts` — `library-list-files`, `library-list-works`, `library-delete-paths`.
- Create `src/renderer/src/components/LibraryView.tsx` (+ small helpers).
- Wire `App.tsx` main view `library`.
- Tests: `scripts/test-library-model.ts`.

## Task 1: Work-key and path-guard unit tests

- [ ] Write `scripts/test-library-model.ts` covering aweme extras vs title fallback, `_cover` peel, `remote-jobs` exclusion, delete path reject.
- [ ] Run `npx tsx scripts/test-library-model.ts` and confirm it fails (module missing).
- [ ] Implement `libraryModel.ts` until the script passes.
- [ ] Add `test:library` to `package.json` `test` script.

## Task 2: Scan + IPC

- [ ] Implement scan with ignore list matching `isIgnoredArtifactName`.
- [ ] IPC returns paginated `{ items, total }`.
- [ ] Renderer-less test: temp dir with a gallery + a `remote-jobs` file; only gallery appears.

## Task 3: Library UI

- [ ] File / work toggle, search, type filter, sort, pager 12/24/48/96.
- [ ] Reveal, Open, delete-with-confirm.
- [ ] Manual: complete a Douyin gallery, see one work and N files.

## Task 4: Docs

- [ ] Link from README “Read next” if the view is user-visible.
- [ ] Add a MANUAL_TESTING row for Library.
