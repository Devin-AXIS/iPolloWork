import { WML_NAMESPACE_URI, type OoxmlElement, type OoxmlNode } from '../package/ooxml-tree.ts';
import { cloneWithNewIds } from './tree-op-nodes.ts';
import { PARAGRAPH_VOCABULARY, propertyElement, schemaInsertIndex } from './tree-op-properties.ts';

/**
 * The tail's `w:pPr`: a clone of the head's, with `w:pStyle` restated when the caller named
 * one.
 *
 * The clone is the default because every other paragraph property survives an Enter in Word
 * — centring, spacing, borders. A different following style also drops direct numbering,
 * allowing the new style to decide whether the following paragraph is a list item.
 * A tail left with nothing in its `w:pPr` drops the container rather than serializing an
 * empty one, so a paragraph whose only property was its style digests like one that never
 * had any.
 */
export function withTailStyle(
  pPr: OoxmlElement | undefined,
  tailStyleId: string | null | undefined,
  nextId: () => string
): OoxmlNode | undefined {
  if (tailStyleId === undefined) return pPr ? cloneWithNewIds(pPr, nextId) : undefined;
  const currentStyle = pPr?.children.find(
    (child) => child.kind !== 'textValue' && child.localName === 'pStyle'
  );
  const currentStyleId =
    currentStyle && currentStyle.kind !== 'textValue'
      ? (currentStyle.attributes.find((attribute) => attribute.localName === 'val')?.value ?? null)
      : null;
  const kept = (pPr?.children ?? []).filter(
    (child) =>
      child.kind === 'textValue' ||
      (child.localName !== 'pStyle' &&
        (child.localName !== 'numPr' || tailStyleId === currentStyleId))
  );
  const children = kept.map((child) => cloneWithNewIds(child, nextId));
  if (tailStyleId !== null) {
    children.splice(
      schemaInsertIndex(children, PARAGRAPH_VOCABULARY.sequence, 'pStyle'),
      0,
      propertyElement({ localName: 'pStyle', attributes: { val: tailStyleId } }, nextId())
    );
  }
  if (children.length === 0) return undefined;
  if (pPr) return { ...pPr, id: nextId(), children } as unknown as OoxmlNode;
  return {
    id: nextId(),
    kind: 'paragraphProperties',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'pPr',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children,
  } as unknown as OoxmlNode;
}
