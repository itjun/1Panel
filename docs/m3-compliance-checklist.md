# M3 设计规范合规验收清单

改造范围：1Panel 前端全站（Wails + Vue 3 + Element Plus）
方案：M3 baseline 静态配色（紫），令牌层换肤路线（EP 变量全量映射 M3 令牌）
分支：`itjun-m3-redesign`

## 逐页审计（2026-08-30 第二轮）

| 页面/区域 | M3 组件应对 | 当前状态 | 备注 |
|---|---|---|---|
| **侧栏 Navigation Drawer** | secondary-container 激活胶囊 56dp/28dp | ✅ 合规 | 用户确认唯一达标区域 |
| **主机详情一级导航**（12 子页） | Primary Tabs（下划线 + 单行滚动） | ✅ 已修 | 原 Segmented Button 换行不整齐，已改 Primary Tabs |
| **概览 OverviewView** | Outlined Card + surface 嵌套 | ✅ 已修 | 去掉统计区嵌套描边卡；内边距 16dp；标题 title-medium；描述列表去表格边框 |
| **概览监控切换**（流量/IO、时间范围） | Segmented Button（2~5 项） | ✅ 合规 | 全局 `:has(.el-radio-button)` 样式 |
| **进程 ProcessesView** | Filter Chip 工具栏 + Elevated 浮层 | ✅ 已修 | 去 el-card 嵌套；悬浮详情卡 12dp 圆角 + outline |
| **日志 LogsView** | 同进程页工具栏 | ✅ 已修 | 统一 `.view-toolbar` |
| **网络 NetworkView** | Outlined Card + Assist Chip | ⚠️ 部分 | IP 卡已 M3；表格 tag 仍用 EP 默认 |
| **文件 FilesView** | 独立暗色终端区 + Outlined | ⚠️ 部分 | 拖拽区已 M3；路径面包屑 hover 已修 |
| **终端 TerminalView** | 独立暗色 surface | ✅ 合规 | 不随亮色主题变浅（决策接受） |
| **应用/服务/Nginx/Docker 等** | EnlargableCard + 表格 | ⚠️ 部分 | 卡片容器 OK；部分列表 hover 仍待扫 |
| **全部主机首页** | Outlined Card 网格 | ✅ 已修 | hover 改状态层 |
| **分组概览** | 表格 + 主机列表 | ⚠️ 部分 | 表格 hover 已 M3；danger 行仍用 EP 语义色 |
| **设置弹窗** | Dialog 28dp + 表单 | ✅ 基本合规 | 主题色卡 active 已 M3 |
| **图表 ECharts** | primary/secondary/tertiary 序列 | ✅ 合规 | 细线 + 低透明面积 |
| **全局 Outlined Card hover** | 状态层 4%，无阴影 | ✅ 已修 | M3 Outlined 卡片 resting/hover 均无 elevation |
| **亮色 elevation 令牌** | 低对比度阴影 | ✅ 已修 | 浮层/对话框专用；不用于 Outlined 卡片 hover |

## 核心 M3 规则（本轮对照依据）

1. **Segmented Button**：仅用于 2~5 个互斥选项（如监控时间范围）；多页导航（≥6 项）必须用 **Primary Tabs**。
2. **Outlined Card**：描边 + surface-container-lowest 底；hover **不加 elevation**，仅用 on-surface 4~8% 状态层。
3. **Elevated Card / Menu / Dialog**：才使用 elevation-1~3；亮色主题阴影对比度低于暗色。
4. **Filter Chip**：secondary-container 选中态；工具栏单行排列，溢出横向滚动。
5. **Motion**（[easing & duration](https://m3.material.io/styles/motion/easing-and-duration/tokens-specs)）：
   - 状态层/描边 hover → `short3` + **standard**（`--m3-motion-state`）
   - 选中/卡片描边 → `short4` + **standard**（`--m3-motion-select`）
   - Dialog 进入 → `medium2` + **emphasized decelerate**；退出 → `short4` + **emphasized accelerate**
   - 遮罩淡入淡出 → `short4` + **standard**
   - 尊重 `prefers-reduced-motion`（时长压为 0）
   - 不做原生涟漪 / spring physics（GM3 Expressive）；Web 用官方 cubic-bezier 令牌

## 已知边界（路线决策时确认接受）

- Element Plus 组件 DOM 与 MDC 不同：涟漪、shape morph 等原生交互细节不做
- 表格行高 52dp / 按钮高度按 M3 默认密度（决策时确认接受单屏数据量下降约 30%）
- 终端/日志按决策保持独立暗色，不随主题变浅
- 进程虚拟表行高保留 34dp 紧凑密度（运维场景数据量优先，与 M3 默认 52dp 有偏差）

## 待续（低优先级）

- [ ] 网络/应用等页 EP `<el-tag>` 批量改 Assist/Suggestion Chip 样式
- [ ] EnlargableCard 标题区改用 title-medium 令牌
- [ ] 暗色主题全页目视回归（本轮主要修亮色）
