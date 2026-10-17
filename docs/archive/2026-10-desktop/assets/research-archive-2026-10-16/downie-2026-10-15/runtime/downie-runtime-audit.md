# Downie / v-download 运行输出独立审计（2026-10-15）

审计只读取既有原始测量、服务器日志和最终文件，并运行离线 ffprobe/FFmpeg 完整解码；没有启动、控制或重配应用，没有改写原始结果或产品源码。

**主样本结果：Downie 与 V 的直链 MP4、HLS、DASH 均各 3/3；两边各 9 个最终文件通过。** 所有主样本均为 1280×720 H.264 + AAC，完整解码 360 帧；直链时长 12.000s，HLS/DASH 容器因音轨尾部为 12.021–12.032s。

完整机器可读回执见 [downie-runtime-audit.json](downie-runtime-audit.json)，包含每个文件的绝对路径、完整 SHA-256、全量新 ffprobe、解码命令/退出码/最终帧数、原记录哈希、采样摘要及请求原日志行。

## 验证方法与范围

成功判据要求最终文件不在 `.downiepart` 中、文件审计期间稳定、时长约 12 秒、完整音视频解码退出 0 且视频帧数为 360。仅 ffprobe 读取到 MP4 头部的 12 秒 duration 不足以证明片段完整。FFmpeg 使用 `-xerror -err_detect explode` 解码全部 A/V 流至 null，没有转码覆盖输出。字幕/章节另查 metadata；Downie annotated 还与源文件逐字节 SHA-256 一致。

仅为本机生成的 12 秒 test-pattern 样本，三个重复运行，应用已运行且缓存未清空。没有测出可横比的冷启动或完整 UI 就绪时间，也不能外推真实网站成功率。

## 主样本与资源观察

以下 CPU 为已有 100ms 采样的进程家族估计，RSS 为同一时刻 family RSS 求和峰值（MiB）。我从原 sample 文件重算峰值，均与原摘要相符。不同 profile、原生/Electron 边界、短命子进程及 reparented WebKit/翻译服务的覆盖不相同，因此这些值是样本观察，不能据此给出全产品速度或内存倍数排名。

| 应用 / 输入 | 最终输出 | CPU 秒（各轮） | family RSS MiB（各轮） | 请求数（各轮） | 服务器 body bytes（各轮） |
|---|---|---|---|---|---|
| V / direct | 3/3 | 0.13 / 0.05 / 0.06 | 473.70 / 470.12 / 473.55 | 1 / 1 / 1 | 2,908,122 / 2,908,122 / 2,908,122 |
| V / hls | 3/3 | 0.77 / 0.68 / 0.80 | 577.41 / 576.36 / 606.41 | 20 / 20 / 20 | 6,062,830 / 6,062,830 / 6,062,830 |
| V / dash | 3/3 | 0.08 / 0.05 / 0.06 | 513.98 / 493.78 / 493.14 | 18 / 18 / 18 | 3,061,150 / 3,061,150 / 3,061,150 |
| Downie / direct | 3/3 | 0.85 / 0.57 / 0.46 | 139.98 / 149.73 / 158.50 | 5 / 5 / 5 | 5,005,274 / 6,668,212 / 7,454,644 |
| Downie / hls | 3/3 | 0.37 / 0.48 | 160.68 / 180.64 | 12 / 12 / 12 | 3,022,004 / 3,022,004 / 3,022,004 |
| Downie / dash | 3/3 | 0.28 / 0.47 / 0.46 | 159.96 / 161.02 / 161.66 | 18 / 18 / 18 | 2,910,329 / 2,910,329 / 2,910,329 |

Downie HLS 的 CPU/RSS 只列第 2、3 轮；第 1 轮原始探针误把临时文件当成完成，资源窗口不能证明覆盖最终 remux/交付。最终第 1 轮文件本身已重新审计成功。

**不比较 scheme→output 与 API POST→terminal 的 elapsed。** Downie 的重复输入有用户确认，原记录含人类等待；两种技术完成里程碑也不同。所有 Downie 原始耗时仅作为原始观察保留，不能写成 V 比 Downie 快多少。

## 服务器请求与字节口径

这些是服务器成功写出的应用 body 字节计数，不含 HTTP 头/TCP 开销；成功写入 socket 缓冲不证明客户端已消费同样字节，也不等于 packet capture 的 wire bytes。日志不记录客户端 PID，按独立顺序试验的时间和 URL 路由关联；JSON 保留具体 1-based 行与窗口方法，不能将其视为进程绑定网络捕获。

`bench-v.py` 的 `started_epoch` 在 Sampler 的约 150ms 预热之前，`elapsed_s` 从其后计算。归因窗口因此加入 0.30s 的预热/调度 allowance，并在下一次 benchmark 起点截断，避免漏掉 V 的快速直链/DASH 请求；Downie 的起点没有这项偏移。

