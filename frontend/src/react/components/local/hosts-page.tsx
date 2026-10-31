import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "@/api";
import { TextReader } from "@/react/components/text-reader";
import { FileWorkspace, FileWorkspacePage } from "../file-workspace";
import { formatErr } from "@/utils/format";
import { hostsHighlightHtml } from "@/utils/hostsHighlight";
import { HighlightPane } from "./highlight-pane";

export function LocalHostsPage() {
  const query = useQuery({
    queryKey: ["local-hosts"],
    queryFn: () => api.localSysHosts(),
    retry: false,
  });
  const raw = query.data?.raw || "";
  const html = useMemo(() => hostsHighlightHtml(raw), [raw]);
  const pathLabel = query.data?.path || "";

  return (
    <FileWorkspacePage title="Hosts"
      onRefresh={() => query.refetch({ throwOnError: true })} isRefreshing={query.isFetching}>
      <FileWorkspace files={pathLabel ? [{ path: pathLabel, name: "hosts" }] : []} path={pathLabel} onSelect={() => {}} isLoading={query.isPending}>
      <TextReader path={pathLabel} text={raw} isLoading={query.isPending} isRefreshing={query.isFetching}
        error={query.error ? `读取失败：${formatErr(query.error)}` : undefined}>
        <HighlightPane html={html} text={raw} label="Hosts 内容" showCopy={false} />
      </TextReader>
      </FileWorkspace>
    </FileWorkspacePage>
  );
}
