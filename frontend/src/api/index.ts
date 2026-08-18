/**
 * Wails Go 绑定封装
 * 所有后端调用统一走 @wailsjs 生成的强类型绑定
 */
import {
  CollectDisks,
  CollectDocker,
  CollectLargestFiles,
  CollectLog,
  CollectOverview,
  CollectProcesses,
  CollectServices,
  CollectServiceDetail,
  CollectPackages,
  CollectCrons,
  CollectRuntimes,
  CollectJava,
  CollectJavaProcDetail,
  CollectNetwork,
  CollectRuntimeProcs,
  CollectRuntimeCounts,
  CollectCerts,
  AddHost,
  AssignHost,
  CloseTerminal,
  CopySSHID,
  CheckCertPair,
  CheckLocalPaths,
  UploadCertPair,
  DeleteGroup,
  DeleteHost,
  DeletePaths,
  DockerAction,
  DockerInspect,
  GetHomeDir,
  KillProcess,
  ListDir,
  ListGroups,
  ListHosts,
  ListHostsAll,
  ListGroupOverview,
  ListOneGroupOverview,
  ListHostIcons,
  RefreshAllHostIcons,
  RefreshHostIcon,
  RefreshMissingHostIcons,
  OpenTerminal,
  OpenTerminalWS,
  NormalizeFileToLinux,
  ReadFilePreview,
  ReadFileText,
  RenameGroup,
  RenameHost,
  ResizeTerminal,
  TestConnection,
  UpdateHost,
  UploadDir,
  UploadFile,
  UploadPaths,
  UpsertGroup,
  WriteTerminal,
  BootstrapZsh,
} from "@wailsjs/go/main/App";
import type { filetext, groups, main, monitor, sshconfig } from "@wailsjs/go/models";

// 保留原有类型导出名，视图层零改动
export type HostIcon = main.HostIcon;
export type RuntimeCounts = monitor.RuntimeCounts;
export type LocalTextCheck = main.LocalTextCheck;
export type CertInfo = monitor.CertInfo;
export type CertListResult = monitor.CertListResult;
export type CertPairCheck = main.CertPairCheck;

