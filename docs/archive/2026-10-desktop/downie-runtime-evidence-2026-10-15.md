# Downie 4.7.27 运行证据复核

> 历史记录，已归档。本文保留当时的基线、观察和验收范围；当前桌面状态见 [DESKTOP_STATUS](../../DESKTOP_STATUS.md)，网页版执行计划见 [web-download](../../plans/web-download.md)。旧优先级建议不自动成为当前待办。

> 2026-10-16 整理：独立研究目录已删除，仍被报告引用的证据已归档。正文中的原测试路径保留为历史条件；详见 [归档说明](research-archive-2026-10-16.md)。

研究日期：2026-10-15（America/Los_Angeles）。对象为 `/Applications/Downie 4.app`，版本4.7.27 / build4787。本附录由研究主执行者的真实界面操作、独立fixture服务日志、保存的截图及产物记录整理；附录作者只读复核，没有控制UI、启动应用或改动产品源码。

**独立audit已完成**：[审计说明][AUDIT]、[完整机器回执][AUDITJSON]。双方各九个MP4/HLS/DASH最终文件全部通过fresh ffprobe与完整A/V解码；原始证据未改写。成功边界仅为这些自有样本，不能采用原JSON的布尔值或时间直接推算网站成功率/速度。

DR编号是本附录条目索引，不是REA Evidence ID；原生反编译Evidence仍由native附录拥有。

## DR01 · 身份、环境与允许解释的范围

- **运行事实**：用户表示将手动打开后，主调查观察到Downie正常运行，先前LaunchServices `-10669` / `spctl rejected` 已不再阻塞本轮操作；没有单独诊断恢复原因。[process sample][S01] 明确记载4.7.27 (4787)、路径与 **X86-64 (translated)**；它不是原生arm64运行测量。
- **观察条件**：使用Downie既有profile，研究前当前队列为空；没有清除用户Cookie。媒体请求只使用自有loopback fixture，不能称为匿名公网测试，也不能据此推论中文站/真实网站覆盖。V的独立profile/生产main bootstrap条件另见[V附录§7][V07]。
- **任务入口**：主调查用文档化 `downie://XUOpenURL` scheme，指定研究destination；重复项和多候选存在人工确认。不是与V Remote API完全相同的交互或计时边界。
- **设置**：批量720p阶段临时并发1、连接1、Limit720p；后测Limit360p。Postprocessing全局None未改，audio通过scheme或逐任务选择。bench-results的conditions是模板文字，不能代替每阶段的真实设置/PID记录。[General before][S02] 与[restored][S03] 保留原始AX事实。
- **证据等级**：**观察**＝主调查实际操作/读取；**事实**＝本附录可从保存截图、请求记录、probe/audit直接复核；**推断**＝因果或产品判断；**未知**＝没有对应证据。主调查仅在聊天中保留的AX观察会明确标明，不冒充已保存raw AX。

## DR02 · MP4 / HLS / DASH 重复任务

主调查分别对直接MP4、HLS master、DASH manifest进行三次任务。独立audit重新选取.downiepart外的最终文件，核对稳定性、时长、完整A/V解码退出0及360视频帧。两边均各3/3，总计各9个有效文件；输入都是自有12秒合成媒体，不是九个真实站点或随机样本。

| case | 原始记录 | Downie最终文件事实（每轮相同） | 独立audit |
|---|---|---|---|
| direct-1/2/3 | runtime/bench-results/downie-direct-{1,2,3}.json | H.264＋AAC，1280×720；2,908,122 bytes，12.000000s；hash前16位644677695f2da8aa。 | 3/3完整解码360帧；与源MP4字节相同。 |
| hls-1/2/3 | runtime/bench-results/downie-hls-{1,2,3}.json | H.264＋AAC，1280×720；2,910,461 bytes，12.032000s；hash前16位4ca80643dd71b78c。 | 3/3完整解码360帧；hls-1最终文件有效，但原临时文件计时/资源作废。 |
| dash-1/2/3 | runtime/bench-results/downie-dash-{1,2,3}.json | H.264＋AAC，1280×720；2,908,044 bytes，12.032000s；hash前16位2fdc4c4281fc2046。 | 3/3完整解码360帧。 |

