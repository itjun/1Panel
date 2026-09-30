import { useQuery, useQueryClient } from "@tanstack/react-query";
import type * as echarts from "echarts";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "@/api";
import type { agentapi, agentcli, monitor, sshconfig } from "@/api";
import type { CertPairCheck } from "@/api";
import { RingMeter } from "@/react/components/local/ring-meter";
import {
  binaryAxis,
  ChartHost,
  lineOption,
  MonitorPanel,
  readoutTone,
  RX_TIP,
  TX_TIP,
  type MonitorReadout,
} from "@/react/components/monitor/charts";
import { OverviewFact, OverviewTable } from "@/react/components/overview/overview-parts";
import { Button } from "@/react/components/ui/button";
import { DateRangePicker } from "@/react/components/ui/date-range-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/react/components/ui/dialog";
import { FlashNotices, Notice, Page } from "@/react/components/page";
import { Meter } from "@/react/components/ui/meter";
import { RadioGroup } from "@/react/components/ui/radio-group";
import { Select } from "@/react/components/ui/select";
import { Tag, type TagTone } from "@/react/components/ui/tag";
import { DistroBadge } from "@/react/components/distro-badge";
import { MOTION_MS, usePresence } from "@/react/lib/motion";
import { useFlashMessage } from "@/react/lib/use-flash-message";
import { useThemeMode } from "@/react/lib/use-theme-mode";
import { usageBands } from "@/react/lib/usage-tone";
import { AppsPage } from "@/react/pages/host-apps";
import { DiskPage } from "@/react/pages/host-disk";
import { NetworkPage } from "@/react/pages/host-network";
import { PackagesPage } from "@/react/pages/host-packages";
import { useSession, type Tool } from "@/react/state/session";
import {
  isCpuAlert,
  isDiskLow,
  isLoadAlert,
  isMemAlert,
  mountDisks,
  physicalDisks,
  summarizeDisks,
} from "@/utils/alerts";
import {
  bytesToKBps,
  formatBytes,
  formatDurationLong,
  formatErr,
  formatMemCapacity,
  formatRateKBps,
  isAgentMissing,
} from "@/utils/format";
import { logHighlightHtml } from "@/utils/logHighlight";
import { HighlightPane } from "@/react/components/local/highlight-pane";

export function HostToolPage({ host, tool }: { host: string; tool: Tool }) {
  if (tool === "overview") return <OverviewPage host={host} />;
  if (tool === "monitor") return <MonitorPage host={host} />;
  if (tool === "disk") return <DiskPage host={host} />;
  if (tool === "apps") return <AppsPage host={host} />;
  if (tool === "certs") return <CertsPage host={host} />;
  if (tool === "processes") return <ProcessesPage host={host} />;
  if (tool === "network") return <NetworkPage host={host} />;
  if (tool === "services") return <ServicesPage host={host} />;
  if (tool === "cron") return <CronPage host={host} />;
  if (tool === "logs") return <LogsPage host={host} />;
  if (tool === "packages") return <PackagesPage host={host} />;
  return null;
}

type CtxItem = { label: string; danger?: boolean; onClick: () => void };
type CtxMenu = { x: number; y: number; items: CtxItem[] };

