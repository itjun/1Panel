import { currentGroupSample } from "@/utils/groupSnapshot";
import { snapshotAlerts } from "@/react/components/workbench/group-trends";
import { useWorkbenchState } from "@/react/components/workbench/state";
/**
 * INTEGRATION: entry 的 GroupPage 改从本文件引入。
 */
import { useAgentInstall } from "@/react/state/agent-install";
import { AgentFleetCheckDialog } from "@/react/components/agent-fleet-check-dialog";
import { AgentInstallProgress } from "@/react/components/agent-install-progress";
import { Copy } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api, type agentcli, type main } from "@/api";
import {
  InteractiveDataTable,
  type InteractiveColumn,
  type InteractiveSortOrder,
} from "@/react/components/data-table";
import { Button } from "@/react/components/ui/button";
import { Meter } from "@/react/components/ui/meter";
import { Tag } from "@/react/components/ui/tag";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "@/react/components/ui/dialog";
import { FlashNotices, Notice, Page } from "@/react/components/page";
import { useFlashMessage } from "@/react/lib/use-flash-message";
import { UNGROUPED_ID, useSession } from "@/react/state/session";
import {
  isCpuAlert,
  isDiskFull,
  isLoadAlert,
  isMemAlert,
  summarizeDisks,
} from "@/utils/alerts";
import { copyText } from "@/utils/clipboard";
import { formatErr, formatMemCapacity } from "@/utils/format";
import { sortRowsByGroupValue, type GroupSortValue } from "@/utils/groupTableState";

const COL_ORDER_KEY = "1pannel-group-col-order-v1";
const TABLE_SORT_KEY = "1pannel-group-table-sort-v1";

const GROUP_NAME_RE = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;

const GROUP_COL_KEYS = [
  "index",
  "host",
  "addr",
  "lan",
  "agent",
  "user",
  "version",
  "spec",
  "load",
  "cpu",
  "mem",
  "disk",
] as const;

type GroupColumnKey = (typeof GROUP_COL_KEYS)[number];

const GROUP_COL_LABELS: Record<GroupColumnKey, string> = {
  index: "序",
  host: "主机",
  addr: "外网 IP",
  lan: "内网 IP",
  agent: "Agent",
  user: "用户",
  version: "版本",
  spec: "规格",
  load: "负载",
  cpu: "CPU",
  mem: "内存",
  disk: "磁盘",
};

/* Meter 列：8 格轨道最窄 62px + 8px 间隙，右侧等宽小号数字另测 */
const METER_EXTRA = 70;
/* IP 列：2px 间距 + 20px 复制按钮 */
const IP_COPY_EXTRA = 22;
/* Agent 列：Tag 左右内边距 */
const TAG_EXTRA = 16;

type GroupColumnFit = Pick<
  InteractiveColumn<GroupRow>,
  "width" | "minWidth" | "font" | "extra" | "flex" | "shrink"
>;

/** 列宽按内容自适应：width 只是测量前的初值；flex 列分富余空间，shrink 列不够时可截断到 minWidth */
const GROUP_COL_FIT: Record<GroupColumnKey, GroupColumnFit> = {
  index: { width: 56, minWidth: 48 },
  host: { width: 180, minWidth: 168, flex: 1, shrink: false },
  addr: { width: 176, minWidth: 156, font: "mono", extra: IP_COPY_EXTRA, shrink: false },
  lan: { width: 176, minWidth: 156, font: "mono", extra: IP_COPY_EXTRA, shrink: false },
  agent: { width: 100, minWidth: 72, extra: TAG_EXTRA },
  user: { width: 64, minWidth: 56, shrink: false },
  version: { width: 128, minWidth: 120, font: "mono", shrink: false },
  spec: { width: 80, minWidth: 64 },
  load: { width: 136, minWidth: 120, font: "mono-xs", extra: METER_EXTRA, flex: 2 },
  cpu: { width: 120, minWidth: 112, font: "mono-xs", extra: METER_EXTRA, flex: 2 },
  mem: { width: 120, minWidth: 112, font: "mono-xs", extra: METER_EXTRA, flex: 2 },
  disk: { width: 120, minWidth: 112, font: "mono-xs", extra: METER_EXTRA, flex: 2 },
};

function meterText(value: number | null): string {
  return value == null ? "—" : `${value.toFixed(1)}%`;
}

