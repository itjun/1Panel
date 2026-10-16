import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { BoardHistory } from "@/utils/boardHistory";
import { pickBoardLayout } from "@/utils/boardLayout";
import { HostBoardGrid } from "./host-board-grid";
import { HostBoardTable, type BoardHostsProps } from "./host-board-table";

type Props = BoardHostsProps & {
  histories: Record<string, BoardHistory>;
  onInlineTrendsChange: (visible: boolean) => void;
  onRetry: (host: string) => void;
};

export function BoardFleetOverview({ histories, onInlineTrendsChange, onRetry, ...props }: Props) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = () => setSize((previous) => {
      const bounds = frame.getBoundingClientRect();
      // clientHeight rounds up half pixels, which can introduce a one-pixel scrollbar.
      const width = Math.floor(bounds.width);
      const height = Math.floor(bounds.height);
      return previous.width === width && previous.height === height ? previous : { width, height };
    });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);
  const layout = useMemo(() => pickBoardLayout({ ...size, hostCount: props.hosts.length }), [size, props.hosts.length]);
  const showTrends = size.width > 0 && layout.mode === "trends";
  useEffect(() => {
    onInlineTrendsChange(showTrends);
    return () => onInlineTrendsChange(false);
  }, [showTrends, onInlineTrendsChange]);
  const styles = {
    "--board-scale": layout.scale,
    "--board-columns": layout.columns,
    "--board-row": `${layout.tableRowHeight}px`,
    "--board-head": `${layout.tableHeaderHeight}px`,
    "--board-card-height": `${layout.cardHeight}px`,
    "--board-grid-gap": `${layout.gap}px`,
  } as CSSProperties;
  return <section className="board-fleet" style={styles} aria-label="分组总览" data-layout={layout.mode} data-columns={layout.columns} data-capacity={layout.capacity}>
    <div className="board-fleet__frame" ref={frameRef}>
      <div className="board-fleet__viewport">
        {size.width > 0 && (layout.mode === "table" ? <HostBoardTable {...props} /> :
          <HostBoardGrid {...props} histories={showTrends ? histories : undefined} onRetry={onRetry} />)}
      </div>
    </div>
  </section>;
}
