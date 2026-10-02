import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "@/api";
import { RadioGroup } from "@/react/components/ui/radio-group";
import { Tag } from "@/react/components/ui/tag";
import { Notice, Page } from "@/react/components/page";
import { formatErr } from "@/utils/format";
import { isLinuxPlatform, isWindowsPlatform } from "@/react/lib/platform";

const MAC_SOURCE_OPTS = [
  { value: "all", label: "全部" },
  { value: "app", label: "应用程序" },
  { value: "formula", label: "Formula" },
  { value: "cask", label: "Cask" },
] as const;

const WIN_SOURCE_OPTS = [
  { value: "all", label: "全部" },
  { value: "system", label: "系统安装（64 位）" },
  { value: "system32", label: "系统安装（32 位）" },
  { value: "user", label: "当前用户" },
] as const;

/** Linux 来源按包管理器出现顺序展示；列表数据返回什么就展示什么 */
const LINUX_SOURCE_ORDER = ["app", "dpkg", "rpm", "pacman", "flatpak", "snap"] as const;
const LINUX_SOURCE_LABELS: Record<string, string> = {
  app: "桌面应用",
  dpkg: "dpkg",
  rpm: "RPM",
  pacman: "pacman",
  flatpak: "Flatpak",
  snap: "Snap",
};

const SOURCE_OPTS = isWindowsPlatform() ? WIN_SOURCE_OPTS : MAC_SOURCE_OPTS;

/** 来源标签与筛选选项同源派生，避免双份维护 */
const SOURCE_LABELS: Record<string, string> = Object.fromEntries(
  [...MAC_SOURCE_OPTS, ...WIN_SOURCE_OPTS]
    .filter((opt) => opt.value !== "all")
    .map((opt) => [opt.value, opt.label]),
  // Object.fromEntries 的第二参为 mapFn，这里改用合并写法
);
Object.assign(SOURCE_LABELS, LINUX_SOURCE_LABELS);

function sourceLabel(s: string) {
  return SOURCE_LABELS[s] || s || "—";
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
    const out: Record<string, number> = { all: all.length };
    for (const item of all) {
      if (item.source && item.source !== "all") {
        out[item.source] = (out[item.source] || 0) + 1;
      }
    }
    return out;
  }, [query.data]);

  // Linux 来源随包管理器存在性动态出现，其余平台用固定选项
  const sourceOptions = useMemo(() => {
    if (!isLinuxPlatform()) return SOURCE_OPTS;
    const present = LINUX_SOURCE_ORDER.filter((value) => counts[value] > 0);
    if (present.length === 0) return SOURCE_OPTS;
    return [
      { value: "all", label: "全部" },
      ...present.map((value) => ({ value, label: LINUX_SOURCE_LABELS[value] || value })),
    ];
  }, [counts]);

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
            options={sourceOptions.map((item) => {
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
