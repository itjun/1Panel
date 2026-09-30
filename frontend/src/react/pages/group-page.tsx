/**
 * INTEGRATION: entry 的 GroupPage 改从本文件引入。
 */
import { Events } from "@wailsio/runtime";
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
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/react/components/ui/dialog";
import { FlashNotices, Notice, Page } from "@/react/components/page";
import { useFlashMessage } from "@/react/lib/use-flash-message";
import { UNGROUPED_ID, useSession } from "@/react/state/session";
import {
  isCpuAlert,
  isDiskLow,
  isLoadAlert,
  isMemAlert,
  summarizeDisks,
} from "@/utils/alerts";
import { copyText } from "@/utils/clipboard";
import { formatErr, formatMemCapacity } from "@/utils/format";
import { sortRowsByGroupValue, type GroupSortValue } from "@/utils/groupTableState";

const COL_WIDTHS_KEY = "1pannel-group-col-widths-v4";
const COL_ORDER_KEY = "1pannel-group-col-order-v1";
const TABLE_SORT_KEY = "1pannel-group-table-sort-v1";

const GROUP_NAME_RE = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;

const GROUP_COL_KEYS = [
  "index",
  "host",
  "addr",
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
  addr: "地址",
  agent: "Agent",
  user: "用户",
  version: "版本",
  spec: "规格",
  load: "负载",
  cpu: "CPU",
  mem: "内存",
  disk: "磁盘",
};

const GROUP_DEFAULT_W: Record<GroupColumnKey, number> = {
  index: 64,
  host: 140,
  addr: 150,
  agent: 100,
  user: 64,
  version: 108,
  spec: 80,
  /* Meter 列：8 格轨道最窄 62px + 8px 间隙 + 等宽数字，再加单元格左右 24px 内边距 */
  load: 136,
  cpu: 120,
  mem: 120,
  disk: 160,
};

const GROUP_MIN_W: Record<GroupColumnKey, number> = {
  index: 64,
  host: 132,
  addr: 150,
  agent: 112,
  user: 96,
  version: 108,
  spec: 96,
  load: 128,
  cpu: 112,
  mem: 112,
  disk: 160,
};

const BATCH_STEP_LABEL: Record<string, string> = {
  probe: "探测主机状态",
  upload: "上传 Agent",
  replace: "替换二进制",
  start: "启动服务",
  verify: "验证版本",
  done: "完成",
  error: "失败",
};

type BatchRowState = "pending" | "running" | "done" | "error";

type BatchRow = {
  host: string;
  state: BatchRowState;
  step: string;
  percent: number;
  error?: string;
  version?: string;
};

type GroupRow = {
  name: string;
  hostName: string;
  user: string;
  agent: string;
  version: string;
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
    for (const key of GROUP_COL_KEYS) {
      if (!seen.has(key)) out.push(key);
    }
    return out.length === GROUP_COL_KEYS.length ? out : [...GROUP_COL_KEYS];
  } catch {
    return [...GROUP_COL_KEYS];
  }
}

