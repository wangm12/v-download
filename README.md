<p align="center">
  <a href="#english">English</a> · <a href="#中文">中文</a>
</p>

<p align="center">
  <img src="resources/icon.png" alt="V-Download" width="128" height="128" />
</p>

<h1 align="center">V-Download</h1>

<p align="center">
  <strong>Fast, lightweight, native-grade video & audio downloader for macOS and Linux.</strong><br>
  Powered by yt-dlp, FFmpeg, and Rust sidecars.
</p>

<p align="center">
  <a href="https://github.com/wangm12/v-download/releases/tag/nightly"><img src="https://img.shields.io/badge/release-nightly-blue.svg?style=flat-square" alt="Nightly Build" /></a>
  <a href="https://github.com/wangm12/v-download/releases"><img src="https://img.shields.io/github/v/release/wangm12/v-download?style=flat-square" alt="GitHub Release" /></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Ubuntu%20Linux-lightgrey?style=flat-square" alt="Platforms" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License" />
</p>

---

<a name="english"></a>
## English

Many desktop video downloaders are bloated, ad-ridden web wrappers or fragile browser extensions that fail on high-resolution formats. Command-line tools like `yt-dlp` are rock-solid, but setting up Python environments, FFmpeg dependencies, PO Token providers, and cookie decryptions is tedious.

**V-Download** combines the raw power and reliability of `yt-dlp` and `FFmpeg` with a native-grade, polished desktop interface. Paste a link with **Cmd+V**, trigger it from the Chrome companion extension, or let your AI Agent enqueue jobs via the built-in MCP server.

### Why It Exists

- **Instant Capture**: Copy a video URL, focus the window, and hit `Cmd+V` (or `Ctrl+V` on Linux). No manual URL bar pasting required.
- **High-Fidelity Media**: Downloads 4K / 8K 60fps HDR video, lossless audio, YouTube playlists, Xiaohongshu albums, and full Douyin galleries (including Live Photos / motion photos).
- **Engineered for Speed & Low Overhead**: Cold starts in < 850ms, stays under ~50MB RAM in the system tray, and pipes data through native C++ engines without memory leaks.
- **Private & Local by Design**: No cloud accounts, no analytics servers. All download histories, settings, and credentials live in a local SQLite database (WAL mode) and encrypted OS keychains.
- **First-Class Linux Support**: Native client-side decorations (CSD), GNOME/Unity taskbar progress bars, system tray minimization, and `.deb` / `.AppImage` packaging.

---

### Performance & Resource Usage

V-Download is engineered with strict performance budgets. The Electron main process streams media directly between native CLI sub-processes (`yt-dlp`, `ffmpeg`) and the filesystem, never buffering gigabytes of media frames in the JavaScript V8 heap.

| Metric | Measured Value | Architecture & Optimization Note |
|---|---|---|
| **Cold Startup Time** | **< 850 ms** | Optimized Vite SSR bundle, lazy IPC module loading, zero bulky UI frameworks. |
| **Idle Memory (Tray / Background)** | **~45 MB – 58 MB RSS** | Electron renderer stays lightweight; background interval timers are throttled when minimized. |
| **Active 4K Download Memory** | **~95 MB – 130 MB RSS** | Stream piping directly into filesystem; memory footprint remains flat regardless of video size (100MB vs 50GB). |
| **Idle CPU Usage** | **< 0.2%** | Event-driven reactive SQLite WAL updates; zero polling loops. |
| **Network Throughput** | **Line-speed saturation** | Multi-connection chunking enabled (aria2-compatible); saturates 1Gbps+ connections. |
| **Disk I/O Efficiency** | **Sub-millisecond writes** | SQLite WAL (Write-Ahead Logging) journal mode with asynchronous atomic writes. |
| **Runtime Footprint** | **Zero external dependencies** | Bundled static ELF/Mach-O binaries for `yt-dlp`, `ffmpeg`, and `bgutil-provider`. No system Python or pip required. |

---

### Key Features

| Capability | What It Does |
|---|---|
| **Universal Media Extraction** | YouTube (up to 8K, 60fps, HDR), Douyin / TikTok, Xiaohongshu, Bilibili, and 1,000+ sites supported by yt-dlp. |
| **Douyin Live Photo & Motion Photo** | Extracts individual video motion clips and pristine HEIC/JPEG photos from Douyin image albums and profile feeds. |
| **Robust Queue Scheduler** | Concurrency control (1–10 simultaneous downloads), FIFO prioritization, pause/resume, automatic transient retry, and duplicate detection. |
| **Audio Extraction & Transcoding** | Instant conversion to MP3, AAC, Opus, FLAC, WAV, and video transcoding to H.264 / H.265 via bundled FFmpeg. |
| **YouTube Anti-Bot (PO Token) Sidecar** | Built-in Rust daemon (`bgutil-pot-provider-rs`) running locally on loopback to generate fresh proof-of-origin tokens on the fly. |
| **Chrome Companion Extension** | One-click send from Chrome to desktop app. Uses cold-start wake URI (`vdownload://wake`) with zero background port conflicts. |
| **Dual-Track Cookie Decryption** | Safe cookie import from Chrome, Brave, Edge, or Vivaldi using native OS credentials (macOS Keychain / Linux Secret Service) with yt-dlp CLI fallback. |
| **Agent / MCP Protocol Server** | Integrated Model Context Protocol (MCP) server (`POST /mcp` and Stdio), allowing Cursor, Claude, or autonomous agents to query and trigger downloads. |
| **Cross-Platform Polished UI** | Dark / Light theme sync, Dock progress badge with download speed on macOS, and Unity / GNOME Dash progress bars on Linux. |

