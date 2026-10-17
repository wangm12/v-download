# DownieCore 原生证据复核（2026-10-15）

> 历史记录，已归档。本文保留当时的基线、观察和验收范围；当前桌面状态见 [DESKTOP_STATUS](../../DESKTOP_STATUS.md)，网页版执行计划见 [web-download](../../plans/web-download.md)。旧优先级建议不自动成为当前待办。

> 2026-10-16 整理：独立研究目录已删除，仍被报告引用的证据已归档。正文中的原测试路径保留为历史条件；详见 [归档说明](research-archive-2026-10-16.md)。

本附录只复核本次保存的 REA Evidence，没有启动或附加 Downie、v-download、Hopper，没有调用 REA 建立新会话，也没有操作运行中的媒体夹具。结论用于支撑产品比较；它们是**静态观察和受限推断**，不构成下载成功率、登录兼容性、恢复可靠性或性能的运行时证据。

## 目标身份与证据索引

必须区分两个分析对象：

| 对象 | 身份与用途 |
|---|---|
| 安装包中的通用 DownieCore | `/Applications/Downie 4.app/Contents/Frameworks/DownieCore.framework/Versions/A/DownieCore`；SHA-256 `1931e01249a987a7bd4ecb4f4c0cd2cbdfe2757a183b4420f1eea71d078240cd`。保存的 dispatch metadata Evidence 选择 **arm64**，ID `ev_e454d09cb11d311eff9811601ce6c33e2604995c371540093e4cf66efe880699`。这是通用文件的字节身份，架构字段指此次元数据解析选择。 |
| Hopper 分析的 x86_64 薄片 | `.../evidence/DownieCore-x86_64.macho`；SHA-256 `f0fde2019c1b3ea6bc391fd7cc3861a92e671409f869833cb4bf795967c0bb16`；Mach-O thin，**x86_64**。以下所有函数地址属于这个薄片，不是 arm64 地址，也不是运行中进程经过 ASLR 后的地址。 |

本附录另行只读解析原始 universal Mach-O 的 FAT header，并把其中 x86_64 区间与保留薄片**逐字节比较，结果相同**。因此这里的派生关系有原始字节支持，不只依赖文件名。原始 universal 总大小为 **33,866,592 bytes**：

| FAT slice | 原始文件 offset / size | slice SHA-256 |
|---|---|---|
| x86_64，cputype `0x01000007`，subtype `0x3` | offset **16,384**，size **17,136,864**，alignment power 14 | `f0fde2019c1b3ea6bc391fd7cc3861a92e671409f869833cb4bf795967c0bb16`；与 `DownieCore-x86_64.macho` 一致 |
| arm64，cputype `0x0100000c`，subtype `0x0` | offset **17,154,048**，size **16,712,544**，alignment power 14 | `ac72a3c5b571f3297595b33a20899d5ceb96d39ecbedfc938df0d49d3e0f4781` |

`file` 将两个 slice 都识别为 dynamically linked shared library；REA open 结果的 `kind:executable` 是分析目标分类，不能将 DownieCore 描述成独立可启动的应用程序。

Hopper profile digest 为 `39c6a81579824a9390dc8e4805fdf56f8635a26f8c56756920ed7529a94971b1`；provider version 记录的是 launcher SHA-256 `dad6f886261fad0d4cdd01aee6fcf57439c60d7b5c54e62fc97f0180116690e0`，不能直接当作 Hopper 产品版本号。当前安装对象另经本附录只读核验如下，没有运行 Hopper：

