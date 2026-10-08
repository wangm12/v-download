# V-Download 全量稳定性与平台审计报告

> **状态：生产实现、Astra 静态代码复审和 Astra 报告复审均已完成并获通过；30 分钟合成负载 soak 和本轮可执行 E2E 证据已记录。forced yt-dlp 对照仍未验证。** 实施按用户指定使用 `gpt-6-luna` / `max`，代码复审使用 `gpt-6-astra`。Astra 的实现静态复审早于最终 E2E；Astra 已在报告更新后完成 follow-up 报告复审。未执行或受环境限制的矩阵项不记作通过。

## 审查范围与结论边界

审查基线为 `b419018c69415129ee6dd49686e4d22f9054c9ed`（v1.1.7）。覆盖 extension、preload、shared contracts、main process、renderer、下载/解析/队列/存储、平台集成、构建和发布脚本、Electron/SQLite 运行时、清单与用户文档。所有实施变更均限于生产代码和文档；未新增或修改测试源码、测试框架或测试命令。本文引用的原始 E2E artifacts 位于 `/tmp/v-download-review-20260926.7ixhe0/artifacts/`。

原始 findings ledger 中有描述的 C1–C7、E1–E6、R1–R7、P1–P10、P12–P15 均已由 Astra 对应静态复审关闭；P11 在记录中缺失，后续 Q1、Q3–Q7 与 F1–F5 修复也已完成静态复核。该 ledger 是早期状态快照，仍含过期的 E2E pending 字段，不作为最终闭环表。macOS arm64 app 和 Ubuntu 容器对同一修复后 direct-media Auto fixture 均已通过；仍待验证的是 forced yt-dlp 对照、真实 Intel 主机、Ubuntu 完整桌面会话及 Apple 签名/公证等受环境限制项目。30 分钟合成负载 soak 已完成，但不代表活动网络下载或桌面稳定性；逐项证据见下文矩阵。

## 已关闭的主要发现与修复

**输出归属、删除与恢复（C1–C3，P1/P2）。** 原生 playlist、gallery、Douyin direct、普通 yt-dlp 和转码输出可能落在共享目录、丢失模板子目录，或在并发/崩溃重试时误认其他任务的文件。现在任务使用固定可信 output root、按任务 staging、冲突安全的目标路径和内部身份 manifest/journal；目录及文件以实际创建/发布的文件身份核对。删除不再根据 title 扫描共享目录猜文件，也不递归删除未经所有权证明的目录。发布失败或恢复时不把占位路径当成已拥有产物；受支持的旧单文件记录继续使用可信的精确 `file_path` 兼容删除，旧共享目录 playlist 不会被推测性清理。外部任务 metadata 不能伪造内部归属字段。Markdown note 使用 exclusive/no-clobber 创建并登记真实路径，避免覆盖或认领用户既有文件。Astra 复核覆盖了 native/ordinary 发布窗口、copy/hardlink 身份、转码、旧记录和 await 删除后的记录刷新。

这一设计以安全保留为优先：身份无法证明、权限不足或持久化超过安全上限时，会保留可定位任务并通过既有错误反馈说明；SIGKILL 若发生在文件 exclusive-create 成功、身份登记持久化之前，空文件可能被保守保留。manifest 有 4 MiB 上限，因此不能声称 10,000 项 native playlist 元数据已验证或无限可增长。

**子进程、取消和关闭（C4/C7，Q1）。** 下载、transcode、FFmpeg、yt-dlp 及其后处理后代、thumbnail、Douyin bulk、cookie helper、PO-token provider 等受管 child 统一经过 POSIX 父生命周期 launcher。取消会终止并等待进程组清理，再释放任务槽位或操作输出；watcher 与计时子进程在正常退出及父进程 EOF 路径收尾。旧进程关闭后不再对可能复用的 PGID 发信号。应用关闭集中停止 admission、等待任务/helper、冲刷 remote-job 状态，再关闭数据库。Q1 的 macOS Cmd+Q 实测最初发现 UI/服务已关但主 PID 残留；将最终 `app.quit()` 推迟到原生 quit dispatch 结束后，Astra 静态认可，Round 2 无调试端口的 arm64 包实测 PID 随 Cmd+Q 退出。最终轮活动下载期间 SIGKILL 的进程组清理与重启恢复通过；活动下载期间的优雅 Cmd+Q 仍未验证。

边界：POSIX macOS/Linux 可按进程组清理；Windows 当前只保证直接子进程，不能据此声称整棵后代树有同等保证。被 SIGKILL 后仍可见的 zombie/系统进程在有界等待后会记录失败；不会无限等待。用户启动的健康长下载没有任意总时长上限，取消与关闭才使用有界清理期限。

**Chrome 扩展与 MCP 生命周期（E1–E6）。** MV3 worker 重启后会恢复、校验并重发尚未确认的 Douyin profile/resolver 命令；内容脚本 READY 有界重试，重复同 request 的 active collector 不会重复启动，profile 队列会按 TTL 清理。extension request/result 以相同 payload 有界重试；桌面进程内的 receipt 不跨应用重启持久化。MCP stdio 默认 newline JSON，仍识别并按输入模式响应旧 Content-Length 客户端；HTTP/body deadline 覆盖响应体读取，EOF 等待已接受的 handler 并 drain stdout。Linux 默认配置读取使用真实小写 `v-download` profile，并保留 uppercase 兼容候选。macOS `/usr/bin/open` launcher 使用有界结果检查，真实浏览器 executable 则 detached 启动。

