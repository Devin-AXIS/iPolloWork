// 25% is below `AUTO_ZOOM_FLOOR`, deliberately. A floored fit sits exactly ON the floor, and
// `stepZoomLevel` only offers a level strictly below the current one — with 50% as the lowest
// rung, every zoom-out affordance (the stepper's minus, the menu, Ctrl+Minus) went dead in
// precisely the case the floor exists for: a narrow screen with the comments rail open.
export const ZOOM_LEVELS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export function stepZoomLevel(zoom: number, direction: 'in' | 'out'): number | null {
  const epsilon = 0.001;
  return direction === 'in'
    ? (ZOOM_LEVELS.find((level) => level > zoom + epsilon) ?? null)
    : ([...ZOOM_LEVELS].reverse().find((level) => level < zoom - epsilon) ?? null);
}

export function zoomLevelForShortcut(key: string, zoom: number): number | null {
  if (key === '0') return 1;
  if (key === '+' || key === '=') return stepZoomLevel(zoom, 'in') ?? zoom;
  if (key === '-') return stepZoomLevel(zoom, 'out') ?? zoom;
  return null;
}
