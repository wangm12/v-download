# Downie 产品链路证据笔记

> 历史记录，已归档。本文保留当时的基线、观察和验收范围；当前桌面状态见 [DESKTOP_STATUS](../../DESKTOP_STATUS.md)，网页版执行计划见 [web-download](../../plans/web-download.md)。旧优先级建议不自动成为当前待办。

研究日期：2026-10-15（America/Los_Angeles）。本文件服务于 Downie 与 v-download 的比较研究，只记录 Downie 侧的本机文档、包内脚本和官方资料；未读取 v-download 的实现，因此“可借鉴”均为待对照候选，不能据此判定 v-download 缺少某项能力。

## 证据边界与样本身份

- **L-DOC**：本机安装包中的帮助文档。证明作者文档化的工作流与限制，不等于实际运行验证。
- **L-STATIC**：本机 plist、SDEF、intent definition、JavaScript 的可直接读取事实。声明/代码存在不等于已执行，也不自动证明 native 接收端行为。
- **W-OFFICIAL**：访问日所见官方网页、发布说明或官方 GitHub 文件。在线帮助未绑定具体 app build，可能滞后。
- **I / U**：研究推断 / 尚未验证。

本机 `Info.plist` 指向 `DownieHelp.help`，版本为 **4.7.27 / build 4787 / Trial**；本文件优先使用该 help book，没有混用旁边的 `Downie.help`。[L01] 官方发布记录将 4.7.27 标为 2024-08-29；访问日顶部版本为 **4.13.2，2026-09-29**。[W01]

样本主程序 SHA-256：`6eb6e6582f8bb47e3e0d6ba0fabeabbbfbf72b6e4c4795a95d3ab1b3b4ed1b61`。DownieCore SHA-256：`1931e01249a987a7bd4ecb4f4c0cd2cbdfe2757a183b4420f1eea71d078240cd`。它们只锚定此次本地样本，不能锚定官网新版。

本次没有启动 Downie、ffmpeg、helper 或反编译器，没有读取用户配置、下载历史、浏览器数据或许可状态，没有安装程序或下载媒体。包内文档的操作步骤是研究对象，不是本次执行指令。

## 1. 输入 → 识别 → 任务创建

### 已文档化与可静态核对的机制

| 机制 | 证据及边界 | 对比较研究的意义 |
|---|---|---|
| 多入口接收同一意图 | L-DOC：浏览器按钮、拖到主窗/Dock/菜单栏、Open URLs 多链接文本框、主窗 ⌘V、剪贴板 + 按钮。[L02] 211–222。L-STATIC：URL scheme、macOS Services、Share Extension、Automator、Intents 的注册分别见 [L01]、[L22]、[L23]。 | 用户不必先进入下载器再复制一遍链接；必须检查各入口是否共用解析、去重、选项和错误处理。文档不能证明它们内部已经统一。 |
| 解析期间增量显示结果 | L-DOC：加载时显示 Loading 或菜单栏脉动；发现链接后立即入队并显示。[L02] 222。 | “正在解析”和“正在下载”是不同状态；大列表可边解析边选择，不必等全部解析完。顺序、背压和取消边界尚未验证。 |
| 内容身份可不同于 URL 文本 | L-DOC：custom integration 的 URL regex 可用非空命名组 `ID` 提供内容身份，用于未知来源提取时的重复检测。[L10] 209–211。 | 可借鉴“源站 + 内容 ID”去重；必须保留原 URL 与显式未知，不能把显示标题或易变签名 URL 当稳定身份。去重 native 实现不在本文件覆盖范围。 |
| 批量导入有结构化覆写 | L-DOC：CSV 必需 `url,title`，可选 `path`，其他列忽略；XML 为 downloads/download 与对应子项。[L11] 205–226。文档限制为直接支持的链接，不能依赖额外网页间接提取。 | 值得对照我们的批量任务模型是否保留自定义标题、目录、原始顺序及单行错误；不应只做逐行 URL 读取。 |
| 浏览器内选择下载意图 | L-DOC：右键可把当前页以 audio/video 等后处理选项送入队列，避免反复改全局设置。[L12] 215–223。L-STATIC：Safari extension plist 注册普通、MP4、Audio、Permute 菜单命令。[L21] | “这一次只要音频”属于单任务意图；不能让单任务操作暗中改全局偏好。 |
| 登录上下文并非随 URL 自动迁移 | L-DOC：默认只收到 URL，登录需 Login Browser；可由失败提示进入，或手动进入。[L13] 205–211。Safari Cookie 传递在本机文档中是实验性、默认关闭。[L12] 231–240。 | 登录恢复应是明确步骤；“在 Chrome 能播”不能直接推导下载器拥有同样会话。 |