| 工具字段 | 核验值 |
|---|---|
| Hopper bundle | `/Users/mingjie/Applications/Hopper Disassembler.app`；identifier `com.cryptic-apps.hopper-web-4`；`CFBundleShortVersionString=6.6.0-demo`，`CFBundleVersion=42.6316032` |
| launcher | `Contents/MacOS/hopper`，170,784 bytes；SHA-256 `dad6f886261fad0d4cdd01aee6fcf57439c60d7b5c54e62fc97f0180116690e0`，与 REA profile 一致 |
| 主可执行文件 | `Contents/MacOS/Hopper Disassembler`，27,911,296 bytes；SHA-256 `ee1cc7a5e52ce291e4d6624713b3bd5943662894c19901c5fbbb64d702a9c137` |
| 签名 | `codesign --verify --deep --strict` 退出码 0；签名显示 `Developer ID Application: Cryptic Apps (2AMA2753NF)`，TeamIdentifier `2AMA2753NF`；CDHash `0ecf3e6aa6c831c01ee04c1ab7d6503ea8548c19`；显示 stapled notarization ticket |
| REA 工具环境记录 | `hopper-doctor.json`：CLI package 6.4.0、Node 24.19.0、SDK server/client/core 2.3.1；显式 Hopper scope healthy。其他 client registration/installed-skill 的诊断状态不用于判断这些离线 Evidence 的目标身份。 |
| Downie 应用版本 | 安装包 Info.plist：identifier `com.charliemonroe.Downie-4`，short version **4.7.27**，build **4787**。主程序为 x86_64 与框架含 arm64 是两个不同层级事实，不能据框架架构推断实际运行方式。 |

下表中的路径均位于 `/Users/mingjie/Documents/github/personal-projects/v-download-research/downie-2026-10-15/evidence/`。`normalized_result.pseudocode` 的行号是**保存的伪代码字符串行号**，不是原始 Swift 源码行号，也不是 JSON 文件行号。

| 简称 | Evidence / 文件 | 实际内容 |
|---|---|---|
| N1 | `ev_bfc8e6c5e82de638d3bf34dc7c3d3a1043ce1cb89b8404aa9c12ed03f0e7c995` / `core-process-integration-result.json` | `analyze_function`，`0x384fd0`，`CustomIntegrationExecution._processResult`；1,081 字符伪代码、59 条 assembly。 |
| N2 | `ev_e2726fd598c1ba94f78fd4e6172c85ef7b8ad7e13c1984305fe1b75d60bb68f4` / `core-uge-response.json` | `analyze_function`，`0x2e5c0`，`UGEResourceProcessor._processURLResponse`；228,196 字符伪代码、606 条 assembly。伪代码显著膨胀，不能按文本长度推断程序复杂度。 |
| N3 | `ev_c86e2e9bc60cf1e0ea16de67ed71e0f663b0c8d6dfa189727568024852bd2339` / `core-uge-grouping.json` | `analyze_function`，`0x2d540`，`UGEResourceProcessor.processItem`；60,159 字符伪代码、476 条 assembly。 |
| N4 | `ev_8867e70e49170ad8d4cc7f4cb66465638ecfa01ee0b54b8bd98ae9b89901935f` / `core-integration-urlmatch.json` | `analyze_function`，`0x604dd0`，`CustomIntegration.canHandleURL`；1,905 字符伪代码、93 条 assembly。 |
| N5 | `ev_b143e113558e0cc3566458ae9b701be062be8d8a62b7b337d76c73eee44147b8` / `core-uge-procedures.json` | 对 `UGEResourceProcessor` 的字面 procedure search，返回 293 项。是命名与地址清单，不是这 293 项的实现恢复。 |
| N6 | `ev_d02e7d227cb78f07d4d57457e59f9581d6f15fa7bbb126783d929ecac75b4d97` / `core-center-procedures.json` | 对 `DownloadCenter` 的字面 procedure search，返回 303 项。同样只建立命名线索。 |
| N7 | `ev_12a00e2c84116e700d11fc4891a9e295698b408297ad7b319150491545777d8c` / `core-hls-contains.json` | `analyze_function`，`0x2bd80`，`HLSDownloadItem.contains(URL)`；1,793 字符伪代码、76 条 assembly。 |
| N8 | `ev_2eb7c80c34df3926e3033d96691d438142f029429bcb39ce5b075265d34625ae` / `core-find-downloader.json` | `analyze_function`，`0x5b6520`，`PreparationOperation._findDownloaderClass`；318,693 字符伪代码、839 条 assembly。存在显著重复展开。 |
| N9 | `ev_94f3b2329ee310ab4b56a20fa5c600aba4ce3d2cdf83bae7c6ceba9fc9c6a4d0` / `core-save-unfinished.json` | `analyze_function`，`0x4a25f0`，`saveUnfinishedDownloads`；218 字符伪代码、5 条 assembly，实际是转发 wrapper。 |
| N10 | `ev_f620a85b112ea0696f7d583c426fb12b84f3fbabdc57cbab703cc503883de412` / `core-restore-session.json` | `analyze_function`，`0x4a52f0`，`restorePreviousSessionOrResetQueue`；2,509 字符伪代码、138 条 assembly。 |
| N11 | `ev_ead896991ea9b567b5a917521c4f9930d82a3b7d42f9e2462a900ca5bd106c49` / `core-start-next.json` | `analyze_function`，`0x5090a0`，`_startNextDownloader(allowResumingPausedDownloads:)`；2,287 字符伪代码、119 条 assembly，业务主体在异步闭包。 |
| N12 | `ev_b5923bd7148bd40e96fe586151067982dcfcb653b8e41d733eef32e685deca22` / `core-downloads-controller-procedures.json` | 对 `XUDownloadsController` 的字面 procedure search，返回 499 项，用于定位下一轮真实 closure 主体。 |
| N13 | `ev_6349389e50159f623dc0a88e0df944171db4c118cfe37aa3718f61b329e4dc28` / `core-save-body.json` | `analyze_function`，`0x4a5cb0`，保存 unfinished downloads 的 closure 主体；5,192 字符伪代码、168 条 assembly。 |
| N14 | `ev_a4e130e2deb32ac10630689a95fe27888ad00fdce45633d119a4349df522e1bf` / `core-restore-body.json` | `analyze_function`，`0x4a67f0`，恢复 closure thunk；80 字符伪代码、4 条 assembly，转到 `loadPersistedDownloaders`。 |
| N15 | `ev_7d968454b4a76d70046069845771a724bc73198592f3cf664027b08464eb930e` / `core-scheduler-body.json` | `analyze_function`，`0x50e740`，start-next 的外层 closure；552 字符伪代码、34 条 assembly，进入锁保护的 nested closure。 |
| N16 | `ev_2af1b8a1f76cf8730f0cc130c394e95bb15ef57e290c7293d19d3c26fd1e533a` / `core-queue-procedures.json` | 对 `XUDownloadQueue` 的字面 search，返回 0 项；仅表示此搜索未命中，不证明没有队列。 |
| N17 | `ev_9dd0047d5a61e8a3588cf9228e5f5d824e2df695897dfd2d68f61bdd5732682a` / `core-customintegration-procedures.json` | 对 `CustomIntegration` 的字面 search，返回 461 项；辅助命名清单，未将每个名称解释为已验证功能。 |

