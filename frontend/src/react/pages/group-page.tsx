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
import { api, type agentcli, type main, type monitor, type sshconfig } from "@/api";
import { BoardEmbed } from "@/react/components/board/board-embed";
import {
  InteractiveDataTable,
  type InteractiveColumn,
  type InteractiveSortOrder,
} from "@/react/components/data-table";
import { Button } from "@/react/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/react/components/ui/dialog";
import { Notice, Page } from "@/react/components/page";
import {
  updateSettings,
  useSettings,
  type AlertContentKind,
  type NotifyContentField,
} from "@/react/state/settings";
import { UNGROUPED_ID, useSession } from "@/react/state/session";
import {
  isCpuAlert,
  isDiskLow,
  isLoadAlert,
  isMemAlert,
  summarizeDisks,
  type ResourceAlertKind,
} from "@/utils/alerts";
import {
  buildBoardAppSubItems,
  type BoardHostCard,
  type BoardHostTrend,
} from "@/utils/boardModel";
import { formatErr, formatMemCapacity, isAgentMissing } from "@/utils/format";
import { sortRowsByGroupValue, type GroupSortValue } from "@/utils/groupTableState";

const VIEW_MODE_KEY = "1pannel-group-view-mode";
const COL_WIDTHS_KEY = "1pannel-group-col-widths-v4";
const COL_ORDER_KEY = "1pannel-group-col-order-v1";
const TABLE_SORT_KEY = "1pannel-group-table-sort-v1";

const POLL_MS = 3000;
const RANGE_POLL_MS = 30000;
const TREND_MAX_POINTS = 60;
const TREND_WINDOW_SEC = 3600;

const GROUP_NAME_RE = /^[0-9]{2}-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;

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
  load: 100,
  cpu: 100,
  mem: 100,
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
  load: 96,
  cpu: 100,
  mem: 100,
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
  cpuText: string;
  memText: string;
  diskText: string;
  loadPercent: number | null;
  cpuAlert: boolean;
  memAlert: boolean;
  diskAlert: boolean;
  loadAlert: boolean;
};

type HostSnap = {
  loading: boolean;
  overview?: monitor.Overview;
  disks?: monitor.DiskInfo[];
  error?: string;
  errorAt?: number;
  updatedAt?: number;
};

function readViewMode(): "table" | "board" {
  return localStorage.getItem(VIEW_MODE_KEY) === "board" ? "board" : "table";
}

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

function MetricBar({
  percent,
  text,
  alert,
}: {
  percent: number | null;
  text: string;
  alert: boolean;
}) {
  if (percent == null || text === "—") return text;
  const width = Math.max(0, Math.min(100, percent));
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <div className="h-1 w-full overflow-hidden rounded-full bg-[#e7edf3]">
        <div
          className={alert ? "h-full rounded-full bg-[#b3261e]" : "h-full rounded-full bg-accent"}
          style={{ width: `${width}%` }}
        />
      </div>
      <span
        className={
          alert
            ? "truncate text-xs font-semibold tabular-nums text-[#b3261e]"
            : "truncate text-xs font-semibold tabular-nums"
        }
      >
        {text}
      </span>
    </div>
  );
}

function osVersion(osRelease: string): string {
  const text = (osRelease || "").trim();
  if (!text) return "";
  const matched = text.match(/\bv?\d+(?:\.\d+)+(?:\.\d+)?(?:\s+LTS)?\b/i);
  if (matched) return matched[0].replace(/^v/i, "");
  return text;
}

function errTimeSuffix(at?: number): string {
  if (!at) return "";
  const d = new Date(at);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `（${hh}:${mm}）`;
}

function emptyTrend(): BoardHostTrend {
  return { cpu: [], mem: [] };
}

/** 点数过多时均匀抽稀到约 maxN */
function downsample(values: number[], maxN: number): number[] {
  if (values.length <= maxN) return values;
  if (maxN < 2) return values.slice(0, maxN);
  const out: number[] = [];
  const last = values.length - 1;
  for (let i = 0; i < maxN; i++) {
    out.push(values[Math.round((i / (maxN - 1)) * last)]);
  }
  return out;
}

