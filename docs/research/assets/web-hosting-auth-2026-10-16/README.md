# 网页托管／认证研究证据

对应报告：[web-hosting-auth-2026-10-16.md](../../web-hosting-auth-2026-10-16.md)。

- `installation.json`：安装 App 元数据与 app.asar SHA-256。
- `source-index.json`：HEAD 和当前工作区相关源码 SHA-256；HEAD 本身不包含此前所有实现改动。
- `engine-extractors.txt`／`.json`：安装引擎禁用外部插件目录时列出的 1,752 个注册提取器名称和摘要；不等于网站数量或逐站成功验证。
- `results.json`：10 个受控场景与 8 个公网元数据样本。
- `results-extra.json`：TikTok 元数据样本与公网 MP4 完整下载；查询时的上游 HEAD。
- `probe.py`／`probe-extra.py`：独立复现脚本，不属于产品测试／运行时。

从仓库根目录复现（会覆盖本目录结果 JSON；历史证据需先另存）：

```sh
PYTHONDONTWRITEBYTECODE=1 python3 docs/research/assets/web-hosting-auth-2026-10-16/probe.py --output docs/research/assets/web-hosting-auth-2026-10-16/results.json --public
PYTHONDONTWRITEBYTECODE=1 python3 docs/research/assets/web-hosting-auth-2026-10-16/probe-extra.py
```

脚本固定使用本机安装包内引擎和研究时的 Node 路径，迁移到其他机器需显式调整；上游 HEAD 字段是本轮记录值。`--public` 仅做公网元数据探测，补充脚本另下载一个小型公开 MP4。真实站点均没有登录／导入账号。

本地服务、媒体和 synthetic Cookie 使用临时目录，正常结束后清理。保留的请求日志仅记录 Cookie 是否存在，不记录 Cookie 值。没有个人浏览器 profile、Cookie、下载媒体、完整 yt-dlp dump、短期 CDN URL 或环境变量快照。

10 个受控结果符合预期，9 个公网元数据中 6 个成功／3 个失败，1 个公网 MP4 下载及完整解码成功。一次探测不代表站点成功率；本机引擎结果不代表完整 App、Linux 或云端行为。