以上十七个 Evidence 的目标 SHA-256 与 x86_64 薄片一致。以下伪代码是人工压缩的结构说明；`UNKNOWN_*` 是明确留出的未知，不表示已经恢复同名原始函数。

### 导出 bundle 与会话结束记录

`rea-native-bundle.json` 是该 Hopper 会话的可携带证据：**1,750,867 bytes**，SHA-256 **`8e4e11f53a33a4600c711fb8bd101d1b1e6377851512ef50b92ef5498cad352f`**；含 **17 records（12 个 analyze_function、5 个 search_procedures）**、1 个 x86_64 artifact 与 1 个 Hopper provider。`native-export-receipt.json` 的 `structuredContent.result` 给出的 bytes/records 与实际文件相符。

这个“17”只计该原生会话；另行产生的 CLI UI/Interface Builder/arm64 dispatch Evidence 不在 bundle 内，仍需分别保留 `downie-interface.json`、`downie-ui-focused.json`、`downiecore-dispatch.json` 等原记录及派生说明。bundle 的 captures/scenarios/environments 数组为空；顶层 `unknowns:[]` 不能解释为研究没有未知或已完成运行时验证。

`native-close.json` 保存关闭返回 `structuredContent.result:null`，文件 SHA-256 `052cc72acfb75907e9ff703ebd805df08cd7d770bdebc4c2da17cf9d10cd8447`。本轮原生会话已经导出并关闭；本附录只读吸纳保存的记录，停止继续追函数。

## 八项可以用于产品比较的结论

### 1. 自定义 integration 的 URL 匹配使用完整 absoluteString，并有 regex 对象缓存

**证据级别：控制流与调用支撑的静态事实。** N4 / `0x604dd0` 在已有对象分支调用 `Foundation.URL.absoluteString.getter`、`String.matches(regex:)`；另一分支通过 `XUExceptionCatcher.performBlock` 构建对象，将其写回相同字段，再进行匹配。它不是仅从 `canHandleURL` 名称作出的判断。