Safari 包内 `script.js` 的直接事实：右键遍历祖先 `<a>`，把 `selectedLink` 与 `document.cookie` 放入 context-menu user info（5–17）；收到 message 后发送 `XUOpenCurrentSite` 与 Cookie 字符串、uuid（20–24）；两个快捷键路径分别发送当前页/全部标签消息（27–43）。[L20] 这只证明脚本的消息构造；是否由宿主设置门控、native 如何过滤或保存、发送是否成功均未知，不能称为完整浏览器会话导入。

**I：可借鉴的核心不是入口数量，而是输入上下文能否贯穿解析、二次提取和重试。** 官方新版 automation 文档明确承认：自定义 `title` 只对直接支持的链接可靠，经过额外提取间接层会丢失。[W04] 这是应避免的上下文丢失实例，而不是要照搬的限制。

## 2. 失败兜底 → UGE → 可复用 integration

### 产品上的递进关系

1. L-DOC：无显式支持时先查网页里的已知模式；仍失败后提供 UGE、请求支持、忽略三个动作。[L14] 235–240。
2. L-DOC：UGE 是内嵌浏览器，右栏展示候选资源，由用户点 + 转入下载队列；页面未发起媒体请求时，可能需要用户播放视频。候选区还支持图片、字幕；图片支持逐项或全选下载。[L09] 205–235。
3. L-DOC：UGE 提供 macOS/iOS/custom User Agent、兼容层、popup 设置。文档指导识别 Direct、HLS、DASH 结果，并提醒优先找到 master manifest，避免只得到音频或视频子流。[L09] 219–235。
4. L-DOC：custom integration 可把重复的 UGE 发现过程固化。Resource Detection 适合简单规则；JavaScript 适合元数据、多质量、字幕、音视频分离和合集。[L10] 205–287。

### 两种规则的能力边界

| 规则 | 文档化能力与限制 | 代价/应学习的取舍（I） |
|---|---|---|
| Resource Detection | 匹配完整 URL 或最后 path component；大小写不敏感的字面匹配或 regex。默认是子串匹配，需显式锚点才是完整匹配；匹配到一个资源即停止。不能提取合集、改元数据、附加独立字幕、指定分离音视频，HTTP headers 微调有限。可把 YouTube/Vimeo embed 交回内建 integration。[L10] 246–283。 | 无代码规则降低维护门槛，但需展示“为什么命中、命中了什么”，特别防止 `master.m3u8` 同时命中 audio/video master。不能把它包装为万能抓取。 |
| JavaScript | 页面加载后的 WebView 上下文执行；可报告 direct download，或报告 embedded download 继续分派给其他 integration。可提供 qualities、subtitles、title、preview、description、authors、showName、playlistName/index/count。[L10] 285–375。 | 尽量让扩展层输出统一的媒体模型，复用下载、质量、字幕和元数据管道；代价是 WebView 生命周期、异步完成、错误、权限与更新管理。 |

### 包内 bridge 直接证明的接口

`CustomIntegrationExecutionJavaScriptBridge.js` 创建 `window.downie`，有 `context` 占位值，并把 `log`、`reportError`、`reportDownload`、`reportEmbeddedDownload`、`reportDone` 发送给相应的 `window.webkit.messageHandlers`。[L19] 13–51。这个 JS 文件只负责转发，不能据此断言 native 缺少类型校验，或确定消息处理顺序/线程。

文档契约提供了更具体的边界：[L10] 293–418。

- `qualities` 每项至少有 URL，可带宽高、headers、禁用 chunked download；`audioQuality` 可指定独立音轨及 bitrate。字幕项需要 URL 和 title。
- `reportEmbeddedDownload` 使发现层与已有站点 handler 组合，而不是重复实现 downloader。`context` 可把合集信息传给下一层；referer 由 Downie 覆写。
- 结果结束必须显式 `reportDone`；文档说明未调用时默认等待 60 秒。`reportError` 负责结束 WebView 并向 UI 报错，`log` 有调试 Console。
- **重试旧队列项仍运行原脚本**；修改 integration 后需删除任务再添加。此行为是文档事实，尚未运行验证。