扩展缓存与导航状态补强包括：pairing/pending state 写入串行化、last-error 更新排序、响应体限时限量、media cache TTL 和 aggregate quota 限制、request/tab page URL 与 navigation epoch 的有界 session 恢复。可信完整页面 URL 才用于严格 frame 归属判断；冷启动事件会等待 hydration，不用空 URL 假定恢复成功；导航 tombstone 防止旧快照或迟到请求复活旧媒体。真实 Chrome worker 终止边界、SPA/iframe 竞态仍须按 E2E 矩阵验证。

**队列、UI、远端 API 与资源管理（R1–R7、P2–P5、Q3/Q5/Q6）。** 缩略图请求支持退订、无消费者时取消未开始工作、限制队列和并发，并修复 settlement 微任务期间迟到订阅者挂起。非成功或非图片 HTTP 响应会关闭 body；代理 dispatcher 使用有界缓存并在安全时 graceful close。引擎更新同引擎 coalesce，独立 staging 后校验再原子替换；设置写盘失败传播给既有 UI，回滚内存状态，yt-dlp path 版本缓存更新后失效。Remote API 端口冲突沿用现有 dialog 提示并按 endpoint 去重；历史 job 使用持久化的原输出 root。暂停/取消拒绝或 IPC 失败时显示现有错误提示并刷新权威队列，防止晚响应覆盖终态；队列 scroll 请求只消费一次，format dialog 按 resolver identity 隔离状态。

Q3 移除了 popup 在发送消息前无条件触发 `wake-sync.js` 的外部协议链接；popup 现在先把请求交给 background，由现有失败唤醒路径处理，避免热 app 时弹出协议确认。Q4 修复 FFmpeg 将 HLS-only `http_persistent` 误传给 MP4/DASH 的参数问题；`.part` 临时文件仍保留 ownership 语义，同时按最终扩展名显式指定 MP4/MP3 muxer。DASH 视频 selector 使用 `bestvideo+bestaudio/best`，音频使用 `bestaudio/best`。Q5 修复 directory identity 因持久化记录省略 size 而被错误判定超限的问题，没有放宽路径或所有权检查。Q6 将请求的 Markdown note 列为 Remote API artifact；note-only job 可经 `/file` 返回 Markdown，media job 的 `/file` 仍是主媒体，`/archive` 包含媒体及请求的 note。API 文档已与此契约同步。

**运行时、平台、安全与发布（P1、P6–P15）。** Electron 从 33 升级到 43.7.5，better-sqlite3 从 11 系列升级到 13.0.3；显式安装 Electron，按目标 `prebuilds/<platform>-<arch>.node` 运行 N-API ≥10 与实际 SQLite 查询验证，asar 包含目标 native prebuild。Node 要求为 `>=22.14.0 <23 || >=23.6.0`。macOS 最低版本设为 12.0，与已捆绑的 FFmpeg/ffprobe Mach-O 最低版本一致。Electron 43 的 macOS Notification `failed` 和同步 `show()` 错误会清理活动引用并记录诊断。

Linux engine manifest 修复 arm64 ffprobe 成员路径，并验证可执行文件身份和版本 banner；Linux 发布依赖在顶层 DEB `depends` 声明九个既有依赖及 `libgbm1`、`libasound2t64 | libasound2`。构建脚本在任何 engine mutation 前取得共享锁，锁状态不明时 fail closed，解锁后不递归删除共享 staging 根。release workflow 移除假扩展 ID，验证 ID 格式；notarytool 环境凭据按官方参数传入且不会写入错误日志。canonical-profile guard 保护 Login Items、Keychain 和协议 handler；临时 `--user-data-dir` 不会修改 canonical app 的 OS 全局状态。Cookie 数据仅在系统提供受保护的 safeStorage backend 时表述为 OS 加密；Linux 无密钥环时是 owner-only 文件权限保护，并非加密。

文档清理移除了没有依据的性能绝对值、WAL/静态二进制/零系统依赖承诺和静态“tests passing”徽章，并修正 nightly/tag 发布说明与运行时安装步骤。报告不把上传到 GitHub 等同于 Apple 签名、公证或 Gatekeeper 验证。

## 静态验证与测试结果

实现阶段通过 `npm ci`（Node v23.10.0/macOS arm64）、`npm run typecheck`、`npm run build`、生产 `.mjs` 的 `node --check`、JSON/YAML 解析和 `git diff --check`。SQLite 运行时 preflight 在 Electron 43.7.5 下选择 macOS arm64 prebuild 并执行 `SELECT 1`。Linux x64 engine fetch/verify 在 Ubuntu 22.04/Node 22.23.3 容器通过，校验 pinned hashes、架构/版本、FFmpeg 编码器、插件树、GPL notice 和 provider ping。完整依赖图的 `npm audit --json` 在锁文件 SHA-256 `2e5cf61918c73099cd49a97d1c36308b71363219b05a73afe6969ade00a02131` 对应快照中退出 0，报告 0 项漏洞；后续 lock 若有变化，应以最终锁文件和 audit 原始结果为准。

父任务独立运行了 51 个既有 `test:*` 脚本：**43 通过、8 失败**。没有改测试源码或命令。Astra 将 8 项归因为实现更新后的旧源码断言或生命周期契约变化，不是一次“全套测试通过”：

| 失败脚本 | 当前证据与边界 |
|---|---|
| `test:dev-native-preflight` | 断言旧 `electron-rebuild` 路径；测试在该断言处停止，后续 restore/native-path 断言未执行。 |
| `test:note-resolve` | 旧断言要求覆盖 `note.md`；生产逻辑改为 no-clobber 并返回实际 collision-safe 路径。 |
| `test:po-token` | 旧脚本在 `stop()` 后要求同实例重启；shutdown latch 现为永久关闭。后续 recovery 场景没有执行。 |
| `test:task-overrides` | 旧源码正则不匹配新实现形式；未证明运行时行为失败。 |
| `test:extension` | 断言旧 `maxAttempts = 3` 和 30 轮文本；新逻辑按绝对 deadline 有界重试。不是 Chrome E2E。 |
| `test:engines` | 源码正则期待旧 `assertVersion(await run(` 拼写；当前仍检查版本并额外检查可执行身份。匹配失败后的断言未运行。 |
| `test:mcp-stdio` | 旧测试仅接受 uppercase 配置路径；实现以真实 lowercase profile 优先并保留 uppercase fallback。 |
| `test:release-gates` | 在第 50 行旧锁诊断字符串处停止；PID reclaim、旧 native path 及后面的 `softprops` 断言未执行，不能称为通过或实测失败。 |