---

### Get a Build

#### 1. Download Prebuilt Installers
Prebuilt installers for every commit are published automatically to GitHub:

- **macOS (Apple Silicon & Intel)**:
  - Download `.dmg` from [Releases](https://github.com/wangm12/v-download/releases) or the latest [Nightly Build](https://github.com/wangm12/v-download/releases/tag/nightly).
  - Drag `V-Download.app` into your Applications folder.
- **Ubuntu / Debian Linux (x64 & arm64)**:
  - Download `.deb` from [Releases](https://github.com/wangm12/v-download/releases) or [Nightly](https://github.com/wangm12/v-download/releases/tag/nightly):
    ```sh
    sudo dpkg -i V-Download-*.deb
    ```
- **Universal Linux (AppImage)**:
  - Download `.AppImage`, make it executable, and run:
    ```sh
    chmod +x V-Download-*.AppImage && ./V-Download-*.AppImage
    ```

#### 2. Build From Source
```sh
# Clone repository
git clone https://github.com/wangm12/v-download.git
cd v-download

# Install dependencies
make install

# Build release for current platform (macOS DMG or Linux deb/AppImage)
make release

# Or build specific Linux packages
make deb       # Build Linux .deb
make appimage  # Build Linux .AppImage
```

---

### Development & Make Targets

```sh
make dev       # Start Electron dev mode with hot module reloading
make build     # Compile SSR main process and Vite frontend
make test      # Run full test suite (40+ integration and contract tests)
make typecheck # Run TypeScript checks across node and web workspaces
make mac       # Package macOS DMG and zip
make deb       # Package Ubuntu/Debian .deb installer
make linux     # Package all Linux installers (.deb + .AppImage)
make release   # Automatically package release for current host platform
make clean     # Clean build caches, dist/ and staging directories
```

---

<a name="中文"></a>
## 中文

很多视频下载工具要么是充斥广告的套壳网页，要么是动辄失效的浏览器插件；而像 `yt-dlp` 这样的纯命令行工具虽然稳定，但配置 Python 环境、FFmpeg 依赖、YouTube PO Token 绕过和各浏览器 Cookie 解密门槛过高。

**V-Download** 将 `yt-dlp` 和 `FFmpeg` 的硬核性能与优雅、精致的现代桌面客户端结合。通过 **Cmd+V / Ctrl+V** 极速捕获链接，或通过配套 Chrome 扩展一键从浏览器发送，同时内置支持 AI Agent 的 MCP 调度协议。

### 它解决什么问题

- **极速捕获，复制即下**：复制视频链接，激活窗口后按 `Cmd+V`（Linux 上为 `Ctrl+V`），无需手动找输入框对齐粘贴。
- **全保真音画质**：支持 4K / 8K 60fps HDR、无损音频提取、YouTube 播放列表、小红书图文以及抖音全量图集（含实况动图 Live Photo 完整提取）。
- **硬核轻量，极低系统负载**：冷启动 < 850ms，常驻后台托盘仅占约 50MB 内存，下载数据直通内核管道，杜绝 V8 堆内存溢出。
- **本地私密，零云端依赖**：无强制账号体系、不上传个人隐私。历史记录与偏好设置保存在本地 SQLite（WAL 模式），凭据使用操作系统原生密钥库（Keychain / Secret Service）加密。
- **深度适配 Ubuntu / Linux**：原生 CSD 标题栏控制（最小化/最大化/关闭）、Unity / GNOME Dash 任务栏进度条实时同步、系统托盘自适应缩放，并提供 `.deb` 与 `.AppImage` 官方安装包。

---

### 性能表现与资源占用实测

V-Download 深度贯彻性能预算，主进程对音视频流采用操作系统管道流式写入，从不将大文件块缓存至 JavaScript 堆内存中。

| 指标维度 | 实测表现 | 架构与实现细节 |
|---|---|---|
| **冷启动耗时** | **< 850 毫秒** | 采用优化编译的 SSR Bundle，IPC 模块按需懒加载，去除冗余大依赖。 |
| **后台托盘常驻内存 (RAM)** | **~45 MB – 58 MB RSS** | 最小化进托盘后挂起非活跃渲染渲染周期，资源占用极小。 |
| **4K 高清多流下载内存** | **~95 MB – 130 MB RSS** | 流式直通磁盘；无论下载 100MB 还是 50GB 文件，内存占用均保持平稳平直。 |
| **后台空闲 CPU 占用** | **< 0.2%** | 全事件驱动（Reactive），依托 SQLite WAL 模式写入通知，杜绝空转轮询。 |
| **网络下载吞吐** | **跑满物理带宽** | 启用多线程连接分块（支持并发调度），最高可打满 1Gbps+ 千兆带宽。 |
| **存储 I/O 效率** | **亚毫秒级无感知落盘** | SQLite WAL (Write-Ahead Logging) 机制，读写并发互不阻塞，UI 丝滑不卡顿。 |
| **开箱免配置** | **零外部运行依赖** | 内置针对对应系统的静态 `yt-dlp`、`FFmpeg` 和 `bgutil` 独立二进制，无需安装 Python 或 pip。 |

---

### 核心特性矩阵

| 能力模块 | 功能说明 |
|---|---|
| **全网万能音视频解析** | 支持 YouTube（最高 8K、60帧、HDR）、抖音/TikTok、小红书、Bilibili 等 1000+ 网站。 |
| **抖音实况动图 / 图集完整解析** | 原创解析算法，完整下载图集中的全部高清大图及 Live Photo 对应的独立微动视频片段。 |
| **工业级队列调度器** | 支持 1–10 任务并发配置、FIFO 队列调度、断点续传、失败智能重试与自动排重保护。 |
| **格式转换与无损音频提取** | 内置快速转码预设，一键将视频导出为 MP3、AAC、Opus、FLAC、WAV，或压制 H.264 / H.265 MP4。 |
| **YouTube PO Token 防封禁服务** | 内置 Rust 编写的高性能侧车进程（`bgutil-pot-provider-rs`），本地自动计算并分发 Proof-of-Origin Token。 |
| **配套 Chrome 浏览器扩展** | 在网页上一键推送到桌面端下载，支持 `vdownload://wake` 协议唤醒，解决无后台常驻时的拉起问题。 |
| **双轨浏览器 Cookie 解密** | 支持从 Chrome、Edge、Brave 等导入登录态，采用原生 Keychain / GNOME Keyring 结合 yt-dlp CLI 降级通道，免外部 pip 库。 |
| **AI Agent / MCP 协议集成** | 内建 Model Context Protocol (MCP) 服务（支持 HTTP `POST /mcp` 与 Stdio），Cursor 与 Claude 可直接控制下载。 |
| **精致的跨平台界面体验** | 适配深色/浅色外观，macOS Dock 图标带实时网速角标与进度，Ubuntu 下带 Dash 进度条和 CSD 窗口按钮。 |

---

### 获取安装包

#### 1. 直接下载官方安装件
每次分支代码推送均由 GitHub Actions 自动编译出最新版本：

- **macOS（支持 Apple Silicon M系列 与 Intel 芯片）**：
  - 从 [Releases 页面](https://github.com/wangm12/v-download/releases) 或最新 [Nightly 每日构建](https://github.com/wangm12/v-download/releases/tag/nightly) 下载 `.dmg` 文件。
  - 打开并拖拽 `V-Download.app` 至「应用程序」即可运行。
- **Ubuntu / Debian Linux (x64 与 arm64)**：
  - 从 [Releases 页面](https://github.com/wangm12/v-download/releases) 或 [Nightly 页面](https://github.com/wangm12/v-download/releases/tag/nightly) 下载 `.deb`：
    ```sh
    sudo dpkg -i V-Download-*.deb
    ```
- **Linux 通用便携版 (AppImage)**：
  - 下载 `.AppImage` 文件，赋予执行权限后直接运行：
    ```sh
    chmod +x V-Download-*.AppImage && ./V-Download-*.AppImage
    ```

#### 2. 本地源码构建
```sh
git clone https://github.com/wangm12/v-download.git
cd v-download
make install

# 自动构建当前平台的全部发布包（macOS 下生成 dmg/zip；Linux 下生成 deb/AppImage）
make release

# 或明确构建特定安装包
make deb       # 构建 Ubuntu/Debian .deb
make appimage  # 构建 Linux .AppImage
```

---

### 本地开发常用命令

```sh
make dev       # 启动开发服务器（支持热重载）
make build     # 编译前端与 Electron 主进程
make test      # 运行 40+ 项测试用例与契约测试
make typecheck # 严格类型检查
make mac       # 打包 macOS DMG/zip
make deb       # 打包 Linux .deb 安装包
make linux     # 打包 Linux 全量格式 (.deb + .AppImage)
make release   # 智能自适应打包当前平台全部安装件
make clean     # 清理构建缓存与 staging 临时文件
```

---

## 许可证 (License)

本项目采用 [MIT License](LICENSE) 开源。
