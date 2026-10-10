export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Point { x: number; y: number }

/** Preserve the pen outline; clicks and straight drags do not enclose a region. */
export function getSelectionPolygon(points: Point[]): Point[] {
  if (points.length < 3) return [];
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
  const area = Math.abs(points.reduce((sum, point, i) => {
    const next = points[(i + 1) % points.length]!;
    return sum + point.x * next.y - next.x * point.y;
  }, 0)) / 2;
  return area > 0 && area >= (right - left) * (bottom - top) * 0.05 ? points : [];
}

/** Includes enclosed boxes and edge crossings, but excludes holes in a concave lasso. */
export function polygonIntersectsRect(points: readonly Point[], rect: Rect): boolean {
  if (points.length < 3 || rect.width <= 0 || rect.height <= 0) return false;
  const corners = [
    { x: rect.left, y: rect.top },
    { x: rect.left + rect.width, y: rect.top },
    { x: rect.left + rect.width, y: rect.top + rect.height },
    { x: rect.left, y: rect.top + rect.height },
  ];
  const inside = (point: Point) => {
    let hit = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[i]!, b = points[j]!;
      if ((a.y > point.y) !== (b.y > point.y) &&
          point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) hit = !hit;
    }
    return hit;
  };
  if (corners.some(inside) || points.some((p) => p.x >= rect.left &&
      p.x <= rect.left + rect.width && p.y >= rect.top && p.y <= rect.top + rect.height)) return true;
  const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!, b = points[(i + 1) % points.length]!;
    for (let j = 0; j < corners.length; j++) {
      const c = corners[j]!, d = corners[(j + 1) % corners.length]!;
      if (Math.max(a.x, b.x) < Math.min(c.x, d.x) || Math.max(c.x, d.x) < Math.min(a.x, b.x) ||
          Math.max(a.y, b.y) < Math.min(c.y, d.y) || Math.max(c.y, d.y) < Math.min(a.y, b.y)) continue;
      if (cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0) return true;
    }
  }
  return false;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.left < b.left + b.width &&
    a.left + a.width > b.left &&
    a.top < b.top + b.height &&
    a.top + a.height > b.top
  );
}
