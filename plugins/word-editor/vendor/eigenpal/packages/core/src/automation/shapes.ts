// Shapes in a story's paragraphs, and the text-box stories they hold.
//
// INTERNAL. A shape is a DrawingML drawing in one of a story's own paragraphs, floating
// (`wp:anchor`) or inline (`wp:inline`), as the shape collection lists both. It is named by its `wp:docPr/@id` — the number a document gives it and the one
// `Shape.id` reports. A `wps:wsp` that holds a `wps:txbx/w:txbxContent` has a story of its own,
// with its own paragraphs, edited through the owning story's transaction scope. It is a text box
// when `wps:cNvSpPr/@txBox` says so, and a geometric shape with text otherwise.
//
// An inline picture is a shape of type Picture here and also an inline picture. A run-level
// `mc:AlternateContent` is read through the branch layout selects for it: a shape whose selected
// branch is a VML fallback has no DrawingML story and is not listed. A standalone legacy VML
// `w:pict` lists the shapes it draws, each named by its VML shape number (`vml-shapes.ts`),
// and a VML text box story is edited the same way. A chart is read through
// its chart branch, an Unsupported shape, even when the page shows its fallback picture
// because no renderer draws the chart: the listing never depends on installed renderers. The
// VML fallback of a
// DrawingML text box follows its story on save (`textbox-fallback-export.ts`).

import { schemaAttributeValue, WPS_NAMESPACE_URI } from '../store/package/ooxml-drawing-rules.ts';
import {
  isMcAlternateContent,
  namespaceScopeForNode,
  resolveRunLevelMcAtom,
} from '../store/package/drawing-projection.ts';
import {
  DRAWINGML_MAIN_NAMESPACE_URI,
  WML_NAMESPACE_URI,
  WP_NAMESPACE_URI,
} from '../store/package/ooxml-shared.ts';
import type {
  OoxmlElement,
  OoxmlGenericElementNode,
  OoxmlNode,
  OoxmlPart,
} from '../store/package/ooxml-tree.ts';
import { namespaceBindingsAt } from '../store/package/wml-namespace.ts';
import { vmlShapesOf } from './vml-shapes.ts';

/** Word's shape types, as `Word.ShapeType` spells them. */
export type AutomationShapeType =
  'TextBox' | 'GeometricShape' | 'Picture' | 'Group' | 'Canvas' | 'Unsupported';

/** What a shape read answers. */
export interface AutomationShapeRead {
  readonly id: number;
  readonly name: string;
  readonly type: AutomationShapeType;
}

/** One shape in a story, with where it sits. */
export interface AutomationShapeEntry extends AutomationShapeRead {
  /** The paragraph whose run holds the drawing. */
  readonly hostParagraphId: string;
  /**
   * The shape's own `w:txbxContent` story, or null when it has none. A text box or a geometric
   * shape can hold one; a linked text box continues another box's story and holds none.
   */
  readonly textboxRoot: OoxmlElement | null;
  /**
   * A text box or geometric shape the file gives no story at all: no `w:txbxContent` and no
   * link to another box. Its body reads as an empty story and refuses writes, since the file
   * has nowhere to put text (`empty-text-frame.ts`).
   */
  readonly emptyFrame: boolean;
  /** The `mc:AlternateContent` the drawing was read through, or null for a bare drawing. */
  readonly alternate: OoxmlElement | null;
  /** What a fill edit names: the drawing or `w:pict`, and the VML shape inside a `w:pict`. */
  readonly formatTarget: { readonly drawingNodeId: string; readonly shapeNodeId?: string };
}

export type AutomationShapesRead =
  | { readonly ok: true; readonly shapes: readonly AutomationShapeEntry[] }
  | { readonly ok: false; readonly reason: 'duplicates' | 'malformed' | 'truncated' };

const PICTURE_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const GROUP_URI = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';
const CANVAS_URI = 'http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas';

