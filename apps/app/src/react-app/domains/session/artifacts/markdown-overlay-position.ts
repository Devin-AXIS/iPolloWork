export type MarkdownOverlayRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export function resolveMarkdownOverlayPosition(
  anchor: MarkdownOverlayRect,
  editor: MarkdownOverlayRect,
  overlay: { width: number; height: number },
  edgePadding = 8,
  gap = 6,
) {
  const maxWidth = Math.max(0, editor.width - edgePadding * 2);
  const maxHeight = Math.max(0, editor.height - edgePadding * 2);
  const width = Math.min(overlay.width, maxWidth);
  const height = Math.min(overlay.height, maxHeight);
  const desiredLeft = anchor.left - editor.left + anchor.width / 2 - width / 2;
  const left = Math.min(
    Math.max(edgePadding, desiredLeft),
    Math.max(edgePadding, editor.width - edgePadding - width),
  );
  const roomAbove = anchor.top - editor.top - gap - edgePadding;
  const roomBelow = editor.bottom - anchor.bottom - gap - edgePadding;
  const placement = roomAbove >= height || roomAbove >= roomBelow ? "above" : "below";
  const desiredTop = placement === "above"
    ? anchor.top - editor.top - gap - height
    : anchor.bottom - editor.top + gap;
  const top = Math.min(
    Math.max(edgePadding, desiredTop),
    Math.max(edgePadding, editor.height - edgePadding - height),
  );

  return { left, top, maxWidth, maxHeight, placement } as const;
}
