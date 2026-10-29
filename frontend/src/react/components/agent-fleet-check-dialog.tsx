import { useEffect, useRef, useState } from "react";
import { api, type agentcli } from "@/api";
import { Button } from "@/react/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/react/components/ui/dialog";
import { startAgentRepair, useAgentInstall } from "@/react/state/agent-install";
import { agentRepairFor, checkAgentFleet } from "@/utils/agentFleetCheck";
import { formatErr } from "@/utils/format";

type CheckRow = { host: string; report?: agentcli.CheckReport; error?: string };

export function AgentFleetCheckDialog({ hosts, latestVersion, onClose }: {
  hosts: string[];
  latestVersion: string;
  onClose: () => void;
}) {
  const [targets] = useState(() => [...new Set(hosts)]);
  const [rows, setRows] = useState<CheckRow[]>(() => targets.map(host => ({ host })));
  const [isChecking, setIsChecking] = useState(true);
  const generation = useRef(0);
  const installTask = useAgentInstall();

  function runCheck() {
    const current = ++generation.current;
    setRows(targets.map(host => ({ host })));
    setIsChecking(true);
    void checkAgentFleet(targets, host => api.checkAgent(host), (host, result) => {
      setRows(previous => previous.map(row => row.host !== host ? row : "report" in result
        ? { host, report: result.report } : { host, error: formatErr(result.error) }));
    }, () => generation.current !== current).then(() => {
      if (generation.current !== current) return;
      setIsChecking(false);
    });
  }

  useEffect(() => {
    runCheck();
    return () => { generation.current++; };
  }, []);

  const checked = rows.filter(row => row.report || row.error).length;
  const repairable = rows.filter(row => row.report && agentRepairFor(row.report, latestVersion) !== "none");
  const needsReview = rows.filter(row => row.error || (row.report && !row.report.ok && agentRepairFor(row.report, latestVersion) === "none")).length;

  return (
    <Dialog open onOpenChange={isOpen => { if (!isOpen) onClose(); }}>
      <DialogContent className="w-[min(960px,calc(100vw-32px))]">
        <DialogTitle>检查 Agent</DialogTitle>
        <DialogDescription>
          {isChecking ? `正在检查 ${checked} / ${targets.length} 台主机…`
            : `检查完成：${repairable.length} 台可处理${needsReview ? `，${needsReview} 台需查看` : ""}。`}
        </DialogDescription>
        <div className="agent-fleet-list">
          <table className="agent-fleet-table" aria-label="Agent 检查结果">
            <thead><tr><th scope="col">主机</th><th scope="col">状态</th><th scope="col">未通过的检查</th></tr></thead>
            <tbody>{rows.map(row => {
              const repair = row.report ? agentRepairFor(row.report, latestVersion) : "none";
              const label = row.error ? "检查失败" : !row.report ? "检查中…" : repair === "install" ? "未安装"
                : repair === "upgrade" ? "需要处理"
                  : row.report.ok ? "正常" : "需查看";
              const failures = row.report?.items?.filter(item => !item.ok) || [];
              return <tr key={row.host}>
                <th scope="row">{row.host}</th>
                <td className={row.error || repair !== "none" || (row.report && !row.report.ok) ? "text-warn" : "text-muted"}>{label}</td>
                <td className="agent-fleet-failures">
                  {row.error ? <span>{row.error}</span> : failures.length ? failures.map(item => (
                    <div key={item.key}><span className="text-ink">{item.name}：</span>{item.detail || "检查未通过"}</div>
                  )) : row.report && !row.report.ok ? row.report.summary : "—"}
                </td>
              </tr>;
            })}</tbody>
          </table>
        </div>
        {!isChecking && !latestVersion ? <p className="mt-3 text-xs text-muted">无法读取面板内置版本，暂不能判断是否需要升级。</p> : null}
        <DialogFooter>
          <Button disabled={isChecking} onClick={runCheck}>重新检查</Button>
          <Button onClick={onClose}>关闭</Button>
          <Button variant="primary" disabled={isChecking || repairable.length === 0 || installTask.phase === "running"} onClick={() => {
            const targets = repairable.flatMap(row => {
              if (!row.report) return [];
              const action = agentRepairFor(row.report, latestVersion);
              return action === "none" ? [] : [{ host: row.host, action }];
            });
            startAgentRepair(targets);
            onClose();
          }}>立即处理{repairable.length ? `（${repairable.length}）` : ""}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
