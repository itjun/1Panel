import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { monitor } from "@/api";
import { boardHttpApi } from "@/api/board-http";
import { BoardSummaryStrip } from "@/react/components/board/board-summary-strip";
import { HostBoardCard } from "@/react/components/board/host-board-card";
import "@/react/components/board/board.css";
import {
  boardDensityOf,
  buildBoardAppSubItems,
  pickBoardGrid,
  summarizeBoardCards,
  type BoardHostCard,
  type BoardHostTrend,
} from "@/utils/boardModel";
import { formatErr, isAgentMissing } from "@/utils/format";

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

type HostBrief = { name: string; hostName: string };

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

export function BoardPage({ groupId }: { groupId: string }) {
  const gid = (groupId || "").trim();

  const [groupName, setGroupName] = useState(gid || "分组");
  const [boardTitle, setBoardTitle] = useState("");
  const [hosts, setHosts] = useState<HostBrief[]>([]);
  const [hostAppNotifySubs, setHostAppNotifySubs] = useState<Record<string, string[]>>(
    {},
  );
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
  const [metaError, setMetaError] = useState("");

  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  const gridRef = useRef<HTMLElement | null>(null);
  const hostsRef = useRef(hosts);
  const hostStatesRef = useRef(hostStates);
  const trendsRef = useRef(trends);
  const subsRef = useRef(hostAppNotifySubs);
  const aliveRef = useRef(true);
  const inFlight = useRef(new Set<string>());
  const rangeInFlight = useRef(new Set<string>());
  const instInFlight = useRef(new Set<string>());

  hostsRef.current = hosts;
  hostStatesRef.current = hostStates;
  trendsRef.current = trends;
  subsRef.current = hostAppNotifySubs;

  const loadInstances = useCallback(
    async (name: string) => {
      if (!gid) return;
      if (!hasAppNotifyConfig(subsRef.current, name)) return;
      if (instInFlight.current.has(name) || !aliveRef.current) return;
      const prev = hostStatesRef.current[name];
      if (prev?.error && isAgentMissing(prev.error)) return;
      instInFlight.current.add(name);
      setInstanceLoading((m) => ({ ...m, [name]: true }));
      try {
        const rows = await boardHttpApi.watchInstances(gid, name);
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
    },
    [gid],
  );

  const loadRange = useCallback(
    async (name: string) => {
      if (!gid) return;
      if (rangeInFlight.current.has(name) || !aliveRef.current) return;
      rangeInFlight.current.add(name);
      try {
        const now = Math.floor(Date.now() / 1000);
        const r = await boardHttpApi.range(gid, name, now - TREND_WINDOW_SEC, now, "auto");
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
    },
    [gid],
  );

  const loadOne = useCallback(
    async (name: string, showSkeleton: boolean, force = false) => {
      if (!gid) return;
      if (inFlight.current.has(name) || !aliveRef.current) return;
      const prev = hostStatesRef.current[name];
      if (!force && prev?.error && isAgentMissing(prev.error)) return;
      inFlight.current.add(name);
      if (showSkeleton) {
        setHostStates((m) => ({ ...m, [name]: { loading: true } }));
      }
      try {
        const ov = await boardHttpApi.overview(gid, name);
        let disks: monitor.DiskInfo[] = [];
        try {
          disks = (await boardHttpApi.disks(gid, name)) || [];
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
    [gid, loadRange],
  );

  const loadMeta = useCallback(async () => {
    if (!gid) {
      setMetaError("缺少分组");
      return;
    }
    try {
      const [info, settings] = await Promise.all([
        boardHttpApi.group(gid),
        boardHttpApi.settings(),
      ]);
      if (!aliveRef.current) return;
      setMetaError("");
      setGroupName(info.name || gid);
      setBoardTitle((info.boardTitle || "").trim());
      setHostAppNotifySubs(normalizeStringMap(settings.hostAppNotifySubs));
      const nextHosts: HostBrief[] = (info.hosts || []).map((h) => ({
        name: h.name,
        hostName: h.hostName || "",
      }));
      setHosts(nextHosts);
      document.title = `看板 · ${info.name || gid}`;

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
    } catch (e) {
      if (!aliveRef.current) return;
      setMetaError(formatErr(e));
    }
  }, [gid, loadOne, loadRange, loadInstances]);

  useEffect(() => {
    aliveRef.current = true;
    void loadMeta();

    const pollTimer = setInterval(() => {
      if (!aliveRef.current) return;
      for (const h of hostsRef.current) {
        void loadOne(h.name, false);
        void loadInstances(h.name);
      }
    }, POLL_MS);

    const rangeTimer = setInterval(() => {
      if (!aliveRef.current) return;
      void boardHttpApi.settings().then((s) => {
        if (!aliveRef.current) return;
        setHostAppNotifySubs(normalizeStringMap(s.hostAppNotifySubs));
      }).catch(() => {});
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
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        setIsFullscreen(false);
      } else {
        await document.documentElement.requestFullscreen();
        setIsFullscreen(true);
      }
    } catch {
      /* 忽略 */
    }
  }, []);

  useEffect(() => {
    function onFsChange() {
      setIsFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener("fullscreenchange", onFsChange);

    function onKeydown(e: KeyboardEvent) {
      if (e.key === "f" || e.key === "F" || e.key === "F11") {
        e.preventDefault();
        void toggleFullscreen();
      }
    }
    window.addEventListener("keydown", onKeydown);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      window.removeEventListener("keydown", onKeydown);
    };
  }, [toggleFullscreen]);

  const cards = useMemo(() => {
    const out: Record<string, BoardHostCard> = {};
    for (const h of hosts) {
      const s = hostStates[h.name] || { loading: true };
      const configured = hasAppNotifyConfig(hostAppNotifySubs, h.name);
      const subs = configured ? hostAppNotifySubs[h.name] || [] : null;
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
    hostAppNotifySubs,
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
    <div
      className={
        /Mac|iPhone|iPad/.test(navigator.platform)
          ? "board-mode is-macos"
          : "board-mode"
      }
      role="main"
      aria-label="看板模式"
    >
      <header className="board-mode__bar">
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
            className="board-mode__fs-btn"
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

      {metaError ? (
        <div className="board-mode__empty">
          <strong>{metaError}</strong>
        </div>
      ) : (
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
      )}
    </div>
  );
}
