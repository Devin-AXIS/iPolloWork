export const PRESENTATION_CANVAS_WIDTH = 1600;
export const PRESENTATION_CANVAS_HEIGHT = 900;

export function presentationCanvasScale(availableWidth: number, availableHeight: number) {
  // The viewport is mounted after the async template file loads. In a
  // packaged Electron window ResizeObserver can report the initial zero-size
  // layout for one frame (or miss that first transition entirely). A zero
  // transform makes the iframe itself 0x0, which looks like a blank slide.
  // Keep the fixed canvas paintable until the real viewport measurement
  // arrives; the next observer update will scale it to fit normally.
  if (availableWidth <= 0 || availableHeight <= 0) return 1;
  return Math.min(
    availableWidth / PRESENTATION_CANVAS_WIDTH,
    availableHeight / PRESENTATION_CANVAS_HEIGHT,
  );
}