function groupCellText(row: GroupRow, key: GroupColumnKey): string {
  if (key === "host") return row.name;
  if (key === "addr") return row.publicIP || "—";
  if (key === "lan") return row.privateIP || "—";
  if (key === "agent") return row.agent;
  if (key === "user") return row.user || "—";
  if (key === "version") return row.version;
  if (key === "spec") return row.spec;
  if (key === "load") return row.loadText;
  if (key === "cpu") return meterText(row.cpu);
  if (key === "mem") return meterText(row.mem);
  if (key === "disk") return meterText(row.disk);
  return "";
}

type GroupRow = {
  name: string;
  hostName: string;
  publicIP: string;
  privateIP: string;
  user: string;
  agent: string;
  version: string;
  osRelease: string;
  spec: string;
  cpu: number | null;
  mem: number | null;
  disk: number | null;
  load: number | null;
  loadText: string;
  loadPercent: number | null;
  cpuAlert: boolean;
  memAlert: boolean;
  diskAlert: boolean;
  loadAlert: boolean;
};

function isGroupColumnKey(value: unknown): value is GroupColumnKey {
  return typeof value === "string" && (GROUP_COL_KEYS as readonly string[]).includes(value);
}

function readColumnOrder(): GroupColumnKey[] {
  try {
    const raw = localStorage.getItem(COL_ORDER_KEY);
    if (!raw) return [...GROUP_COL_KEYS];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...GROUP_COL_KEYS];
    const seen = new Set<GroupColumnKey>();
    const out: GroupColumnKey[] = [];
    for (const key of parsed) {
      if (isGroupColumnKey(key) && !seen.has(key)) {
        seen.add(key);
        out.push(key);
      }
    }
    GROUP_COL_KEYS.forEach((key, i) => {
      if (seen.has(key)) return;
      const prev = i > 0 ? out.indexOf(GROUP_COL_KEYS[i - 1]) : -1;
      out.splice(prev + 1, 0, key);
      seen.add(key);
    });
    return out.length === GROUP_COL_KEYS.length ? out : [...GROUP_COL_KEYS];
  } catch {
    return [...GROUP_COL_KEYS];
  }
}

function readTableSort(): { key: GroupColumnKey | null; order: InteractiveSortOrder } {
  try {
    const raw = localStorage.getItem(TABLE_SORT_KEY);
    if (!raw) return { key: null, order: null };
    const parsed = JSON.parse(raw) as { key?: unknown; order?: unknown };
    if (
      isGroupColumnKey(parsed.key) &&
      parsed.key !== "index" &&
      (parsed.order === "ascending" || parsed.order === "descending")
    ) {
      return { key: parsed.key, order: parsed.order };
    }
  } catch {
    /* ignore */
  }
  return { key: null, order: null };
}

function osVersion(osRelease: string): string {
  const text = (osRelease || "").trim();
  if (!text) return "";
  const matched = text.match(/\bv?\d+(?:\.\d+)+(?:\.\d+)?(?:\s+LTS)?\b/i);
  if (matched) return matched[0].replace(/^v/i, "");
  return text;
}

function agentTagOf(
  status: agentcli.Status | undefined,
  latest: string,
): { tone: "ok" | "warn" | "off"; text: string } {
  if (!status?.ok) return { tone: "off", text: "未装" };
  if (latest && status.version !== latest) return { tone: "warn", text: "需处理" };
  return { tone: "ok", text: `v${status.version}` };
}

function groupRowSortValue(row: GroupRow, key: GroupColumnKey): GroupSortValue {
  if (key === "host") return row.name;
  if (key === "addr") return row.publicIP || null;
  if (key === "lan") return row.privateIP || null;
  if (key === "agent") return row.agent;
  if (key === "user") return row.user;
  if (key === "version") return row.version === "—" ? null : row.version;
  if (key === "spec") return row.spec === "—" ? null : row.spec;
  if (key === "cpu") return row.cpu;
  if (key === "mem") return row.mem;
  if (key === "disk") return row.disk;
  if (key === "load") return row.load;
  return null;
}

/** 表格里的 Meter：撑满单元格，右侧数字不换行（td 为 wrap 列） */
const METER_CELL_CLASS = "w-full whitespace-nowrap";

