/**
 * 把右键菜单坐标钳到视口内，避免贴底/贴边被裁切。
 * width/height 为菜单实测尺寸（未测出前可用近似值）。
 */
export function clampContextMenuPos(
  x: number,
  y: number,
  width: number,
  height: number,
  pad = 8
): { x: number; y: number } {
  let nx = x;
  let ny = y;
  const maxX = Math.max(pad, window.innerWidth - width - pad);
  const maxY = Math.max(pad, window.innerHeight - height - pad);
  if (nx > maxX) nx = maxX;
  if (ny > maxY) ny = maxY;
  if (nx < pad) nx = pad;
  if (ny < pad) ny = pad;
  return { x: nx, y: ny };
}
