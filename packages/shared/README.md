# @v-download/shared

Shared layer between the **Electron app** (`src/main`, preload, renderer) and the **Chrome extension** (via generated `extension/cookie-sync-domains.js`).

## Exports

| Export | Consumers | Purpose |
|--------|-----------|---------|
| `buildNetscapeCookieFile`, `toNetscapeLine`, `ChromeSyncedCookie` | `localServer`, `nativeAuth` | Netscape cookie file from extension / login JSON |
| `COOKIE_SYNC_DOMAINS` | Generated extension script, `securityValidation` | One list of synced cookie domains |
| `DownloadErrorCode`, `DownloadRecoveryAction`, `DOWNLOAD_ERROR_ACTIONS` | Renderer inspector, shared type contracts | Recovery mapping for failed downloads |
| `getQueueConcurrencyPolicy`, `QueueSpeedMode` | Settings, grouped queue, Preferences | Balanced / Turbo / Gentle task caps |
| `MediaCandidate`, `StartDownloadOptions`, `AppResult` | Preload + media resolver | Download start / resolve IPC shapes |

## After changing domains

From repo root:

```bash
npm run sync:extension-constants
```

Reload the unpacked extension in Chrome.

## Not included

yt-dlp orchestration, Douyin parsers, and extension media scripts stay in their respective packages. Queue row types live in the Electron app (`src/main/downloadManager.ts`, `src/renderer/src/types`), not here.
