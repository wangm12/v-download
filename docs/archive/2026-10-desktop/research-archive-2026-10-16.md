# 研究目录归档与清理（2026-10-16）

> 历史记录，已归档。本文保留当时的基线、观察和验收范围；当前桌面状态见 [DESKTOP_STATUS](../../DESKTOP_STATUS.md)，网页版执行计划见 [web-download](../../plans/web-download.md)。旧优先级建议不自动成为当前待办。

`v-download-research` 是此前研究、受控样本与隔离测试的工作目录，应用运行、源码构建和正式数据没有依赖它。检查未发现活动进程或现有任务输出使用该目录。

旧报告直接引用的证据已复制到 [归档目录](assets/research-archive-2026-10-16)，核对复制前后 SHA-256 后修正 Markdown 链接。已有 `docs/research` 报告和各轮证据保持在正式项目中。

- 原始路径、测量时间、命令与 JSON 内的测试路径保留历史含义，没有改写成新的运行环境。
- 已在此前清理的媒体文件仍未恢复；缺失历史目标记录于 [manifest](assets/research-archive-2026-10-16/manifest.json)。
- 隔离测试认证密钥、运行时端口记录与无关临时材料没有复制进项目。
- 独立研究目录先移到废纸篓，后经用户再次明确要求，于 2026-10-16 永久删除。只删除指定研究目录，未清空废纸篓的其他内容；已归档证据继续保留。
- `/Applications/V-Download.app`、正式项目源码、用户设置与下载历史、Downloads 中安装包，以及 `Documents/V-Download Backups` 中回滚备份不受影响。
