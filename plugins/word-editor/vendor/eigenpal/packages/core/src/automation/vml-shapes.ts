// Legacy VML shapes in a standalone `w:pict`, as the shape collection lists them.
//
// INTERNAL. Each VML shape element a `w:pict` holds is one shape. Word names it by the number in
// its shape id: `o:spid`, or `id` when the file writes no `o:spid`, spelled `_x0000_s1025` for a
// floating shape and `_x0000_i1025` for one on the line. A shape whose id does not have that form
// has no number to name it by and is not listed. Its name is `id` when `o:spid` carries the number,
// and the id itself otherwise.
//
// A `v:textbox` holding one `w:txbxContent` is the shape's own story. It is a text box when the
// shape uses the text box template (`#_x0000_t202`, or `o:spt="202"`), and a geometric shape with
// text otherwise. A text box that continues another box holds no story of its own. A VML
// picture is a Picture. Text art, a horizontal rule, and an embedded object's preview are
// Unsupported: their text and content are not a story an edit can reach.

import {
  OFFICE,
  VML,
  VML_SHAPE_ELEMENTS,
  attribute,
  children,
  named,
  vmlShapeNumber,
} from '../store/package/legacy-vml-values.ts';
import { WML_NAMESPACE_URI } from '../store/package/ooxml-shared.ts';
import type { OoxmlElement } from '../store/package/ooxml-tree.ts';
import type { AutomationShapeRead, AutomationShapeType } from './shapes.ts';

const RELATIONSHIPS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const TEXT_BOX_TEMPLATE = '#_x0000_t202';
/** Straight, line, elbow, and bent connector templates. */
const CONNECTOR_TEMPLATES: ReadonlySet<string> = new Set([
  '#_x0000_t20',
  '#_x0000_t32',
  '#_x0000_t33',
  '#_x0000_t34',
]);
/** The VML elements whose shape can hold a text frame. */
const FRAME_ELEMENTS: ReadonlySet<string> = new Set(['shape', 'rect', 'roundrect', 'oval']);

/** One VML shape: what a read answers, and its own story root when it has one. */
export interface VmlShape {
  readonly read: AutomationShapeRead;
  /** The VML element that draws the shape. */
  readonly node: OoxmlElement;
  readonly root: OoxmlElement | null;
  /** A text-bearing shape with no `v:textbox` at all; see `AutomationShapeEntry.emptyFrame`. */
  readonly emptyFrame: boolean;
}

const on = (value: string | undefined) => /^(t|true|1)$/i.test(value?.trim() ?? '');

/** The single `w:txbxContent` a `v:textbox` holds, or null. */
function storyOf(shape: OoxmlElement): OoxmlElement | null {
  const boxes = children(shape).filter((child) => named(child, VML, 'textbox'));
  if (boxes.length !== 1) return null;
  const content = children(boxes[0]!);
  return content.length === 1 && named(content[0]!, WML_NAMESPACE_URI, 'txbxContent')
    ? content[0]!
    : null;
}

function isTextBoxTemplate(shape: OoxmlElement): boolean {
  return (
    attribute(shape, 'type')?.trim() === TEXT_BOX_TEMPLATE ||
    attribute(shape, 'spt', OFFICE)?.trim() === '202'
  );
}

/** A VML connector: `o:connectortype`, or the straight and bent connector templates. */
function isConnector(shape: OoxmlElement): boolean {
  const kind = attribute(shape, 'connectortype', OFFICE)?.trim();
  if (kind && kind !== 'none') return true;
  const template = attribute(shape, 'type')?.trim();
  const spt = attribute(shape, 'spt', OFFICE)?.trim();
  return CONNECTOR_TEMPLATES.has(template ?? '') || ['20', '32', '33', '34'].includes(spt ?? '');
}

function isPicture(shape: OoxmlElement): boolean {
  if (shape.localName === 'image') return true;
  return children(shape).some(
    (child) =>
      named(child, VML, 'imagedata') &&
      child.attributes.some(
        (attr) =>
          (attr.namespaceUri === RELATIONSHIPS && attr.localName === 'id') ||
          (attr.namespaceUri === OFFICE && attr.localName === 'relid') ||
          (!attr.namespaceUri && attr.localName === 'src')
      )
  );
}

function typeOf(shape: OoxmlElement, embedded: boolean): AutomationShapeType {
  // A group's members, and any story they hold, belong to the group.
  if (shape.localName === 'group') return 'Group';
  if (embedded || on(attribute(shape, 'hr', OFFICE))) return 'Unsupported';
  if (children(shape).some((child) => named(child, VML, 'textpath'))) return 'Unsupported';
  if (isTextBoxTemplate(shape)) return 'TextBox';
  if (children(shape).some((child) => named(child, VML, 'textbox'))) return 'GeometricShape';
  return isPicture(shape) ? 'Picture' : 'GeometricShape';
}

/** The shapes a standalone `w:pict` draws, in document order; each one names itself. */
export function vmlShapesOf(pict: OoxmlElement): readonly VmlShape[] {
  const members = children(pict);
  // A picture beside `o:OLEObject` is the preview of an embedded object, not a picture.
  const embedded = members.some((child) => named(child, OFFICE, 'OLEObject'));
  const shapes: VmlShape[] = [];
  for (const shape of members) {
    if (shape.namespaceUri !== VML || !VML_SHAPE_ELEMENTS.has(shape.localName)) continue;
    const id = vmlShapeNumber(shape);
    if (id === null) continue;
    const spid = attribute(shape, 'spid', OFFICE);
    const ownId = attribute(shape, 'id') ?? '';
    const type = typeOf(shape, embedded);
    const root = type === 'TextBox' || type === 'GeometricShape' ? storyOf(shape) : null;
    // Only a closed shape holds text: a line, a connector, a path, or a picture fill has no
    // text frame.
    const emptyFrame =
      (type === 'TextBox' || type === 'GeometricShape') &&
      FRAME_ELEMENTS.has(shape.localName) &&
      !isConnector(shape) &&
      !children(shape).some(
        (child) => named(child, VML, 'textbox') || named(child, VML, 'imagedata')
      );
    shapes.push({
      read: { id, name: spid === undefined ? ownId.trim() : ownId, type },
      node: shape,
      root,
      emptyFrame,
    });
  }
  return shapes;
}
