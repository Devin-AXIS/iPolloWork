// Theme effects are not painted by grouped pictures or vectors. Keep the lookup private
// so the existing fill/line resolver callback contract stays unchanged.
import type { ShapeStyleMatrixResolver } from './drawing-shape-projection.ts';
import { findDirectChild } from './drawing-shape-readers.ts';
import { isElement } from './drawing-projection-walk.ts';
import { collapseSchemaWhitespace, schemaAttributeValue } from './ooxml-drawing-rules.ts';
import { DRAWINGML_MAIN_NAMESPACE_URI, type OoxmlElement } from './ooxml-tree.ts';

const effects = new WeakMap<ShapeStyleMatrixResolver, (index: number) => OoxmlElement | null>();

export function registerGroupThemeEffects(
  resolver: ShapeStyleMatrixResolver,
  effectAt: (index: number) => OoxmlElement | null
): void {
  effects.set(resolver, effectAt);
}

/** The theme `a:effectStyle` a style matrix resolver's theme lists at a 1-based index. */
export function themeEffectStyle(
  resolver: ShapeStyleMatrixResolver | undefined,
  index: number
): OoxmlElement | null {
  return (resolver && effects.get(resolver)?.(index)) ?? null;
}

/** Admit only references whose selected theme effect is demonstrably empty. */
export function identityGroupThemeEffect(
  member: OoxmlElement,
  resolver?: ShapeStyleMatrixResolver
): boolean {
  // Direct effect lists replace the theme effect list. The caller checks other direct
  // visual properties, including 3D, before reaching this inherited-effect admission.
  const properties = findDirectChild(member.children, {
    namespaceUri: member.namespaceUri,
    localName: 'spPr',
  });
  const direct =
    properties &&
    findDirectChild(properties.children, {
      namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
      localName: 'effectLst',
    });
  const style = findDirectChild(member.children, {
    namespaceUri: member.namespaceUri,
    localName: 'style',
  });
  const reference =
    style &&
    findDirectChild(style.children, {
      namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
      localName: 'effectRef',
    });
  if (!reference) return true;
  const raw = collapseSchemaWhitespace(schemaAttributeValue(reference.attributes, 'idx') ?? '');
  if (!/^\+?\d{1,10}$/.test(raw)) return false;
  const index = Number(raw);
  if (index === 0) return true;
  const effect = resolver && effects.get(resolver)?.(index);
  if (
    !effect ||
    effect.namespaceUri !== DRAWINGML_MAIN_NAMESPACE_URI ||
    effect.localName !== 'effectStyle'
  )
    return false;
  return effect.children.every(
    (child) =>
      !isElement(child) ||
      (child.namespaceUri === DRAWINGML_MAIN_NAMESPACE_URI &&
        child.localName === 'effectLst' &&
        !(direct ?? child).children.some(isElement))
  );
}
