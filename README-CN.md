<p align="center">
  <a href="README.md">English</a> | <a href="README-CN.md">中文</a>
</p>

<p align="center">
  <img src="resources/icon.png" alt="V-Download" width="128" height="128" />
</p>

<h1 align="center">V-Download</h1>

<p align="center">
  一款类似 Downie 的桌面应用 + Chrome 扩展，支持从 YouTube、X/Twitter、抖音及任意网站下载视频，基于 <code>yt-dlp</code> 驱动。
</p>

<p align="center">
  <img src="https://img.shields.io/badge/平台-macOS-blue" alt="macOS" />
  <img src="https://img.shields.io/badge/electron-33-blue" alt="Electron" />
  <img src="https://img.shields.io/badge/许可证-MIT-green" alt="License" />
</p>

---

## 功能特性

- **一键下载** — 使用 `Cmd+V` 粘贴任意 URL 或通过 Chrome 扩展一键发送
- **全站媒体检测** — 自动嗅探 HLS (m3u8)、MP4、WebM、FLV 媒体流
- **视频悬浮按钮** — 检测到的视频元素上会自动出现下载按钮（类似 AIX Downloader）
- **Chrome 扩展** — 在每个页面检测媒体流，发现多个时弹出选择器供用户挑选
- **YouTube 集成** — YouTube 页面一键下载，支持格式选择（4K 到 144p、MP3）
- **X/Twitter 集成** — 推文视频自动出现下载按钮（操作栏 + 视频叠加层），发送推文链接至 yt-dlp 获取最佳画质
- **抖音集成** — 专属下载面板，支持完整画质选项、封面图片、音乐提取（通过 React Fiber 提取元数据）
- **应用端嗅探** — 对于 yt-dlp 不支持的站点，应用会在隐藏浏览器中加载页面并自动检测媒体流
- **播放列表 & 频道支持** — 下载完整播放列表或频道，自动按子文件夹整理
- **并发下载** — 可配置的并行下载队列（1-10 个同时下载）
- **Dock 进度动画** — macOS Dock 图标从上到下填充动画，实时显示下载速度（如 `12 MB/s`）
- **实时进度** — 实时进度条、网速、剩余时间、下载阶段（视频/音频/合并）
- **下载管理** — 暂停、恢复、重试、取消、删除单个或全部任务
- **Cookie 同步** — 自动从 Chrome 同步 YouTube Cookie，用于需要登录的下载
- **崩溃恢复** — 检测到中断的下载，重启后可继续
- **暗色 UI** — 简洁的深色主题，黑白配色

## 截图

<p align="center">
  <em>主窗口：活跃下载、播放列表分组、实时进度</em>
</p>

## 前置依赖

使用前请先安装以下依赖：

```bash
# 通过 Homebrew 安装 yt-dlp 和 ffmpeg
brew install yt-dlp ffmpeg
```

