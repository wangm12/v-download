# V-Download 1.1.7 代码证据补充：六条产品链路

> 历史记录，已归档。本文保留当时的基线、观察和验收范围；当前桌面状态见 [DESKTOP_STATUS](../../DESKTOP_STATUS.md)，网页版执行计划见 [web-download](../../plans/web-download.md)。旧优先级建议不自动成为当前待办。

> 2026-10-16 整理：独立研究目录已删除，仍被报告引用的证据已归档。正文中的原测试路径保留为历史条件；详见 [归档说明](research-archive-2026-10-16.md)。

研究日期：2026-10-15（America/Los_Angeles）。研究对象：`/Users/mingjie/Documents/github/personal-projects/v-download`。固定源码 HEAD：`a3d0bfbb444045e034b0fdfc611e4f2a9888c464`；源码版本及扩展版本均为 `1.1.7`。

本补充最初基于源码、测试源码和已构建产物的静态检查；后在第 7 节复核了研究主执行者产生的独立实例/自有夹具运行证据。本补充作者没有启动/控制应用、下载媒体、运行测试、读取用户 Cookie/应用数据库或更改产品源码。文档中的方案和验收是改进候选，不是已实施结果；仓库 README/产品方向文档作为材料，不构成用户授权。

证据标签：**C**＝当前源码直接可见的实现/接口；**D**＝由相连生产者和消费者推导的行为或风险，尚待运行验证；**T**＝测试源码存在相应断言，本补充作者未执行；**R**＝README/产品文档宣称；**A**＝只读产物比对；**M**＝主执行者真实运行产物的只读复核。静态“有实现”不等于当前网站成功率或真实界面质量已经验证。

## 1. 版本、产物与架构基线

