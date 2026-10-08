# macOS release checklist

Releases are macOS-first and are built separately for `arm64` and `x64`. A host architecture is never selected implicitly: use `RELEASE_ARCH=arm64`, `RELEASE_ARCH=x64`, or `RELEASE_ARCH=both`.

Use Node.js 22.14 or newer in the 22.x line, or 23.6 or newer (including later major versions). Electron 43.7.5 and better-sqlite3 13.0.3 use N-API prebuilds; macOS 12 is the minimum supported macOS version.

On a clean macOS machine:

```sh
npm ci
RELEASE_ARCH=arm64 npm run fetch:engines
RELEASE_ARCH=x64 npm run fetch:engines
RELEASE_ARCH=both npm run prepare:release
npm run build:mac:arm64
RELEASE_ARCH=arm64 RELEASE_ARTIFACT=/absolute/path/V-Download.app npm run verify:release
npm run build:mac:x64
RELEASE_ARCH=x64 RELEASE_ARTIFACT=/absolute/path/V-Download.app npm run verify:release
```

Before packaging, create the ignored release configuration and set a valid 32-character Chrome extension ID containing only `a` through `p`. The ID may be unpublished, but it must be the intended ID used by the packaged extension; do not use a placeholder:

```sh
cp release-config.example.json release-config.json
# edit release-config.json: chrome.extensionId, updater.provider, updater.metadata
```

`build:mac:*` stages this ID into the packaged app. A packaged app without a matching ID rejects all browser-extension origins at the local server boundary.

`prepare:release` and `verify:release` invoke the engine verifier for every requested architecture and enforce yt-dlp, its `_internal/Python` sidecar, ffmpeg, ffprobe, the provider binary, provider plugin, metadata, and tree/file checksums. FFmpeg and ffprobe version banners are checked for both pinned version and executable identity. The artifact must also contain the requested architecture; `.app`, `.dmg`, and `.zip` are the only supported artifact types.

`build:mac:arm64` and `build:mac:x64` are isolated packaging commands. Each invokes preparation with its explicit architecture, stages only that architecture's engine/provider trees, excludes source engine binaries from the generic Electron file set, and removes its marker-owned staging directory after packaging. Use separate commands for separate releases; the builder refuses to reuse unmarked staging or mix architectures.

The root `postinstall` explicitly installs the pinned Electron binary with `node node_modules/electron/install.js`; Electron 43 no longer downloads its runtime through the older implicit postinstall path. For a cross-architecture package, the build wrapper verifies the requested Electron and SQLite target. `better-sqlite3` 13 loads `prebuilds/<platform>-<arch>.node` through its N-API loader; the prebuild is unpacked from the app archive, and packaging verification checks that exact target binary and its architecture.

`npm run dev:preflight` installs/verifies the host Electron binary and exercises the host Node SQLite binding. `npm test` restores by checking those same host bindings without an ABI rebuild. On macOS, when selecting an x64 Electron target under Rosetta, set `npm_config_arch=x64` so the Electron installer does not select arm64.

The packaged app has an optional updater backed by `electron-updater`. It is disabled unless CI/runtime configuration supplies `VDOWNLOAD_UPDATE_PROVIDER_URL` (or `VDOWNLOAD_UPDATE_URL`) as an HTTPS generic-provider base URL with no query, fragment, username, or password. The updater is lazy-loaded after `app ready`, performs no request without that setting, and reports failures without logging provider URLs or credentials. Publish signed artifacts plus the provider metadata expected by `electron-updater` at that base URL; do not put credentials, tokens, fake IDs, or provider values in source. CI should inject the URL at runtime/build configuration time and keep signing credentials in the existing secret store.

For a real artifact, configure Developer ID signing through electron-builder (`CSC_NAME` or `CSC_LINK`), and notarization through CI variables (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`) or an existing macOS keychain profile (`APPLE_KEYCHAIN_PROFILE`). Supply `RELEASE_NOTARY_SUBMISSION_ID`. The gate runs `codesign --verify --deep --strict`, `spctl`, `xcrun notarytool info`, and `xcrun stapler validate`. Secret values are never printed.

Use `RELEASE_DRY_RUN=1 npm run verify:release` only for local fixture validation. Dry-run output explicitly says it is not a release claim and never substitutes for Apple or Chrome publication.

## GitHub Actions

`.github/workflows/release.yml` builds `arm64` and `x64` separately through `npm run build:mac:*`, then attaches the `.dmg`, `.zip`, `.blockmap`, and a merged `latest-mac.yml` to a GitHub Release. GitHub adds Source code zip/tar.gz on its own. A successful GitHub publication does not by itself prove that an artifact is signed, notarized, or accepted by Gatekeeper; those checks require the corresponding Apple credentials and validation.

Trigger either way:

1. **Actions → Release → Run workflow** — builds the selected branch and creates or updates the rolling `nightly` prerelease.
2. **Push a version tag** matching `package.json` (`git tag v1.1.7 && git push origin v1.1.7`) — creates or updates the stable version release.

Set repository secret `CHROME_EXTENSION_ID` to the intended 32-character extension ID using only `a`–`p`. It may be an unpublished ID. The workflow rejects missing or malformed values, and the ID is never committed to source.

### Secrets

| Secret | Required | Purpose |
| --- | --- | --- |
| `CHROME_EXTENSION_ID` | Yes | 32-character Chrome extension id written into `release-config.json` for packaging |
| `CSC_LINK` | For a Gatekeeper-safe build | Base64-encoded Developer ID `.p12` |
| `CSC_KEY_PASSWORD` | With `CSC_LINK` | Password for that `.p12` |
| `APPLE_ID` | For notarization | Apple ID used by electron-builder / notarytool |
| `APPLE_APP_SPECIFIC_PASSWORD` | For notarization | App-specific password for that Apple ID |
| `APPLE_TEAM_ID` | For notarization | Developer Team ID |

The workflow can publish artifacts without signing credentials. GitHub publication success does not imply signing, notarization, or Gatekeeper acceptance; users may see macOS security warnings for unsigned or unnotarized builds.

The workflow publishes the Release when the build succeeds. In-app updates still need `latest-mac.yml` plus the zips at an HTTPS generic-provider URL such as `https://github.com/wangm12/v-download/releases/latest/download`; that URL is injected at runtime via `VDOWNLOAD_UPDATE_PROVIDER_URL` and is not stored in source.
