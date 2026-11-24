// What a list IS, read out of a story.
//
// A `.docx` has no list element. `numbering.xml` defines abstract formats and `w:num` instances
// of them, and a paragraph joins one by carrying `w:pPr/w:numPr/w:numId`. So a list is an
// EQUIVALENCE CLASS over the story's paragraphs, and "the paragraphs of list 3" is a filter, not
// a walk of a container. Two paragraphs at opposite ends of a document with prose and another
// list between them are in the same list if they name the same number; Word agrees.
//
// LEVEL, NOT MARKER. This lane answers `w:ilvl` — the level a paragraph declares, which is what
// selects its format and what Increase/Decrease Indent moves — and nothing about the string the
// marker paints. The marker is a COUNTER: it depends on every earlier paragraph in the document,
// on `w:lvlText`, on `w:start`, on `w:lvlRestart` and on `w:startOverride`, and the layout lane
// already owns that arithmetic. A second implementation here would eventually disagree with the
// page, and a caller told `2.` while the document paints `b)` is worse off than one told the
// engine does not answer that question (see the recorded omissions for `listString` and
// `siblingIndex`).

import type { OoxmlNode } from '../store/package/ooxml-tree.ts';
import { WML_NAMESPACE_URI } from '../store/package/ooxml-shared.ts';
import { namedChild, paragraphPropertiesNodeOf } from '../store/store/tree-op-nodes.ts';
import type { AutomationStoryReads } from './reads.ts';

/**
 * Word's own ceiling: nine levels, `w:ilvl` 0-8 (ECMA-376 17.9.4).
 *
 * A level outside it is refused rather than clamped — `numbering.xml` defines no format for it,
 * so a paragraph put there numbers with nothing and paints no marker at all.
 */
export const MAX_LIST_LEVEL = 8;

/** What a paragraph declares about its numbering, or null when it declares none. */
export interface AutomationListMembership {
  /** `w:numId` as the file writes it — a decimal string, kept as one because that is the id. */
  readonly numId: string;
  /** `w:ilvl`, or 0 where the paragraph names a number and no level. */
  readonly level: number;
}

/** One list of a story: its number, and the paragraphs that name it in reading order. */
export interface AutomationListRead {
  readonly numId: string;
  readonly paragraphIds: readonly string[];
}

function wmlValue(node: OoxmlNode | undefined): string | null {
  if (!node || node.kind === 'textValue') return null;
  for (const attribute of node.attributes) {
    if (attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === 'val') {
      return attribute.value;
    }
  }
  return null;
}

/**
 * Read `w:numPr` off one paragraph.
 *
 * `w:numId="0"` is not a list. ECMA-376 gives it the meaning "no numbering", and Word writes it
 * when a style numbers a paragraph and the paragraph turns it off — so treating it as a list
 * would report a list whose items paint no markers, and would let a caller move levels inside it.
 */
export function listMembershipOf(paragraph: OoxmlNode): AutomationListMembership | null {
  const numPr = namedChild(paragraphPropertiesNodeOf(paragraph), 'numPr');
  if (!numPr) return null;
  const numId = wmlValue(namedChild(numPr, 'numId'));
  if (numId === null || !/^\d{1,10}$/.test(numId) || numId === '0') return null;
  const raw = wmlValue(namedChild(numPr, 'ilvl'));
  const level = raw === null ? 0 : Number(raw);
  if (!Number.isInteger(level) || level < 0 || level > MAX_LIST_LEVEL) return null;
  return { numId, level };
}

/**
 * Every list of one story, in the order each number FIRST appears.
 *
 * First-appearance order rather than numeric: `w:numId` values are allocation order in
 * `numbering.xml`, not document order, so sorting by them would answer a document's lists in an
 * order nothing on the page explains.
 */
export function listReads(reads: AutomationStoryReads): readonly AutomationListRead[] {
  const byNumId = new Map<string, string[]>();
  for (const paragraphId of reads.paragraphIds) {
    const node = reads.node(paragraphId);
    if (!node) continue;
    const membership = listMembershipOf(node);
    if (!membership) continue;
    const existing = byNumId.get(membership.numId);
    if (existing) existing.push(paragraphId);
    else byNumId.set(membership.numId, [paragraphId]);
  }
  return Object.freeze(
    [...byNumId].map(([numId, paragraphIds]) =>
      Object.freeze({ numId, paragraphIds: Object.freeze(paragraphIds) })
    )
  );
}

/** One story's membership read for a paragraph it holds, or null. */
export function membershipIn(
  reads: AutomationStoryReads,
  paragraphId: string
): AutomationListMembership | null {
  const node = reads.node(paragraphId);
  return node ? listMembershipOf(node) : null;
}