本机另有两份 Safari compatibility JS，静态可见对浏览器 API 的补充/替代，例如 AudioContext、Observer、performance、fullscreen 或 mediaDevices 的占位实现。[L24][L24b] 不能从这些文件推断实际注入条件或网站成功率；“模拟接口存在”也不等于实现完整浏览器语义。

### 维护机制及生态规模

L-DOC：Market 是免费社区 integration 列表；提交人工审查、源码可看、修改后可重提，应用文档称会自动更新 integrations。[L15] 205–233。审查策略描述不构成更新签名、回滚或沙箱强度的证据。

官方 GitHub 当前 main 已固定到 `8009a4a59066ea4c813fda36ec74376557ea8850`（commit 时间 2026-09-04）。直接读取并用 plist parser 解析的 registry 有 **5 条**，包含 integration UUID、version、更新日、sampleLink、URL regex、文件名等；EggHead `.dci` 包含 code、identifier、name、urlRegex、userAgent、version。[W10][W11] 这只界定所查 GitHub registry，不证明应用内 market 的完整规模；不能据此把 Marketplace 描述为庞大生态。

**I：值得优先学稳定身份、版本、样例、调试和结果模型；建 marketplace 或 AI 生成器前，先证明我们的真实失败任务能通过简单规则解决。** 本机 retry 保留原脚本有可复现性价值，但 UI 应允许用户明确选择“按原任务重试”或“用新规则重新解析”，避免静默陈旧。

## 3. 质量 / 音轨 / 字幕 / 合集 → 用户能播放的结果

### 选源策略并非只有“最高画质”

L-DOC：默认选择最高质量并自动开始，可设分辨率上限或每次询问；下载前可手动换 rendition，后处理可在下载中改变。[L03] 209–217、[L04] 205–209。

本机 Preferences 明确区分两项策略：[L05] 219–223。

- **prefer MP4**：同分辨率内优先 MP4，即使 MP4 的码率/帧率较低。
- **force MP4**：优先任何 MP4，可能从其他格式 4K 降到 MP4 720p。

I：这把兼容性与画质/时间/CPU 的权衡放在下载前。可借鉴可解释的目标（最高质量、兼容播放、音频）；需让 UI 告诉用户实际选择的分辨率、codec、fps、音轨及可能的转码，避免一个“MP4”选项同时混合容器、codec 与无损保证。上述两策略的 native 排序与更多冲突组合尚未验证。

### 字幕和音轨的有用能力与脆弱点

L-DOC：默认把字幕转成外置 SRT，可保留源格式；Multiple 模式根据用户列表下载多个 label；音轨也可设自动选择列表。[L06] 205–247、[L05] 259–263。手动菜单暴露 available subtitle labels。

L-DOC：字幕 label 必须完全匹配；本机 YouTube 文档还要求精确音轨名称。[L06] 224–226、[L07] 219–222。在线 YouTube 文档进一步强调应匹配 Downie 自己显示的名字，不能直接照抄 YouTube 的本地化显示名。[W08]

I：能选择多字幕/多音轨值得借鉴；**以 display label 做稳定匹配应改进**。比较时检查我们的模型是否分别保存 source track ID、语言标识、原始 label、original/default/自动生成等属性，并在无法确定时保留未知；不要只按翻译后的 UI 字符串匹配。

L-DOC：Downie 自身不把字幕嵌入主文件，文档引导用 Permute 自动检测字幕并合并。[L06] 228–247。它是外部依赖方案，不是证明 Downie 自身有完整 subtitle mux 功能。

### 合集、分段与可保存元数据

- L-DOC：integration 可带 playlistName、1-based index、count，并可在嵌套提取之间传 context。[L10] 304–306、370–414。它证明元数据契约，不证明任意网站的合集遍历完整性。
- L-DOC：Destination 可按网站/合集建目录并套 filename format；可导出封面 JPEG 与 JSON metadata，后者包括来源、描述、作者、节目和部分站点章节。[L05] 229–235。
- L-DOC：有些网站一个视频会成为多个独立 part；偏好中可启用 stitching。文档同时注明依赖 Permute，并非每种“分段”都由内置处理完成。[L08] 205–208、[L05] 257。不要把独立 multipart 与 HLS/DASH segment 混为一项。
- L-DOC：本机 YouTube “List All” 可能列出缺失/不完整 rendition，默认源列表会偏向可靠性而非最大枚举量。[L07] 228–242。这是具体产品取舍，尚未验证当前站点行为。