[完成截图][S04] 只能证明画面中对应任务显示Finished；最终技术判断来自audit。audit命令使用 `-xerror -err_detect explode` 完整解码A/V到null，不覆盖输出；字幕/章节另查，不能把A/V通过当作全metadata保留。

## DR03 · annotated MP4：字幕与章节

- **audit事实**：同一自有annotated输入，Downie输出保留English `mov_text`与三个章节，且与输入SHA-256完全相同：`037ec6dd3df74fb1118a6a492b543eed49672025ed62a482f9b3779e94b4c260`。A/V完整解码通过。[原始case][S05]、[audit][AUDIT]。
- **V对照**：V的direct FFmpeg路径输出丢失本例已有mov_text字幕，三个章节仍保留。其生产边界没有显式字幕保留/选择合同；`-c copy`不等于全轨映射。见[V§7.1][V071]。
- **推断边界**：本例支持把“保留输入已有字幕”列为V的具体改进，不能推广为Downie下载任意外部字幕成功、V丢弃所有metadata，或所有字幕codec均有同样结果。

## DR04 · Limit360p的执行

**观察＋audit事实**：主调查在Settings选Limit360p后，新HLS任务输出640×360 H.264＋AAC，12.032000s、1,127,180 bytes、完整360帧；master同时提供720p/360p。[原始case][S06]、[audit][AUDIT]。hash为`371672cde46ea8fb28643b0bd00c9ff09fb2276a1d7979dab0528e67e939e117`。

**V对照**：同样将研究实例默认质量改360p后，V Remote Job仍输出720p；实际走yt-dlp direct `-f best`，不是FFmpeg。见[V§7.2][V072]。这与FormatDialog没有传精确format_id又是两个不同边界。

**重要限制**：[General AX第66行][S02] 的tooltip说明：若只有高于上限的源，会选择最小可用视频。因此Downie的Limit不应被概括为“永不超过上限”；本例只证明有360p候选时正确选择。

## DR05 · UGE：从网页候选到队列

- **截图可复核**：[UGE截图][S07] 地址为自有 `/watch/hls`，右栏只有一个 `Root HLS Stream · HLS Stream` 候选，有+操作；不是把所有网页链接平铺成下载结果。
- **主调查观察**：点击+后成功得到媒体输出；Options读取 `Merge related HLS Streams=1`、compatibility layer=1，未更改。Options当前值来自本次CUA AX观察，未保存单独raw AX，不以旧帮助图片替代。
- **audit产物事实**：[downie-uge-output.json][S08] 对应最终文件为640×360 H.264＋AAC，12.032000s、1,127,180 bytes、完整360帧，SHA-256与DR04完全相同。相同产物不单独证明两条解析管道内部相同。
- **与native的关系**：本例与已有HLS候选整理/类型分流静态结构相互支持，但没有恢复完整分组等同性规则，也不能据一条root候选宣称任意站点master/variant去重都正确。见[native附录][NATIVE] N2/N3/N7。
- **可借鉴**：把root、variant、音轨与页面关系呈现为可完成的选择路径。V已有扩展嗅探和tab/frame/epoch归属，不能写成“需从零增加嗅探”。

## DR06 · 重复输入确认

[duplicate-confirmation截图][S09] 可直接复核：再次输入direct.mp4，弹出已下载提示，允许Download或Skip，并提供Don't ask again。它证明这条URL的重复确认交互；不证明不同画质/音频/目录目标如何参与去重identity。

这比静默聚焦旧任务更容易解释“再次下载”，但有额外交互成本。重复benchmark的scheme→output时间包含此类人工确认，不能与V API提交时长直接排名。

## DR07 · 活动下载中的中途断连

**fixture事实**：`/disconnect.mp4` 每次最多发送131,072 bytes就主动关闭连接，支持Range；V已经有23次连续Range覆盖完整源文件的证据。

