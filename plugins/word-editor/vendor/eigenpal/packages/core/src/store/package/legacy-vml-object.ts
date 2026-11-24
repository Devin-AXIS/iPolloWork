import { RELATIONSHIPS_NAMESPACE_URI, WML_NAMESPACE_URI, type OoxmlElement } from './ooxml-tree.ts';
import { isStandardVmlTemplate } from './legacy-vml-templates.ts';
import { readTwipsMeasure } from '../units.ts';
import {
  attribute as a,
  boundedVml,
  children,
  element,
  named,
  OFFICE,
  VML,
} from './legacy-vml-values.ts';

const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const OBJECT_ATTRIBUTES = [
  [WML_NAMESPACE_URI, 'dxaOrig'],
  [WML_NAMESPACE_URI, 'dyaOrig'],
  [W14, 'anchorId'],
] as const;
const OLE_ATTRIBUTES = ['Type', 'ProgID', 'ShapeID', 'DrawAspect', 'ObjectID'];

/** `o:FieldCodes` is inert switch text. It is carried, never parsed or evaluated. */
function inertFieldCodes(node: OoxmlElement): boolean {
  if (!named(node, OFFICE, 'FieldCodes') || node.attributes.length) return false;
  let length = 0;
  for (const child of node.children) {
    if (element(child)) return false;
    length += child.value.length;
  }
  return length <= 1024;
}

/**
 * The cached preview of an embedded OLE object: the `v:shape` of a `w:object` that holds one
 * standard picture frame, an optional built-in template, and an optional `o:OLEObject`.
 *
 * The preview is the only rendered content. The `o:OLEObject` or `w:control` relationship is
 * never read here, so the embedded part is never resolved, loaded, or run. Linked objects,
 * controls that name another shape, extra children and unknown attributes keep the whole
 * object opaque. Null when unsupported.
 */
export function embeddedObjectPreview(node: OoxmlElement): OoxmlElement | null {
  if (node.children.length > 16 || node.attributes.length > OBJECT_ATTRIBUTES.length) return null;
  for (const attr of node.attributes) {
    if (
      !OBJECT_ATTRIBUTES.some(([ns, name]) => attr.namespaceUri === ns && attr.localName === name)
    )
      return null;
    if (attr.localName === 'anchorId') {
      if (!/^[\da-f]{1,8}$/i.test(attr.value)) return null;
    } else {
      const size = readTwipsMeasure(attr.value);
      if (size === null || size < 0 || size > 9_999_999) return null;
    }
  }
  for (const child of node.children) if (!element(child) && child.value.trim()) return null;
  const list = children(node);
  const templates = list.filter((n) => named(n, VML, 'shapetype'));
  const shapes = list.filter((n) => named(n, VML, 'shape'));
  const objects = list.filter((n) => named(n, OFFICE, 'OLEObject'));
  const controls = list.filter((n) => named(n, WML_NAMESPACE_URI, 'control'));
  if (
    templates.length > 1 ||
    shapes.length !== 1 ||
    objects.length + controls.length > 1 ||
    templates.length + shapes.length + objects.length + controls.length !== list.length ||
    (controls[0] && !inertControl(controls[0], shapes[0]!)) ||
    templates.some((template) => !boundedVml(template) || !isStandardVmlTemplate(template))
  )
    return null;
  const shape = shapes[0]!;
  return previewPicture(shape) && (!objects[0] || inertOleObject(objects[0], shape, false))
    ? shape
    : null;
}

/**
 * Whether `control` is the inert `w:control` of the preview `shape`: an ActiveX control shown by
 * its cached picture. Only its attributes are read; its relationship is never resolved, and the
 * control is never loaded or run. It must name the preview shape.
 */
function inertControl(control: OoxmlElement, shape: OoxmlElement): boolean {
  return (
    control.children.length === 0 &&
    control.attributes.every(
      (attr) =>
        attr.value.length <= 256 &&
        (attr.namespaceUri === RELATIONSHIPS_NAMESPACE_URI
          ? attr.localName === 'id'
          : attr.namespaceUri === WML_NAMESPACE_URI && ['name', 'shapeid'].includes(attr.localName))
    ) &&
    a(control, 'shapeid', WML_NAMESPACE_URI) === a(shape, 'id')
  );
}

/** A standard picture frame (`#_x0000_t75`) that shows exactly one picture. */
function previewPicture(shape: OoxmlElement): boolean {
  return (
    a(shape, 'type') === '#_x0000_t75' &&
    children(shape).filter((n) => named(n, VML, 'imagedata')).length === 1
  );
}

/**
 * Whether `ole` is an inert `o:OLEObject` for the preview `shape`: an embedded, never linked,
 * object with known attributes and at most inert field codes. Only its attributes are read; its
 * relationship is never resolved. `requireShapeId` demands a `ShapeID` that names the shape.
 */
function inertOleObject(ole: OoxmlElement, shape: OoxmlElement, requireShapeId: boolean): boolean {
  const image = children(shape).find((n) => named(n, VML, 'imagedata'));
  const imageId = image ? a(image, 'id', RELATIONSHIPS_NAMESPACE_URI) : undefined;
  const oleId = a(ole, 'id', RELATIONSHIPS_NAMESPACE_URI);
  const shapeId = a(ole, 'ShapeID');
  return !(
    ole.attributes.some(
      (attr) =>
        attr.value.length > 256 ||
        !(attr.namespaceUri === RELATIONSHIPS_NAMESPACE_URI
          ? attr.localName === 'id'
          : !attr.namespaceUri && OLE_ATTRIBUTES.includes(attr.localName))
    ) ||
    a(ole, 'Type') !== 'Embed' ||
    !['Content', 'Icon', undefined].includes(a(ole, 'DrawAspect')) ||
    (requireShapeId && shapeId === undefined) ||
    (shapeId !== undefined && shapeId !== a(shape, 'id')) ||
    // The preview must be its own picture, never the embedded object's payload.
    (oleId !== undefined && oleId === imageId) ||
    ole.children.length > 1 ||
    !ole.children.every((child) => element(child) && inertFieldCodes(child))
  );
}

/**
 * The cached preview of a `w:pict` that also holds an `o:OLEObject`. `roots` are the `w:pict`
 * children other than templates.
 *
 * Undefined when there is no `o:OLEObject`: the `w:pict` is an ordinary drawing. Otherwise the
 * preview shape, which must be one standard picture frame named by the object's `ShapeID`, or
 * null when unsupported. The embedded part is never resolved, loaded, or run.
 */
export function pictureObjectPreview(
  roots: readonly OoxmlElement[]
): OoxmlElement | null | undefined {
  const objects = roots.filter((n) => named(n, OFFICE, 'OLEObject'));
  if (!objects.length) return undefined;
  const shapes = roots.filter((n) => named(n, VML, 'shape'));
  if (objects.length !== 1 || shapes.length !== 1 || roots.length !== 2) return null;
  const shape = shapes[0]!;
  return previewPicture(shape) && inertOleObject(objects[0]!, shape, true) ? shape : null;
}