```text
if cachedRegex exists:
    return matches(url.absoluteString, cachedRegex)
if configuredPattern passes the observed nonempty guard:
    candidate = constructRegexThroughExceptionCatcher(...)
    cache candidate
    return matches(url.absoluteString, candidate)
```

**限制：** 正则选项、URL 规范化、配置来源、异常后的准确返回行为尚未恢复；伪代码中的 `if (0x0 != 0x0)` 明显不能照字面解释。不能宣称 Downie 用正则覆盖了所有站点或此匹配路径实际命中过本次样本。

**可借鉴：** v-download 若扩展可维护的站点规则，应把“URL 是否适用”与“如何解析”分开；规则编译结果与错误可以由规则所有者管理。值得学习的是所有权与可解释性，不是照搬正则规则文本。

### 2. 自定义 integration 的结果入口存在 Swift 消息枚举分派；消息内容尚未恢复

**证据级别：部分控制流已恢复。** N1 / `0x384fd0` 获取 `JavaScriptBridge.Message` 元数据、复制消息，然后调用 `swift_getEnumCaseMultiPayload` 并跳向 `0x3852f0` 跳表计算出的地址。`EmbeddedDownload` 和 `Download` 类型访问器出现在同一函数，但这些访问器本身不等同于实际创建下载。

```text
copied = copy(message, MessageMetadata)
tag = swift_getEnumCaseMultiPayload(copied, MessageMetadata)
jump jumpTableAt(0x3852f0)[tag]
```

**限制：** 此 dossier 没有恢复跳表每个 case 的业务动作。不能据此写成“已证明支持哪几种 JS 返回 JSON、怎样校验、怎样入队”，也不能推断脚本执行权限或沙箱能力。`DownloadVWOcTm` 等 copy helper 是 Swift 生成代码，不是用户功能。

**可借鉴：** integration 与下载核心之间适合采用明确的结果契约；具体 schema 应从 v-download 的需要设计。本证据只支持 Downie 存在分派边界，不提供可直接重建的协议。

### 3. UGE 对响应 URL 有前置检查，并向主队列同步询问一个布尔条件

**证据级别：控制流与调用支撑。** N2 伪代码第 17–49 行先取 response URL，缺失时走日志/返回路径；调用 `_validateURL`（`0x36630`），失败也提前退出。随后第 67–78 行同步执行主队列闭包，并根据其布尔结果决定继续或退出。

```text
url = response.url
if url absent or not validateURL(url): return
if mainQueue.sync(UNKNOWN_GUARD(url, processor)): return
continue candidate classification
```

**限制：** `_validateURL` 和闭包主体尚未在这些 dossier 中恢复。不能把这个检查具体写成广告过滤、去重、协议白名单或 DRM 检查；主队列同步只证明这个决策存在调度边界，也不能直接推出其线程安全性和界面响应性能。

**可借鉴：** 为嗅探候选建立独立的过滤决策与可解释原因，避免将所有响应都直接变成可下载条目；实际规则应由 v-download 的输入事实与误报样本验证。

### 4. UGE 不是单纯 MIME 列表：它也会遍历已登记 downloader 类型，并为 HLS 建立专门候选

**证据级别：控制流、构造调用与注册表引用支撑。** N2 第 104–190 行访问 `XUDownloader.availableDownloaders` 数组，循环调用类型上的间接方法；命中后检测是否可转换成 `HLSDirectDownloader` 元类型。相应分支创建 `HLSDownloadItem(url:browserContext:customTitle:)` 并调用 `_insertItem`。另一分支构造 `DownloaderItem`。HLS 构造器地址为 `0x2c630`，普通 downloader item 构造器为 `0x33fd0`。

```text
for downloaderType in availableDownloaders:
    if UNKNOWN_TYPE_URL_MATCH(downloaderType, url):
        if UNKNOWN_TYPE_POLICY(...): take separate path
        else if downloaderType is HLSDirectDownloader:
            insert(HLSDownloadItem(url, browserContext, title))
        else:
            insert(DownloaderItem(downloader, browserContext, title))
        break
```

**限制：** 虚表槽 `0x5f`、`0x5b` 没有在此证据中可靠绑定为公开方法名称；不能从数值槽猜出 policy 含义或命中优先级。静态注册表不证明站点当日可用，HLS candidate 构造也不证明已下载、解析或合并 HLS。

