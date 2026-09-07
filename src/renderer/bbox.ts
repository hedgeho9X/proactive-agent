export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export function projectPoint(x: number, y: number, frame: Rect | undefined) {
  if (
    !frame ||
    ![x, y, frame.x, frame.y, frame.width, frame.height].every(
      Number.isFinite,
    ) ||
    frame.width <= 0 ||
    frame.height <= 0
  )
    return null;
  const left = (100 * (x - frame.x)) / frame.width,
    top = (100 * (y - frame.y)) / frame.height;
  return left >= 0 && left <= 100 && top >= 0 && top <= 100
    ? { left, top }
    : null;
}
const valid = (r: Rect | undefined): r is Rect =>
  !!r &&
  [r.x, r.y, r.width, r.height].every(Number.isFinite) &&
  r.width > 0 &&
  r.height > 0;
// 转成窗口内百分比，独立于 Retina 倍率、图像压缩和面板显示尺寸。
export function projectBBox(rect: Rect | undefined, frame: Rect | undefined) {
  if (!valid(rect) || !valid(frame)) return null;
  const x = Math.max(rect.x, frame.x),
    y = Math.max(rect.y, frame.y);
  const right = Math.min(rect.x + rect.width, frame.x + frame.width),
    bottom = Math.min(rect.y + rect.height, frame.y + frame.height);
  if (right <= x || bottom <= y) return null;
  return {
    left: (100 * (x - frame.x)) / frame.width,
    top: (100 * (y - frame.y)) / frame.height,
    width: (100 * (right - x)) / frame.width,
    height: (100 * (bottom - y)) / frame.height,
    clipped:
      x !== rect.x ||
      y !== rect.y ||
      right !== rect.x + rect.width ||
      bottom !== rect.y + rect.height,
  };
}
