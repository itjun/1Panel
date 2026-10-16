export type BoardLayoutInput = {
  /** Measured overview area, excluding the page heading and summary. */
  width: number;
  height: number;
  hostCount: number;
  scale?: number;
};

export type BoardLayout = {
  mode: "table" | "grid" | "trends";
  columns: number;
  rows: number;
  capacity: number;
  gap: number;
  scale: number;
  tableRowHeight: number;
  tableHeaderHeight: number;
  cardMinHeight: number;
  cardHeight: number;
  cardMinWidth: number;
  overflow: boolean;
};

function dimension(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/** Keep readable row sizes; more hosts change the layout, never shrink its type. */
export function pickBoardLayout(input: BoardLayoutInput): BoardLayout {
  const width = dimension(input.width);
  const height = dimension(input.height);
  const hostCount = dimension(input.hostCount);
  const defaultScale = width >= 3200 ? 1.5 : width >= 2200 ? 1.3 : width >= 1500 ? 1.1 : 1;
  const requestedScale = input.scale;
  const scale = typeof requestedScale === "number" && Number.isFinite(requestedScale) && requestedScale > 0
    ? Math.max(1, requestedScale)
    : defaultScale;
  const gap = Math.ceil((width < 1500 ? 12 : 16) * scale);
  const tableRowHeight = Math.ceil(84 * scale);
  const tableHeaderHeight = Math.ceil(44 * scale);
  const cardMinHeight = Math.ceil(172 * scale);
  const cardMinWidth = Math.ceil(350 * scale);
  const sizes = { gap, scale, tableRowHeight, tableHeaderHeight, cardMinHeight, cardHeight: cardMinHeight, cardMinWidth };
  const tableCapacity = Math.max(0, Math.floor((height - tableHeaderHeight) / tableRowHeight));

  // Try full, readable histories before the compact overview. Use actual CSS
  // pixels, including large-display scaling, rather than a host-count cutoff.
  const trendMinWidth = Math.ceil(400 * scale);
  const trendMinHeight = Math.ceil(288 * scale);
  const preferredColumns = hostCount <= 3 ? hostCount : hostCount <= 4 ? 2 : hostCount <= 6 ? 3 : 4;
  const candidates = Array.from({ length: Math.min(4, hostCount) }, (_, index) => index + 1)
    .sort((a, b) => Math.abs(a - preferredColumns) - Math.abs(b - preferredColumns));
  for (const columns of candidates) {
    const rows = Math.ceil(hostCount / columns);
    const cardWidth = Math.floor((width - gap * (columns - 1)) / columns);
    const cardHeight = Math.floor((height - gap * (rows - 1)) / rows);
    if (cardWidth >= trendMinWidth && cardHeight >= trendMinHeight) {
      return {
        ...sizes, mode: "trends", columns, rows, capacity: columns * rows,
        cardHeight, cardMinWidth: trendMinWidth, cardMinHeight: trendMinHeight, overflow: false,
      };
    }
  }

  if (hostCount === 0 || (width >= Math.ceil(1040 * scale) && hostCount <= tableCapacity)) {
    const rowHeight = hostCount > 0
      ? Math.min(Math.floor(tableRowHeight * 1.25), Math.floor((height - tableHeaderHeight) / hostCount))
      : tableRowHeight;
    return { ...sizes, tableRowHeight: rowHeight, mode: "table", columns: 1, rows: hostCount, capacity: tableCapacity, overflow: false };
  }

  const maxColumns = Math.max(1, Math.min(hostCount, Math.floor((width + gap) / (cardMinWidth + gap))));
  const visibleRows = Math.max(0, Math.floor((height + gap) / (cardMinHeight + gap)));
  // Use the fewest columns that fit all hosts, giving application names more room.
  // If no arrangement fits, retain the maximum visible capacity and scroll vertically.
  const columns = visibleRows > 0 ? Math.min(maxColumns, Math.ceil(hostCount / visibleRows)) : maxColumns;
  const capacity = columns * visibleRows;
  const rows = Math.ceil(hostCount / columns);
  // Give readable content a little more breathing room when the whole fleet fits.
  const cardHeight = hostCount <= capacity
    ? Math.min(Math.floor(cardMinHeight * 1.25), Math.floor((height - gap * (rows - 1)) / rows))
    : cardMinHeight;
  return {
    ...sizes,
    cardHeight,
    mode: "grid",
    columns,
    rows,
    capacity,
    overflow: hostCount > capacity,
  };
}