I：产物侧的来源/章节/封面/合集顺序往往比增加一个高级按钮更持久。合集中应保留原始 index，明确“选中多少/发现多少/总量是否已知”，不能把已发现计数当作完整覆盖。

## 4. 队列 → 失败分类 → 恢复 / 历史

### 本文件能证明什么

| 能力 | 证据 | 不能据此证明的部分 |
|---|---|---|
| 并发与优先级 | L-DOC：General 有并发下载数；每任务有优先级，先开始高优先级项。[L05] 214、[L03] 213–217。 | 公平性、每 host 限流、内存界限、排队算法、解析与下载是否各自限流。 |
| 解析取消 | L-DOC：取消当前解析可能等正在进行的动作结束，需数秒。[L03] 220–222。 | native cancellation token、子进程终止、网络中断和临时资源清理。 |
| 可重置损坏/卡住队列 | L-DOC：退出后按 Option 启动可提示 reset queue。[L14] 205–207。 | 自动崩溃恢复、写入原子性、重启续传字节语义、坏任务隔离。 |
| 任务配置有快照语义 | L-DOC：代理在任务创建时复制，修改代理不影响已入队项；重试旧项使用原 integration 代码。[L05] 269–272、[L10] 418。 | 快照序列化完整性、是否保留认证期限、用户是否能选择重新解析。 |
| 历史与文件定位 | L-DOC：历史列表可 Reveal in Finder、打开原始链接；可关闭历史，自动清理或清理已删除文件。[L16] 205、[L05] 238–240。 | 历史与 live queue 的具体存储关系、失效链接重新解析、跨设备一致性。 |
| Partial Download 类型 | L-STATIC：`.downiepart` 被注册为 package 文档类型。[L01] 10–29、255–273。 | 容器内部格式、恢复流程、安全清理、HTTP Range resume。文件扩展名不是断点续传证据。 |

L-DOC 的错误引导较具体：[L14] 213–265。

- DRM 不支持、应转 UGE、conversion failure 是三条不同处理路径；不是所有错误都引导提交支持请求。
- Unsupported 页面提供下一步，不止显示“失败”。
- 支持入口把 Link Report、Generic Report、Localization Report 分开，错误按钮可填入错误文本；要求具体内容 URL，避免只提交站点首页。

I：可借鉴 typed failure + 可执行下一步 + 诊断导出。不要照抄“conversion error 多由网络导致”等未经我们验证的归因比例。比较实验应把准备失败、传输失败、磁盘不足、mux、transcode、目标路径写入分别记录。

**关键未决项：本次文档/资源研究没有确认 Downie 的断点续传、强退恢复、fragment 去重、签名 URL 过期刷新或恢复后的质量保持。** 这些应由主调查的 native/受控运行证据回答。

## 5. 下载完成 → 必需组装 / 可选后处理 → 交付

L-DOC 的五类后处理是 None、MP4（H.264）、Audio Only、Permute、Custom shell script；可设全局或逐任务覆写。Audio Only 在可用时直接下载音频源，否则从文件提取，默认可转 MP3。[L17] 205–235。

L-DOC：即便选择 None，分离音视频仍需组装，HLS/DASH 等片段也需形成可播放文件。帮助把这些步骤统称 conversion。[L17] 238–244。**I：我们的界面可以比这更准确地区分 remux/组装与有损转码**，显示耗时来自网络、合并还是编码；不能把“未选转码”解释为“不需要 ffmpeg”。本次尚未检查 Downie 调用参数，不能断言它在这些情况总是重编码。

L-DOC：Custom shell script 可做更复杂交付；文档说其在 Downie sandbox 中运行，可通过 stdout 输出 `downie_progress(0.75)` 或带状态字符串的形式回报进度。[L17] 218。这提供“可扩展动作仍有统一进度”的具体机制；不能从帮助文字确认操作系统 sandbox 的实际限制、工作目录、环境变量继承、超时和取消实现。

L-DOC：可把结果加入 Music/iTunes/TV，Permute 承担高级转换、subtitle merge 或某些 multipart stitching；JSON metadata 可供章节拆分。[L05] 231–257、[L06] 228–247、[L08] 205–208。外部 app 的版本与安装要求是用户路径的一部分。