- **Downie观察**：[case][S10] 没记录到最终输出；[截图][S11] 显示 `Failed download due to network error`。主调查手点Retry后再次同样失败。不能把记录的观察窗口结束称为永久不支持全部网络恢复。
- **V已证行为**：[V§7.3][V073] 在本例同一活动FFmpeg任务内连续Range重连，完整取得源字节；排除了旧文件复用。这个结果是本例恢复机制差异，不能扩大为所有CDN/直播或pause/relaunch行为。
- **推断**：V本例的引擎级重连有效，应保留；Downie的Retry入口可操作，但错误归因仍很粗。无需为跟随竞品移除已有能力。

## DR08 · 暂停、正常Quit与再次启动

1. **截图事实**：[Paused][S12] 显示slow.mp4暂停。正常Quit时[警告][S13] 说明当前下载不能resume并会abort；这是当时用户可见提示，不是完整恢复协议说明。
2. **主调查观察**：确认Quit后旧PID41896退出，新PID72565启动；恢复两个未完成任务、清除已完成队列项，slow自动重新下载。这里验证的是正常Quit/relaunch，不是强杀、崩溃或断电。
3. **请求事实**：[server log365][S14] 的旧请求从0开始，仅传1,073,152 bytes后断开；[375][S15] 新启动的首请求仍从0开始，传完整首段2,000,000 bytes；[376][S16] 再取2,000,000–2,908,121，共908,122 bytes。**恢复的是任务，旧进程已收字节没有在本次恢复后被接续。** 后一个Range只代表新传输自己的分块，不是旧任务字节续传。
4. **audit最终事实**：`slow-pause-relaunch/slow.mp4`完整解码360帧，且与源文件字节相同。原[slow case][S17] 错把.downiepart中2MB片段当成稳定文件，不能用它的104.7367秒或旧PID采样作为完成/CPU测量。
5. **V对照**：V的pause/resume实际也从byte0重下，UI初始仍保留18%；yt-dlp `--continue`路径未由这个FFmpeg样例验证。见[V§7.5][V075]。
6. **V新增正常Quit/relaunch**：[V§7.9][V079] 已有complete与H.264/AAC约12秒输出probe；旧请求851,968 bytes后中断，恢复仍Range从0、重传完整2,908,122 bytes。该轮不属于上面九样本统计，主调查另补[最终完整解码回执](assets/research-archive-2026-10-16/downie-2026-10-15/runtime/v-relaunch-final-audit.json)，360帧通过；性能采样较晚开始。UI提示1个interrupted/API却queued，banner全部继续实际还重试3个historical error；这是恢复目标IDs在renderer→IPC丢失的独立范围问题，不能因最终完成忽略。

因此，两个产品都不能仅凭“恢复”按钮或重新出现的任务声明本例支持跨暂停/重开字节续传。Downie本例的任务重建进一步支撑native保存/加载入口；持久化完整字段和异常恢复保证仍未知。

## DR09 · 403 / 404、错误动作与分类