原始测试结果与日志：`/tmp/v-download-review-20260926.7ixhe0/artifacts/existing-tests-results-round5.json` 和同目录 `existing-tests/`。最终测试源码完整性记录：`test-source-integrity-final.json`。

## 当前已有隔离 E2E 证据

以下是有原始记录的**部分场景通过**，不是最终完整验收：

- macOS arm64 与 x64 release 包曾成功生成并验证包内 N-API target 架构；x64 没有真实 Intel 硬件执行证据。arm64 隔离 profile 首次启动、engine Ready、设置持久化和重启后跳过 onboarding 均有记录。
- Chrome for Testing 加载打包 extension，页面 MP4 被检测；HLS/MSE 示例中 popup/overlay 候选正确，未混入其他 tab 的媒体。Cookie sync landing 完成，隔离空 Chrome profile 回报同步 0 cookies。
- Q1 `setImmediate` 修复之后，round2 arm64 无调试参数 Cmd+Q 后 main PID 消失。最终轮另行验证了活动主输出 FFmpeg 时对 app 做 SIGKILL 后重启恢复；活动下载期间的优雅 Cmd+Q 路径仍未单独验证。
- Q3 热 popup 实测 `Sent 1/1`，没有系统协议确认弹窗；重复 URL 指向已有任务并显示 Already downloaded，新的 extension-video task 完成且产物 hash 匹配 fixture。
- 本地 native playlist fixture 下载出两个 MP4 和 note；队列重复 admission、pause/resume/cancel、retry 后完成有效 12 秒 H.264/AAC 文件。一次重试的首个临时 HTTP server EOF 属于 fixture server 生命周期，后续 PTY server 运行完成。
- 一条公开 YouTube 视频下载完成。另两条旧视频/playlist 有不可用或 HTTP 403 结果，不能外推为 YouTube 全面可用/不可用。
- MCP Inspector 2.8.0 的 stdio health、HTTP initialize/health/list/get/files 和确认写入后的 enqueue 完成；混合 newline/Content-Length 输入、EOF 等待和健康响应退出 0。活动 MCP cancel、终态 REST cancel 冲突、未完成文件读取和路径穿越检查也有对应响应记录。
- Remote API 端口冲突显示端口错误提示，恢复空闲端口后 health 与 extension pairing ping 返回成功。设置目录不可写的 EACCES 在 Preferences 显示保存失败并恢复 toggle 状态。

早期 round4 暴露了 FFmpeg 对 MP4/DASH 发送不支持的 HLS 选项、DASH selector 不适配音视频分离、两图 gallery ownership 被 size 字段误拒绝、Remote API archive 漏掉 requested Markdown note 等问题。修复前证据保留在 `remote-media-round4-{enqueue,status}.json`、`remote-hls-dash-{enqueue,status}.json`、`extension-gallery-playlist-round4.json` 和 `mac-app-runtime-round4.log`；本轮验证结果见下方矩阵。

## 最终静态复审与轮次问题闭环

Astra 对最终实现和跨模块调用链完成独立复审，F1–F5、Q7 均静态关闭；修订后没有未处理的静态阻断项。静态关闭与运行时验证分开记录，未覆盖的压力边界仍保留在下方限制中。