I：可优先提供“原文件保留 + 可重试的后处理 + 显式产物关系”，并把下载成功与后处理失败分开，避免重新下载整个媒体。若以后提供用户脚本，先明确输入产物、输出产物、结构化进度、取消、超时及失败后的保留规则；本文件没有证明 Downie 已具备这些保证。

## 6. Mac 集成 → 自动化 → 维护闭环

### 具体入口契约

- L-DOC：支持仅菜单栏运行，可隐藏 Dock；菜单栏 popover 提供与主窗类似操作。[L02] 209。[L05] 225–227 另有队列排序方向等外观设置。
- L-STATIC：SDEF 的 `start queue` 文档返回 1=启动、0=已运行、-1=空；`open all URLs in text` 返回是否找到 URL。[L18] 237–246。这是窄小自动化契约，不是完整 headless CLI/可编程任务查询 API。
- L-STATIC：两个 Intents 为 URL list 下载与从 text 提取 URL，均带 postprocessing、可选 destination，并声明 background execution。[L22] 100–129、141–163、174–242、296–325、352–451。注册声明不能替代 Shortcuts 真实执行测试。
- L-DOC：`downie://XUOpenURL` 接收 URL、后处理、destination 或 `open_in_uge`；URL 内嵌的分隔字符须正确编码。[L23] 239–269。应比较路径/URL编码和调用方覆写的保真度，而不是仅有一个 scheme。
- L-DOC：Automated Mode 抑制交互提示，避免无人值守被弹窗阻塞；缺登录等条件时会失败。[L23] 207–209。I：自动化需要“可解释失败与待处理事项”，不是默默隐藏弹窗。
- L-STATIC：Info.plist 注册成功/失败通知、AppleEvents 用途、Sparkle update feed 和消息 feed；仅证明声明/配置，不证明访问时机或传输内容。[L01] 170–173、239–251、299–304。

### 维护体验与代价

L-DOC：网站随时变化，支持流程依赖具体失败链接和设置；Settings 建议自动更新。[L14] 213、[L05] 302–304。I：桌面下载器需要一条发现回归、重现、更新 adapter、验证并告知用户的维护路径，不能只依赖静态“支持 N 站”列表。

L-DOC 隐私文档声称 feature event counters、站点名计数及 Top Downloads 的链接计数可关闭，并描述启动时许可/消息/榜单请求。[L25] 205–255。**这些是作者声明，本次未抓网络，不能验证“匿名”、默认值、脱敏或实际 payload。** Top Downloads 又已被新版删除，不能直接推荐复制这一数据回路。

W-OFFICIAL：Safari 在线帮助说明新旧 extension 并存、旧 Cookie 传递选项被弃用，理由是带来更多问题；新菜单把选项收进 submenu。[W02] Chrome 在线帮助提供 macOS 13+ 安装 wizard，说明分发限制使扩展安装本身成为需设计的 onboarding。[W03] 此处仅记录官方说法，没有安装或验证扩展。

W-OFFICIAL：作者的 OS 支持文章（持续更新，2026-09-07 有更新条目）把测试矩阵、开发工具和系统 WebView 能力列为停止旧系统支持的原因；还解释“Safari/Chrome 能播放”不代表 app 内系统 WebView 能播放。[W09] **I：UGE 的网页引擎版本是产品依赖，应进兼容性模型和诊断信息；维护成本不只在站点 extractor。**

## 官方新版变化（与本机 4.7.27 分开）

下列均为 **W-OFFICIAL 发布说明，未安装/运行新版**。为了避免把长篇 changelog 变成二次复制，这里只保留与六条链路直接有关的变化。[W01]

| 版本 / 日期 | 精选变化 |
|---|---|
| 4.13.2 / 2026-09-29 | 本地 HLS manifest；UGE Safari 兼容层改进。 |
| 4.13.1 / 2026-09-17 | 修 SRT；正确识别 Opus，避免错误重编码。 |
| 4.13 / 2026-09-11 | 最低系统改为 macOS 13。 |
| 4.12.15 / 2026-09-07 | 删除 Top Downloads。 |
| 4.12.13 / 2026-08-18 | 磁盘不足识别；规则提取的 headers；multipart 修复。 |
| 4.12.10 / 2026-07-11 | SABR 分批启用，并按需求自动启用。 |
| 4.12.7 / 2026-06-11 | HLS 变量继承；实验性 SABR。 |
| 4.12.5 / 2026-05-26 | 实验性 AV1-in-MP4；字幕兼容修复。 |
| 4.12.4 / 2026-04-29 | 预约直播录制；automation 自定义标题。 |
| 4.12.2–3 / 2026-04 | 下载/准备间隔；UGE headers 改进。 |
| 4.11.9 / 2026-01-15 | Apple Intelligence integration wizard（beta）。 |
| 4.11.8 / 2026-01-13 | 显示被抑制的自动化动作；修重启后的后处理选择。 |