function IpCell({ ip, onCopy }: { ip: string; onCopy: (ip: string) => void }) {
  if (!ip) return <span className="text-muted">—</span>;
  return (
    <span className="flex w-full min-w-0 items-center justify-between gap-0.5">
      <span className="min-w-0 truncate font-mono text-muted">{ip}</span>
      <button
        type="button"
        aria-label={`复制 ${ip}`}
        data-tip="复制"
        onClick={() => onCopy(ip)}
        onDoubleClick={(e) => e.stopPropagation()}
        className="motion-colors inline-flex size-5 shrink-0 items-center justify-center rounded-control text-muted hover:bg-line hover:text-ink focus-visible:outline-2 focus-visible:outline-accent-focus"
      >
        <Copy size={14} strokeWidth={1.5} aria-hidden />
      </button>
    </span>
  );
}

const INPUT_CLASS =
  "motion-field h-9 w-full rounded-control px-3 text-sm text-ink";

export function GroupPage({
  onCreateHost,
}: {
  onCreateHost?: (groupId?: string) => void;
} = {}) {
  const session = useSession();
  const groupId = session.activeGroupId || UNGROUPED_ID;
  const [onlyAlerts, setOnlyAlerts] = useWorkbenchState(`group-alerts:${groupId}`, false);
  const canEditGroup = groupId !== UNGROUPED_ID;
  const groupLabel = session.groupName(groupId);
  const hosts = session.hostsOf(groupId);
  /** 稳定键：避免 hosts 数组每帧新引用导致 effect 空转 */
  const hostNamesKey = useMemo(
    () => hosts.map((h) => h.name).join("\0"),
    [hosts],
  );
  const boardTitle = useMemo(() => {
    if (!canEditGroup) return "";
    const g = session.groups.find((item) => item.id === groupId);
    return (g?.boardTitle || "").trim();
  }, [canEditGroup, groupId, session.groups]);

  const [columnOrder, setColumnOrder] = useState<GroupColumnKey[]>(readColumnOrder);
  const [sort, setSort] = useState(readTableSort);
  const [refreshing, setRefreshing] = useState(false);
  const [boardBusy, setBoardBusy] = useState(false);
  const boardFlash = useFlashMessage();

  const [agentStatuses, setAgentStatuses] = useState<Record<string, agentcli.Status>>({});
  const [latestAgentVersion, setLatestAgentVersion] = useState("");
  const latestAgentVersionRef = useRef("");
  latestAgentVersionRef.current = latestAgentVersion;

  const aliveRef = useRef(true);
  const groupIdRef = useRef(groupId);
  const hostsRef = useRef(hosts);
  groupIdRef.current = groupId;
  hostsRef.current = hosts;

  const installTask = useAgentInstall();
  const [isAgentCheckOpen, setIsAgentCheckOpen] = useState(false);
  const isInstalling = installTask.phase === "running";
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsName, setSettingsName] = useState("");
  const [settingsBoardTitle, setSettingsBoardTitle] = useState("");
  const [settingsError, setSettingsError] = useState("");

  const overview = useQuery({
    queryKey: ["group-overview", groupId],
    queryFn: () => api.listOneGroupOverview(groupId),
    refetchInterval: 5000,
  });

  const byName = useMemo(() => {
    const map = new Map<string, main.HostOverviewSnapshot>();
    for (const host of overview.data?.hosts || []) map.set(host.name, host);
    return map;
  }, [overview.data]);

  const loadAgentStatuses = useCallback(async () => {
    const names = hostsRef.current.map((h) => h.name);
    const gid = groupIdRef.current;
    await Promise.all(
      names.map(async (name) => {
        try {
          const st = await api.agentStatus(name);
          if (!aliveRef.current || groupIdRef.current !== gid) return;
          setAgentStatuses((prev) => ({ ...prev, [name]: st }));
        } catch {
          /* 徽章显示未装即可 */
        }
      }),
    );
    if (!latestAgentVersionRef.current) {
      try {
        const ver = await api.agentLatestVersion();
        if (aliveRef.current) {
          latestAgentVersionRef.current = ver;
          setLatestAgentVersion(ver);
        }
      } catch {
        /* ignore */
      }
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    void loadAgentStatuses();
  }, [groupId, hostNamesKey, loadAgentStatuses]);

  useEffect(() => {
    if (installTask.phase === "done") void loadAgentStatuses();
  }, [installTask.phase, loadAgentStatuses]);

  useEffect(() => {
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const rows: GroupRow[] = useMemo(
    () =>
      hosts.map((host) => {
        const snap = byName.get(host.name);
        const sample = currentGroupSample(snap, overview.isError);
        const ov = sample.overview;
        const diskSum = summarizeDisks(sample.disks);
        const tag = agentTagOf(agentStatuses[host.name], latestAgentVersion);
        let agent = tag.text;
        if (snap?.notInstalled) agent = "未装";
        else if (snap?.error || overview.isError) agent = "采集异常";
        return {
          name: host.name,
          hostName: host.hostName,
          publicIP: snap?.publicIP || host.hostName,
          privateIP: snap?.privateIP && snap.privateIP !== snap.publicIP ? snap.privateIP : "",
          user: host.user,
          agent,
          version: ov ? osVersion(ov.osRelease || "") || "—" : "—",
          osRelease: (ov?.osRelease || "").trim(),
          spec: ov ? `${ov.cpuCount || 0}核${formatMemCapacity(ov.memTotal || 0)}` : "—",
          cpu: ov ? ov.cpuPercent : null,
          mem: ov ? ov.memPercent : null,
          disk: diskSum ? diskSum.percent : null,
          load: ov ? ov.load1 : null,
          loadText: ov ? `${(ov.load1 || 0).toFixed(2)} / ${ov.cpuCount || 0}` : "—",
          loadPercent: ov && ov.cpuCount > 0 ? ((ov.load1 || 0) / ov.cpuCount) * 100 : ov ? 0 : null,
          cpuAlert: isCpuAlert(ov),
          memAlert: isMemAlert(ov),
          diskAlert: isDiskFull(sample.disks),
          loadAlert: isLoadAlert(ov),
        };
      }),
    [agentStatuses, byName, hosts, latestAgentVersion, overview.isError],
  );

  const sortedRows = useMemo(() => {
    if (!sort.key || !sort.order) return rows;
    return sortRowsByGroupValue(rows, (row) => groupRowSortValue(row, sort.key!), sort.order);
  }, [rows, sort]);

  const installRows = useMemo(() => new Map(installTask.rows.map(row => [row.host, row])), [installTask.rows]);

  const boardFlashRef = useRef(boardFlash);
  boardFlashRef.current = boardFlash;
  const copyIp = useCallback((ip: string) => {
    void copyText(ip)
      .then(() => boardFlashRef.current.showToast(`已复制 ${ip}`))
      .catch((err) => boardFlashRef.current.showError(`复制失败: ${formatErr(err)}`));
  }, []);

  const columns: InteractiveColumn<GroupRow>[] = useMemo(
    () =>
      GROUP_COL_KEYS.map((key) => ({
        key,
        pinned: key === "host",
        label: GROUP_COL_LABELS[key],
        ...GROUP_COL_FIT[key],
        measure: key === "index" ? () => String(rows.length) : (row: GroupRow) => groupCellText(row, key),
        sortable: key !== "index",
        align: key === "index" ? "right" : "left",
        wrap: key === "agent" || key === "load" || key === "cpu" || key === "mem" || key === "disk",
        render: (row: GroupRow, index: number) => {
          if (key === "index") return <span className="tabular-nums text-muted">{index + 1}</span>;
          if (key === "host") return <span className="truncate">{row.name}</span>;
          if (key === "addr") {
            return <IpCell ip={row.publicIP} onCopy={copyIp} />;
          }
          if (key === "lan") return <IpCell ip={row.privateIP} onCopy={copyIp} />;
          if (key === "agent") {
            const progress = installRows.get(row.name);
            if (isInstalling && progress) {
              return (
                <div className="flex min-w-0 flex-col gap-1">
                  <span
                    className={
                      progress.state === "error"
                        ? "truncate text-xs text-danger"
                        : progress.state === "running" || progress.state === "done"
                          ? "truncate text-xs text-accent"
                          : "truncate text-xs text-muted"
                    }
                  >
                    {progress.text}
                  </span>
                  <AgentInstallProgress row={progress} isCompact />
                </div>
              );
            }
            // 异常：Agent 探测出错且未在线（row.agent 已按此算好）
            if (row.agent === "采集异常") {
              return <Tag tone="danger">采集异常</Tag>;
            }
            const tag = agentTagOf(agentStatuses[row.name], latestAgentVersion);
            if (tag.tone === "ok") {
              return <Tag tone="ok">{tag.text}</Tag>;
            }
            if (tag.tone === "warn") {
              return <Tag tone="warn">{tag.text}</Tag>;
            }
            return <Tag tone="neutral">{tag.text}</Tag>;
          }
          if (key === "user") return row.user || "—";
          if (key === "version") {
            return (
              <span className="font-mono text-muted" data-tip={row.osRelease || undefined}>
                {row.version}
              </span>
            );
          }
          if (key === "spec") return row.spec;
          if (key === "load") {
            return (
              <Meter
                value={row.loadPercent ?? undefined}
                valueText={row.loadText}
                tone={row.loadAlert ? "danger" : "auto"}
                className={METER_CELL_CLASS}
              />
            );
          }
          if (key === "cpu") {
            return (
              <Meter
                value={row.cpu ?? undefined}
                tone={row.cpuAlert ? "danger" : "auto"}
                className={METER_CELL_CLASS}
              />
            );
          }
          if (key === "mem") {
            return (
              <Meter
                value={row.mem ?? undefined}
                tone={row.memAlert ? "danger" : "auto"}
                className={METER_CELL_CLASS}
              />
            );
          }
          if (key === "disk") {
            return (
              <Meter
                value={row.disk ?? undefined}
                tone={row.diskAlert ? "danger" : "auto"}
                className={METER_CELL_CLASS}
              />
            );
          }
          return "—";
        },
      })),
    [agentStatuses, installRows, copyIp, latestAgentVersion, isInstalling, rows.length],
  );

  function persistOrder(next: string[]) {
    const filtered = next.filter(isGroupColumnKey);
    setColumnOrder(filtered);
    localStorage.setItem(COL_ORDER_KEY, JSON.stringify(filtered));
  }

  function persistSort(key: string | null, order: InteractiveSortOrder) {
    const next = {
      key: key && isGroupColumnKey(key) && key !== "index" ? key : null,
      order,
    };
    setSort(next);
    if (next.key && next.order) localStorage.setItem(TABLE_SORT_KEY, JSON.stringify(next));
    else localStorage.removeItem(TABLE_SORT_KEY);
  }

  async function refreshAll() {
    setRefreshing(true);
    try {
      await Promise.all([overview.refetch(), loadAgentStatuses()]);
    } finally {
      setRefreshing(false);
    }
  }

  async function copyBoardLink() {
    if (!canEditGroup) return;
    setBoardBusy(true);
    boardFlash.clear();
    try {
      const urls = await api.listBoardURLs(groupId);
      const url = (urls || [])[0];
      if (!url) throw new Error("无可用内网地址");
      await copyText(url);
      boardFlash.showToast("看板链接已复制");
    } catch (err) {
      boardFlash.showError(`复制失败: ${formatErr(err)}`);
    } finally {
      setBoardBusy(false);
    }
  }

  async function openBoardBrowser() {
    if (!canEditGroup) return;
    setBoardBusy(true);
    boardFlash.clear();
    try {
      await api.openBoardInBrowser(groupId);
    } catch (err) {
      boardFlash.showError(`打开失败: ${formatErr(err)}`);
    } finally {
      setBoardBusy(false);
    }
  }

  function openGroupSettings() {
    if (!canEditGroup) return;
    setSettingsName(groupLabel);
    setSettingsBoardTitle(boardTitle);
    setSettingsError("");
    setSettingsOpen(true);
  }

  async function saveGroupSettings() {
    if (!canEditGroup || settingsSaving) return;
    const nextName = settingsName.trim();
    if (!nextName) {
      setSettingsError("分组名称不能为空");
      return;
    }
    if (!GROUP_NAME_RE.test(nextName)) {
      setSettingsError("只允许英文字母、数字和短横线，例如 cdcp-main 或 01-cdcp-main");
      return;
    }
    setSettingsSaving(true);
    setSettingsError("");
    try {
      let effectiveId = groupId;
      if (nextName !== groupLabel) {
        effectiveId = await api.renameGroup(groupId, nextName);
      }
      const nextBoard = settingsBoardTitle.trim();
      if (nextBoard !== boardTitle) {
        await api.setBoardTitle(effectiveId, nextBoard);
      }
      setSettingsOpen(false);
      await session.refresh();
      if (effectiveId !== groupId) session.openGroup(effectiveId);
    } catch (err) {
      setSettingsError(`保存失败: ${formatErr(err)}`);
    } finally {
      setSettingsSaving(false);
    }
  }

  function openAddHost() {
    onCreateHost?.(canEditGroup ? groupId : undefined);
  }

  // 概况条：直接从 hosts + Agent 状态算，不走新接口
  const installedCount = hosts.filter(
    (h) => agentTagOf(agentStatuses[h.name], latestAgentVersion).tone !== "off",
  ).length;
  const updatableCount = hosts.filter(
    (h) => agentTagOf(agentStatuses[h.name], latestAgentVersion).tone === "warn",
  ).length;
  let summaryText = `${hosts.length} 台主机，${installedCount} 台已装 Agent`;
  if (updatableCount > 0) {
    summaryText += `，${updatableCount} 台需处理`;
  }

  const alertNames = new Set(hosts.filter(h => { const snap = byName.get(h.name); return overview.isError || !!snap?.error || !!snap?.notInstalled || snapshotAlerts(snap).length > 0; }).map(h => h.name));
  const visibleRows = sortedRows.filter(row => !onlyAlerts || alertNames.has(row.name));
  return (
    <Page
      title="主机分组"
      heading={false}
      flush
      onRefresh={() => void refreshAll()}
      refreshing={refreshing}
    >
      {/* 内容区四周 16px 安全边距：白色平面上直接放扁平表格 */}
      <div className="workbench-group flex min-h-0 flex-1 flex-col gap-2 p-4">
        <FlashNotices flash={boardFlash} />
        <div className="workbench-group-heading">
          <div className="min-w-0"><h1>{groupLabel}</h1><p>{summaryText}</p></div>
        </div>
        <div className="workbench-group-toolbar" role="region" aria-label="分组操作" tabIndex={0}>
          <Button size="sm" variant="secondary" disabled={!hosts.length || isInstalling} onClick={() => setIsAgentCheckOpen(true)}>
            检查 Agent
          </Button>
          {isAgentCheckOpen ? <AgentFleetCheckDialog hosts={hosts.map(host => host.name)} latestVersion={latestAgentVersion} onClose={() => setIsAgentCheckOpen(false)} /> : null}
          {canEditGroup && <>
            <Button size="sm" variant="secondary" disabled={boardBusy} onClick={() => void copyBoardLink()}>复制链接</Button>
            <Button size="sm" variant="secondary" disabled={boardBusy} onClick={() => void openBoardBrowser()}>快速打开</Button>
            {hosts.length >= 2 && <Button size="sm" variant="secondary" data-tip="组内主机之间走局域网测带宽" onClick={() => session.openSpeedtest("group", { groupId })}>分组测速</Button>}
            <Button size="sm" variant="secondary" onClick={openGroupSettings}>分组设置</Button>
          </>}
          {hosts.length > 0 && <div className="workbench-group-toolbar-section">
            <Button size="sm" aria-pressed={onlyAlerts} variant={onlyAlerts ? "primary" : "secondary"} onClick={() => setOnlyAlerts(!onlyAlerts)}>{onlyAlerts ? "清除告警筛选" : `查看告警 ${alertNames.size}`}</Button>
          </div>}
        </div>

        {!hosts.length ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 py-12 text-center">
            <Button variant="primary" onClick={openAddHost}>添加主机</Button>
          </div>
        ) : (
          <>
            {overview.isError ? <Notice text={`采集更新失败：${formatErr(overview.error)}，当前读数暂不可用`} /> : null}
            <InteractiveDataTable
              columns={columns}
              data={visibleRows}
              empty={onlyAlerts ? "没有符合筛选条件的主机" : "暂无数据"}
              columnOrder={columnOrder}
              isResizable={false}
              sortKey={sort.key}
              sortOrder={sort.order}
              onColumnOrderChange={persistOrder}
              onSortChange={persistSort}
              onRowDoubleClick={(row) => session.openHost(row.name)}
              getRowId={(row) => row.name}
            />
          </>
        )}
      </div>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent>
          <DialogTitle>分组设置</DialogTitle>
          {settingsError ? (
            <div className="mt-3">
              <Notice text={settingsError} />
            </div>
          ) : null}
          <div className="mt-4 flex flex-col gap-4">
            <label className="block">
              <span className="mb-1.5 block text-sm text-muted">分组名称</span>
              <input
                className={INPUT_CLASS}
                value={settingsName}
                placeholder="如 04-new-group"
                onChange={(e) => setSettingsName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveGroupSettings();
                }}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm text-muted">看板标题</span>
              <input
                className={INPUT_CLASS}
                value={settingsBoardTitle}
                placeholder="看板正中标题，可空"
                onChange={(e) => setSettingsBoardTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveGroupSettings();
                }}
              />
            </label>
          </div>
          <DialogFooter>
            <Button disabled={settingsSaving} onClick={() => setSettingsOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              disabled={settingsSaving}
              onClick={() => void saveGroupSettings()}
            >
              {settingsSaving ? "保存中" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
