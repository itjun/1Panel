import { Events, Window } from "@wailsio/runtime";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { api, type monitor, type sshconfig } from "@/api";
import { BoardSummaryStrip } from "@/react/components/board/board-summary-strip";
import { HostBoardCard } from "@/react/components/board/host-board-card";
import "@/react/components/board/board.css";
import { UNGROUPED_ID } from "@/react/state/session";
import {
  updateSettings,
  useSettings,
  type AlertContentKind,
  type NotifyContentField,
} from "@/react/state/settings";
import { type ResourceAlertKind } from "@/utils/alerts";
import { formatErr, isAgentMissing } from "@/utils/format";
import {
  boardDensityOf,
  buildBoardAppSubItems,
  pickBoardGrid,
  summarizeBoardCards,
  type BoardHostCard,
  type BoardHostTrend,
} from "@/utils/boardModel";

const POLL_MS = 3000;
/** 近 1h 趋势与 overview 分开轮询，避免堵瞬时采集 */
const RANGE_POLL_MS = 30000;
const TREND_MAX_POINTS = 60;
const TREND_WINDOW_SEC = 3600;

type HostSnap = {
  loading: boolean;
  overview?: monitor.Overview;
  disks?: monitor.DiskInfo[];
  error?: string;
  errorAt?: number;
  updatedAt?: number;
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatBoardClock(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  );
}