| 依赖 | 用途 |
|------|------|
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | 视频下载引擎 |
| [ffmpeg](https://ffmpeg.org/) | 合并视频 + 音频流 |

## 安装

### 从 DMG 安装（推荐）

1. 从 [Releases](https://github.com/wangm12/v-download/releases) 下载最新的 `.dmg` 文件
2. 打开 DMG，将 **V-Download** 拖入「应用程序」文件夹
3. 首次启动：右键点击 → 打开（因为应用未签名）

### 从源码构建

```bash
git clone https://github.com/wangm12/v-download.git
cd v-download
npm install
npm run build:mac
```

构建产物在 `dist/mac-arm64/V-Download.app`，DMG 安装包在 `dist/` 目录下。

## 使用方法

### 粘贴 URL

1. 复制任意视频 URL（YouTube、直接媒体链接、或任何包含嵌入视频的网页）
2. 聚焦应用窗口，按 `Cmd+V`
3. YouTube 链接：在弹窗中选择格式/画质
4. 其他站点：应用先尝试 yt-dlp，失败后回退到内置媒体嗅探器 — 如果检测到多个流，会弹出选择器让你挑选
5. 下载自动开始

### Chrome 扩展

1. 在 Chrome 中加载 `extension/` 文件夹：`chrome://extensions` → 开发者模式 → 加载已解压的扩展程序
2. 扩展图标在每个页面都处于激活状态
3. **YouTube 页面** — 点击图标直接发送 URL 到应用
4. **X/Twitter 页面** — 含视频的推文自动出现下载按钮（操作栏和视频播放器上），点击即发送至 yt-dlp
5. **抖音页面** — 当前视频上方出现下载按钮，支持完整画质选择、封面图片、音乐下载
6. **其他页面** — 检测到的视频元素上会出现下载叠加按钮；点击扩展图标可打开弹窗查看所有检测到的媒体流（HLS、MP4、WebM、FLV）
7. Cookie 每 5 分钟自动同步一次，确保认证下载正常工作

### 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Cmd+V` | 粘贴 URL 并开始下载 |
| `Cmd+W` | 隐藏窗口（应用保留在 Dock） |
| `Cmd+Q` | 退出应用 |

## 设置

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| 下载位置 | `~/Downloads` | 文件保存路径 |
| 并发下载数 | 3 | 并行下载数量（1–10） |
| 显示格式选择框 | 开启 | 下载前弹出格式/画质选择 |
| 播放列表子文件夹 | 开启 | 播放列表下载按子文件夹整理 |
| 默认视频画质 | 1080p | 关闭格式选择框时使用 |
| 默认音频品质 | 320kbps | 关闭格式选择框时使用 |
| 下载间隔 | 3秒 | 队列中每个下载之间的等待时间（用于限速保护） |

## 架构

```
┌──────────────────────────────────────────────────────┐
│                    Electron 应用                      │
│                                                       │
│  ┌────────────────┐     IPC      ┌────────────────┐  │
│  │   主进程       │◄────────────►│    渲染进程     │  │
│  │                │              │    (React)      │  │
│  │ • yt-dlp       │              │ • UI 界面      │  │
│  │ • SQLite 数据库│              │ • Tailwind     │  │
│  │ • 设置管理     │              │ • Radix UI     │  │
│  │ • HTTP 服务器  │              │ • Three.js     │  │
│  │ • 媒体嗅探器   │              │ • 媒体选择器   │  │
│  │ • Dock 进度    │              │                 │  │
│  └───────┬────────┘              └─────────────────┘  │
│          │                                            │
└──────────┼────────────────────────────────────────────┘
           │ HTTP :18765
┌──────────▼──────────┐
│   Chrome 扩展       │
│ • 媒体嗅探          │
│ • 流选择器 UI       │
│ • Cookie 同步       │
│ • URL 分发          │
└─────────────────────┘
```

### 技术栈

| 层级 | 技术 |
|------|------|
| 运行时 | Electron 33 |
| 构建工具 | electron-vite, Vite |
| 前端 | React 19, TypeScript |
| 样式 | Tailwind CSS, Radix UI, Lucide React |
| 3D 图形 | Three.js, React Three Fiber |
| 数据库 | better-sqlite3 (SQLite) |
| 打包 | electron-builder |
| 下载引擎 | yt-dlp (外部依赖) |

### 项目结构

```
src/
├── main/                   # Electron 主进程
│   ├── index.ts            # 应用入口、窗口管理、IPC 处理
│   ├── downloadManager.ts  # 队列、并发、任务生命周期
│   ├── dockProgress.ts     # macOS Dock 图标动画 + 速度标记
│   ├── ytdlp.ts            # yt-dlp CLI 封装
│   ├── mediaSniffer.ts     # 隐藏浏览器媒体流检测
│   ├── database.ts         # SQLite 持久化
│   ├── settings.ts         # JSON 设置存储
│   └── localServer.ts      # Chrome 扩展通信 HTTP 服务器
├── preload/                # 上下文桥接（IPC 暴露）
│   ├── index.ts
│   └── index.d.ts
└── renderer/               # React 前端
    └── src/
        ├── App.tsx         # 主应用逻辑
        ├── components/     # UI 组件
        │   ├── DownloadItem.tsx
        │   ├── PlaylistGroup.tsx
        │   ├── FormatDialog.tsx
        │   ├── MediaPickerDialog.tsx
        │   ├── Settings.tsx
        │   ├── BottomBar.tsx
        │   ├── TitleBar.tsx
        │   ├── ClearDialog.tsx
        │   └── CoinLoader.tsx
        └── hooks/
            ├── useDownloads.ts
            └── useUrlHandler.ts

extension/                      # Chrome 扩展 (Manifest V3)
├── manifest.json
├── background.js               # 媒体嗅探、URL 分发、Cookie 同步
├── popup.html/js/css           # 媒体流选择器弹窗
├── content.js/css              # YouTube 下载按钮注入
├── content-video-overlay.js/css # 通用视频悬浮下载按钮
├── content-x.js/css            # X/Twitter 下载按钮
├── content-douyin.js/css       # 抖音专用下载面板
└── content-douyin-bridge.js    # 抖音主世界脚本（React Fiber 提取）
```

## 开发

```bash
# 安装依赖
npm install

# 开发模式启动（热重载）
npm run dev

# 生产构建
npm run build

# 打包 macOS 应用
npm run build:mac
```

## Chrome 扩展开发

1. 打开 `chrome://extensions`
2. 启用**开发者模式**
3. 点击**加载已解压的扩展程序**，选择 `extension/` 文件夹
4. 文件修改后扩展会自动重载

## 许可证

MIT
