import { useQuery } from "@tanstack/react-query";
import { Notice } from "@/react/components/page";
import { Button } from "@/react/components/ui/button";
import { panelConfigNeedsAttention, panelConfigOverviewQuery } from "@/react/lib/panel-config-overview";

export function HostSshConfigNotice({ onOpen }: { onOpen: () => void }) {
  const { data, isError } = useQuery(panelConfigOverviewQuery);
  if (!isError && !panelConfigNeedsAttention(data)) return null;

  const missing = data?.diff?.removedHosts || [];
  let text = "应用记录与本机 SSH 配置不一致，请检查差异并选择处理方式。";
  if (isError) {
    text = "读取本机 SSH 配置失败，请查看错误详情。";
  } else if (missing.length === 1) {
    text = `本机 SSH 配置缺少主机 ${missing[0]}。可移除应用中的主机记录，或按应用记录恢复配置。`;
  } else if (missing.length > 1) {
    text = `本机 SSH 配置缺少 ${missing.length} 台主机。请检查差异并选择处理方式。`;
  }

  return (
    <div className="mx-4 mb-3">
      <Notice tone={isError ? "error" : "warning"} text={text}
        actions={<Button size="sm" onClick={onOpen}>处理 SSH 配置</Button>} />
    </div>
  );
}
