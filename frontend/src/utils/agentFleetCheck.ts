import type { agentcli } from "@/api";

export type AgentRepair = "install" | "upgrade" | "none";

/** 安装状态明确时，服务、通信或版本异常均可尝试处理。 */
export function agentRepairFor(report: agentcli.CheckReport, latestVersion: string): AgentRepair {
  if (report.binaryState === "missing") return "install";
  if (report.binaryState === "installed" && ((report.agentVersion && latestVersion && report.agentVersion !== latestVersion) ||
    report.items?.some(item => ["service", "comm", "version"].includes(item.key) && !item.ok))) return "upgrade";
  return "none";
}

/** 限制并发；关闭窗口后不再启动队列中的检查。 */
export async function checkAgentFleet(
  hosts: string[],
  check: (host: string) => Promise<agentcli.CheckReport>,
  onResult: (host: string, result: { report: agentcli.CheckReport } | { error: unknown }) => void,
  isCancelled: () => boolean,
) {
  let next = 0;
  async function worker() {
    while (!isCancelled() && next < hosts.length) {
      const host = hosts[next++];
      try {
        const report = await check(host);
        if (!isCancelled()) onResult(host, { report });
      } catch (error) {
        if (!isCancelled()) onResult(host, { error });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(5, hosts.length) }, () => worker()));
}
