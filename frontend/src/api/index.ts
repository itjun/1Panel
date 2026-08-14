/**
 * Wails Go 绑定封装
 * 后端接口与原先 React 版一致
 */
import {
  CollectDisks,
  CollectDocker,
  CollectDatabases,
  CollectLargestFiles,
  CollectLog,
  CollectOverview,
  CollectProcesses,
  CollectServices,
  CollectPackages,
  CollectCrons,
  CollectJava,
  CollectJavaDetail,
  CollectJvmEvents,
  CollectNetwork,
  AnalyzeExitReason,
  ProbeMetrics,
  QueryMetric,
  QueryMetricRange,
  AddHost,
  AssignHost,
  AuthenticateMacUser,
  AuthenticateWithSystem,
  AuthStatus,
  CloseTerminal,
  CopySSHID,
  DeleteGroup,
  DeleteHost,
  DockerAction,
  GetCurrentMacUser,
  GetHomeDir,
  KillProcess,
  ListDir,
  ListGroups,
  ListHosts,
  ListHostsAll,
  ListGroupOverview,
  ListOneGroupOverview,
  LogoutMacUser,
  OpenTerminal,
  NormalizeFileToLinux,
  ReadFilePreview,
  ReadFileText,
  RenameGroup,
  RenameHost,
  ResizeTerminal,
  TestConnection,
  UpdateHost,
  UploadFile,
  UpsertGroup,
  WriteTerminal,
} from "@wailsjs/go/main/App";
import type { filetext, groups, main, monitor, sshconfig } from "@wailsjs/go/models";

export interface MacUserInfo {
  username: string;
  fullName: string;
  homeDir: string;
}

export interface AuthState {
  authenticated: boolean;
  username: string;
}

/** 主机发行版图标记录（对应后端 main.HostIcon）*/
export interface HostIcon {
  host: string;
  osRelease: string;
  error?: string;
}

/** 本地文件编码检测结果（对应后端 main.LocalTextCheck）*/
export interface LocalTextCheck {
  path: string;
  relPath: string;
  name: string;
  encoding: string;
  lineEnding: string;
  needsNormalize: boolean;
  content: string;
  normalized: string;
  size: number;
}

// vue-tsc 对 wails 生成的新增绑定（UploadDir/UploadPaths/CheckLocalPaths）类型解析异常，
// 这里直接走运行时 window 注入调用，绕过 .d.ts 解析问题。
function wailsMain<T>(method: string, ...args: unknown[]): Promise<T> {
  const fn = (
    window as unknown as {
      go?: {
        main?: { App?: Record<string, (...a: unknown[]) => unknown> };
      };
    }
  ).go?.main?.App?.[method];
  if (typeof fn !== "function") {
    return Promise.reject(new Error(`后端方法未就绪: ${method}`));
  }
  return fn(...args) as Promise<T>;
}

export const api = {
  // 本机门禁：macOS LocalAuthentication 系统面板
  getCurrentMacUser: (): Promise<MacUserInfo> => GetCurrentMacUser(),
  authStatus: (): Promise<AuthState> => AuthStatus(),
  authenticateWithSystem: (): Promise<AuthState> => AuthenticateWithSystem(),
  /** @deprecated 请用 authenticateWithSystem */
  authenticateMacUser: (username: string, password: string): Promise<AuthState> =>
    AuthenticateMacUser(username, password),
  logoutMacUser: (): Promise<AuthState> => LogoutMacUser(),

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
  listHostIcons: (): Promise<HostIcon[]> => wailsMain<HostIcon[]>("ListHostIcons"),
  /** 强制远程探测一台主机并落盘 */
  refreshHostIcon: (host: string): Promise<HostIcon> =>
    wailsMain<HostIcon>("RefreshHostIcon", host),
  /** 只补齐没有记录的主机 */
  refreshMissingHostIcons: (): Promise<HostIcon[]> =>
    wailsMain<HostIcon[]>("RefreshMissingHostIcons"),
  /** 强制重新探测全部主机 */
  refreshAllHostIcons: (): Promise<HostIcon[]> =>
    wailsMain<HostIcon[]>("RefreshAllHostIcons"),

  collectOverview: (host: string) => CollectOverview(host),
  collectDisks: (host: string) => CollectDisks(host),
  collectProcesses: (host: string, limit: number) =>
    CollectProcesses(host, limit),
  collectJava: (host: string) => CollectJava(host),
  collectJavaDetail: (host: string) => CollectJavaDetail(host),
  collectJvmEvents: (host: string, gcLogPath: string, limit: number) =>
    CollectJvmEvents(host, gcLogPath, limit),
  analyzeExitReason: (host: string, sessionName: string, jarDir: string) =>
    AnalyzeExitReason(host, sessionName, jarDir),
  probeMetrics: (host: string) => ProbeMetrics(host),
  queryMetric: (host: string, query: string) => QueryMetric(host, query),
  queryMetricRange: (
    host: string,
    query: string,
    start: number,
    end: number,
    step: number
  ) => QueryMetricRange(host, query, start, end, step),
  collectNetwork: (host: string) => CollectNetwork(host),
  collectDocker: (host: string) => CollectDocker(host),
  collectDatabases: (host: string): Promise<monitor.DatabaseInfo[]> =>
    CollectDatabases(host),
  collectServices: (host: string) => CollectServices(host),
  collectCrons: (host: string) => CollectCrons(host),
  collectPackages: (host: string) => CollectPackages(host),
  collectLargestFiles: (
    host: string,
    limit = 10
  ): Promise<monitor.LargeFilesResult> => CollectLargestFiles(host, limit),
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
  ) => wailsMain<string>("UploadDir", host, localDir, remoteDir, normalize),
  /** 拖拽批量上传：localPaths 文件/文件夹混合；convertPaths 命中的文件转 UTF-8+LF */
  uploadPaths: (
    host: string,
    localPaths: string[],
    convertPaths: string[],
    remoteDir: string
  ) =>
    wailsMain<void>(
      "UploadPaths",
      host,
      localPaths,
      convertPaths,
      remoteDir
    ),
  /** 上传前检测本地路径（文件/文件夹），返回所有「非标准文本」文件清单 */
  checkLocalPaths: (localPaths: string[]): Promise<LocalTextCheck[]> =>
    wailsMain<LocalTextCheck[]>("CheckLocalPaths", localPaths),
  /** 删除远程文件/目录（递归，不可恢复） */
  deletePaths: (host: string, paths: string[]) =>
    wailsMain<string>("DeletePaths", host, paths),

  killProcess: (host: string, pid: number, force: boolean) =>
    KillProcess(host, pid, force),
  dockerAction: (host: string, action: string, container: string) =>
    DockerAction(host, action, container),

  openTerminal: (
    host: string,
    eventName: string,
    cols: number,
    rows: number
  ): Promise<string> => OpenTerminal(host, eventName, cols, rows),
  writeTerminal: (sessionID: string, data: string) =>
    WriteTerminal(sessionID, data),
  resizeTerminal: (sessionID: string, cols: number, rows: number) =>
    ResizeTerminal(sessionID, cols, rows),
  closeTerminal: (sessionID: string) => CloseTerminal(sessionID),

  // 走 wailsMain 运行时调用(Wails 新增绑定的 .d.ts 类型解析不稳,与 UploadDir 等同模式)
  bootstrapZsh: (host: string): Promise<string> =>
    wailsMain<string>("BootstrapZsh", host),
  copySSHID: (input: main.CopyIDInput) => CopySSHID(input),
};

export type { filetext, groups, main, monitor, sshconfig };
