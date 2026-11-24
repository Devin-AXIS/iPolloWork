import { DRAWINGML_MAIN_NAMESPACE_URI, type OoxmlElement } from './ooxml-tree.ts';
import { isElement } from './drawing-projection-walk.ts';
import {
  collapseSchemaWhitespace,
  schemaAttributeValue,
  parseSchemaBoolean,
} from './ooxml-drawing-rules.ts';

/** Only identity fill rectangles are represented by the group's raster frame. */
export function identityPictureStretch(stretch: OoxmlElement | null): boolean {
  if (!stretch) return true;
  for (const child of stretch.children) {
    if (!isElement(child)) continue;
    if (child.namespaceUri !== DRAWINGML_MAIN_NAMESPACE_URI || child.localName !== 'fillRect')
      return false;
    for (const attribute of child.attributes) {
      if (attribute.namespaceUri || !['l', 't', 'r', 'b'].includes(attribute.localName))
        return false;
      const value = collapseSchemaWhitespace(attribute.value);
      if (value.length > 64 || !/^[+-]?0+(?:\.0+)?%?$/.test(value)) return false;
    }
  }
  return true;
}

/** Outline children a picture member's stroke can carry. */
const PICTURE_OUTLINE_PARTS = new Set([
  'noFill',
  'solidFill',
  'prstDash',
  'round',
  'miter',
  'bevel',
  'headEnd',
  'tailEnd',
]);

/** Preserve identity properties, but refuse paint that the group picture cannot represent. */
export function supportedPictureProperties(properties: OoxmlElement): boolean {
  const mode = schemaAttributeValue(properties.attributes, 'bwMode');
  if (mode !== undefined && !['auto', 'clr'].includes(collapseSchemaWhitespace(mode))) return false;
  for (const child of properties.children) {
    if (!isElement(child)) continue;
    if (child.namespaceUri !== DRAWINGML_MAIN_NAMESPACE_URI) return false;
    if (['xfrm', 'prstGeom', 'extLst', 'noFill'].includes(child.localName)) continue;
    if (child.localName === 'effectLst' && !child.children.some(isElement)) continue;
    // A no-fill or solid outline: the group's vector members stroke it over the picture.
    if (child.localName === 'ln') {
      const contents = child.children.filter(isElement);
      if (
        contents.every(
          (part) =>
            part.namespaceUri === DRAWINGML_MAIN_NAMESPACE_URI &&
            PICTURE_OUTLINE_PARTS.has(part.localName)
        )
      )
        continue;
    }
    return false;
  }
  return true;
}

/** A hidden picture member must not become a visible raster inside the group. */
export function visiblePictureMember(nonVisual: OoxmlElement | null): boolean {
  if (!nonVisual) return true;
  const hidden = schemaAttributeValue(nonVisual.attributes, 'hidden');
  return hidden === undefined || parseSchemaBoolean(hidden) === false;
}