| ID / 严重度 | 根因与修复 | 代码位置与 Astra 结论 | 本轮运行证据 |
|---|---|---|---|
| F1 / P1 | yt-dlp 的 `after_move` 行可能跨 stdout/stderr chunk，旧实现逐 chunk 解析会漏掉长 playlist 超出保留日志窗口的输出，之后 staging cleanup 会删掉未发布文件。现在 stdout/stderr 分别使用 UTF-8 解码器和有界行缓冲；处理 CRLF、chunk 边界、退出 flush 和超长尾段。 | `src/main/ytdlp.ts`；Astra 复核跨 chunk / CRLF / flush 后静态通过。 | 两项 playlist 发布通过；超长到日志保留窗口外的 playlist 未单独做压力 E2E。 |
| Q7 / P1 | resolver 已确认多个 webpage entries 时仍走单输出发布路径，且 staging cleanup 可能静默删掉 ordinary task 的额外输出。现由 resolver-confirmed entry count 选择安全多输出发布，保持普通单输出行为；发布映射在恢复后仍可重建。 | `src/main/remoteResolveTask.ts`、`src/main/remoteJobService.ts`、`src/main/downloadManager.ts`；Astra 静态通过。 | Remote API 两视频 playlist 完成，ZIP 两项齐全、CRC 正确，两文件完整解码退出 0。见 `final-q7-remote-job.json`、`final-q7-media-verification.json`。 |
| F2 / P2 | API 以 basename 去重会丢掉不同子目录内的同名文件，basename 查找也会让 `/files/:name` 不稳定。现在同一 job 的 API 文件名唯一、安全且稳定；文件名截断按 UTF-8 byte 限制，保留扩展名与唯一后缀；归档先单次 walk 建映射，避免 N 个文件重复全树扫描。 | `src/main/remoteJobService.ts`；保留 Remote API 协议，Astra 静态通过。 | 两个 `clip.mp4` 得到不同 API 名称；单文件路由各返回 755,034 B，SHA-256 可核对；ZIP 含两个成员且 CRC 通过。见 `final-q7-duplicate-basename.json`。 |
| F3 / P1 | 对不支持 Range 的 HTTP 源读取非 faststart MP4 时，FFmpeg 曾以 exit 0 发布大于最小阈值的损坏 AAC-only 文件，job/API/DB 因而误报 complete。渐进式 HTTP（包括 direct-media synthetic resolver）现在把 FFmpeg 输入/复用错误视为失败并让 auto 路径 fallback；结束后用限时、限输出的 `ffprobe` JSON 检查所需音频/视频 stream，音频意图按 `mediaType` 识别。HLS/DASH/live 沿用单独容错。 | `src/main/ffmpegDownload.ts`、`src/main/downloadManager.ts`、`src/main/remoteResolveTask.ts`；Astra 复核 `streams[].codec_type` JSON 解析、64 KiB 输出上限、15 秒 deadline 和取消/settle guard 后静态通过。 | 同一 non-faststart/non-Range fixture 的最终 Auto 路径在 macOS arm64、Ubuntu 22.04 Docker 和 Ubuntu 24.04 Docker 均输出 134,888 B，SHA-256 `78004bb9160e1b0dc0b98cf7a0e393e8f3703631220e055d3fe74399c6dbb048`，H.264/AAC、3.000 s，全片 decode exit 0。Ubuntu 结果来自容器交互运行记录/控制台结果，没有单独保存 JSON artifact。round5 的旧损坏样本 decode exit 183 保留作修复前证据；forced yt-dlp comparator 仍待验证。 |
| F4 / P2 | overlay item idle 后从 `motionCandidates` 移除，播放器尺寸/布局变化没有唤醒，导致按钮坐标陈旧；scroll 也未让可见 idle item 重新 settle。现在增加有界布局失效信号，scroll 让受影响可见项恢复；idle 时仍停止持续 RAF。 | `extension/content-video-overlay.js`；Astra 静态关闭。 | 1/10/30 本地 fixture tabs 的功能检查已记录；有效资源 sampler 仅有 30 tabs 结果。未单独录制 theater-mode 布局变化的定向浏览器 E2E。 |
| F5 / P2 | FFmpeg HTTP 之前没有读空闲期限，服务端接受连接后停发字节可能无限占任务槽。现在 progressive HTTP 使用 45 秒读空闲期限和最多 2 次 reconnect；失败可触发 auto fallback 或用户可见终态，child/task 槽随之释放。 | `src/main/ffmpegDownload.ts`、`src/main/downloadManager.ts`；Astra 静态复核 timeout/fallback/取消链路通过。 | stalled fixture 在 65.9 秒后进入 `error / NETWORK_RETRYABLE`，终态采样中 downloader child 已消失；该场景 fallback argv 使用仓库 host yt-dlp，不能证明 packaged yt-dlp 路径，app 仍在运行。见 `final-http-idle-timeout.json`。 |

## 最终静态覆盖台账

下表将实现、最终 Astra 静态审查和 E2E 证据分开记录。C/E/R/P 严重度沿用原始 findings ledger；Q1、Q3–Q7 的 P 级别是本报告按用户与数据影响所作的归类，并非原始 ledger 标签；F1–F5 级别沿用 Astra 本轮复审记录。Q2 与 P11 在输入 findings ledger/报告基线中都没有对应描述，不能推测补写。原始 review-findings-ledger.json 是早期状态快照，最终状态以本表及下方证据矩阵为准。