function ContextMenu({ menu, onClose }: { menu: CtxMenu | null; onClose: () => void }) {
  const lastMenuRef = useRef(menu);
  if (menu) lastMenuRef.current = menu;
  const { mounted, visible } = usePresence(!!menu, MOTION_MS.moderate);
  const active = menu ?? lastMenuRef.current;

  useEffect(() => {
    if (!menu) return;
    const close = () => onClose();
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu, onClose]);
  if (!mounted || !active) return null;
  return (
    <div
      className="motion-menu-panel fixed z-50 min-w-[160px] rounded-panel border border-line bg-surface py-1 text-sm"
      data-open={visible ? "true" : "false"}
      style={{ left: active.x, top: active.y }}
      onClick={(e) => e.stopPropagation()}
    >
      {active.items.map((item) => (
        <button
          key={item.label}
          type="button"
          className={
            item.danger
              ? "block w-full px-3 py-2 text-left text-danger hover:bg-danger-soft"
              : "block w-full px-3 py-2 text-left hover:bg-raised"
          }
          onClick={() => {
            item.onClick();
            onClose();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription className="whitespace-pre-wrap">{description}</DialogDescription>
        <DialogFooter>
          <Button onClick={onClose}>取消</Button>
          <Button
            variant={danger ? "danger" : "primary"}
            disabled={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SimpleRows({
  headers,
  rows,
  onRowClick,
  onRowContextMenu,
  selectedId,
  indexOffset = 0,
}: {
  headers: { key: string; label: string }[];
  rows: { id: string; cells: ReactNode[] }[];
  onRowClick?: (id: string, event: React.MouseEvent) => void;
  onRowContextMenu?: (id: string, event: React.MouseEvent) => void;
  selectedId?: string | null;
  /** 分页场景下序号起始偏移（已展示行数），默认 0 表示从 1 起 */
  indexOffset?: number;
}) {
  const colCount = headers.length + 1;
  return (
    <div className="surface-float min-h-48 flex-1 overflow-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="sticky top-0 z-[1] bg-surface text-xs font-normal text-muted">
          <tr className="h-table-head border-b border-line">
            <th className="w-12 px-2 text-center font-normal">序</th>
            {headers.map((header) => (
              <th key={header.key} className="px-3 font-normal">
                {header.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr className="h-table-row">
              <td className="px-3 text-muted" colSpan={colCount}>
                暂无数据
              </td>
            </tr>
          ) : (
            rows.map((row, rowIndex) => (
              <tr
                key={row.id}
                className={
                  row.id === selectedId
                    ? "h-table-row cursor-pointer border-t border-line bg-accent-soft font-semibold text-accent"
                    : "h-table-row cursor-pointer border-t border-line hover:bg-raised"
                }
                onClick={(e) => onRowClick?.(row.id, e)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onRowContextMenu?.(row.id, e);
                }}
              >
                <td className="px-2 text-center font-mono text-xs tabular-nums text-muted">
                  {indexOffset + rowIndex + 1}
                </td>
                {row.cells.map((cell, index) => (
                  <td key={index} className="max-w-[360px] truncate px-3">
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

function DetailPanel({
  title,
  onClose,
  children,
  actions,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent aria-describedby={undefined} className="w-[min(640px,calc(100vw-32px))]">
        <DialogTitle>{title}</DialogTitle>
        <div className="mt-4 space-y-2 text-sm">{children}</div>
        <DialogFooter>
          {actions}
          <Button onClick={onClose}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex gap-4">
      <span className="w-24 shrink-0 text-muted">{label}</span>
      <span className="min-w-0 break-all font-mono text-sm">{value ?? "—"}</span>
    </div>
  );
}

async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function formatUnix(ts: number): string {
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function liveTimeLabel(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function historyTimeLabel(ts: number): string {
  const d = new Date(ts * 1000);
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/* ---------- 概览 ---------- */

const VIRTUAL_IFACE_FOLD = 3;

function OverviewPage({ host }: { host: string }) {
  const session = useSession();
  const [showAllIfaces, setShowAllIfaces] = useState(false);
  const overview = useQuery({
    queryKey: ["overview", host],
    queryFn: () => api.collectOverview(host),
    refetchInterval: 5000,
  });
  const disks = useQuery({
    queryKey: ["disks", host],
    queryFn: () => api.collectDisks(host),
    refetchInterval: 15000,
  });
  const docker = useQuery({
    queryKey: ["docker-overview", host],
    queryFn: () => api.collectDocker(host),
    refetchInterval: 15000,
  });
  const network = useQuery({
    queryKey: ["net-overview", host],
    queryFn: () => api.collectNetwork(host),
    refetchInterval: 20000,
  });
  const agentStatus = useQuery({
    queryKey: ["agent-status", host],
    queryFn: () => api.agentStatus(host),
  });
  const latestVer = useQuery({
    queryKey: ["agent-latest"],
    queryFn: () => api.agentLatestVersion(),
  });
  const hosts = useQuery({
    queryKey: ["hosts-list"],
    queryFn: () => api.listHosts(),
  });
  const [checkReport, setCheckReport] = useState<agentcli.CheckReport | null>(null);
  const [checkBusy, setCheckBusy] = useState(false);
  const [installBusy, setInstallBusy] = useState(false);
  const [installConfirm, setInstallConfirm] = useState(false);
  const flash = useFlashMessage();

  const hostConfig: sshconfig.HostConfig | null =
    (hosts.data || []).find((item) => item.name === host) || null;
  const data = overview.data;
  const diskSummary = summarizeDisks(disks.data);
  const mounts = mountDisks(disks.data);
  const physDisks = physicalDisks(disks.data);
  const agent = agentStatus.data;
  const agentMissing = !!agent && !agent.ok && !!agent.notInstalled;
  const agentUpdatable =
    !!agent?.ok && !!latestVer.data && agent.version !== latestVer.data;

  let sshText = "SSH 检测中";
  let sshTagTone: TagTone = "neutral";
  if (agent) {
    if (agent.ok || agent.notInstalled) {
      sshText = "SSH 已连通";
      sshTagTone = "ok";
    } else {
      sshText = "SSH 连接异常";
      sshTagTone = "danger";
    }
  }

  let agentText = "Agent 检测中";
  let agentTagTone: TagTone = "neutral";
  if (agent) {
    if (agent.ok) {
      agentText = agent.version ? `Agent 在线 ${agent.version}` : "Agent 在线";
      agentTagTone = "ok";
      if (agentUpdatable) {
        agentText = `Agent ${agent.version || "未知版本"}，可更新到 ${latestVer.data}`;
        agentTagTone = "info";
      }
    } else if (agent.notInstalled) {
      agentText = "Agent 未安装";
      agentTagTone = "warn";
    } else {
      agentText = "Agent 不可用";
      agentTagTone = "danger";
    }
  }

  const sshUser = hostConfig?.user || "—";
  const sshAddr = hostConfig?.hostName || data?.ipAddress || "—";
  const sshPort = hostConfig?.port || "22";

  const allIfaces = (network.data?.interfaces || []).filter(
    (iface) => iface.kind !== "loopback",
  );
  const mainIfaces = allIfaces
    .filter((iface) => iface.kind !== "docker" && iface.kind !== "virtual")
    .sort((a, b) => {
      if (a.kind === b.kind) return 0;
      if (a.kind === "physical") return -1;
      if (b.kind === "physical") return 1;
      return 0;
    });
  const virtualIfaces = allIfaces.filter(
    (iface) => iface.kind === "docker" || iface.kind === "virtual",
  );
  let shownIfaces = [...mainIfaces, ...virtualIfaces];
  let hiddenIfaceCount = 0;
  if (virtualIfaces.length > VIRTUAL_IFACE_FOLD && !showAllIfaces) {
    shownIfaces = mainIfaces;
    hiddenIfaceCount = virtualIfaces.length;
  }

  let egressText = "—";
  if (network.data) {
    egressText =
      network.data.egressPublicIP || (network.data.publicIPs || []).join(", ") || "—";
    if (network.data.egressPublicLoc) {
      egressText = `${egressText}（${network.data.egressPublicLoc}）`;
    }
  }

  const loadPercent = data?.cpuCount ? (data.load1 / data.cpuCount) * 100 : 0;
  const loadWord =
    loadPercent < 30
      ? "运行流畅"
      : loadPercent < 70
        ? "运行正常"
        : loadPercent < 80
          ? "运行缓慢"
          : "运行堵塞";

  const runningDocker = (docker.data?.containers || []).filter(
    (c) => (c.state || "").toLowerCase() === "running",
  ).length;

  async function runCheck() {
    setCheckBusy(true);
    flash.clear();
    try {
      setCheckReport(await api.checkAgent(host));
    } catch (e) {
      flash.showError(formatErr(e));
    } finally {
      setCheckBusy(false);
    }
  }

  async function runInstall() {
    setInstallBusy(true);
    flash.clear();
    try {
      await api.installAgent(host);
      setInstallConfirm(false);
      await agentStatus.refetch();
      flash.showToast("Agent 安装/更新已完成");
    } catch (e) {
      flash.showError(formatErr(e));
    } finally {
      setInstallBusy(false);
    }
  }

  async function refreshAll() {
    await Promise.all([
      overview.refetch(),
      disks.refetch(),
      docker.refetch(),
      network.refetch(),
      agentStatus.refetch(),
    ]);
  }

  const agentErr =
    overview.error && isAgentMissing(overview.error)
      ? "未安装 Agent，无法采集状态"
      : overview.error
        ? formatErr(overview.error)
        : "";

  let dockerText = "—";
  if (docker.data) {
    if (docker.data.available) {
      dockerText = `运行 ${runningDocker} / 共 ${docker.data.containers?.length ?? 0}`;
    } else {
      dockerText = "未安装";
    }
  }

  let swapText = "未启用";
  if (data && data.swapTotal > 0) {
    swapText = `${formatBytes(data.swapUsed)} / ${formatBytes(data.swapTotal)}`;
  }

  let diskScopeText = "";
  if (diskSummary) {
    if (diskSummary.scope === "disk") {
      diskScopeText = `${diskSummary.count} 块物理盘`;
    } else {
      diskScopeText = `${diskSummary.count} 个分区`;
    }
  }

  const ifaceKindLabel: Record<string, string> = {
    physical: "物理",
    docker: "Docker",
    virtual: "虚拟",
    other: "其他",
  };

  return (
    <Page
      title="概览"
      onRefresh={() => void refreshAll()}
      actions={
        <>
          <span className="font-mono text-sm tabular-nums text-ink">
            {sshUser}@{sshAddr}:{sshPort}
          </span>
          <Tag tone={sshTagTone}>{sshText}</Tag>
          <Tag tone={agentTagTone}>{agentText}</Tag>
          <Button size="sm" disabled={checkBusy} onClick={() => void runCheck()}>
            {checkBusy ? "检查中…" : "检查 Agent"}
          </Button>
          {agentMissing || agentUpdatable ? (
            <Button
              size="sm"
              variant="primary"
              disabled={installBusy}
              onClick={() => setInstallConfirm(true)}
            >
              {agentMissing ? "安装 Agent" : `更新到 ${latestVer.data}`}
            </Button>
          ) : null}
        </>
      }
    >
      {agentErr ? <Notice text={agentErr} /> : null}
      <FlashNotices flash={flash} />

      <div className="flex flex-col gap-section">
        {data ? (
          <section>
            <div className="mb-3 text-sm font-semibold text-ink">系统</div>
            <div className="flex min-w-0 items-center gap-3">
              <DistroBadge boxSize={40} osRelease={data.osRelease} />
              <div className="min-w-0">
                <div className="truncate text-base font-semibold text-ink">
                  {data.hostname || host}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                  <span>{data.osRelease || "未知系统"}</span>
                  <span>
                    内核 <span className="font-mono">{data.kernel || "—"}</span>
                  </span>
                  {data.arch ? <span className="font-mono">{data.arch}</span> : null}
                  <span>已运行 {formatDurationLong(data.uptime)}</span>
                </div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
              <OverviewFact label="CPU 型号" className="col-span-2">
                {data.cpuModel || "—"}
              </OverviewFact>
              <OverviewFact label="CPU 核心" mono>{`${data.cpuCount} 核`}</OverviewFact>
              <OverviewFact label="内存" mono>{formatMemCapacity(data.memTotal)}</OverviewFact>
              <OverviewFact label="Swap" mono>{swapText}</OverviewFact>
              <OverviewFact label="Docker 容器" mono>{dockerText}</OverviewFact>
            </div>
          </section>
        ) : null}

        {data ? (
          <section>
            <div className="mb-3 text-sm font-semibold text-ink">资源</div>
            <div className="grid grid-cols-2 gap-card md:grid-cols-4">
              <RingMeter
                title="负载"
                percent={Math.min(100, loadPercent)}
                danger={isLoadAlert(data)}
                center={data.load1.toFixed(2)}
                caption={
                  <>
                    <div className="font-mono tabular-nums">
                      {data.load1.toFixed(2)} / {data.cpuCount} 核
                    </div>
                    <div>{loadWord}</div>
                  </>
                }
              >
                <div className="local-pop-row">
                  <span>1 分钟</span>
                  <span className="num">{data.load1.toFixed(2)}</span>
                </div>
                <div className="local-pop-row">
                  <span>5 分钟</span>
                  <span className="num">{(data.load5 || 0).toFixed(2)}</span>
                </div>
                <div className="local-pop-row">
                  <span>15 分钟</span>
                  <span className="num">{(data.load15 || 0).toFixed(2)}</span>
                </div>
              </RingMeter>

              <RingMeter
                title="CPU"
                percent={data.cpuPercent || 0}
                danger={isCpuAlert(data)}
                center={`${(data.cpuPercent || 0).toFixed(1)}%`}
                caption={
                  <>
                    <div className="font-mono tabular-nums">
                      {(data.cpuPercent || 0).toFixed(1)}% / {data.cpuCount} 核
                    </div>
                    <div className="max-w-[200px] truncate">{data.cpuModel || "—"}</div>
                  </>
                }
              >
                <div className="local-pop-row">
                  <span>型号</span>
                  <span className="max-w-[200px] truncate">{data.cpuModel || "—"}</span>
                </div>
                <div className="local-pop-row">
                  <span>核心数</span>
                  <span className="num">{data.cpuCount} 核</span>
                </div>
                <div className="local-pop-row">
                  <span>使用率</span>
                  <span className="num">{(data.cpuPercent || 0).toFixed(2)}%</span>
                </div>
              </RingMeter>

              <RingMeter
                title="内存"
                percent={data.memPercent || 0}
                danger={isMemAlert(data)}
                center={`${(data.memPercent || 0).toFixed(1)}%`}
                caption={
                  <>
                    <div className="font-mono tabular-nums">
                      {formatBytes(data.memUsed)} / {formatMemCapacity(data.memTotal)}
                    </div>
                    <div>Swap {swapText}</div>
                  </>
                }
              >
                <div className="local-pop-row">
                  <span>总量</span>
                  <span className="num">{formatMemCapacity(data.memTotal)}</span>
                </div>
                <div className="local-pop-row">
                  <span>已用</span>
                  <span className="num">{formatBytes(data.memUsed)}</span>
                </div>
                <div className="local-pop-row">
                  <span>可用</span>
                  <span className="num">
                    {formatBytes(Math.max(0, (data.memTotal || 0) - (data.memUsed || 0)))}
                  </span>
                </div>
                <div className="local-pop-row">
                  <span>使用率</span>
                  <span className="num">{(data.memPercent || 0).toFixed(2)}%</span>
                </div>
                <div className="local-pop-row">
                  <span>Swap</span>
                  <span className="num">
                    {data.swapTotal > 0
                      ? `${swapText} · ${(data.swapPercent || 0).toFixed(1)}%`
                      : "未启用"}
                  </span>
                </div>
              </RingMeter>

              <RingMeter
                title="磁盘"
                percent={diskSummary?.percent || 0}
                danger={isDiskLow(disks.data)}
                center={diskSummary ? `${diskSummary.percent.toFixed(1)}%` : "—"}
                caption={
                  diskSummary ? (
                    <>
                      <div className="font-mono tabular-nums">
                        {formatBytes(diskSummary.used)} / {formatBytes(diskSummary.total)}
                      </div>
                      <div>{diskScopeText}</div>
                    </>
                  ) : (
                    "暂无磁盘数据"
                  )
                }
              >
                <div className="local-pop-row">
                  <span>范围</span>
                  <span className="num">{diskScopeText || "—"}</span>
                </div>
                <div className="local-pop-row">
                  <span>总量</span>
                  <span className="num">{formatBytes(diskSummary?.total || 0)}</span>
                </div>
                <div className="local-pop-row">
                  <span>已用</span>
                  <span className="num">{formatBytes(diskSummary?.used || 0)}</span>
                </div>
                <div className="local-pop-row">
                  <span>可用</span>
                  <span className="num">{formatBytes(diskSummary?.avail || 0)}</span>
                </div>
              </RingMeter>
            </div>
          </section>
        ) : null}

        <section>
          <div className="mb-3 flex items-center gap-2">
            <span className="text-sm font-semibold text-ink">磁盘</span>
            <Button size="sm" variant="ghost" onClick={() => session.setTool("disk")}>
              分析大文件
            </Button>
          </div>
          {isDiskLow(disks.data) ? (
            <div className="mb-3">
              <Notice text="存在分区可用空间偏低（≤ 10 GB）" tone="warning" />
            </div>
          ) : null}
          {!physDisks.length && !mounts.length ? (
            <p className="text-sm text-muted">
              {disks.isLoading ? "加载中…" : "暂无磁盘数据"}
            </p>
          ) : null}
          {physDisks.length ? (
            <div className="mb-4">
              <div className="mb-1 text-xs text-muted">物理磁盘</div>
              <div className="flex flex-col">
                {physDisks.map((d) => (
                  <div
                    key={d.filesystem || d.mount}
                    className="grid h-table-row grid-cols-[minmax(96px,160px)_96px_200px_minmax(0,1fr)] items-center gap-4 border-b border-line px-3 text-sm"
                  >
                    <span className="truncate font-mono" data-tip={d.filesystem}>
                      {d.mount || d.filesystem}
                    </span>
                    <span className="text-right font-mono tabular-nums">
                      {formatBytes(d.total)}
                    </span>
                    <Meter value={d.percent || 0} className="w-full" />
                    <span className="truncate font-mono text-xs tabular-nums text-muted">
                      已用 {formatBytes(d.used)}，可用 {formatBytes(d.avail)}
                    </span>
                  </div>
                ))}
              </div>
              {physDisks.length > 1 && physDisks[0]!.fsType === "disk" ? (
                <p className="mt-2 text-xs text-muted">多块盘时已用量按容量比例估算</p>
              ) : null}
            </div>
          ) : null}
          {mounts.length ? (
            <div>
              <div className="mb-1 text-xs text-muted">分区</div>
              <OverviewTable
                columns={[
                  { key: "mount", label: "挂载点" },
                  { key: "fs", label: "文件系统" },
                  { key: "type", label: "类型" },
                  { key: "used", label: "已用 / 总量", align: "right" },
                  { key: "pct", label: "使用率" },
                ]}
                rows={mounts.map((d) => ({
                  id: `${d.mount}-${d.filesystem}`,
                  cells: [
                    <span key="mount" className="font-mono">{d.mount || "—"}</span>,
                    <span key="fs" className="font-mono">{d.filesystem || "—"}</span>,
                    d.fsType || "—",
                    `${formatBytes(d.used)} / ${formatBytes(d.total)}`,
                    <Meter key="pct" value={d.percent || 0} className="w-full whitespace-nowrap" />,
                  ],
                }))}
              />
            </div>
          ) : null}
        </section>

        <section>
          <div className="mb-3 text-sm font-semibold text-ink">网络</div>
          {network.data ? (
            <>
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <OverviewFact label="内网 IP" mono>
                  {(network.data.privateIPs || []).join(", ") || "—"}
                </OverviewFact>
                <OverviewFact label="出口公网">{egressText}</OverviewFact>
                <OverviewFact label="默认网关" mono>
                  {network.data.defaultGateway || "—"}
                </OverviewFact>
                <OverviewFact label="Docker 网桥" mono>
                  {(network.data.dockerIPs || []).join(", ") || "—"}
                </OverviewFact>
              </div>
              {shownIfaces.length ? (
                <div className="mt-4">
                  <div className="mb-1 text-xs text-muted">网卡</div>
                  <OverviewTable
                    columns={[
                      { key: "name", label: "名称" },
                      { key: "kind", label: "类型" },
                      { key: "state", label: "状态" },
                      { key: "ipv4", label: "IPv4" },
                      { key: "mac", label: "MAC" },
                      { key: "rx", label: "接收", align: "right" },
                      { key: "tx", label: "发送", align: "right" },
                    ]}
                    rows={shownIfaces.map((iface) => ({
                      id: iface.name,
                      cells: [
                        <span key="name" className="font-mono">{iface.name}</span>,
                        ifaceKindLabel[iface.kind] || iface.kind || "—",
                        <Tag
                          key="state"
                          tone={(iface.state || "").toUpperCase() === "UP" ? "ok" : "neutral"}
                        >
                          {iface.state || "—"}
                        </Tag>,
                        <span key="ipv4" className="font-mono">
                          {(iface.ipv4 || []).join(", ") || "—"}
                        </span>,
                        <span key="mac" className="font-mono">{iface.mac || "—"}</span>,
                        formatBytes(iface.rxBytes),
                        formatBytes(iface.txBytes),
                      ],
                    }))}
                  />
                </div>
              ) : null}
              {virtualIfaces.length > VIRTUAL_IFACE_FOLD ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-2"
                  onClick={() => setShowAllIfaces((prev) => !prev)}
                >
                  {hiddenIfaceCount > 0
                    ? `显示另外 ${hiddenIfaceCount} 个虚拟网卡`
                    : "收起虚拟网卡"}
                </Button>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted">
              {network.isLoading ? "加载中…" : "暂无网络数据"}
            </p>
          )}
        </section>
      </div>

      {checkReport ? (
        <DetailPanel title="Agent 检查" onClose={() => setCheckReport(null)}>
          <p className="text-muted">{checkReport.summary}</p>
          <ul className="space-y-1">
            {(checkReport.items || []).map((item) => (
              <li key={item.key} className={item.ok ? "text-ink" : "text-danger"}>
                {item.ok ? "✓" : "✗"} {item.name}
                {item.detail ? `：${item.detail}` : ""}
              </li>
            ))}
          </ul>
        </DetailPanel>
      ) : null}
      {!data && overview.isLoading ? (
        <p className="text-sm text-muted">加载中…</p>
      ) : null}

      <ConfirmDialog
        open={installConfirm}
        title={agentMissing ? "安装 Agent" : "更新 Agent"}
        description={`将向 ${host} ${agentMissing ? "部署" : "更新"} spanel-agent（systemd 服务）。已落库的监控历史保留。`}
        confirmLabel={agentMissing ? "安装" : "更新"}
        busy={installBusy}
        onClose={() => setInstallConfirm(false)}
        onConfirm={() => void runInstall()}
      />
    </Page>
  );
}

/* ---------- 监控 ---------- */

type RangeMode = "live" | "30m" | "1h" | "6h" | "12h" | "24h" | "7d" | "custom";
type GrainMode = "auto" | "5s" | "10s" | "15s" | "1m" | "5m" | "10m";

const CPU_BANDS = usageBands(100);

const RANGE_SPAN: Record<string, number> = {
  "30m": 30 * 60,
  "1h": 3600,
  "6h": 6 * 3600,
  "12h": 12 * 3600,
  "24h": 24 * 3600,
  "7d": 7 * 86400,
};

/** 与 spanel-agent -interval 默认值一致 */
const AGENT_DEFAULT_INTERVAL_SEC = 5;
const GRAIN_SEC: Record<Exclude<GrainMode, "auto">, number> = {
  "5s": 5,
  "10s": 10,
  "15s": 15,
  "1m": 60,
  "5m": 300,
  "10m": 600,
};
const MAX_CHART_POINTS = 2500;

type SeriesPt = { time: string; value: number };
type DualPt = { time: string; a: number; b: number };

function formatGrainSec(sec: number): string {
  if (sec < 60) return `${sec} 秒`;
  if (sec < 3600) return `${Math.round(sec / 60)} 分`;
  return `${Math.round(sec / 3600)} 时`;
}

function resolveGrainQuery(grain: GrainMode): {
  src: "auto" | "raw" | "agg";
  everySec: number | null;
} {
  if (grain === "auto") return { src: "auto", everySec: null };
  const everySec = GRAIN_SEC[grain];
  if (everySec < 300) return { src: "raw", everySec };
  return { src: "agg", everySec };
}

/** 按目标间隔把点归桶：每桶保留最后一点 */
function downsampleBySec(
  pts: agentapi.RangePoint[],
  everySec: number,
): agentapi.RangePoint[] {
  if (!pts.length || everySec <= 1) return pts;
  const out: agentapi.RangePoint[] = [];
  let bucket = Number.NaN;
  let last: agentapi.RangePoint | null = null;
  for (const p of pts) {
    const b = Math.floor(p.ts / everySec) * everySec;
    if (b !== bucket) {
      if (last) out.push(last);
      bucket = b;
    }
    last = { ...p, ts: b };
  }
  if (last) out.push(last);
  return out;
}

function MonitorPage({ host }: { host: string }) {
  const [range, setRange] = useState<RangeMode>("live");
  const [grain, setGrain] = useState<GrainMode>("auto");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [history, setHistory] = useState<agentapi.RangePoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [grainHint, setGrainHint] = useState("");

  const [cpuSeries, setCpuSeries] = useState<SeriesPt[]>([]);
  const [memSeries, setMemSeries] = useState<SeriesPt[]>([]);
  const [loadSeries, setLoadSeries] = useState<SeriesPt[]>([]);
  const [traffic, setTraffic] = useState<DualPt[]>([]);
  const [ioTraffic, setIoTraffic] = useState<DualPt[]>([]);
  const lastNet = useRef<{ rx: number; tx: number; ts: number } | null>(null);
  const lastDisk = useRef<{ read: number; write: number; ts: number } | null>(null);
  const lastLiveAt = useRef(0);
  const grainRef = useRef(grain);
  grainRef.current = grain;

  const connectGroup = `monitor-${host}`;

  const overview = useQuery({
    queryKey: ["monitor-ov", host],
    queryFn: () => api.collectOverview(host),
    refetchInterval: range === "live" ? 2000 : false,
  });

  function liveGrainSec(): number {
    if (grainRef.current === "auto") return AGENT_DEFAULT_INTERVAL_SEC;
    return GRAIN_SEC[grainRef.current];
  }

  function updateLiveGrainHint() {
    const sec = liveGrainSec();
    if (grainRef.current === "auto") {
      setGrainHint(`实际：${formatGrainSec(sec)}（agent 默认）`);
    } else {
      setGrainHint(`实际：${formatGrainSec(sec)}`);
    }
  }

  const pushLive = useCallback((data: monitor.Overview) => {
    const now = Date.now();
    const need = liveGrainSec() * 1000;
    const append = !(lastLiveAt.current > 0 && now - lastLiveAt.current < need);
    // 流量/IO 标签始终更新基准；曲线点按粒度节流
    const netPrev = lastNet.current;
    const diskPrev = lastDisk.current;
    if (append) {
      lastLiveAt.current = now;
      const time = liveTimeLabel(now);
      setCpuSeries((prev) => [...prev, { time, value: data.cpuPercent || 0 }].slice(-100));
      setMemSeries((prev) => [...prev, { time, value: data.memUsed || 0 }].slice(-100));
      setLoadSeries((prev) => [...prev, { time, value: data.load1 || 0 }].slice(-100));

      if (netPrev) {
        const dt = now - netPrev.ts;
        setTraffic((prev) =>
          [
            ...prev,
            {
              time,
              a: bytesToKBps(data.netTxBytes - netPrev.tx, dt),
              b: bytesToKBps(data.netRxBytes - netPrev.rx, dt),
            },
          ].slice(-100),
        );
      }
      if (diskPrev) {
        const dt = now - diskPrev.ts;
        setIoTraffic((prev) =>
          [
            ...prev,
            {
              time,
              a: bytesToKBps(data.diskReadBytes - diskPrev.read, dt),
              b: bytesToKBps(data.diskWriteBytes - diskPrev.write, dt),
            },
          ].slice(-100),
        );
      }
    }
    lastNet.current = { rx: data.netRxBytes, tx: data.netTxBytes, ts: now };
    lastDisk.current = {
      read: data.diskReadBytes,
      write: data.diskWriteBytes,
      ts: now,
    };
  }, []);

  useEffect(() => {
    if (range !== "live" || !overview.data) return;
    pushLive(overview.data);
  }, [overview.data, range, pushLive]);

  async function seedLive() {
    try {
      const to = Math.floor(Date.now() / 1000);
      const r = await api.agentRange(host, to - 15 * 60, to, "auto");
      const pts = r.points || [];
      setCpuSeries(pts.map((p) => ({ time: historyTimeLabel(p.ts), value: p.cpuPercent })));
      setMemSeries(pts.map((p) => ({ time: historyTimeLabel(p.ts), value: p.memUsed })));
      setLoadSeries(pts.map((p) => ({ time: historyTimeLabel(p.ts), value: p.load1 })));
      setTraffic(
        pts.map((p) => ({
          time: historyTimeLabel(p.ts),
          a: p.netTxKBps,
          b: p.netRxKBps,
        })),
      );
      setIoTraffic(
        pts.map((p) => ({
          time: historyTimeLabel(p.ts),
          a: p.diskReadKBps,
          b: p.diskWriteKBps,
        })),
      );
      updateLiveGrainHint();
    } catch {
      setGrainHint("");
    }
  }

  async function loadHistory(from: number, to: number) {
    setHistoryLoading(true);
    const span = to - from;
    const { src, everySec } = resolveGrainQuery(grainRef.current);
    try {
      const r = await api.agentRange(host, from, to, src);
      let pts = r.points || [];
      let effective = everySec;
      if (effective != null) {
        pts = downsampleBySec(pts, effective);
      }
      if (pts.length > MAX_CHART_POINTS) {
        const forced = Math.max(effective || 1, Math.ceil(span / MAX_CHART_POINTS));
        pts = downsampleBySec(r.points || [], forced);
        effective = forced;
      }
      setHistory(pts);
      const srcLabel = r.src === "raw" ? "细采样" : r.src === "agg" ? "5 分钟聚合" : r.src;
      if (grainRef.current === "auto") {
        setGrainHint(`实际：${srcLabel}`);
      } else if (effective != null && everySec != null && effective > everySec) {
        setGrainHint(`已抽稀至 ${formatGrainSec(effective)}（${srcLabel}）`);
      } else if (effective != null) {
        setGrainHint(`实际：${formatGrainSec(effective)} · ${srcLabel}`);
      } else {
        setGrainHint(`实际：${srcLabel}`);
      }
    } catch {
      setHistory([]);
      setGrainHint("");
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    if (range === "live") {
      lastLiveAt.current = 0;
      void seedLive();
      return;
    }
    if (range === "custom") {
      if (!customFrom || !customTo) return;
      const from = Math.floor(new Date(customFrom).getTime() / 1000);
      const to = Math.floor(new Date(customTo).getTime() / 1000);
      if (!(from < to)) return;
      void loadHistory(from, to);
      return;
    }
    const span = RANGE_SPAN[range];
    if (!span) return;
    const to = Math.floor(Date.now() / 1000);
    void loadHistory(to - span, to);
    // 故意不把 seed/load 放进 deps：只跟范围、粒度与自定义时间走
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, range, grain, customFrom, customTo]);

  function refreshMonitor() {
    if (range === "live") {
      setCpuSeries([]);
      setMemSeries([]);
      setLoadSeries([]);
      setTraffic([]);
      setIoTraffic([]);
      lastNet.current = null;
      lastDisk.current = null;
      lastLiveAt.current = 0;
      void seedLive();
      void overview.refetch();
      return;
    }
    if (range === "custom") {
      if (customFrom && customTo) {
        const from = Math.floor(new Date(customFrom).getTime() / 1000);
        const to = Math.floor(new Date(customTo).getTime() / 1000);
        void loadHistory(from, to);
      }
      return;
    }
    const span = RANGE_SPAN[range];
    const to = Math.floor(Date.now() / 1000);
    void loadHistory(to - span, to);
  }

  const isLive = range === "live";
  const historyEmpty = !isLive && !historyLoading && !history.length;
  const data = overview.data;

  const loadPct = data?.cpuCount ? (data.load1 / data.cpuCount) * 100 : 0;
  const loadWord =
    loadPct < 30 ? "运行流畅" : loadPct < 70 ? "运行正常" : loadPct < 80 ? "运行缓慢" : "运行堵塞";

  const themeMode = useThemeMode();
  const memAxis = useMemo(() => {
    if (isLive) return binaryAxis(memSeries.map((p) => p.value), 0);
    return binaryAxis(history.map((p) => p.memUsed), 0);
  }, [isLive, memSeries, history]);
  const netAxis = useMemo(() => {
    if (isLive) return binaryAxis(traffic.flatMap((p) => [p.a, p.b]), -1);
    return binaryAxis(history.flatMap((p) => [p.netRxKBps, p.netTxKBps]), -1);
  }, [isLive, traffic, history]);
  const ioAxis = useMemo(() => {
    if (isLive) return binaryAxis(ioTraffic.flatMap((p) => [p.a, p.b]), -1);
    return binaryAxis(history.flatMap((p) => [p.diskReadKBps, p.diskWriteKBps]), -1);
  }, [isLive, ioTraffic, history]);

  const loadBands = useMemo(() => usageBands(data?.cpuCount), [data?.cpuCount]);
  const memBands = useMemo(() => usageBands(data?.memTotal), [data?.memTotal]);

  const cpuOpt = useMemo(
    () =>
      lineOption(
        isLive ? cpuSeries.map((p) => p.time) : history.map((p) => historyTimeLabel(p.ts)),
        [
          {
            name: "CPU 使用率",
            data: isLive ? cpuSeries.map((p) => p.value) : history.map((p) => p.cpuPercent),
            bands: CPU_BANDS,
          },
        ],
        { yMax: 100, yFormatter: (v) => `${v.toFixed(2)}%` },
      ),
    [isLive, cpuSeries, history, themeMode],
  );
  const loadOpt = useMemo(
    () =>
      lineOption(
        isLive ? loadSeries.map((p) => p.time) : history.map((p) => historyTimeLabel(p.ts)),
        [
          {
            name: "1 分钟负载",
            data: isLive ? loadSeries.map((p) => p.value) : history.map((p) => p.load1),
            bands: loadBands,
          },
        ],
        { yFormatter: (v) => v.toFixed(2) },
      ),
    [isLive, loadSeries, history, loadBands, themeMode],
  );
  const memOpt = useMemo(
    () =>
      lineOption(
        isLive ? memSeries.map((p) => p.time) : history.map((p) => historyTimeLabel(p.ts)),
        [
          {
            name: "已用内存",
            data: isLive ? memSeries.map((p) => p.value) : history.map((p) => p.memUsed),
            bands: memBands,
          },
        ],
        {
          yFormatter: (v) => formatBytes(v, 2),
          yMax: memAxis?.max,
          yInterval: memAxis?.interval,
        },
      ),
    [isLive, memSeries, history, memBands, themeMode, memAxis],
  );
  const netOpt = useMemo(
    () =>
      lineOption(
        isLive ? traffic.map((p) => p.time) : history.map((p) => historyTimeLabel(p.ts)),
        [
          {
            name: "流入",
            data: isLive ? traffic.map((p) => p.b) : history.map((p) => p.netRxKBps),
          },
          {
            name: "流出",
            data: isLive ? traffic.map((p) => p.a) : history.map((p) => p.netTxKBps),
          },
        ],
        {
          yFormatter: (v) => formatRateKBps(v),
          axisFormatter: (v) => formatRateKBps(v).replace(".00 ", " "),
          yMax: netAxis?.max,
          yInterval: netAxis?.interval,
        },
      ),
    [isLive, traffic, history, themeMode, netAxis],
  );
  const ioOpt = useMemo(
    () =>
      lineOption(
        isLive ? ioTraffic.map((p) => p.time) : history.map((p) => historyTimeLabel(p.ts)),
        [
          {
            name: "读",
            data: isLive ? ioTraffic.map((p) => p.a) : history.map((p) => p.diskReadKBps),
          },
          {
            name: "写",
            data: isLive ? ioTraffic.map((p) => p.b) : history.map((p) => p.diskWriteKBps),
          },
        ],
        {
          yFormatter: (v) => formatRateKBps(v),
          axisFormatter: (v) => formatRateKBps(v).replace(".00 ", " "),
          yMax: ioAxis?.max,
          yInterval: ioAxis?.interval,
        },
      ),
    [isLive, ioTraffic, history, themeMode, ioAxis],
  );

  const chartBody = (opt: echarts.EChartsOption) =>
    historyEmpty ? (
      <div className="flex h-full items-center justify-center text-sm text-muted">该区间暂无数据</div>
    ) : (
      <ChartHost option={opt} connectGroup={connectGroup} />
    );

  // 实时看最新一点，历史区间看峰值
  function pick(values: number[]): number | undefined {
    if (!values.length) return undefined;
    if (isLive) return values[values.length - 1]!;
    return Math.max(...values);
  }
  function readout(values: number[], format: (v: number) => string): string {
    const v = pick(values);
    if (v === undefined) return "—";
    return format(v);
  }
  let peakWord = "";
  if (!isLive) peakWord = "峰值";

  const cpuValues = isLive ? cpuSeries.map((p) => p.value) : history.map((p) => p.cpuPercent);
  const loadValues = isLive ? loadSeries.map((p) => p.value) : history.map((p) => p.load1);
  const memValues = isLive ? memSeries.map((p) => p.value) : history.map((p) => p.memUsed);
  const rxValues = isLive ? traffic.map((p) => p.b) : history.map((p) => p.netRxKBps);
  const txValues = isLive ? traffic.map((p) => p.a) : history.map((p) => p.netTxKBps);
  const readValues = isLive ? ioTraffic.map((p) => p.a) : history.map((p) => p.diskReadKBps);
  const writeValues = isLive ? ioTraffic.map((p) => p.b) : history.map((p) => p.diskWriteKBps);

  const cpuTone = readoutTone(pick(cpuValues), CPU_BANDS);
  const memTone = readoutTone(pick(memValues), memBands);

  let loadReadouts: MonitorReadout[] = [
    {
      label: `1 分钟${peakWord}`,
      value: readout(loadValues, (v) => v.toFixed(2)),
      tone: readoutTone(pick(loadValues), loadBands),
    },
  ];
  if (isLive && data) {
    loadReadouts = [
      { label: "1 分钟", value: data.load1.toFixed(2), tone: readoutTone(data.load1, loadBands) },
      { label: "5 分钟", value: data.load5.toFixed(2), tone: readoutTone(data.load5, loadBands) },
      { label: "15 分钟", value: data.load15.toFixed(2), tone: readoutTone(data.load15, loadBands) },
    ];
  }

  return (
    <Page
      title="监控"
      actions={
        <>
          <RadioGroup<RangeMode>
            aria-label="时间范围"
            value={range}
            onChange={(key) => {
              if (key === "custom" && !customFrom) {
                const to = new Date();
                const from = new Date(to.getTime() - 24 * 3600 * 1000);
                const fmt = (d: Date) => {
                  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
                  return local.toISOString().slice(0, 16);
                };
                setCustomFrom(fmt(from));
                setCustomTo(fmt(to));
              }
              setRange(key);
            }}
            options={[
              { value: "live", label: "实时" },
              { value: "30m", label: "30 分" },
              { value: "1h", label: "1 时" },
              { value: "6h", label: "6 时" },
              { value: "12h", label: "12 时" },
              { value: "24h", label: "24 时" },
              { value: "7d", label: "7 天" },
              { value: "custom", label: "自定义" },
            ]}
          />
          {range === "custom" ? (
            <DateRangePicker
              value={[customFrom, customTo]}
              onChange={([from, to]) => {
                setCustomFrom(from);
                setCustomTo(to);
              }}
            />
          ) : null}
          <label className="ml-2 inline-flex items-center gap-2 text-sm text-muted">
            粒度
            <Select<GrainMode>
              aria-label="粒度"
              value={grain}
              onChange={setGrain}
              options={[
                { value: "auto", label: "自动" },
                { value: "5s", label: "5秒" },
                { value: "10s", label: "10秒" },
                { value: "15s", label: "15秒" },
                { value: "1m", label: "1分" },
                { value: "5m", label: "5分" },
                { value: "10m", label: "10分" },
              ]}
            />
          </label>
          {grainHint ? <span className="text-xs text-muted">{grainHint}</span> : null}
        </>
      }
      onRefresh={refreshMonitor}
    >
      {overview.error ? <Notice text={formatErr(overview.error)} /> : null}

      {/* 固定布局：单元之间 1px 细线分隔（容器 line 底 + 1px 间隙），无外框、无悬停边框；
          宽屏时最后一行（磁盘 IO）吃掉剩余高度，窄屏单列按内容高度堆叠 */}
      <div className="grid grid-cols-1 gap-px bg-line lg:flex-1 lg:grid-cols-2 lg:grid-rows-[auto_auto_1fr]">
        <MonitorPanel
          title="CPU"
          note={data ? `${data.cpuCount} 核` : undefined}
          readouts={[
            {
              label: isLive ? "当前" : "峰值",
              value: readout(cpuValues, (v) => `${v.toFixed(1)}%`),
              tone: cpuTone,
            },
          ]}
        >
          {chartBody(cpuOpt)}
        </MonitorPanel>
        <MonitorPanel
          title="负载"
          note={isLive && data ? loadWord : undefined}
          readouts={loadReadouts}
        >
          {chartBody(loadOpt)}
        </MonitorPanel>
        <MonitorPanel
          title="内存"
          note={data ? `总量 ${formatMemCapacity(data.memTotal)}` : undefined}
          readouts={[
            {
              label: isLive ? "已用" : "已用峰值",
              value: readout(memValues, (v) => formatBytes(v)),
              tone: memTone,
            },
          ]}
        >
          {chartBody(memOpt)}
        </MonitorPanel>
        <MonitorPanel
          title="流量"
          readouts={[
            {
              label: `流入${peakWord}`,
              swatch: "read",
              tip: RX_TIP,
              value: readout(rxValues, (v) => formatRateKBps(v)),
            },
            {
              label: `流出${peakWord}`,
              swatch: "write",
              tip: TX_TIP,
              value: readout(txValues, (v) => formatRateKBps(v)),
            },
          ]}
        >
          {chartBody(netOpt)}
        </MonitorPanel>
        <MonitorPanel
          title="磁盘 IO"
          className="lg:col-span-2"
          grow
          readouts={[
            {
              label: `读${peakWord}`,
              swatch: "read",
              value: readout(readValues, (v) => formatRateKBps(v)),
            },
            {
              label: `写${peakWord}`,
              swatch: "write",
              value: readout(writeValues, (v) => formatRateKBps(v)),
            },
          ]}
        >
          {chartBody(ioOpt)}
        </MonitorPanel>
      </div>
    </Page>
  );
}

/* ---------- 进程 + Docker ---------- */

type ProcView = "all" | "java" | "bun" | "go" | "node" | "python" | "docker";

function ProcessesPage({ host }: { host: string }) {
  const qc = useQueryClient();
  const [view, setView] = useState<ProcView>("all");
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<"cpu" | "rss" | "">("cpu");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selectedPid, setSelectedPid] = useState<number | null>(null);
  const [detail, setDetail] = useState<monitor.JavaProcDetail | null>(null);
  const [menu, setMenu] = useState<CtxMenu | null>(null);
  const [killTarget, setKillTarget] = useState<{ pid: number; cmd: string; force: boolean } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const flash = useFlashMessage();

  const procs = useQuery({
    queryKey: ["procs", host],
    queryFn: () => api.collectProcesses(host, 200),
    enabled: view === "all",
    refetchInterval: 5000,
  });
  const runtime = useQuery({
    queryKey: ["runtime", host, view],
    queryFn: () => api.collectRuntimeProcs(host, view),
    enabled: view !== "all" && view !== "docker",
    refetchInterval: 5000,
  });
  const docker = useQuery({
    queryKey: ["docker", host],
    queryFn: () => api.collectDocker(host),
    enabled: view === "docker",
    refetchInterval: 5000,
  });
  const counts = useQuery({
    queryKey: ["runtime-counts", host],
    queryFn: () => api.collectRuntimeCounts(host),
    refetchInterval: 10000,
  });

  const keyword = filter.trim().toLowerCase();

  const procRows = useMemo(() => {
    if (view === "docker") return [];
    const list =
      view === "all"
        ? (procs.data || []).map((p) => ({
            pid: p.pid,
            user: p.user,
            cpu: p.cpu,
            mem: p.mem,
            rss: p.rss,
            elapsed: p.elapsed,
            args: p.cmd,
            entry: "",
            xms: 0,
            xmx: 0,
            ports: [] as string[] | null,
            deploy: "",
            service: "",
            container: "",
            image: "",
          }))
        : runtime.data || [];
    let filtered = list.filter((p) =>
      `${p.args} ${p.user} ${p.entry || ""}`.toLowerCase().includes(keyword),
    );
    if (sortKey) {
      const dir = sortDir === "asc" ? 1 : -1;
      filtered = [...filtered].sort((a, b) => dir * ((a[sortKey] || 0) - (b[sortKey] || 0)));
    }
    return filtered;
  }, [view, procs.data, runtime.data, keyword, sortKey, sortDir]);

  const selected = procRows.find((p) => p.pid === selectedPid) || null;

  useEffect(() => {
    setSelectedPid(null);
    setDetail(null);
    setMenu(null);
  }, [view]);

  async function openDetail(pid: number) {
    setSelectedPid(pid);
    try {
      setDetail(await api.collectJavaDetail(host, pid));
    } catch {
      setDetail(null);
    }
  }

  async function doKill() {
    if (!killTarget) return;
    setBusy(true);
    try {
      await api.killProcess(host, killTarget.pid, killTarget.force);
      setKillTarget(null);
      flash.showToast("已发送信号");
      await qc.invalidateQueries({ queryKey: ["procs", host] });
      await qc.invalidateQueries({ queryKey: ["runtime", host] });
    } catch (e) {
      flash.showError(formatErr(e));
    } finally {
      setBusy(false);
    }
  }

  async function dockerAct(name: string, action: "start" | "stop" | "restart") {
    setBusy(true);
    flash.clear();
    try {
      await api.dockerAction(host, action, name);
      await docker.refetch();
    } catch (e) {
      flash.showError(formatErr(e));
    } finally {
      setBusy(false);
    }
  }

  function tabLabel(key: ProcView, label: string) {
    if (key === "all") return label;
    const n =
      key === "docker" ? counts.data?.docker : counts.data?.[key as keyof monitor.RuntimeCounts];
    return n != null ? `${label} (${n})` : label;
  }

  return (
    <Page
      title="进程"
      actions={
        <>
          {(["all", "java", "bun", "python", "node", "go", "docker"] as const).map((item) => (
            <Button
              key={item}
              variant={view === item ? "primary" : "secondary"}
              onClick={() => setView(item)}
            >
              {tabLabel(item, item === "all" ? "全部" : item === "bun" ? "Bun" : item)}
            </Button>
          ))}
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="搜索"
            className="motion-field h-8 rounded-control px-3 text-ink"
          />
          {view !== "docker" ? (
            <>
              <Button
                variant={sortKey === "cpu" ? "primary" : "secondary"}
                onClick={() => {
                  if (sortKey === "cpu") setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                  else {
                    setSortKey("cpu");
                    setSortDir("desc");
                  }
                }}
              >
                CPU {sortKey === "cpu" ? (sortDir === "desc" ? "↓" : "↑") : ""}
              </Button>
              <Button
                variant={sortKey === "rss" ? "primary" : "secondary"}
                onClick={() => {
                  if (sortKey === "rss") setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                  else {
                    setSortKey("rss");
                    setSortDir("desc");
                  }
                }}
              >
                内存 {sortKey === "rss" ? (sortDir === "desc" ? "↓" : "↑") : ""}
              </Button>
            </>
          ) : null}
        </>
      }
      onRefresh={() =>
        void (view === "docker"
          ? docker.refetch()
          : view === "all"
            ? procs.refetch()
            : runtime.refetch())
      }
    >
      <FlashNotices flash={flash} />
      {view === "docker" ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-card">
          {(docker.data?.containers || [])
            .filter((item) =>
              `${item.name} ${item.image} ${item.state}`.toLowerCase().includes(keyword),
            )
            .map((item) => {
              const st = (docker.data?.stats || []).find((s) => s.name === item.name);
              const running = (item.state || "").toLowerCase() === "running";
              // 同类单元平铺成网格：raised 色块区分；块内 secondary 按钮与 neutral 标签换 surface 底才看得见
              return (
                <div key={item.id} className="bg-raised p-4 text-ink">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 truncate font-semibold">{item.name}</div>
                    <Tag tone={running ? "ok" : "neutral"} className={running ? "" : "bg-surface"}>
                      {item.state || "—"}
                    </Tag>
                  </div>
                  <div className="mt-1 truncate text-xs text-muted">{item.image}</div>
                  {st ? (
                    <div className="mt-2 text-xs text-muted">
                      CPU {st.cpuPercent.toFixed(1)}% · 内存 {formatBytes(st.memUsage)}
                    </div>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      className="bg-surface hover:bg-line"
                      disabled={busy}
                      onClick={() => void dockerAct(item.name, "start")}
                    >
                      启动
                    </Button>
                    <Button
                      className="bg-surface hover:bg-line"
                      disabled={busy}
                      onClick={() => void dockerAct(item.name, "stop")}
                    >
                      停止
                    </Button>
                    <Button
                      className="bg-surface hover:bg-line"
                      disabled={busy}
                      onClick={() => void dockerAct(item.name, "restart")}
                    >
                      重启
                    </Button>
                  </div>
                </div>
              );
            })}
          {docker.data && !docker.data.available ? (
            <p className="text-sm text-muted">目标机无 Docker 或不可用</p>
          ) : null}
        </div>
      ) : (
        <>
          <SimpleRows
            headers={[
              { key: "pid", label: "PID" },
              { key: "user", label: "用户" },
              { key: "cpu", label: "CPU%" },
              { key: "mem", label: "内存" },
              { key: "cmd", label: view === "all" ? "命令" : "入口 / 命令" },
            ]}
            selectedId={selectedPid != null ? String(selectedPid) : null}
            rows={procRows.map((proc) => ({
              id: String(proc.pid),
              cells: [
                String(proc.pid),
                proc.user || "—",
                proc.cpu.toFixed(1),
                formatBytes(proc.rss),
                view === "all" ? proc.args : proc.entry || proc.args,
              ],
            }))}
            onRowClick={(id) => void openDetail(Number(id))}
            onRowContextMenu={(id, event) => {
              const proc = procRows.find((p) => p.pid === Number(id));
              if (!proc) return;
              setMenu({
                x: event.clientX,
                y: event.clientY,
                items: [
                  { label: "查看详情", onClick: () => void openDetail(proc.pid) },
                  { label: "复制命令行", onClick: () => void copyText(proc.args || "") },
                  {
                    label: "结束进程",
                    danger: true,
                    onClick: () => setKillTarget({ pid: proc.pid, cmd: proc.args, force: false }),
                  },
                  {
                    label: "强制结束",
                    danger: true,
                    onClick: () => setKillTarget({ pid: proc.pid, cmd: proc.args, force: true }),
                  },
                ],
              });
            }}
          />
          {selected ? (
            <DetailPanel
              title={`进程 PID ${selected.pid}`}
              onClose={() => {
                setSelectedPid(null);
                setDetail(null);
              }}
              actions={
                <>
                  <Button onClick={() => void copyText(selected.args || "")}>复制命令行</Button>
                  <Button
                    onClick={() =>
                      setKillTarget({ pid: selected.pid, cmd: selected.args, force: false })
                    }
                  >
                    结束
                  </Button>
                </>
              }
            >
              <DetailRow label="用户" value={selected.user || "—"} />
              {view !== "all" ? (
                <>
                  <DetailRow label="部署" value={selected.deploy || "—"} />
                  {selected.service ? <DetailRow label="systemd" value={selected.service} /> : null}
                  {selected.container ? (
                    <DetailRow
                      label="容器"
                      value={`${selected.container}（${selected.image || "镜像未知"}）`}
                    />
                  ) : null}
                  <DetailRow label="入口" value={selected.entry || "—"} />
                  <DetailRow label="端口" value={(selected.ports || []).join("、") || "—"} />
                </>
              ) : null}
              <DetailRow
                label="CPU / 内存"
                value={`${selected.cpu.toFixed(2)}% / ${formatBytes(selected.rss)}（${selected.mem.toFixed(1)}%）`}
              />
              {view === "java" ? (
                <DetailRow
                  label="堆"
                  value={
                    selected.xms || selected.xmx
                      ? `${selected.xms ? formatBytes(selected.xms) : "默认"} ~ ${
                          selected.xmx ? formatBytes(selected.xmx) : "默认"
                        }`
                      : "未显式设置"
                  }
                />
              ) : null}
              <DetailRow label="已运行" value={formatDurationLong(selected.elapsed)} />
              {detail ? (
                <>
                  <DetailRow label="工作目录" value={detail.workDir || "—（无权限）"} />
                  <DetailRow label="可执行" value={detail.exePath || "—（无权限）"} />
                  <DetailRow
                    label="磁盘 IO"
                    value={
                      detail.readBytes || detail.writeBytes ? (
                        <span className="tabular-nums">
                          <span className="text-io-read">
                            读 {formatBytes(detail.readBytes)}
                          </span>
                          {" / "}
                          <span className="text-io-write">
                            写 {formatBytes(detail.writeBytes)}
                          </span>
                        </span>
                      ) : (
                        "—（无权限）"
                      )
                    }
                  />
                </>
              ) : null}
              <DetailRow label="命令行" value={selected.args || "—"} />
            </DetailPanel>
          ) : null}
        </>
      )}
      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
      <ConfirmDialog
        open={!!killTarget}
        title={killTarget?.force ? "强制结束进程" : "结束进程"}
        description={
          killTarget
            ? `确定要${killTarget.force ? "强制结束（SIGKILL）" : "结束（SIGTERM）"}进程 ${killTarget.pid} 吗？\n${(
                killTarget.cmd || ""
              ).slice(0, 120)}`
            : ""
        }
        confirmLabel={killTarget?.force ? "强制结束" : "结束进程"}
        danger
        busy={busy}
        onClose={() => setKillTarget(null)}
        onConfirm={() => void doKill()}
      />
    </Page>
  );
}

/* ---------- 证书 ---------- */

function CertsPage({ host }: { host: string }) {
  const [selected, setSelected] = useState<monitor.CertInfo | null>(null);
  const flash = useFlashMessage();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [certPath, setCertPath] = useState("");
  const [keyPath, setKeyPath] = useState("");
  const [pair, setPair] = useState<CertPairCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<CtxMenu | null>(null);
  const [removeTarget, setRemoveTarget] = useState<monitor.CertInfo | null>(null);

  const query = useQuery({
    queryKey: ["certs", host],
    queryFn: () => api.collectCerts(host),
  });
  const certs = query.data?.certs || [];

  async function checkPair() {
    setBusy(true);
    flash.clear();
    try {
      const r = await api.checkCertPair([certPath, keyPath].filter(Boolean));
      setPair(r);
      if (!r.certPath || !r.keyPath) flash.showError("未能识别证书与私钥路径");
    } catch (e) {
      flash.showError(formatErr(e));
      setPair(null);
    } finally {
      setBusy(false);
    }
  }

  async function doUpload() {
    if (!pair?.certPath || !pair?.keyPath) return;
    setBusy(true);
    try {
      await api.uploadCertPair(host, pair.certPath, pair.keyPath);
      setUploadOpen(false);
      flash.showToast("证书已上传");
      await query.refetch();
    } catch (e) {
      flash.showError(formatErr(e));
    } finally {
      setBusy(false);
    }
  }

  async function doRemove() {
    if (!removeTarget) return;
    setBusy(true);
    try {
      const paths = [`/etc/nginx/cert/${removeTarget.name}`];
      if (removeTarget.hasKey && removeTarget.keyName) {
        paths.push(`/etc/nginx/cert/${removeTarget.keyName}`);
      }
      await api.deletePaths(host, paths);
      setRemoveTarget(null);
      setSelected(null);
      flash.showToast("已删除");
      await query.refetch();
    } catch (e) {
      flash.showError(formatErr(e));
    } finally {
      setBusy(false);
    }
  }

  function statusOf(cert: monitor.CertInfo): { text: string; tone: "ok" | "warn" | "danger" } {
    if (cert.daysLeft < 0) return { text: "已过期", tone: "danger" };
    if (cert.daysLeft <= 30) return { text: "即将到期", tone: "warn" };
    return { text: "正常", tone: "ok" };
  }

  return (
    <Page
      title="证书"
      actions={
        <Button variant="primary" onClick={() => setUploadOpen(true)}>
          上传证书
        </Button>
      }
      onRefresh={() => void query.refetch()}
    >
      {query.error ? <Notice text={formatErr(query.error)} /> : null}
      <FlashNotices flash={flash} />
      {query.data && !query.data.installed ? (
        <Notice text="远程 /etc/nginx/cert 目录不存在" tone="warn" />
      ) : null}
      {query.data?.noOpenssl ? (
        <Notice text="远程缺少 openssl，无法解析证书内容" tone="warn" />
      ) : null}
      <SimpleRows
        headers={[
          { key: "name", label: "名称" },
          { key: "domains", label: "域名" },
          { key: "issuer", label: "颁发者" },
          { key: "expire", label: "到期" },
          { key: "days", label: "剩余天数" },
          { key: "status", label: "状态" },
        ]}
        selectedId={selected?.name}
        rows={certs.map((cert) => {
          const st = statusOf(cert);
          return {
            id: cert.name,
            cells: [
              cert.name,
              (cert.domains || []).join(", ") || "—",
              cert.issuer || "—",
              formatUnix(cert.notAfter),
              String(cert.daysLeft),
              <Tag key="s" tone={st.tone}>
                {st.text}
              </Tag>,
            ],
          };
        })}
        onRowClick={(id) => setSelected(certs.find((c) => c.name === id) || null)}
        onRowContextMenu={(id, event) => {
          const cert = certs.find((c) => c.name === id);
          if (!cert) return;
          setMenu({
            x: event.clientX,
            y: event.clientY,
            items: [
              { label: "查看信息", onClick: () => setSelected(cert) },
              { label: "删除", danger: true, onClick: () => setRemoveTarget(cert) },
            ],
          });
        }}
      />
      {selected ? (
        <DetailPanel title={`证书 ${selected.name}`} onClose={() => setSelected(null)}>
          <DetailRow label="域名" value={(selected.domains || []).join(", ") || "—"} />
          <DetailRow label="颁发者" value={selected.issuer || "—"} />
          <DetailRow label="到期" value={formatUnix(selected.notAfter)} />
          <DetailRow label="剩余" value={`${selected.daysLeft} 天`} />
          <DetailRow label="自签名" value={selected.selfSigned ? "是" : "否"} />
          <DetailRow label="私钥" value={selected.hasKey ? selected.keyName || "有" : "无"} />
          <DetailRow label="大小" value={formatBytes(selected.size)} />
        </DetailPanel>
      ) : null}
      <ContextMenu menu={menu} onClose={() => setMenu(null)} />

      <Dialog open={uploadOpen} onOpenChange={(v) => !v && setUploadOpen(false)}>
        <DialogContent>
          <DialogTitle>上传证书</DialogTitle>
          <DialogDescription>
            填写本机证书与私钥绝对路径，校验配对后上传到 /etc/nginx/cert
          </DialogDescription>
          <div className="mt-3 space-y-2">
            <input
              className="motion-field h-8 w-full rounded-control px-3 text-sm text-ink"
              placeholder="证书路径 .crt / .pem"
              value={certPath}
              onChange={(e) => setCertPath(e.target.value)}
            />
            <input
              className="motion-field h-8 w-full rounded-control px-3 text-sm text-ink"
              placeholder="私钥路径 .key"
              value={keyPath}
              onChange={(e) => setKeyPath(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button disabled={busy} onClick={() => void checkPair()}>
              校验配对
            </Button>
            <Button
              variant="primary"
              disabled={busy || !pair?.certPath || !pair?.keyPath}
              onClick={() => void doUpload()}
            >
              上传
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!removeTarget}
        title="删除证书"
        description={
          removeTarget
            ? `删除 /etc/nginx/cert/${removeTarget.name}${
                removeTarget.hasKey ? ` 及其私钥 ${removeTarget.keyName}` : ""
              }？`
            : ""
        }
        confirmLabel="删除"
        danger
        busy={busy}
        onClose={() => setRemoveTarget(null)}
        onConfirm={() => void doRemove()}
      />
    </Page>
  );
}

/* ---------- 服务 ---------- */

/** systemd ActiveState → 状态标签色：active 绿、failed 红、其余中性 */
function serviceActiveTone(active: string | undefined): "ok" | "danger" | "neutral" {
  const state = (active || "").toLowerCase();
  if (state === "active") return "ok";
  if (state === "failed") return "danger";
  return "neutral";
}

function ServicesPage({ host }: { host: string }) {
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<monitor.ServiceDetail | null>(null);
  const query = useQuery({
    queryKey: ["services", host],
    queryFn: () => api.collectServices(host),
  });
  const keyword = filter.trim().toLowerCase();
  const rows = (query.data || []).filter((item) =>
    `${item.name} ${item.description || ""}`.toLowerCase().includes(keyword),
  );

  async function openDetail(name: string) {
    setSelected(name);
    try {
      setDetail(await api.collectServiceDetail(host, name));
    } catch {
      setDetail(null);
    }
  }

  return (
    <Page
      title="服务"
      actions={
        <input
          className="motion-field h-8 rounded-control px-3 text-ink"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="搜索服务名"
        />
      }
      onRefresh={() => void query.refetch()}
    >
      {query.error ? <Notice text={formatErr(query.error)} /> : null}
      <SimpleRows
        headers={[
          { key: "name", label: "名称" },
          { key: "active", label: "状态" },
          { key: "sub", label: "子状态" },
          { key: "desc", label: "描述" },
        ]}
        selectedId={selected}
        rows={rows.map((item) => ({
          id: item.name,
          cells: [
            item.name,
            <Tag key="active" tone={serviceActiveTone(item.active)}>
              {item.active || "—"}
            </Tag>,
            item.sub || "—",
            item.description || "—",
          ],
        }))}
        onRowClick={(id) => void openDetail(id)}
      />
      {selected && detail ? (
        <DetailPanel title={selected} onClose={() => setSelected(null)}>
          <DetailRow label="描述" value={detail.description || "—"} />
          <DetailRow label="Load" value={detail.loadState || "—"} />
          <DetailRow label="Active" value={`${detail.activeState} / ${detail.subState}`} />
          <DetailRow label="MainPID" value={detail.mainPid || "—"} />
          <DetailRow label="用户" value={detail.user || "—"} />
          <DetailRow label="内存" value={detail.memoryCurrent || "—"} />
          <DetailRow label="单元文件" value={detail.fragmentPath || "—"} />
          <DetailRow label="ExecStart" value={detail.execStart || "—"} />
        </DetailPanel>
      ) : null}
    </Page>
  );
}

/* ---------- 定时任务 ---------- */

function CronPage({ host }: { host: string }) {
  const [menu, setMenu] = useState<CtxMenu | null>(null);
  const flash = useFlashMessage();
  const query = useQuery({
    queryKey: ["cron", host],
    queryFn: () => api.collectCrons(host),
  });

  const SOURCE_LABEL: Record<string, string> = {
    user: "用户 crontab",
    "etc-cron.d": "/etc/cron.d",
    "etc-crontab": "/etc/crontab",
  };

  const rows = useMemo(() => {
    return (query.data || []).map((c, index) => {
      const fields = (c.line || "").split(/\s+/).filter(Boolean);
      const isSystem = c.source !== "user";
      const schedule = fields.slice(0, 5).join(" ");
      const cmd = isSystem ? fields.slice(6).join(" ") : fields.slice(5).join(" ");
      return {
        id: String(index),
        source: c.source,
        user: c.user,
        schedule,
        cmd,
        line: c.line,
      };
    });
  }, [query.data]);

  return (
    <Page
      title="定时任务"
      onRefresh={() => void query.refetch()}
    >
      {query.error ? <Notice text={formatErr(query.error)} /> : null}
      <FlashNotices flash={flash} />
      <SimpleRows
        headers={[
          { key: "source", label: "来源" },
          { key: "user", label: "用户" },
          { key: "schedule", label: "计划" },
          { key: "cmd", label: "命令" },
        ]}
        rows={rows.map((item) => ({
          id: item.id,
          cells: [
            SOURCE_LABEL[item.source] || item.source || "—",
            item.user || "—",
            item.schedule || "—",
            item.cmd || item.line || "—",
          ],
        }))}
        onRowContextMenu={(id, event) => {
          const row = rows.find((r) => r.id === id);
          if (!row) return;
          setMenu({
            x: event.clientX,
            y: event.clientY,
            items: [
              {
                label: "复制计划+命令",
                onClick: () => {
                  void copyText([row.schedule, row.cmd].filter(Boolean).join(" ")).then(() =>
                    flash.showToast("已复制"),
                  );
                },
              },
              {
                label: "复制整行",
                onClick: () => {
                  void copyText(row.line || "").then(() => flash.showToast("已复制"));
                },
              },
            ],
          });
        }}
      />
      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
    </Page>
  );
}

/* ---------- 日志 ---------- */

function LogsPage({ host }: { host: string }) {
  const logTypes = [
    { key: "system", label: "系统" },
    { key: "auth", label: "认证" },
    { key: "kernel", label: "内核" },
    { key: "nginx_access", label: "Nginx 访问" },
    { key: "nginx_error", label: "Nginx 错误" },
  ] as const;
  const [kind, setKind] = useState<string>("system");
  const [lines, setLines] = useState(500);
  const [search, setSearch] = useState("");

  const query = useQuery({
    queryKey: ["logs", host, kind, lines],
    queryFn: () => api.collectLog(host, kind, lines),
  });

  const text = useMemo(() => {
    const raw = query.data?.content || "";
    if (!search.trim()) return raw;
    return raw
      .split("\n")
      .filter((line) => line.toLowerCase().includes(search.trim().toLowerCase()))
      .join("\n");
  }, [query.data, search]);

  const html = useMemo(() => logHighlightHtml(text), [text]);

  return (
    <Page
      title="日志"
      actions={
        <>
          {logTypes.map((item) => (
            <Button
              key={item.key}
              variant={kind === item.key ? "primary" : "secondary"}
              onClick={() => setKind(item.key)}
            >
              {item.label}
            </Button>
          ))}
          <Select<number>
            aria-label="行数"
            value={lines}
            onChange={setLines}
            options={[100, 500, 1000, 2000].map((count) => ({
              value: count,
              label: `${count} 行`,
            }))}
          />
          <input
            className="motion-field h-8 rounded-control px-3 text-ink"
            value={search}
            placeholder="搜索过滤"
            onChange={(e) => setSearch(e.target.value)}
          />
        </>
      }
      onRefresh={() => void query.refetch()}
    >
      {query.error ? <Notice text={formatErr(query.error)} /> : null}
      {query.data?.source ? (
        <p className="m-0 text-xs text-muted">来源 {query.data.source}</p>
      ) : null}
      {/* 日志本体保持独立石墨面（DESIGN.md §8.1） */}
      <div className="surface-float min-h-0 flex-1 overflow-hidden !bg-graphite">
        <HighlightPane html={html} text={text} pinBottom wrap />
      </div>
    </Page>
  );
}
