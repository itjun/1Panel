/** 首页按内容区计算列数，宽屏最多六列，避免主机卡过密。尺寸由 CSS token 传入。 */
export function hostRackColumnCount(width: number, minCardWidth: number, gap: number): number {
  return Math.max(1, Math.min(6, Math.floor((width + gap) / (minCardWidth + gap))));
}

/** 折叠和空组收为一列；大组占满整排，在自己的网格内换行。 */
export function hostRackGroupColumns(hostCount: number, columns: number, isCollapsed: boolean): number {
  if (isCollapsed || hostCount === 0) return 1;
  return Math.min(columns, hostCount);
}