| ID | 严重度 | 主要源码位置 | 实现 / 静态复审 | E2E 状态 |
|---|---|---|---|---|
| C1 | P1 | src/main/downloadManager.ts; src/main/persistedExtras.ts; src/main/database.ts | 已实现；Astra 静态关闭 | 部分：gallery 与 Q7 发布有成功记录；共享目录删除及失败窗口未定向验证。 |
| C2 | P2 | src/main/downloadManager.ts; src/main/douyin.ts; src/main/xiaohongshu.ts; src/main/noteMarkdown.ts | 已实现；Astra 静态关闭 | 部分：两图 gallery + note 完成；嵌套同名/删除隔离组合未验证。 |
| C3 | P2 | src/main/ytdlp.ts; src/main/downloadManager.ts | 已实现；Astra 静态关闭 | 部分：普通单输出与 Q7 多输出各有成功记录；并发临时路径冲突未注入。 |
| C4 | P2 | src/main/managedChildProcesses.ts; src/main/index.ts; src/main/ytdlp.ts; src/main/playlistList.ts; src/main/poTokenServer.ts; src/main/douyinBulk.ts; src/main/browserCookies.ts | 已实现；Astra 静态关闭 | 部分：活动主输出 FFmpeg 的 SIGKILL 后进程组 2.09 秒清空；所有 helper 类型未逐一覆盖。 |
| C5 | P2 | src/main/browserCookies.ts; src/main/douyinParseUtils.ts | 已实现；Astra 静态关闭 | 未验证：隔离 Chrome profile 为 0 cookies；非空 Cookie 与 #HttpOnly_ fallback 未实测。 |
| C6 | P2 | src/main/douyinProfileAwemeCache.ts; src/main/douyinProfileApi.ts | 已实现；Astra 静态关闭 | 未验证：未执行长时间 cache TTL/eviction 压力场景。 |
| C7 | P2 | src/main/managedChildProcesses.ts; src/main/index.ts; src/main/transcodeManager.ts; src/main/thumbnailFetch.ts; src/main/poTokenServer.ts | 已实现；Astra 静态关闭 | 部分：主输出 FFmpeg 组清理有 crash 证据；provider、thumbnail、transcode 等分别中断未全覆盖。 |
| E1 | P1 | scripts/v-download-mcp-stdio.mjs | 已实现；Astra 静态关闭 | 通过：newline、旧 Content-Length 混合输入、EOF drain 与健康响应退出均有 stdio 记录。 |
| E2 | P1 | extension/background.js; extension/content-douyin-bridge.js | 已实现；Astra 静态关闭 | 未验证：冷启动 worker 的未 ACK 命令恢复/重投没有专门 E2E。 |
| E3 | P2 | extension/background.js; extension/content-douyin-bridge.js | 已实现；Astra 静态关闭 | 未验证：过期 profile 命令与后续 READY 竞态未定向注入。 |
| E4 | P1 | scripts/v-download-mcp-stdio.mjs; src/main/profilePaths.ts | 已实现；Astra 静态关闭 | 部分：Ubuntu MCP stdio 健康路径运行过；大小写 profile fallback 未单独隔离验证。 |
| E5 | P2 | extension/background.js | 已实现；Astra 静态关闭 | 未验证：worker 重启时过期 resolver tab 清理未定向测试。 |
| E6 | P2 | src/main/openUrlInBrowser.ts | 已实现；Astra 静态关闭 | 未验证：浏览器缺失时 /usr/bin/open 的失败反馈没有实机注入。 |
| R1 | P2 | src/renderer/src/utils/thumbnailRequestQueue.ts; src/renderer/src/components/EntryThumbnail.tsx; src/renderer/src/components/CollectionPickerDialog.tsx | 已实现；Astra 静态关闭 | 未验证：大量缩略图挂载/卸载队列压力未单独测量。 |
| R2 | P2 | src/main/thumbnailFetch.ts; src/main/engineManager.ts | 已实现；Astra 静态关闭 | 未验证：非图片/非 2xx 慢 body 的 socket 回收未定向测量。 |
| R3 | P2 | src/main/engineManager.ts; src/renderer/src/components/PreferencesPanel.tsx | 已实现；Astra 静态关闭 | 未验证：同一引擎并发更新 race 未注入；本轮 build 为顺序执行。 |
| R4 | P2 | src/main/ytdlp.ts; src/main/engineManager.ts | 已实现；Astra 静态关闭 | 未验证：运行中的引擎替换与版本缓存失效未单独热更新测试。 |
| R5 | P2 | extension/background.js | 已实现；Astra 静态关闭 | 部分：1/10/30 tabs 的页面识别功能检查完成；worker hydration 与导航竞态未定向注入。 |
| R6 | P3 | src/main/httpClient.ts | 已实现；Astra 静态关闭 | 未验证：大量不同 proxy endpoint 的缓存上限/回收未做长时压力验证。 |
| R7 | P2 | src/main/remoteApiServer.ts; src/main/ipc/settings.ts; src/renderer/src/components/PreferencesPanel.tsx | 已实现；Astra 静态关闭 | 通过：端口冲突向 UI 显示错误；释放端口后 health 与 pairing ping 成功。 |
| P1 | P1 | resources/engines/manifest.json; src/main/engineManager.ts | 已实现；Astra 静态关闭 | 部分：Linux x64 package 路径通过；arm64 ffprobe manifest 项仅静态/架构检查，未在 Linux arm64 运行。 |
| P2 | P2 | src/renderer/src/hooks/useUrlHandler.ts; src/renderer/src/components/formatDialogPresentation.ts | 已实现；Astra 静态关闭 | 未验证：连续切换不同 queued URL 的 dialog 状态隔离未定向操作。 |
| P3 | P2 | src/renderer/src/components/VirtualizedQueue.tsx | 已实现；Astra 静态关闭 | 部分：10k history 的虚拟列表暴露约 16 行且有响应采样；progress 更新造成重复 scroll snap 未定向重放。 |
| P4 | P2 | src/renderer/src/contexts/DownloadActionsContext.tsx; src/renderer/src/hooks/useDownloads.ts; src/renderer/src/App.tsx | 已实现；Astra 静态关闭 | 部分：常规 pause/cancel 路径有记录；IPC 返回 false 时防止状态覆盖的拒绝分支未注入。 |
| P5 | P2 | src/main/remoteJobService.ts; src/main/remoteJobModel.ts | 已实现；Astra 静态关闭 | 部分：普通 Remote API files/archive 成功；任务存续期间改变 downloadDir 的历史 root 场景未测。 |
| P6 | P2 | scripts/engines.mjs; scripts/build-linux-release.mjs; scripts/build-mac-release.mjs | 已实现；Astra 静态关闭 | 部分：多个平台构建成功；并发 build/engine mutation 锁竞争未注入。 |
| P7 | P2 | src/main/profilePaths.ts; src/main/index.ts; scripts/dev.mjs | 已实现；Astra 静态关闭 | 未验证：隔离 profile 对系统 Login Items 的保护没有执行 OS 级副作用测试。 |
| P8 | P2 | src/main/nativeAuth.ts; src/main/profilePaths.ts | 已实现；Astra 静态关闭 | 未验证：canonical profile Keychain 路径 guard 未对真实钥匙串操作注入。 |
| P9 | P2 | .github/workflows/release.yml; scripts/verify-release.mjs | 已实现；Astra 静态关闭 | 静态/构建验证：无真实 release 发布；placeholder extension ID 拒绝逻辑未走发布环境。 |
| P10 | P2 | scripts/verify-release.mjs | 已实现；Astra 静态关闭 | 未验证：无可用 Apple notary 凭据，未执行真实公证。 |
| P11 | 未知 | — | 输入 findings ledger/报告基线未发现 P11 描述（P10 后直接 P12）；无法给出 severity/file/status，编号缺口待查。 | 不适用：不得推测。 |
| P12 | P2 | electron-builder.yml; package.json | 已实现；Astra 静态关闭 | 部分：最低版本元数据与二进制目标检查；没有 macOS 11/12 边界实机对照。 |
| P13 | P2 | src/main/index.ts; src/main/profilePaths.ts | 已实现；Astra 静态关闭 | 未验证：custom packaged user-data-dir 的系统协议注册边界未实机操作。 |
| P14 | P1 | package.json; package-lock.json; scripts/dev-native-preflight.mjs; electron-builder.yml; src/main/nativeAuth.ts | 已实现；Astra 静态关闭 | 部分：Electron 43 / N-API 路径在 macOS arm64、Ubuntu x64 运行；macOS Intel 实机未验证。 |
| P15 | P1 | electron-builder.yml; scripts/build-linux-release.mjs | 已实现；Astra 静态关闭 | 通过（容器范围）：Ubuntu 22.04/24.04 安装 DEB、依赖解析及声明依赖 ldd 检查通过；非桌面容器。 |
| Q1 | 本报告 P2（影响归类） | src/main/index.ts | 已实现；Astra 静态关闭 | 部分：空闲 Cmd+Q 退出与活动下载 crash recovery 有记录；活动下载期间 graceful Cmd+Q 未验证。 |
| Q2 | 未知 | — | 输入记录中没有 Q2 描述；无法给出 severity/file/status，编号缺口待查。 | 不适用：不得推测。 |
| Q3 | 本报告 P2（影响归类） | extension/popup.js; extension/wake-sync.js; extension/background.js | 已实现；Astra 静态关闭 | 部分：app 已运行时 popup 热路径发送成功、无协议提示；app/worker 冷启动唤醒未验证。 |
| Q4 | 本报告 P1（影响归类） | src/main/ffmpegDownload.ts; src/main/downloadManager.ts; src/main/ytdlp.ts | 已实现；Astra 静态关闭 | 通过（fixture 范围）：MP4、HLS、DASH / progressive 核心场景有修复后输出和全片 decode；特殊媒体服务未穷举。 |
| Q5 | 本报告 P2（影响归类） | src/main/downloadManager.ts; src/main/persistedExtras.ts | 已实现；Astra 静态关闭 | 部分：两图 gallery + note 完成；不同失败/删除隔离组合未注入。 |
| Q6 | 本报告 P2（影响归类） | src/main/remoteJobService.ts; src/main/remoteApiHandler.ts; src/main/remoteJobModel.ts; docs/REMOTE_JOB_API.md | 已实现；Astra 静态关闭 | 部分：round5 Remote API media + Markdown note 的 files/archive 有记录；note-only endpoint 流程未单独通过。 |
| Q7 | 本报告 P1（影响归类） | src/main/remoteResolveTask.ts; src/main/remoteJobService.ts; src/main/downloadManager.ts | 已实现；Astra 静态关闭 | 通过：resolver-confirmed 2-video playlist 完成，两个输出发布、ZIP 两成员/CRC 正常并全片 decode；普通任务意外多输出保留分支未注入。 |
| F1 | P1 | src/main/ytdlp.ts | 已实现；Astra 静态关闭 | 部分：2-item playlist 发布通过；超出日志保留窗口的长 playlist 未压测。 |
| F2 | P2 | src/main/remoteJobService.ts | 已实现；Astra 静态关闭 | 部分：重复 basename 得到唯一 API 别名、单文件路由与 ZIP 两成员 CRC 通过；两个 clip 内容/SHA 相同，distinct-content 映射仅静态复核。 |
| F3 | P1 | src/main/ffmpegDownload.ts; src/main/downloadManager.ts; src/main/remoteResolveTask.ts | 已实现；Astra 静态关闭 | 通过（指定同 URL fixture）：macOS arm64、Ubuntu 22.04/24.04 Docker Auto 输出校验/全片 decode 通过；forced yt-dlp comparator 未验证。 |
| F4 | P2 | extension/content-video-overlay.js | 已实现；Astra 静态关闭 | 未验证：theater/layout 变化后 idle overlay 定位恢复没有定向浏览器 E2E。 |
| F5 | P2 | src/main/ffmpegDownload.ts; src/main/downloadManager.ts | 已实现；Astra 静态关闭 | 部分：65.9 秒进入可见错误且 downloader child 释放；fallback argv 使用仓库 host yt-dlp，未验证 packaged yt-dlp 路径。 |

