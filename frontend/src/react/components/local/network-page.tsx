import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api, type localsys } from "@/api";
import { Button } from "@/react/components/ui/button";
import { Card } from "@/react/components/ui/card";
import { Notice, Page } from "@/react/components/page";
import { formatBytes, formatErr } from "@/utils/format";

const KIND_ORDER = ["wifi", "ethernet", "thunderbolt", "vpn", "other"] as const;
const KIND_LABEL: Record<string, string> = {
  wifi: "无线网",
  ethernet: "有线网",
  thunderbolt: "雷雳 / 网桥",
  vpn: "VPN",
  other: "其它",
};

function displayName(ifc: localsys.NetInterface): string {
  const display = (ifc.display || "").trim();
  if (display && display !== ifc.name) return display;
  return ifc.name;
}

export function LocalNetworkPage() {
  const [showAll, setShowAll] = useState(false);
  const query = useQuery({
    queryKey: ["local-net"],
    queryFn: () => api.localSysNetwork(),
    refetchInterval: 8000,
  });
  const snap = query.data;

  const upCount = useMemo(
    () => (snap?.interfaces || []).filter((ifc) => ifc.state === "up").length,
    [snap],
  );
  const downCount = useMemo(
    () => (snap?.interfaces || []).filter((ifc) => ifc.state !== "up").length,
    [snap],
  );

  function isEgress(ifc: localsys.NetInterface): boolean {
    const primary = snap?.primaryIface || "";
    return !!primary && ifc.name === primary;
  }

  function isVpnDim(ifc: localsys.NetInterface): boolean {
    if ((ifc.kind || "") !== "vpn") return false;
    if (isEgress(ifc)) return false;
    return !(ifc.ipv4 || "").trim();
  }

  function sortIfaces(items: localsys.NetInterface[]): localsys.NetInterface[] {
    return [...items].sort((a, b) => {
      const ae = isEgress(a) ? 0 : 1;
      const be = isEgress(b) ? 0 : 1;
      if (ae !== be) return ae - be;
      const au = a.state === "up" ? 0 : 1;
      const bu = b.state === "up" ? 0 : 1;
      if (au !== bu) return au - bu;
      const ad = isVpnDim(a) ? 1 : 0;
      const bd = isVpnDim(b) ? 1 : 0;
      if (ad !== bd) return ad - bd;
      const ai = (a.ipv4 || "").trim() ? 0 : 1;
      const bi = (b.ipv4 || "").trim() ? 0 : 1;
      if (ai !== bi) return ai - bi;
      return a.name.localeCompare(b.name);
    });
  }

  const primaryIfaceText = useMemo(() => {
    const name = snap?.primaryIface || "";
    if (!name) return "—";
    const hit = (snap?.interfaces || []).find((ifc) => ifc.name === name);
    if (!hit) return name;
    const label = displayName(hit);
    if (label === name) return name;
    return `${label}（${name}）`;
  }, [snap]);

  const visibleGroups = useMemo(() => {
    const list = (snap?.interfaces || []).filter((ifc) => {
      if (showAll) return true;
      return ifc.state === "up";
    });
    const map = new Map<string, localsys.NetInterface[]>();
    for (const ifc of list) {
      const kind = ifc.kind || "other";
      if (!map.has(kind)) map.set(kind, []);
      map.get(kind)!.push(ifc);
    }
    const out: { kind: string; label: string; items: localsys.NetInterface[] }[] =
      [];
    for (const kind of KIND_ORDER) {
      const items = map.get(kind);
      if (items?.length) {
        out.push({
          kind,
          label: KIND_LABEL[kind] || kind,
          items: sortIfaces(items),
        });
      }
    }
    for (const [kind, items] of map) {
      if (!(KIND_ORDER as readonly string[]).includes(kind) && items.length) {
        out.push({
          kind,
          label: KIND_LABEL[kind] || kind,
          items: sortIfaces(items),
        });
      }
    }
    return out;
    // sortIfaces 依赖 snap，已在闭包内
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAll, snap]);

  return (
    <Page
      title="网络信息"
      actions={<Button onClick={() => void query.refetch()}>刷新</Button>}
    >
      {query.error ? <Notice text={formatErr(query.error)} /> : null}
      <div className="flex flex-col gap-4">
        <Card>
          <div className="text-lg font-medium font-mono">
            {snap?.primaryIP || "—"}
          </div>
          <div className="mt-3 grid gap-2 text-sm md:grid-cols-3">
            <div>
              <span className="text-muted">出口网卡 </span>
              {primaryIfaceText}
            </div>
            <div>
              <span className="text-muted">网关 </span>
              <span className="font-mono">{snap?.defaultGateway || "无"}</span>
            </div>
            <div>
              <span className="text-muted">已连接 </span>
              {upCount} 张
            </div>
          </div>
          {(snap?.privateIPs || []).length ? (
            <p className="mt-2 text-sm text-muted">
              内网 IP：{(snap?.privateIPs || []).join("、")}
            </p>
          ) : null}
        </Card>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="opt-check">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
            />
            {showAll ? "全部" : "已连"}
          </label>
          <span className="text-muted">
            {showAll
              ? "显示全部网卡"
              : downCount > 0
                ? `已隐藏 ${downCount} 张未连接`
                : "当前全部已连接"}
          </span>
        </div>

        {visibleGroups.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">
              {showAll ? "未发现网卡" : "没有已连接的网卡"}
            </p>
          </Card>
        ) : (
          visibleGroups.map((group) => (
            <Card key={group.kind} className="overflow-hidden p-0">
              <div className="border-b border-line px-5 py-3 font-medium">
                {group.label}
                <span className="ml-2 text-sm font-normal text-muted">
                  {group.items.length}
                </span>
              </div>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="h-10 bg-raised">
                    <th className="w-12 px-3 text-center">序</th>
                    <th className="px-3">名称</th>
                    <th className="px-3">状态</th>
                    <th className="px-3">IPv4</th>
                    <th className="px-3">MAC</th>
                    <th className="px-3">收 / 发</th>
                  </tr>
                </thead>
                <tbody>
                  {group.items.map((ifc, idx) => (
                    <tr
                      key={ifc.name}
                      className={
                        ifc.state !== "up"
                          ? "h-12 border-t border-line opacity-60"
                          : isVpnDim(ifc)
                            ? "h-12 border-t border-line opacity-50"
                            : "h-12 border-t border-line"
                      }
                    >
                      <td className="px-3 text-center font-mono text-muted">
                        {idx + 1}
                      </td>
                      <td className="px-3">
                        <div>
                          {displayName(ifc)}
                          {isEgress(ifc) ? (
                            <span className="ml-2 text-xs text-accent">出口</span>
                          ) : null}
                        </div>
                        <div className="font-mono text-xs text-muted">
                          {ifc.name}
                        </div>
                      </td>
                      <td className="px-3">
                        {ifc.state === "up" ? "已连接" : "未连接"}
                      </td>
                      <td className="px-3 font-mono">{ifc.ipv4 || "—"}</td>
                      <td className="px-3 font-mono">{ifc.mac || "—"}</td>
                      <td className="px-3 font-mono tabular-nums">
                        <span className="text-io-read">
                          {formatBytes(ifc.rxBytes || 0)}
                        </span>
                        {" / "}
                        <span className="text-io-write">
                          {formatBytes(ifc.txBytes || 0)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ))
        )}
      </div>
    </Page>
  );
}
