<p align="center">
  <a href="README.md">English</a> · <a href="README-CN.md">中文</a>
</p>

<p align="center">
  <img src="resources/icon.png" alt="V-Download" width="128" height="128" />
</p>

<h1 align="center">V-Download</h1>

<p align="center">
  A macOS app that downloads videos. Paste a URL, or send one from Chrome.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-macOS-blue" alt="macOS" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
</p>

## Features

- Paste a link with `Cmd+V`, or click the [Chrome extension](extension/)
- Queue with live progress, pause, retry, and playlists
- Sync cookies from Chrome only when you ask
- Dark / Light appearance

## Install

Download the latest `.dmg` from [Releases](https://github.com/wangm12/v-download/releases) and drag **V-Download** into Applications.

Packaged builds include yt-dlp and ffmpeg. Official notarized builds open normally; ad-hoc builds may need right-click → Open the first time.

From source:

```bash
git clone https://github.com/wangm12/v-download.git
cd v-download
npm install
npm run build:mac
```

The app lands in `dist/`.

## Use

1. Copy a video URL, focus the app, press `Cmd+V`.
2. Load the `extension/` folder in Chrome (`chrome://extensions` → Developer mode → Load unpacked) to send pages and videos to the app.
3. If Chrome asks which app should open the link, choose **V-Download** — not `Electron` from `node_modules`.

`Cmd+,` opens Preferences. Other apps can enqueue the same queue via the optional [Remote Job API](docs/REMOTE_JOB_API.md).

## Develop

```bash
npm install
npm run dev
npm test
```

Load `extension/` unpacked and reload it after changes. After editing cookie-sync domains in `packages/shared`, run `npm run sync:extension-constants`.

See [docs/README.md](docs/README.md) for engines, Douyin recovery, packaging, privacy, and the product backlog.

## License

MIT