## 最终 E2E 结果矩阵

| 区域 / 场景 | 状态 | 证据与边界 |
|---|---|---|
| macOS arm64 app 与真实 Chrome 基础流程 | **部分通过** | 隔离 profile 首次启动/设置持久化、Chrome 媒体识别、配对热路径、媒体入队和部分下载流程有记录；空 profile Cookie 同步结果为 0。活动 FFmpeg SIGKILL 后恢复也通过。以下细分场景按各自行标记，不从基础流程外推。 |
| 窗口关闭后恢复 | **通过（同进程窗口）** | e2e-events.json 记录真实 Cmd+W 后 renderer visibilityState 变为 hidden，再经既有 showMainWindow IPC 恢复可见；这是同进程窗口关闭/恢复，不代表退出 app 后重新启动会自动复原窗口。 |
| 打开最终下载文件 | **部分通过（父任务 UI 观察）** | 父任务执行记录记载桌面 MP4 下载→transcode→open 动作；desktop-first-download-transcode.json 保存原始与转码产物的 probe/hash，但不含 open action 字段，因此系统打开动作没有独立 artifact 可复核。 |
| Gallery 最终产物 | **通过（两图 fixture）** | gallery-note-round5.json 记录 job complete，包含 001.png、002.jpg 和 note.md；该 fixture 不覆盖所有图库/失败组合。 |
| 普通任务异常产生额外输出时保留 staging | **未验证** | F1/Q7 正常多输出有覆盖；普通单输出在意外多输出时不得被 cleanup 删除的分支未故障注入。 |
| 真正同时运行的多下载任务 | **未验证** | 批量 admission 和队列状态有记录，但没有证据证明多个媒体下载器在同一时间并行传输。 |
| 输出目录不可写 | **未验证** | Preferences 配置写盘 EACCES 不是下载输出目录 EACCES；没有通过 chmod/只读挂载验证输出失败提示与清理。 |
| 引擎异常 | **未验证** | 没有单独注入 FFmpeg/yt-dlp 缺失、崩溃或坏退出码并核验最终 UI/Remote 状态。 |
| 扩展冷启动 / 未 ACK 命令恢复 | **未验证** | 热 popup 流程通过；没有强制 MV3 worker 冷启动、丢 ACK 后恢复命令的浏览器记录。 |
| 非空 Cookie 同步 | **未验证** | 隔离浏览器没有 cookies，实际同步计数为 0；不能据此声称 Cookie 内容同步已验证。 |
| ffprobe 阶段取消 | **未验证** | ffprobe 有限时/取消的静态路径经复审；未在 probe 执行期间实际取消任务。 |
| Direct MP4 progressive | **通过（指定 fixture，macOS arm64 与两个 Ubuntu 容器）** | 同一 tail-moov/non-Range fixture 的 Auto 路径在三个运行环境均得到 134,888 B 输出；SHA-256 78004bb9160e1b0dc0b98cf7a0e393e8f3703631220e055d3fe74399c6dbb048，H.264/AAC、3 秒，全片解码退出 0。Ubuntu 为容器交互运行记录，没有单独 JSON artifact；forced yt-dlp comparator 尚未验证。 |
| HLS / DASH | **通过（本地 fixture）** | final HLS 377,568 B / 12.027937 s、DASH 754,657 B / 12.022982 s；均 probe 为 H.264/AAC，全片 ffmpeg -v error -xerror decode exit 0。见 final-hls-dash-verification.json。 |
| Remote API Q7 playlist | **通过（2-item fixture）** | 两输出各 755,034 B、12 s H.264/AAC，全片解码退出 0；job complete，ZIP 两项和 CRC 检查通过。 |
| F2 重复 basename API 映射 | **部分通过** | 两个 clip.mp4 获得唯一 API 名称，单文件 URL 返回正确大小，ZIP 两成员/CRC 通过；两个 fixture 文件内容与 SHA 相同，不能证明不同内容逐一路径映射。 |
| Remote API media + requested note / MCP | **部分通过** | round5 记录中 MP4/HLS/DASH artifact 列表包含 Markdown note，note 路由与 archive 返回成功；MCP stdio/HTTP health/list/get/files/enqueue 已有记录。note-only endpoint 的独立流程及更大跨目录冲突组合未验证。 |
| 网络停滞与进程恢复 | **部分通过（受控路径）** | stalled HTTP 任务 65.9 秒进入 error / NETWORK_RETRYABLE，downloader 子进程释放；yt-dlp fallback 使用仓库 host binary，未验证 packaged yt-dlp。SIGKILL 后 Interrupted、UI Retry 完成并全片解码通过；活动下载时 graceful Cmd+Q 未验证。 |
| Ubuntu 22.04/24.04 x64 | **容器 backend 通过；桌面受环境限制** | Docker 环境运行在 Xvfb 虚拟显示下，不是完整桌面会话；包安装、依赖解析、声明依赖 ldd、SQLite/API/MCP、本地服务及修复后同 URL Auto fixture 有记录。没有 Ubuntu Wayland/X11 完整桌面、窗口管理器、托盘或通知实测。 |
| macOS x64 / Intel | **产物检查通过；Intel 实机未验证** | x64 包和包内 darwin-x64 原生模块架构已检查；没有真实 Intel Mac 运行记录。 |
| history / bulk / Chrome tabs | **功能/性能部分通过** | history 100/1,000/10,000、bulk 2,000 与 1/10/30 fixture tabs 功能检查完成。1/10 tabs 资源采样无效；只有 30-tab 资源 sampler 可用。 |
| Apple 签名/公证/Gatekeeper | **未验证** | 最终构建跳过代码签名；没有真实签名身份、公证提交或 Gatekeeper 实机证据。 |