在线帮助也有可核对的细节增量：custom integration qualities 增加 HLS key 请求 headers 字段 `encryptionKeyHeaderFields`；embedded download 文档列出 description/preview。[W05] 本机文档尚无这些字段。这里只记录官方契约差异，不推断本机 native 是否已接受未文档化字段。

**版本漂移必须保留：** 在线 UGE 仍含 Flash 描述；在线 Settings 仍写 Top Downloads；Safari 帮助仍写“将随停止 macOS 11/12 支持而移除旧 extension”。[W06][W07][W02] 因此在线帮助不能被当作 4.13.2 的完整、逐项准确能力清单；本机旧帮助更不能代表新版。

## 供主比较报告筛选的机制候选

以下优先级是 I（研究判断），须结合 v-download 代码/实际目标修正；成本未做工时或性能测量。

| 候选 | 具体价值 | 主要实现/维护代价 | 比较时应验收的结果 |
|---|---|---|---|
| 优先：分阶段状态与可行动错误 | 用户知道卡在解析、认证、下载、组装还是转换；一次失败仍有下一步。 | 状态所有权、跨进程错误归类、取消与清理。 | 原始 URL/所选格式/错误阶段能一并导出；重试不会丢选项。 |
| 优先：格式目标与实际选源解释 | 避免把 MP4 当画质或无损承诺。 | 多 rendition 排序、音视频配对、codec/容器兼容矩阵。 | 同分辨率不同 fps、低分辨率 MP4、高分辨率其他容器下，UI 显示取舍。 |
| 优先：输入意图与任务快照 | 从扩展、导入、scheme 到嵌套提取都保留标题/目录/格式选择。 | 统一任务输入、显式 precedence、原任务重试与新解析的区别。 | 多入口对等；URL 编码和间接层不会吞掉覆写。 |
| 优先：输出 metadata / 章节 / 来源 | 结果可追溯、可用于下游工作流。 | 格式 schema、更新策略、文件关系与冲突处理。 | 下载文件与来源/合集 index/章节仍可独立对应。 |
| 次级：更可靠的字幕与音轨偏好 | 超越精确显示 label 匹配。 | 语言与 track ID 的归一化、源标记不全、未知处理。 | UI 换语言/源站 label 变化不破坏可确定的偏好；不确定时让用户看见。 |
| 次级：浏览器辅助发现 → 规则固化 | 把自动解析覆盖不到的长尾变成用户可完成流程。 | WebView/请求上下文、manifest 父子关系、登录、OS差异。 | 自有 fixture 自动解析失败后仍能发现正确 root manifest并入队。 |
| 条件性：简单 integration 规则与调试 | 低成本修复个人站点，无需等待整包发布。 | 规则优先级、命中解释、版本/身份、更新与回滚。 | 可预览命中、带样例验证；旧任务与更新规则的关系明确。 |
| 后置：marketplace / AI wizard | 可能降低写规则门槛。 | 质量评估、审查、分发、兼容、长期维护。 | 先证明真实规则需求与维护者供给，不能以功能存在代替产品价值。 |

## 仍需主调查回答的受控运行问题

1. 自动解析失败时是否实际出现正确 UGE/登录入口；错误分支会否误分类。
2. 任务创建、取消、重试、退出再启、强退恢复时，配置/选源/元数据/临时文件如何变化。
3. `.downiepart` 的内容与 ownership、完成移动、失败清理、HTTP/HLS 恢复语义。
4. 实际质量排序、外置字幕命名、音轨选择，以及多语言/缺失格式时的行为。
5. UGE 和 downloader 对 headers、Cookie、referer、代理的传播及隔离；本机帮助指出代理不覆盖 UGE/Login，需验证。
6. ffmpeg 的实际阶段、参数、是否 stream copy、失败后能否只重跑后处理。
7. 大列表的解析/队列开销、并发约束、CPU/内存及 UI 响应。文档和包体积无法提供性能结论。
8. 新版声明的本地 HLS、SABR、live schedule、AI wizard 等，均没有本机 4.13.2 runtime 证据。

