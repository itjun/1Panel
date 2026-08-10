# 1Panel 官方源码对照笔记

来源仓库：https://github.com/1Panel-dev/1Panel  
本地快照路径（开发机）：`/tmp/1Panel/frontend`

> **2026-08 决策**：前端已整体切换为 Vue 3 + Element Plus + ECharts，
> 不再用 React 手搓 1Panel 视觉。见 `frontend/README.md`。

## 技术栈

| 层 | 技术 |
|---|---|
| 框架 | Vue 3 + Vite |
| UI | Element Plus 2.14 |
| 图表 | **ECharts 6**（按需注册） |
| 状态 | Pinia |
| 样式 | SCSS + CSS Variables |

## 关键源文件

| 用途 | 路径 |
|---|---|
| 亮色变量 | `src/styles/element.scss` |
| 暗色变量 | `src/styles/element-dark.scss` |
| 侧栏菜单 | `src/layout/components/Sidebar/index.scss` |
| Logo 组件 | `src/layout/components/Sidebar/components/Logo.vue` |
| 字标 SVG | `src/assets/images/1panel-logo.svg` |
| 图标 SVG | `src/assets/images/1panel-menu-logo.svg` |
| 状态环 | `src/components/v-charts/components/Pie.vue` |
| 流量折线 | `src/components/v-charts/components/Line.vue` |
| 看板页 | `src/views/home/index.vue` |
| 状态卡 | `src/views/home/status/index.vue` |

## 主色

- Light：`#005eeb`（`--panel-color-primary`）
- Dark：`#3d8eff`
- 菜单底：`rgba(0, 94, 235, 0.1)` / 宽 `180px`
- 菜单项高：`42px`，`margin: 7px 0`，`padding: 0 7px` 容器

## 图表要点

### 状态环（Pie.vue）

- 实际是 **polar 坐标系 + bar roundCap**，不是 gauge 系列
- 内圆 pie 做白底阴影盘
- 半径 `['71%', '80%']`，中心 title 富文本 `22px + 14px %`

### 流量图（Line.vue + home networkChart）

- `yData[0]=上行`，`yData[1]=下行`
- 面积渐变：主色 light-9→primary；蓝 rgba
- 线色：绿 / 黄 渐变（seriesStyle index+2）
- `formatStr: 'KB/s'`，grid `left/right: 65`
