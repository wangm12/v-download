<p align="center">
  <a href="README.md">English</a> · <a href="README-CN.md">中文</a>
</p>

<p align="center">
  <img src="resources/icon.png" alt="V-Download" width="128" height="128" />
</p>

<h1 align="center">V-Download</h1>

<p align="center">
  在 Mac 上下载视频。粘贴链接，或从 Chrome 扩展发送。
</p>

<p align="center">
  <img src="https://img.shields.io/badge/平台-macOS-blue" alt="macOS" />
  <img src="https://img.shields.io/badge/许可证-MIT-green" alt="License" />
</p>

## 功能

- `Cmd+V` 粘贴链接，或用 [Chrome 扩展](extension/) 发送
- 下载队列：进度、暂停、重试、播放列表
- 只有你点同步时，才从 Chrome 取 Cookie
- 深色 / 浅色外观

## 安装

从 [Releases](https://github.com/wangm12/v-download/releases) 下载最新 `.dmg`，把 **V-Download** 拖进「应用程序」。

打包版自带 yt-dlp 和 ffmpeg。正式公证版本一般可以直接打开；ad-hoc 构建首次可能需要右键 → 打开。

从源码构建：

```bash
git clone https://github.com/wangm12/v-download.git
cd v-download
npm install
npm run build:mac
```

产物在 `dist/`。

## 使用

1. 复制视频链接，聚焦应用，按 `Cmd+V`。
2. 在 Chrome 里加载 `extension/`（`chrome://extensions` → 开发者模式 → 加载已解压的扩展程序），即可从网页把视频发给应用。
3. 若 Chrome 询问用哪个应用打开链接，选 **V-Download**，不要选 `node_modules` 里的 Electron。

`Cmd+,` 打开偏好设置。其它程序可以通过可选的 [Remote Job API](docs/REMOTE_JOB_API.md) 走同一条队列。

## 开发

```bash
npm install
npm run dev
npm test
```

扩展用未打包方式加载，改完后在 Chrome 里重载。改了 `packages/shared` 里的 Cookie 同步域名后，运行 `npm run sync:extension-constants`。

引擎、抖音排障、打包、隐私和产品待办见 [docs/README.md](docs/README.md)。

## 许可证

MIT