## 来源索引

所有本地行号为原始 UTF-8 文件的 1-based 行号；HTML正文以 `<main>` 为边界读取，未把导航栏当能力正文。下面的 source labels 是本笔记索引，不是 REA Evidence IDs。

| ID | 来源 / 关键行 |
|---|---|
| [L01] | Info.plist：52–69 help/version；130–131 build；180–226 Services；239–251 intent/notification/update；255–291 types。 |
| [L02] | overview.html：209–234 输入入口、菜单栏、增量入队。 |
| [L03] | options.html：209–222 自动开始、逐任务操作、取消。 |
| [L04] | quality.html：205–209 质量选择。 |
| [L05] | preferences.html：211–235 质量/产物；238–272 history、后处理、proxy；275–304 支持、隐私、更新。 |
| [L06] | subtitles.html：205–247 SRT、多语言、label、Permute。 |
| [L07] | webm_youtube.html：207–242 格式权衡、音轨、可靠性。 |
| [L08] | multipart.html：205–208 stitching 与依赖。 |
| [L09] | uge.html：205–240 操作、候选、UA、兼容层与过时 Flash 内容。 |
| [L10] | custom_integrations.html：205–283 两种规则；285–418 数据/生命周期/重试契约。 |
| [L11] | import.html：205–226 CSV/XML 契约与直接支持限制。 |
| [L12] | extensions.html：205–247 入口、Cookie 默认与隐私声明。 |
| [L13] | login.html：205–215 登录浏览器与恢复。 |
| [L14] | reporting.html：205–265 重置、错误分类、问题反馈。 |
| [L15] | custom_integration_market.html：205–233 市场、审查、更新。 |
| [L16] | history.html：205 history 操作。 |
| [L17] | postprocessing.html：205–253 模式、stdout 进度、必需组装、转换暂停。 |
| [L18] | Downie.sdef：237–246 Downie Suite。 |
| [L19] | CustomIntegrationExecutionJavaScriptBridge.js：13–51。 |
| [L20] | Safari script.js：5–43。 |
| [L21] | Safari extension Info.plist：47–101 菜单、脚本、权限声明。 |
| [L22] | Intents.intentdefinition：100–242、296–451。 |
| [L23] | automation.html：207–269。 |
| [L24] / [L24b] | SafariCompatibilityLayer.js：12–179；SafariCompatibilityLayer_2.js：8–123。 |
| [L25] | privacy.html：205–255 作者声明，未经流量验证。 |

官方网页均访问于 **2026-10-15**；发布说明中的日期是对应版本发布日期。每网页只作有限摘要，不保存整页正文。

| ID | 官网来源 / 定位 |
|---|---|
| [W01] | Downie release notes，版本 heading 4.13.2 → 4.7.27；选取上表的功能变化。 |
| [W02] | Safari help，Safari Options、Sending Cookies、新旧扩展兼容描述。 |
| [W03] | Chrome help，安装 wizard 与手动安装说明。 |
| [W04] | Automation help，title 参数及间接提取丢失限制。 |
| [W05] | Custom Integrations help，Qualities / Embedded Download 字段。 |
| [W06] | UGE help，Options / Tips，仍有 Flash 描述。 |
| [W07] | Settings help，仍列 Top Downloads；代理快照说明。 |
| [W08] | YouTube help，Automatic Selection 与本地化 label 匹配。 |
| [W09] | Sunsetting support for older macOS versions，更新至 2026-09-07 的正文。 |
| [W10] | 官方 GitHub registry，固定 commit 的 raw plist；3,474 bytes；SHA-256 `d22aee52ee3e74c8f500bb2e08af2f75dcaeb9f1d6e76c130ba6255a29f44faf`；解析为 5 条。 |
| [W11] | 官方 EggHead integration，固定同一 commit 的 raw plist；1,534 bytes；SHA-256 `077eff9acec2708a99e33bd38e69028ffb4ec36bce9e58a33281ed80a6eba497`。 |