**可借鉴：** 嗅探结果可以回流到已有解析器/下载器体系，页面发现与专用解析互补。v-download 的候选入口应尽量复用解析与下载契约，而不是再造一个独立、能力较弱的下载栈。

### 5. 响应分类包括字幕尝试、直文件处理及有条件的大小启发式 fallback

**证据级别：调用和 assembly 条件支撑。** N2 在读取 `NSHTTPURLResponse.contentType` 后调用 `_createSubtitleItem`（`0x368b0`）；返回非空则插入候选。未形成字幕候选时还有 `_processDirectFileURLResponse`（`0x2f950`）与 `_insertItemWithNoContentType`（`0x2f340`）路径。保存的 typed string 包含 `application/vnd.apple.mpegURL`；伪代码还出现 MIME 前缀比较，但部分 Swift 短字符串显示为碎片，不宜补写未经恢复的完整 MIME 清单。

两个大小比较可以由 assembly 独立核实：

- `0x2e96b` 读取 content type，`0x2e970–0x2e973` 在 optional 缺失时跳到 `0x2e9ba`；该处调用 `expectedContentLengthWithHeuristics`，`0x2e9bf` 比较 `0xf4241`（**1,000,001**），不足则跳过，达到才在 `0x2e9d9` 调用 fallback。
- `0x2eaf4` 同样读取推定长度，`0x2eaf9` 比较 `0x7a121`（**500,001**），达到后在 `0x2eb13` 调用 fallback。上游完整 MIME 条件尚未可靠恢复。

```text
if MIME exists:
    subtitle = createSubtitleItem(...)
    if subtitle exists: insert(subtitle)
    else: MIME-dependent direct/fallback paths
else if expectedContentLengthWithHeuristics(response) >= 1_000_001:
    insertItemWithNoContentType(url, response, browserContext)
```

**限制：** 这些阈值仅属于观察到的分支，**不是 Downie 下载文件的全局最小大小**。`expectedContentLengthWithHeuristics` 的内部实现未分析，不能当成永远等于响应 `Content-Length`。大小只使条目进入后续候选流程，不建立该内容一定是媒体。

**可借鉴：** 浏览器嗅探应兼顾缺失/错误 MIME，并将字幕作为候选类别；fallback 的来源、置信度和不确定性应可见。不要将 Downie 的数值阈值当作 v-download 的合理限制直接复制。

### 6. BrowserContext 随候选构造传递；其可见字段是 referer URL 与标题，不能据此宣称 Cookie 被保留

**证据级别：数据传递可见；字段语义部分来自命名。** N2 第 155–166 行把 `BrowserContext` 复制后传入 HLS item，构造普通 downloader item 时也传入该上下文。N5 中 `0x29000` 为 `BrowserContext.refererURL` getter，`0x29030` 为 `title` getter，`0x29060` 的初始化器名称也包含这两个字段。

```text
context = copied BrowserContext
candidate = HLSDownloadItem(url, context, customTitle)
insert(candidate)
```

**限制：** getter 的符号不是其整个实现恢复。现有证据没有证明 cookies、Authorization、浏览器会话或请求头如何附加到最终下载请求；`originalRequest` 出现在函数签名中也不等于每个字段已被使用。N6 中 `downloadCenterSessionIgnoresCookies`（`0x4bed60`）只是进一步线索，不能推断 getter 的返回值。

**可借鉴：** 将媒体 URL、页面 referer、页面标题及用户选择作为有来源的上下文保留到最终任务，比只传一个裸 URL 更有价值。认证数据的捕获、寿命与传递仍需要单独验证和设计。

### 7. HLS 候选整理受 options 控制，并检查 quality 数量后执行过滤与集合替换

**证据级别：结构可建立，具体分组语义仍是推断。** N3 / `0x2d540` 第 24–42 行读取 `UGECore.options`；某字节等于 1 时，将当前条目转换为 HLS item，并从已有 downloader items 取得 HLS 子集。第 42–60 行读取 `HLSDownloadItem.qualities` 内某数组的数量，在数量至少为 2 的分支调用 filter；后续调用 partition 与 `replaceSubrange`，并向 delegate 发送间接回调，再追加新条目。

