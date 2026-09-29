import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "@/api";
import { RadioGroup } from "@/react/components/ui/radio-group";
import { Tag } from "@/react/components/ui/tag";
import { Notice, Page } from "@/react/components/page";
import { formatErr } from "@/utils/format";

const SOURCE_OPTS = [
  { value: "all", label: "全部" },
  { value: "app", label: "应用程序" },
  { value: "formula", label: "Formula" },
  { value: "cask", label: "Cask" },
] as const;

function sourceLabel(s: string) {
  if (s === "app") return "应用程序";
  if (s === "formula") return "Formula";
  if (s === "cask") return "Cask";
  return s || "—";
}

export function LocalPackagesPage() {
  const [keyword, setKeyword] = useState("");
  const [source, setSource] = useState("all");
  const query = useQuery({
    queryKey: ["local-pkgs"],
    queryFn: () => api.localSysPackages(),
  });

  const counts = useMemo(() => {
    const all = query.data || [];
    const count = (s: string) => all.filter((p) => p.source === s).length;
    return {
      all: all.length,
      app: count("app"),
      formula: count("formula"),
      cask: count("cask"),
    };
  }, [query.data]);

  const rows = useMemo(() => {
    let list = query.data || [];
    if (source !== "all") {
      list = list.filter((item) => item.source === source);
    }
    const kw = keyword.trim().toLowerCase();
    if (!kw) return list;
    return list.filter(
      (item) =>
        (item.name || "").toLowerCase().includes(kw) ||
        (item.path || "").toLowerCase().includes(kw) ||
        (item.version || "").toLowerCase().includes(kw),
    );
  }, [keyword, query.data, source]);

  return (
    <Page
      title="软件列表"
      actions={
        <>
          <RadioGroup
            aria-label="来源"
            value={source}
            onChange={setSource}
            options={SOURCE_OPTS.map((item) => {
              const count = counts[item.value];
              return {
                value: item.value,
                label: count > 0 ? `${item.label} (${count})` : item.label,
              };
            })}
          />
          <input
            className="motion-field h-7 rounded-control px-3 text-sm text-ink"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索名称 / 路径…"
          />
        </>
      }
      onRefresh={() => void query.refetch()}
      refreshing={query.isFetching}
    >
      {query.error ? <Notice text={formatErr(query.error)} /> : null}
      {/* 表格直接铺在内容平面上，吸顶表头用 surface 底遮挡滚动内容 */}
      <div className="surface-float min-h-48 flex-1 overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-[1]">
              <tr className="h-table-head border-b border-line bg-surface text-xs font-normal text-muted">
                <th className="w-14 px-3 text-center">序</th>
                <th className="px-3">名称</th>
                <th className="px-3">版本</th>
                <th className="px-3">来源</th>
                <th className="px-3">路径</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr className="h-table-row border-t border-line">
                  <td className="px-3 text-muted" colSpan={5}>
                    未找到已安装软件
                  </td>
                </tr>
              ) : (
                rows.map((item, idx) => (
                  <tr
                    key={`${item.source}-${item.name}-${item.path}`}
                    className="h-table-row border-t border-line"
                  >
                    <td className="px-3 text-center font-mono text-muted">
                      {idx + 1}
                    </td>
                    <td className="px-3">{item.name}</td>
                    <td className="px-3 font-mono">{item.version || "—"}</td>
                    <td className="px-3">
                      <Tag>{sourceLabel(item.source)}</Tag>
                    </td>
                    <td
                      className="max-w-[360px] truncate px-3 font-mono text-muted"
                      data-tip={item.path || ""}
                      data-tip-overflow=""
                    >
                      {item.path || "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
      </div>
    </Page>
  );
}
