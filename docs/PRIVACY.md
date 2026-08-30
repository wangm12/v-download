# V-Download privacy notes

V-Download is designed as a local macOS download utility. The desktop app does not require a V-Download account and does not use a hosted analytics service.

## Chrome extension data

The extension can inspect media requests and page video elements so it can show download controls. It uses the `cookies` permission only when the user explicitly starts **Sync cookies** from the desktop app. That action reads cookies from the supported site list, sends them to the V-Download desktop app over loopback, and stores them as a local cookie file in the app's private user-data directory for authenticated downloads. Do not start sync unless you consent to sharing those browser authentication cookies with the local app.

Cookie synchronization is not a background upload. The extension sends cookies only to the local desktop app on loopback (`127.0.0.1:18765`) after the user starts **Sync cookies**.

## Download requests

When the user starts a download, the selected URL is sent to the local desktop app and then to the configured download engine or the originating site as required to resolve the media. The app may store download metadata, thumbnails, progress, and error information locally so the queue can recover after a restart.

## Diagnostics and support

Diagnostic logs should not contain cookie values or authentication tokens. If you report an issue, review and redact local URLs or file paths before attaching logs. Support and source code are available through the [project repository](https://github.com/wangm12/v-download).

This document describes the current product behavior. Review it before each Chrome Web Store submission if permissions or data flows change.
