export interface OverlayRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface OverlaySize {
  width: number;
  height: number;
}

export function resolveBoundedOverlayPosition(
  anchor: OverlayRect,
  host: OverlayRect,
  overlay: OverlaySize,
  options: { edgePadding?: number; gap?: number } = {},
) {
  const edgePadding = options.edgePadding ?? 12;
  const gap = options.gap ?? 8;
  const maxWidth = Math.max(0, host.width - edgePadding * 2);
  const maxHeight = Math.max(0, host.height - edgePadding * 2);
  const width = Math.min(overlay.width, maxWidth);
  const height = Math.min(overlay.height, maxHeight);
  const maxLeft = Math.max(edgePadding, host.width - edgePadding - width);
  const desiredLeft = anchor.left - host.left + anchor.width / 2 - width / 2;
  const left = Math.min(Math.max(edgePadding, desiredLeft), maxLeft);
  const roomAbove = anchor.top - host.top - gap - edgePadding;
  const roomBelow = host.bottom - anchor.bottom - gap - edgePadding;
  const placement = roomAbove >= height || roomAbove >= roomBelow ? "above" : "below";
  const desiredTop = placement === "above"
    ? anchor.top - host.top - gap - height
    : anchor.bottom - host.top + gap;
  const maxTop = Math.max(edgePadding, host.height - edgePadding - height);
  const top = Math.min(Math.max(edgePadding, desiredTop), maxTop);

  return { left, top, maxWidth, maxHeight, placement } as const;
}
