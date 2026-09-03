# Debugging V-Download

## `make dev` — detailed terminal + file log

From the repo root:

```bash
make dev
```

This runs `electron-vite dev` with:

- **`V_DOWNLOAD_VERBOSE=1`** — reserved for future optional verbosity in the main process (worklog lines always print in dev).
- **`ELECTRON_ENABLE_LOGGING=1`** — extra Chromium / Electron logging to stderr.
- **`tee logs/dev-latest.log`** — everything printed in the terminal is also appended to **`logs/dev-latest.log`** (overwrite each session).

The main process emits structured **`[worklog] {…}`** lines (JSON) for lifecycle events such as `app_ready` and `task_enqueued`.

## Release build — `worklog.txt`

In **packaged** apps (`app.isPackaged === true`), structured JSON lines are appended to:

| OS | Path |
|----|------|
| macOS | `~/Library/Application Support/V-Download/logs/worklog.txt` |
| Windows | `%APPDATA%\V-Download\logs\worklog.txt` (typical) |
| Linux | `~/.config/V-Download/logs/worklog.txt` (typical) |

Also written on rotation when the file exceeds ~4 MiB:

- `worklog-prev.txt` — previous chunk

### What is logged

- `session_start` — app version, platform, executable path  
- `app_ready` — after startup hooks begin  
- `task_enqueued` — new download task (id, host, `mediaType`, etc.)  
- `uncaughtException` / `unhandledRejection` — fatal async errors with stack traces  

Add more `worklog()` calls in `src/main/` where needed for field issues.

## Douyin profile / Chromium — `rmc-captcha` lines in the terminal

When the app uses a hidden **Electron** window to hydrate a Douyin page, the site may load ByteDance verify scripts (`*.yhgfb-cn-static.com/.../rc-verifycenter/.../rmc-captcha.js`). With **`ELECTRON_ENABLE_LOGGING=1`** (used by `make dev`), every `console.log` from that page can appear as **`[INFO:CONSOLE]`** spam.

The main process registers a **one-time `webRequest` listener** on the dedicated **hydrate** partition (`persist:v-download-douyin-hydrate`): it cancels **`script`** requests whose URL matches ByteDance verify/captcha paths — including **`*.yhgfb-cn-static.com`** and **`*.bytescm.com/.../rc-verifycenter/.../captcha.js`** (and similar) — so those scripts are not executed and **`[INFO:CONSOLE]`** spam from `rmc-captcha` stops in typical cases.

**Browser recovery** (profile **Load more** when API pagination is restricted) uses a **separate partition** (`persist:v-download-douyin-recovery`) with a **visible** window. Captcha scripts are **not** blocked there so you can complete verification manually. Disable recovery with **`V_DOWNLOAD_DOUYIN_PROFILE_RECOVERY=0`**.

## Related docs

- [MANUAL_TESTING.md](./MANUAL_TESTING.md) — regression checklist
- [download-engines.md](./download-engines.md) — download routing
- [download-reliability.md](./download-reliability.md) — runbook and Douyin fallback