function formatLastUpdate(ms?: number): string {
  if (!ms) return "等待数据";
  const d = new Date(ms);
  return `数据更新 ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function errTimeSuffix(at?: number): string {
  if (!at) return "";
  const d = new Date(at);
  return `（${pad2(d.getHours())}:${pad2(d.getMinutes())}）`;
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
    const idx = Math.round((i / (maxN - 1)) * last);
    out.push(values[idx]);
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

export function BoardPage({ groupId }: { groupId: string }) {
  const gid = (groupId || "").trim() || UNGROUPED_ID;
  const settings = useSettings();

  const [groupName, setGroupName] = useState("分组");
  const [boardTitle, setBoardTitle] = useState("");
  const [hosts, setHosts] = useState<sshconfig.HostConfig[]>([]);
  const [hostStates, setHostStates] = useState<Record<string, HostSnap>>({});
  const [trends, setTrends] = useState<Record<string, BoardHostTrend>>({});
  const [instanceCounts, setInstanceCounts] = useState<
    Record<string, Record<string, number>>
  >({});
  const [instanceCountsKnown, setInstanceCountsKnown] = useState<
    Record<string, boolean>
  >({});
  const [instanceLoading, setInstanceLoading] = useState<Record<string, boolean>>(
    {},
  );

  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  const gridRef = useRef<HTMLElement | null>(null);
  const hostsRef = useRef(hosts);
  const hostStatesRef = useRef(hostStates);
  const trendsRef = useRef(trends);
  const settingsRef = useRef(settings);
  const aliveRef = useRef(true);
  const inFlight = useRef(new Set<string>());
  const rangeInFlight = useRef(new Set<string>());
  const instInFlight = useRef(new Set<string>());

  hostsRef.current = hosts;
  hostStatesRef.current = hostStates;
  trendsRef.current = trends;
  settingsRef.current = settings;

  const loadInstances = useCallback(async (name: string) => {
    if (!hasAppNotifyConfig(settingsRef.current.hostAppNotifySubs, name)) return;
    if (instInFlight.current.has(name) || !aliveRef.current) return;
    const prev = hostStatesRef.current[name];
    if (prev?.error && isAgentMissing(prev.error)) return;
    instInFlight.current.add(name);
    setInstanceLoading((m) => ({ ...m, [name]: true }));
    try {
      const rows = await api.agentWatchInstances(name);
      if (!aliveRef.current) return;
      const counts: Record<string, number> = {};
      for (const r of rows || []) {
        const svc = (r.service || "").trim();
        if (!svc) continue;
        counts[svc] = (counts[svc] || 0) + 1;
      }
      setInstanceCounts((m) => ({ ...m, [name]: counts }));
      setInstanceCountsKnown((m) => ({ ...m, [name]: true }));
    } catch {
      /* 探活失败时保留上次计数，避免闪空 */
    } finally {
      instInFlight.current.delete(name);
      setInstanceLoading((m) => ({ ...m, [name]: false }));
    }
  }, []);

  const loadRange = useCallback(async (name: string) => {
    if (rangeInFlight.current.has(name) || !aliveRef.current) return;
    rangeInFlight.current.add(name);
    try {
      const now = Math.floor(Date.now() / 1000);
      const r = await api.agentRange(name, now - TREND_WINDOW_SEC, now, "auto");
      if (!aliveRef.current) return;
      const pts = r.points || [];
      const memTotal = hostStatesRef.current[name]?.overview?.memTotal || 0;
      const cpuRaw: number[] = [];
      const memRaw: number[] = [];
      for (const p of pts) {
        cpuRaw.push(Number(p.cpuPercent) || 0);
        if (memTotal > 0) {
          memRaw.push(((Number(p.memUsed) || 0) / memTotal) * 100);
        }
      }
      setTrends((m) => ({
        ...m,
        [name]: {
          cpu: downsample(cpuRaw, TREND_MAX_POINTS),
          mem: memTotal > 0 ? downsample(memRaw, TREND_MAX_POINTS) : [],
        },
      }));
    } catch {
      if (!aliveRef.current) return;
      setTrends((m) => ({ ...m, [name]: emptyTrend() }));
    } finally {
      rangeInFlight.current.delete(name);
    }
  }, []);

  const loadOne = useCallback(
    async (name: string, showSkeleton: boolean, force = false) => {
      if (inFlight.current.has(name) || !aliveRef.current) return;
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
        if (!aliveRef.current) return;
        setHostStates((m) => ({
          ...m,
          [name]: {
            loading: false,
            overview: ov,
            disks,
            updatedAt: Date.now(),
          },
        }));
        const t = trendsRef.current[name];
        if (ov.memTotal > 0 && t && t.cpu.length > 0 && t.mem.length === 0) {
          void loadRange(name);
        }
      } catch (e) {
        if (!aliveRef.current) return;
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
    [loadRange],
  );

  const loadMeta = useCallback(async () => {
    const [allHosts, groups] = await Promise.all([
      api.listHosts(),
      api.listGroups(),
    ]);
    if (!aliveRef.current) return;

    let nextHosts: sshconfig.HostConfig[];
    let nextGroupName: string;
    let nextBoardTitle: string;

    if (gid === UNGROUPED_ID) {
      const assigned = new Set<string>();
      for (const g of groups) {
        for (const name of g.hosts || []) assigned.add(name);
      }
      nextHosts = allHosts.filter((h) => !assigned.has(h.name));
      nextGroupName = "未分组";
      nextBoardTitle = "";
    } else {
      const g = groups.find((x) => x.id === gid);
      nextGroupName = g?.name || "分组";
      nextBoardTitle = (g?.boardTitle || "").trim();
      const names = new Set(g?.hosts || []);
      nextHosts = allHosts.filter((h) => names.has(h.name));
    }

    setGroupName(nextGroupName);
    setBoardTitle(nextBoardTitle);
    setHosts(nextHosts);

    try {
      await Window.SetTitle(`看板 · ${nextGroupName}`);
    } catch {
      /* 忽略：标题已在创建窗时设过 */
    }

    setHostStates((prev) => {
      const fresh: Record<string, HostSnap> = {};
      for (const h of nextHosts) {
        fresh[h.name] = prev[h.name] ?? { loading: true };
      }
      return fresh;
    });
    setTrends((prev) => {
      const fresh: Record<string, BoardHostTrend> = {};
      for (const h of nextHosts) {
        fresh[h.name] = prev[h.name] ?? emptyTrend();
      }
      return fresh;
    });

    for (const h of nextHosts) {
      const had = hostStatesRef.current[h.name]?.overview;
      void loadOne(h.name, !had);
      void loadRange(h.name);
      void loadInstances(h.name);
    }
  }, [gid, loadOne, loadRange, loadInstances]);

  useEffect(() => {
    aliveRef.current = true;
    void hydrateNotifySubsFromDisk().then(() => {
      void loadMeta();
    });

    const pollTimer = setInterval(() => {
      if (!aliveRef.current) return;
      for (const h of hostsRef.current) {
        void loadOne(h.name, false);
        void loadInstances(h.name);
      }
    }, POLL_MS);

    const rangeTimer = setInterval(() => {
      if (!aliveRef.current) return;
      void hydrateNotifySubsFromDisk();
      for (const h of hostsRef.current) {
        void loadRange(h.name);
      }
    }, RANGE_POLL_MS);

    return () => {
      aliveRef.current = false;
      clearInterval(pollTimer);
      clearInterval(rangeTimer);
    };
  }, [loadMeta, loadOne, loadRange, loadInstances]);

  useEffect(() => {
    const clock = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(clock);
  }, []);

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setViewport({
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hosts.length]);

  const toggleFullscreen = useCallback(async () => {
    try {
      const fs = await Window.IsFullscreen();
      if (fs) {
        await Window.UnFullscreen();
        setIsFullscreen(false);
      } else {
        await Window.Fullscreen();
        setIsFullscreen(true);
      }
    } catch {
      /* 忽略 */
    }
  }, []);

  useEffect(() => {
    void Window.IsFullscreen()
      .then((fs) => {
        if (aliveRef.current) setIsFullscreen(fs);
      })
      .catch(() => {});

    const offs = [
      Events.On("common:WindowFullscreen", () => setIsFullscreen(true)),
      Events.On("common:WindowUnFullscreen", () => setIsFullscreen(false)),
    ];

    function onKeydown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        void api.closeBoardWindow(gid).catch(async () => {
          try {
            await Window.Close();
          } catch {
            /* 忽略 */
          }
        });
        return;
      }
      if (e.key === "f" || e.key === "F" || e.key === "F11") {
        e.preventDefault();
        void toggleFullscreen();
      }
    }
    window.addEventListener("keydown", onKeydown);
    return () => {
      offs.forEach((off) => off());
      window.removeEventListener("keydown", onKeydown);
    };
  }, [gid, toggleFullscreen]);

  function onOpenHost(name: string) {
    void Events.Emit("board-open-host", { name });
  }

  const cards = useMemo(() => {
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

  const summary = useMemo(
    () => summarizeBoardCards(cards, nowMs),
    [cards, nowMs],
  );

  const latestUpdate = useMemo(() => {
    let latest = 0;
    for (const card of Object.values(cards)) {
      latest = Math.max(latest, card.updatedAt || 0);
    }
    return latest;
  }, [cards]);

  const gridShape = useMemo(
    () => pickBoardGrid(hosts.length, viewport.width, viewport.height),
    [hosts.length, viewport.width, viewport.height],
  );
  const cardDensity = boardDensityOf(gridShape);

  return (
    <div className="board-mode" role="dialog" aria-modal="true" aria-label="看板模式">
      <header className="board-mode__bar drag-region">
        <div className="board-mode__identity">
          <span className="board-mode__live-mark" aria-hidden="true" />
          <div className="board-mode__titles">
            <div className="board-mode__group-line">
              <span className="board-mode__group">{groupName || "分组"}</span>
              <span className="board-mode__count">{hosts.length} 台主机</span>
            </div>
            <span className="board-mode__mode">实时运维监控</span>
          </div>
        </div>

        <div className="board-mode__center">
          {boardTitle ? (
            <span className="board-mode__board-title">{boardTitle}</span>
          ) : (
            <span className="board-mode__board-title board-mode__board-title--fallback">
              运维监控看板
            </span>
          )}
        </div>

        <div className="board-mode__right">
          <span className="board-mode__last-update">
            {formatLastUpdate(latestUpdate || undefined)}
          </span>
          <button
            type="button"
            className="board-mode__fs-btn no-drag"
            onClick={() => void toggleFullscreen()}
          >
            {isFullscreen ? "退出全屏" : "全屏"}
          </button>
          <time className="board-mode__clock" dateTime={new Date(nowMs).toISOString()}>
            {formatBoardClock(nowMs)}
          </time>
        </div>
      </header>

      <BoardSummaryStrip summary={summary} />

      <main
        ref={gridRef}
        className="board-mode__grid"
        style={
          {
            "--board-cols": String(gridShape.cols),
            "--board-rows": String(gridShape.rows),
          } as CSSProperties
        }
      >
        {hosts.length ? (
          hosts.map((h) => {
            const card = cards[h.name] || { loading: true };
            const trend = trends[h.name] || emptyTrend();
            return (
              <HostBoardCard
                key={h.name}
                name={h.name}
                address={h.hostName || ""}
                loading={card.loading}
                overview={card.overview}
                disks={card.disks}
                error={card.error}
                cpuTrend={trend.cpu}
                memTrend={trend.mem}
                appSubItems={card.appSubItems}
                appSubLoading={card.appSubLoading}
                updatedAt={card.updatedAt}
                density={cardDensity}
                onOpen={onOpenHost}
              />
            );
          })
        ) : (
          <div className="board-mode__empty">
            <span className="board-mode__empty-mark" aria-hidden="true">
              —
            </span>
            <strong>当前分组暂无主机</strong>
          </div>
        )}
      </main>
    </div>
  );
}