可独立定位的调用包括 `0x2d705 -> 0x35880`（HLS filter）、`0x2dac0 -> 0x34220`（HLS contains 闭包）。N5 还观察到 `collapsedItems` getter/setter（`0x2bbd0` / `0x2bc10`）及 `HLSDownloadItem.contains(URL)`（`0x2bd80`）。

```text
if UNKNOWN_OPTIONS_BYTE == 1 and item is HLSDownloadItem:
    existingHLS = existingItems.compactCast(HLSDownloadItem)
    if observedQualityArrayCount(item) >= 2:
        selected = existingHLS.filter(UNKNOWN_PREDICATE)
        remove/replace selected existing entries
        notify delegate about removed entries
append item
```

**限制：** 无法由现有闭包名和数组操作确定“同一视频”的精确判断：URL 相同、master/variant 包含、quality 交集、签名参数、跨页面 identity 等均未建立。`collapsedItems` 的存在支持折叠功能线索，但不能把它的所有写入效果自动归因于当前函数。这个路径可称“候选分组/去重相关整理”，应保留推断标签；尚不能写成已复原完整去重算法。

**可借鉴：** 浏览器嗅探不应把 master、variant、音轨和重复片段平铺为几十个等价条目。先建立媒体候选与候选关系，再做 UI 折叠，是比新增更多 MIME 后缀更有价值的方向；身份判据必须由 v-download 自己的 producer 与真实请求证据拥有。

**追加核验（N7）：** `0x2bd80` 的实现现在已经恢复到比符号命名更深的一层：从 `qualities` 取出 `XUVideoQuality` 数组，执行 `Sequence.contains(where:)`；若未命中，继续对 `XUSubtitleQuality` 数组执行另一个 contains。assembly `0x2bdf3` 与 `0x2be57` 对两个类型数组复用同一 specialization helper；`0x2be18–0x2be1c` 实现短路。两次判断分别传入不同 closure，故能证明视频 quality 与字幕 quality 都参与 membership，但 closure 的 URL 相等性和规范化仍未知。不能升级为“已证明所有片段、master、字幕按同一 URL 等值规则折叠”。

### 8. UGE 的结果不是单一 URL 集合：下载、字幕与图片经过类型分流，并有插入前判断

**证据级别：动态类型检查、独立集合更新支撑；判断条件未知。** N3 先检查 `DownloaderItem`；不适用后在伪代码第 524–588 行检查 `SubtitleItem`，第 593–620 行检查 `ImageItem`。字幕与图片分别访问对象的 `+0x50` / `+0x48` 集合，在布尔闭包判断后进行追加。N5 中 `imageResults`（getter `0x2d350`）与 `subtitlesResults`（getter `0x2d3f0`）进一步佐证其独立结果集合。

```text
switch observed dynamic type:
    DownloaderItem -> downloader results path
    SubtitleItem   -> guarded append to subtitle results
    ImageItem      -> guarded append to image results
```

**限制：** 闭包的等同性谓词未在这些 dossier 中恢复，不足以断言 URL 级或内容级去重，也无法确认跨会话持久化、排序、展示默认值或图片实际下载行为。类型分流只建立内部表示，不单独证明全部 UI 入口可用。

**可借鉴：** v-download 的嗅探体验可以围绕“可解释的内容候选”组织，把视频、音频、字幕与图片关系呈现给用户。分组与去重应保留来源，不能下游再从显示文本重新解释原始请求。

## 追加复核：解析器选择与队列恢复边界

### PreparationOperation 确实调用了响应探测入口

N8 / `0x5b6520` 的实现不止有 `_findDownloaderClass` 名称：它实际读取 URL host、访问 `availableDownloaders` 并循环进行类型方法判断；某些未直接返回的路径读取 URL scheme/path，调用 `sendHEADRequestViaGET(to:allowRedirects:requestModifier:)`。assembly **`0x5b67ef`** 确认调用目标为 **`0x210f50`**。伪代码该路径传入 `allowRedirects: 1`，在获得响应后检查 `statusCode < 400`，并继续 MIME/文件等分类。返回类型的编译元数据包含 `(downloaderType, url, suggestedName?, mimeType?)`，显示选择结果携带修正后的 URL 与可选描述，而非只返回一个类名。