本样本 HLS 的 V 每轮读取 20 次 / 6,062,830 bytes，Downie 12 次 / 3,022,004 bytes。V 的日志可见对 720p 初始段重复读取，并读取 360p 初始段；Downie 每个选中 720p TS 段一次。DASH 两边均 18 请求，但 V 为 3,061,150 bytes、Downie 2,910,329 bytes。直链则 V 每轮 1 次 / 2,908,122 bytes，Downie 5 次，含探测 GET、HEAD 和两个 Range，body 总量随中断时机变化为 5,005,274–7,454,644 bytes。不能用其中一种格式宣称某产品整体网络成本更低。

## Downie 九个最终产物

每项都重新完整解码退出 0、360 帧；下表是最终目录中的真实文件，排除了原始探针的临时路径。完整 hash 存在 JSON；相同类别三轮的最终 hash 一致。

| 轮次 | 最终文件 | bytes | 容器秒 | SHA-256 前 16 位 |
|---|---|---|---|---|
| direct-1 | [downie-output/direct-1/direct.mp4](</Users/mingjie/Documents/github/personal-projects/v-download-research/downie-2026-10-15/runtime/downie-output/direct-1/direct.mp4>) | 2,908,122 | 12.000000 | `644677695f2da8aa` |
| direct-2 | [downie-output/direct-2/direct.mp4](</Users/mingjie/Documents/github/personal-projects/v-download-research/downie-2026-10-15/runtime/downie-output/direct-2/direct.mp4>) | 2,908,122 | 12.000000 | `644677695f2da8aa` |
| direct-3 | [downie-output/direct-3/direct.mp4](</Users/mingjie/Documents/github/personal-projects/v-download-research/downie-2026-10-15/runtime/downie-output/direct-3/direct.mp4>) | 2,908,122 | 12.000000 | `644677695f2da8aa` |
| hls-1 | [downie-output/hls-1/master.m3u8.mp4](</Users/mingjie/Documents/github/personal-projects/v-download-research/downie-2026-10-15/runtime/downie-output/hls-1/master.m3u8.mp4>) | 2,910,461 | 12.032000 | `4ca80643dd71b78c` |
| hls-2 | [downie-output/hls-2/master.m3u8.mp4](</Users/mingjie/Documents/github/personal-projects/v-download-research/downie-2026-10-15/runtime/downie-output/hls-2/master.m3u8.mp4>) | 2,910,461 | 12.032000 | `4ca80643dd71b78c` |
| hls-3 | [downie-output/hls-3/master.m3u8.mp4](</Users/mingjie/Documents/github/personal-projects/v-download-research/downie-2026-10-15/runtime/downie-output/hls-3/master.m3u8.mp4>) | 2,910,461 | 12.032000 | `4ca80643dd71b78c` |
| dash-1 | [downie-output/dash-1/manifest.mpd.mp4](</Users/mingjie/Documents/github/personal-projects/v-download-research/downie-2026-10-15/runtime/downie-output/dash-1/manifest.mpd.mp4>) | 2,908,044 | 12.032000 | `2fdc4c4281fc2046` |
| dash-2 | [downie-output/dash-2/manifest.mpd.mp4](</Users/mingjie/Documents/github/personal-projects/v-download-research/downie-2026-10-15/runtime/downie-output/dash-2/manifest.mpd.mp4>) | 2,908,044 | 12.032000 | `2fdc4c4281fc2046` |
| dash-3 | [downie-output/dash-3/manifest.mpd.mp4](</Users/mingjie/Documents/github/personal-projects/v-download-research/downie-2026-10-15/runtime/downie-output/dash-3/manifest.mpd.mp4>) | 2,908,044 | 12.032000 | `2fdc4c4281fc2046` |

## 内容选择、字幕、恢复与错误样本

| 场景 | Downie | V | 结论边界 |
|---|---|---|---|
| annotated MP4 | 与源文件 SHA-256 一致；English mov_text + 3 chapters | A/V 完整、3 chapters；subtitle stream 为 0 | V 此路径丢内嵌字幕，不能只用 A/V 成功宣称内容保真 |
| 请求 360p HLS | 640×360，12.032s；12 请求 / 1,199,344 bytes | 1280×720，12.032s；20 请求 / 6,062,830 bytes | V 该流程没有兑现请求的 360p；不将其扩大为所有解析器都忽略质量 |
| UGE 最终产物 | `Local synthetic download fixture.mp4`，640×360，12.032s，完整 360 帧 | 本审计没有运行对等 UGE 流程 | 这里只核验主代理保留的 UGE 输出，不重做 UI |
| 音频提取 | direct.mp4 → MP3，12.010667s，483,066 bytes，完整解码 | UI 的 watch/dash → MP3，12.010667s，109,944 bytes，完整解码 | 输入入口和编码输出不同，证明各自能力；不横比性能、码率或文件体积 |
| 中途断开 /disconnect.mp4 | 25.0264s 原始观察窗口无最终文件；8 请求 / 917,504 bytes | 23 个连续 Range 请求后得到完整可解码文件；2,908,122 body bytes | V 该样本恢复成功；Downie 只描述窗口内未完成，不宣称永远无法恢复 |
| HTTP403 / HTTP404 | 各约10s观察窗无最终文件；每场4请求、108 body bytes | API terminal error，无输出；403为2请求/72 bytes，404为6请求/216 bytes | 错误样本不放入有效媒体成功率分母；本审计不评判 UI 文案 |

