# macOS release checklist

Releases are macOS-first and are built separately for `arm64` and `x64`. A host architecture is never selected implicitly: use `RELEASE_ARCH=arm64`, `RELEASE_ARCH=x64`, or `RELEASE_ARCH=both`.

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

Before packaging, create the ignored release configuration and fill in the real Chrome Web Store ID; do not use a placeholder ID:

```sh
cp release-config.example.json release-config.json
# edit release-config.json: chrome.extensionId, updater.provider, updater.metadata
```

`build:mac:*` stages this ID into the packaged app. A packaged app without a matching ID rejects all browser-extension origins at the local server boundary.

`prepare:release` and `verify:release` invoke the existing engine verifier for every requested architecture and independently enforce yt-dlp, its `_internal/Python` sidecar, ffmpeg, ffprobe, the provider binary, provider plugin, metadata, and tree/file checksums. The artifact must also contain the requested architecture; `.app`, `.dmg`, and `.zip` are the only supported artifact types.

`build:mac:arm64` and `build:mac:x64` are isolated packaging commands. Each invokes preparation with its explicit architecture, stages only that architecture's engine/provider trees, excludes source engine binaries from the generic Electron file set, and removes its marker-owned staging directory after packaging. Use separate commands for separate releases; the builder refuses to reuse unmarked staging or mix architectures.

After every Electron native rebuild/packaging run—including arm64 packaging on an arm64 host—the wrapper restores the host Node-native `better-sqlite3` installation in its `finally` path using the host platform/architecture. A packaging failure remains a failure, and a restoration failure also fails the command; this prevents either cross-arch or same-arch Electron ABI modules from poisoning subsequent local tests or development.

The wrapper disables electron-builder's implicit native rebuild, explicitly runs `electron-rebuild` for the requested Electron version/architecture, and checks the packaged `app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node` with `file` before reporting success. `verify:release` repeats that native-module architecture check for direct apps and extracted apps from `.zip`/`.dmg` artifacts.

The packaged app has an optional updater backed by `electron-updater`. It is disabled unless CI/runtime configuration supplies `VDOWNLOAD_UPDATE_PROVIDER_URL` (or `VDOWNLOAD_UPDATE_URL`) as an HTTPS generic-provider base URL with no query, fragment, username, or password. The updater is lazy-loaded after `app ready`, performs no request without that setting, and reports failures without logging provider URLs or credentials. Publish signed artifacts plus the provider metadata expected by `electron-updater` at that base URL; do not put credentials, tokens, fake IDs, or provider values in source. CI should inject the URL at runtime/build configuration time and keep signing credentials in the existing secret store.

For a real artifact, configure Developer ID signing through electron-builder (`CSC_NAME` or `CSC_LINK`), and notarization through CI variables (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`) or an existing macOS keychain profile (`APPLE_KEYCHAIN_PROFILE`). Supply `RELEASE_NOTARY_SUBMISSION_ID`. The gate runs `codesign --verify --deep --strict`, `spctl`, `xcrun notarytool info`, and `xcrun stapler validate`. Secret values are never printed.

Use `RELEASE_DRY_RUN=1 npm run verify:release` only for local fixture validation. Dry-run output explicitly says it is not a release claim and never substitutes for Apple or Chrome publication.
