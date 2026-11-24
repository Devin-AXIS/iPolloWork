// The character style of the first run in a paragraph that had nothing in it.
//
// A paragraph with no content shows only its MARK: layout sizes the empty line from the mark's
// formatting, character style included, and the toolbar reports that face at the caret. Text
// typed there takes the same formatting, `w:rStyle` included, and zero-length runs do not
// count: a paragraph whose runs hold nothing is still empty.
//
// The mark's DIRECT properties reach the typed text through the editor's caret format, because
// they are in the accepted run vocabulary. `w:rStyle`, `w:rtl`, and `w:cs` are preserved, not accepted
// (`tree-op-types.ts`), so property writes cannot carry them. Insertion copies them itself,
// when it mints the run. The value is the paragraph's own authored reference, never a caller's,
// so the vocabulary an op may write stays as it was.

import { withFreshIds } from '../package/hf-lifecycle-shell.ts';
import { WML_NAMESPACE_URI } from '../package/ooxml-shared.ts';
import type { OoxmlNode, OoxmlParagraphNode } from '../package/ooxml-tree.ts';
import { propertyContainer } from './direct-properties.ts';
import { segmentsOf } from './tree-op-segments.ts';

/** A `w:rStyle` naming `styleId`, the first child a `w:rPr` may hold (CT_RPr). */
export function characterStyleElement(nextId: () => string, styleId: string): OoxmlNode {
  return {
    id: nextId(),
    kind: 'generic',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'rStyle',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [
      {
        kind: 'genericExtension',
        namespaceUri: WML_NAMESPACE_URI,
        localName: 'val',
        prefix: 'w',
        value: styleId,
      },
    ],
    children: [],
  } as unknown as OoxmlNode;
}

/**
 * The character style the mark of a paragraph with NO content names, or `undefined`.
 *
 * `undefined` for a paragraph with any addressable content (text, tab, break, field, drawing,
 * struck text): typing there joins a neighbouring run, which is where its formatting comes from.
 */
export function emptyParagraphMarkStyle(paragraph: OoxmlParagraphNode): string | undefined {
  if (segmentsOf(paragraph).length > 0) return undefined;
  const mark = propertyContainer(
    propertyContainer(paragraph, 'paragraphProperties', 'pPr'),
    'runProperties',
    'rPr'
  );
  if (!mark || mark.kind === 'textValue') return undefined;
  const reference = mark.children.find(
    (child) =>
      child.kind !== 'textValue' &&
      child.localName === 'rStyle' &&
      child.namespaceUri === WML_NAMESPACE_URI
  );
  if (!reference || reference.kind === 'textValue') return undefined;
  const styleId = reference.attributes.find(
    (attribute) => attribute.localName === 'val' && attribute.namespaceUri === WML_NAMESPACE_URI
  )?.value;
  return styleId ? styleId : undefined;
}

/**
 * The `w:rPr` of the run minted for the first content of an empty paragraph, or `[]` when its
 * mark names no character style or complex-script flag. Place it ahead of the content.
 */
export function emptyParagraphRunProperties(
  paragraph: OoxmlParagraphNode,
  nextId: () => string
): OoxmlNode[] {
  if (segmentsOf(paragraph).length > 0) return [];
  const styleId = emptyParagraphMarkStyle(paragraph);
  const children: OoxmlNode[] =
    styleId === undefined ? [] : [characterStyleElement(nextId, styleId)];
  const mark = propertyContainer(
    propertyContainer(paragraph, 'paragraphProperties', 'pPr'),
    'runProperties',
    'rPr'
  );
  if (mark && mark.kind !== 'textValue') {
    for (const child of mark.children) {
      if (
        child.kind !== 'textValue' &&
        child.namespaceUri === WML_NAMESPACE_URI &&
        (child.localName === 'rtl' || child.localName === 'cs')
      ) {
        children.push(withFreshIds(child, nextId));
      }
    }
  }
  if (children.length === 0) return [];
  // An empty run that carries exactly the mark's formatting is the face the paragraph was
  // given, a new table row's seed run among them: keep all of it. Any other empty run keeps
  // its formatting to itself, so typed text shows the face the toolbar reported for the mark.
  const seeded = agreeingEmptyRunProperties(paragraph, mark);
  if (seeded) return [withFreshIds(seeded, nextId)];
  return [
    {
      id: nextId(),
      kind: 'runProperties',
      namespaceUri: WML_NAMESPACE_URI,
      localName: 'rPr',
      prefix: 'w',
      namespaceBindings: [],
      attributes: [],
      children,
    } as unknown as OoxmlNode,
  ];
}

/**
 * Not carried into new text: another author's pending format change belongs to the run it
 * was proposed on, and hidden formatting would hide the words being typed.
 */
export const NOT_INHERITED: ReadonlySet<string> = new Set([
  'ins',
  'del',
  'moveFrom',
  'moveTo',
  'rPrChange',
  'vanish',
  'specVanish',
  'webHidden',
]);

/**
 * One element as a canonical key: its namespace and name, every attribute (namespace, name,
 * value, sorted), and its element children the same way, at every depth. Two properties agree
 * only when all of it agrees: `w:rFonts` has no `w:val`, and `w:color w:themeColor`,
 * `w:u w:color`, `w:lang w:eastAsia`, and `w:shd w:fill` differ beside an equal `w:val`.
 */
function elementKey(node: OoxmlNode): string {
  if (node.kind === 'textValue') return '';
  const attributes = node.attributes
    .map((attribute) =>
      JSON.stringify([attribute.namespaceUri, attribute.localName, attribute.value])
    )
    .sort();
  const children = node.children
    .filter((child) => child.kind !== 'textValue')
    .map(elementKey)
    .sort();
  return JSON.stringify([node.namespaceUri, node.localName, attributes, children]);
}

/** A run-properties element's inherited children, as canonical keys. */
function inheritedKeys(rPr: OoxmlNode): string[] {
  if (rPr.kind === 'textValue') return [];
  return rPr.children
    .filter(
      (child) =>
        child.kind !== 'textValue' &&
        child.namespaceUri === WML_NAMESPACE_URI &&
        !NOT_INHERITED.has(child.localName)
    )
    .map(elementKey)
    .sort();
}

/**
 * The last run's `w:rPr`, without what new text never inherits, when it states exactly what
 * the paragraph mark states: the same properties with the same attributes, nothing more or less.
 */
function agreeingEmptyRunProperties(
  paragraph: OoxmlParagraphNode,
  mark: OoxmlNode | undefined
): OoxmlNode | undefined {
  if (!mark || mark.kind === 'textValue') return undefined;
  const runs = paragraph.children.filter((child) => child.kind === 'run');
  const last = runs[runs.length - 1];
  if (!last) return undefined;
  const rPr = (last.children as readonly OoxmlNode[]).find(
    (child) =>
      child.kind !== 'textValue' &&
      child.namespaceUri === WML_NAMESPACE_URI &&
      child.localName === 'rPr'
  );
  if (!rPr || rPr.kind === 'textValue') return undefined;
  if (JSON.stringify(inheritedKeys(rPr)) !== JSON.stringify(inheritedKeys(mark))) return undefined;
  const kept = rPr.children.filter(
    (child) => child.kind === 'textValue' || !NOT_INHERITED.has(child.localName)
  );
  return { ...rPr, children: kept } as OoxmlNode;
}
