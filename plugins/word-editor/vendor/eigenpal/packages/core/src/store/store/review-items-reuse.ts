// The revision queue of a story edited without touching anything the queue reads.

import type { OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import type { ReviewRevisionItem } from './review-items.ts';
import { locatedSitesIfKnown, locateSites, type SiteLocation } from './review-site-locations.ts';
import { collectRevisionSites, type RevisionSite } from './tree-op-revisions.ts';
import { paragraphOffsetIndex } from './tree-op-segments.ts';
import { setLatestPerPart } from './latest-per-part.ts';

/**
 * `WeakRef` is ES2021 and the workspace tsconfigs pin `lib` at ES2020, so the global is
 * declared here, as `recent-root-cache.ts` does.
 */
interface RootWeakRef {
  deref(): OoxmlNode | undefined;
}
declare const WeakRef: new (target: OoxmlNode) => RootWeakRef;

/** The root each story part last derived a queue for, weakly. */
const lastRoots = new Map<string, RootWeakRef>();

/** Record that `part`'s queue was derived, so the next version can be compared with it. */
export function rememberRevisionRoot(part: OoxmlPart): void {
  setLatestPerPart(lastRoots, part.name, new WeakRef(part.root));
}

/** Changed paragraphs past this many derive the queue again. */
const MAX_CHANGED_PARAGRAPHS = 64;

/** The two body block lists, when the roots differ only inside their body. */
function bodyBlocksOf(
  previousRoot: OoxmlNode,
  root: OoxmlNode
): { readonly before: readonly OoxmlNode[]; readonly after: readonly OoxmlNode[] } | null {
  if (previousRoot.kind === 'textValue' || root.kind === 'textValue') return null;
  if (previousRoot.children.length !== root.children.length) return null;
  let body: { before: readonly OoxmlNode[]; after: readonly OoxmlNode[] } | null = null;
  for (let index = 0; index < root.children.length; index += 1) {
    const a = previousRoot.children[index]!;
    const b = root.children[index]!;
    if (a === b) continue;
    if (body || a.kind !== 'body' || b.kind !== 'body' || a.id !== b.id) return null;
    body = { before: a.children, after: b.children };
  }
  return body;
}

/**
 * The ids of the paragraphs a split or join changed, with the unchanged blocks on either side,
 * when the two body lists differ only in such a run of paragraphs; undefined otherwise. The
 * queue reads which paragraph follows which, so the caller also requires that none of these
 * holds a revision: then no decision can have moved, merged or split.
 */
function splicedParagraphs(blocks: {
  readonly before: readonly OoxmlNode[];
  readonly after: readonly OoxmlNode[];
}): ReadonlySet<string> | undefined {
  const { before, after } = blocks;
  const shorter = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < shorter && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < shorter - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  )
    suffix += 1;
  const changed = [
    ...before.slice(prefix, before.length - suffix),
    ...after.slice(prefix, after.length - suffix),
  ];
  if (changed.length > MAX_CHANGED_PARAGRAPHS) return undefined;
  const ids = new Set<string>();
  for (const node of changed) {
    if (node.kind !== 'paragraph' || holdsParagraph(node)) return undefined;
    ids.add(node.id);
  }
  // The neighbours: a paragraph mark revision reads the paragraph after it.
  for (const neighbour of [before[prefix - 1], before[before.length - suffix]]) {
    if (neighbour && neighbour.kind !== 'textValue') ids.add(neighbour.id);
  }
  return ids;
}

/** A paragraph holding another (a text box's content) is beyond this check. */
function holdsParagraph(node: OoxmlNode, depth = 0): boolean {
  if (node.kind === 'textValue' || depth > 64) return false;
  for (const child of node.children) {
    if (child.kind === 'paragraph' || holdsParagraph(child, depth + 1)) return true;
  }
  return false;
}

function sameLocation(a: SiteLocation | undefined, b: SiteLocation | undefined): boolean {
  return (
    a === b ||
    (!!a && !!b && a.paragraphId === b.paragraphId && a.start === b.start && a.end === b.end)
  );
}