这个结论可用于说明 Downie 的“输入 URL → downloader 选择”存在网络探测 fallback 和结构化结果。**它没有恢复 `sendHEADRequestViaGET` 的内部 HTTP 行为**，故仍不知道 body 下载量、取消时机、超时或 Cookie 如何使用；伪代码中的大量重复块不代表同一路径会重复发送几十次请求。`isDirectFile` 与 `application/octet-stream` 的调用/字符串存在，但完整 MIME 接受策略和所有拒绝条件仍未可靠复原。

### 保存主体已证实持久化写入调用；恢复主体仍停留在下一层入口

N9 / `0x4a25f0` 是 **5 条指令的 wrapper**：加载 closure `0x4a6530`，跳转共享实现 `0x4a3d90`。新增 N13 / `0x4a5cb0` 则恢复了保存业务主体：遍历 controller 中的 downloader 集合，调用 nested closure `0x4a5f70` 得到可选 `[String:Any]`，仅收集非空结果，桥接成 Objective-C array，调用 `NSUserDefaults.standardUserDefaults.setObject(...,forKey:...)`；再调用 **`Queues.save`（`0x509cb0`）** 与 `NSUserDefaults.synchronize`。没有条目时也有保存空数组的路径。

这已经超出符号命名，足以确认**存在下载状态字典集合的持久化写入路径**。但 nested closure 的过滤条件与具体字段、UserDefaults key 的可靠解码、Queues.save 的字段/媒介、调用入口何时执行及实际磁盘耐久性仍未建立。`synchronize` 的存在也不证明进程崩溃时所有状态都已可靠落盘。

N10 / `0x4a52f0` 能建立两支控制流：读取 `resetQueueOnLoad` 布尔值；为真时调用 `NSUserDefaults.standardUserDefaults.removeObjectForKey`，为假时在主队列异步调度 closure **`0x4a67f0`**。新增 N14 证实这个 closure 是 4 条指令 thunk，实际调用 **`loadPersistedDownloaders`（`0x509380`）**。对应 key 的真实构造未建立，不能把 dossier 中被 Hopper 显示为 `1 Waiting to Start` 的 typed string 直接当作队列持久化 key。读取、反序列化与重建动作仍在尚未分析的下一层；本轮在此停止。

```text
saveUnfinishedDownloads():
    tailcall sharedWrapper(closureAt(0x4a6530))

saveClosureAt(0x4a5cb0):
    saved = []
    for downloader in controllerCollection:
        dictionary = nestedClosureAt(0x4a5f70)(downloader)
        if dictionary exists: saved.append(dictionary)
    UserDefaults.setObject(saved, forKey: UNKNOWN_KEY)
    controller.queues.save()
    UserDefaults.synchronize()

restorePreviousSessionOrResetQueue():
    if resetQueueOnLoad:
        UserDefaults.removeObject(forKey: UNKNOWN_KEY)
    else:
        mainQueue.async(closureAt(0x4a67f0))

restoreThunkAt(0x4a67f0):
    controller.loadPersistedDownloaders() // target 0x509380, body not inspected
```

因此最终可写“**保存路径有字典集合写入 UserDefaults、Queues.save 与 synchronize 调用；启动恢复路径已连接到 loadPersistedDownloaders 入口**”，并将完整保存/读取/重建链路标为**部分验证**。不能写“所有任务状态完整持久化”“正常退出必定保存”“崩溃不会丢任务”或“退出重开可继续原字节进度”。运行时仍需检验路径是否被调用、数据能否恢复与失败后行为。

### Start-next 入口保留显式策略布尔值，尚未揭示调度规则

N11 / `0x5090a0` 把 `self` 与 `allowResumingPausedDownloads & 1` 捕获进对象，然后在主队列异步调度 closure **`0x513b40`**。这一点比仅有符号更强，说明“是否允许恢复暂停项”的调用者策略传到了后续闭包。新增 N15 / `0x50e740` 恢复了外层业务 closure：取出 controller 持有的锁，经 `NSRecursiveLock : XUCore.Lock` witness 调用 `XUCore.Lock.perform(locked:)` 执行 nested closure；该层尚不包含挑选下一任务、并发容量、排序或实际 start/resume 调用。

```text
capture = { controller: self, allowResumingPausedDownloads: flag & 1 }
mainQueue.async(closureAt(0x513b40), capture)

outerClosureAt(0x50e740):
    controllerLock.perform(locked: UNKNOWN_NESTED_SCHEDULER)
```

