export const PRESENTATION_CANVAS_WIDTH = 1600;
export const PRESENTATION_CANVAS_HEIGHT = 900;
export const MIN_PRESENTATION_CANVAS_ZOOM = 0.5;
export const MAX_PRESENTATION_CANVAS_ZOOM = 2;

const PRESENTATION_CANVAS_WHEEL_ZOOM_FACTOR = 1.1;

export function presentationCanvasScale(availableWidth: number, availableHeight: number) {
  if (availableWidth <= 0 || availableHeight <= 0) return 0;
  return Math.min(
    availableWidth / PRESENTATION_CANVAS_WIDTH,
    availableHeight / PRESENTATION_CANVAS_HEIGHT,
  );
}

function clampPresentationCanvasZoom(zoom: number) {
  return Math.min(MAX_PRESENTATION_CANVAS_ZOOM, Math.max(MIN_PRESENTATION_CANVAS_ZOOM, zoom));
}

export function presentationCanvasWheelZoom(zoom: number, deltaY: number) {
  if (deltaY === 0) return clampPresentationCanvasZoom(zoom);
  const factor = deltaY < 0 ? PRESENTATION_CANVAS_WHEEL_ZOOM_FACTOR : 1 / PRESENTATION_CANVAS_WHEEL_ZOOM_FACTOR;
  return clampPresentationCanvasZoom(zoom * factor);
}

export function presentationCanvasZoomedScale(fitScale: number, zoom: number) {
  return fitScale * clampPresentationCanvasZoom(zoom);
}

export function presentationCanvasStageSize(availableWidth: number, availableHeight: number, scale: number) {
  return {
    width: Math.max(availableWidth, PRESENTATION_CANVAS_WIDTH * scale),
    height: Math.max(availableHeight, PRESENTATION_CANVAS_HEIGHT * scale),
  };
}
