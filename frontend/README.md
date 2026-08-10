# iPannel 前端（1Panel 技术栈）

本目录已切换为与 [1Panel](https://github.com/1Panel-dev/1Panel) 对齐的前端技术栈，**不再维护手写 React/Tailwind 复刻**。

## 技术栈

| 库 | 用途 |
|---|---|
| **Vue 3** | 框架 |
| **Element Plus** | UI 组件（菜单、卡片、表格、表单…） |
| **ECharts** | 看板状态环 / 流量图（对齐 1Panel `v-charts`） |
| **Pinia** | 状态 |
| **Sass** | 样式；主题变量直接来自 1Panel 源码 |

## 与 1Panel 源码对应

| 本项目 | 1Panel 源路径 |
|---|---|
| `src/styles/element.scss` | `frontend/src/styles/element.scss` |
| `src/styles/element-dark.scss` | `frontend/src/styles/element-dark.scss` |
| `src/components/VChartPie.vue` | `frontend/src/components/v-charts/components/Pie.vue` |
| `src/components/VChartLine.vue` | `frontend/src/components/v-charts/components/Line.vue` |
| `src/assets/1panel-logo.svg` | `frontend/src/assets/images/1panel-logo.svg` |

## 归档

旧 React 实现保留在仓库根目录 `frontend-react/`，仅作参考，**不参与构建**。

## 命令

```bash
cd frontend
npm install
npm run dev     # 开发
npm run build   # 产出 dist/ 供 Wails 嵌入
```

## 功能迁移状态

| 模块 | 状态 |
|---|---|
| 主机列表 / 分组侧栏 | ✅ Element Plus Menu |
| 标签列 | ✅ |
| 概览看板（环图+流量） | ✅ ECharts 对齐 1Panel |
| 添加主机 | ✅ |
| 进程 / Docker / 文件 / 终端等 | ⏳ 占位，可按业务优先级从 `frontend-react` 迁移 |

后端 Go / Wails 绑定不变，仍走 `wailsjs/go/main/App`。