### Pause / restart 的真实请求

V 的暂停/恢复样本：日志第188行 `bytes=0-` 已写598,016 bytes后中断；第189行再次 `bytes=0-`，写出完整2,908,122 bytes。最终文件完整解码通过。

Downie 的暂停/退出重开样本：第365行 `bytes=0-1999999` 已写1,073,152 bytes后中断；重启后第375行再次请求 `bytes=0-1999999` 并写满2,000,000 bytes，第376行请求剩余 `bytes=2000000-2908121`，写908,122 bytes。后两行重新覆盖完整文件，而不是从原1,073,152字节位置继续。最终 `slow-pause-relaunch/slow.mp4` 与源文件字节相同并完整解码成功。

这两个具体流程都观察到从0重下；不能推广为所有网站、所有下载引擎的断点行为。Downie 的任务恢复存在最终成功结果，但它不能等同于本样本的字节级续传。

## 无效原始测量：保留原文件，以新 receipt 覆盖结论

1. `downie-hls-1.json` 原 outputs 是 `master.m3u8.downiepart/...mp4`，3,020,408 bytes；原 0.17s 检测值和CPU/RSS不能当作完整交付。最终 `master.m3u8.mp4` 是2,910,461 bytes，已独立验证。
2. `downie-slow-pause-relaunch.json` 原 outputs 是 `.downiepart` 下2,000,000-byte片段；104.7367s检测值、105.5731s观察值不是最终完成时间。原 sampler 只跟旧PID41896，未纳入重开后的PID72565，故整个任务CPU/峰值内存无效。不能用其0.75s CPU或251.41MiB与V慢速任务比较。
3. 原始JSON未改写，JSON审计保存其SHA-256和无效原因；独立最终文件的成功判据与这些无效性能数据分开。

## 源文件和关键输出身份

| 对象 | SHA-256 |
|---|---|
| fixture sample-720.mp4 | `644677695f2da8aa3137b31244ac82fdfc6934b9f30766371c29d950a2d322bf` |
| fixture sample-annotated.mp4 | `037ec6dd3df74fb1118a6a492b543eed49672025ed62a482f9b3779e94b4c260` |
| fixture sample-360.mp4 | `d268daf0b476dab4bb4f0c470748d50ffba0ca486940fbfabd48bee8ec5a7f1a` |
| Downie direct-1 | `644677695f2da8aa3137b31244ac82fdfc6934b9f30766371c29d950a2d322bf` |
| Downie hls-1 | `4ca80643dd71b78c216df7695152fb8d44d7ca4ec3760909e550495f6825cd9e` |
| Downie dash-1 | `2fdc4c4281fc20466d6f1f0fd84adec0a69ad61335cea35870e11bd5f786a008` |
| Downie annotated | `037ec6dd3df74fb1118a6a492b543eed49672025ed62a482f9b3779e94b4c260` |
| Downie hls-request-360 | `371672cde46ea8fb28643b0bd00c9ff09fb2276a1d7979dab0528e67e939e117` |
| Downie audio-direct | `457a0c79d15581536b67fcc81c409b12195bd6f1f390973e2de7335508961145` |
| V direct-1 | `d48a95ca49de5d6520ee2e57093e51716b7a32f344e0f82131da0a6b95e2c5b8` |
| V annotated | `508c41e11a37135c788493d13320492431d1db222cf29a25ae4acdb7ce578dcd` |

Downie direct三轮、annotated和slow分别与相应源文件hash一致。V直链三轮彼此hash一致，但与源MP4容器hash不同；完整解码通过，不据此推断A/V损失或字节原样保留。remux产物应同时按流、时长、帧数、字幕与章节检查。

审计快照：服务器日志416行、127,162 bytes，SHA-256 `e39bccda03676d35c76670d16b992fc8207509db236af30fc2c6876057315003`；共享日志之后可能继续追加，JSON的行号和hash仅指这次读取的字节。工具身份、每个原结果/sample文件的hash均在机器回执。
