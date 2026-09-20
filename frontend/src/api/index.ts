/**
 * Wails v3 绑定封装
 * 所有后端调用统一走 wails3 generate bindings 生成的强类型绑定（frontend/bindings/）
 */
import * as Hosts from "../../bindings/diteng-pannel/hosts";
import * as Groups from "../../bindings/diteng-pannel/groups";
import * as Overview from "../../bindings/diteng-pannel/overview";
import * as Monitor from "../../bindings/diteng-pannel/monitor";
import * as Agent from "../../bindings/diteng-pannel/agent";
import * as Files from "../../bindings/diteng-pannel/files";
import * as TerminalSvc from "../../bindings/diteng-pannel/terminalsvc";
import * as Certs from "../../bindings/diteng-pannel/certs";
import * as Icons from "../../bindings/diteng-pannel/icons";
import * as System from "../../bindings/diteng-pannel/system";
import * as Backup from "../../bindings/diteng-pannel/backup";
import * as AlertHistory from "../../bindings/diteng-pannel/alerthistory";
import * as NotifySubs from "../../bindings/diteng-pannel/notifysubs";
import * as LocalApps from "../../bindings/diteng-pannel/localapps";
import * as LocalSys from "../../bindings/diteng-pannel/localsys";

// 模型类型命名空间（与 v2 的 @wailsjs/go/models 对应）
export * as monitor from "../../bindings/diteng-pannel/internal/monitor/models";
export * as aptsource from "../../bindings/diteng-pannel/internal/aptsource/models";
export * as agentcli from "../../bindings/diteng-pannel/internal/agentcli/models";
export * as agentapi from "../../bindings/diteng-pannel/internal/agentapi/models";
export * as agentinstall from "../../bindings/diteng-pannel/internal/agentinstall/models";
export * as sshconfig from "../../bindings/diteng-pannel/internal/sshconfig/models";
export * as groups from "../../bindings/diteng-pannel/internal/groups/models";
export * as filetext from "../../bindings/diteng-pannel/internal/filetext/models";
export * as alerthistory from "../../bindings/diteng-pannel/internal/alerthistory/models";
export * as notifysubs from "../../bindings/diteng-pannel/internal/notifysubs/models";
export * as localapps from "../../bindings/diteng-pannel/internal/localapps/models";
export * as localsys from "../../bindings/diteng-pannel/internal/localsys/models";
export * as main from "../../bindings/diteng-pannel/models";

import type { CancellablePromise } from "@wailsio/runtime";
import type * as agentcli from "../../bindings/diteng-pannel/internal/agentcli/models";
import type * as agentinstall from "../../bindings/diteng-pannel/internal/agentinstall/models";
import type * as alerthistory from "../../bindings/diteng-pannel/internal/alerthistory/models";
import type * as notifysubs from "../../bindings/diteng-pannel/internal/notifysubs/models";
import type * as filetext from "../../bindings/diteng-pannel/internal/filetext/models";
import type * as groups from "../../bindings/diteng-pannel/internal/groups/models";
import type * as localapps from "../../bindings/diteng-pannel/internal/localapps/models";
import type * as localsys from "../../bindings/diteng-pannel/internal/localsys/models";
import type * as main from "../../bindings/diteng-pannel/models";
import type * as monitor from "../../bindings/diteng-pannel/internal/monitor/models";
import type * as sshconfig from "../../bindings/diteng-pannel/internal/sshconfig/models";
import { noteBackendCall } from "@/utils/uxPerf";

// 保留原有类型导出名，视图层零改动
export type HostIcon = main.HostIcon;
export type RuntimeCounts = monitor.RuntimeCounts;
export type LocalTextCheck = main.LocalTextCheck;
export type CertInfo = monitor.CertInfo;
export type CertListResult = monitor.CertListResult;
export type CertPairCheck = main.CertPairCheck;

