/**
 * Wails Go 绑定封装
 * 后端接口与原先 React 版一致
 */
import {
  CollectDisks,
  CollectDocker,
  CollectLargestFiles,
  CollectOverview,
  CollectProcesses,
  CollectServices,
  CollectPackages,
  CollectCrons,
  CollectJava,
  CollectNetwork,
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

  collectOverview: (host: string) => CollectOverview(host),
  collectDisks: (host: string) => CollectDisks(host),
  collectProcesses: (host: string, limit: number) =>
    CollectProcesses(host, limit),
  collectJava: (host: string) => CollectJava(host),
  collectNetwork: (host: string) => CollectNetwork(host),
  collectDocker: (host: string) => CollectDocker(host),
  collectServices: (host: string) => CollectServices(host),
  collectCrons: (host: string) => CollectCrons(host),
  collectPackages: (host: string) => CollectPackages(host),
  collectLargestFiles: (
    host: string,
    limit = 10
  ): Promise<monitor.LargeFilesResult> => CollectLargestFiles(host, limit),

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
  uploadFile: (host: string, localPath: string, remoteDir: string) =>
    UploadFile(host, localPath, remoteDir),

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

  copySSHID: (input: main.CopyIDInput) => CopySSHID(input),
};

export type { filetext, groups, main, monitor, sshconfig };
