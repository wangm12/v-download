# Output Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users set filename and optional author-folder templates that both yt-dlp and custom Douyin/XHS/ffmpeg writers honor.

**Architecture:** A pure `outputTemplateModel.ts` renders user tokens to either a yt-dlp `-o` string or a sanitized concrete basename. `downloadManager` / `ytdlp.ts` consume that. Remote jobs keep `{downloadDir}/remote-jobs/{id}`.

**Tech Stack:** Existing settings JSON, yt-dlp `-o`, `sanitizeDownloadBasename`, Preferences Downloads card, `tsx` tests.

## Global Constraints

- Users cannot type raw `%(…)` or `..` path segments.
- Default filename stays collision-safe: `{title} [{id}]`.
- `playlistSubfolder` remains.
- Remote Job API output dir is unchanged.
- Do not invent a second path DSL besides the chip tokens.

---

## File map

- Create `src/main/outputTemplateModel.ts` — parse, validate, render yt-dlp vs concrete.
- Extend `src/main/settings.ts` + renderer `SettingsData`.
- Change `src/main/ytdlp.ts` to use rendered `-o`.
- Change Douyin/XHS/ffmpeg basename + folder joins.
- Profile picker: when `archiveByAuthor`, do not double-nest author.
- Preferences: template fields + chips + preview.
- Tests: `scripts/test-output-template.ts`.

## Task 1: Template model (TDD)

- [ ] Write failing tests: unknown token rejected; empty `{author}` omits folder; `..` rejected; yt-dlp render for `{title} [{id}]`.
- [ ] Implement `outputTemplateModel.ts` until tests pass.
- [ ] Add `test:output-template` to `package.json`.

## Task 2: Settings + yt-dlp

- [ ] Add `filenameTemplate`, `folderNameTemplate`, `archiveByAuthor` with validate + normalize.
- [ ] `ytdlp.ts` uses model output for `-o` (still relative, still `--paths`).
- [ ] Extend `scripts/test-ytdlp-provider-argv.ts` (or equivalent) to assert `-o`.

## Task 3: Custom writers + profile batch

- [ ] Douyin/XHS/ffmpeg join `downloadDir` / author folder / basename via the same model.
- [ ] Profile pick: `archiveByAuthor` true → folder template only (no `Author/Author`).
- [ ] Remote job tests still pass (`test:remote-job`).

## Task 4: Preferences UI

- [ ] Token chips, preview path, inline validation.
- [ ] MANUAL_TESTING: YouTube + Douyin one-off + profile batch.
