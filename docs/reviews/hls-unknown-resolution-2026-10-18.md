# HLS 未知分辨率选流修复与验收

日期：2026-10-18（America/Los_Angeles）。范围：桌面下载链路；未修改扩展、IPC 或数据库结构。

## 根因与修复

原失败任务来自扩展捕获的 HLS media playlist，任务冻结为视频、1080p 上限，但没有新版本的 `downloadRequest` 快照。播放列表没有 `RESOLUTION`，yt-dlp 的格式元数据也没有 height。旧任务仍使用严格的 `[height<=1080]` 过滤器，因此在读取实际视频流之前就被判为“没有可用格式”。实际远程流探测为 H.264 1280×720、AAC。

在 `downloadManager.runTask` 的策略边界，把没有快照的旧自适应视频任务转换为现有统一选择策略：沿用任务自己的 quality、默认 MP4 输出意图，不读取当前默认清晰度替换历史意图。此策略同时传给引擎和最终产物校验，覆盖重试路径。普通网页下载、音频任务和已有精确方案保持原策略。

有数值上限的旧 HLS/DASH 视频任务先通过 FFprobe 读取实际流；确认没有符合条件的流时，在传输前失败。网络或 demux 探测失败与确定的选择不满足分别建模，前者可以交给下载引擎继续，但产物必须通过本地流校验才能发布。用户明确选择 FFmpeg 时复用其已有预探测，避免重复调用。

yt-dlp 可以保留 height 未知的候选供实际读取；这不等于取消上限。所有此类旧任务也执行 `prepareSelectedOutput`，例如 720p 源在 360p 上限下必须失败，不能静默改成 best、标为完成或把不合要求的文件发布到最终目录。

## 可复查验证

- `npm run typecheck`、完整 `npm test`、`npm run build`、`git diff --check` 通过。
- 新增可选桌面端测试 `npm run test:adaptive-e2e -- <报告路径>`，加载实际构建的 Electron 主进程、preload、renderer，调用正式 IPC handler、队列和真实引擎。测试配置与个人配置完全隔离；没有在个人历史中创建测试任务。
- 使用 6 秒 H.264/AAC、AES-128 HLS：360p 与 720p 的裸 media playlist 不包含 `RESOLUTION`；另有标注 360p/720p 的 master。服务器要求完整 Referer；manifest、密钥、分片请求全部通过，没有 403。
- 每个场景写入配置后读回，核实实际引擎；旧任务断言没有选择快照，显式方案断言存在快照。
- 12 个成功产物均经 FFprobe 校验视频高度、AAC、完整时长，并由 FFmpeg `-xerror` 完整解码；5 个失败场景均没有发布最终文件。

| 场景 | Auto | yt-dlp | FFmpeg |
| --- | --- | --- | --- |
| 未知 720p，1080p 上限 | 完成，720p | 完成，720p | 完成，720p |
| 未知 360p，360p 上限 | 完成，360p | 完成，360p | 完成，360p |
| 未知 720p，360p 上限 | 拒绝 | 拒绝 | 拒绝 |
| master 多档，360p 上限 | 完成，360p | 完成，360p | 完成，360p |

另验收 Auto：远程 FFprobe 故意不可用时，720p 在 1080p 上限下完成、在 360p 上限下最终校验拒绝；best 保留 720p；显式 360p 方案接受未知 360p、拒绝未知 720p。合计 17 个场景全部通过。

原始机器结果见 [controlled-e2e.json](assets/hls-unknown-resolution-2026-10-18/controlled-e2e.json)。其中地址均为合成的本地测试输入。单次场景耗时只用于定位功能行为，不构成性能基准。

## 安装版真实任务

已安装 `/Applications/V-Download.app`，arm64、1.1.7 / **build 1.1.11**。App 使用本机 Apple Development 签名、hardened runtime，`codesign --verify --deep --strict` 通过。DMG 校验、只读挂载后的包内签名检查通过；包内主进程与执行上述测试的构建逐字节相同。此交付仍是本地开发签名，没有公证或发布更新 feed。