### 性能与资源采样

macOS arm64 主机为 64 GiB RAM。启动时间从启动 app 到 renderer debugger endpoint，测试时 OS cache 温热；IPC 与辅助功能时间为对应采样，不应视作冷启动或所有硬件的 SLA。history 列表使用虚拟化，屏幕树实际暴露约 16 行。下表的启动、history IPC、bulk、Chrome 30-tab 功能/资源与 UI 数值，以及 Ubuntu Auto fixture 的容器结果，均来自父任务编排终端观察记录；Astra 未独立复现这些测量。final-soak-macos-arm64.jsonl 是完整 soak 原始采样。

| 数据量 | 启动至 renderer endpoint | `getDownloads` IPC | UI accessibility 响应 |
|---:|---:|---:|---:|
| 100 条历史 | 363.9 ms | 2.7 ms | 约 78 ms |
| 1,000 条历史 | 361.0 ms | 11.5 ms | 约 194 ms |
| 10,000 条历史 | 350.8 ms | 47.8 ms | 约 175 ms |

2,000 条 bulk enqueue 用时 75.5 ms，`pauseAll` 用时 640.5 ms；2,000/2,000 条均写入 DB 并处于 paused，连同 10,000 条既有 history 共 12,000 条，DB 大小 3,325,952 B。12k 条 UI accessibility 响应 95.9 ms；在 30 个 Chrome fixture tabs 负载下为 91.98 ms。

