// Leave property changes that change nothing out of the review queue.
//
// A tracked paragraph or run property change whose earlier and current properties resolve to
// the same formatting is not a decision anyone can make: Accept and Reject leave the document
// looking the same. Such records are left out of the queue, the rail and navigation. They stay
// in the file, and Accept All or Reject All over the whole document still clears them, because
// that resolves every site in each story rather than the listed items.

import {
  paragraphChangeIsInert,
  propertyChangeContext,
  runChangeIsInert,
  type PropertyChangeContext,
} from './revision-property-effect.ts';
import { findNode, parentNodeOf } from '../store/package/ooxml-edit.ts';
import { linkRevisionReplies } from '../store/store/review-reads.ts';
import { numberingRootOf, stylesPartOf } from '../store/package/ooxml-indexes.ts';
import { findParagraphProperties } from './style-definition-reader.ts';
import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import type { OoxmlElement, OoxmlPart } from '../store/package/ooxml-tree.ts';
import {
  revisionSiteNodeIdsOf,
  type ReviewItem,
  type ReviewRevisionItem,
} from '../store/store/review-items.ts';

/** The package a queue was derived from, with its styles and numbering roots. */
export interface InertPropertyChangeInputs {
  readonly pkg: OoxmlPackage;
  readonly stylesRoot: OoxmlElement | null;
  readonly numberingRoot: OoxmlElement | null;
}

/** The inputs for `pkg`: its own styles and numbering parts, as every reader picks them. */
export function inertPropertyChangeInputsOf(pkg: OoxmlPackage): InertPropertyChangeInputs {
  return { pkg, stylesRoot: stylesPartOf(pkg)?.root ?? null, numberingRoot: numberingRootOf(pkg) };
}

/** How far up a change element can sit below its paragraph: rPr, run, wrappers, paragraph. */
const MAX_ANCESTORS = 64;

/** The answer per change element, valid while its context and containers are unchanged. */
const answers = new WeakMap<
  OoxmlElement,
  {
    readonly context: PropertyChangeContext;
    readonly current: OoxmlElement;
    readonly paragraph: OoxmlElement | undefined;
    readonly inert: boolean;
  }
>();

function isCandidate(item: ReviewItem): item is ReviewRevisionItem {
  return (
    item.kind === 'revision' &&
    item.revisionKind === 'format' &&
    (item.formattingKind === 'pPrChange' || item.formattingKind === 'rPrChange') &&
    // A record nobody can resolve keeps its card, which says why it stays in the file.
    !item.readOnly &&
    item.ranges.length > 0
  );
}

/**
 * The paragraph holding `id`, or null when it sits in a table cell, in a text box, or in no
 * paragraph.
 */
function paragraphAbove(part: OoxmlPart, id: string): OoxmlElement | null {
  let paragraph: OoxmlElement | null = null;
  let current = parentNodeOf(part, id);
  for (let depth = 0; current && depth < MAX_ANCESTORS; depth += 1) {
    // Table styles are not resolved by the check, so content in a table always lists.
    // A cell demoted to a generic node is still a cell.
    if (current.kind === 'tableCell' || current.localName === 'tc') return null;
    if (current.kind === 'paragraph') {
      // A paragraph inside a paragraph is text box content. Its marks are painted whatever
      // the check decides, so a site there always lists.
      if (paragraph) return null;
      paragraph = current;
    }
    current = parentNodeOf(part, current.id);
  }
  return current ? null : paragraph;
}

function siteIsInert(
  part: OoxmlPart,
  id: string,
  context: PropertyChangeContext,
  located: ReadonlySet<string>
): boolean {
  const change = findNode(part, id);
  if (!change || change.kind === 'textValue') return false;
  const current = parentNodeOf(part, id);
  if (!current) return false;
  const paragraph = paragraphAbove(part, current.id);
  // A site in a paragraph the item has no range in could not be left unmarked on the page, so
  // the record keeps its card.
  if (!paragraph || !located.has(paragraph.id)) return false;
  const pPr = findParagraphProperties(paragraph);
  const known = answers.get(change);
  if (known && known.context === context && known.current === current && known.paragraph === pPr) {
    return known.inert;
  }
  const inert =
    change.localName === 'pPrChange'
      ? current === pPr && paragraphChangeIsInert(context, change, current)
      : change.localName === 'rPrChange' && runChangeIsInert(context, change, current, pPr);
  answers.set(change, { context, current, paragraph: pPr, inert });
  return inert;
}

function isInert(
  item: ReviewItem,
  inputs: InertPropertyChangeInputs,
  context: PropertyChangeContext
): boolean {
  if (!isCandidate(item)) return false;
  const part = inputs.pkg.parts.get(item.ranges[0]!.partName);
  const ids = revisionSiteNodeIdsOf(item);
  const located = new Set(item.ranges.map((range) => range.start.paragraphId));
  return !!part && ids.length > 0 && ids.every((id) => siteIsInert(part, id, context, located));
}

export function withoutInertPropertyChanges<T extends ReviewItem>(
  items: readonly T[],
  inputs: InertPropertyChangeInputs
): readonly T[] {
  if (!items.some(isCandidate)) return items;
  const context = propertyChangeContext(inputs.stylesRoot, inputs.numberingRoot);
  const kept = items.filter((item) => !isInert(item, inputs, context));
  // A comment on exactly the hidden change's characters answered that card; relink so it hangs
  // on whatever card now holds those characters, or stands alone.
  return kept.length === items.length ? items : linkRevisionReplies(kept);
}

/**
 * The records {@link withoutInertPropertyChanges} leaves out, for a bulk decision that names no
 * keys: Accept All and Reject All clear them with the listed changes.
 */
export function inertPropertyChanges(
  items: readonly ReviewRevisionItem[],
  inputs: InertPropertyChangeInputs
): readonly ReviewRevisionItem[] {
  if (!items.some(isCandidate)) return [];
  const context = propertyChangeContext(inputs.stylesRoot, inputs.numberingRoot);
  return items.filter((item) => isInert(item, inputs, context));
}
