import { schemaAttributeValue } from './ooxml-drawing-rules.ts';
import { drawingSourceSelection } from './drawing-support-issues.ts';
import { DRAWINGML_MAIN_NAMESPACE_URI as A, type OoxmlElement } from './ooxml-tree.ts';

/**
 * The kind of graphic a drawing holds. Note: `textbox` names every DrawingML shape, with or
 * without text, and `shape` names only legacy VML drawings.
 *
 * Read from its source: `picture`, `chart` (a chart),
 * `diagram` (SmartArt), `textbox` (a DrawingML shape, with or without text), `group` (a shape
 * group), `canvas` (a drawing canvas), `shape` (a legacy VML drawing, such as WordArt), or
 * `graphic` (any other graphic). It does not say whether the engine renders the graphic.
 * The names match `placeholderGraphicKind`, which adds no `picture` and is set only for
 * placeholders.
 *
 * @public
 */
export type DrawingGraphicKind =
  'picture' | 'chart' | 'diagram' | 'shape' | 'group' | 'textbox' | 'canvas' | 'graphic';

// A Map, not an object literal: the key is a `graphicData@uri` out of the file, so a value
// of `__proto__` or `constructor` must answer undefined, not a prototype member.
const GRAPHIC_URI_KIND: ReadonlyMap<string, DrawingGraphicKind> = new Map([
  ['http://schemas.openxmlformats.org/drawingml/2006/picture', 'picture'],
  ['http://schemas.openxmlformats.org/drawingml/2006/chart', 'chart'],
  // A chartex chart (waterfall, funnel, histogram, ...): `chartex-parts.ts`.
  ['http://schemas.microsoft.com/office/drawing/2014/chartex', 'chart'],
  ['http://schemas.openxmlformats.org/drawingml/2006/diagram', 'diagram'],
  ['http://schemas.microsoft.com/office/word/2010/wordprocessingGroup', 'group'],
  ['http://schemas.microsoft.com/office/word/2010/wordprocessingShape', 'textbox'],
  ['http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas', 'canvas'],
]);

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const VML = 'urn:schemas-microsoft-com:vml';

/** The graphic kind named by a `graphicData@uri`, or undefined for an unknown URI. */
export function graphicKindOfUri(uri: string): DrawingGraphicKind | undefined {
  return GRAPHIC_URI_KIND.get(uri);
}

/**
 * The graphic kind of a selected drawing node: the first `a:graphicData` it holds, or `shape`
 * for a legacy VML drawing. Nested text-box stories are not searched.
 */
export function drawingGraphicKind(selected: OoxmlElement): DrawingGraphicKind {
  const stack: OoxmlElement[] = [selected];
  let visited = 0;
  let vml = false;
  while (stack.length && ++visited <= 4096) {
    const node = stack.pop()!;
    if (node.namespaceUri === A && node.localName === 'graphicData') {
      const uri = schemaAttributeValue(node.attributes, 'uri');
      return (uri && graphicKindOfUri(uri)) || 'graphic';
    }
    if (node.namespaceUri === W && node.localName === 'txbxContent') continue;
    vml ||= node.namespaceUri === VML;
    for (let index = node.children.length - 1; index >= 0; index--) {
      const child = node.children[index]!;
      if (child.kind !== 'textValue') stack.push(child);
    }
  }
  return vml ? 'shape' : 'graphic';
}

/** The graphic kind of the drawing a source selects, such as one branch of `mc:AlternateContent`. */
export function selectedDrawingGraphicKind(
  source: OoxmlElement,
  drawingNodeId: string
): DrawingGraphicKind {
  return drawingGraphicKind(drawingSourceSelection(source, drawingNodeId).node);
}
