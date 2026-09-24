import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "@/api";
import { Button } from "@/react/components/ui/button";
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
          {SOURCE_OPTS.map((item) => {
            const count = counts[item.value];
            return (
              <Button
                key={item.value}
                variant={source === item.value ? "primary" : "secondary"}
                onClick={() => setSource(item.value)}
              >
                {item.label}
                {count > 0 ? <span className="opacity-70">({count})</span> : null}
              </Button>
            );
          })}
          <input
            className="h-8 rounded-control border border-line px-3"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索名称 / 路径…"
          />
          <Button onClick={() => void query.refetch()}>刷新</Button>
        </>
      }
    >
      {query.error ? <Notice text={formatErr(query.error)} /> : null}
      <div className="min-h-48 flex-1 overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-[1]">
              <tr className="h-10 bg-[#f7f8fa]">
                <th className="w-14 px-3 text-center">序</th>
                <th className="px-3">名称</th>
                <th className="px-3">版本</th>
                <th className="px-3">来源</th>
                <th className="px-3">路径</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr className="h-12 border-t border-line">
                  <td className="px-3 text-muted" colSpan={5}>
                    未找到已安装软件
                  </td>
                </tr>
              ) : (
                rows.map((item, idx) => (
                  <tr
                    key={`${item.source}-${item.name}-${item.path}`}
                    className="h-12 border-t border-line"
                  >
                    <td className="px-3 text-center font-mono text-muted">
                      {idx + 1}
                    </td>
                    <td className="px-3">{item.name}</td>
                    <td className="px-3 font-mono">{item.version || "—"}</td>
                    <td className="px-3">{sourceLabel(item.source)}</td>
                    <td className="max-w-[360px] truncate px-3 font-mono text-muted">
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
