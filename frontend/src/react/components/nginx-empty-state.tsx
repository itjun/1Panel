import { PackageSearch, RefreshCw } from "lucide-react";
import { Button } from "@/react/components/ui/button";
import { usePageRefresh } from "@/react/state/page-refresh";

/** 使用页面的刷新入口，让空状态按钮、右上角刷新与快捷键共用防重。 */
export function NginxEmptyState({ isLocal = false }: { isLocal?: boolean }) {
  const { busy: isChecking, run } = usePageRefresh();
  return (
    <div className="nginx-empty-state">
      <div className="nginx-empty-state-content">
        <div className="nginx-empty-state-icon" aria-hidden>
          <PackageSearch size={32} strokeWidth={1.5} />
        </div>
        <div className="nginx-empty-state-message" role="status">
          <h2>未检测到 Nginx</h2>
          <p>{isLocal ? "在本机安装后，重新检查即可查看配置和日志。" : "在当前主机安装后，重新检查即可查看配置和日志。"}</p>
        </div>
        <Button variant="primary" disabled={isChecking} aria-busy={isChecking} onClick={() => void run()}>
          <RefreshCw size={16} className={isChecking ? "animate-spin motion-reduce:animate-none" : ""} aria-hidden />
          {isChecking ? "正在检查…" : "重新检查"}
        </Button>
      </div>
    </div>
  );
}
