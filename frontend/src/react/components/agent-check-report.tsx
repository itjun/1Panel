import type { agentcli } from "@/api";
import { Tag } from "@/react/components/ui/tag";

export function AgentCheckReport({ report }: { report: agentcli.CheckReport }) {
  return (
    <div className="mt-3 space-y-4">
      <p role="status" className={`text-sm ${report.ok ? "text-success-text" : "text-danger"}`}>
        {report.summary}
      </p>
      {report.items?.length ? (
        <ul className="space-y-3" aria-label="Agent 检查明细">
          {report.items.map(item => (
            <li key={item.key} className="space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">{item.name}</span>
                <Tag tone={item.ok ? "ok" : "danger"}>{item.ok ? "正常" : "异常"}</Tag>
              </div>
              {item.detail ? (
                <p className={`whitespace-pre-wrap break-words text-xs leading-relaxed ${item.ok ? "text-muted" : "text-danger"}`}>
                  {item.detail}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted">未返回检查明细</p>}
    </div>
  );
}