function readColWidths(): Record<string, number> {
  const out: Record<string, number> = { ...GROUP_DEFAULT_W };
  try {
    const raw = localStorage.getItem(COL_WIDTHS_KEY);
    if (!raw) return out;
    const obj = JSON.parse(raw) as Record<string, unknown>;
    for (const key of GROUP_COL_KEYS) {
      const value = Number(obj[key]);
      if (Number.isFinite(value) && value >= 32) out[key] = Math.round(value);
    }
  } catch {
    /* ignore */
  }
  return out;
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

function batchRowLabel(row: BatchRow): string {
  if (row.state === "pending") return "排队中";
  if (row.state === "done") {
    if (row.version) return `已是最新 v${row.version}`;
    return "完成";
  }
  if (row.state === "error") return row.error ? `失败：${row.error}` : "失败";
  const step = BATCH_STEP_LABEL[row.step] || row.step || "安装中";
  if (row.step === "upload" && row.percent >= 0) return `${step} ${row.percent}%`;
  return step;
}

function agentTagOf(
  status: agentcli.Status | undefined,
  latest: string,
): { tone: "ok" | "warn" | "off"; text: string } {
  if (!status?.ok) return { tone: "off", text: "未装" };
  if (latest && status.version !== latest) return { tone: "warn", text: "可更新" };
  return { tone: "ok", text: `v${status.version}` };
}

function groupRowSortValue(row: GroupRow, key: GroupColumnKey): GroupSortValue {
  if (key === "host") return row.name;
  if (key === "addr") return row.hostName;
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

const INPUT_CLASS =
  "motion-field h-9 w-full rounded-control px-3 text-sm text-ink";

export function GroupPage({
  onCreateHost,
}: {
  onCreateHost?: (groupId?: string) => void;
} = {}) {
  const session = useSession();
  const groupId = session.activeGroupId || UNGROUPED_ID;
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
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(readColWidths);
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

  const [batchBusy, setBatchBusy] = useState(false);
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [batchDone, setBatchDone] = useState(false);
  const [batchRows, setBatchRows] = useState<BatchRow[]>([]);
  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false);
  const batchRowsRef = useRef(batchRows);
  batchRowsRef.current = batchRows;

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
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const rows: GroupRow[] = useMemo(
    () =>
      hosts.map((host) => {
        const snap = byName.get(host.name);
        const ov = snap?.overview;
        const diskSum = summarizeDisks(snap?.disks);
        const tag = agentTagOf(agentStatuses[host.name], latestAgentVersion);
        let agent = tag.text;
        if (snap?.notInstalled) agent = "未装";
        else if (snap?.error && !agentStatuses[host.name]?.ok) agent = "异常";
        return {
          name: host.name,
          hostName: host.hostName,
          user: host.user,
          agent,
          version: ov ? osVersion(ov.osRelease || "") || "—" : "—",
          spec: ov ? `${ov.cpuCount || 0}核${formatMemCapacity(ov.memTotal || 0)}` : "—",
          cpu: ov ? ov.cpuPercent : null,
          mem: ov ? ov.memPercent : null,
          disk: diskSum ? diskSum.percent : null,
          load: ov ? ov.load1 : null,
          loadText: ov ? `${(ov.load1 || 0).toFixed(2)} / ${ov.cpuCount || 0}` : "—",
          loadPercent: ov && ov.cpuCount > 0 ? ((ov.load1 || 0) / ov.cpuCount) * 100 : ov ? 0 : null,
          cpuAlert: isCpuAlert(ov),
          memAlert: isMemAlert(ov),
          diskAlert: isDiskLow(snap?.disks),
          loadAlert: isLoadAlert(ov),
        };
      }),
    [agentStatuses, byName, hosts, latestAgentVersion],
  );

  const sortedRows = useMemo(() => {
    if (!sort.key || !sort.order) return rows;
    return sortRowsByGroupValue(rows, (row) => groupRowSortValue(row, sort.key!), sort.order);
  }, [rows, sort]);

  const batchRowMap = useMemo(() => {
    const map = new Map<string, BatchRow>();
    for (const row of batchRows) map.set(row.host, row);
    return map;
  }, [batchRows]);

  const showBatchInTable = batchBusy || (batchDialogOpen && !batchDone);

  const columns: InteractiveColumn<GroupRow>[] = useMemo(
    () =>
      GROUP_COL_KEYS.map((key) => ({
        key,
        label: GROUP_COL_LABELS[key],
        width: GROUP_DEFAULT_W[key],
        minWidth: GROUP_MIN_W[key],
        sortable: key !== "index",
        align: key === "index" ? "right" : "left",
        wrap: key === "agent" || key === "load" || key === "cpu" || key === "mem" || key === "disk",
        render: (row: GroupRow, index: number) => {
          if (key === "index") return <span className="tabular-nums text-muted">{index + 1}</span>;
          if (key === "host") return row.name;
          if (key === "addr") {
            return <span className="font-mono text-muted">{row.hostName || "—"}</span>;
          }
          if (key === "agent") {
            const progress = batchRowMap.get(row.name);
            if (showBatchInTable && progress) {
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
                    {batchRowLabel(progress)}
                  </span>
                  {progress.state === "running" && progress.percent >= 0 ? (
                    <Meter
                      value={progress.percent}
                      showValue={false}
                      tone="ok"
                      className="w-full"
                    />
                  ) : null}
                </div>
              );
            }
            // 异常：Agent 探测出错且未在线（row.agent 已按此算好）
            if (row.agent === "异常") {
              return <Tag tone="danger">异常</Tag>;
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
            return <span className="font-mono text-muted">{row.version}</span>;
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
    [agentStatuses, batchRowMap, latestAgentVersion, showBatchInTable],
  );

  function persistOrder(next: string[]) {
    const filtered = next.filter(isGroupColumnKey);
    setColumnOrder(filtered);
    localStorage.setItem(COL_ORDER_KEY, JSON.stringify(filtered));
  }

  function persistWidths(next: Record<string, number>) {
    setColumnWidths(next);
    const custom: Record<string, number> = {};
    for (const key of GROUP_COL_KEYS) {
      if (next[key] != null && next[key] !== GROUP_DEFAULT_W[key]) custom[key] = next[key]!;
    }
    if (Object.keys(custom).length === 0) localStorage.removeItem(COL_WIDTHS_KEY);
    else localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(custom));
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

  function resetLayout() {
    setColumnOrder([...GROUP_COL_KEYS]);
    setColumnWidths({ ...GROUP_DEFAULT_W });
    localStorage.removeItem(COL_ORDER_KEY);
    localStorage.removeItem(COL_WIDTHS_KEY);
  }

  const hasCustomLayout =
    columnOrder.some((key, index) => key !== GROUP_COL_KEYS[index]) ||
    GROUP_COL_KEYS.some((key) => columnWidths[key] !== GROUP_DEFAULT_W[key]);

  async function refreshAll() {
    setRefreshing(true);
    try {
      await overview.refetch();
      await loadAgentStatuses();
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

  function applyBatchProgress(d: {
    host?: string;
    step?: string;
    percent?: number;
    text?: string;
  }) {
    if (!d.host) return;
    setBatchRows((prev) => {
      const idx = prev.findIndex((r) => r.host === d.host);
      if (idx < 0) return prev;
      const next = prev.slice();
      const row = { ...next[idx]! };
      const step = d.step || "";
      if (step === "done") {
        row.state = "done";
        row.step = "done";
        row.percent = 100;
        if (d.text) {
          const m = d.text.match(/v?(\d+\.\d+\.\d+)/);
          if (m) row.version = m[1];
        }
      } else if (step === "error") {
        row.state = "error";
        row.step = "error";
        row.error = d.text || "安装失败";
      } else {
        row.state = "running";
        row.step = step;
        if (typeof d.percent === "number") row.percent = d.percent;
      }
      next[idx] = row;
      return next;
    });
  }

  async function runBatchInstall() {
    setBatchConfirmOpen(false);
    if (batchBusy) return;
    const targets = hosts.map((h) => h.name);
    if (!targets.length) return;

    const needInstall = targets.filter(
      (n) => agentTagOf(agentStatuses[n], latestAgentVersion).tone !== "ok",
    );
    const alreadyOk = targets.filter(
      (n) => agentTagOf(agentStatuses[n], latestAgentVersion).tone === "ok",
    );

    setBatchRows([
      ...alreadyOk.map((host) => ({
        host,
        state: "done" as const,
        step: "done",
        percent: 100,
        version: latestAgentVersion || agentStatuses[host]?.version || "",
      })),
      ...needInstall.map((host) => ({
        host,
        state: "pending" as const,
        step: "",
        percent: -1,
      })),
    ]);
    setBatchDone(needInstall.length === 0);
    setBatchDialogOpen(true);
    if (needInstall.length === 0) return;

    setBatchBusy(true);
    const off = Events.On(
      "agent-install-progress",
      (ev: { data?: { host?: string; step?: string; percent?: number; text?: string } }) => {
        if (ev?.data) applyBatchProgress(ev.data);
      },
    );

    try {
      const results = await api.batchInstallAgent(needInstall);
      setBatchRows((prev) => {
        const map = new Map(prev.map((r) => [r.host, { ...r }]));
        for (const r of results) {
          const row = map.get(r.host);
          if (!row) continue;
          if (r.ok) {
            row.state = "done";
            row.step = "done";
            row.version = r.version || row.version;
            row.percent = 100;
          } else {
            row.state = "error";
            row.step = "error";
            row.error = r.error || "失败";
          }
          map.set(r.host, row);
        }
        return Array.from(map.values());
      });
      setBatchDone(true);
      await loadAgentStatuses();
      void overview.refetch();
    } catch (e) {
      setBatchDone(true);
      setBatchRows((prev) =>
        prev.map((row) =>
          row.state === "pending" || row.state === "running"
            ? { ...row, state: "error", step: "error", error: formatErr(e) }
            : row,
        ),
      );
    } finally {
      setBatchBusy(false);
      off?.();
    }
  }

  function openAddHost() {
    onCreateHost?.(canEditGroup ? groupId : undefined);
  }

  const batchSummaryText = useMemo(() => {
    const total = batchRows.length;
    const done = batchRows.filter((r) => r.state === "done").length;
    const err = batchRows.filter((r) => r.state === "error").length;
    if (!batchDone) return `进行中 ${done + err}/${total} · 全部主机并行`;
    if (err > 0) return `完成 ${done}/${total} · ${err} 台失败`;
    return `全部 ${total} 台安装完成`;
  }, [batchDone, batchRows]);

  const needInstallCount = hosts.filter(
    (h) => agentTagOf(agentStatuses[h.name], latestAgentVersion).tone !== "ok",
  ).length;
  const alreadyOkCount = hosts.length - needInstallCount;

  // 概况条：直接从 hosts + Agent 状态算，不走新接口
  const installedCount = hosts.filter(
    (h) => agentTagOf(agentStatuses[h.name], latestAgentVersion).tone !== "off",
  ).length;
  const updatableCount = hosts.filter(
    (h) => agentTagOf(agentStatuses[h.name], latestAgentVersion).tone === "warn",
  ).length;
  let summaryText = `${hosts.length} 台主机 · ${installedCount} 台已装 Agent`;
  if (updatableCount > 0) {
    summaryText += ` · ${updatableCount} 台可更新`;
  }

  // 有未装 / 可更新的主机时「安装 Agent」是主操作，其余一律 ghost
  let installVariant: "primary" | "ghost" = "ghost";
  if (needInstallCount > 0) {
    installVariant = "primary";
  }

  return (
    <Page
      title={groupLabel}
      flush
      actions={
        <>
          {canEditGroup ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                disabled={boardBusy}
                onClick={() => void copyBoardLink()}
              >
                复制看板链接
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={boardBusy}
                onClick={() => void openBoardBrowser()}
              >
                浏览器打开
              </Button>
            </>
          ) : null}
          <Button
            variant={installVariant}
            size="sm"
            disabled={!hosts.length || batchBusy}
            onClick={() => setBatchConfirmOpen(true)}
            data-tip="为本组全部主机安装 Agent"
          >
            {batchBusy ? "安装中…" : "安装 Agent"}
          </Button>
          {hasCustomLayout ? (
            <Button variant="ghost" size="sm" onClick={resetLayout}>
              恢复默认列
            </Button>
          ) : null}
          {canEditGroup ? (
            <Button variant="ghost" size="sm" onClick={openGroupSettings}>
              分组设置
            </Button>
          ) : null}
        </>
      }
      onRefresh={() => void refreshAll()}
      refreshing={refreshing}
    >
      {/* 内容区四周 16px 安全边距：白色平面上直接放扁平表格 */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-4">
        <FlashNotices flash={boardFlash} />
        {!hosts.length ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 py-12 text-center">
            <Button variant="primary" onClick={openAddHost}>
              添加主机
            </Button>
          </div>
        ) : (
          <>
            <p className="m-0 text-xs text-muted">{summaryText}</p>
            <InteractiveDataTable
              columns={columns}
              data={sortedRows}
              columnOrder={columnOrder}
              columnWidths={columnWidths}
              sortKey={sort.key}
              sortOrder={sort.order}
              onColumnOrderChange={persistOrder}
              onColumnWidthsChange={persistWidths}
              onSortChange={persistSort}
              onRowDoubleClick={(row) => session.openHost(row.name)}
              getRowId={(row) => row.name}
            />
          </>
        )}
      </div>

      <Dialog open={batchConfirmOpen} onOpenChange={setBatchConfirmOpen}>
        <DialogContent className="w-[min(480px,calc(100%-32px))]">
          <DialogTitle>安装 Agent</DialogTitle>
          <DialogDescription className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted">
            {`将向本组全部 ${hosts.length} 台主机安装 spanel-agent（内置 v${latestAgentVersion || "?"}，历史数据保留）。其中 ${needInstallCount} 台未装或可更新${alreadyOkCount ? `，${alreadyOkCount} 台已是最新将跳过` : ""}。全部并行，可在进度窗口查看各主机状态。`}
          </DialogDescription>
          <DialogFooter>
            <Button onClick={() => setBatchConfirmOpen(false)}>取消</Button>
            <Button variant="primary" onClick={() => void runBatchInstall()}>
              开始
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={batchDialogOpen}
        onOpenChange={(open) => {
          if (!open && !batchBusy) {
            setBatchDialogOpen(false);
            setBatchRows([]);
            setBatchDone(false);
          }
        }}
      >
        <DialogContent
          className="w-[min(560px,calc(100%-32px))]"
          onEscapeKeyDown={(e) => {
            if (!batchDone) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (!batchDone) e.preventDefault();
          }}
        >
          <DialogTitle>安装 Agent</DialogTitle>
          {batchRows.length ? (
            <p className="mt-3 text-sm text-muted">
              {batchSummaryText}
            </p>
          ) : null}
          <div className="mt-3 flex max-h-[min(52vh,420px)] flex-col overflow-auto pr-0.5">
            {batchRows.map((r) => (
              <div
                key={r.host}
                className="flex items-start gap-4 border-b border-line py-3"
              >
                <div className="mt-0.5 w-5 shrink-0 text-center text-sm" aria-hidden="true">
                  {r.state === "running" ? "…" : r.state === "done" ? "✓" : r.state === "error" ? "✕" : "·"}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex min-w-0 items-start justify-between gap-4">
                    <span className="min-w-0 truncate font-semibold text-ink">{r.host}</span>
                    <span
                      className={
                        r.state === "error"
                          ? "max-w-[52%] shrink-0 text-right text-xs text-danger"
                          : r.state === "running" || r.state === "done"
                            ? "max-w-[52%] shrink-0 text-right text-xs text-accent"
                            : "max-w-[52%] shrink-0 text-right text-xs text-muted"
                      }
                    >
                      {batchRowLabel(r)}
                    </span>
                  </div>
                  {r.state === "running" && r.percent >= 0 ? (
                    <Meter value={r.percent} showValue={false} tone="ok" className="w-full" />
                  ) : null}
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            {!batchDone ? (
              <p className="m-0 mr-auto text-left text-sm text-muted">
                正在安装，请稍候…（全部主机并行）
              </p>
            ) : (
              <Button variant="primary" onClick={() => setBatchDialogOpen(false)}>
                完成
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              {settingsSaving ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
