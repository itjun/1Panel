import type { SessionKind, SubTab } from "@/stores/app";

/** 主机管理页。终端不在这一排，从右侧「连接终端」进独立模块。 */
export const HOST_SUB_TABS: { value: SubTab; label: string }[] = [
  { value: "overview", label: "概览" },
  { value: "file-manager", label: "文件" },
  { value: "files", label: "XFPT" },
  { value: "monitor", label: "监控" },
  { value: "apps", label: "应用" },
  { value: "certs", label: "证书" },
  { value: "nginx", label: "Nginx" },
  { value: "processes", label: "进程" },
  { value: "network", label: "网络" },
  { value: "hosts", label: "Hosts" },
  { value: "apt", label: "apt 源" },
  { value: "services", label: "服务" },
  { value: "cron", label: "定时任务" },
  { value: "logs", label: "日志" },
  { value: "packages", label: "软件包" },
];

export const SESSION_KIND_LABEL: Record<SessionKind, string> = {
  terminal: "终端",
  info: "概览",
  "file-manager": "文件",
  sftp: "XFPT",
  monitor: "监控",
  certs: "证书",
  nginx: "Nginx",
  processes: "进程",
  network: "网络",
  hosts: "Hosts",
  apt: "apt 源",
  apps: "应用",
  services: "服务",
  cron: "定时任务",
  logs: "日志",
  packages: "软件包",
};

/** 兼容旧调用。终端不再出现在主机工具栏。 */
export function hostSubTabButtons(
  _terminalCount = 0
): { value: SubTab; label: string; badge?: number }[] {
  return HOST_SUB_TABS.map((b) => b);
}
