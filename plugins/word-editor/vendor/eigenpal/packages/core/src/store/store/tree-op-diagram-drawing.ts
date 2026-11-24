// A DrawingML diagram in a story: a `w:drawing` whose graphic data is `dgm:relIds`.
//
// A diagram takes the frame edits of a picture: size, position, wrap, alt text, and delete.
// Its graphic lives in the diagram parts, so crop, replace, rotate, and borders refuse. A
// resize also rescales the saved drawing part (`package/diagram-frame.ts`); the editor sends
// it through the package lane that writes both, as one undo unit.

import { holdsDiagramGraphic, withRescaledDiagramDrawing } from '../package/diagram-frame.ts';
import { findNode } from '../package/ooxml-edit.ts';
import { schemaAttributeValue } from '../package/ooxml-drawing-rules.ts';
import { WP_NAMESPACE_URI } from '../package/ooxml-shared.ts';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import type { TransactionContext } from './tree-store.ts';
import type { DrawingTreeDocOp } from './tree-op-types.ts';

/**
 * The refusal of a diagram resize whose saved drawing another diagram shares, or would leave
 * the DrawingML coordinate range. Adapters translate it through `DISABLED_REASON_KEYS`.
 */
export const DIAGRAM_RESCALE_REFUSAL =
  'this diagram cannot be resized: its saved drawing is shared or cannot scale to that size';

/** The drawing operations that change only a diagram's frame, never its graphic. */
export const DIAGRAM_FRAME_EDITS: ReadonlySet<string> = new Set([
  'resizeDrawing',
  'positionDrawing',
  'setDrawingWrap',
  'setDrawingMetadata',
  'deleteDrawing',
]);

/** The `w:drawing` that `nodeId` names when it holds a diagram, or null. */
export function diagramDrawingOf(part: OoxmlPart, nodeId: string): OoxmlElement | null {
  const node = findNode(part, nodeId);
  if (!node || node.kind === 'textValue') return null;
  return holdsDiagramGraphic(node) ? node : null;
}

type Extent = { readonly cx: number; readonly cy: number };

function element(node: OoxmlNode | undefined): OoxmlElement | null {
  return node && node.kind !== 'textValue' ? node : null;
}

/** The `wp:extent` of a drawing's inline or anchor, or null. */
function extentOf(drawing: OoxmlElement): Extent | null {
  for (const child of drawing.children) {
    const anchor = element(child);
    if (!anchor) continue;
    const isAnchor =
      anchor.kind === 'inlineDrawing' ||
      anchor.kind === 'anchoredDrawing' ||
      (anchor.namespaceUri === WP_NAMESPACE_URI &&
        (anchor.localName === 'inline' || anchor.localName === 'anchor'));
    if (!isAnchor) continue;
    for (const grandchild of anchor.children) {
      const extent = element(grandchild);
      if (!extent) continue;
      if (
        extent.kind !== 'drawingExtent' &&
        !(extent.namespaceUri === WP_NAMESPACE_URI && extent.localName === 'extent')
      )
        continue;
      const cx = Number(schemaAttributeValue(extent.attributes, 'cx'));
      const cy = Number(schemaAttributeValue(extent.attributes, 'cy'));
      return Number.isFinite(cx) && Number.isFinite(cy) ? { cx, cy } : null;
    }
  }
  return null;
}

/**
 * Before a resize of a diagram, stage the rescale of its saved drawing part from the frame it
 * has to the frame `op` gives it. True when there is nothing to stage or the rescale staged;
 * false when the rescale is refused, which fails the transaction.
 */
export function stageDiagramRescale(
  ctx: TransactionContext,
  owner: string,
  op: DrawingTreeDocOp
): boolean {
  if (op.op !== 'resizeDrawing') return true;
  let refused = false;
  ctx.applyPackage((pkg) => {
    const part = pkg.parts.get(owner);
    const drawing = part ? diagramDrawingOf(part, op.drawingNodeId) : null;
    const from = drawing ? extentOf(drawing) : null;
    if (!drawing || !from) return pkg;
    const next = withRescaledDiagramDrawing(pkg, owner, drawing, from, op.extentEmu);
    if (next) return next;
    refused = true;
    return pkg;
  });
  return !refused;
}
