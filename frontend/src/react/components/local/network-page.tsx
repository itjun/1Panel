import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api, type localsys } from "@/api";
import { Button } from "@/react/components/ui/button";
import { Tag } from "@/react/components/ui/tag";
import { Notice, Page } from "@/react/components/page";
import {
  OverviewFact,
  OverviewTable,
  type OverviewColumn,
} from "@/react/components/overview/overview-parts";
import { formatBytes, formatErr } from "@/utils/format";

const KIND_LABEL: Record<string, string> = {
  wifi: "无线",
  ethernet: "有线",
  thunderbolt: "雷雳 / 网桥",
  vpn: "VPN",
  other: "其它",
};

const IFACE_COLUMNS: OverviewColumn[] = [
  { key: "name", label: "名称" },
  { key: "kind", label: "类型" },
  { key: "state", label: "状态" },
  { key: "ipv4", label: "IPv4" },
  { key: "mac", label: "MAC" },
  { key: "rx", label: "接收", align: "right" },
  { key: "tx", label: "发送", align: "right" },
];

function displayName(ifc: localsys.NetInterface): string {
  const display = (ifc.display || "").trim();
  if (display && display !== ifc.name) return display;
  return ifc.name;
}

function isUp(ifc: localsys.NetInterface): boolean {
  return ifc.state === "up";
}

export function LocalNetworkPage() {
  const [showDown, setShowDown] = useState(false);
  const query = useQuery({
    queryKey: ["local-net"],
    queryFn: () => api.localSysNetwork(),
    refetchInterval: 8000,
  });
  const snap = query.data;
  const primaryName = snap?.primaryIface || "";

  // 出口网卡排最前，其次有 IPv4 的，最后按名称
  const sortedIfaces = useMemo(() => {
    const list = [...(snap?.interfaces || [])];
    list.sort((a, b) => {
      const ae = a.name === primaryName ? 0 : 1;
      const be = b.name === primaryName ? 0 : 1;
      if (ae !== be) return ae - be;
      const ai = (a.ipv4 || "").trim() ? 0 : 1;
      const bi = (b.ipv4 || "").trim() ? 0 : 1;
      if (ai !== bi) return ai - bi;
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [snap, primaryName]);

  const upIfaces = sortedIfaces.filter(isUp);
  const downIfaces = sortedIfaces.filter((ifc) => !isUp(ifc));
  let shownIfaces = upIfaces;
  if (showDown) {
    shownIfaces = [...upIfaces, ...downIfaces];
  }

  const privateIPText = useMemo(() => {
    const ips = snap?.privateIPs || [];
    if (ips.length) return ips.join(", ");
    return snap?.primaryIP || "—";
  }, [snap]);

  const primaryIfaceText = useMemo(() => {
    if (!primaryName) return "—";
    const hit = (snap?.interfaces || []).find((ifc) => ifc.name === primaryName);
    if (!hit) return primaryName;
    const label = displayName(hit);
    if (label === primaryName) return primaryName;
    return `${label}（${primaryName}）`;
  }, [snap, primaryName]);

  return (
    <Page title="网络信息" onRefresh={() => void query.refetch()}>
      {query.error ? <Notice text={formatErr(query.error)} /> : null}
      {snap ? (
        <div className="gap-section flex flex-col">
          <section>
            <div className="mb-3 text-sm font-semibold text-ink">概况</div>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <OverviewFact label="内网 IP" mono>
                {privateIPText}
              </OverviewFact>
              <OverviewFact label="出口网卡">{primaryIfaceText}</OverviewFact>
              <OverviewFact label="默认网关" mono>
                {snap.defaultGateway || "—"}
              </OverviewFact>
              <OverviewFact label="已连接数" mono>
                {`${upIfaces.length} / ${sortedIfaces.length}`}
              </OverviewFact>
            </div>
          </section>

          <section>
            <div className="mb-3 text-sm font-semibold text-ink">网卡</div>
            {shownIfaces.length ? (
              <OverviewTable
                columns={IFACE_COLUMNS}
                rows={shownIfaces.map((ifc) => ({
                  id: ifc.name,
                  cells: [
                    <span key="name">
                      {displayName(ifc)}
                      {displayName(ifc) !== ifc.name ? (
                        <span className="ml-2 font-mono text-xs text-muted">
                          {ifc.name}
                        </span>
                      ) : null}
                      {ifc.name === primaryName ? (
                        <Tag tone="accent" className="ml-2">
                          出口
                        </Tag>
                      ) : null}
                    </span>,
                    KIND_LABEL[ifc.kind || "other"] || ifc.kind || "—",
                    isUp(ifc) ? (
                      <Tag key="state" tone="ok">
                        已连接
                      </Tag>
                    ) : (
                      <Tag key="state" tone="neutral">
                        未连接
                      </Tag>
                    ),
                    <span key="ipv4" className="font-mono">
                      {ifc.ipv4 || "—"}
                    </span>,
                    <span key="mac" className="font-mono">
                      {ifc.mac || "—"}
                    </span>,
                    formatBytes(ifc.rxBytes || 0),
                    formatBytes(ifc.txBytes || 0),
                  ],
                }))}
              />
            ) : (
              <p className="text-sm text-muted">没有已连接的网卡</p>
            )}
            {downIfaces.length > 0 ? (
              <Button
                size="sm"
                variant="ghost"
                className="mt-2"
                onClick={() => setShowDown((prev) => !prev)}
              >
                {showDown ? "收起" : `展开 ${downIfaces.length} 个未连接网卡`}
              </Button>
            ) : null}
          </section>
        </div>
      ) : (
        <p className="text-sm text-muted">
          {query.isLoading ? "加载中…" : "暂无网络数据"}
        </p>
      )}
    </Page>
  );
}
