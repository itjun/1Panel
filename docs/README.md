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
| [构建目录说明](../build/README.md) | Wails 平台构建配置与资源 |
| [macOS 安装指南](macos-install.html) | 随 DMG 提供的离线引导页面：拖入应用程序、首次放行与常见问题 |
| [发布与应用更新](release-and-update.html) | 发版流程、更新清单、签名及故障排查 |
| [Agent 部署](agent-deployment.md) | systemd 与守护进程两种运行方式及管理命令 |

## 平台和实现记录

| 文档 | 用途 |
| --- | --- |
| [窗口材质验证](window-material-validation.md) | macOS、Windows、Linux 材质策略与验证范围 |
| [Linux 系统外观](linux-appearance.md) | 跟随系统深浅色的实现、验证与已知边界 |
| [界面改动记录](uiux-rollout-20261018.md) | 2026 年 10 月界面落地与验证记录 |

## 本地验收资料

通知中心的详细验收记录和截图位于 `docs/design/notification-center/`，临时构建与桌面验收结果位于 `tmp/`。这些目录按现有 Git 规则忽略，不随仓库分发；配置与设置目录中已有的受控验收文档继续保留。
