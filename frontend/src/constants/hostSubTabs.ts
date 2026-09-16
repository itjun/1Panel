import type { SubTab } from "@/stores/app";

/** 主机功能项：顺序与历史顶栏横标签一致 */
export const HOST_SUB_TABS: { value: SubTab; label: string }[] = [
  { value: "overview", label: "概览" },
  { value: "monitor", label: "监控" },
  { value: "apps", label: "应用" },
  { value: "nginx", label: "Nginx" },
  { value: "processes", label: "进程" },
  { value: "network", label: "网络" },
  { value: "hosts", label: "Hosts" },
  { value: "apt", label: "apt 源" },
  { value: "files", label: "文件" },
  { value: "services", label: "服务" },
  { value: "certs", label: "证书" },
  { value: "cron", label: "定时任务" },
  { value: "logs", label: "日志" },
  { value: "packages", label: "软件包" },
  { value: "terminal", label: "终端" },
];

/** 终端角标：只有「终端」项可能带 badge，其余项无该字段（类型上必须是可选，模板才取得到） */
export function hostSubTabButtons(
  terminalCount: number
): { value: SubTab; label: string; badge?: number }[] {
  return HOST_SUB_TABS.map((b) =>
    b.value === "terminal" && terminalCount > 0
      ? { ...b, badge: terminalCount }
      : b
  );
}