/** Shapes one story may list, and nodes one paragraph scan may visit. */
export const MAX_SHAPES_PER_STORY = 4096;
const MAX_NODES_PER_PARAGRAPH = 1 << 16;

function element(node: OoxmlNode | undefined): OoxmlElement | null {
  return node && node.kind !== 'textValue' ? node : null;
}

function named(node: OoxmlNode, namespaceUri: string, localName: string): boolean {
  return (
    node.kind !== 'textValue' && node.namespaceUri === namespaceUri && node.localName === localName
  );
}

function child(parent: OoxmlElement, namespaceUri: string, localName: string): OoxmlElement | null {
  return element(parent.children.find((node) => named(node, namespaceUri, localName)));
}

type ShapeOf = {
  readonly read: AutomationShapeRead;
  readonly root: OoxmlElement | null;
  readonly emptyFrame: boolean;
};

/** A drawing's identity and type, or null for no drawing frame; 'malformed' if unnamed. */
function shapeOf(drawing: OoxmlElement): ShapeOf | 'malformed' | null {
  const anchor = drawing.children.find(
    (node) =>
      node.kind === 'anchoredDrawing' ||
      node.kind === 'inlineDrawing' ||
      named(node, WP_NAMESPACE_URI, 'anchor') ||
      named(node, WP_NAMESPACE_URI, 'inline')
  );
  if (!anchor || anchor.kind === 'textValue') return null;
  const docPr = child(anchor, WP_NAMESPACE_URI, 'docPr');
  const rawId = docPr ? schemaAttributeValue(docPr.attributes, 'id') : undefined;
  // `xsd:unsignedInt`: up to ten digits, at most 4294967295.
  if (!docPr || rawId === undefined || !/^\d{1,10}$/.test(rawId) || Number(rawId) > 0xffffffff)
    return 'malformed';
  const name = schemaAttributeValue(docPr.attributes, 'name') ?? '';
  const graphic = child(anchor, DRAWINGML_MAIN_NAMESPACE_URI, 'graphic');
  const data = graphic ? child(graphic, DRAWINGML_MAIN_NAMESPACE_URI, 'graphicData') : null;
  const uri = data ? schemaAttributeValue(data.attributes, 'uri') : undefined;
  let type: AutomationShapeType = 'Unsupported';
  let root: OoxmlElement | null = null;
  let emptyFrame = false;
  if (data && uri === WPS_NAMESPACE_URI) {
    const wsp = child(data, WPS_NAMESPACE_URI, 'wsp');
    const txbx = wsp ? child(wsp, WPS_NAMESPACE_URI, 'txbx') : null;
    root = txbx ? child(txbx, WML_NAMESPACE_URI, 'txbxContent') : null;
    // A text box says so (`wps:cNvSpPr/@txBox`); a geometric shape may hold text and stays one.
    const properties = wsp ? child(wsp, WPS_NAMESPACE_URI, 'cNvSpPr') : null;
    const flag = properties ? schemaAttributeValue(properties.attributes, 'txBox') : undefined;
    type = !wsp ? 'Unsupported' : flag === '1' || flag === 'true' ? 'TextBox' : 'GeometricShape';
    // A connector or a line has no text frame (`wps:cNvCnPr`, a `line` preset).
    const geometry = wsp ? child(wsp, WPS_NAMESPACE_URI, 'spPr') : null;
    const preset = geometry ? child(geometry, DRAWINGML_MAIN_NAMESPACE_URI, 'prstGeom') : null;
    const shapeName = preset ? schemaAttributeValue(preset.attributes, 'prst') : undefined;
    emptyFrame =
      !!properties &&
      !txbx &&
      !child(wsp!, WPS_NAMESPACE_URI, 'linkedTxbx') &&
      shapeName !== 'line' &&
      !shapeName?.includes('Connector');
  } else if (uri === PICTURE_URI) type = 'Picture';
  else if (uri === GROUP_URI) type = 'Group';
  else if (uri === CANVAS_URI) type = 'Canvas';
  return { read: { id: Number(rawId), name, type }, root, emptyFrame };
}