这里的“resuming paused downloads”是调度层命名，**不等于已证明 HTTP Range 或字节级断点续传**。它也不能证明暂停是保留 socket、取消请求、保存 downloader 状态还是重新下载。

## 只有命名线索、尚未建立的机制

N6 的 `sendHEADRequestViaGET`（`0x210f50`）已有 N8 提供实际调用边的补充，但仍没有该函数主体的伪代码，不能宣称已经证明“GET 收到 headers 便取消”“所有请求都这样探测”或没有下载 body。`downloadCenterSessionIgnoresCookies` 也没有证明返回值或影响范围。

`resume.0` 这类后缀常见于 Swift `_modify` coroutine 的编译产物；例如 N5 中 `collapsedItems...vM.resume.0`、`imageResults...vM.resume.0`、`userAgent...vM.resume.0`。**这些符号不是下载断点续传或退出恢复的证据。** 同理，`dispatch thunk`、metadata accessor、value witness、retain/release、array capacity helper 不应计为独立产品能力。

这些native文件本身仍无法回答：真实并发数、暂停是否终止网络请求、Range 续传、失败退避、队列持久化的完整字段及读取重建链路、启动恢复结果、临时文件原子交付、FFmpeg 参数、登录会话共享、DASH 成功率、当前站点覆盖以及安装包新版行为。主报告必须使用其他静态边界或运行时证据回答，或明确未验证。早期本机启动受阻之后，后续已观察到应用正常运行；所测恢复、Range、DASH及产物结论见[运行附录](downie-runtime-evidence-2026-10-15.md)，不由这里静态可见的入口反推。

## 本轮停止点与保留的定向定位

以下地址全部来自已保存的符号或 calls，不是根据命名规则猜测的新地址。它们记录剩余论证缺口，**本轮不再执行分析**；不影响已完成证据导出与会话关闭。

| 地址（x86_64 薄片） | 已观察符号 | 下一步需要回答的问题 |
|---|---|---|
| `0x4a5f70` | 保存主体中的 nested dictionary closure（N13） | 哪些 downloader 被保存、字典字段、状态与路径如何表达、不可保存条目如何处理。 |
| `0x509380` | `loadPersistedDownloaders`（N14） | 实际读取/解码/对象重建/旧数据失败处理；当前只恢复到它的调用边。 |
| `0x50e7c0` | `_startNextDownloader` 的 nested closure（N12） | 调度容量、候选排序、暂停项策略和实际 start/resume 分支。外层 closure `0x50e740` 也是已观察的入口；先沿控制流，不按后缀猜测。 |
| `0x36630` | `UGEResourceProcessor._validateURL` 的 specialization | 精确接受/拒绝哪些 URL；是否涉及 scheme、资源后缀、已处理状态；不要先假定是广告过滤。 |
| `0x210f50` | `XUDownloadCenter.sendHEADRequestViaGET` | 实际 HTTP method、重定向策略、何时停止 body、如何传 requestModifier；确认探测成本与 Cookie 行为的边界。 |

## 反编译质量与结论使用方式

Hopper 是对已编译机器码恢复近似表示，不是恢复原始 Swift 源码。当前代码包含小字符串优化、泛型 specialization、copy-on-write 数组、protocol witness、虚表调用和 enum 跳表。它们导致同一 assembly 区域在伪代码中大幅重复展开，甚至出现不可靠的常量条件、错误参数归属、`UNKNOWN_REGISTER` 及 UI 文本碎片。N2 和 N3 的全部行数不可按原始结构解释。

涉及关键阈值与分支时，本附录交叉检查了 assembly；涉及未恢复的间接调用只保留 `UNKNOWN_*`。`body.available:false` 明确表示 Hopper 公开 Python API 未提供完整函数体范围；`native_value_flow:null`、`native_api:null`、`relationship_coverage:null` 是未建立事实，不能当作“无动态行为”。`unresolved_calls:[]` 也不保证所有间接调用都已解析。

本附录可用于比较的最稳妥结论是：**Downie 的 UGE 在静态结构上有候选校验、类型分流、上下文传递与候选整理，而不仅是收集媒体 URL。** 这些机制怎样改善实际体验，需要与主报告的界面、任务实测和失败恢复结果相互核对。任何性能或成功率的排序都不能由上述函数大小、符号数量或静态架构单独推出。