function hasAppNotifyConfig(
  hostAppNotifySubs: Record<string, string[]>,
  host: string,
): boolean {
  const name = (host || "").trim();
  if (!name) return false;
  return Object.prototype.hasOwnProperty.call(hostAppNotifySubs, name);
}

function normalizeStringMap(
  raw: { [_ in string]?: string[] | null } | null | undefined,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!raw) return out;
  for (const [k, v] of Object.entries(raw)) {
    out[k] = Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
  }
  return out;
}

function normalizeBoolMap(
  raw: { [_ in string]?: boolean } | null | undefined,
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (!raw) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (v === true) out[k] = true;
  }
  return out;
}

async function hydrateNotifySubsFromDisk() {
  try {
    const d = await api.getNotifySubs();
    if (!d.fromDisk) return;
    const patch: Parameters<typeof updateSettings>[0] = {
      notifyEnabled: !!d.notifyEnabled,
      wecomWebhook: typeof d.wecomWebhook === "string" ? d.wecomWebhook : "",
      systemNotifyEnabled: d.systemNotifyEnabled !== false,
      inAppNotifyEnabled: d.inAppNotifyEnabled !== false,
      notifyRecoverEnabled: d.notifyRecoverEnabled !== false,
      hostAppNotifySubs: normalizeStringMap(d.hostAppNotifySubs),
      hostCertNotifySubs: normalizeBoolMap(d.hostCertNotifySubs),
    };
    if (Array.isArray(d.alertContentKinds)) {
      patch.alertContentKinds = d.alertContentKinds as AlertContentKind[];
    }
    if (Array.isArray(d.notifyContentFields)) {
      patch.notifyContentFields = d.notifyContentFields as NotifyContentField[];
    }
    if (d.hostResourceNotifySubs) {
      const res: Record<string, ResourceAlertKind[]> = {};
      for (const [k, v] of Object.entries(d.hostResourceNotifySubs)) {
        res[k] = Array.isArray(v) ? (v as ResourceAlertKind[]) : [];
      }
      patch.hostResourceNotifySubs = res;
    }
    updateSettings(patch);
  } catch {
    /* 磁盘订阅读失败时沿用 localStorage */
  }
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

const INPUT_CLASS =
  "h-9 w-full rounded-[4px] border border-[#DFE3E8] bg-white px-3 text-sm text-[#20252B] outline-none focus:border-[#005EEB]";

export function GroupPage() {
  const session = useSession();
  const settings = useSettings();
  const groupId = session.activeGroupId || UNGROUPED_ID;
  const canEditGroup = groupId !== UNGROUPED_ID;
  const groupLabel = session.groupName(groupId);
  const hosts = session.hostsOf(groupId);
  /** 稳定键：避免 hosts 数组每帧新引用导致看板 effect 空转 */
  const hostNamesKey = useMemo(
    () => hosts.map((h) => h.name).join("\0"),
    [hosts],
  );
  const boardTitle = useMemo(() => {
    if (!canEditGroup) return "";
    const g = session.groups.find((item) => item.id === groupId);
    return (g?.boardTitle || "").trim();
  }, [canEditGroup, groupId, session.groups]);

  const [mode, setMode] = useState<"table" | "board">(readViewMode);
  const [columnOrder, setColumnOrder] = useState<GroupColumnKey[]>(readColumnOrder);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(readColWidths);
  const [sort, setSort] = useState(readTableSort);
  const [refreshing, setRefreshing] = useState(false);
  const [boardOpening, setBoardOpening] = useState(false);

  // ---------- Agent 状态（表格徽章） ----------
  const [agentStatuses, setAgentStatuses] = useState<Record<string, agentcli.Status>>({});
  const [latestAgentVersion, setLatestAgentVersion] = useState("");
  const latestAgentVersionRef = useRef("");
  latestAgentVersionRef.current = latestAgentVersion;

  // ---------- 看板采集 ----------
  const [hostStates, setHostStates] = useState<Record<string, HostSnap>>({});
  const [trends, setTrends] = useState<Record<string, BoardHostTrend>>({});
  const [instanceCounts, setInstanceCounts] = useState<Record<string, Record<string, number>>>({});
  const [instanceCountsKnown, setInstanceCountsKnown] = useState<Record<string, boolean>>({});
  const [instanceLoading, setInstanceLoading] = useState<Record<string, boolean>>({});

  const aliveRef = useRef(true);
  const groupIdRef = useRef(groupId);
  const modeRef = useRef(mode);
  const hostsRef = useRef(hosts);
  const hostStatesRef = useRef(hostStates);
  const settingsRef = useRef(settings);
  const inFlight = useRef(new Set<string>());
  const rangeInFlight = useRef(new Set<string>());
  const instInFlight = useRef(new Set<string>());

  groupIdRef.current = groupId;
  modeRef.current = mode;
  hostsRef.current = hosts;
  hostStatesRef.current = hostStates;
  settingsRef.current = settings;

  // ---------- 批量安装 ----------
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [batchDone, setBatchDone] = useState(false);
  const [batchRows, setBatchRows] = useState<BatchRow[]>([]);
  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false);
  const batchRowsRef = useRef(batchRows);
  batchRowsRef.current = batchRows;

  // ---------- 分组设置 ----------
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsName, setSettingsName] = useState("");
  const [settingsBoardTitle, setSettingsBoardTitle] = useState("");
  const [settingsError, setSettingsError] = useState("");

  // ---------- 添加主机 ----------
  const [addHostOpen, setAddHostOpen] = useState(false);
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState("");
  const [addForm, setAddForm] = useState({
    name: "",
    hostName: "",
    user: "root",
    password: "",
    note: "",
  });

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

  const loadRange = useCallback(async (name: string) => {
    if (modeRef.current !== "board") return;
    if (rangeInFlight.current.has(name) || groupIdRef.current !== groupId) return;
    rangeInFlight.current.add(name);
    try {
      const now = Math.floor(Date.now() / 1000);
      const result = await api.agentRange(name, now - TREND_WINDOW_SEC, now, "auto");
      if (!aliveRef.current || groupIdRef.current !== groupId) return;
      const points = result.points || [];
      const memTotal = hostStatesRef.current[name]?.overview?.memTotal || 0;
      const cpuRaw: number[] = [];
      const memRaw: number[] = [];
      for (const point of points) {
        cpuRaw.push(Number(point.cpuPercent) || 0);
        if (memTotal > 0) {
          memRaw.push(((Number(point.memUsed) || 0) / memTotal) * 100);
        }
      }
      setTrends((prev) => ({
        ...prev,
        [name]: {
          cpu: downsample(cpuRaw, TREND_MAX_POINTS),
          mem: memTotal > 0 ? downsample(memRaw, TREND_MAX_POINTS) : [],
        },
      }));
    } catch {
      if (aliveRef.current) {
        setTrends((prev) => ({ ...prev, [name]: emptyTrend() }));
      }
    } finally {
      rangeInFlight.current.delete(name);
    }
  }, [groupId]);

  const loadInstances = useCallback(async (name: string) => {
    if (modeRef.current !== "board") return;
    if (!hasAppNotifyConfig(settingsRef.current.hostAppNotifySubs, name)) return;
    if (instInFlight.current.has(name) || groupIdRef.current !== groupId) return;
    const prev = hostStatesRef.current[name];
    if (prev?.error && isAgentMissing(prev.error)) return;
    instInFlight.current.add(name);
    setInstanceLoading((m) => ({ ...m, [name]: true }));
    try {
      const rows = await api.agentWatchInstances(name);
      if (!aliveRef.current || groupIdRef.current !== groupId) return;
      const counts: Record<string, number> = {};
      for (const row of rows || []) {
        const service = (row.service || "").trim();
        if (!service) continue;
        counts[service] = (counts[service] || 0) + 1;
      }
      setInstanceCounts((m) => ({ ...m, [name]: counts }));
      setInstanceCountsKnown((m) => ({ ...m, [name]: true }));
    } catch {
      /* 保留上次成功计数 */
    } finally {
      instInFlight.current.delete(name);
      setInstanceLoading((m) => ({ ...m, [name]: false }));
    }
  }, [groupId]);

  const loadOne = useCallback(
    async (name: string, showSkeleton: boolean, force = false) => {
      if (inFlight.current.has(name) || groupIdRef.current !== groupId) return;
      const prev = hostStatesRef.current[name];
      if (!force && prev?.error && isAgentMissing(prev.error)) return;
      inFlight.current.add(name);
      if (showSkeleton) {
        setHostStates((m) => ({ ...m, [name]: { loading: true } }));
      }
      try {
        const ov = await api.collectOverview(name);
        let disks: monitor.DiskInfo[] = [];
        try {
          disks = (await api.collectDisks(name)) || [];
        } catch {
          disks = [];
        }
        if (!aliveRef.current || groupIdRef.current !== groupId) return;
        setHostStates((m) => ({
          ...m,
          [name]: {
            loading: false,
            overview: ov,
            disks,
            updatedAt: Date.now(),
          },
        }));
        if (modeRef.current === "board") void loadRange(name);
      } catch (e) {
        if (!aliveRef.current || groupIdRef.current !== groupId) return;
        setHostStates((m) => ({
          ...m,
          [name]: {
            loading: false,
            error: formatErr(e),
            errorAt: Date.now(),
          },
        }));
      } finally {
        inFlight.current.delete(name);
      }
    },
    [groupId, loadRange],
  );

  // 切组 / 主机列表变化：重置看板状态并补采集
  useEffect(() => {
    aliveRef.current = true;
    const list = hostsRef.current;
    setHostStates((prev) => {
      const fresh: Record<string, HostSnap> = {};
      for (const h of list) {
        fresh[h.name] = prev[h.name] ?? { loading: true };
      }
      return fresh;
    });
    setTrends((prev) => {
      const fresh: Record<string, BoardHostTrend> = {};
      for (const h of list) {
        fresh[h.name] = prev[h.name] ?? emptyTrend();
      }
      return fresh;
    });
    void loadAgentStatuses();
    if (mode === "board") {
      void hydrateNotifySubsFromDisk();
      for (const h of list) {
        const had = hostStatesRef.current[h.name]?.overview;
        void loadOne(h.name, !had);
        void loadRange(h.name);
        void loadInstances(h.name);
      }
    }
  }, [groupId, hostNamesKey, mode, loadAgentStatuses, loadOne, loadRange, loadInstances]);

  // 看板轮询
  useEffect(() => {
    if (mode !== "board") return;
    const poll = setInterval(() => {
      if (!aliveRef.current) return;
      for (const h of hostsRef.current) {
        void loadOne(h.name, false);
        void loadInstances(h.name);
      }
    }, POLL_MS);
    const range = setInterval(() => {
      if (!aliveRef.current) return;
      void hydrateNotifySubsFromDisk();
      for (const h of hostsRef.current) {
        void loadRange(h.name);
      }
    }, RANGE_POLL_MS);
    return () => {
      clearInterval(poll);
      clearInterval(range);
    };
  }, [mode, loadOne, loadRange, loadInstances]);

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
          cpuText: ov ? `${ov.cpuPercent.toFixed(1)}%` : "—",
          memText: ov ? `${ov.memPercent.toFixed(1)}%` : "—",
          diskText: diskSum ? `${diskSum.percent.toFixed(1)}%` : "—",
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

  const showBatchInTable = batchBusy || batchDialogOpen;

  const columns: InteractiveColumn<GroupRow>[] = useMemo(
    () =>
      GROUP_COL_KEYS.map((key) => ({
        key,
        label: GROUP_COL_LABELS[key],
        width: GROUP_DEFAULT_W[key],
        minWidth: GROUP_MIN_W[key],
        sortable: key !== "index",
        align: key === "index" || key === "load" ? "center" : "left",
        wrap: key === "load" || key === "cpu" || key === "mem" || key === "disk",
        render: (row, index) => {
          if (key === "index") return index + 1;
          if (key === "host") return row.name;
          if (key === "addr") return row.hostName || "—";
          if (key === "agent") {
            const progress = showBatchInTable ? batchRowMap.get(row.name) : undefined;
            if (progress) {
              return (
                <div className="flex min-w-0 flex-col gap-1">
                  <span
                    className={
                      progress.state === "error"
                        ? "truncate text-xs text-[#b3261e]"
                        : progress.state === "running" || progress.state === "done"
                          ? "truncate text-xs text-accent"
                          : "truncate text-xs text-muted"
                    }
                  >
                    {batchRowLabel(progress)}
                  </span>
                  {progress.state === "running" && progress.percent >= 0 ? (
                    <div className="h-1 w-full overflow-hidden rounded-full bg-[#e7edf3]">
                      <div
                        className="h-full bg-accent transition-[width]"
                        style={{ width: `${Math.min(100, progress.percent)}%` }}
                      />
                    </div>
                  ) : null}
                </div>
              );
            }
            const tag = agentTagOf(agentStatuses[row.name], latestAgentVersion);
            let chip =
              "inline-flex max-w-full truncate rounded-full px-2 py-0.5 text-xs font-medium";
            if (tag.tone === "ok") chip += " bg-[#e8f5e9] text-[#1b5e20]";
            else if (tag.tone === "warn") chip += " bg-[#fff8e1] text-[#e65100]";
            else chip += " bg-[#f0f2f5] text-[#687382]";
            return <span className={chip}>{tag.text}</span>;
          }
          if (key === "user") return row.user || "—";
          if (key === "version") return row.version;
          if (key === "spec") return row.spec;
          if (key === "load") {
            return <MetricBar percent={row.loadPercent} text={row.loadText} alert={row.loadAlert} />;
          }
          if (key === "cpu") {
            return <MetricBar percent={row.cpu} text={row.cpuText} alert={row.cpuAlert} />;
          }
          if (key === "mem") {
            return <MetricBar percent={row.mem} text={row.memText} alert={row.memAlert} />;
          }
          if (key === "disk") {
            return <MetricBar percent={row.disk} text={row.diskText} alert={row.diskAlert} />;
          }
          return "—";
        },
      })),
    [agentStatuses, batchRowMap, latestAgentVersion, showBatchInTable],
  );

  const boardCards = useMemo(() => {
    const out: Record<string, BoardHostCard> = {};
    for (const h of hosts) {
      const s = hostStates[h.name] || { loading: true };
      const configured = hasAppNotifyConfig(settings.hostAppNotifySubs, h.name);
      const subs = configured ? settings.hostAppNotifySubs[h.name] || [] : null;
      out[h.name] = {
        loading: s.loading,
        overview: s.overview,
        disks: s.disks,
        error: s.error ? s.error + errTimeSuffix(s.errorAt) : undefined,
        appSubItems: configured
          ? buildBoardAppSubItems(
              subs,
              instanceCounts[h.name],
              instanceCountsKnown[h.name] === true,
            )
          : null,
        appSubLoading: configured && instanceLoading[h.name] === true,
        updatedAt: s.updatedAt,
      };
    }
    return out;
  }, [
    hosts,
    hostStates,
    settings.hostAppNotifySubs,
    instanceCounts,
    instanceCountsKnown,
    instanceLoading,
  ]);

  function choose(next: "table" | "board") {
    setMode(next);
    localStorage.setItem(VIEW_MODE_KEY, next);
  }

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
      if (mode === "board") {
        await Promise.allSettled(hosts.map((h) => loadOne(h.name, false, true)));
        for (const h of hosts) {
          void loadInstances(h.name);
          void loadRange(h.name);
        }
      }
    } finally {
      setRefreshing(false);
    }
  }

  async function openBoardWindow() {
    setBoardOpening(true);
    try {
      await api.openBoardWindow(groupId);
    } catch (err) {
      console.error(formatErr(err));
    } finally {
      setBoardOpening(false);
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
      setSettingsError("只允许英文字母、数字和短横线，例如 01-cdcp-main");
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
    setAddForm({ name: "", hostName: "", user: "root", password: "", note: "" });
    setAddError("");
    setAddHostOpen(true);
  }

  async function saveAddHost() {
    const name = addForm.name.trim();
    const hostName = addForm.hostName.trim();
    const user = addForm.user.trim();
    if (!name || !hostName || !user || !addForm.password) {
      setAddError("别名、地址、用户、密码均不能为空");
      return;
    }
    setAddSaving(true);
    setAddError("");
    try {
      await api.addHost({
        name,
        hostName,
        user,
        password: addForm.password,
        note: addForm.note.trim(),
      });
      if (canEditGroup) {
        await api.assignHost(name, groupId);
      }
      setAddHostOpen(false);
      await session.refresh();
    } catch (err) {
      setAddError(formatErr(err));
    } finally {
      setAddSaving(false);
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

  function resumeHostAfterAgentReady(name: string) {
    setHostStates((prev) => {
      const cur = prev[name];
      if (cur?.error && isAgentMissing(cur.error)) {
        return { ...prev, [name]: { loading: false } };
      }
      if (cur?.error) {
        return {
          ...prev,
          [name]: { ...cur, error: undefined, errorAt: undefined },
        };
      }
      return prev;
    });
    void loadOne(name, false, true);
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
      for (const r of results) {
        if (r.ok) resumeHostAfterAgentReady(r.host);
      }
      for (const name of alreadyOk) resumeHostAfterAgentReady(name);
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

  return (
    <Page
      title={groupLabel}
      dark={mode === "board" && hosts.length > 0}
      actions={
        <>
          <Button variant={mode === "table" ? "primary" : "secondary"} onClick={() => choose("table")}>
            表格
          </Button>
          <Button variant={mode === "board" ? "primary" : "secondary"} onClick={() => choose("board")}>
            看板
          </Button>
          <Button disabled={boardOpening} onClick={() => void openBoardWindow()}>
            {boardOpening ? "打开中…" : "弹出看板"}
          </Button>
          <Button
            disabled={!hosts.length || batchBusy}
            onClick={() => setBatchConfirmOpen(true)}
            title="为本组全部主机安装 Agent"
          >
            {batchBusy ? "安装中…" : "安装 Agent"}
          </Button>
          <Button disabled={refreshing} onClick={() => void refreshAll()}>
            {refreshing ? "刷新中…" : "刷新"}
          </Button>
          {mode === "table" && hasCustomLayout ? (
            <Button onClick={resetLayout}>恢复默认列</Button>
          ) : null}
          {canEditGroup ? (
            <Button onClick={openGroupSettings} title="分组设置">
              分组设置
            </Button>
          ) : null}
          <Button variant="primary" onClick={openAddHost}>
            添加主机
          </Button>
        </>
      }
    >
      {!hosts.length ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
          <p className="m-0 text-lg font-semibold text-ink">拖主机进来</p>
          <p className="m-0 mb-2 max-w-sm text-sm leading-relaxed text-muted">
            从侧栏或其它分组把主机拖到本页，或点击下方添加
          </p>
          <Button variant="primary" onClick={openAddHost}>
            添加主机
          </Button>
        </div>
      ) : mode === "table" ? (
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
          onRowDoubleClick={(row) => session.openHost(row.name, "overview")}
          getRowId={(row) => row.name}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <BoardEmbed
            hosts={hosts}
            cards={boardCards}
            trends={trends}
            onOpenHost={(name) => session.openHost(name, "overview")}
          />
        </div>
      )}

      {/* 批量安装确认 */}
      <Dialog open={batchConfirmOpen} onOpenChange={setBatchConfirmOpen}>
        <DialogContent className="w-[min(480px,calc(100%-32px))]">
          <DialogTitle>安装 Agent</DialogTitle>
          <DialogDescription className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted">
            {`将向本组全部 ${hosts.length} 台主机安装 spanel-agent（内置 v${latestAgentVersion || "?"}，历史数据保留）。其中 ${needInstallCount} 台未装或可更新${alreadyOkCount ? `，${alreadyOkCount} 台已是最新将跳过` : ""}。全部并行，可在进度窗口查看各主机状态。`}
          </DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <Button onClick={() => setBatchConfirmOpen(false)}>取消</Button>
            <Button variant="primary" onClick={() => void runBatchInstall()}>
              开始
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 批量安装进度 */}
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
            <p className="mt-3 rounded-control bg-[#f0f2f5] px-3.5 py-2.5 text-sm text-muted">
              {batchSummaryText}
            </p>
          ) : null}
          <div className="mt-3 flex max-h-[min(52vh,420px)] flex-col gap-2 overflow-auto pr-0.5">
            {batchRows.map((r) => (
              <div
                key={r.host}
                className={
                  r.state === "error"
                    ? "flex items-start gap-3 rounded-control bg-[#fef0f0] px-3.5 py-3"
                    : r.state === "running"
                      ? "flex items-start gap-3 rounded-control bg-[#eef5ff] px-3.5 py-3"
                      : "flex items-start gap-3 rounded-control bg-[#f7f8fa] px-3.5 py-3"
                }
              >
                <div className="mt-0.5 w-5 shrink-0 text-center text-sm" aria-hidden="true">
                  {r.state === "running" ? "…" : r.state === "done" ? "✓" : r.state === "error" ? "✕" : "·"}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <span className="min-w-0 truncate font-medium text-ink">{r.host}</span>
                    <span
                      className={
                        r.state === "error"
                          ? "max-w-[52%] shrink-0 text-right text-xs text-[#b3261e]"
                          : r.state === "running" || r.state === "done"
                            ? "max-w-[52%] shrink-0 text-right text-xs text-accent"
                            : "max-w-[52%] shrink-0 text-right text-xs text-muted"
                      }
                    >
                      {batchRowLabel(r)}
                    </span>
                  </div>
                  {r.state === "running" && r.percent >= 0 ? (
                    <div className="h-1 w-full overflow-hidden rounded-full bg-[#e7edf3]">
                      <div
                        className="h-full bg-accent transition-[width]"
                        style={{ width: `${Math.min(100, r.percent)}%` }}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 flex items-center justify-end gap-3">
            {!batchDone ? (
              <p className="m-0 flex-1 text-left text-sm text-muted">
                正在安装，请稍候…（全部主机并行）
              </p>
            ) : (
              <Button variant="primary" onClick={() => setBatchDialogOpen(false)}>
                完成
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* 分组设置 */}
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
              <span className="mt-1 block text-xs text-muted">
                只允许英文字母、数字和短横线，例如 01-cdcp-main
              </span>
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
          <div className="mt-5 flex justify-end gap-2">
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
          </div>
        </DialogContent>
      </Dialog>

      {/* 添加主机 */}
      <Dialog open={addHostOpen} onOpenChange={setAddHostOpen}>
        <DialogContent>
          <DialogTitle>添加主机</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted">
            {canEditGroup ? `将加入分组「${groupLabel}」` : "将加入未分组"}
          </DialogDescription>
          {addError ? (
            <div className="mt-3">
              <Notice text={addError} />
            </div>
          ) : null}
          <div className="mt-4 flex flex-col gap-3">
            <input
              className={INPUT_CLASS}
              placeholder="别名"
              value={addForm.name}
              onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
            />
            <input
              className={INPUT_CLASS}
              placeholder="地址（IP / 域名）"
              value={addForm.hostName}
              onChange={(e) => setAddForm((f) => ({ ...f, hostName: e.target.value }))}
            />
            <input
              className={INPUT_CLASS}
              placeholder="用户"
              value={addForm.user}
              onChange={(e) => setAddForm((f) => ({ ...f, user: e.target.value }))}
            />
            <input
              className={INPUT_CLASS}
              placeholder="密码"
              type="password"
              value={addForm.password}
              onChange={(e) => setAddForm((f) => ({ ...f, password: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveAddHost();
              }}
            />
            <textarea
              className="min-h-[72px] w-full resize-y rounded-[4px] border border-[#DFE3E8] bg-white px-3 py-2 text-sm outline-none focus:border-[#005EEB]"
              placeholder="备注（可选）"
              value={addForm.note}
              onChange={(e) => setAddForm((f) => ({ ...f, note: e.target.value }))}
            />
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button disabled={addSaving} onClick={() => setAddHostOpen(false)}>
              取消
            </Button>
            <Button variant="primary" disabled={addSaving} onClick={() => void saveAddHost()}>
              {addSaving ? "连接中…" : "保存"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