export const api = {
  listHosts: (): Promise<sshconfig.HostConfig[]> => ListHosts(),
  listHostsAll: (): Promise<sshconfig.HostConfig[]> => ListHostsAll(),
  addHost: (input: main.AddHostInput) => AddHost(input),
  testConnection: (input: main.AddHostInput): Promise<string> =>
    TestConnection(input),
  renameHost: (oldName: string, newName: string) => RenameHost(oldName, newName),
  updateHost: (input: main.UpdateHostInput) => UpdateHost(input),
  deleteHost: (name: string) => DeleteHost(name),

  listGroups: (): Promise<groups.Group[]> => ListGroups(),
  upsertGroup: (g: groups.Group) => UpsertGroup(g),
  renameGroup: (id: string, newName: string) => RenameGroup(id, newName),
  deleteGroup: (id: string) => DeleteGroup(id),
  assignHost: (host: string, groupID: string) => AssignHost(host, groupID),

  listGroupOverview: (): Promise<main.GroupOverview[]> => ListGroupOverview(),
  listOneGroupOverview: (groupID: string): Promise<main.GroupOverview> =>
    ListOneGroupOverview(groupID),

  /** 本地已记录的发行版图标，不访问远程 */
  listHostIcons: (): Promise<main.HostIcon[]> => ListHostIcons(),
  /** 强制远程探测一台主机并落盘 */
  refreshHostIcon: (host: string): Promise<main.HostIcon> =>
    RefreshHostIcon(host),
  /** 只补齐没有记录的主机 */
  refreshMissingHostIcons: (): Promise<main.HostIcon[]> =>
    RefreshMissingHostIcons(),
  /** 强制重新探测全部主机 */
  refreshAllHostIcons: (): Promise<main.HostIcon[]> => RefreshAllHostIcons(),

  collectOverview: (host: string) => CollectOverview(host),
  collectDisks: (host: string) => CollectDisks(host),
  collectProcesses: (host: string, limit: number) =>
    CollectProcesses(host, limit),
  collectJava: (host: string) => CollectJava(host),
  /** 运行时进程列表（java/go/node/bun/python，含部署方式/端口/入口） */
  collectRuntimeProcs: (host: string, runtime: string) =>
    CollectRuntimeProcs(host, runtime),
  /** 各运行时正在运行的进程数（进程页标签数字徽标） */
  collectRuntimeCounts: (host: string): Promise<monitor.RuntimeCounts> =>
    CollectRuntimeCounts(host),
  /** 单个运行时进程补充详情（悬浮卡片：工作目录/exe 路径/磁盘 IO） */
  collectJavaDetail: (host: string, pid: number) =>
    CollectJavaProcDetail(host, pid),
  collectRuntimes: (host: string) => CollectRuntimes(host),
  collectNetwork: (host: string) => CollectNetwork(host),
  collectDocker: (host: string) => CollectDocker(host),
  collectServices: (host: string) => CollectServices(host),
  collectServiceDetail: (host: string, name: string) =>
    CollectServiceDetail(host, name),
  collectCrons: (host: string) => CollectCrons(host),
  /** 识别 /etc/nginx/cert 下的证书 */
  collectCerts: (host: string): Promise<monitor.CertListResult> =>
    CollectCerts(host),
  /** 本地校验证书+私钥配对（不上传） */
  checkCertPair: (localPaths: string[]): Promise<main.CertPairCheck> =>
    CheckCertPair(localPaths),
  /** 上传已配对的证书+私钥到远程 /etc/nginx/cert */
  uploadCertPair: (host: string, certPath: string, keyPath: string) =>
    UploadCertPair(host, certPath, keyPath),
  collectPackages: (host: string) => CollectPackages(host),
  collectLargestFiles: (
    host: string,
    root: string,
    limit = 10
  ): Promise<monitor.LargeFilesResult> => CollectLargestFiles(host, root, limit),
  collectLog: (
    host: string,
    logType: string,
    lines: number
  ): Promise<monitor.LogResult> => CollectLog(host, logType, lines),

  listDir: (host: string, dir: string) => ListDir(host, dir),
  /** 远程登录用户家目录（文件管理默认打开路径） */
  getHomeDir: (host: string): Promise<string> => GetHomeDir(host),
  readFileText: (host: string, file: string) => ReadFileText(host, file),
  /** 文本预览：含编码 / 换行检测 */
  readFilePreview: (host: string, file: string): Promise<filetext.Preview> =>
    ReadFilePreview(host, file),
  /** 远程文本 → UTF-8 + LF（写前自动备份） */
  normalizeFileToLinux: (
    host: string,
    file: string
  ): Promise<filetext.Preview> => NormalizeFileToLinux(host, file),
  uploadFile: (
    host: string,
    localPath: string,
    remoteDir: string,
    normalize = false
  ) => UploadFile(host, localPath, remoteDir, normalize),
  /** 递归上传文件夹，保留目录结构；normalize=true 时文本文件转 UTF-8+LF */
  uploadDir: (
    host: string,
    localDir: string,
    remoteDir: string,
    normalize = false
  ) => UploadDir(host, localDir, remoteDir, normalize),
  /** 拖拽批量上传：localPaths 文件/文件夹混合；convertPaths 命中的文件转 UTF-8+LF */
  uploadPaths: (
    host: string,
    localPaths: string[],
    convertPaths: string[],
    remoteDir: string
  ) => UploadPaths(host, localPaths, convertPaths, remoteDir),
  /** 上传前检测本地路径（文件/文件夹），返回所有「非标准文本」文件清单 */
  checkLocalPaths: (localPaths: string[]): Promise<main.LocalTextCheck[]> =>
    CheckLocalPaths(localPaths),
  /** 删除远程文件/目录（递归，不可恢复） */
  deletePaths: (host: string, paths: string[]) => DeletePaths(host, paths),

  killProcess: (host: string, pid: number, force: boolean) =>
    KillProcess(host, pid, force),
  dockerAction: (host: string, action: string, container: string) =>
    DockerAction(host, action, container),
  /** 查询单个容器的 docker inspect 原始 JSON（悬浮详情卡片用） */
  dockerInspect: (host: string, container: string) =>
    DockerInspect(host, container),

  openTerminal: (
    host: string,
    eventName: string,
    cols: number,
    rows: number
  ): Promise<string> => OpenTerminal(host, eventName, cols, rows),
  /** WS 模式终端（低延迟数据通道）；连接失败时调用方回退 openTerminal */
  openTerminalWS: (host: string, cols: number, rows: number) =>
    OpenTerminalWS(host, cols, rows),
  writeTerminal: (sessionID: string, data: string) =>
    WriteTerminal(sessionID, data),
  resizeTerminal: (sessionID: string, cols: number, rows: number) =>
    ResizeTerminal(sessionID, cols, rows),
  closeTerminal: (sessionID: string) => CloseTerminal(sessionID),

  /** 初始化远程 zsh 环境 */
  bootstrapZsh: (host: string): Promise<string> => BootstrapZsh(host),
  copySSHID: (input: main.CopyIDInput) => CopySSHID(input),
};

export type { filetext, groups, main, monitor, sshconfig };
