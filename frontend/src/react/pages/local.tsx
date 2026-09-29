import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api, type main } from "@/api";
import { LocalAppsPage } from "@/react/components/local/apps-page";
import { LocalHostsPage } from "@/react/components/local/hosts-page";
import { LocalMonitorPage } from "@/react/components/local/monitor-page";
import { LocalNetworkPage } from "@/react/components/local/network-page";
import { LocalNginxPage } from "@/react/components/local/nginx-page";
import { LocalOverviewPage } from "@/react/components/local/overview-page";
import { LocalPackagesPage } from "@/react/components/local/packages-page";
import { LocalStoragePage } from "@/react/components/local/storage-page";
import { Button } from "@/react/components/ui/button";
import { Card } from "@/react/components/ui/card";
import { Tag, type TagTone } from "@/react/components/ui/tag";
import { Notice, Page } from "@/react/components/page";
import { useSession, type LocalSection } from "@/react/state/session";
import { formatErr } from "@/utils/format";

export function LocalPage() {
  const session = useSession();
  const section = session.localSection;
  if (section === "monitor") return <LocalMonitorPage />;
  if (section === "procs") return <LocalAppsPage />;
  if (section === "packages") return <LocalPackagesPage />;
  if (section === "storage") return <LocalStoragePage />;
  if (section === "network") return <LocalNetworkPage />;
  if (section === "nginx") return <LocalNginxPage />;
  if (section === "hosts") return <LocalHostsPage />;
  return <LocalOverviewPage />;
}

export function InspectPage() {
  const query = useQuery({ queryKey: ["menu-checks"], queryFn: () => api.listMenuChecks() });
  const [busyId, setBusyId] = useState("");
  const [checkingAll, setCheckingAll] = useState(false);
  const [localRows, setLocalRows] = useState<main.MenuCheckResult[]>([]);

  useEffect(() => {
    if (query.data) setLocalRows(query.data);
  }, [query.data]);

  const summary = useMemo(() => {
    const total = localRows.length;
    const ok = localRows.filter((item) => item.ok && item.hasData).length;
    const bad = localRows.filter((item) => item.checkedAt > 0 && (!item.ok || !item.hasData)).length;
    const parts = [`共 ${total} 项`];
    if (ok > 0) parts.push(`正常 ${ok}`);
    if (bad > 0) parts.push(`异常 ${bad}`);
    return parts.join(" · ");
  }, [localRows]);

  async function checkOne(id: string) {
    setBusyId(id);
    try {
      const result = await api.checkMenuPage(id);
      setLocalRows((prev) => prev.map((item) => (item.id === id ? result : item)));
    } catch (error) {
      setLocalRows((prev) =>
        prev.map((item) =>
          item.id === id
            ? {
                ...item,
                ok: false,
                hasData: false,
                message: formatErr(error),
                checkedAt: Math.floor(Date.now() / 1000),
              }
            : item,
        ),
      );
    } finally {
      setBusyId("");
    }
  }

  async function checkAll() {
    setCheckingAll(true);
    try {
      const list = await api.listMenuChecks();
      setLocalRows(list);
      for (const item of list) {
        await checkOne(item.id);
      }
    } finally {
      setCheckingAll(false);
    }
  }

  return (
    <Page
      title="菜单检查"
      actions={
        <>
          <span className="text-sm text-muted">{summary}</span>
          <Button
            variant="primary"
            size="sm"
            disabled={checkingAll}
            onClick={() => void checkAll()}
          >
            {checkingAll ? "检查中…" : "全部检查"}
          </Button>
        </>
      }
    >
      {query.error ? <Notice text={formatErr(query.error)} /> : null}
      {localRows.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">暂无巡检项（后端未返回任何菜单检查配置）</p>
        </Card>
      ) : (
        <div className="gap-card grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {localRows.map((item) => {
            const checked = item.checkedAt > 0;
            const status =
              busyId === item.id
                ? "checking"
                : !checked
                  ? "idle"
                  : item.ok && item.hasData
                    ? "ok"
                    : "bad";
            let statusTone: TagTone = "neutral";
            let statusText = "未检查";
            if (status === "checking") {
              statusTone = "info";
              statusText = "检查中…";
            } else if (status === "ok") {
              statusTone = "ok";
              statusText = "正常";
            } else if (status === "bad") {
              statusTone = "danger";
              statusText = "异常";
            }
            return (
              <Card
                key={item.id}
                className="cursor-pointer bg-raised p-4 hover:bg-line"
                onClick={() => void checkOne(item.id)}
              >
                <div className="mb-3 flex items-center gap-2">
                  {/* 状态指示灯：唯一允许的圆点 */}
                  <span
                    className={
                      status === "ok"
                        ? "h-2.5 w-2.5 rounded-full bg-success"
                        : status === "bad"
                          ? "h-2.5 w-2.5 rounded-full bg-danger"
                          : status === "checking"
                            ? "h-2.5 w-2.5 rounded-full bg-accent"
                            : "h-2.5 w-2.5 rounded-full bg-muted"
                    }
                  />
                  <span className="font-semibold">{item.title || item.label || item.id}</span>
                  {/* 单元是 raised 色块，neutral 标签换 surface 底才看得见 */}
                  <Tag
                    tone={statusTone}
                    className={statusTone === "neutral" ? "ml-auto bg-surface" : "ml-auto"}
                  >
                    {statusText}
                  </Tag>
                </div>
                <div className="grid gap-2 text-sm">
                  <div className="flex gap-3">
                    <span className="w-10 shrink-0 text-muted">菜单</span>
                    <span className={item.ok ? "text-success-text" : checked ? "text-danger" : ""}>
                      {item.menuText || "—"}
                    </span>
                  </div>
                  <div className="flex gap-3">
                    <span className="w-10 shrink-0 text-muted">数据</span>
                    <span
                      className={item.hasData ? "text-success-text" : checked ? "text-danger" : ""}
                    >
                      {item.dataText || "—"}
                    </span>
                  </div>
                  {item.message ? (
                    <div className="break-all text-muted">{item.message}</div>
                  ) : null}
                  {item.checkedAt ? (
                    <div className="text-xs text-muted">
                      {new Date(item.checkedAt * 1000).toLocaleString()}
                    </div>
                  ) : null}
                </div>
                <div className="mt-3 text-xs text-muted">
                  {busyId === item.id ? "检查中…" : "点击检查"}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </Page>
  );
}

export const LOCAL_SECTIONS: { id: LocalSection; label: string }[] = [
  { id: "overview", label: "系统概览" },
  { id: "monitor", label: "性能监控" },
  { id: "procs", label: "应用进程" },
  { id: "packages", label: "软件列表" },
  { id: "storage", label: "磁盘空间" },
  { id: "network", label: "网络信息" },
  { id: "nginx", label: "Nginx" },
  { id: "hosts", label: "Hosts" },
];
