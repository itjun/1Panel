import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "@/api";
import type { monitor } from "@/api";
import { Button } from "@/react/components/ui/button";
import { Card } from "@/react/components/ui/card";
import { Notice, Page } from "@/react/components/page";
import { copyText } from "@/utils/clipboard";
import { formatBytes, formatErr } from "@/utils/format";

const IP_COLLAPSE_LIMIT = 3;
const PAGE_SIZE = 100;

type IpGroupKey = "private" | "public" | "docker";

function pureIp(raw: string): string {
  if (!raw) return "";
  const noParen = raw.split("(")[0].trim();
  return noParen.split("/")[0].trim();
}

function uniqIps(list: string[] | undefined | null): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list || []) {
    const ip = pureIp(raw);
    if (!ip || seen.has(ip)) continue;
    seen.add(ip);
    out.push(ip);
  }
  return out;
}

function ConnState({ state }: { state: string }) {
  const s = (state || "").toUpperCase();
  let tone = "bg-raised text-muted";
  if (s === "ESTABLISHED" || s === "ESTAB") {
    tone = "bg-io-read/15 text-io-read";
  } else if (s === "LISTEN" || s === "LISTENING") {
    tone = "bg-accent-soft text-accent";
  } else if (s.includes("WAIT") || s === "CLOSE" || s === "CLOSED") {
    tone = "bg-warn-soft text-warn";
  }
  return (
    <span
      className={`inline-block rounded-control px-1.5 py-0.5 font-mono text-xs font-medium ${tone}`}
    >
      {state || "—"}
    </span>
  );
}

function IfaceState({ state }: { state: string }) {
  const up = (state || "").toUpperCase() === "UP";
  return (
    <span className={up ? "font-medium text-io-read" : "text-muted"}>
      {state || "—"}
    </span>
  );
}

function kindLabel(k: string) {
  if (k === "physical") return "物理";
  if (k === "docker") return "Docker";
  if (k === "virtual") return "虚拟";
  if (k === "loopback") return "回环";
  if (k === "other") return "其他";
  return k || "—";
}

function ifaceIpv4List(list: string[] | undefined | null): string[] {
  return (list || []).map((x) => pureIp(x)).filter(Boolean);
}

