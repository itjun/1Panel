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
  AddHost,
  AssignHost,
  AuthenticateMacUser,
  AuthenticateWithSystem,
  AuthStatus,
  CloseTerminal,
  CopySSHID,
  DeleteGroup,
  DockerAction,
  GetCurrentMacUser,
  KillProcess,
  ListDir,
  ListGroups,
  ListHosts,
  ListHostsAll,
  ListGroupOverview,
  ListOneGroupOverview,
  LogoutMacUser,
  OpenTerminal,
  ReadFileText,
  RenameGroup,
  RenameHost,
  ResizeTerminal,
  TestConnection,
  UploadFile,
  UpsertGroup,
  WriteTerminal,
} from "@wailsjs/go/main/App";
import type { groups, main, monitor, sshconfig } from "@wailsjs/go/models";

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
  collectDocker: (host: string) => CollectDocker(host),
  collectServices: (host: string) => CollectServices(host),
  collectCrons: (host: string) => CollectCrons(host),
  collectPackages: (host: string) => CollectPackages(host),
  collectLargestFiles: (
    host: string,
    limit = 10
  ): Promise<monitor.LargeFilesResult> => CollectLargestFiles(host, limit),

  listDir: (host: string, dir: string) => ListDir(host, dir),
  readFileText: (host: string, file: string) => ReadFileText(host, file),
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

export type { groups, main, monitor, sshconfig };
