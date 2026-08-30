# @v-download/shared

Shared layer between the **Electron app** (`src/main`) and the **Chrome extension** (via generated `extension/cookie-sync-domains.js`).

## Exports

| Export | Consumers | Purpose |
|--------|-----------|---------|
| `buildNetscapeCookieFile`, `toNetscapeLine`, `ChromeSyncedCookie` | `localServer` | Netscape cookie file from extension JSON |
| `COOKIE_SYNC_DOMAINS` | Generated extension script | One list of synced cookie domains |

## After changing domains

From repo root:

```bash
npm run build --workspace=@v-download/shared
npm run sync:extension-constants
```

Reload the unpacked extension in Chrome.

## Not included

yt-dlp orchestration and extension media scripts stay in their respective packages.
