# V-Download UI 验收记录

本轮实现 Raycast 基调与灰阶层次，覆盖队列、抖音与合集选择、画质/图片/笔记选择、详情、通用/下载/浏览器/站点/MCP/高级设置、首次引导、迷你窗口、确认弹窗和 Dock。设计文档与 tokens 已同步。只修改 UI、文案和呈现交互；保留工作区原有改动、下载引擎、分页限制、选择默认值、设置字段、IPC 与数据库结构。

## 实机结果

通过 `make run` 启动 Electron，应用保持运行。逐页检查了设置与下载队列，切换深色/浅色及 English/简体中文/繁體中文；完成后恢复原来的系统语言、深色主题，关闭测试打开的迷你窗口。

用户提供的抖音主页成功从 35 项继续加载到 77 项。初始为零选择；全选后显示“下载所选（77）”，全部加载后隐藏加载按钮。实际滚动到列表底部，底部下载操作仍然可见。没有重复加入这批下载。原有 79 条完成记录仍在，作者文件夹保留 77 个顶层条目（69 个文件、8 个图集目录）。

原生“更多”菜单也检查了 Enter 打开、Escape 关闭和焦点恢复；键盘操作不会误选父级下载行。

## 自动检查

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck`（renderer + main） | 通过 |
| `test:selection`、`test:profile-picker-selection`、`test:collection-picker` | 通过 |
| `test:presentation`（画质、详情、设置、速度、批次、状态、迷你窗口等） | 通过 |
| `test:i18n` | 通过，657 个键 × 3 种语言 |
| `test:ui-contract` | 通过，26 个 renderer 文件及 24 个扩展文件 |
| `test:settings-integration`、`test:onboarding`、`test:task-overrides` | 通过 |
| `test:dock-progress` | 通过，多窗口、进度范围、任务数、`99+`、空闲清理、跨平台与静态图标一致性 |
| `npm run build` | 通过，main/preload/renderer 均构建成功 |

额外代理检查最初被过期的静态断言阻挡。已将小红书断言更新为明确检查现有的 `{ proxyUrl: options?.proxyUrl }` 参数传递；下载引擎未修改，测试重新运行通过。

## 边界与键盘验证

独立测试入口使用真实组件与内存 API，不连接 Electron IPC、用户数据库或用户文件；入口已在验收后移除。

| 场景 | 已验证内容 |
| --- | --- |
| 主窗口 900×480 | 选择、画质、图片、笔记、引导与确认窗口的主按钮留在可见范围，列表单独滚动 |
| 迷你窗口 320×420 | 链接输入、继续按钮、暂停和打开完整应用均可见 |
| 列表状态 | 加载、空列表、部分加载、受限、全部完成、初始失败与长标题 |
| 抖音选择 | 初始不选、增减选择、Shift 范围、Cmd+A 全选、完成后隐藏加载按钮 |
| 合集选择 | 两个复选框独立增加选择；普通行点击独占选择；Shift 选择范围 |
| 画质选择 | 推荐项、输出格式、可用大小、方向键切换 radio 与 tab |
| 焦点 | Tab/Shift+Tab 循环，跳过闭合折叠区中的控件；Escape 关闭并恢复触发控件焦点 |
| 下载详情 | 失败恢复操作突出、原始错误折叠、未知指标不显示 |
| 首次引导 | 四个原有步骤，浏览器/连接标为可选，技术配置折叠 |

更多测量结果见 [layout-checks.json](layout-checks.json)。

## 截图

实机截图：

- [抖音 77 项全选，浅色简体中文](screenshots/profile-complete-light-zh-CN.png)
- [列表滚动到底部](screenshots/profile-scrolled-light-zh-CN.png)
- [下载队列，深色简体中文](screenshots/queue-dark-zh-CN.png)
- [下载队列，浅色简体中文](screenshots/queue-light-zh-CN.png)
- [下载设置，深色简体中文](screenshots/downloads-settings-dark-zh-CN.png)
- [浏览器设置](screenshots/browser-dark-zh-CN.png)
- [站点设置](screenshots/sites-dark-zh-CN.png)
- [MCP 设置](screenshots/mcp-dark-zh-CN.png)
- [高级设置](screenshots/advanced-dark-zh-CN.png)
- [通用设置，浅色繁体中文](screenshots/general-light-zh-TW.png)
- [迷你窗口](screenshots/mini-light-zh-CN.png)

内存测试场景截图：

- [抖音完整列表，深色英文](screenshots/profile-complete-fixture-dark-en.jpg)
- [抖音受限状态，浅色简体中文](screenshots/profile-restricted-light-zh-CN.jpg)
- [合集，浅色繁体中文](screenshots/collection-light-zh-TW.jpg)
- [画质，深色简体中文](screenshots/format-dark-zh-CN.jpg)
- [图片，浅色繁体中文](screenshots/gallery-light-zh-TW.jpg)
- [笔记，深色简体中文](screenshots/note-dark-zh-CN.jpg)
- [失败详情](screenshots/inspector-failed-dark-zh-CN.jpg)
- [首次引导](screenshots/onboarding-light-en.jpg)

[Dock 状态预览](screenshots/dock-state-preview.jpg)使用实际导出的应用图标，展示空闲、2 个任务与 `99+`。这张图明确标为示意图。当前截图工具无法直接捕获系统 Dock，因此没有把预览当成实机 Dock 截图；实际系统进度条与角标调用由 `test:dock-progress` 验证，原生显示外观仍由 macOS 决定。

本轮采用 `make run` 验收路径，没有另行导出 DMG。
