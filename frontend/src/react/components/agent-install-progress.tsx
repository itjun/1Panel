import { AGENT_INSTALL_STEPS, type AgentInstallRow } from "@/utils/agentInstall";

/** 每格对应一个真实阶段；上传完成不代表服务已经启动并通过验证。 */
export function AgentInstallProgress({ row, isCompact = false }: { row: AgentInstallRow; isCompact?: boolean }) {
  const current = AGENT_INSTALL_STEPS.findIndex(step => step.key === row.step);
  const completed = row.state === "done" ? AGENT_INSTALL_STEPS.length : Math.max(0, current);
  return (
    <div role="progressbar" aria-label={`${row.host} Agent 安装进度`}
      aria-valuemin={0} aria-valuemax={5} aria-valuenow={completed} aria-valuetext={row.text}>
      <div className={isCompact ? "flex gap-1" : "flex gap-1.5"} aria-hidden="true">
        {AGENT_INSTALL_STEPS.map((step, index) => {
          let color = "border-line bg-raised";
          if (row.state === "done") color = "border-success bg-success";
          else if (index < completed) color = "border-accent bg-accent";
          else if (index === current) color = row.state === "error"
            ? "border-danger bg-danger-soft" : "border-accent bg-accent-soft";
          return <div key={step.key} className="min-w-0 flex-1">
            <div className={`${isCompact ? "h-1.5" : "h-2.5"} rounded-[2px] border ${color}`} />
            {!isCompact ? <div className={`mt-1.5 text-center text-xs ${index === current && row.state !== "done" ? row.state === "error" ? "text-danger" : "text-accent" : "text-muted"}`}>
              {step.label}{step.key === "upload" && row.state === "running" && row.step === "upload" && row.percent !== undefined ? ` ${row.percent}%` : ""}
            </div> : null}
          </div>;
        })}
      </div>
    </div>
  );
}