- **事实**：自有fixture固定403与404，不是站点账号登录流程。主调查两项均见Downie generic network error；[permission-finished截图][S18] 同时显示denied.mp4和missing.mp4两条网络错误。原始记录为[403][S19]、[404][S20]。
- **主调查AX观察**：失败Actions包含Retry、Remove、UGE、Open Browser、Copy URL、rename、save Metadata、Quick Look。菜单原始AX只保留在本聊天，**S11截图没有展开菜单**，不能声称本附录从截图逐项独立复核。
- **V对照事实**：[V 403结果][V403] 是HTTP202创建job后，终态为 `auth_required` 并提示登录；不能把它称为API提交直接403。
- **V结构归因**：[mediaResolver.ts:106](../../../src/main/mediaResolver.ts#L106)以403/forbidden归auth，[downloadManager.ts:2856](../../../src/main/downloadManager.ts#L2856)把action拼回error文本，[remoteJobService.ts:331](../../../src/main/remoteJobService.ts#L331)再交[apiJobsModel.ts:467](../../../src/main/apiJobsModel.ts#L467)从Sign in文案重新判断auth_required；这一类别又影响retry。应修产生边界的typed status/reason与展示动作，不只改最后一个标签。
- **比较判断**：Downie提供更多可见恢复动作，但本例403/404文案都较粗；V不能把任意403当作用户应该登录。失败种类与已知下一步应保留证据及未知。

## DR10 · 音频：区分两条路径

| 输入与意图 | 主调查观察 / 保存证据 | 可下的结论 |
|---|---|---|
| `/watch/dash`，scheme带postprocessing=audio | 弹8候选；主调查观察初始为Default None；[截图][S21] 是手选manifest与Audio后的状态（Selected1/8）。提交后为640×360 DASH→MP3，报Cannot find download URL，未得输出。[case][S22]；错误亦在S18顶部可见。 | 此次“页面→候选→所选DASH→音频”路径失败。不能推广所有Downie音频失败；初始None的观察与已手选Audio截图必须分开。 |
| `direct.mp4`，scheme带audio | 主调查观察95% Converting后Finished；[case][S23] 的MP3经audit完整解码，12.010667s、483,066 bytes；hash前16位457a0c79d1558153。 | Downie的直接媒体audio路径成功，不能因上一行失败说其没有音频提取。 |
| V同一`/watch/dash`音频意图 | 实际MP3产物成功；DB为mp3/128，row/Inspector仍显示视频·360。见[V§7.7][V077]。 | V本页路径可完成，但存在独立IPC状态传播缺口；不能用文件后缀修复陈旧cache，也不能把候选128kbps当输出固定码率保证。 |

三者并非完全相同的parser/所选format/编码参数；它们比较的是同页面或直链的用户目标能否完成，不用于编码质量或速度排名。

## DR11 · 输出目录无权限：交付仍未确定

**观察条件**：既有研究目录临时设0555，以scheme提交 `direct.mp4?case=permission` 并指定该destination；15秒后恢复0755。[权限记录][S24] 保存测试与恢复mode，files为空。

- **事实/观察**：S18最下方对应研究任务显示Finished，但指定目录始终为空。记录中没有最终交付文件。
- **未知**：是否忽略destination、fallback到别处、路径/错误处理或另有交付行为尚未核实。研究只对自身loopback历史过滤查询；[owned-history][S25] 的first-file archive strings为空，不能据此定位输出，不能证明文件丢失或确定fallback目录。
- **V对照**：[V§7.8][V078] 证明提交边界HTTP500、无job、无输出，generic Internal error；不是任务下载后清理/回滚成功。
- **判断**：两边都需要更可行动的storage/permission语义。V应修known expected failure类型；Downie本例只能写 **“UI Finished，但指定目录empty，交付/fallback未核实”**，不标成功或已证丢文件。

## DR12 · 不可用于排名的测量

| 原测量问题 | 处理规则 |
|---|---|
| `hls-1`递归找到.downiepart里的临时视频并提前结束 | 原计时、CPU/内存不覆盖完整交付，排除；最终文件另经audit验证，不覆盖原始记录。 |
| `slow-pause-relaunch`找到2MB临时部分文件 | 原104.7367秒不能叫完成耗时；最终文件由audit另查。 |
| sampler绑定旧PID41896，重启后未切到72565 | 不报告该case完整CPU/峰值RSS；旧PID退出后的空采样不是低资源消耗。 |
| scheme路径包含重复Download/多候选人工确认 | 不能与V Remote API提交→终态时间排名；需要统一交互与边界后才比较。 |
| Downie为X86-64 translated，复用既有profile；系统WebKit/XPC可重挂launchd | 架构、profile与完整进程家族覆盖不同；不能拿静态“native”标签替代实测公平性。 |
| 条件模板仍写初始720p/设置，而实际中途360p/重启 | 真实AX、case观察、PID和输出分别拥有事实；不盲信模板文字。 |
| 稳定文件轮询与ffprobe不等于完整解码/用户Finished | 成功标准必须绑定最终文件、期望流/时长与明确coverage；audit结果仍标验证方法，不扩大到所有媒体完整性。 |

原始JSON和截图保留为provenance，错误测量不删除；修正记录单列。V的100ms采样/轮询与warm条件同样有局限，见V§7.4。**本轮不给双方速度或资源排名。**

以下仅报告有效采样窗口中的warm观察，CPU为进程家族采样估计，RSS为同刻family RSS求和（共享页可能重复、短进程可漏采），不是完整私有内存峰值；Downie HLS只含第2/3轮。分轮数据/工具身份/原记录hash见audit，不含无效的slow重启测量。

| 应用/格式 | CPU秒范围 | family RSS峰值范围（MiB） | 每轮请求数 | 每轮服务器body bytes |
|---|---:|---:|---:|---:|
| V/direct | 0.05–0.13 | 470.12–473.70 | 1 | 2,908,122 |
| V/HLS | 0.68–0.80 | 576.36–606.41 | 20 | 6,062,830 |
| V/DASH | 0.05–0.08 | 493.14–513.98 | 18 | 3,061,150 |
| Downie/direct | 0.46–0.85 | 139.98–158.50 | 5 | 5,005,274–7,454,644 |
| Downie/HLS（第2/3轮） | 0.37–0.48 | 160.68–180.64 | 12 | 3,022,004 |
| Downie/DASH | 0.28–0.47 | 159.96–161.66 | 18 | 2,910,329 |

网络口径是服务器写出的body bytes，**不含headers/TCP，也不证明客户端实际消费了全部写出字节**；并非PID绑定packet capture。关联依据是顺序试验的时间与URL。HLS本例V有初始段重复/读取其他variant，Downie选中720p各TS段一次；direct则Downie含探测GET/HEAD和两个Range，总body更多。不能选一个格式宣称整体网络成本更低。scheme与API elapsed不作横比，cold run/统一用户动作耗时未测；agent任务tokens也未测。

## DR13 · 研究结束状态

- **保存AX可复核**：General before/restored均显示并发3、连接4、Automatically Select Best Quality、Automatically Start Download=1、PreferMP4=1、ForceMP4=0。[S02][S03]
- **主调查实际核对**：Destination恢复Downloads；全局Postprocessing None始终未改；研究任务从当前队列移除，输出仍留研究目录。研究前队列为空，未批量清空用户历史。
- **权限**：测试目录mode已由0555恢复0755，见S24；不能由此推断失败时已有完整文件被正确发布。
- 本附录没有读取既有Cookie/用户非研究下载历史；仅使用主调查已过滤的自身loopback历史JSON。既有profile仍意味着不能声称无凭据环境或匿名公网验证。

## 原始来源与交叉引用

所有相对case名均位于 `/Users/mingjie/Documents/github/personal-projects/v-download-research/downie-2026-10-15/runtime/`。下列链接使用绝对路径；audit补正最终产物判定，审计覆盖的原case记录hash复核未变。机器回执562,139 bytes，SHA-256为`b37d41889edc0df1fb8d8adb6581c89baae19118e4d982bc5af2e06d3e22b36f`，含最终文件完整hash、全量fresh ffprobe、decode命令/退出码/帧数、原记录hash及请求行。具体日志快照与之后新增的V relaunch等记录必须分开。

[AUDIT]: assets/research-archive-2026-10-16/downie-2026-10-15/runtime/downie-runtime-audit.md
[AUDITJSON]: assets/research-archive-2026-10-16/downie-2026-10-15/runtime/downie-runtime-audit.json

[S01]: assets/research-archive-2026-10-16/downie-2026-10-15/runtime/downie-process-sample.txt:2
[S02]: assets/research-archive-2026-10-16/downie-2026-10-15/runtime/downie-general-before.txt:58
[S03]: assets/research-archive-2026-10-16/downie-2026-10-15/runtime/downie-general-restored.txt:58
[S04]: /Users/mingjie/Documents/github/personal-projects/v-download/docs/research/assets/downie-2026-10-15/downie-runtime-completed.png
[S05]: assets/research-archive-2026-10-16/downie-2026-10-15/runtime/bench-results/downie-annotated.json
[S06]: assets/research-archive-2026-10-16/downie-2026-10-15/runtime/bench-results/downie-hls-request-360.json
[S07]: /Users/mingjie/Documents/github/personal-projects/v-download/docs/research/assets/downie-2026-10-15/downie-uge-hls.png
[S08]: assets/research-archive-2026-10-16/downie-2026-10-15/runtime/downie-uge-output.json
[S09]: /Users/mingjie/Documents/github/personal-projects/v-download/docs/research/assets/downie-2026-10-15/downie-duplicate-confirmation.png
[S10]: assets/research-archive-2026-10-16/downie-2026-10-15/runtime/bench-results/downie-disconnect.json
[S11]: /Users/mingjie/Documents/github/personal-projects/v-download/docs/research/assets/downie-2026-10-15/downie-failure-actions.png
[S12]: /Users/mingjie/Documents/github/personal-projects/v-download/docs/research/assets/downie-2026-10-15/downie-paused.png
[S13]: /Users/mingjie/Documents/github/personal-projects/v-download/docs/research/assets/downie-2026-10-15/downie-quit-warning.png
[S14]: assets/research-archive-2026-10-16/downie-2026-10-15/runtime/fixtures/server-requests.jsonl:365
[S15]: assets/research-archive-2026-10-16/downie-2026-10-15/runtime/fixtures/server-requests.jsonl:375
[S16]: assets/research-archive-2026-10-16/downie-2026-10-15/runtime/fixtures/server-requests.jsonl:376
[S17]: assets/research-archive-2026-10-16/downie-2026-10-15/runtime/bench-results/downie-slow-pause-relaunch.json
[S18]: /Users/mingjie/Documents/github/personal-projects/v-download/docs/research/assets/downie-2026-10-15/downie-permission-finished.png
[S19]: assets/research-archive-2026-10-16/downie-2026-10-15/runtime/bench-results/downie-403.json
[S20]: assets/research-archive-2026-10-16/downie-2026-10-15/runtime/bench-results/downie-404.json
[S21]: /Users/mingjie/Documents/github/personal-projects/v-download/docs/research/assets/downie-2026-10-15/downie-multiple-candidates.png
[S22]: assets/research-archive-2026-10-16/downie-2026-10-15/runtime/bench-results/downie-audio-ui-equivalent.json
[S23]: assets/research-archive-2026-10-16/downie-2026-10-15/runtime/bench-results/downie-audio-direct.json
[S24]: assets/research-archive-2026-10-16/downie-2026-10-15/runtime/downie-output-permission.json
[S25]: assets/research-archive-2026-10-16/downie-2026-10-15/runtime/downie-owned-history.json
[V07]: /Users/mingjie/Documents/github/personal-projects/v-download/docs/research/v-download-code-evidence-2026-10-15.md:236
[V071]: /Users/mingjie/Documents/github/personal-projects/v-download/docs/research/v-download-code-evidence-2026-10-15.md:240
[V072]: /Users/mingjie/Documents/github/personal-projects/v-download/docs/research/v-download-code-evidence-2026-10-15.md:249
[V073]: /Users/mingjie/Documents/github/personal-projects/v-download/docs/research/v-download-code-evidence-2026-10-15.md:255
[V075]: /Users/mingjie/Documents/github/personal-projects/v-download/docs/research/v-download-code-evidence-2026-10-15.md:287
[V077]: /Users/mingjie/Documents/github/personal-projects/v-download/docs/research/v-download-code-evidence-2026-10-15.md:306
[V078]: /Users/mingjie/Documents/github/personal-projects/v-download/docs/research/v-download-code-evidence-2026-10-15.md:324
[V079]: /Users/mingjie/Documents/github/personal-projects/v-download/docs/research/v-download-code-evidence-2026-10-15.md:331
[V403]: assets/research-archive-2026-10-16/downie-2026-10-15/runtime/bench-results/403.json:15
[NATIVE]: /Users/mingjie/Documents/github/personal-projects/v-download/docs/research/downie-native-evidence-2026-10-15.md:66
