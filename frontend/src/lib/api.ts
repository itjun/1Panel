// 前端 API 封装：所有对 Wails 后端的调用都走这里
// 统一封装错误处理 + 日志
import { CollectDisks, CollectDocker, CollectJava, CollectOverview, CollectProcesses, CollectServices, CollectPackages, CollectCrons, AddHost, AssignHost, CloseTerminal, CopySSHID, DeleteGroup, DockerAction, KillProcess, ListDir, ListGroups, ListHosts, ListHostsAll, ListGroupOverview, OpenTerminal, ReadFileText, RenameHost, ResizeTerminal, UploadFile, UpsertGroup, WriteTerminal } from "@wailsjs/go/main/App";
import type { groups, main, monitor, sshconfig } from "@wailsjs/go/models";

export const api = {
  // 主机
  listHosts: (): Promise<sshconfig.HostConfig[]> => ListHosts(),
  listHostsAll: (): Promise<sshconfig.HostConfig[]> => ListHostsAll(),
  addHost: (cfg: sshconfig.HostConfig) => AddHost(cfg),
  renameHost: (oldName: string, newName: string) => RenameHost(oldName, newName),

  // 分组
  listGroups: (): Promise<groups.Group[]> => ListGroups(),
  upsertGroup: (g: groups.Group) => UpsertGroup(g),
  deleteGroup: (id: string) => DeleteGroup(id),
  assignHost: (host: string, groupID: string) => AssignHost(host, groupID),

  // 分组概览
  listGroupOverview: (): Promise<main.GroupOverview[]> => ListGroupOverview(),

  // 监控
  collectOverview: (host: string) => CollectOverview(host),
  collectDisks: (host: string) => CollectDisks(host),
  collectProcesses: (host: string, limit: number) => CollectProcesses(host, limit),
  collectJava: (host: string) => CollectJava(host),
  collectDocker: (host: string) => CollectDocker(host),
  collectServices: (host: string) => CollectServices(host),
  collectCrons: (host: string) => CollectCrons(host),
  collectPackages: (host: string) => CollectPackages(host),

  // 文件浏览（只读）
  listDir: (host: string, dir: string) => ListDir(host, dir),
  readFileText: (host: string, file: string) => ReadFileText(host, file),

  // 文件上传（拖拽）
  uploadFile: (host: string, localPath: string, remoteDir: string) =>
    UploadFile(host, localPath, remoteDir),

  // 操作
  killProcess: (host: string, pid: number, force: boolean) => KillProcess(host, pid, force),
  dockerAction: (host: string, action: string, container: string) =>
    DockerAction(host, action, container),

  // 终端
  openTerminal: (host: string, eventName: string): Promise<string> => OpenTerminal(host, eventName),
  writeTerminal: (sessionID: string, data: string) => WriteTerminal(sessionID, data),
  resizeTerminal: (sessionID: string, cols: number, rows: number) =>
    ResizeTerminal(sessionID, cols, rows),
  closeTerminal: (sessionID: string) => CloseTerminal(sessionID),

  // ssh-copy-id
  copySSHID: (input: main.CopyIDInput) => CopySSHID(input),
};
