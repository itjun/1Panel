import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { sshconfig } from "@/api";
import { BoardSummaryStrip } from "@/react/components/board/board-summary-strip";
import { HostBoardCard } from "@/react/components/board/host-board-card";
import "@/react/components/board/board.css";
import {
  boardDensityOf,
  pickBoardGrid,
  summarizeBoardCards,
  type BoardHostCard,
  type BoardHostTrend,
} from "@/utils/boardModel";

function emptyTrend(): BoardHostTrend {
  return { cpu: [], mem: [] };
}

/**
 * 分组页内嵌看板：与弹出看板共用摘要条 + 主机卡片，隐藏独立窗口顶栏。
 */
export function BoardEmbed({
  hosts,
  cards,
  trends,
  onOpenHost,
}: {
  hosts: sshconfig.HostConfig[];
  cards: Record<string, BoardHostCard>;
  trends?: Record<string, BoardHostTrend>;
  onOpenHost: (name: string) => void;
}) {
  const gridRef = useRef<HTMLElement | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [nowMs, setNowMs] = useState(() => Date.now());

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

  const summary = useMemo(
    () => summarizeBoardCards(cards, nowMs),
    [cards, nowMs],
  );

  const gridShape = useMemo(
    () => pickBoardGrid(hosts.length, viewport.width, viewport.height),
    [hosts.length, viewport.width, viewport.height],
  );
  const cardDensity = boardDensityOf(gridShape);

  return (
    <div className="board-mode is-embedded" aria-label="分组看板">
      <BoardSummaryStrip summary={summary} embedded />

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
            const trend = trends?.[h.name] || emptyTrend();
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
            <span>添加主机后，实时监控数据会显示在这里</span>
          </div>
        )}
      </main>
    </div>
  );
}