Chrome 清理并重启后，针对隔离 Chrome for Testing profile 的 1/10/30 个本机 fixture tabs 做了功能检查。旧 sampler 仅靠命令行中出现 profile 路径筛进程，误把其他进程匹配进来，因此 1 和 10 tabs 的旧进程数及 RSS 数值无效，不保留为测量结果。30 tabs 使用同时匹配浏览器 bundle 与隔离 profile 的 sampler。RSS 为匹配进程各自 RSS 求和，共享页可能重复计入；CPU 是 3 秒窗口内的总 CPU 秒。宿主为 64 GiB，`memory_pressure` 报告 free 76%。

| Chrome 场景 | 功能检查 | 有效匹配进程数 | RSS 总和 | 3 秒窗口 CPU |
|---|---|---:|---:|---:|
| 1 个页面 / clean window | 已检查 | 无有效采样 | 无有效采样 | 无有效采样 |
| 10 个页面 | 已检查 | 无有效采样 | 无有效采样 | 无有效采样 |
| 30 个页面 | 已检查 | 38–39 | 5,010.4–5,104.8 MiB | 0.04–0.19 s |

30 分钟 macOS arm64 合成负载 soak 完成，共 61 个采样点（0–1,800 秒）。负载为 12,000 条历史/队列记录（2,000 条 paused）和 30 个本地 Chrome fixture tabs，没有活动网络下载。全程 rows、DB 3,325,952 B 与 staging 0 稳定。app RSS min/max 381.9/625.5 MiB（首尾 623.7/397.3 MiB，均值 483.874 MiB），每 30 秒 app CPU 0–0.07 秒（均值 0.013 秒）；Chrome RSS 4,720.2–5,104.8 MiB（首尾 5,010.4/4,724.4 MiB，均值 4,886.956 MiB），60 个实际 30 秒采样区间的 CPU 为 0.01–0.24 秒（均值 0.112 秒，总计 6.72 秒；不含 sample0 初始化零值）。系统 free memory 71–78%（首尾 76/78%，均值 76.066%）。因此仅可判定该合成负载下 30 分钟通过，未见记录计数、DB 或 staging 增长；不代表活动下载、真实网页内容或完整桌面会话的稳定性。本轮未采集 open-FD 或端口状态。原始 JSONL：artifacts/final-soak-macos-arm64.jsonl。

### 活动任务 crash 恢复记录

最终受控 crash 场景暂停的是任务 `155e3003-0644-4503-8727-028813493aae` 的主输出 FFmpeg（PID 32521），随后对隔离 app 主进程 PID 32091 发送 SIGKILL；2.09 秒后该任务进程组已清空。重启后任务显示 Interrupted，UI Retry 后成功。输出为 2,510,814 B，probe 为 H.264/AAC、40.040340 秒；全片 `ffmpeg -v error -xerror` 解码退出 0，SHA-256 `1008d728a065dd650222412ced3a0d20ed83fddf6e780e1e328fcb772e34e9b2`。更正后的原始记录在 `artifacts/final-crash-before-restart.json`。

### 验证配置与明确未通过项

build-mac-arm64-round5.log、build-mac-x64-round5.log、build-linux-x64-round5.log 与 Ubuntu round5 install logs 是前一构建轮的日志，只作为前轮过程证据，不代表 Round6 最终构建输入。Round6 的源码快照与最终包由下方经 shasum 核验的 SHA-256 表绑定；Ubuntu 容器使用 Xvfb 虚拟显示，不是完整桌面会话。产物成功不等同于签名、公证、Intel 实机或 Linux 桌面验证。现有 51 个项目脚本结果仍为 **43 通过、8 个旧断言失败**，未改测试源码或测试命令；66/66 个既有 test source 文件未变，详情与失败逐项说明见上文“静态验证与测试结果”。

本轮 E2E 对应的 Round6 源码快照与最终包用 `shasum` 对文件实测核对如下，便于复核构建输入和产物：

| 产物 | 文件 | SHA-256 |
|---|---|---|
| Round6 source archive | `/tmp/v-download-review-20260926.7ixhe0/artifacts/final-source-round6.tar` | `f6391a1f6e0c7a4bef8355d2c2ceecdcec8589bd4ef1666c1f884b74592374ad` |
| macOS ARM64 DMG | `/tmp/v-download-review-20260926.7ixhe0/build mac 中文/dist/V-Download-1.1.7-arm64.dmg` | `781af93986be6b35a4eed18d37825a8b90ecc1f834bc6b3d99c6c6a633a42c20` |
| macOS x64 DMG | `/tmp/v-download-review-20260926.7ixhe0/build mac x64 中文/dist/V-Download-1.1.7.dmg` | `9dfd62673e4fa20808863f48189093c4072a5f9b9c7c8a5b833878f4b9938118` |
| Ubuntu 24.04 x64 final DEB | `/tmp/v-download-review-20260926.7ixhe0/artifacts/ubuntu2404-final.deb` | `43cc8533683762c457a775ef0ae9d708240bbc9074ef32c1a78b2fa087382538` |

## 已知剩余边界

- macOS 11 不再属于支持范围；`LSMinimumSystemVersion` 与 engine 二进制要求统一为 macOS 12。
- Windows 进程树清理弱于 POSIX 进程组；尚无 Windows E2E 证据。
- 远端队列仍需完整历史初始化；有 targeted main-process query 和虚拟化，但 10k 行 renderer 首次 IPC/内存成本没有被消除。
- 至少一个非空输出及最小 size 检查不能代替全量 playlist 计数或完整媒体解码验证。
- Linux 无可用 keyring backend 时 cookie 文件仅靠权限保护，不是静态加密。
- macOS 签名、公证与 Gatekeeper 结果取决于真实凭据/发布配置；GitHub artifact 可用不能证明这些 gate 通过。
