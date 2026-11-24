// The paragraph indent a list level change gives up (tree-ops seam).
//
// A list level states where its marker and its text go (`w:lvl/w:pPr/w:ind`, §17.9.6), and a
// paragraph's own `w:ind` outranks it (§17.3.1.12). An item whose paragraph states its own
// left or hanging indent would change its marker to the new level's and stay where it was.
// So a level change removes the paragraph's own leading-edge and first-line attributes, and
// the item takes its new level's indent. The trailing edge is not the level's to set and
// stays. Pure, like the rest of op application.

import { WML_NAMESPACE_URI, type OoxmlNode, type OoxmlPart } from '../package/ooxml-tree.ts';
import {
  findNode,
  removeNode,
  replaceNode,
  type EditOptions,
  type OoxmlEditResult,
} from '../package/ooxml-edit.ts';
import { namedChild, paragraphPropertiesNodeOf } from './tree-op-nodes.ts';

/**
 * The `w:ind` attributes a list level states: the leading edge and the first line, in twips
 * and in character units, in both spellings of the leading edge. A level change drops these
 * from the paragraph's own `w:ind`, whether the change goes through `w:numPr` or a style.
 *
 * @internal
 */
export const LEVEL_INDENT_ATTRIBUTES: ReadonlySet<string> = new Set([
  'left',
  'start',
  'leftChars',
  'startChars',
  'firstLine',
  'hanging',
  'firstLineChars',
  'hangingChars',
]);

/**
 * `part` without the paragraph's own leading-edge and first-line indent, so the list level it
 * moved to places it. `w:right`, `w:end` and their character units stay; a `w:ind` left with
 * no attribute goes. A paragraph with no such attribute is returned unchanged.
 */
export function withoutOwnLevelIndent(
  part: OoxmlPart,
  paragraphId: string,
  options: EditOptions | undefined
): OoxmlEditResult {
  const paragraph = findNode(part, paragraphId);
  const ind = paragraph ? namedChild(paragraphPropertiesNodeOf(paragraph), 'ind') : undefined;
  if (!ind) return { ok: true, part };
  const kept = ind.attributes.filter(
    (attribute) =>
      attribute.namespaceUri !== WML_NAMESPACE_URI ||
      !LEVEL_INDENT_ATTRIBUTES.has(attribute.localName)
  );
  if (kept.length === ind.attributes.length) return { ok: true, part };
  if (kept.length === 0 && ind.children.length === 0) return removeNode(part, ind.id, options);
  // The same element with fewer of its own attributes, as `withoutSectionMark` narrows children.
  return replaceNode(part, ind.id, { ...ind, attributes: kept } as OoxmlNode, options);
}