function sameSite(
  a: RevisionSite,
  b: RevisionSite,
  before: ReadonlyMap<string, SiteLocation>,
  after: ReadonlyMap<string, SiteLocation>
): boolean {
  if (a === b) return true;
  return (
    a.node === b.node &&
    a.refused === b.refused &&
    a.refusal === b.refusal &&
    a.paragraphMark === b.paragraphMark &&
    a.propertyChange === b.propertyChange &&
    a.nesting === b.nesting &&
    // The parent is read too: a formatting change reports the difference between its record
    // and the properties around it. Only the paragraph itself may be a new object, being the
    // block that changed.
    (a.parent === b.parent ||
      (a.parent?.kind === 'paragraph' &&
        b.parent?.kind === 'paragraph' &&
        a.parent.id === b.parent.id)) &&
    sameLocation(before.get(a.node.id), after.get(b.node.id))
  );
}

/**
 * The previous version's queue, when the edit since cannot have changed it; otherwise
 * undefined and the caller derives the queue again.
 *
 * Holds when only body paragraphs changed, each replaced by one with the same id and the same
 * length, holding no paragraph of its own, and every revision site is the same node, classified
 * the same, at the same place. A comment marker or a formatting change outside a tracked range
 * is such an edit; a whole-story derivation per comment on a long reviewed document was most of
 * what adding one cost. Same paragraphs in the same order with the same lengths and the same
 * sites at the same offsets is everything the derivation reads from a body paragraph.
 */
export function unchangedRevisionItems(
  part: OoxmlPart,
  itemsOf: (root: OoxmlNode) => readonly ReviewRevisionItem[] | undefined
): readonly ReviewRevisionItem[] | undefined {
  const previousRoot = lastRoots.get(part.name)?.deref();
  if (!previousRoot || previousRoot === part.root) return undefined;
  const previousItems = itemsOf(previousRoot);
  if (!previousItems) return undefined;
  const previousPart = { ...part, root: previousRoot } as OoxmlPart;
  const before = locatedSitesIfKnown(previousPart);
  if (!before) return undefined;
  const blocks = bodyBlocksOf(previousRoot, part.root);
  if (!blocks) return undefined;
  // Paragraphs added or removed (a split, a join) whose neighbourhood holds no revision.
  const spliced = blocks.before.length === blocks.after.length ? null : splicedParagraphs(blocks);
  if (spliced === undefined) return undefined;
  if (spliced === null) {
    // Position by position: the queue reads sibling order (which paragraph follows which), so
    // a block that moved is a change even when it is the same object.
    let changed = 0;
    for (let index = 0; index < blocks.after.length; index += 1) {
      const old = blocks.before[index]!;
      const block = blocks.after[index]!;
      if (old === block) continue;
      if (old.kind !== 'paragraph' || block.kind !== 'paragraph' || old.id !== block.id)
        return undefined;
      if (++changed > MAX_CHANGED_PARAGRAPHS) return undefined;
      if (holdsParagraph(old) || holdsParagraph(block)) return undefined;
      if (paragraphOffsetIndex(old).length !== paragraphOffsetIndex(block).length) return undefined;
    }
  }
  const oldSites = collectRevisionSites(previousPart);
  const newSites = collectRevisionSites(part);
  if (oldSites.length !== newSites.length) return undefined;
  const after = locateSites(part);
  if (spliced) {
    for (const location of before.values()) if (spliced.has(location.paragraphId)) return undefined;
    for (const location of after.values()) if (spliced.has(location.paragraphId)) return undefined;
  }
  for (let index = 0; index < newSites.length; index += 1) {
    const site = newSites[index]!;
    // A move range's preview is the text between its markers, not the site's own.
    if (site.node.kind === 'moveFromRangeStart' || site.node.kind === 'moveToRangeStart')
      return undefined;
    if (!sameSite(oldSites[index]!, site, before, after)) return undefined;
  }
  return previousItems;
}