function SimpleRows({
  headers,
  rows,
  /** 为 false 时不自动加「序」（调用方已自行提供序号列时用） */
  showIndex = true,
  indexOffset = 0,
}: {
  headers: { key: string; label: string }[];
  rows: { id: string; cells: ReactNode[]; className?: string }[];
  showIndex?: boolean;
  indexOffset?: number;
}) {
  const colCount = headers.length + (showIndex ? 1 : 0);
  return (
    <div className="min-h-48 flex-1 overflow-auto bg-surface">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="sticky top-0 z-[1] bg-raised">
          <tr className="h-10">
            {showIndex ? (
              <th className="w-12 px-2 text-center font-medium">序</th>
            ) : null}
            {headers.map((header) => (
              <th key={header.key} className="px-3 font-medium">
                {header.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr className="h-12">
              <td className="px-3 text-muted" colSpan={colCount || 1}>
                暂无数据
              </td>
            </tr>
          ) : (
            rows.map((row, rowIndex) => (
              <tr
                key={row.id}
                className={row.className || "h-12 border-t border-line/70 hover:bg-raised"}
              >
                {showIndex ? (
                  <td className="px-2 text-center align-middle font-mono text-xs tabular-nums text-muted">
                    {indexOffset + rowIndex + 1}
                  </td>
                ) : null}
                {row.cells.map((cell, index) => (
                  <td key={index} className="max-w-[360px] truncate px-3 align-middle">
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function IpCopyButton({
  ip,
  loc,
  tag,
  onCopied,
}: {
  ip: string;
  loc?: string;
  tag?: string;
  onCopied: (msg: string) => void;
}) {
  return (
    <button
      type="button"
      title={`点击复制 ${ip}`}
      className="mt-1 flex w-full items-center gap-2 rounded-control bg-raised px-3 py-2 text-left hover:bg-line"
      onClick={() => {
        void copyText(ip)
          .then(() => onCopied(`已复制 ${ip}`))
          .catch((e) => onCopied(`复制失败: ${formatErr(e)}`));
      }}
    >
      <span
        className={
          tag
            ? "min-w-0 flex-1 truncate font-mono text-sm font-semibold text-accent"
            : "min-w-0 flex-1 truncate font-mono text-sm font-medium"
        }
      >
        {tag ? (
          <span className="mr-2 rounded-control bg-accent px-1.5 py-0.5 text-[10px] text-white">{tag}</span>
        ) : null}
        {ip}
        {loc ? <span className="ml-2 text-xs font-normal text-muted">{loc}</span> : null}
      </span>
      <span className="shrink-0 text-xs text-accent">复制</span>
    </button>
  );
}

function IpCard({
  title,
  emptyText,
  ips,
  expanded,
  onToggle,
  leading,
  onCopied,
}: {
  title: string;
  emptyText: string;
  ips: string[];
  expanded: boolean;
  onToggle: () => void;
  leading?: ReactNode;
  onCopied: (msg: string) => void;
}) {
  const visible =
    expanded || ips.length <= IP_COLLAPSE_LIMIT ? ips : ips.slice(0, IP_COLLAPSE_LIMIT);
  const hasMore = ips.length > IP_COLLAPSE_LIMIT;

  return (
    <Card>
      <div className="text-sm font-medium text-muted">{title}</div>
      {!leading && !ips.length ? (
        <div className="mt-2 text-sm text-muted">{emptyText}</div>
      ) : null}
      {leading}
      {visible.map((ip) => (
        <IpCopyButton key={ip} ip={ip} onCopied={onCopied} />
      ))}
      {hasMore ? (
        <button
          type="button"
          className="mt-2 w-full rounded-control px-2 py-1.5 text-center text-sm text-accent hover:bg-raised"
          onClick={onToggle}
        >
          {expanded ? "收起" : `展开剩余 ${ips.length - IP_COLLAPSE_LIMIT} 个`}
        </button>
      ) : null}
    </Card>
  );
}

export function NetworkPage({ host }: { host: string }) {
  const [filter, setFilter] = useState("");
  const [onlyEstab, setOnlyEstab] = useState(false);
  const [onlySlow, setOnlySlow] = useState(false);
  const [page, setPage] = useState(1);
  const [msg, setMsg] = useState("");
  const [ipExpanded, setIpExpanded] = useState<Record<IpGroupKey, boolean>>({
    private: false,
    public: false,
    docker: false,
  });

  const query = useQuery({
    queryKey: ["net", host],
    queryFn: () => api.collectNetwork(host),
    refetchInterval: 8000,
  });
  const snap = query.data;

  const privateIPs = useMemo(() => uniqIps(snap?.privateIPs), [snap?.privateIPs]);
  const publicIPs = useMemo(() => uniqIps(snap?.publicIPs), [snap?.publicIPs]);
  const dockerIPs = useMemo(() => uniqIps(snap?.dockerIPs), [snap?.dockerIPs]);

  const filteredConns = useMemo(() => {
    let list: monitor.NetConnection[] = snap?.connections || [];
    if (onlySlow) list = list.filter((c) => c.slow);
    if (onlyEstab) {
      list = list.filter((c) =>
        String(c.state || "")
          .toUpperCase()
          .includes("ESTAB"),
      );
    }
    const q = filter.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (c) =>
          (c.process || "").toLowerCase().includes(q) ||
          (c.localAddr || "").toLowerCase().includes(q) ||
          (c.remoteAddr || "").toLowerCase().includes(q) ||
          (c.state || "").toLowerCase().includes(q) ||
          String(c.pid).includes(q),
      );
    }
    return list;
  }, [snap?.connections, onlySlow, onlyEstab, filter]);

  const pageCount = Math.max(1, Math.ceil(filteredConns.length / PAGE_SIZE) || 1);
  const safePage = Math.min(page, pageCount);
  const pageRows = filteredConns.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  useEffect(() => {
    setPage(1);
  }, [filter, onlyEstab, onlySlow, host]);

  function toggleIp(key: IpGroupKey) {
    setIpExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const slowList = snap?.slowConnections || [];
  const gatewayIp = pureIp(snap?.defaultGateway || "");
  const egressIp = pureIp(snap?.egressPublicIP || "");

  return (
    <Page
      title="网络"
      actions={
        <>
          <span className="text-sm text-muted">
            连接 {snap?.connTotal ?? 0} · 已建立 {snap?.connEstablished ?? 0} · 监听{" "}
            {snap?.connListen ?? 0} · TIME_WAIT {snap?.connTimeWait ?? 0}
          </span>
          {slowList.length ? (
            <span className="rounded-control bg-danger px-2 py-0.5 text-xs text-white">
              卡顿连接 {slowList.length}
            </span>
          ) : null}
          <Button disabled={query.isFetching} onClick={() => void query.refetch()}>
            {query.isFetching ? "刷新中…" : "刷新"}
          </Button>
        </>
      }
    >
      {query.error ? <Notice text={formatErr(query.error)} /> : null}
      {msg ? <Notice tone="warn" text={msg} /> : null}

      {!snap && query.isLoading ? <p className="text-sm text-muted">加载中…</p> : null}

      {snap ? (
        <div className="gap-card flex flex-col">
          <div className="gap-card grid md:grid-cols-2 xl:grid-cols-4">
            <IpCard
              title="内网 IP"
              emptyText="未获取到"
              ips={privateIPs}
              expanded={ipExpanded.private}
              onToggle={() => toggleIp("private")}
              onCopied={setMsg}
            />
            <IpCard
              title="公网 / 外网 IP"
              emptyText="未获取到"
              ips={publicIPs}
              expanded={ipExpanded.public}
              onToggle={() => toggleIp("public")}
              onCopied={setMsg}
              leading={
                egressIp ? (
                  <IpCopyButton
                    ip={egressIp}
                    tag="出口"
                    loc={snap.egressPublicLoc || undefined}
                    onCopied={setMsg}
                  />
                ) : null
              }
            />
            <IpCard
              title="Docker 网桥 IP"
              emptyText="未检测到"
              ips={dockerIPs}
              expanded={ipExpanded.docker}
              onToggle={() => toggleIp("docker")}
              onCopied={setMsg}
            />
            <Card>
              <div className="text-sm font-medium text-muted">默认网关</div>
              {gatewayIp ? (
                <IpCopyButton ip={gatewayIp} onCopied={setMsg} />
              ) : (
                <div className="mt-2 text-sm text-muted">未获取到</div>
              )}
            </Card>
          </div>

          <Card>
            <h3 className="mb-3 font-medium">网卡</h3>
            <SimpleRows
              headers={[
                { key: "name", label: "接口" },
                { key: "kind", label: "类型" },
                { key: "state", label: "状态" },
                { key: "mtu", label: "MTU" },
                { key: "mac", label: "MAC" },
                { key: "ipv4", label: "IPv4" },
                { key: "rx", label: "接收" },
                { key: "tx", label: "发送" },
              ]}
              rows={(snap.interfaces || []).map((n) => ({
                id: n.name,
                cells: [
                  n.name || "—",
                  kindLabel(n.kind),
                  <IfaceState key="state" state={n.state || ""} />,
                  n.mtu || "—",
                  n.mac || "—",
                  <div key="ips" className="flex flex-col gap-0.5 whitespace-normal">
                    {ifaceIpv4List(n.ipv4).length
                      ? ifaceIpv4List(n.ipv4).map((ip) => <span key={ip}>{ip}</span>)
                      : "—"}
                  </div>,
                  <span className="font-mono tabular-nums text-io-read">
                    {formatBytes(n.rxBytes || 0)}
                  </span>,
                  <span className="font-mono tabular-nums text-io-write">
                    {formatBytes(n.txBytes || 0)}
                  </span>,
                ],
              }))}
            />
          </Card>

          {slowList.length ? (
            <Card>
              <h3 className="mb-3 font-medium text-danger">疑似网络卡顿连接</h3>
              <SimpleRows
                headers={[
                  { key: "process", label: "进程" },
                  { key: "pid", label: "PID" },
                  { key: "local", label: "本地" },
                  { key: "remote", label: "远端" },
                  { key: "recvQ", label: "Recv-Q" },
                  { key: "sendQ", label: "Send-Q" },
                  { key: "rtt", label: "RTT" },
                  { key: "reason", label: "原因" },
                ]}
                rows={slowList.map((conn, index) => ({
                  id: `slow-${index}-${conn.pid}-${conn.localAddr}-${conn.remoteAddr}`,
                  className: "h-12 border-t border-line/70 bg-danger-soft",
                  cells: [
                    conn.process || "—",
                    conn.pid || "—",
                    conn.localAddr || "—",
                    conn.remoteAddr || "—",
                    conn.recvQ ?? 0,
                    conn.sendQ ?? 0,
                    conn.rttMs ? `${conn.rttMs.toFixed(1)}ms` : "—",
                    conn.slowReason || "—",
                  ],
                }))}
              />
            </Card>
          ) : null}

          <Card>
            <div className="mb-3 flex flex-wrap items-center gap-4">
              <h3 className="font-medium">TCP 连接</h3>
              <input
                className="h-8 w-[220px] rounded-control bg-raised px-3 outline-none ring-0 focus:bg-surface focus:ring-1 focus:ring-accent/30"
                placeholder="过滤 进程/地址/状态..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={onlyEstab}
                  onChange={(e) => setOnlyEstab(e.target.checked)}
                />
                只看已建立
              </label>
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={onlySlow}
                  onChange={(e) => setOnlySlow(e.target.checked)}
                />
                只看卡顿
              </label>
              <span className="text-sm text-muted">共 {filteredConns.length} 条</span>
            </div>
            <SimpleRows
              indexOffset={(safePage - 1) * PAGE_SIZE}
              headers={[
                { key: "state", label: "状态" },
                { key: "process", label: "进程" },
                { key: "pid", label: "PID" },
                { key: "local", label: "本地地址" },
                { key: "remote", label: "远端地址" },
                { key: "recvQ", label: "Recv-Q" },
                { key: "sendQ", label: "Send-Q" },
                { key: "rtt", label: "RTT" },
                { key: "mark", label: "标记" },
              ]}
              rows={pageRows.map((conn, index) => {
                const seq = (safePage - 1) * PAGE_SIZE + index + 1;
                return {
                  id: `conn-${seq}-${conn.pid}-${conn.localAddr}-${conn.remoteAddr}`,
                  className: conn.slow
                    ? "h-12 border-t border-line/70 bg-danger-soft"
                    : "h-12 border-t border-line/70 hover:bg-raised",
                  cells: [
                    <ConnState key="state" state={conn.state || ""} />,
                    conn.process || "—",
                    conn.pid || "—",
                    conn.localAddr || "—",
                    conn.remoteAddr || "—",
                    conn.recvQ ?? 0,
                    conn.sendQ ?? 0,
                    conn.rttMs ? `${conn.rttMs.toFixed(1)}ms` : "—",
                    conn.slow ? (
                      <span className="rounded-control bg-danger px-1.5 py-0.5 text-xs text-white">
                        卡顿
                      </span>
                    ) : (
                      ""
                    ),
                  ],
                };
              })}
            />
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted">
                第 {safePage} / {pageCount} 页 · 每页 {PAGE_SIZE} 条
              </span>
              <Button disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                上一页
              </Button>
              <Button
                disabled={safePage >= pageCount}
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              >
                下一页
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </Page>
  );
}
