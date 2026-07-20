export const PRESENTATION_CANVAS_WIDTH = 1600;
export const PRESENTATION_CANVAS_HEIGHT = 900;

export function presentationCanvasScale(availableWidth: number, availableHeight: number) {
  if (availableWidth <= 0 || availableHeight <= 0) return 0;
  return Math.min(
    availableWidth / PRESENTATION_CANVAS_WIDTH,
    availableHeight / PRESENTATION_CANVAS_HEIGHT,
  );
}
