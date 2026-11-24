// Paint no markup for revision records the review queue leaves out.
//
// A property change that resolves to the same formatting has no review card, so its paragraph
// gets no change bar and its text no format mark either. The filter carries the records as data:
// only the paragraphs that hold one project without it, and every other block keeps the
// unfiltered fast path, because a selecting filter projects the whole story. The cache key
// names the records, so a block cached with them left out is never served as the canonical one.

import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
} from '../store/package/ooxml-tree.ts';
import { EMPTY_REVISION_AUTHOR_SET, type RevisionAuthorFilter } from './revision-projection.ts';
import { MAX_XML_DEPTH } from '../store/package/xml-reader.ts';
import { stableHash } from '../store/comparators/canonical.ts';

/** Records with no card, by change-element node id, and the paragraphs that hold them. */
export type UnlistedRevisionSites = NonNullable<RevisionAuthorFilter['unlisted']>;

const composed = new WeakMap<
  object,
  WeakMap<UnlistedRevisionSites, { all?: RevisionAuthorFilter; resolved?: RevisionAuthorFilter }>
>();
const recordsKeys = new WeakMap<UnlistedRevisionSites, string>();

/** A key over which records each paragraph holds. */
function recordsKey(unlisted: UnlistedRevisionSites): string {
  let key = recordsKeys.get(unlisted);
  if (key === undefined) {
    key = stableHash([...unlisted.paragraphs].sort(([a], [b]) => a.localeCompare(b)));
    recordsKeys.set(unlisted, key);
  }
  return key;
}
const NO_FILTER = {};

/**
 * `base` carrying `unlisted`, the same object for the same pair, or `base` itself when there is
 * nothing to leave out.
 *
 * The cache key keeps a block cached with the records left out apart from the canonical block.
 * In All Markup it names only the styles and numbering the records were decided against: there,
 * leaving a record out changes the paragraph's content, which content-keyed layout caches see,
 * so a key over the records would relay the whole document out whenever a paragraph split
 * copied one. A resolved view (`resolved`, as Simple Markup is) has already dropped the records
 * from the content and keeps only a change site beside it, which those caches do not see, so
 * its key also names which records each paragraph holds.
 */
export function withHiddenRevisionSites(
  base: RevisionAuthorFilter | undefined,
  unlisted: UnlistedRevisionSites,
  resolved = false
): RevisionAuthorFilter | undefined {
  if (unlisted.sites.size === 0) return base;
  const byUnlisted = composed.get(base ?? NO_FILTER) ?? new WeakMap();
  composed.set(base ?? NO_FILTER, byUnlisted);
  const views = byUnlisted.get(unlisted) ?? {};
  byUnlisted.set(unlisted, views);
  const slot = resolved ? 'resolved' : 'all';
  let filter = views[slot];
  if (!filter) {
    const records = resolved ? `:${recordsKey(unlisted)}` : '';
    filter = Object.freeze({
      ...(base ?? { hiddenAuthors: EMPTY_REVISION_AUTHOR_SET }),
      cacheKey: `${base?.cacheKey ?? ''}|unlisted:${unlisted.key}${records}`,
      unlisted,
    });
    views[slot] = filter;
  }
  return filter;
}

const stripped = new WeakMap<OoxmlNode, { sites: ReadonlySet<string>; result: OoxmlNode }>();

function isUnlistedChange(node: OoxmlNode, sites: ReadonlySet<string>): boolean {
  return (
    node.kind !== 'textValue' &&
    node.namespaceUri === WML_NAMESPACE_URI &&
    (node.localName === 'pPrChange' || node.localName === 'rPrChange') &&
    sites.has(node.id)
  );
}

function strip(node: OoxmlNode, sites: ReadonlySet<string>, depth: number): OoxmlNode {
  if (node.kind === 'textValue' || depth >= MAX_XML_DEPTH) return node;
  let children: OoxmlNode[] | null = null;
  node.children.forEach((child, index) => {
    const next = isUnlistedChange(child, sites) ? null : strip(child, sites, depth + 1);
    if (next === child) {
      children?.push(child);
      return;
    }
    children ??= node.children.slice(0, index);
    if (next) children.push(next);
  });
  return children ? ({ ...node, children } as OoxmlElement) : node;
}

/** `block` without the unlisted records it holds, or `block` itself when it holds none. */
export function withoutUnlistedChanges<T extends OoxmlNode>(
  block: T,
  filter: RevisionAuthorFilter | undefined
): T {
  const unlisted = filter?.unlisted;
  if (!unlisted || block.kind !== 'paragraph' || !unlisted.paragraphs.has(block.id)) return block;
  const sites = unlisted.sites;
  const known = stripped.get(block);
  if (known && known.sites === sites) return known.result as T;
  const result = strip(block, sites, 0) as T;
  stripped.set(block, { sites, result });
  return result;
}
