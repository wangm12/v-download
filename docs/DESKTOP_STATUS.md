# 桌面版当前交付状态

截至 2026-10-16（America/Los_Angeles）。当前 Mac 版已经满足本轮用户需求；后续桌面功能建议暂停，当前新增工作仅是 [网页版实施计划](plans/web-download.md)。计划不代表网页版已经实现或部署。

## 已交付

| 范围 | 已完成内容 | 验收记录 |
| --- | --- | --- |
| 下载意图 | 精确格式、编码／帧率／HDR／音轨等选择，可保存方案；单条／合集／扩展共用策略与冻结请求 | [下载方案](archive/2026-10-desktop/download-plans-2026-10-15.md) |
| 输出与恢复正确性 | 360p 选择、MP3 状态、已有内嵌字幕／章节保留；启动恢复不误重试历史失败 | [四项修复](archive/2026-10-desktop/v-download-fixes-2026-10-15.md) |
| 资源数据 | 原始 URL、完整 Referer／来源上下文、稳定评分、独立候选；开发重载后的早期捕获与方案鉴权 | [数据正确性](archive/2026-10-desktop/browser-data-correctness-2026-10-15.md)、[首轮捕获／鉴权](archive/2026-10-desktop/extension-startup-auth-2026-10-15.md) |
| 候选与失败恢复 | 候选详情、按需识别、HLS 关系；浏览器重新捕获后继续同一任务、原方案与目录；403 访问拒绝分类 | [实现与验收](archive/2026-10-desktop/browser-capture-recovery-2026-10-15.md) |
| 详情与错误 | 完成前显示实际目标目录；404 与引擎缺失分开；切任务时详情局部状态隔离 | [目录／404](archive/2026-10-desktop/inspector-error-fixes-2026-10-15.md)、[最终审查](archive/2026-10-desktop/capture-review-install-2026-10-15.md) |
| 本机交付 | 1.1.7 / build 1.1.10 arm64 安装到 Applications；Chrome 扩展重载实测；数据／设置保留 | [最终审查与安装](archive/2026-10-desktop/capture-review-install-2026-10-15.md) |

此前已经存在的 yt-dlp／FFmpeg、中文站点 adapter、原生登录、引擎维护、HTTP／MCP、托盘／Dock 等能力继续保留，不将它们计作本轮从零新增。

## 已知边界

- 精确格式绑定原资源；重新捕获的新 URL 不能静默继承旧 format ID，当前会明确拒绝不兼容替换。
- 已修复已有内嵌字幕保留；独立字幕下载与语言策略尚未作为新功能交付。
- 同一 DASH 样本在本机所选 FFprobe 与包内 FFprobe 的识别结果不同；现有用户引擎设置保持原样。
- 认证状态存在 Cookie 不等于目标资源可访问；访客 Cookie、账号权限与浏览器条件还需区分。
- 当前远程 API 依赖运行中的桌面 App；逐任务下载方案与独立服务器不是现成功能。
- 本机 DMG 使用本地开发签名；没有因此完成公证、商店分发或正式更新 feed。
- 验收仅覆盖报告实际记录的样本与平台；没有声称真实登录／付费内容、全站点或跨平台完全通过。

## 如何阅读旧文档

[桌面历史归档](archive/2026-10-desktop/README.md) 保留原 Downie 研究、实现、安装、自审和证据；日期／原始路径表示当时条件。旧 [下一批优先级](archive/2026-10-desktop/next-priorities-2026-10-16.md) 是备选建议，已归档，不能当作仍需继续开发的承诺。

当前维护资料从 [文档总入口](README.md) 查阅。产品行为以当前源码与对应版本验收为准，历史报告中的旧缺陷不能直接当作仍然存在。

本次整理将前几轮实现保存为 [4aa8f77](https://github.com/wangm12/v-download/commit/4aa8f77)。提交前恢复锁定开发依赖后，完整 `npm test`、`npm run typecheck` 和 `npm run build` 通过；这不是再次打包／安装，也没有新增云端成功声明。