[L01]: </Applications/Downie 4.app/Contents/Info.plist:52>
[L02]: </Applications/Downie 4.app/Contents/Resources/DownieHelp.help/Contents/Resources/English.lproj/overview.html:209>
[L03]: </Applications/Downie 4.app/Contents/Resources/DownieHelp.help/Contents/Resources/English.lproj/options.html:209>
[L04]: </Applications/Downie 4.app/Contents/Resources/DownieHelp.help/Contents/Resources/English.lproj/quality.html:205>
[L05]: </Applications/Downie 4.app/Contents/Resources/DownieHelp.help/Contents/Resources/English.lproj/preferences.html:211>
[L06]: </Applications/Downie 4.app/Contents/Resources/DownieHelp.help/Contents/Resources/English.lproj/subtitles.html:205>
[L07]: </Applications/Downie 4.app/Contents/Resources/DownieHelp.help/Contents/Resources/English.lproj/webm_youtube.html:207>
[L08]: </Applications/Downie 4.app/Contents/Resources/DownieHelp.help/Contents/Resources/English.lproj/multipart.html:205>
[L09]: </Applications/Downie 4.app/Contents/Resources/DownieHelp.help/Contents/Resources/English.lproj/uge.html:205>
[L10]: </Applications/Downie 4.app/Contents/Resources/DownieHelp.help/Contents/Resources/English.lproj/custom_integrations.html:205>
[L11]: </Applications/Downie 4.app/Contents/Resources/DownieHelp.help/Contents/Resources/English.lproj/import.html:205>
[L12]: </Applications/Downie 4.app/Contents/Resources/DownieHelp.help/Contents/Resources/English.lproj/extensions.html:205>
[L13]: </Applications/Downie 4.app/Contents/Resources/DownieHelp.help/Contents/Resources/English.lproj/login.html:205>
[L14]: </Applications/Downie 4.app/Contents/Resources/DownieHelp.help/Contents/Resources/English.lproj/reporting.html:205>
[L15]: </Applications/Downie 4.app/Contents/Resources/DownieHelp.help/Contents/Resources/English.lproj/custom_integration_market.html:205>
[L16]: </Applications/Downie 4.app/Contents/Resources/DownieHelp.help/Contents/Resources/English.lproj/history.html:205>
[L17]: </Applications/Downie 4.app/Contents/Resources/DownieHelp.help/Contents/Resources/English.lproj/postprocessing.html:205>
[L18]: </Applications/Downie 4.app/Contents/Resources/Downie.sdef:237>
[L19]: </Applications/Downie 4.app/Contents/Frameworks/DownieCore.framework/Versions/A/Resources/CustomIntegrationExecutionJavaScriptBridge.js:13>
[L20]: </Applications/Downie 4.app/Contents/PlugIns/Downie Extension.appex/Contents/Resources/script.js:5>
[L21]: </Applications/Downie 4.app/Contents/PlugIns/Downie Extension.appex/Contents/Info.plist:47>
[L22]: </Applications/Downie 4.app/Contents/Resources/Intents.intentdefinition:100>
[L23]: </Applications/Downie 4.app/Contents/Resources/DownieHelp.help/Contents/Resources/English.lproj/automation.html:207>
[L24]: </Applications/Downie 4.app/Contents/Frameworks/DownieCore.framework/Versions/A/Resources/SafariCompatibilityLayer.js:12>
[L24b]: </Applications/Downie 4.app/Contents/Frameworks/DownieCore.framework/Versions/A/Resources/SafariCompatibilityLayer_2.js:8>
[L25]: </Applications/Downie 4.app/Contents/Resources/DownieHelp.help/Contents/Resources/English.lproj/privacy.html:205>
[W01]: https://software.charliemonroe.net/trial/downie/v4/rnotes.html
[W02]: https://software.charliemonroe.net/help/downie/?article=extensions_safari
[W03]: https://software.charliemonroe.net/help/downie/?article=extensions_chrome
[W04]: https://software.charliemonroe.net/help/downie/?article=automation
[W05]: https://software.charliemonroe.net/help/downie/?article=custom_integrations
[W06]: https://software.charliemonroe.net/help/downie/?article=uge
[W07]: https://software.charliemonroe.net/help/downie/?article=preferences
[W08]: https://software.charliemonroe.net/help/downie/?article=youtube
[W09]: https://blog.charliemonroe.net/sunsetting-support-for-older-macos-versions/
[W10]: https://raw.githubusercontent.com/charlieMonroe/DownieCustomIntegrations/8009a4a59066ea4c813fda36ec74376557ea8850/registry.plist
[W11]: https://raw.githubusercontent.com/charlieMonroe/DownieCustomIntegrations/8009a4a59066ea4c813fda36ec74376557ea8850/EggHead.io.dci