/**
 * The shapes in a story's paragraphs, floating and inline, in reading order.
 *
 * Fails closed: a drawing with no usable `wp:docPr/@id`, two drawings sharing an id, or a scan
 * past its bounds refuses the whole list rather than answer one a handle could not name again.
 * A legacy VML shape names itself by a different number (`vml-shapes.ts`). Inline and floating
 * VML shapes number from separate counters, so one VML number can repeat another shape's id.
 * Every shape with that number is then left out of the list. It cannot be named again, and
 * refusing the whole list would also hide every drawing it lists.
 */
export function shapesInParagraphs(
  part: OoxmlPart,
  paragraphs: readonly OoxmlNode[]
): AutomationShapesRead {
  const shapes: AutomationShapeEntry[] = [];
  const seen = new Set<number>();
  const legacy: AutomationShapeEntry[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.kind === 'textValue') continue;
    // `mc:Choice/@Requires` names prefixes, so the branch is chosen in the scope the file declares.
    const scope = namespaceScopeForNode(namespaceBindingsAt(part, paragraph), paragraph);
    const stack: { node: OoxmlNode; scope: ReadonlyMap<string, string> }[] = [];
    for (let index = paragraph.children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: paragraph.children[index]!, scope });
    }
    let visits = 0;
    while (stack.length > 0) {
      if (++visits > MAX_NODES_PER_PARAGRAPH) return { ok: false, reason: 'truncated' };
      const { node, scope: inherited } = stack.pop()!;
      if (node.kind === 'textValue' || node.kind === 'paragraph') continue;
      const inScope = namespaceScopeForNode(inherited, node);
      const alternate = isMcAlternateContent(node);
      const drawing: OoxmlElement | null =
        node.kind === 'drawing' || named(node, WML_NAMESPACE_URI, 'drawing')
          ? node
          : alternate
            ? resolveRunLevelMcAtom(node as OoxmlGenericElementNode, inScope).drawing
            : null;
      if (alternate && !drawing) continue;
      if (!alternate && named(node, WML_NAMESPACE_URI, 'pict')) {
        for (const { read, root, emptyFrame, node: shape } of vmlShapesOf(node as OoxmlElement)) {
          if (shapes.length >= MAX_SHAPES_PER_STORY) return { ok: false, reason: 'truncated' };
          const entry: AutomationShapeEntry = {
            ...read,
            hostParagraphId: paragraph.id,
            textboxRoot: root,
            emptyFrame,
            alternate: null,
            formatTarget: { drawingNodeId: node.id, shapeNodeId: shape.id },
          };
          shapes.push(entry);
          legacy.push(entry);
        }
        continue;
      }
      if (drawing) {
        const found = shapeOf(drawing);
        if (found === 'malformed') return { ok: false, reason: 'malformed' };
        if (found) {
          if (seen.has(found.read.id)) return { ok: false, reason: 'duplicates' };
          if (shapes.length >= MAX_SHAPES_PER_STORY) return { ok: false, reason: 'truncated' };
          seen.add(found.read.id);
          shapes.push({
            ...found.read,
            hostParagraphId: paragraph.id,
            textboxRoot: found.root,
            emptyFrame: found.emptyFrame,
            alternate: alternate ? node : null,
            formatTarget: { drawingNodeId: alternate ? node.id : drawing.id },
          });
        }
        continue;
      }
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        stack.push({ node: node.children[index]!, scope: inScope });
      }
    }
  }
  if (legacy.length === 0) return { ok: true, shapes: Object.freeze(shapes) };
  const uses = new Map<number, number>();
  for (const shape of shapes) uses.set(shape.id, (uses.get(shape.id) ?? 0) + 1);
  const ambiguous = new Set(legacy.filter((shape) => uses.get(shape.id)! > 1));
  return {
    ok: true,
    shapes: Object.freeze(
      ambiguous.size ? shapes.filter((shape) => !ambiguous.has(shape)) : shapes
    ),
  };
}
