# 1Panel 文档索引

项目使用与开发入口见 [项目说明](../README.md)。代码路径以仓库根目录为起点，文档链接以各文档所在目录为起点。

## 术语和设计

| 文档 | 用途 |
| --- | --- |
| [项目术语](glossary.md) | 主机、分组、看板、通知和 Agent 的统一用语 |
| [设计文档索引](design/README.md) | 设计规范、各功能的实现与验收记录 |
| [视觉与交互规范](design/specification.md) | UI、CSS、主题、动效和窗口壳层改动的统一依据 |

## 构建和发布

| 文档 | 用途 |
| --- | --- |
| [开发与构建](../README.md#开发) | 开发环境、构建命令及根目录的一键构建脚本 |
| [项目官网](https://itjun.github.io/1Panel/) | 功能介绍、三平台下载与安装入口；源码位于 `website/`，由 Pages 工作流发布 |
| [全平台安装指南](https://itjun.github.io/1Panel/install.html) | macOS、Windows、Linux 的安装步骤、首次打开和运行依赖；源文件为 `docs/install.html` |
| [构建目录说明](../build/README.md) | Wails 平台构建配置与资源 |
| [macOS 详细安装指南](https://itjun.github.io/1Panel/macos-install.html) | 图形界面引导、清理隔离属性与重置签名命令；同一份页面也随 DMG 离线提供 |
| [发布与应用更新](release-and-update.html) | 发版流程、更新清单、签名及故障排查 |
| [Agent 部署](agent-deployment.md) | systemd 与守护进程两种运行方式及管理命令 |

官网由 `.github/workflows/pages.yml` 发布到 GitHub Pages，仅上传整理后的公开网站文件。
修改 `website/` 或安装指南并推送到 `main` 后自动部署；正式版发布成功后重新读取最新安装包链接。
全平台指南源文件为 `docs/install.html`；macOS 详细指南源文件为 `docs/macos-install.html`，网站和 DMG 复制同一份 macOS 内容。

## 平台和实现记录

| 文档 | 用途 |
| --- | --- |
| [窗口材质验证](window-material-validation.md) | macOS、Windows、Linux 材质策略与验证范围 |
| [Linux 系统外观](linux-appearance.md) | 跟随系统深浅色的实现、验证与已知边界 |
| [界面改动记录](uiux-rollout-20261018.md) | 2026 年 10 月界面落地与验证记录 |

## 本地验收资料

通知中心的详细验收记录和截图位于 `docs/design/notification-center/`，临时构建与桌面验收结果位于 `tmp/`。这些目录按现有 Git 规则忽略，不随仓库分发；配置与设置目录中已有的受控验收文档继续保留。
