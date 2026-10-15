import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { agentcli, monitor } from "@/api";
import { Maximize, Minimize, X } from "lucide-react";
import { Button } from "@/react/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/react/components/ui/dialog";
import { boardHttpApi } from "@/api/board-http";
import { BoardSummaryStrip } from "@/react/components/board/board-summary-strip";
import { BoardFleetOverview } from "@/react/components/board/board-fleet-overview";
import { BoardHostTrends } from "@/react/components/board/board-host-trends";
import { normalizeBoardHistory, type BoardHistory } from "@/utils/boardHistory";
import "@/react/components/board/board.css";
import {
  buildBoardAppSubItems,
  summarizeBoardCards,
  type BoardHostCard,
} from "@/utils/boardModel";
import { formatErr, isAgentMissing } from "@/utils/format";

const POLL_MS = 3000;
/** 近 1h 趋势与 overview 分开轮询，避免堵瞬时采集 */
const RANGE_POLL_MS = 30000;
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
  const [histories, setHistories] = useState<Record<string, BoardHistory>>({});
  const [requestedHost, setRequestedHost] = useState("");
  const [appsHost, setAppsHost] = useState("");
  const overviewFocusRef = useRef<HTMLElement | null>(null);
  const overviewFocusHostRef = useRef("");
  const rememberOverviewFocus = useCallback((host: string) => {
    overviewFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    overviewFocusHostRef.current = host;
  }, []);
  const openTrends = useCallback((host: string) => {
    rememberOverviewFocus(host);
    setRequestedHost(host);
  }, [rememberOverviewFocus]);
  const openApps = useCallback((host: string) => {
    rememberOverviewFocus(host);
    setAppsHost(host);
  }, [rememberOverviewFocus]);
  const restoreOverviewFocus = useCallback((event: Event) => {
    event.preventDefault();
    const previous = overviewFocusRef.current;
    const fallback = document.querySelector<HTMLElement>(`.board-fleet [data-host="${CSS.escape(overviewFocusHostRef.current)}"] .board-host__name`);
    (previous?.isConnected && previous.matches(".board-fleet button") ? previous : fallback)?.focus({ preventScroll: true });
  }, []);
  const [instances, setInstances] = useState<
    Record<string, agentcli.JavaAppInstance[]>
  >({});
  const [instancesKnown, setInstancesKnown] = useState<
    Record<string, boolean>
  >({});
  const [instanceLoading, setInstanceLoading] = useState<Record<string, boolean>>(
    {},
  );
  const [metaError, setMetaError] = useState("");
  const [metaLoading, setMetaLoading] = useState(true);

  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const selectedHost = hosts.some((host) => host.name === requestedHost) ? requestedHost : "";
  const hostsRef = useRef(hosts);
  const hostStatesRef = useRef(hostStates);
  const subsRef = useRef(hostAppNotifySubs);
  const aliveRef = useRef(true);
  const inFlight = useRef(new Set<string>());
  const rangeInFlight = useRef(new Set<string>());
  const instInFlight = useRef(new Set<string>());

  hostsRef.current = hosts;
  hostStatesRef.current = hostStates;
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
        setInstances((m) => ({ ...m, [name]: rows || [] }));
        setInstancesKnown((m) => ({ ...m, [name]: true }));
      } catch {
        if (!aliveRef.current) return;
        // 保留快照，但本轮失败后不能继续用旧结果宣称正常。
        setInstancesKnown((m) => ({ ...m, [name]: false }));
      } finally {
        instInFlight.current.delete(name);
        setInstanceLoading((m) => ({ ...m, [name]: false }));
      }
    },
    [gid],
  );

  const loadRange = useCallback(async (name: string) => {
    if (!gid || !name || rangeInFlight.current.has(name) || !aliveRef.current) return;
    rangeInFlight.current.add(name);
    const to = Math.floor(Date.now() / 1000);
    const from = to - TREND_WINDOW_SEC;
    setHistories((previous) => ({ ...previous, [name]: {
      ...(previous[name] ?? { points: [], from: from * 1000, to: to * 1000 }), loading: true,
    } }));
    try {
      const result = await boardHttpApi.range(gid, name, from, to, "auto");
      if (!aliveRef.current) return;
      setHistories((previous) => ({ ...previous, [name]: {
        points: normalizeBoardHistory(result.points, from * 1000, to * 1000),
        from: from * 1000, to: to * 1000, loading: false, updatedAt: Date.now(),
      } }));
    } catch (error) {
      if (!aliveRef.current) return;
      setHistories((previous) => ({ ...previous, [name]: {
        ...previous[name], loading: false, error: formatErr(error),
      } }));
    } finally {
      rangeInFlight.current.delete(name);
    }
  }, [gid]);

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
        const [overviewResult, diskResult] = await Promise.allSettled([
          boardHttpApi.overview(gid, name), boardHttpApi.disks(gid, name),
        ]);
        if (overviewResult.status === "rejected") throw overviewResult.reason;
        const ov = overviewResult.value;
        const disks = diskResult.status === "fulfilled" ? diskResult.value || [] : undefined;
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
      } catch (e) {
        if (!aliveRef.current) return;
        setHostStates((m) => ({
          ...m,
          [name]: {
            ...m[name],
            loading: false,
            error: formatErr(e),
            errorAt: Date.now(),
          },
        }));
      } finally {
        inFlight.current.delete(name);
      }
    },
    [gid],
  );

  const loadMeta = useCallback(async () => {
    if (!gid) {
      setMetaError("缺少分组");
      setMetaLoading(false);
      return;
    }
    setMetaLoading(true);
    try {
      const [info, settings] = await Promise.all([
        boardHttpApi.group(gid),
        boardHttpApi.settings(),
      ]);
      if (!aliveRef.current) return;
      setMetaError("");
      setGroupName(info.name || gid);
      setBoardTitle((info.boardTitle || "").trim());
      subsRef.current = normalizeStringMap(settings.hostAppNotifySubs);
      setHostAppNotifySubs(subsRef.current);
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

      for (const h of nextHosts) {
        const had = hostStatesRef.current[h.name]?.overview;
        void loadOne(h.name, !had);
        void loadInstances(h.name);
      }
    } catch (e) {
      if (!aliveRef.current) return;
      setMetaError(formatErr(e));
    } finally {
      if (aliveRef.current) setMetaLoading(false);
    }
  }, [gid, loadOne, loadInstances]);

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
    }, RANGE_POLL_MS);

    return () => {
      aliveRef.current = false;
      clearInterval(pollTimer);
      clearInterval(rangeTimer);
    };
  }, [loadMeta, loadOne, loadInstances]);

  useEffect(() => {
    const clock = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(clock);
  }, []);

  useEffect(() => {
    if (!selectedHost) return;
    void loadRange(selectedHost);
    const timer = setInterval(() => void loadRange(selectedHost), RANGE_POLL_MS);
    return () => clearInterval(timer);
  }, [selectedHost, loadRange]);

  const retryRange = useCallback(() => void loadRange(selectedHost), [selectedHost, loadRange]);

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
      if (e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable=true]")) return;
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
              instances[h.name],
              instancesKnown[h.name] === true,
            )
          : null,
        appSubLoading: configured && !instancesKnown[h.name] && instanceLoading[h.name] === true,
        updatedAt: s.updatedAt,
      };
    }
    return out;
  }, [
    hosts,
    hostStates,
    hostAppNotifySubs,
    instances,
    instancesKnown,
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

  return (
    <div className="board-mode" role="main" aria-label="看板模式">
      <header className="board-mode__bar">
        <div className="board-mode__identity">
          <span className="board-mode__live-mark" aria-hidden="true" />
          <h1 className="board-mode__board-title" data-tip={boardTitle || "运维监控看板"} data-tip-overflow="">
            {boardTitle || "运维监控看板"}
          </h1>
          <span className="board-mode__group">分组：<strong>{groupName || "分组"}</strong></span>
        </div>
        <div className="board-mode__right">
          <span className="board-mode__last-update">{formatLastUpdate(latestUpdate || undefined)}</span>
          <time className="board-mode__clock" dateTime={new Date(nowMs).toISOString()}>{formatBoardClock(nowMs)}</time>
          <Button className="board-mode__fs-btn" onClick={() => void toggleFullscreen()}>
            {isFullscreen ? <Minimize size={16} strokeWidth={1.5} /> : <Maximize size={16} strokeWidth={1.5} />}
            {isFullscreen ? "退出全屏" : "全屏"}
          </Button>
        </div>
      </header>
      <BoardSummaryStrip summary={summary} />
      {metaError ? (
        <div className="board-mode__empty" role="alert">
          <strong>{metaError}</strong><Button onClick={() => void loadMeta()}>重新加载</Button>
        </div>
      ) : hosts.length ? (
        <div className="board-mode__content">
          <BoardFleetOverview hosts={hosts} cards={cards} selectedHost={selectedHost} now={nowMs}
            onSelect={openTrends} onApps={openApps} />
        </div>
      ) : (
        <div className="board-mode__empty" role="status"><strong>{metaLoading ? "正在读取主机分组…" : "当前分组暂无主机"}</strong></div>
      )}
      <Dialog open={!!selectedHost} onOpenChange={(open) => { if (!open) setRequestedHost(""); }}>
        <DialogContent className="board-dialog board-dialog--trends" aria-describedby={undefined} onCloseAutoFocus={restoreOverviewFocus}>
          <DialogTitle className="sr-only">主机监控趋势</DialogTitle>
          <div className="board-dialog__toolbar">
            <select aria-label="切换趋势主机" value={selectedHost} onChange={(event) => setRequestedHost(event.target.value)}>
              {hosts.map((host) => <option key={host.name} value={host.name}>{host.name}</option>)}
            </select>
            <Button variant="ghost" onClick={() => setRequestedHost("")} aria-label="关闭主机趋势"><X size={20} /></Button>
          </div>
          {selectedHost ? <BoardHostTrends key={selectedHost} host={selectedHost} card={cards[selectedHost] || { loading: true }}
            history={histories[selectedHost]} onRetry={retryRange} /> : null}
        </DialogContent>
      </Dialog>
      <Dialog open={!!appsHost && !!cards[appsHost]} onOpenChange={(open) => { if (!open) setAppsHost(""); }}>
        <DialogContent className="board-dialog board-dialog--apps" aria-describedby={undefined} onCloseAutoFocus={restoreOverviewFocus}>
          <div className="board-dialog__toolbar">
            <DialogTitle>{appsHost} · 应用订阅</DialogTitle>
            <Button variant="ghost" onClick={() => setAppsHost("")} aria-label="关闭应用订阅"><X size={20} /></Button>
          </div>
          <div className="board-dialog__app-list">
            {(cards[appsHost]?.appSubItems || []).map((item) => <div key={item.name} className={`board-dialog__app health-${item.status}`}>
              <span>{item.name}</span><strong>{item.status === "unknown" ? "—" : item.count}</strong>
              <span>{item.status === "unknown" ? "待确认" : item.status === "healthy" ? "正常" : item.count === 0 ? "离线" : "异常"}</span>
            </div>)}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
