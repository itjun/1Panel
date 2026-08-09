// 前端 API 封装：所有对 Wails 后端的调用都走这里
// 统一封装错误处理 + 日志
import { CollectDisks, CollectDocker, CollectJava, CollectOverview, CollectProcesses, CollectServices, CollectPackages, CollectCrons, AddHost, AssignHost, CloseTerminal, CopySSHID, DeleteGroup, DockerAction, KillProcess, ListGroups, ListHosts, OpenTerminal, UpsertGroup, WriteTerminal } from "@wailsjs/go/main/App";
import type { groups, main, monitor, sshconfig } from "@wailsjs/go/models";

export const api = {
  // 主机
  listHosts: (): Promise<sshconfig.HostConfig[]> => ListHosts(),
  addHost: (cfg: sshconfig.HostConfig) => AddHost(cfg),

  // 分组
  listGroups: (): Promise<groups.Group[]> => ListGroups(),
  upsertGroup: (g: groups.Group) => UpsertGroup(g),
  deleteGroup: (id: string) => DeleteGroup(id),
  assignHost: (host: string, groupID: string) => AssignHost(host, groupID),

  // 监控
  collectOverview: (host: string) => CollectOverview(host),
  collectDisks: (host: string) => CollectDisks(host),
  collectProcesses: (host: string, limit: number) => CollectProcesses(host, limit),
  collectJava: (host: string) => CollectJava(host),
  collectDocker: (host: string) => CollectDocker(host),
  collectServices: (host: string) => CollectServices(host),
  collectCrons: (host: string) => CollectCrons(host),
  collectPackages: (host: string) => CollectPackages(host),

  // 操作
  killProcess: (host: string, pid: number, force: boolean) => KillProcess(host, pid, force),
  dockerAction: (host: string, action: string, container: string) =>
    DockerAction(host, action, container),

  // 终端
  openTerminal: (host: string, eventName: string): Promise<string> => OpenTerminal(host, eventName),
  writeTerminal: (sessionID: string, data: string) => WriteTerminal(sessionID, data),
  closeTerminal: (sessionID: string) => CloseTerminal(sessionID),

  // ssh-copy-id
  copySSHID: (input: main.CopyIDInput) => CopySSHID(input),
};