/** v3 调用可能以 null 解析（如后端返回零值时），统一兜底 */
async function arr<T>(p: CancellablePromise<T[] | null>): Promise<T[]> {
  return (await p) ?? [];
}
async function str(p: CancellablePromise<string | null>): Promise<string> {
  return (await p) ?? "";
}
async function must<T>(p: CancellablePromise<T | null>): Promise<T> {
  const r = await p;
  if (r === null || r === undefined) throw new Error("后端返回空值");
  return r;
}

const apiImpl = {
  listHosts: () => arr(Hosts.ListHosts()),
  listHostsAll: () => arr(Hosts.ListHostsAll()),
  addHost: async (input: main.AddHostInput): Promise<void> => {
    await Hosts.AddHost(input);
  },
  testConnection: (input: main.AddHostInput): Promise<string> =>
    str(Hosts.TestConnection(input)),
  renameHost: async (oldName: string, newName: string): Promise<void> => {
    await Hosts.RenameHost(oldName, newName);
  },
  updateHost: async (input: main.UpdateHostInput): Promise<void> => {
    await Hosts.UpdateHost(input);
  },
  deleteHost: async (name: string): Promise<void> => {
    await Hosts.DeleteHost(name);
  },
  getHostPassword: (name: string): Promise<string> =>
    str(Hosts.GetHostPassword(name)),
  formatHostInfo: (name: string): Promise<string> =>
    str(Hosts.FormatHostInfo(name)),

  listGroups: () => arr(Groups.ListGroups()),
  upsertGroup: async (g: groups.Group): Promise<void> => {
    await Groups.UpsertGroup(g);
  },
  renameGroup: async (id: string, newName: string): Promise<void> => {
    await Groups.RenameGroup(id, newName);
  },
  setBoardTitle: async (id: string, title: string): Promise<void> => {
    await Groups.SetBoardTitle(id, title);
  },
  moveGroup: async (id: string, parentID: string): Promise<void> => {
    await Groups.MoveGroup(id, parentID);
  },
  reorderGroups: async (parentID: string, orderedIDs: string[]): Promise<void> => {
    await Groups.ReorderGroups(parentID, orderedIDs);
  },
  reorderGroupHosts: async (groupID: string, orderedNames: string[]): Promise<void> => {
    await Groups.ReorderHosts(groupID, orderedNames);
  },
  previewDeleteGroup: (id: string) =>
    must(Groups.PreviewDeleteGroup(id)),
  deleteGroup: async (id: string): Promise<void> => {
    await Groups.DeleteGroup(id);
  },
  assignHost: async (host: string, groupID: string): Promise<void> => {
    await Groups.AssignHost(host, groupID);
  },
  subtreeHostNames: (id: string) => arr(Groups.SubtreeHostNames(id)),

  listGroupOverview: () => arr(Overview.ListGroupOverview()),
  listOneGroupOverview: (groupID: string): Promise<main.GroupOverview> =>
    must(Overview.ListOneGroupOverview(groupID)),

  /** 本地已记录的发行版图标，不访问远程 */
  listHostIcons: () => arr(Icons.ListHostIcons()),
  /** 强制远程探测一台主机并落盘 */
  refreshHostIcon: (host: string): Promise<main.HostIcon> =>
    must(Icons.RefreshHostIcon(host)),
  /** 只补齐没有记录的主机 */
  refreshMissingHostIcons: () => arr(Icons.RefreshMissingHostIcons()),
  /** 强制重新探测全部主机 */
  refreshAllHostIcons: () => arr(Icons.RefreshAllHostIcons()),

  // ============ Agent（状态与历史数据，来自目标主机上的 spanel-agent） ============
  agentStatus: (host: string, force = false): Promise<agentcli.Status> =>
    must(Agent.AgentStatus(host, force)),
  agentCurrent: (host: string): Promise<agentcli.CurrentResponse> =>
    must(Agent.AgentCurrent(host)),
  agentRange: (
    host: string,
    from: number,
    to: number,
    src = "auto"
  ): Promise<agentcli.RangeResponse> => must(Agent.AgentRange(host, from, to, src)),
  agentSummary: (host: string): Promise<agentcli.SummaryRange[]> =>
    arr(Agent.AgentSummary(host)),
  agentEvents: (host: string): Promise<agentcli.AgentEvent[]> =>
    arr(Agent.AgentEvents(host)),
  agentWatchStatus: (host: string) => arr(Agent.AgentWatchStatus(host)),
  agentWatchInstances: (host: string) => arr(Agent.AgentWatchInstances(host)),
  agentAppShutdown: (
    host: string,
    req: agentcli.AppShutdownReq
  ): Promise<agentcli.AppShutdownResult> => must(Agent.AgentAppShutdown(host, req)),
  agentWatchRange: (
    host: string,
    service: string,
    from: number,
    to: number
  ): Promise<agentcli.WatchRangeResponse> =>
    must(Agent.AgentWatchRange(host, service, from, to)),
  agentWatchEvents: (
    host: string,
    service: string,
    from: number,
    to: number
  ) => arr(Agent.AgentWatchEvents(host, service, from, to)),
  agentGetWatch: (host: string): Promise<agentcli.WatchYAML> =>
    must(Agent.AgentGetWatch(host)),
  agentPutWatch: async (host: string, yamlText: string): Promise<void> => {
    await Agent.AgentPutWatch(host, yamlText);
  },

  agentProbeInfo: (host: string): Promise<agentinstall.ProbeInfo> =>
    must(Agent.AgentProbeInfo(host)),
  agentLatestVersion: (): Promise<string> => str(Agent.AgentLatestVersion()),
  checkAgent: (host: string): Promise<agentcli.CheckReport> =>
    must(Agent.CheckAgent(host)),
  installAgent: async (host: string): Promise<void> => {
    await Agent.InstallAgent(host);
  },
  batchInstallAgent: async (
    hosts: string[] | null
  ): Promise<main.AgentBatchResult[]> => arr(Agent.AgentBatchInstall(hosts)),
  uninstallAgent: async (host: string, keepData: boolean): Promise<void> => {
    await Agent.UninstallAgent(host, keepData);
  },

  collectOverview: (host: string): Promise<monitor.Overview> =>
    must(Monitor.CollectOverview(host)),
  collectDisks: (host: string) => arr(Monitor.CollectDisks(host)),
  collectProcesses: (host: string, limit: number) =>
    arr(Monitor.CollectProcesses(host, limit)),
  collectJava: (host: string) => arr(Monitor.CollectJava(host)),
  /** 运行时进程列表（java/go/node/bun/python，含部署方式/端口/入口） */
  collectRuntimeProcs: (host: string, runtime: string) =>
    arr(Monitor.CollectRuntimeProcs(host, runtime)),
  /** 各运行时正在运行的进程数（进程页标签数字徽标） */
  collectRuntimeCounts: (host: string): Promise<monitor.RuntimeCounts> =>
    must(Monitor.CollectRuntimeCounts(host)),
  /** 单个运行时进程补充详情（悬浮卡片：工作目录/exe 路径/磁盘 IO） */
  collectJavaDetail: (host: string, pid: number): Promise<monitor.JavaProcDetail> =>
    must(Monitor.CollectJavaProcDetail(host, pid)),
  collectRuntimes: (host: string) => arr(Monitor.CollectRuntimes(host)),
  collectNetwork: (host: string): Promise<monitor.NetworkSnapshot> =>
    must(Monitor.CollectNetwork(host)),
  /** 远程主机 /etc/hosts（只读） */
  collectHosts: (host: string): Promise<monitor.HostsInfo> =>
    must(Monitor.CollectHosts(host)),
  collectAptSources: (host: string) => must(Monitor.CollectAptSources(host)),
  collectDocker: (host: string): Promise<monitor.DockerInfo> =>
    must(Monitor.CollectDocker(host)),
  collectServices: (host: string) => arr(Monitor.CollectServices(host)),
  collectServiceDetail: (host: string, name: string): Promise<monitor.ServiceDetail> =>
    must(Monitor.CollectServiceDetail(host, name)),
  collectCrons: (host: string) => arr(Monitor.CollectCrons(host)),
  /** 识别 /etc/nginx/cert 下的证书 */
  collectCerts: (host: string): Promise<monitor.CertListResult> =>
    must(Monitor.CollectCerts(host)),
  /** 本地校验证书+私钥配对（不上传） */
  checkCertPair: (localPaths: string[]): Promise<main.CertPairCheck> =>
    must(Certs.CheckCertPair(localPaths)),
  /** 上传已配对的证书+私钥到远程 /etc/nginx/cert */
  uploadCertPair: async (host: string, certPath: string, keyPath: string): Promise<void> => {
    await Certs.UploadCertPair(host, certPath, keyPath);
  },
  collectPackages: (host: string) => arr(Monitor.CollectPackages(host)),
  collectPackageDepends: (host: string, pkgName: string) =>
    arr(Monitor.CollectPackageDepends(host, pkgName)),
  collectLargestFiles: (host: string, root: string, limit = 10) =>
    must(Monitor.CollectLargestFiles(host, root, limit)),
  collectLog: (host: string, logType: string, lines: number): Promise<monitor.LogResult> =>
    must(Monitor.CollectLog(host, logType, lines)),

  listDir: (host: string, dir: string) => arr(Monitor.ListDir(host, dir)),
  /** 远程登录用户家目录（文件管理默认打开路径） */
  getHomeDir: (host: string): Promise<string> => str(Monitor.GetHomeDir(host)),
  readFileText: (host: string, file: string): Promise<string> =>
    str(Monitor.ReadFileText(host, file)),
  /** 文本预览：含编码 / 换行检测 */
  readFilePreview: (host: string, file: string): Promise<filetext.Preview> =>
    must(Files.ReadFilePreview(host, file)),
  /** 远程文本 → UTF-8 + LF（写前自动备份） */
  normalizeFileToLinux: (host: string, file: string): Promise<filetext.Preview> =>
    must(Files.NormalizeFileToLinux(host, file)),
  uploadFile: (
    host: string,
    localPath: string,
    remoteDir: string,
    normalize = false
  ): Promise<string> => str(Files.UploadFile(host, localPath, remoteDir, normalize)),
  /** 递归上传文件夹，保留目录结构；normalize=true 时文本文件转 UTF-8+LF */
  uploadDir: (
    host: string,
    localDir: string,
    remoteDir: string,
    normalize = false
  ): Promise<string> => str(Files.UploadDir(host, localDir, remoteDir, normalize)),
  /** 拖拽批量上传：localPaths 文件/文件夹混合；convertPaths 命中的文件转 UTF-8+LF */
  uploadPaths: async (
    host: string,
    localPaths: string[],
    convertPaths: string[],
    remoteDir: string
  ): Promise<void> => {
    await Files.UploadPaths(host, localPaths, convertPaths, remoteDir);
  },
  /** 上传，并按 overwrite / rename 处理同名文件 */
  uploadPathsAs: async (
    host: string,
    localPaths: string[],
    remoteDir: string,
    mode: "overwrite" | "rename"
  ): Promise<void> => {
    await Files.UploadPathsAs(host, localPaths, remoteDir, mode);
  },
  /** 上传前检测本地路径（文件/文件夹），返回所有「非标准文本」文件清单 */
  checkLocalPaths: (localPaths: string[]) => arr(Files.CheckLocalPaths(localPaths)),
  listSftp: (host: string, dir: string) => arr(Files.ListSftp(host, dir)),
  sftpExistingNames: (host: string, dir: string, names: string[]) =>
    arr(Files.SftpExistingNames(host, dir, names)),
  localExistingNames: (dir: string, names: string[]) => arr(Files.LocalExistingNames(dir, names)),
  sftpHomeDir: (host: string): Promise<string> => str(Files.SftpHomeDir(host)),
  listLocalDir: (dir: string) => arr(Files.ListLocalDir(dir)),
  localHomeDir: (): Promise<string> => str(Files.LocalHomeDir()),
  downloadSftp: (host: string, remotePath: string, localDir: string): Promise<string> =>
    str(Files.DownloadSftp(host, remotePath, localDir)),
  /** 一次连接下载多个远程文件/目录到同一本机目录 */
  downloadSftpPaths: async (
    host: string,
    remotePaths: string[],
    localDir: string
  ): Promise<void> => {
    await Files.DownloadSftpPaths(host, remotePaths, localDir);
  },
  /** 下载，并按 overwrite / rename 处理同名文件 */
  downloadSftpPathsAs: async (
    host: string,
    remotePaths: string[],
    localDir: string,
    mode: "overwrite" | "rename"
  ): Promise<void> => {
    await Files.DownloadSftpPathsAs(host, remotePaths, localDir, mode);
  },
  /** 删除本机文件/目录（递归） */
  deleteLocalPaths: async (paths: string[]): Promise<void> => {
    await Files.DeleteLocalPaths(paths);
  },
  /** 用 SFTP 删除远程文件/目录（递归，不走 agent） */
  deleteSftpPaths: async (host: string, paths: string[]): Promise<void> => {
    await Files.DeleteSftpPaths(host, paths);
  },
  /** 用 SFTP 在远程创建目录；名字已占用时报错 */
  sftpMkdir: async (host: string, dir: string): Promise<void> => {
    await Files.SftpMkdir(host, dir);
  },
  /** 用 SFTP 在远程创建空文件；名字已占用时不覆盖、报错 */
  sftpCreateFile: async (host: string, file: string): Promise<void> => {
    await Files.SftpCreateFile(host, file);
  },
  /** 删除远程文件/目录（递归，不可恢复） */
  deletePaths: (host: string, paths: string[]): Promise<string> =>
    str(Monitor.DeletePaths(host, paths)),

  killProcess: async (host: string, pid: number, force: boolean): Promise<void> => {
    await Monitor.KillProcess(host, pid, force);
  },

  /** 本机应用扫描快照（macOS；不经 SSH） */
  localAppsScan: (): Promise<localapps.Snapshot> => must(LocalApps.Scan()),
  /** 本机单个进程详情（含线程） */
  localAppsDetail: (pid: number): Promise<localapps.ProcNode> =>
    must(LocalApps.ProcDetail(pid)),
  /** 结束本机进程；force=true 发 SIGKILL */
  localAppsKill: async (pid: number, force: boolean): Promise<void> => {
    await LocalApps.Kill(pid, force);
  },

  /** 本机系统概览 */
  localSysOverview: (): Promise<localsys.Overview> => must(LocalSys.Overview()),
  /** 本机系统详细报告（system_profiler） */
  localSysSystemReport: (force = false): Promise<localsys.SystemReport> =>
    must(LocalSys.SystemReport(force)),
  /** 本机网络信息 */
  localSysNetwork: (): Promise<localsys.NetworkSnapshot> => must(LocalSys.Network()),
  /** 本机已安装软件 */
  localSysPackages: (): Promise<localsys.Package[]> => arr(LocalSys.Packages()),
  /** 本机 Nginx 配置列表 */
  localSysNginx: (): Promise<localsys.NginxInfo> => must(LocalSys.Nginx()),
  /** 本机 Nginx 配置文件内容（只读） */
  localSysNginxRead: (path: string): Promise<string> => str(LocalSys.NginxRead(path)),
  /** 本机 /etc/hosts */
  localSysHosts: (): Promise<localsys.HostsInfo> => must(LocalSys.Hosts()),

  /** 本机磁盘占用：开始扫描 */
  localSysStorageScanStart: (): Promise<localsys.StorageStatus> =>
    must(LocalSys.StorageScanStart()),
  /** 本机磁盘占用：扫描状态 */
  localSysStorageStatus: (): Promise<localsys.StorageStatus> =>
    must(LocalSys.StorageStatus()),
  /** 本机磁盘占用：目录树一层 */
  localSysStorageTree: (path: string): Promise<localsys.StorageNode> =>
    must(LocalSys.StorageTree(path)),
  /** 本机磁盘占用：按应用汇总 */
  localSysStorageApps: (): Promise<localsys.StorageApp[]> =>
    arr(LocalSys.StorageApps()),
  /** 本机磁盘占用：大文件榜 */
  localSysStorageLargeFiles: (): Promise<localsys.StorageFile[]> =>
    arr(LocalSys.StorageLargeFiles()),
  /** 在 Finder 中显示 */
  localSysStorageReveal: async (path: string): Promise<void> => {
    await LocalSys.StorageReveal(path);
  },
  /** 打开「完全磁盘访问」设置 */
  localSysStorageOpenPrivacy: async (): Promise<void> => {
    await LocalSys.StorageOpenPrivacy();
  },

  dockerAction: (host: string, action: string, container: string): Promise<string> =>
    str(Monitor.DockerAction(host, action, container)),
  /** 查询单个容器的 docker inspect 原始 JSON（悬浮详情卡片用） */
  dockerInspect: (host: string, container: string): Promise<string> =>
    str(Monitor.DockerInspect(host, container)),

  openTerminal: (
    host: string,
    eventName: string,
    cols: number,
    rows: number
  ): Promise<string> => str(TerminalSvc.OpenTerminal(host, eventName, cols, rows)),
  writeTerminal: async (sessionID: string, data: string): Promise<void> => {
    await TerminalSvc.WriteTerminal(sessionID, data);
  },
  resizeTerminal: async (sessionID: string, cols: number, rows: number): Promise<void> => {
    await TerminalSvc.ResizeTerminal(sessionID, cols, rows);
  },
  closeTerminal: async (sessionID: string): Promise<void> => {
    await TerminalSvc.CloseTerminal(sessionID);
  },
  /** 断开主机全部连接：关闭所有终端会话与连接池连接 */
  disconnectHost: async (host: string): Promise<void> => {
    await TerminalSvc.DisconnectHost(host);
  },

  /** 初始化远程 zsh 环境 */
  bootstrapZsh: (host: string): Promise<string> => str(System.BootstrapZsh(host)),
  copySSHID: (input: main.CopyIDInput): Promise<string> => str(Hosts.CopySSHID(input)),
  /** 本机出口公网 IP 与归属地（来自 myip.ipip.net） */
  getMyEgress: (): Promise<monitor.EgressInfo> => must(System.GetMyEgress()),

  /** 面板侧主机连接失败 / 恢复 → 企微告警（webhook 空则跳过） */
  notifyHostConn: async (input: main.HostConnNotify): Promise<void> => {
    await System.NotifyHostConn(input);
  },

  /** 面板侧 CPU/内存/磁盘/负载超阈值或回落 → 企微 */
  notifyHostAlert: async (input: main.HostAlertNotify): Promise<void> => {
    await System.NotifyHostAlert(input);
  },

  /**
   * 本机系统通知（Wails 原生通知中心）。
   * meta 可选：host / eventId / kind，写入通知 Data，供点击跳转。
   */
  notifyDesktop: async (
    title: string,
    body: string,
    meta?: { host?: string; eventId?: string; kind?: string },
  ): Promise<void> => {
    await System.NotifyDesktop({
      title,
      body,
      host: meta?.host ?? "",
      eventId: meta?.eventId ?? "",
      kind: meta?.kind ?? "",
    });
  },

  /** 菜单页可用性 + 是否有业务数据（Go HTTP，不打开浏览器） */
  checkMenuPage: (id: string): Promise<main.MenuCheckResult> =>
    must(System.CheckMenuPage(id)),
  listMenuChecks: (): Promise<main.MenuCheckResult[]> =>
    arr(System.ListMenuChecks()),

  // ============ 应用内告警历史 ============
  listAlertHistory: (limit: number): Promise<alerthistory.Event[]> =>
    arr(AlertHistory.List(limit)),
  listAlertHistoryByHost: (host: string, limit: number): Promise<alerthistory.Event[]> =>
    arr(AlertHistory.ListByHost(host, limit)),
  appendAlertHistory: (event: alerthistory.Event): Promise<alerthistory.Event> =>
    must(AlertHistory.Append(event)),
  markAlertRead: async (id: string): Promise<void> => {
    await AlertHistory.MarkRead(id);
  },
  markAllAlertsRead: async (host = ""): Promise<void> => {
    await AlertHistory.MarkAllRead(host);
  },
  clearAlertHistory: async (): Promise<void> => {
    await AlertHistory.Clear();
  },
  unreadAlertCount: (): Promise<number> => AlertHistory.UnreadCount(),

  getNotifySubs: (): Promise<notifysubs.Data> => must(NotifySubs.Get()),
  setNotifySubs: async (d: notifysubs.Data): Promise<void> => {
    await NotifySubs.Set(d);
  },

  /** 向企业微信发测试消息；失败则抛错，前端据此禁止保存新地址 */
  testWecomWebhook: async (webhook: string): Promise<void> => {
    await System.TestWecomWebhook(webhook);
  },

  /** 隐藏/恢复 macOS 窗口红绿灯（卡片最大化时使用，v3 原生按钮状态 API） */
  setTrafficLightsHidden: async (hidden: boolean): Promise<void> => {
    await System.SetTrafficLightsHidden(hidden);
  },
  /** ⌘Q / Ctrl+Q 退出前是否先确认 */
  getAskBeforeQuit: (): Promise<boolean> => System.GetAskBeforeQuit(),
  setAskBeforeQuit: async (ask: boolean): Promise<void> => {
    await System.SetAskBeforeQuit(ask);
  },
  /** 同步原生窗口外观 light/dark/auto */
  setThemeAppearance: async (mode: string): Promise<void> => {
    await System.SetThemeAppearance(mode);
  },
  /** 打开或聚焦该分组的看板窗（普通尺寸，可再全屏） */
  openBoardWindow: async (groupId: string): Promise<void> => {
    await System.OpenBoardWindow(groupId);
  },
  /** 按 groupId 关闭对应看板窗 */
  closeBoardWindow: async (groupId: string): Promise<void> => {
    await System.CloseBoardWindow(groupId);
  },
  /** 显示并聚焦主窗口 */
  focusMainWindow: async (): Promise<void> => {
    await System.FocusMainWindow();
  },

  // ============ 备份与恢复（主机配置） ============
  /** 导出到 dir 下的日期文件夹，返回摘要文案 */
  exportBackup: (dir: string): Promise<string> => str(Backup.ExportBackup(dir)),
  /** 读取备份文件（导入预览用） */
  readBackup: (path: string): Promise<main.BackupData> => must(Backup.ReadBackup(path)),
  /** 从备份文件恢复；overwrite=true 时已存在主机以备份为准 */
  importBackup: (path: string, overwrite: boolean): Promise<main.ImportResult> =>
    must(Backup.ImportBackup(path, overwrite)),
};

/** 包一层，只为数后台调用次数，不改变各方法的参数和返回值 */
export const api: typeof apiImpl = new Proxy(apiImpl, {
  get(target, prop, receiver) {
    const value = Reflect.get(target, prop, receiver);
    if (typeof prop !== "string" || typeof value !== "function") return value;
    return (...args: unknown[]) => {
      noteBackendCall(prop);
      return (value as (...a: unknown[]) => unknown).apply(target, args);
    };
  },
});