- [package.json:3](../../../package.json#L3)：v1.1.7；[package.json:92](../../../package.json#L92)：Electron 43.7.5、React 19、TypeScript、SQLite、electron-updater、Playwright/CloakBrowser。发布脚本覆盖 macOS arm64/x64、Linux arm64/x64；Windows builder 配置本身不能建立 Windows 支持声明。
- **A**：`/Applications/V-Download.app/Contents/Resources/app.asar` 与 `dist/mac-arm64/V-Download.app/Contents/Resources/app.asar` 的 SHA-256 均为 `2b436fae61184fb4f1a265a9a82f6af835b10a5b8a5b96dddf8cfaf9d1991a61`。安装包内全部 7 个 `out/` 文件与当前工作目录 `out/` 逐字节相同，包括 main、preload、renderer JS/CSS/HTML、icon、tsbuildinfo。
- **A/未知**：包内 `package.json` 没有 `gitHead/buildCommit/revision`。因此能证明 installed＝dist＝当前 out，不能仅据此证明 out 由上述 HEAD 生成。mtime 和同为 1.1.7 都不是构建来源证明；需另在研究副本固定 HEAD 构建比较才能建立该链。
- 核心依赖方向：renderer → preload IPC → shared resolver/queue/download manager → yt-dlp、FFmpeg、Douyin/XHS adapter；Chrome 扩展 → localhost 18765 → 同一队列；HTTP/MCP → localhost 18766 → Remote Job service → 共享 resolver/下载管理器。[index.ts:435](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/index.ts#L435)、[remoteJobService.ts:249](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/remoteJobService.ts#L249)
- 引擎 manifest 固定 yt-dlp `2026.07.04`、FFmpeg/ffprobe `8.1.2`、PO token provider `0.8.1`。这是仓库/包内元数据，实际运行选中的引擎还可能是 userData 更新版或用户配置路径。[manifest.json:5](../../../resources/engines/manifest.json#L5)、[ytdlp.ts:268](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/ytdlp.ts#L268)

## 2. 六条链路的 43 项现状

### A. 输入与解析

| ID | 触发条件与实际行为 | 证据类型及来源 | 产品影响与核验重点 |
|---|---|---|---|
| A01 | 主窗非文本输入区域按 Cmd/Ctrl+V，读取剪贴板并解析；输入框保留普通粘贴。 | C：[useKeyboardShortcuts.ts:31](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/renderer/src/hooks/useKeyboardShortcuts.ts#L31)、[useUrlHandler.ts:456](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/renderer/src/hooks/useUrlHandler.ts#L456) | 快捷捕获已存在。验收需包括搜索框、对话框、Mini 窗口和普通主窗，不能只测快捷键注册。 |
| A02 | 剪贴板包含多个 URL 时，函数返回第一个可用链接，且会优先 Douyin；URI 拖拽也只取第一条。 | C：[youtube.ts:63](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/renderer/src/utils/youtube.ts#L63)、[dragUrl.ts:2](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/renderer/src/utils/dragUrl.ts#L2) | “支持批量队列”不等于“支持多链接粘贴”。后续可做预览式批量导入，保留来源顺序并报告忽略项；当前测 3 个混合 URL 应记录只捕获 1 条。 |
| A03 | 页面 URL 建立 resolving 队列占位任务，最多 2 个解析 worker；全局 90 秒超时，Douyin fallback 另有 45 秒预算。 | C：[infoResolutionManager.ts:20](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/infoResolutionManager.ts#L20)、[videoInfoResolver.ts:39](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/videoInfoResolver.ts#L39) | 异步解析与取消已实现，不是全局阻塞式 spinner；要验收慢站不会阻止后续输入，取消后不产生 ready/下载。 |
| A04 | 页面解析先识别直链、Douyin 主页/图集、XHS 图集/纯文本，再调用 yt-dlp；下载路径对 HLS 在 Auto 下优先 yt-dlp，合格渐进直链可先 FFmpeg，再 fallback。 | C：[videoInfoResolver.ts:148](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/videoInfoResolver.ts#L148)、[downloadManager.ts:2448](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L2448) | 网站覆盖主要继承 yt-dlp，同时有自有垂直适配。不能把 1,000+ extractors 数量当 1,000+ 端到端已测网站。 |
| A05 | Douyin 主页打开 post picker；XHS/Douyin 图集可成为媒体任务，纯文本可按 note-only 保存。 | C：[useUrlHandler.ts:395](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/renderer/src/hooks/useUrlHandler.ts#L395)、[videoInfoResolver.ts:208](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/videoInfoResolver.ts#L208)、[downloadManager.ts:2360](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L2360) | 是产品差异，不只视频站外壳。验收应分别记录视频、图片、Live Photo、纯文本输出，不能把它们合并为一个“Douyin 成功”。 |
| A06 | 重复输入根据 URL identity 查最近任务；完成文件仍存在则聚焦旧任务，消失则重新排队；forceNew 可强制新建。 | C：[mediaIdentity.ts:151](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/mediaIdentity.ts#L151)、[downloadManager.ts:1312](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L1312) | 去重已有，但 identity 不含音视频类型、质量、目标目录；升级画质/改存音频可能被当同一请求，见 I06。 |
| A07 | 设置有“下载前询问格式”开关并持久化；解析结果的决策函数只看 autoStart，普通粘贴未传 autoStart。研究实例实际关闭开关后，粘贴全新 watch/dash 页面仍弹格式框。 | C/D/M：[PreferencesPanel.tsx:792](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/renderer/src/components/PreferencesPanel.tsx#L792)、[useUrlHandler.ts:303](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/renderer/src/hooks/useUrlHandler.ts#L303)、[formatDialogPresentation.ts:81](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/renderer/src/components/formatDialogPresentation.ts#L81)；截图与设置观察见第 7.6 节 | 当前调用链不消费 settings.showFormatDialog，偏好开关与实际决策脱节，已由 UI 路径复现。验收见 I02。 |

### B. 扩展嗅探与认证

| ID | 触发条件与实际行为 | 证据类型及来源 | 产品影响与核验重点 |
|---|---|---|---|
| B01 | MV3 扩展在全站注入视频 overlay；YouTube/Douyin/X/TikTok 有专用脚本；网络监听分析响应 MIME/URL/大小。 | C：[manifest.json:24](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/extension/manifest.json#L24)、[background.js:2074](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/extension/background.js#L2074) | 通用嗅探已经存在；与 Downie 的差别需比较发现率、用户引导和交互，而不能列为缺失。 |
| B02 | 网络候选绑定 tab/frame、导航 epoch、完整 page URL；排除旧页面完成回调，使用角色/可靠性判断过滤噪声。 | C：[background.js:2082](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/extension/background.js#L2082)、[mediaIdentity.ts:76](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/mediaIdentity.ts#L76) | 有实际候选归属机制。验收 SPA 跳转、iframe、广告/预览、旧 tab 请求，不以一次成功列表代替覆盖。 |
| B03 | 嗅探缓存 20 分钟 TTL、全局 600 条与 3 MiB storage 预算，worker 重启可从 session storage 恢复。 | C：[background.js:1307](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/extension/background.js#L1307)、[background.js:1687](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/extension/background.js#L1687) | 有容量边界和生命周期管理；仍需测高流量页面是否把真实资源挤出，UI 是否说明结果时效。 |
| B04 | 扩展先 POST，必要时通过 vdownload://wake 唤醒应用并重试；batch 回报逐项结果。打包应用要求已允许的扩展 origin 和 per-install capability。 | C：[background.js:2331](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/extension/background.js#L2331)、[download-transport.js:2](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/extension/download-transport.js#L2)、[securityValidation.ts:31](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/securityValidation.ts#L31) | 冷启动、局部失败、配对恢复已有机制。验收每个 accepted 请求只产生一个任务，并验证失效配对后恢复，不只看 HTTP 200。 |
| B05 | Cookie 同步是用户触发；每分钟 alarm 只轮询 pending 请求；真正同步时遍历共享允许域名列表。 | C：[background.js:2673](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/extension/background.js#L2673)、[background.js:2731](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/extension/background.js#L2731)、[securityValidation.ts:45](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/securityValidation.ts#L45) | 不能描述成启动后不断自动导出所有站点 Cookie。仍需使用户明确一次同步涉及哪些站点。 |
| B06 | 内建登录支持 6 类站点；账户状态 connected 仅由保存 cookie 数量是否大于 0 推导，不是联网会话有效性验证。 | C/D：[nativeAuthModel.ts:1](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/nativeAuthModel.ts#L1)、[nativeAuth.ts:216](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/nativeAuth.ts#L216) | “已连接”可能包含过期 Cookie；改进应区分已保存与最近验证有效，并把实际失败指向对应认证来源。 |
| B07 | Native-auth `.dat` 在可用 backend 加密，但供引擎用的 native-cookies/*.txt 及扩展 cookies.txt 为 owner-only Netscape 文件；Douyin/Bilibili 某些链路会自动读浏览器 Cookie。网络嗅探候选只收响应头信息，转交 batch payload 没有原始请求认证头。 | C/D：[nativeAuth.ts:145](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/nativeAuth.ts#L145)、[nativeAuth.ts:182](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/nativeAuth.ts#L182)、[localServer.ts:157](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/localServer.ts#L157)、[ytdlp.ts:332](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/ytdlp.ts#L332)、[background.js:2347](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/extension/background.js#L2347) | 不能笼统声称所有 Cookie 文件都加密，空 app profile 也不是匿名浏览器环境。普通带认证媒体的重放/重启恢复需要显式 auth-source 设计，见 I04。 |

### C. 质量、字幕与合集

| ID | 触发条件与实际行为 | 证据类型及来源 | 产品影响与核验重点 |
|---|---|---|---|
| C01 | 格式选择器保留/展示 codec/container、分辨率、exact/approx size，并按质量推荐候选；提交只传 mp4/mp3 和数值 quality，没有传选中 format_id。 | C/D：[formatDialogPresentation.ts:36](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/renderer/src/components/formatDialogPresentation.ts#L36)、[FormatDialog.tsx:114](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/renderer/src/components/FormatDialog.tsx#L114)、[FormatDialog.tsx:214](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/renderer/src/components/FormatDialog.tsx#L214) | 显示的候选与实际下载契约不等价，不能说用户可精确选择 codec/format。见 I01。 |
| C02 | yt-dlp JSON mapper保留 ID、尺寸、codec、tbr 等，但不映射 fps、dynamic_range/HDR、language、audio track、subtitles/automatic_captions/chapters。 | C：[ytdlp.ts:461](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/ytdlp.ts#L461)、[types/index.ts:52](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/renderer/src/types/index.ts#L52) | 引擎可能支持这些能力，当前产品事实模型未完整暴露。HDR/60fps 的 README 宣称不能解释为可检查/可锁定。 |
| C03 | 普通页面视频优先高度≤quality 的 MP4+M4A，随后有不限高度 fallback；字符串 best 到 runTask 会被 parseInt→1080。direct-media 的 yt-dlp 分支另用 best 或 bestvideo+bestaudio/best，不使用高度上限；FFmpeg direct options 也没有 quality 字段。 | C/D/M：[ytdlp.ts:955](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/ytdlp.ts#L955)、[ytdlp.ts:976](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/ytdlp.ts#L976)、[downloadManager.ts:2236](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L2236)、[ffmpegDownload.ts:142](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/ffmpegDownload.ts#L142)；360p HLS 实证见第 7 节 | UI 没传精确选择与 adapter 没执行已传 quality 是两个边界问题；不能把所有画质失败都归因 FormatDialog 或 FFmpeg。 |
| C04 | 普通 audio/mp3 下载选 bestaudio/best，再 `--audio-format mp3 --audio-quality 0`；未使用选中 kbps 数值。 | C：[ytdlp.ts:1043](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/ytdlp.ts#L1043)、[FormatDialog.tsx:157](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/renderer/src/components/FormatDialog.tsx#L157) | 128/320 kbps 源候选不是输出 MP3 码率开关，不能把 UI 的 kbps 标注当输出合同；也无法还原源音频质量。 |
| C05 | 当前产品 types/settings/DownloadOptions 与 argv 未提供字幕语言、人工/自动字幕、字幕输出/内嵌字段；“Save caption as Markdown”保存标题/描述/来源。已含字幕的 MP4 也没有显式保留合同。 | C/M/搜索边界：[ytdlp.ts:125](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/ytdlp.ts#L125)、[settings.ts:32](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/settings.ts#L32)、[noteMarkdown.ts:38](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/noteMarkdown.ts#L38)、[ffmpegDownload.ts:286](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/ffmpegDownload.ts#L286) | 自有 annotated MP4 实测 mov_text 字幕丢失、3 个章节保留，详见第 7 节。不能把“没有章节产品接口”扩大为“所有章节必然丢失”；字幕保存也不限于额外下载 sidecar。 |
| C06 | 合集选择器支持多选/全选/范围选择；入队写死 format=video、使用全局默认质量，以显示标题 folderName 当 playlistId。 | C/D：[CollectionPickerDialog.tsx:73](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/renderer/src/components/CollectionPickerDialog.tsx#L73)、[CollectionPickerDialog.tsx:104](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/renderer/src/components/CollectionPickerDialog.tsx#L104)、[downloads.ts:14](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/renderer/src/utils/downloads.ts#L14) | 合集已有，却没有该界面的一致音频/质量预设；两个同名合集会按同一组 ID 聚合。见 I05。 |
| C07 | 合集列表通过单个 yt-dlp flat-playlist 调用完整取回，180 秒/64 MiB stdout/2 MiB stderr 限制；关闭 picker 只将 alive=false，没有取消 IPC/子进程。 | C/D：[playlistList.ts:31](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/playlistList.ts#L31)、[playlistList.ts:126](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/playlistList.ts#L126)、[CollectionPickerDialog.tsx:50](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/renderer/src/components/CollectionPickerDialog.tsx#L50) | 有资源界限但没有当前界面的取消传播/增量分页；大频道需测首屏时间和关闭后的资源释放。 |
| C08 | 单条 format dialog 默认勾选 Markdown；扩展 autoStart 路径传 includeNote=false、API include_note 默认 false。Remote Job fanout 明确对子任务关闭 includeNote。 | C：[formatDialogPresentation.ts:73](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/renderer/src/components/formatDialogPresentation.ts#L73)、[useUrlHandler.ts:303](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/renderer/src/hooks/useUrlHandler.ts#L303)、[apiJobsModel.ts:137](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/apiJobsModel.ts#L137)、[remoteJobService.ts:221](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/remoteJobService.ts#L221) | 同 URL 不同入口的副产物不完全相同。验收需记入口、模式与 note 选项，避免把注释保存能力当处处一致。 |

### D. 调度、持久化与恢复

| ID | 触发条件与实际行为 | 证据类型及来源 | 产品影响与核验重点 |
|---|---|---|---|
| D01 | Balanced/Turbo：单条池最多 3、每合集最多 3、同时最多 3 个合集，理论总计 12；Gentle 理论 2。合集先补槽，单条有独立池。 | C/T：[shared/index.ts:11](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/packages/shared/src/index.ts#L11)、[groupedQueueScheduler.ts:54](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/groupedQueueScheduler.ts#L54)、[test-grouped-queue-scheduler.ts:7](../../../scripts/test-grouped-queue-scheduler.ts#L7) | README 的“1–10/FIFO”与实际不符。资源测试应计总任务×分片与进程家族，不只设置里的单条并发。 |
| D02 | pauseTask 将任务标 paused 并取消进程；retryTask 重新排队，paused/error/interrupted 保留数字进度；yt-dlp --continue 利用部分文件。FFmpeg 直链暂停会 unlink staged part。真实 slow fixture 在 UI 暂停 18% 后恢复，新的 Range 从 0 完整重下，但 UI 起始仍 18%。 | C/D/M：[downloadManager.ts:3537](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L3537)、[downloadManager.ts:3574](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L3574)、[downloadManager.ts:2496](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L2496)、[ytdlp.ts:984](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/ytdlp.ts#L984)；请求证据见第 7.5 节 | “恢复”在不同引擎下不保证字节续传。本例字节重下已实证；保留旧数字进度掩盖实际重新开始，见 I08。 |
| D03 | 重开把原 downloading 任务改为 interrupted，保留待用户恢复；原 queued 任务可继续运行。resolving/ready 会重新解析，ready 的完整结果只在内存。本轮正常退出确认后重开，确实显示 1 项已中断；但 banner 的“全部继续”还重新执行 3 个历史 error，见第 7.9 节。 | C/M：[downloadManager.ts:4216](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L4216)、[infoResolutionManager.ts:167](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/infoResolutionManager.ts#L167)、[App.tsx:543](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/renderer/src/App.tsx#L543)、[downloadManager.ts:4208](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L4208) | 持久化恢复已实证，不能声称全部自动恢复或全部暂停；本轮是正常退出，不是 kill/crash 测试。恢复 banner 丢掉已知 ID 作用域，旧失败任务被额外重试；API 又把 interrupted 导出 queued，见 I08/I12。 |
| D04 | Remote Job 对 retryable task error 最多 3 次，直接 retryTask；桌面普通 yt-dlp 失败路径设 error，并有 Douyin fallback，未见统一任务级延时重试。 | C/搜索边界：[remoteJobService.ts:318](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/remoteJobService.ts#L318)、[downloadManager.ts:2826](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L2826)、[apiJobsModel.ts:5](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/apiJobsModel.ts#L5) | 要区分引擎内部重试、扩展传输重试、Remote Job 重试、桌面任务重试；README 的笼统承诺需收窄，见 I09。 |
| D05 | SQLite 保存队列/任务状态及 extras，批量入队使用事务；模型测试用真实 in-memory SQLite 验证 migration/idempotence。 | C/T：[database.ts:58](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/database.ts#L58)、[downloadManager.ts:2074](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L2074)、[test-foundation.ts:6](../../../scripts/test-foundation.ts#L6) | 属于真实持久化基础，测试仍不证明 kill/restart、文件发布窗口或原生 SQLite ABI 的全部行为。 |
| D06 | 进度 IPC 使用 slim payload，节流阈值 400ms，Dock 1 秒；引擎 tick 仍会更新 SQLite。鉴权请求头持久化被过滤，而运行内存 metadata 可暂存。 | C：[downloadManager.ts:724](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L724)、[downloadManager.ts:990](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L990)、[downloadManager.ts:2734](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L2734)、[persistedExtras.ts:134](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/persistedExtras.ts#L134) | 有前端降噪，未建立完整性能基准。认证依赖若不能重取，重启后不能简单重放旧任务；不要为恢复而无差别持久化 secrets。 |

### E. 后处理与文件完整性

| ID | 触发条件与实际行为 | 证据类型及来源 | 产品影响与核验重点 |
|---|---|---|---|
| E01 | 文件名/作者目录模板支持 title/id/author/date/time/site/ext；拒绝未知 token、raw yt-dlp interpolation 与父级目录段。 | C/T：[outputTemplateModel.ts:7](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/outputTemplateModel.ts#L7)、[outputTemplateModel.ts:107](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/outputTemplateModel.ts#L107)、[test-output-template.ts:19](../../../scripts/test-output-template.ts#L19) | 归档模板已有，不能列为待新增。date 在 yt-dlp 通常取 upload_date，在 concrete writer 缺值时取本地当前日期，跨 provider 日期语义需说明。 |
| E02 | 产物先放任务 staging，通过 hardlink 或 exclusive-create copy 发布；跟踪 dev/ino/size/birthtime 与 publish journal，避免覆盖及误清理替换文件。 | C：[downloadManager.ts:166](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L166)、[persistedExtras.ts:76](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/persistedExtras.ts#L76) | 文件所有权保护较深入，是应保留优势；新增字幕/缩略图不能绕过这条发布/清理链。需故障注入验证 rename/copy/kill 窗口。 |
| E03 | 删除记录与删除文件是不同动作；批量文件删除等待活动下载/转码结束，清理失败保留任务记录并返回细节。 | C：[App.tsx:649](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/renderer/src/App.tsx#L649)、[downloadManager.ts:3905](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L3905) | 不是无保护的“清空下载目录”。验收替换文件、权限错误、部分失败、图库目录，并核对未拥有文件不被删除。 |
| E04 | FFmpeg 直链成功先要求≥512 bytes，再运行有 15 秒预算的 ffprobe，确认可读且至少有期望 audio/video stream，之后才发布。 | C：[downloadManager.ts:2538](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L2538)、[ffmpegDownload.ts:367](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/ffmpegDownload.ts#L367) | 已有真实验证，但“有 video stream”不证明有声音/时长完整/可完整解码；不能夸大为完整文件校验。 |
| E05 | 普通 yt-dlp 成功路径找 final-output marker、文件身份/最小大小再发布；检测单任务多输出和 metadata capture overflow 后报错并保留 staging。 | C：[downloadManager.ts:3182](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L3182)、[downloadManager.ts:3197](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L3197)、[downloadManager.ts:3381](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L3381) | 不会随便选择目录最新文件，但与 E04 没有统一 ffprobe 标准。损坏但非零且引擎 exit=0 的文件仍需产品级验证，见 I07。 |
| E06 | 8 个后转码预设：MP3/AAC/Opus/FLAC/WAV/H.264/H.265/VP9；使用软件编码器，另建 `.transcoded` 文件，保留原文件；任务 file_path 转指最新衍生文件。 | C：[transcodeModel.ts:3](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/transcodeModel.ts#L3)、[downloadManager.ts:3969](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L3969)、[downloadManager.ts:4071](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L4071) | 后处理已有；没有配置硬件编码/设备预设的证据。FLAC 容器不能证明原始流是无损；多次转码时“原始文件”和“当前指向”应可区分。 |
| E07 | transcodeFile 只发 0% 和 100%，durationSec 没用于进度；成功校验为 exit=0＋文件存在/size，然后发布最小 1 byte，没有该路径 ffprobe。 | C/D：[transcodeManager.ts:38](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/transcodeManager.ts#L38)、[transcodeManager.ts:104](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/transcodeManager.ts#L104)、[downloadManager.ts:4024](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L4024) | 长转码实际进度和输出验证有改进空间；没有进度不能标成可量化 ETA。验收输出时长/流结构及可取消进度事件。 |
| E08 | 开始下载前只判断剩余空间>32 MiB，statfs 失败视为可继续；已有文件复用按 media ID 文件名 marker 和最小大小匹配。 | C/D：[downloadManager.ts:321](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L321)、[downloadManager.ts:383](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L383) | 容量检查不是已选格式大小预算；同 ID 既有低画质输出可能被复用。用预计最终＋合并暂存空间、实际输出技术属性改进，而非只抬高固定阈值。 |

### F. Mac、更新与 MCP

| ID | 触发条件与实际行为 | 证据类型及来源 | 产品影响与核验重点 |
|---|---|---|---|
| F01 | 原生 application menu、常见 accelerators、tray、后台通知/点击定位、登录项、关闭隐藏已有。 | C：[appMenu.ts:49](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/appMenu.ts#L49)、[taskNotify.ts:16](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/taskNotify.ts#L16)、[index.ts:151](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/index.ts#L151)、[index.ts:430](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/index.ts#L430) | Mac 桌面深度不是零。应逐项比较行为完成度、键盘可达、窗口状态及通知动作，不能只以 Electron/native 标签给分。 |
| F02 | Dock 使用系统进度条与 active-count badge；updateProgress 的 speed 参数明确忽略。 | C：[dockProgress.ts:13](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/dockProgress.ts#L13) | README 的“Dock icon 实时下载速度”不是当前实现；修正文档/界面承诺，速度保留在应用内。 |
| F03 | 独立 Mini window 已有，380×560，最小 320×420，不可最大化/全屏，隔离 preload 与主窗相同；可复用已开实例。 | C：[compactWindow.ts:15](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/compactWindow.ts#L15)、[compactWindowHost.ts:23](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/compactWindowHost.ts#L23) | 不能把紧凑模式列缺失。需测热键/粘贴/拖拽/任务控制与主窗一致，不只尺寸。 |
| F04 | 应用 updater 仅 packaged＋有效 HTTPS env feed 时初始化；初始化后自动 check/download/退出安装。菜单模板没有手动检查更新动作，settings schema 未提供更新偏好。 | C/搜索边界：[updater.ts:47](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/updater.ts#L47)、[appMenu.ts:49](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/appMenu.ts#L49)、[settings.ts:32](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/settings.ts#L32) | 不能声称没有 updater，也不能仅因 app-update.yml 存在就认定用户启动会更新。交付 feed、状态可见性、选择与可回滚性需产品化，见 I10。 |
| F05 | 引擎检查/下载更新、SHA-256、可执行版本验证、备份/事务替换与设置落盘失败回滚已有。FFmpeg 的远端描述来自显式 managed manifest；yt-dlp 可查 GitHub latest digest。 | C：[engineManager.ts:132](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/engineManager.ts#L132)、[engineManager.ts:222](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/engineManager.ts#L222)、[engineManager.ts:324](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/engineManager.ts#L324) | 引擎更新已存在；SHA 摘要不等于单独的签名验证。当前缺 descriptor 文案“signed update metadata”不能扩大为已验发行签名。 |
| F06 | Remote HTTP/MCP 默认 localhost/关闭；Bearer 验证；MCP 6 工具，写入开关与 confirm；只接收 URL/include_note，不接收质量、format、字幕、选项，使用全局 defaultVideoQuality。list_jobs 无分页全量返回。 | C：[remoteMcpModel.ts:19](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/remoteMcpModel.ts#L19)、[remoteMcpModel.ts:168](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/remoteMcpModel.ts#L168)、[apiJobsModel.ts:148](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/apiJobsModel.ts#L148)、[remoteJobService.ts:183](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/remoteJobService.ts#L183) | 是可用自动化入口，不是完整桌面能力的代理控制面；用户选择无法完整跨入口传递。保留安全开关，按能力契约演进，见 I12。 |
| F07 | 扩展安装按钮实际上打开目录/浏览器扩展页，要求 Developer mode＋Load unpacked；包里提供 Chrome MV3 manifest。产品方向明确无独立 Library/播放器。 | C/R：[ipc/window.ts:228](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/ipc/window.ts#L228)、[manifest.json:1](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/extension/manifest.json#L1)、[PRODUCT_DIRECTION.md:20](../../PRODUCT_DIRECTION.md#L20) | Mac 精品体验的明显机会是扩展分发/安装诊断/浏览器覆盖及捕获完成度；不是为了对齐竞品硬塞媒体库。Safari/Firefox 扩展实现本轮未发现，见搜索边界。 |

## 3. 12 条优先改进候选

优先级表示对“跨平台通用下载器＋Mac 精品体验”的研究建议顺序，不是已经排期的任务。P1 先修用户选择与结果一致性；P2 再扩展产品深度。工期/收益未经实测，不提供虚构估算。

### I01 · P1：把格式行变成真正可兑现的下载契约

- **触发/证据**：用户选择同为 1080p 的 H.264/VP9/AV1 或不同音轨、128/320 kbps 行。[FormatDialog.tsx:114](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/renderer/src/components/FormatDialog.tsx#L114) 只传 format/quality；[ytdlp.ts:461](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/ytdlp.ts#L461) 丢 fps/HDR/language；[ytdlp.ts:976](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/ytdlp.ts#L976) 重算通用选择器，audio quality 固定 0；[downloadManager.ts:2236](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L2236) 把 best 当 1080。**C＋D，高置信静态合同缺口**。
- **影响**：行上 codec、尺寸、大小及 kbps 看起来是精确选择，实际输出可与行不符；8K/HDR/60fps 和 best 不可检查地落到默认/回退。大小可能仅为 video-only stream，不能据此承诺最终合并文件大小。
- **建议**：在 owning resolver boundary 保留结构化 requested selection（精确 format ID 或显式自动策略，音轨/语言、fps、动态范围与容器需求）；传到任务、持久化、引擎 argv。把“源音频码率”和“输出编码质量/目标码率”分开。fallback 必须显示实际选中的属性与原因，不静默扩大高度限制。
- **验收**：用含同分辨率异 codec/fps/HDR、独立音视频、多语言的本地/稳定公开 fixture 走实际 UI→IPC→生产 argv；ffprobe 验证 codec、分辨率、fps、音轨与输出质量。best 真选最高；偏好上限不因失败无提示上浮；重启/重试不丢选择。现有 [formatDialogPresentation.test.ts:7](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/renderer/src/components/formatDialogPresentation.test.ts#L7) 只测候选排序/推荐，不覆盖选择落地。

这里必须分别修复三个生产边界，不能把第二/三项当第一项的下游显示问题：

| 边界问题 | 证据与当前验证范围 | 对应修复/验收 |
|---|---|---|
| **选择生产者没传**：FormatDialog 行对应 ID/codec/fps 等，没有作为 selection 进入任务。 | C/D：[FormatDialog.tsx:114](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/renderer/src/components/FormatDialog.tsx#L114)。目前是源码合同结论。 | 结构化 selection 从行→IPC→持久化→引擎保持一致；选异 codec 同分辨率行的最终输出各自正确。 |
| **yt-dlp direct adapter 没执行已传 quality**：即使全局设置改为 360p、Remote Job 从设置取到 quality，direct HLS 仍 `-f best`。 | C/M：[remoteJobService.ts:183](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/remoteJobService.ts#L183)、[ytdlp.ts:955](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/ytdlp.ts#L955)；第 7 节 hls-request-360 的真实引擎为 yt-dlp，结果 720p。 | 对有 variant 的 HLS/DASH 执行 requested policy；无可用 variant 时报告 unavailable/fallback，不把带扩展名的 URL 全当无须选择的单流。 |
| **FFmpeg direct adapter 无质量输入合同**：options 与 caller 不含 quality，未用 map/variant 选择约束。 | C/D：[ffmpegDownload.ts:142](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/ffmpegDownload.ts#L142)、[downloadManager.ts:2459](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L2459)。本轮 360p HLS 不能作为这一项的直接实证，因为 Auto HLS 走 yt-dlp。 | 能选 variant 才交 FFmpeg remux；纯渐进单流区别“原始下载”与“转成 360p”；单独测 FFmpeg DASH/指定 ffmpeg HLS 的 quality policy，不默认重编码。 |

还有独立的**任务状态传播问题**已由 UI 复现：DB 与真实文件已是 MP3/128，renderer 稳定后仍显示“视频·360”。main 在 promotion 后已重读正确 DB task，却发不含 format/quality 的 slim progress；renderer patch 也不消费这两个字段。第 7.7 节给出完整生产者/传输/消费者链。应在结构化状态转变合同上传递并合并可变任务事实，保持普通进度 tick 精简；不能按 `.mp3` 后缀修标签，也不能只增加全列表轮询。验收同一 task ID 的 row/Inspector/实际文件在 promotion、完成、重试后立即一致，刷新前后不改变事实。

### I02 · P1：修复“下载前询问”开关的生产消费者

- **触发/证据**：Preferences 关闭 ask-before，然后粘贴普通页面 URL；[PreferencesPanel.tsx:792](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/renderer/src/components/PreferencesPanel.tsx#L792) 更新 settings；[useUrlHandler.ts:303](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/renderer/src/hooks/useUrlHandler.ts#L303) 只将 autoStart 传给 [formatDialogPresentation.ts:81](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/renderer/src/components/formatDialogPresentation.ts#L81)。**C＋D＋M，字段未消费已由真实 UI 复现**：showFormatDialog=false 后，全新 `/watch/dash` 仍弹格式对话框。截图/设置观察见第 7.6 节。
- **影响**：用户偏好可保存但不改变粘贴行为，阻碍简单的 copy→download 心智模型；README 的“parse and download immediately”也不清楚何时需要对话框。
- **建议**：在单一入队决策 boundary 明确显式入口参数与持久化偏好的关系；普通粘贴尊重设置，手动“选择格式”始终可开；图集/纯文本与需要用户选择的合集保留所需步骤。把多处 renderer 决策归一，避免再增别名开关。
- **验收**：true/false × paste/extension/重启后的 ready result/Mini window；关闭时单条直接按默认启动，开启时只弹一次；显式 select-format 不被跳过；API/扩展的明确选项不被静默覆盖。现有 [formatDialogPresentation.test.ts:32](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/renderer/src/components/formatDialogPresentation.test.ts#L32) 仅锁定 autoStart，需补完整入口测试。

### I03 · P2：字幕与多语言作为输出的一等能力

- **触发/证据**：下载带人工/自动字幕的视频，希望选中文/英文、侧车或内嵌。当前 [DownloadOptions](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/ytdlp.ts#L125)、[VideoInfo mapper](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/ytdlp.ts#L461)、[产品类型](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/renderer/src/types/index.ts#L52) 无该合同，实际 argv 无对应参数；Markdown 只是 [note fields](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/noteMarkdown.ts#L38)。**C＋明确搜索边界**。
- **影响**：yt-dlp 继承的潜在能力还没有成为可选择、可保存、可确认的产品能力；caption 容易被误读为 subtitles。
- **建议**：先做最低完整闭环：列出人工/自动字幕及语言，选 sidecar/内嵌，确认容器兼容性；后续再加章节/metadata，不只添加 unchecked argv 透传。所有新产物进入已有 ownedOutput journal 和文件列表。
- **验收**：人工/自动/无字幕、多语言、内嵌不兼容、失败/取消/重启；sidecar 不漏清理、不覆盖用户同名文件；UI/API 请求一致，最终产物实际含请求语言，未知/缺失明确说明。

### I04 · P1：认证来源可见、可选择，并支持有意义的恢复

- **触发/证据**：用户只打开 app 或下载公开 Douyin/Bilibili，可能使用浏览器 Cookie；用户界面 connected 只表示 cookieCount>0；带自定义 Authorization/Cookie 的任务重启会失去这些 header。[ytdlp.ts:332](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/ytdlp.ts#L332)、[nativeAuth.ts:216](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/nativeAuth.ts#L216)、[persistedExtras.ts:134](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/persistedExtras.ts#L134)、[mediaResolver.ts:46](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/mediaResolver.ts#L46)。**C＋D**。
- **影响**：公开/已登录/已保存/过期四种状态被混在一起；“重试”可能使用与首次不同的认证上下文。独立 app userData 也不能保证不会访问用户 Chrome。
- **建议**：保留本地存储保护，增加明确 auth-source（匿名、内建账号、用户选的浏览器/扩展会话）及最近验证状态；运行时选择一次并传播引用，失效提示重新获取。不要为持久化恢复直接保存全部请求 secrets。同步 UI 说明站点范围与实际加密/owner-only 文件形态。
- **验收**：匿名任务不触碰浏览器 Cookie/Keychain；过期 cookie 不显示“已验证”；选定来源不被 fallback 静默替换；重启后缺凭据进入 auth-required 并能用既定来源恢复；secret 不出现在日志/错误/持久化 extras。

### I05 · P1：合集身份、显示名和列表生命周期分离

- **触发/证据**：两个不同 source URL 的合集标题相同；或关闭仍在解析的大频道。[CollectionPickerDialog.tsx:110](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/renderer/src/components/CollectionPickerDialog.tsx#L110) 用 folderName 作 playlistId；[downloads.ts:14](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/renderer/src/utils/downloads.ts#L14) 按其聚合；[CollectionPickerDialog.tsx:68](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/renderer/src/components/CollectionPickerDialog.tsx#L68) 只屏蔽 UI 更新，没有取消 listing。**C＋D，混组可从合同确定**。
- **影响**：同名合集混组/共同调度，展示和来源模糊；关闭 UI 后继续占用解析进程；选择器无法为本批设音频、画质、字幕。
- **建议**：用稳定 source identity 或新 batch ID 做资源身份，title/folder 只负责展示与命名；为 listing 建唯一 request ID＋取消；先支持可观察完整列表，再按真实大小考虑分页。批次统一使用 I01 的选项合同。
- **验收**：两个同名不同 URL 的合集分组、删除、进度互不影响；重复导入策略可预测；关闭/取消后 worker/子进程释放；选择/顺序/缺项覆盖可报告；批量音频与指定质量真正落地。

### I06 · P1：把“同一个媒体”与“同一个下载请求”分开

- **触发/证据**：先下 720p，再要 4K/MP3/另一个目录；或两个 URL 仅 generic key/uid/t/s 参数不同。[mediaIdentity.ts:33](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/mediaIdentity.ts#L33) 将大量参数视为 ephemeral；[mediaIdentity.ts:151](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/mediaIdentity.ts#L151)、[downloadManager.ts:1337](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L1337) 仅按 URL identity 入队；[downloadManager.ts:415](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L415) 可按 media ID marker 复用任意足够大的既有文件。**C＋D；未知站点参数冲突是风险，未实测**。
- **影响**：去重保护可能吞掉用户的新目标；文件存在不代表满足本次质量要求。forceNew 已有，但不应要求用户猜测它何时必要。
- **建议**：source/media identity 与 request/output specification 分层；可识别同一媒体后提示“已有 720p，改下 4K/音频”或复用真正等价输出。provider 负责已知可变签名参数，不在全站猜 generic 参数含义；保存原始 URL。
- **验收**：YouTube short/watch 去重保留；同媒体不同 output spec 不被静默吞并；临时签名刷新仍可关联；未知 `?key=A/B` 或 `?uid=A/B` 不未经证据合并；复用输出先核实实际技术属性且不认领用户外来文件的删除权。

### I07 · P1：统一可用输出判定，并复用现有所有权发布链

- **触发/证据**：引擎 exit=0 但文件无声、截断、损坏或仅非零字节；FFmpeg 直链验证 stream class，[ffmpegDownload.ts:367](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/ffmpegDownload.ts#L367)，yt-dlp 路径主要 stat/min-bytes，[downloadManager.ts:3182](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L3182)，后转码 exit/file，[transcodeManager.ts:104](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/transcodeManager.ts#L104)。**C＋D**。
- **影响**：不同引擎“完成”含义不一致；当前 ffprobe 测试也不校验完整时长、音视频组合、解码末尾。不能把 ownership proof 当 media validity proof。
- **建议**：由统一输出验收 owner 接收本次预期（视频是否应含音频、时长容差、codec/container、文件集合）；发布前做有预算的 probe，必要时抽样解码，保留未知/部分而非笼统 complete。沿用 existing exclusive publication/journal，避免散落多个补丁。
- **验收**：有效视频、合法 silent video、音频-only、截断 MP4、HTML 错误正文、缺音轨、失败 ffprobe/超时/取消；所有引擎一致判定并保留诊断。原文件哈希不变；碰撞和清理失败仍保留所有权记录。用生产边界测试及真实小文件，不只源码 regex。

### I08 · P1：限定恢复操作的任务范围，进度说明实际发生的事情

- **触发/证据**：暂停 FFmpeg 直链后重试、长后转码、原来 80% 的任务从头开始。[downloadManager.ts:2496](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L2496) 删除 partial；[downloadManager.ts:3574](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L3574) 保留百分比；[transcodeManager.ts:50](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/transcodeManager.ts#L50)、[transcodeManager.ts:110](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/transcodeManager.ts#L110) 仅 0/100。**C＋D＋M**：第 7.5 节 slow MP4 的 FFmpeg 路径已实证暂停 18% 后从 byte 0 完整重下，初始进度仍 18%；后转码真实进度仍待执行。
- **额外已实证边界**：第 7.9 节正常退出后，banner 提示 1 项中断，但 [App.tsx:543](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/renderer/src/App.tsx#L543) 将其 ids 只用于 dismiss，实际调用无参数 resumeAll；[downloadManager.ts:4208](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L4208) 会 retry 全部 paused/interrupted/error。日志确认另外 3 个历史失败任务也运行了。恢复后的 slow 仍从 byte 0 完整重下。
- **影响**：一次本次中断恢复还触发历史失败任务，操作范围与提示不一致；数值单调也不等于真实进度，用户看不懂 restart/byte-resume/merge/transcode 及剩余时间。
- **建议**：banner 以已有 recovered IDs 发明确命令，主进程按 ID＋期望状态核验，报告 applied/skipped；全局恢复与失败重试另有明确 policy。引擎上报实际恢复能力与起点；用明确 restarted/resuming/preparing/merging/transcoding 状态；后处理用 FFmpeg progress protocol，按已知 duration 计算，不知时长显示 indeterminate；保留原文件和衍生产物入口。
- **验收**：混合本次 interrupted、历史 interrupted、paused、error、cancelled、complete，banner 只恢复当前提示 IDs；全局动作按明确范围单独验证。暂停/重开每种引擎后测实际网络字节，UI/API 与行为匹配；长转码有中间进度和取消；转码失败原文件仍 Open/Reveal；不能保留误导的 80% 假进度。记录 cold/warm 完成时间与进程家族 CPU/峰值内存。

### I09 · P2：统一失败分类与有边界的重试策略

- **触发/证据**：同一 429/503/网络断开由 desktop 或 Remote API 提交，结果不同。[downloadManager.ts:2826](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L2826) 普通任务设终态 error；[remoteJobService.ts:328](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/remoteJobService.ts#L328) remote 最多 3 次并立即重排；[apiJobsModel.ts:7](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/apiJobsModel.ts#L7) 定义的 retry delays 未被该 listener 使用。**C＋D**。
- **影响**：入口差异不透明；429 立即重试可能进一步限流；已在引擎内部重试后再在应用层重复可能放大总等待与请求数。
- **建议**：共享错误分类 owner，区分认证、不可用/删除、DRM、网络、容量；应用级明确 max attempts/elapsed budget、退避和 Retry-After，并计入引擎内部预算。UI 展示当前尝试与下一次时间，用户取消可立即停止。
- **验收**：公开本地 fixture 模拟 429＋Retry-After、503恢复、401/DRM、永久404、idle hang；desktop/API 使用同一政策；重启不无限复活；记录整个任务请求次数和耗时，不只一次调用成功。

### I10 · P2：更新交付和版本诊断成为可理解的产品流程

- **触发/证据**：用户安装官方 build，希望知道能否更新、何时会安装、当前实际引擎来源。[updater.ts:47](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/updater.ts#L47) 取 env-only feed 且 autoInstallOnAppQuit；[engineManager.ts:222](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/engineManager.ts#L222) 有完整引擎检查；[engineManager.ts:238](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/engineManager.ts#L238) 使用 signed metadata 文案但所见 descriptor 是 HTTPS＋digest。**C＋D**。
- **影响**：已有 updater 不等于用户拿到完整可维护性；只测 mock/version comparator 不能证明实际 updater/provider 交付。归因困难会把上游过旧/选错引擎误当网站不支持。
- **建议**：发布配置明确 feed/channel，提供手动检查/状态/安装时机与恢复；显示 app build identity、实际引擎 path/source/version、最近检查/更新时间。签名/摘要文案按真实验证程度写；继续保留事务替换和 checksum。
- **验收**：无 feed/离线/可更新/损坏摘要/不可执行/保存失败/回滚/用户自定义引擎；研究期间不自动更换基线。包中可溯源 commit/build manifest，与 installed hash 对照；不通过“有 YAML”宣布更新成功。

### I11 · P2：降低 Mac 浏览器捕获的安装与恢复摩擦

- **触发/证据**：第一次点“安装扩展”、用 Safari/Firefox、浏览器与 app 未配对或被移动后 ID 变化。[ipc/window.ts:228](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/ipc/window.ts#L228) 仍需 Developer mode＋Load unpacked；[manifest.json:1](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/extension/manifest.json#L1) 是 Chrome MV3；现有 origin/capability auth、冷启动、Mini/menus 均已存在。**C＋搜索边界**。
- **影响**：跨平台能力强，却把技术步骤和浏览器状态处理交给用户；Mac 品质可先提高安装/连接可靠性，再评估新增系统入口。
- **建议**：优先正式分发可升级的扩展、可验证安装状态/配对状态、一键诊断和明确恢复动作；浏览器选择与可支持的功能一致。用竞品实测来决定 Safari companion/Share/Shortcuts 是否值得做，不先承诺全面移植或重写 Electron。
- **验收**：干净浏览器 profile 完成首次安装→配对→网页下载；app 冷/热启动、浏览器重启、移动/升级、失效配对都能恢复；不要求打开 Developer mode 的常规分发链。Mac menu/tray/通知/keyboard/Mini 现有能力回归，不因增加新入口分叉合同。

### I12 · P2：MCP 保留用户目标，并限制整任务上下文成本

- **触发/证据**：agent 要“只下音频/720p/英文字幕/合集第2项”或查询大量历史任务。[apiJobsModel.ts:148](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/apiJobsModel.ts#L148) HTTP 创建只允许 URL/include_note；[remoteMcpModel.ts:90](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/remoteMcpModel.ts#L90) MCP 同样没有选择；[remoteJobService.ts:183](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/remoteJobService.ts#L183) 使用全局质量；[remoteMcpModel.ts:168](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/remoteMcpModel.ts#L168) 全量列表。**C＋D**。
- **影响**：自动化入口是差异优势，但目前易靠修改全局设置绕过每任务选择；长历史增加 token/context，信息不足又导致重试和额外 UI 操作。
- **建议**：复用 I01 的共享请求类型，先提供只读 inspect/resolve（能力、格式/字幕、限制、建议），enqueue 接明确每任务选择与幂等 key；list 加 filter/limit/cursor，返回实际选择/覆盖/失败分类，完整产物按需取。写开关和 confirm 继续保留，先校验客户端 schema/协议兼容性。
- **验收**：同请求通过 UI/API/MCP 得到一致实际输出；未知/不支持选项明确报错而不静默降级；只读 inspect 不下载；大量历史分页稳定；写关闭/缺 confirm 仍拒绝。以完整 agent 任务比较 tokens、耗时、额外调用/重试、CPU/峰值内存，而非只比较 JSON 字节。

## 4. README 与实现差异及不能扩大解释的声明

| README/文档措辞 | 当前可证实内容 | 研究记录要求 |
|---|---|---|
| [README:42](../../../README.md#L42) 1–10 并发、FIFO | D01 的分组/独立池政策，理论最高 12；单条设置实际 clamp 1–3。 | 用真实在运行任务、分片与进程数，解释调度公平性，不沿用旧数字。 |
| [README:49](../../../README.md#L49) Dock 速度 | F02 只有系统进度条＋任务数 badge；speed 参数忽略。 | 当前 UI 以实证/源码为准；不要把应用内速度当 Dock speed。 |
| [README:43](../../../README.md#L43) 音频多格式转换 | 普通下载输出 MP3；8 种后处理预设可在完成后执行，原文件保留。 | 分开下载预设、原始流、后转码；FLAC 不等于下载无损音源。 |
| [README:46](../../../README.md#L46) OS-backed Cookie 保护 | native `.dat` 可加密；引擎所用 Netscape 明文受 owner-only 权限保护；扩展 cookies.txt 同样如此。 | 分开存储形态/范围，不声称所有 Cookie 文件均加密。 |
| [README:42](../../../README.md#L42) transient 自动重试 | D04 存在 engine/extension/remote/desktop 四种不同策略。 | 写明入口与预算；不因某一层有 retry 就把所有任务都描述成自动恢复。 |
| [README:40](../../../README.md#L40) 1,000+、8K 60fps HDR | 引擎支持面＋特定参数选择；C01–C04 不能锁定/检查所有技术属性；本轮未测网站。 | 不将 extractors 列表长度当成功率，不将多平台编译配置当全平台验证。 |
| [PRODUCT_DIRECTION:7](../../PRODUCT_DIRECTION.md#L7) 没有 in-app Sniff workspace | B01–B03 已有扩展 page sniffing，区别在入口/工作台。 | 不能写“v-download 没嗅探”；是否新增 in-app workspace 由真实需求决定。 |

[README:54](../../../README.md#L54) 自己明确没有可复现启动/CPU/内存/数据库基准。第 7 节补充的是独立实例的自有小夹具 warm 流程与采样资源估计，仍没有双方等价任务的完整 cold/warm 性能基准。所有性能提议需实测完整等价任务，区分冷/热启动与缓存；记录进程家族 CPU、峰值内存、完成耗时、失败/重试、用户交互数，agent 流程另记 tokens/上下文。

## 5. 已审阅测试的证据强度

全部只读，未运行；以下“覆盖”指代码中有相应断言，不表示本轮通过。

| 测试入口 | 已有断言/方法 | 尚不能建立的证明 |
|---|---|---|
| [test-grouped-queue-scheduler.ts:7](../../../scripts/test-grouped-queue-scheduler.ts#L7) | 纯 admission planner，明确理论 12、独立池和顺序。 | 实际子进程资源、pause race、超时后清理和网络限流。 |
| [test-session-recover.ts:5](../../../scripts/test-session-recover.ts#L5) | 状态集合→recoveredIds、payload parser。 | 未覆盖 banner 使用 recoveredIds 的消费者→IPC→main 筛选，因而没有捕获第 7.9 节的范围丢失；也不能证明 kill 后数据库/媒体残留或字节断点恢复。 |
| [test-foundation.ts:6](../../../scripts/test-foundation.ts#L6) | 真实 in-memory SQLite migration/idempotence。 | 持久盘断电/锁竞争、完整下载管理器与文件发布协议。 |
| [formatDialogPresentation.test.ts:7](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/renderer/src/components/formatDialogPresentation.test.ts#L7) | 候选推荐/去重/大小/label；autoStart prompt。 | 行选择到最终 argv/实际输出、showFormatDialog 偏好消费者、HDR/fps/音轨。 |
| [test-ytdlp-provider-argv.ts:10](../../../scripts/test-ytdlp-provider-argv.ts#L10) | 源码 regex 与 helper argv/template 断言。 | 真实 yt-dlp 对当前网站有效、格式合同或最终输出正确。 |
| [test-transcode.ts:9](../../../scripts/test-transcode.ts#L9) | preset 数量、参数、文件名冲突规则。 | FFmpeg 真实编码、音视频完整性、进度、取消/磁盘满/保留原件。 |
| [test-native-auth.ts:8](../../../scripts/test-native-auth.ts#L8) | host/domain/cookie shape 模型。 | 真浏览器登录、会话有效性、Keychain/backend 生命周期。 |
| [test-engine-manager.ts:9](../../../scripts/test-engine-manager.ts#L9) | 版本、digest、偏好路径模型。 | 真实下载/校验/执行/回滚事务和实际发行 provider。 |
| [test-updater-contract.ts:5](../../../scripts/test-updater-contract.ts#L5) | 源码合同（配置/packaged/HTTPS/redaction）。 | 已发布 app 自动检查、下载安装、退出安装、真实签名/Gatekeeper。 |
| [test-extension-download.js:8](../../../scripts/test-extension-download.js#L8)、[test-extension-media.js:7](../../../scripts/test-extension-media.js#L7) | transport retry/category、media/placement helpers 与合成 DOM/VM 边界。 | Chrome MV3 lifecycle、真实 iframe/SPA 嗅探、已安装扩展配对/冷启动/网站变化。 |
| [test-info-resolution-contract.ts:11](../../../scripts/test-info-resolution-contract.ts#L11) | renderer/manager 中关键标识源码断言。 | 解析取消/timeout 真正释放 hidden browser、调用链保留用户选择。 |

对 `scripts/` 及 source `*test*` 搜索 `downloadDirectMediaWithFfmpeg/validateOutput/transcodeFile/loadFromDbAndRecover/publishStagedFile/tryAdoptExistingYtdlpOutput`，未找到对应生产下载/发布函数的直接运行型覆盖；当前结果不能排除动态导入、其他命名的集成测试或仓库外验证。不要删除既有模型测试来制造“更少测试”；新增应优先实际 UI/IPC 或生产边界、保留取消/容量/权限/清理/身份异常。

## 6. 搜索边界、未知与实测准备

- 字幕/章节/SponsorBlock/定时下载/watch-folder：本轮搜索 `src/`、`extension/`、settings/renderer types、DownloadOptions、生成 argv，未发现产品接口与实调用；`subtitle` 命中的是设置卡片副标题。未审计所有二进制/上游 yt-dlp 隐藏能力，因此结论只限产品暴露面。
- Safari/Firefox：当前扩展目录只有 Chrome MV3 manifest；`cookiesBrowser.ts` 可映射浏览器名不等于有对应扩展；`appMenu` 的通用 services role 不等于实现了专门下载 Service。未发现 NSUserActivity、AppleScript、Shortcuts 产品桥接。先列“未发现”，由正式分发/实测资料补足，不做绝对不存在判断。
- 多站成功率、完整 UI 视觉/可访问性、性能排序、网络隐私、发行签名/公证、updater 真实 feed 仍需运行或外部证据；代码不能独自证明这些。第 7 节仅建立自有小样本的具体流选择/画质/重连行为，不替代广泛验证。
- 隔离研究不能直接运行 `make dev` 后以为安全：现有启动脚本先做 Electron install/preflight；数据库在导入模块时固定 app userData。[dev.mjs:46](../../../scripts/dev.mjs#L46)、[database.ts:9](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/database.ts#L9)
- 推荐研究 bootstrap 在加载 main **之前**设置独立 userData/sessionData 与独立下载/临时目录；不继承 updater feed；不接现有浏览器扩展。非 canonical profile 已跳过旧 Keychain 迁移/登录项/协议注册：[profilePaths.ts:18](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/profilePaths.ts#L18)、[nativeAuth.ts:112](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/nativeAuth.ts#L112)、[index.ts:430](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/index.ts#L430)。先断言真实 paths，再研究样本。
- localhost 扩展服务仍固定 18765；正常实例运行时不能隔离并行扩展实测。Remote API 默认关闭/18766 可配置，PO token 按需随机 loopback port。不能为研究自动退出用户实例。[localServer.ts:466](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/localServer.ts#L466)、[settings.ts:199](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/settings.ts#L199)、[poTokenServer.ts:44](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/poTokenServer.ts#L44)
- 即便 app userData 独立，Douyin/Bilibili 仍可能读系统浏览器凭据；公开匿名小样本优先 YouTube/MP4/HLS，认证研究另用明确的隔离浏览器/OS 环境，并记录认证来源。未经隔离不把公开 URL 当作无凭据执行的证明。

此文件仅提供 V-Download 侧证据。Downie 本机 4.7.27 的静态/GUI/样本证据及新版官方资料应单独保留版本、来源和证据类型，再进行同任务比较；不得用其 marketing claim 代替双方实测。

## 7. 自有夹具运行证据复核：字幕、画质与复用归因

本节仅读研究主执行者生成的证据：`/Users/mingjie/Documents/github/personal-projects/v-download-research/downie-2026-10-15/runtime`。来源为真实安装包 `app.asar` 的 main entry，经同版本 Electron 43.7.5 的 scratch bootstrap 启动；`isPackaged=false`，独立 userData/session/temp/downloads。[v-runtime-identity.json:35](assets/research-archive-2026-10-16/downie-2026-10-15/runtime/v-runtime-identity.json#L35)、[v-bootstrap.cjs:5](assets/research-archive-2026-10-16/downie-2026-10-15/runtime/v-bootstrap.cjs#L5)。这建立生产应用代码/引擎的运行证据，但不代表 packaged updater、协议注册、签名、公证或正式浏览器扩展链路已经验证。

### 7.1 字幕丢失是 direct-remux 的流选择合同缺口

- **输入 M**：[sample-manifest.json:332](assets/research-archive-2026-10-16/downie-2026-10-15/runtime/fixtures/sample-manifest.json#L332) 为 12 秒、1280×720 H.264＋AAC，额外包含 mov_text subtitle 与 3 个 4 秒章节；[build_samples.py:66](assets/research-archive-2026-10-16/downie-2026-10-15/runtime/fixtures/build_samples.py#L66) 明确映射英文字幕并设 `language=eng`。自有合成素材，不涉及用户/网站版权或登录内容。
- **运行/输出 M**：v-startup.log:80（临时调试产物已于 2026-10-15 清理） 证明 annotated 对应 task `ae0a5a2d…` 走 FFmpeg；[annotated.json:93](assets/research-archive-2026-10-16/downie-2026-10-15/runtime/bench-results/annotated.json#L93) 的完整 probe 只剩 video/audio/data，没有 subtitle codec_type；[annotated.json:252](assets/research-archive-2026-10-16/downie-2026-10-15/runtime/bench-results/annotated.json#L252) 保留 Opening/Middle/Closing 3 章节。API 最终仍 complete，输出 2,908,978 bytes、12 秒。
- **精确生产边界 C/D**：[downloadManager.ts:2459](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L2459) 只传 url/output/mediaType/format/referer/headers/proxy/duration；[ffmpegDownload.ts:286](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/ffmpegDownload.ts#L286) 在 `-i` 后仅为 MP4 加 `-c copy -movflags +faststart`，随后 `-f mp4`，没有 `-map` 或明确字幕映射/codec。它没有要求“保留本输入字幕”。FFmpeg 的 codec copy 与 stream selection 是不同阶段，未 map 时由输出容器/默认流选择决定；`-c copy` 不能当作全轨保存保证。[FFmpeg 官方 Stream selection / handling](https://www.ffmpeg.org/ffmpeg.html#Stream-selection)
- **为什么未报错 C**：[ffmpegDownload.ts:372](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/ffmpegDownload.ts#L372) 只 probe `stream=codec_type`，再在 [ffmpegDownload.ts:469](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/ffmpegDownload.ts#L469) 确认至少含期望 video 或 audio；不与输入轨数、subtitle、language 或章节列表比较。因此“视频可读”通过，而“保留字幕”没有被检查。
- **准确结论**：本夹具证明 direct MP4 remux 会丢本例已有 mov_text 字幕；同时章节确实保留，不能写成全 metadata/chapters 丢失。bin_data/SubtitleHandler 不等于仍有 mov_text subtitle stream；以 codec_type/codec_name 与章节分开核对。暂未验证其他字幕 codec、多个音轨和 yt-dlp 页面路径，不作外推。
- **改进/验收**：I03/I07 除额外抓字幕外，应先为已有轨道定义保留/选择/兼容性 policy；明确映射请求的 video/audio/subtitle，不能无条件 `-map 0` 把未知 data/attachment 一起带入不兼容容器。以该 fixture 验证字幕轨/语言保留、3 章节不丢、声音/时长正常，选择丢弃时明确告知。

### 7.2 已选 360p 却输出 720p：本次是 yt-dlp direct 分支

主执行者通过真实 UI 将研究实例默认质量从 720p 改为 360p，并确认设置落盘；独立新 Remote Job 仍把同时提供 720p/360p 的 HLS master 输出为 1280×720。master.m3u8:4（临时调试产物已于 2026-10-15 清理）、[hls-request-360.json:115](assets/research-archive-2026-10-16/downie-2026-10-15/runtime/bench-results/hls-request-360.json#L115)

**归因不能写错**：v-startup.log:170（临时调试产物已于 2026-10-15 清理） 的 `a61002f6…` 是 `[runTask] started`（yt-dlp 路径），不是 `[runTask] ffmpeg`；该任务 samples 也记录真实 yt-dlp 进程。Auto HLS 在 [downloadManager.ts:2448](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L2448) 排除 FFmpeg-first；进入 [ytdlp.ts:955](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/ytdlp.ts#L955) 的 direct-media 分支后，HLS 用 `formatStr='best'`，没有把数值 quality 用到 variant selector。因此这是 **adapter 已收到/可得到质量目标却未执行** 的实证，独立于 FormatDialog 丢 format_id 的生产者缺口。FFmpeg direct 无 quality 输入是另一个已确认源码缺口，需要单独实测其 adaptive 情形。

### 7.3 disconnect 的 0.12 秒：23 次连续 Range 获取，未复用旧产物

**不是靠时长猜测。** [disconnect.json:5](assets/research-archive-2026-10-16/downie-2026-10-15/runtime/bench-results/disconnect.json#L5) 记录 0.12 秒、complete、12 秒完整视频。对照三层证据：

1. **服务器 M**：[server-requests.jsonl:144](assets/research-archive-2026-10-16/downie-2026-10-15/runtime/fixtures/server-requests.jsonl#L144) 至第 166 行为 23 次 `/disconnect.mp4`、HTTP 206，Range offset 连续 `0,131072,262144,…,2883584`；前 22 次各传 131,072 bytes，最后传 24,538 bytes，总计 **2,908,122 bytes**，连续覆盖字节 `0..2908121`，恰好完整源文件长度。请求开始/最后完成为 `07:23:09.060641–07:23:09.078565 UTC`，约 **17.924ms**。这些时间是服务器记录，不能直接当完整任务时间。
2. **故障真实性 C/M**：[serve_fixtures.py:107](assets/research-archive-2026-10-16/downie-2026-10-15/runtime/fixtures/serve_fixtures.py#L107) 正确处理 Range 并声明剩余 Content-Length；[serve_fixtures.py:153](assets/research-archive-2026-10-16/downie-2026-10-15/runtime/fixtures/serve_fixtures.py#L153) 每次最多发 131,072 bytes 后关闭连接。服务器 `intentional_disconnect=true` 与连续后移 offset 证实客户端下载后的范围恢复。
3. **应用 C/M**：v-startup.log:159（临时调试产物已于 2026-10-15 清理） 证明该 task `88f51ef0…` 运行 FFmpeg；生产参数含 `-reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5 -reconnect_max_retries 2`。[ffmpegDownload.ts:262](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/ffmpegDownload.ts#L262) 本例证明运行中传输重连有效；不能把参数 max_retries=2 解释成整任务只有两个额外 HTTP 请求，实际有 23 次。计数重置的底层细节未审该二进制对应源码，不凭参数名推断。

**去重复用排除 C/M**：driver 每次 POST 创建新 job：[bench-v.py:52](assets/research-archive-2026-10-16/downie-2026-10-15/runtime/bench-v.py#L52)；Remote Job 分配新 ID/独立输出目录，[remoteJobService.ts:359](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/remoteJobService.ts#L359)，addTask 明确 `forceNew:true`，[remoteJobService.ts:295](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/remoteJobService.ts#L295)。direct mediaType 还跳过已有 yt-dlp 文件收养条件，[downloadManager.ts:2431](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L2431)。`/disconnect.mp4` 与 `/direct.mp4` 路径不同，URL canonicalizer 不把它们合并。当前 task 确实发了完整新网络数据，所以同样输出哈希也不能据此说是缓存复用。

只读重算：disconnect 与 direct-1/2/3 remux 输出 SHA-256 均为 `d48a95ca49de5d6520ee2e57093e51716b7a32f344e0f82131da0a6b95e2c5b8`；源 `sample-720.mp4` SHA-256 为 `644677695f2da8aa3137b31244ac82fdfc6934b9f30766371c29d950a2d322bf`。同输入经同 remux 输出相同本身很正常，关键归因证据是新 job、新目录、实际完整 Range 数据，而不是最终哈希。

**结论界限**：这是本地服务、可按 byte Range 恢复的渐进 MP4、同一次活动下载内部的重连；不是暂停/重开 app 后续传，也不能证明所有远端/CDN/非 seekable/live 流都能恢复。视频播放时长 12 秒不要求下载耗时 12 秒，尤其 loopback 小文件没有实时限速。

### 7.4 重复 benchmark 没有被 admission 去重短路，但全部是 warm app 流程

按每个 benchmark 开始到下一个 benchmark 开始的非重叠窗口，将请求日志与 driver input_url 对齐：

| Benchmark | 服务器请求行 | 请求次数 | 实际 body bytes sent |
|---|---|---:|---:|
| direct-1 / direct-2 / direct-3 | 4 / 5 / 6 | 每轮 1 | 每轮 2,908,122 |
| hls-1 / hls-2 / hls-3 | 7–26 / 27–46 / 47–66 | 每轮 20 | 每轮 6,062,830 |
| dash-1 / dash-2 / dash-3 | 67–84 / 85–102 / 103–120 | 每轮 18 | 每轮 3,061,150 |

三轮各有不同 job ID 和 task ID/输出目录；服务器真实收到各轮独立媒体请求，未发现旧任务复用。这证明完整重新获取，不代表 cold cache；HLS 的多次列表/探测/媒体请求合计也提醒必须计整个任务流量。

[bench-v.py:79](assets/research-archive-2026-10-16/downie-2026-10-15/runtime/bench-v.py#L79) 反复同 URL 不附 nonce，但 Remote Job 的 forceNew＋独立目录与请求日志已足以排除本轮去重短路。若将来改走普通桌面入队，不能沿用此结论，必须重新验证 I06 和“Download again”行为。

测量解释：[bench-v.py:39](assets/research-archive-2026-10-16/downie-2026-10-15/runtime/bench-v.py#L39) 先让 sampler 运行约 150ms，随后才在 [bench-v.py:55](assets/research-archive-2026-10-16/downie-2026-10-15/runtime/bench-v.py#L55) 开始 monotonic 任务计时；`started_epoch` 在 sampler 前记录，不能直接用 `started_epoch + elapsed_s` 作为精确结束 epoch。API 终态每 100ms 轮询，0.11/0.12 秒接近一个轮询周期，不能当亚毫秒精确延迟；外部结果 probe/写 JSON 不计入该 elapsed。应用已在运行，不能把第 1 次 direct 当冷启动。

资源采样是 100ms 聚合 RSS 与观测 CPU，短寿命引擎可能完全错过；disconnect 只有 3 个样本且未捕获 FFmpeg 峰值。应标“观测下界/估计”，RSS 非唯一/私有内存，进程共享页可能重复计算；不能据此声称完整引擎峰值内存或与 Downie 成立公平性能排序。[disconnect.json:76](assets/research-archive-2026-10-16/downie-2026-10-15/runtime/bench-results/disconnect.json#L76)

### 7.5 FFmpeg 直链暂停/恢复：18% 后从 byte 0 重下

**M**：[slow-pause-resume.json:5](assets/research-archive-2026-10-16/downie-2026-10-15/runtime/bench-results/slow-pause-resume.json#L5) 总任务耗时 124.8744 秒、最后 complete。它包含操作者暂停/等待/恢复，不能作为单次纯传输耗时或与竞品速度排名。主执行者真实 UI 暂停截图 [v-paused.png](assets/downie-2026-10-15/v-paused.png) 显示 18%；v-startup.log:177（临时调试产物已于 2026-10-15 清理） 与第 183 行证明 task `743b2974…` 两次都走 FFmpeg，中间 retryTask status=paused。

请求归因明确排除早先 cancel-slow 的 114,688 bytes（日志第 167 行）：

| 本轮阶段 | 精确请求证据 | 字节行为 |
|---|---|---|
| 暂停前 | [server-requests.jsonl:188](assets/research-archive-2026-10-16/downie-2026-10-15/runtime/fixtures/server-requests.jsonl#L188)，`07:27:58.654309–07:28:17.213783 UTC` | Range=`bytes=0-`，发送 **598,016 bytes** 后 client_disconnected。 |
| 恢复后 | [server-requests.jsonl:189](assets/research-archive-2026-10-16/downie-2026-10-15/runtime/fixtures/server-requests.jsonl#L189)，`07:28:33.461044–07:30:03.313151 UTC` | 新 Range 仍为 **`bytes=0-`**，完整发送 **2,908,122 bytes**。不是从 598,016 接续；两阶段合计传输 3,506,138 bytes。 |

**C/D 与观察相吻合**：pauseTask 标 paused＋取消进程；FFmpeg cancel close 分支删除 stagedPartPath（[downloadManager.ts:2496](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L2496)），retry 保留 task.progress（[downloadManager.ts:3574](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L3574)）；新 tick 用 `max(reported, previous)` 防回退（[downloadManager.ts:957](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L957)），因此 UI 起始仍显示 18%，实际网络重新从零开始。该行为与第 7.3 节**同一运行中的 Range 重连**不同，不能混为一种续传保证。

附带接口事实：Remote API 在暂停区间显示 status=queued/progress18（[slow-pause-resume.json:341](assets/research-archive-2026-10-16/downie-2026-10-15/runtime/bench-results/slow-pause-resume.json#L341)），恢复后显示 downloading/progress18（第 357 行）。这由 [remoteJobModel.ts:129](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/remoteJobModel.ts#L129) 未表达 paused、落入默认 queued 导出，不应把 API 的 queued 当作它没有暂停或偷偷重新开始的证据。I08/I12 应让真实状态与能力跨入口保留。

### 7.6 ask-before 偏好失效已由真实 UI 路径复现

主执行者在研究实例 General 中关闭“下载前询问”，CUA 读取 Value=0，研究设置持久化 showFormatDialog=false。再粘贴此前未测 `/watch/dash`，格式对话框仍出现。证据：[v-ask-disabled.png](assets/downie-2026-10-15/v-ask-disabled.png)、[v-dialog-despite-ask-off.png](assets/downie-2026-10-15/v-dialog-despite-ask-off.png)、[ui-audio-result.json:92](assets/research-archive-2026-10-16/downie-2026-10-15/runtime/ui-audio-result.json#L92)。这将 A07/I02 从静态高置信缺口升级为此版本的**运行观察＋源码归因**；不是重复旧 task、旧 ready result 或扩展 autoStart 的测试。

### 7.7 MP3 下载成功，但 UI 仍报“视频·360”：事件合同两端都漏字段

**观察 M，先与归因分开**：真实 Audio tab 显示“128 kbps MP3”，点击后 task `2c663f66-e299-4264-9696-5db553a76e50` 的 DB 观察为 format=mp3、quality=128、complete，路径 `Local synthetic download fixture (1) [dash-1].mp3`。[v-audio-format.png](assets/downie-2026-10-15/v-audio-format.png)、[format-dialog-task-observation.json:2](assets/research-archive-2026-10-16/downie-2026-10-15/runtime/format-dialog-task-observation.json#L2)

实际 ffprobe 为 MP3 单音轨、12.010667 秒、stream bit_rate=72,908 / format bit_rate=73,230 bit/s。[ui-audio-result.json:25](assets/research-archive-2026-10-16/downie-2026-10-15/runtime/ui-audio-result.json#L25) 这与生产 `--audio-quality 0` VBR 合同相符，证明标签不是明确的 128kbps 输出目标；**不能把该平均码率当作音质较差的证据**，尤其源是单声道合成正弦音。

稳定后 CUA/screenshot 同一行与 Inspector 仍显示“视频·360”，但 Inspector 文件名为相同 `[dash-1].mp3`。[v-audio-label-mismatch.png](assets/downie-2026-10-15/v-audio-label-mismatch.png) 本补充已实际查看该截图；它确实同时含旧格式/质量与新 `.mp3` 路径，不只是 parent 的口述。task ID/唯一输出路径由 DB 观察对应；截图不独自暴露 ID，故用两者联合定位。

**精确归因 C/D**：

1. **main 已更新事实**：[promoteInfoResolveTask:1992](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L1992) 把 format/quality 写 DB；随后 [downloadManager.ts:2018](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L2018) 重读 updated、taskFromRecord 正确取 r.format/r.quality（[downloadManager.ts:922](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L922)），并发 emitProgress。不是证据支持的“main 一直保存 video360”。
2. **传输生产者漏事实**：[slimProgressPayload:991](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L991) 无论 queued/start/complete 都不发送 format、quality（url 也不在此 payload）。promotion 没有另发结构化 task-changed/snapshot 事件，只把同 ID task 当普通进度更新。
3. **renderer 消费者也漏事实**：[progressPatchFromIpc:40](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/renderer/src/hooks/useDownloads.ts#L40) 只消费 status/progress/path/title 等，不会合并 format/quality，即便生产端单独加字段也仍不够。普通 progress 分支只 merge，不自动全列表 refresh（[useDownloads.ts:233](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/renderer/src/hooks/useDownloads.ts#L233)）。
4. **初始化快照保留旧值**：resolver 占位 task 初始 format=video、quality=当时默认360；`new-download` 把它放入 renderer cache，之后 promotion 返回的完整 task 在 [App.tsx:414](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/renderer/src/App.tsx#L414) 只检查 error，没有交给 useDownloads 更新；`onNewDownload` 也对已有 ID 直接保留 prev（[useDownloads.ts:248](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/renderer/src/hooks/useDownloads.ts#L248)）。
5. **展示只是如实读取陈旧 cache**：row 由 [DownloadItem.tsx:28](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/renderer/src/components/DownloadItem.tsx#L28) 的 format/quality 拼标签，Inspector 由 [DownloadInspector.tsx:138](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/renderer/src/components/DownloadInspector.tsx#L138) 同源拼标签；path/status 正常 merge，所以出现“完成的.mp3＋旧 video360”组合。2 秒 reconciliation 仅有 resolving/ready 时启用（[useDownloads.ts:280](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/renderer/src/hooks/useDownloads.ts#L280)），任务完成后单纯等待不会保证纠正。

**结构性修复建议，不在本次实施**：明确“细粒度进度”和“任务规范/状态转变”的拥有者与合同；promotion 发包含可变任务字段的 typed patch/快照，renderer 用相同合同更新同 ID。不能只改 label、根据扩展名反推格式，或给每个完成事件增加 get-all 兜底。验收从 resolver→选择MP3/128→queued→complete，不手动刷新便使 row/Inspector/持久化/实际输出一致；再测 MP4 720→360、不同来源 URL promotion、热重载/事件乱序，保留进度瘦 payload 的性能收益。后续正常退出并重开同一研究 profile 后，[v-relaunch-ax.txt:45](assets/research-archive-2026-10-16/downie-2026-10-15/runtime/v-relaunch-ax.txt#L45) 已显示该唯一标题任务为“mp3 · 128 已完成”，因此新启动重建快照后标签正确是运行观察；普通手动 refresh 按源码应有同样效果，但本补充未操控 UI 验证该动作。

### 7.8 无输出权限：提交失败未入队，错误分类过粗

主执行者临时模拟研究输出目录无权限，随后已恢复权限。结果 [output-permission.json:6](assets/research-archive-2026-10-16/downie-2026-10-15/runtime/bench-results/output-permission.json#L6)：HTTP 500、`download_failed / Internal error`，没有 job ID、没有输出；不能把它计为“成功入队后失败/已回滚整个任务”的证明。

源码边界为 [createRemoteJob:365](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/remoteJobService.ts#L365) 在 job record 建立前 mkdirSync；[remoteApiHandler.ts:107](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/remoteApiHandler.ts#L107) 直接调用，异常由 [remoteApiHttp.ts:171](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/remoteApiHttp.ts#L171) 统一成 generic 500。它未把已知存储权限失败映射为可行动的 storage/permission 分类。建议纳入 I07/I09 的 owning boundary：保留权限/容量/创建失败原因及下一步，不泄露 credentials；验收 no-permission/磁盘满/目录已被文件占用时稳定分类且无僵尸 job，恢复后能重试。这里只证实提交边界失败，未验证下载中途磁盘满与文件清理。

### 7.9 正常退出后恢复：提示 1 项，实际连历史 3 个失败任务也重试

**观察 M**：主执行者在研究 PID 65309 创建 `/slow.mp4?case=v-relaunch`，开始下载后按 Cmd+Q，看到活动下载确认并选择退出；随后在新 PID 77744 以同一独立 profile 重开。这里是**正常退出/确认流程，不是 crash、SIGKILL 或断电测试**。新进程身份、安装包 renderer 与 profile 见 [startup-process-4b.json:4](assets/research-archive-2026-10-16/downie-2026-10-15/runtime/bench-results/startup-process-4b.json#L4)、[startup-process-4b.json:50](assets/research-archive-2026-10-16/downie-2026-10-15/runtime/bench-results/startup-process-4b.json#L50)；实际退出前传输持续约 26 秒，不能把“发起退出动作前的 2 秒”等同实际全传输时长。

- 重开 UI 显示“1 个下载已中断 / 全部继续”，对应 Direct media 行为“视频 · 360 已中断”，关注数为 5；另有 Big Buck Bunny、固定 403、404 三条失败和一条已取消。[v-relaunch-ax.txt:23](assets/research-archive-2026-10-16/downie-2026-10-15/runtime/v-relaunch-ax.txt#L23)、[v-relaunch-interrupted.png](assets/downie-2026-10-15/v-relaunch-interrupted.png)
- 同时旧 Remote Job `5163af85bd0bcb81` 仍可 GET（200），却导出 queued、progress27、error=null。[v-relaunch-observation.json:22](assets/research-archive-2026-10-16/downie-2026-10-15/runtime/v-relaunch-observation.json#L22) UI 与 API 不是两次不同恢复，而是 API 未保留 interrupted 的语义，具体边界见下表。
- 主执行者点击 banner“全部继续”后观察 4 条进入队列、关注数 5→1。应用日志独立确认：`9f86952a(error)`、`8c3d196f(error)`、`83ab833b(error)`、`7076e53a(interrupted)` 全部进入 retryTask，接着 queued=4；404/403 实际再次请求，Big Buck Bunny 再次启动 yt-dlp。v-startup-process-4b.log:20（临时调试产物已于 2026-10-15 清理）、v-startup-process-4b.log:51（临时调试产物已于 2026-10-15 清理）、[server-requests.jsonl:413](assets/research-archive-2026-10-16/downie-2026-10-15/runtime/fixtures/server-requests.jsonl#L413)。因此不是仅 AX 文案/临时渲染变化，确有额外历史任务执行。

| 生产边界 C；与观察相连后的归因 D | 精确来源 | 结论与限制 |
|---|---|---|
| 正常退出先确认，随后 stopActiveDownloads 取消并等待；下次启动将仍为 downloading 的记录标 interrupted。 | [index.ts:525](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/index.ts#L525)、[index.ts:597](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/index.ts#L597)、[downloadManager.ts:4153](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L4153)、[downloadManager.ts:4216](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L4216) | 本轮重建 1 条中断已实证；不能因此声称所有 crash 清理窗口都正确。 |
| main 保留 recoveredIds，并通过 session-interrupted 发 count＋ids。 | [index.ts:438](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/index.ts#L438)、[index.ts:323](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/index.ts#L323) | 目标身份在生产者处已经存在，不需要按整个历史列表重新猜测。 |
| banner handler 读 sessionInterrupted.ids，却只把 ids 传给 dismiss；执行的是通用 handleResumeAll。 | [App.tsx:543](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/renderer/src/App.tsx#L543)、[App.tsx:531](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/renderer/src/App.tsx#L531)、[App.tsx:945](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/renderer/src/App.tsx#L945) | 作用域在 renderer 消费者丢失，是提示 1 条却执行历史失败任务的直接接线原因。 |
| preload resume-all 没有 ids；IPC 直接调用 main resumeAll，查询全部 paused/interrupted/error 并逐条 retryTask。 | [preload/index.ts:57](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/preload/index.ts#L57)、[ipc/downloads.ts:425](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/ipc/downloads.ts#L425)、[downloadManager.ts:4208](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L4208)、[downloadManager.ts:3557](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L3557) | 本轮三条普通 error 均重新 queued；一般 resolver error 另有 resolving 分支，不能把所有重试永远称 queued。cancelled 被 bulk 查询排除，与本轮关注 5→1 相符；失败随后又出现时关注数也会回升。 |
| Remote Job deriveJobRecord 只特判 error/cancelled/complete/downloading/resolving，interrupted/paused 最终落到 queued；task.error 只在 error 分支分类。 | [remoteJobModel.ts:116](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/remoteJobModel.ts#L116)、[remoteJobModel.ts:134](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/remoteJobModel.ts#L134) | API queued、error=null 并不证明任务已恢复排队；信息在导出合同被压平，应保留需用户动作的状态/原因。 |

**恢复后的字节与完整性 M**：本轮 FFmpeg task `7076e53a…` 于 v-startup-process-4b.log:58（临时调试产物已于 2026-10-15 清理） 启动。服务器 [server-requests.jsonl:412](assets/research-archive-2026-10-16/downie-2026-10-15/runtime/fixtures/server-requests.jsonl#L412) 记退出前 `08:07:19.834237–08:07:46.209180 UTC`，Range=bytes=0-、851,968 bytes 后断开；[server-requests.jsonl:417](assets/research-archive-2026-10-16/downie-2026-10-15/runtime/fixtures/server-requests.jsonl#L417) 记恢复后 `08:08:29.779278–08:09:59.621348 UTC`，Range 仍 **bytes=0-**、完整发送 2,908,122 bytes，合计 **3,760,090 bytes**。请求日志不保留 query，但本轮独占的 slow 时间窗口、job 输入 URL 和 task 日志对齐；没有把早前 pause/cancel 的同 path 请求混入。

最终 [v-relaunch-outcome.json:5](assets/research-archive-2026-10-16/downie-2026-10-15/runtime/v-relaunch-outcome.json#L5) 为 complete，输出 2,908,122 bytes；[v-relaunch-outcome.json:998](assets/research-archive-2026-10-16/downie-2026-10-15/runtime/v-relaunch-outcome.json#L998) 的 ffprobe 有 H.264 1280×720 与 AAC，两流均 12 秒。它证明恢复后能完成，但本例**重新传输全部文件，不是跨进程 byte resume**。停止取消会触发 [downloadManager.ts:2500](https://github.com/wangm12/v-download/blob/a3d0bfbb444045e034b0fdfc611e4f2a9888c464/src/main/downloadManager.ts#L2500) 删除 FFmpeg staged part；retry 保留旧 progress 的行为与第 7.5 节相同。该结果的资源采样明确在点击继续之后较晚开始，漏初始下载、退出、启动和早期历史任务重试，不能用作完整重开任务性能基准。

**建议/验收**：I08 以明确的本次 recovered IDs 做 scoped resume，main 复核当前 status、返回 applied/skipped reasons，成功后再更新 banner；全局“继续暂停任务/重试失败任务”按明确命令处理。混合本次中断、历史中断、暂停、认证失败、固定 404、取消、完成的队列中，banner 只改变提示的 IDs；已被删除/另行恢复的 ID 应可解释地 skipped，不扩大目标。I12 同时让 API/MCP 区分 interrupted/paused/queued 及恢复能力。现有 session-recover 测试虽断言历史 interrupted 不在 recoveredIds 内，却未验证消费者是否把这些 IDs 用于动作，正是本次缺口；下一步应测真实 banner→IPC→main 筛选，而非再增加一个 classifier 单测。本补充只归因、提案，未改产品或控制实例。


清理说明：本报告的功能观察仍为当时结果；根据后续完整清理要求，已移除临时进程日志及合成媒体，保留结构化证据和截图。清单见 [安装验证与清理回执](installed-release-verification-2026-10-15.md)。
