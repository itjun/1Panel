import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/react/components/ui/button";
import type { BoardAppSubItem, BoardAppSubStatus } from "@/utils/boardModel";
import "./board-app-list.css";

const STATUS_ORDER: Record<BoardAppSubStatus, number> = { critical: 0, unknown: 1, healthy: 2 };

function displayStatus(item: BoardAppSubItem): BoardAppSubStatus {
  return item.status !== "unknown" && item.count === 0 ? "critical" : item.status;
}

function itemDescription(item: BoardAppSubItem) {
  const status = displayStatus(item);
  return status === "unknown"
    ? `${item.name}：运行数量待确认`
    : `${item.name}：${item.count} 个运行实例，${status === "healthy" ? "正常" : item.count === 0 ? "离线" : "探活异常"}`;
}

function moreText(hidden: number, critical: number, unknown: number) {
  // 窄列发生省略时先保住异常数量，详细总数仍由 title 和读屏标签提供。
  return critical ? `异常 ${critical} · 另 ${hidden} 项`
    : unknown ? `待确认 ${unknown} · 另 ${hidden} 项`
      : `另 ${hidden} 项`;
}

/** 最多两行；折叠项的异常数始终保留在入口，主机行不会被订阅数量撑高。 */
export function BoardAppList({ host, items, loading, onExpand }: {
  host: string;
  items: BoardAppSubItem[] | null | undefined;
  loading?: boolean;
  onExpand: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(0);
  const sorted = useMemo(() => (items || []).map((item, index) => ({ item, index }))
    .sort((a, b) => STATUS_ORDER[displayStatus(a.item)] - STATUS_ORDER[displayStatus(b.item)] || a.index - b.index)
    .map(({ item }) => item), [items]);
  const suffixCounts = useMemo(() => {
    const counts = Array.from({ length: sorted.length + 1 }, () => ({ critical: 0, unknown: 0 }));
    for (let index = sorted.length - 1; index >= 0; index -= 1) {
      const status = displayStatus(sorted[index]);
      counts[index] = {
        critical: counts[index + 1].critical + Number(status === "critical"),
        unknown: counts[index + 1].unknown + Number(status === "unknown"),
      };
    }
    return counts;
  }, [sorted]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const measuring = measureRef.current;
    if (!container || !measuring || sorted.length === 0) {
      setVisibleCount(0);
      return;
    }
    let frame = 0;
    let stopped = false;
    let lastWidth = -1;
    const labels = [...measuring.querySelectorAll<HTMLElement>("[data-app-label]")];
    const moreLabels = [...measuring.querySelectorAll<HTMLElement>("[data-app-more]")];
    const measure = () => {
      frame = 0;
      if (stopped) return;
      const width = container.getBoundingClientRect().width;
      if (width <= 0) return;
      lastWidth = width;
      const gap = Number.parseFloat(getComputedStyle(container).columnGap) || 0;
      const prefixes = [{ rows: 1, used: 0 }];
      const append = (previous: { rows: number; used: number }, itemWidth: number) => {
        if (previous.used === 0) return { rows: previous.rows, used: itemWidth };
        const nextWidth = previous.used + gap + itemWidth;
        return nextWidth <= width - 0.25
          ? { rows: previous.rows, used: nextWidth }
          : { rows: previous.rows + 1, used: itemWidth };
      };
      for (const label of labels) prefixes.push(append(prefixes[prefixes.length - 1], label.getBoundingClientRect().width));
      let nextCount = sorted.length;
      if (prefixes[sorted.length].rows > 2) {
        nextCount = 0;
        for (let count = sorted.length - 1; count >= 0; count -= 1) {
          if (append(prefixes[count], moreLabels[count].getBoundingClientRect().width).rows <= 2) {
            nextCount = count;
            break;
          }
        }
      }
      setVisibleCount((previous) => previous === nextCount ? previous : nextCount);
    };
    const scheduleMeasure = () => {
      if (!stopped && !frame) frame = requestAnimationFrame(measure);
    };
    measure();
    const observer = new ResizeObserver((entries) => {
      // 标签测量层不参与布局；可见列表高度变化无需重新计算，避免反馈循环。
      if (entries.some((entry) => entry.target !== container || Math.abs(entry.contentRect.width - lastWidth) > 0.25)) scheduleMeasure();
    });
    observer.observe(container);
    for (const label of [...labels, ...moreLabels]) observer.observe(label);
    document.fonts?.ready.then(scheduleMeasure);
    return () => {
      stopped = true;
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [sorted]);

  const count = Math.min(visibleCount, sorted.length);
  const hidden = sorted.length - count;
  const hiddenStatus = suffixCounts[count];
  const moreDescription = `${host} 的全部 ${sorted.length} 项应用订阅，另有 ${hidden} 项，${hiddenStatus.critical} 项异常，${hiddenStatus.unknown} 项待确认`;

  return (
    <div ref={containerRef} className="board-app-list" aria-label={`${host} 应用订阅`}>
      {sorted.length === 0 ? <span className="board-app-list__empty">{loading ? "探活中…" : items === null ? "未配置" : "暂无订阅"}</span> : <>
        {sorted.slice(0, count).map((item, index) => (
          <span key={`${item.name}-${index}`} className={`board-app-list__item health-${displayStatus(item)}`} title={itemDescription(item)}>
            <span className="board-app-list__name">{item.name}</span>
            <b>{item.status === "unknown" ? "—" : item.count}</b>
          </span>
        ))}
        {hidden > 0 ? <Button variant="ghost" size="sm"
          className={`board-app-list__more${hiddenStatus.critical ? " is-critical" : hiddenStatus.unknown ? " is-unknown" : ""}`}
          aria-label={`展开${moreDescription}`} title={moreDescription}
          onClick={(event) => { event.stopPropagation(); onExpand(); }}>
          <span>{moreText(hidden, hiddenStatus.critical, hiddenStatus.unknown)}</span>
        </Button> : null}
        <div ref={measureRef} className="board-app-list__measure" aria-hidden="true">
          {sorted.map((item, index) => (
            <span key={`label-${index}`} data-app-label className="board-app-list__item">
              <span className="board-app-list__name">{item.name}</span>
              <b>{item.status === "unknown" ? "—" : item.count}</b>
            </span>
          ))}
          {sorted.map((_, index) => (
            <span key={`more-${index}`} data-app-more className="board-app-list__more">
              <span>{moreText(sorted.length - index, suffixCounts[index].critical, suffixCounts[index].unknown)}</span>
            </span>
          ))}
        </div>
      </>}
    </div>
  );
}