在安装版原生界面点击原任务 Retry，任务身份保持不变，由 error 经 downloading 到 complete；界面确认 `1 Download · 1 Complete`。任务原有 URL、标题、format、quality=1080、创建时间、缩略图、channel、合集字段、selection key 均与安装前记录一致。最终输出位于用户原下载目录。

| 产物校验 | 实际结果 |
| --- | --- |
| 文件 | MP4，150,585,559 bytes |
| 视频 | H.264，1280×720 |
| 音频 | AAC，44.1 kHz，双声道 |
| 时长 | 1185.706054 秒；源 manifest 1185.667 秒 |
| 完整解码 | FFmpeg `-xerror`，退出 0，stderr 0 bytes |
| 输出身份 | 与原任务的目标文件一致；个人媒体哈希未纳入公开验收材料 |

这验证的是“1080p 上限允许实际 720p”，没有承诺把 720p 升频成 1080p。没有记录用户的资源 URL、签名参数、来源页面、标题或媒体截图。

安装前正常退出应用，完整 App 与用户数据备份到权限为 0700 的本机私有回滚目录（具体路径省略）。替换仅针对 App bundle；设置文件与备份 SHA-256 一致，现有用户指定 yt-dlp 2026.08.19、Homebrew FFmpeg 8.1 路径和字节均保留，没有切换为包内引擎。

安装与真实下载记录见 [installed-validation.json](assets/hls-unknown-resolution-2026-10-18/installed-validation.json)。签名本机包通过 SHA-256 与只读挂载验证；其机器专用文件路径和个人媒体哈希未纳入公开材料。已清理本次打包产生的临时目录、未签名中间 DMG/ZIP 和重复旧 App；保留回滚备份。

下载完成后的最终核对发现历史随后由 1 条变为 0 条，产物也不再位于下载目录。用户已明确确认“是，我清除了，保持现在这样”；此为用户主动清理，按其要求保留当前状态，不恢复任务或文件。数据库完整性仍为 ok，基线 290 个文件无缺失，276 个逐字节相同，14 个变化限于任务数据库、运行日志和 Chromium 缓存／存储日志。安装后的原任务已成功下载并完成产物验证，后续清理不影响该验收结果。

## 自审

- 根因在“历史输入没有统一选择策略”，修复该边界，没有在错误后增加不受限 best 重试。
- 引擎接受未知元数据与最终源约束共用同一策略，360p 由探测和发布前校验保护；没有通过转码缩放冒充源选流。
- 预探测复用原 URL、完整 Referer、请求头、代理和取消信号；新警告不记录含签名参数的探测错误。
- 没有数据库迁移、设置改写或扩展契约变化；旧任务原有 quality、目录和身份继续使用。
- 覆盖真实引擎与完整解码；未宣称所有无标注 master 都能选择最优档位，也未验证所有站点或 Windows/Linux。远程探测可能增加一次读取；CPU 和进程族内存未测量。

代码定位：策略统一在 [`downloadManager.ts`](../../src/main/downloadManager.ts) 的 `runTask`；探测失败阶段在 [`ffmpegDownload.ts`](../../src/main/ffmpegDownload.ts) 的 `probeAdaptiveVideoStreams`；最终约束复用 [`selectedOutput.ts`](../../src/main/selectedOutput.ts)；可复跑的端到端脚本为 [`test-adaptive-download-e2e.mjs`](../../scripts/test-adaptive-download-e2e.mjs)。自审未发现本次修复新增的代码阻断问题。

| 完成清单 | 结果 |
| --- | --- |
| 未知分辨率先探测、实际流校验 | 已完成 |
| 360p 约束回归、探测失败保护 | 已完成，17 个场景全部通过 |
| 原资源完整下载、产物与完整解码 | 已完成，安装版原任务成功 |
| 自审、类型检查、完整自动化测试 | 已完成 |
| 签名 DMG、Applications 安装与启动 | 已完成 |
| 原设置、引擎、完整回滚备份 | 已完成 |
| 后续历史／文件清空归因 | 已确认：用户主动清理，按要求不恢复 |
