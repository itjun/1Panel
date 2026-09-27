# 看板改为同进程内网只读 HTTP 网关

看板投屏改为浏览器访问：1Panel 进程内监听可配置端口（默认 8888），内网浏览器打开 `http://{私网IP}:{port}/{分组名}`。客户端不再内嵌看板视图，也不再开 Wails 独立看板窗。

**访问控制**：仅放行 `RemoteAddr` 为 IPv4 RFC1918 私网或 loopback；不信任 `X-Forwarded-For`。看板 API 只读（overview / disks / range / watch-instances / 设置切片）。

**分组路径**：`{group}` 即分组名（与 ID 同源，见 `groupid.Validate`，如 `01-cdcp-main`）。未分组不提供公开展板 URL。

**Considered Options**: 继续桌面独立窗（旧 ADR）；独立 agent 进程；同进程只读网关（采纳）。

**Supersedes**: [0001-board-mode-desktop-only](0001-board-mode-desktop-only.md)
