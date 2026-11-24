// Paint for the text box members of a drawing group.
//
// The group's picture and shapes paint through the ordinary drawing paths; the member text
// paints as one more layer over them, clipped to the group's paint bounds. The layer is
// read-only furniture: it carries no selection or editing bindings, takes no pointer events
// (a click still reaches the group itself), and builds DOM only through element APIs.

import type { AnchoredDrawingRecord, InlineDrawingRecord } from '../layout/drawing-layout.ts';
import type { LayoutBox } from '../layout/semantic-records.ts';
import type { DrawingPaintContext } from './semantic-paint-drawings.ts';

/**
 * The member text layer of a group drawing, or null when it has none to paint.
 * Positioned like the drawing itself, so it lands over the group in either layer.
 */
export function paintGroupTextboxStories(
  document: Document,
  drawing: InlineDrawingRecord | AnchoredDrawingRecord,
  ctx: DrawingPaintContext,
  origin?: LayoutBox
): HTMLElement | null {
  const members = drawing.groupTextboxStories;
  if (!members || drawing.accessibility.hidden || !ctx.paintStoryFragment) return null;
  const bounds = drawing.paintBounds;
  if (bounds.width <= 0 || bounds.height <= 0) return null;
  const scale = ctx.scale;
  const layer = document.createElement('div');
  layer.className = 'docx-drawing-group-text';
  layer.dataset.groupTextFor = drawing.drawingNodeId;
  layer.setAttribute('contenteditable', 'false');
  const ox = origin?.x ?? 0;
  const oy = origin?.y ?? 0;
  layer.style.position = 'absolute';
  layer.style.left = `${(bounds.x - ox) * scale}px`;
  layer.style.top = `${(bounds.y - oy) * scale}px`;
  layer.style.width = `${bounds.width * scale}px`;
  layer.style.height = `${bounds.height * scale}px`;
  // DrawingML shape text overflows its box and the drawing, as the reference shows it.
  layer.style.overflow = members.some((member) => member.story.overflowVisible)
    ? 'visible'
    : 'hidden';
  layer.style.pointerEvents = 'none';
  // Extent origin inside the clipped paint bounds.
  const extentLeft = drawing.x - bounds.x;
  const extentTop = drawing.y - bounds.y;
  for (const member of members) {
    const story = member.story;
    const content = document.createElement('div');
    content.className = 'docx-drawing-textbox-content';
    content.style.position = 'absolute';
    content.style.left = `${(extentLeft + member.box.x + story.contentOffset.x) * scale}px`;
    content.style.top = `${(extentTop + member.box.y + story.contentOffset.y) * scale}px`;
    content.style.width = `${story.contentWidth * scale}px`;
    content.style.height = `${Math.max(0, story.contentHeight) * scale}px`;
    content.style.overflow = 'hidden';
    // A run paints bold or italic only when it is, so the story must not inherit either from the
    // line that holds an inline box, which carries its paragraph mark's face.
    content.style.fontWeight = 'normal';
    content.style.fontStyle = 'normal';
    const turn = member.rotationDegrees;
    if (turn !== 0 && Number.isFinite(turn)) {
      // The member turns about its box center, which sits here in content-box coordinates.
      const originX = member.box.width / 2 - story.contentOffset.x;
      const originY = member.box.height / 2 - story.contentOffset.y;
      content.style.transformOrigin = `${originX * scale}px ${originY * scale}px`;
      content.style.transform = `rotate(${turn}deg)`;
    }
    for (const fragment of story.fragments) {
      // Painted read-only: no selection, editing, or drawing bindings at all.
      content.append(ctx.paintStoryFragment(document, fragment, { readOnly: true }));
    }
    // Pictures and equations inside the story are inert too: no drawing selection target,
    // and no pointer target that would turn back on inside the inert layer.
    for (const nested of content.querySelectorAll<HTMLElement>('[style*="pointer-events"]')) {
      nested.style.pointerEvents = 'none';
    }
    layer.append(content);
  }
  return layer;
}
