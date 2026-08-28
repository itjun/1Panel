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

// 模型类型命名空间（与 v2 的 @wailsjs/go/models 对应）
export * as monitor from "../../bindings/diteng-pannel/internal/monitor/models";
export * as agentcli from "../../bindings/diteng-pannel/internal/agentcli/models";
export * as sshconfig from "../../bindings/diteng-pannel/internal/sshconfig/models";
export * as groups from "../../bindings/diteng-pannel/internal/groups/models";
export * as filetext from "../../bindings/diteng-pannel/internal/filetext/models";
export * as main from "../../bindings/diteng-pannel/models";

import type { CancellablePromise } from "@wailsio/runtime";
import type * as agentcli from "../../bindings/diteng-pannel/internal/agentcli/models";
import type * as agentinstall from "../../bindings/diteng-pannel/internal/agentinstall/models";
import type * as filetext from "../../bindings/diteng-pannel/internal/filetext/models";
import type * as groups from "../../bindings/diteng-pannel/internal/groups/models";
import type * as main from "../../bindings/diteng-pannel/models";
import type * as monitor from "../../bindings/diteng-pannel/internal/monitor/models";
import type * as sshconfig from "../../bindings/diteng-pannel/internal/sshconfig/models";

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

export const api = {
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

  listGroups: () => arr(Groups.ListGroups()),
  upsertGroup: async (g: groups.Group): Promise<void> => {
    await Groups.UpsertGroup(g);
  },
  renameGroup: async (id: string, newName: string): Promise<void> => {
    await Groups.RenameGroup(id, newName);
  },
  deleteGroup: async (id: string): Promise<void> => {
    await Groups.DeleteGroup(id);
  },
  assignHost: async (host: string, groupID: string): Promise<void> => {
    await Groups.AssignHost(host, groupID);
  },

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
  /** 上传前检测本地路径（文件/文件夹），返回所有「非标准文本」文件清单 */
  checkLocalPaths: (localPaths: string[]) => arr(Files.CheckLocalPaths(localPaths)),
  /** 删除远程文件/目录（递归，不可恢复） */
  deletePaths: (host: string, paths: string[]): Promise<string> =>
    str(Monitor.DeletePaths(host, paths)),

  killProcess: async (host: string, pid: number, force: boolean): Promise<void> => {
    await Monitor.KillProcess(host, pid, force);
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

  /** 初始化远程 zsh 环境 */
  bootstrapZsh: (host: string): Promise<string> => str(System.BootstrapZsh(host)),
  copySSHID: (input: main.CopyIDInput): Promise<string> => str(Hosts.CopySSHID(input)),
  /** 本机出口公网 IP 与归属地（来自 myip.ipip.net） */
  getMyEgress: (): Promise<monitor.EgressInfo> => must(System.GetMyEgress()),

  /** 面板侧主机连接失败 / 恢复 → 企微告警（webhook 空则跳过） */
  notifyHostConn: async (input: main.HostConnNotify): Promise<void> => {
    await System.NotifyHostConn(input);
  },

  /** 隐藏/恢复 macOS 窗口红绿灯（卡片最大化时使用，v3 原生按钮状态 API） */
  setTrafficLightsHidden: async (hidden: boolean): Promise<void> => {
    await System.SetTrafficLightsHidden(hidden);
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
