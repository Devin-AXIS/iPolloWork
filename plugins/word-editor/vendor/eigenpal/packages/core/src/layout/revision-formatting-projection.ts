import { withoutUnlistedChanges } from './revision-hidden-sites.ts';
import { WML_NAMESPACE_URI, type OoxmlElement, type OoxmlNode } from '@docx-editor.dev/core/store';
import { MAX_XML_DEPTH } from '../store/package/xml-reader.ts';
import { keepsSubtreeMemo } from '../store/package/subtree-memo-policy.ts';
import { isParagraphMarkRevision } from '../store/store/tree-op-nodes.ts';
import { recordedProperties } from '../store/store/tree-op-tracked-properties.ts';
import { cacheProjection } from './bounded-projection-cache.ts';
import {
  paragraphMarkRevisionsOf,
  resolvedChangeSites,
  revisionIncluded,
  revisionFilterSelects,
  revisionProjectionMode,
  type RevisionAttribution,
  type RevisionAuthorFilter,
  type RevisionDisplayMode,
} from './revision-projection.ts';

const projections = new WeakMap<OoxmlElement, Map<string, OoxmlElement>>();
// Unfiltered views need no per-node Map or string key. Keep their two fixed slots weak.
const proposedProjections = new WeakMap<OoxmlElement, OoxmlElement>();
const originalProjections = new WeakMap<OoxmlElement, OoxmlElement>();

/**
 * The formatting change a resolved projection folded into a property element, keyed by the
 * PROJECTED element (the one the run and paragraph walks see). The view shows the accepted
 * formatting as plain, so nothing inline says a change happened; Simple Markup's change bar
 * still has to, and this is the only record left of it.
 */
const resolvedFormatChanges = new WeakMap<OoxmlElement, RevisionAttribution>();

/**
 * The tracked formatting change a resolved view accepted into this `rPr` / `pPr`, if any.
 *
 * A record the review queue leaves out is no change site: Simple Markup draws no bar for a
 * change that has no card. Decided here, at read time, not in the cached projection, because
 * whether a run's record is listed also depends on its paragraph, a node the projection of the
 * run does not see.
 */
export function resolvedFormatChangeOf(
  properties: OoxmlNode | undefined,
  filter?: RevisionAuthorFilter
): RevisionAttribution | null {
  const change =
    properties && properties.kind !== 'textValue'
      ? (resolvedFormatChanges.get(properties) ?? null)
      : null;
  return change && filter?.unlisted?.sites.has(change.nodeId) ? null : change;
}

function named(node: OoxmlNode, name: string): boolean {
  return (
    node.kind !== 'textValue' && node.namespaceUri === WML_NAMESPACE_URI && node.localName === name
  );
}

/**
 * The mark decisions a resolved view answered on a paragraph — an inserted or removed break
 * the reviewer filter still shows, and the paragraph- and mark-property changes the view
 * accepted — for Simple Markup's change bar. Empty in All Markup.
 */
export function resolvedParagraphMarkChangeSites(
  paragraph: OoxmlNode,
  mode: RevisionDisplayMode,
  filter?: RevisionAuthorFilter
): readonly RevisionAttribution[] {
  if (mode === 'all-markup' || paragraph.kind === 'textValue') return [];
  const sites = [...resolvedChangeSites(paragraphMarkRevisionsOf(paragraph), mode, filter)];
  const pPr = paragraph.children.find((child) => child.kind === 'paragraphProperties');
  const paragraphChange = resolvedFormatChangeOf(pPr, filter);
  if (paragraphChange) sites.push(paragraphChange);
  const rPr =
    pPr && pPr.kind !== 'textValue'
      ? pPr.children.find((child) => child.kind === 'runProperties')
      : undefined;
  const markChange = resolvedFormatChangeOf(rPr, filter);
  if (markChange) sites.push(markChange);
  return sites;
}

/** Restore supported formatting records for display, keeping every canonical node untouched. */
export function projectRevisionFormatting(
  node: OoxmlElement,
  mode: RevisionDisplayMode,
  filter?: RevisionAuthorFilter,
  depth = 0
): OoxmlElement {
  const projected = projectedFormatting(node, mode, filter, depth);
  // A block leaves out the records the review queue does not list, after any other projection.
  return depth === 0 ? withoutUnlistedChanges(projected, filter) : projected;
}

function projectedFormatting(
  node: OoxmlElement,
  mode: RevisionDisplayMode,
  filter?: RevisionAuthorFilter,
  depth = 0
): OoxmlElement {
  if ((mode === 'all-markup' && !revisionFilterSelects(filter)) || depth >= MAX_XML_DEPTH)
    return node;
  // Leaf elements and text containers cannot hold a tracked formatting record.
  // Do not retain a per-view map for every property and text element in a large document.
  if (node.children.every((child) => child.kind === 'textValue')) return node;
  const defaultCache = filter
    ? undefined
    : mode === 'proposed'
      ? proposedProjections
      : originalProjections;
  const key = defaultCache ? '' : `${mode}|${filter?.cacheKey ?? ''}`;
  const cached = defaultCache ? defaultCache.get(node) : projections.get(node)?.get(key);
  if (cached) return cached;
  let children: readonly OoxmlNode[] = node.children;
  let resolvedChange: RevisionAttribution | null = null;
  const changeName = named(node, 'pPr') ? 'pPrChange' : named(node, 'rPr') ? 'rPrChange' : null;
  const change = changeName ? children.find((child) => named(child, changeName)) : undefined;
  if (change && change.kind !== 'textValue') {
    const attribute = (name: string): string =>
      change.attributes.find(
        (value) => value.namespaceUri === WML_NAMESPACE_URI && value.localName === name
      )?.value ?? '';
    const date = attribute('date');
    const attribution: RevisionAttribution = {
      kind: 'format',
      nodeId: change.id,
      id: attribute('id'),
      author: attribute('author'),
      ...(date === '' ? {} : { date }),
    };
    const projection = filter ? revisionProjectionMode(filter, attribution, mode) : mode;
    const recorded = projection === 'original' ? recordedProperties(change) : null;
    if (projection === 'proposed') children = children.filter((child) => child !== change);
    // A change the VIEW resolved is a site for Simple Markup; one the filter resolved is not.
    resolvedChange =
      projection === 'proposed' && (!filter || revisionIncluded(filter, attribution))
        ? attribution
        : null;
    if (recorded !== null) {
      if (changeName === 'pPrChange') {
        // CT_PPrBase records neither the paragraph mark nor the section break.
        children = [
          ...recorded.filter((child) => !named(child, 'rPr') && !named(child, 'sectPr')),
          ...children.filter((child) => named(child, 'rPr') || named(child, 'sectPr')),
        ];
      } else {
        // Mark insertion/deletion remains its own decision, independent of formatting.
        children = [
          ...children.filter(isParagraphMarkRevision),
          ...recorded.filter((child) => !isParagraphMarkRevision(child)),
        ];
      }
    }
  }
  let projected: OoxmlNode[] | null = null;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]!;
    // A record describes history. Its nested properties are not live formatting decisions.
    const result =
      child.kind === 'textValue' || child.localName.endsWith('PrChange')
        ? child
        : projectedFormatting(child, mode, filter, depth + 1);
    if (result !== child) projected ??= children.slice(0, index);
    projected?.push(result);
  }
  const result =
    projected || children !== node.children
      ? ({ ...node, children: projected ?? children } as OoxmlElement)
      : node;
  if (resolvedChange) resolvedFormatChanges.set(result, resolvedChange);
  // An unchanged node of leaves answers itself again in a few steps; the identity a caller
  // keys on is the node's own. A changed result is always kept, so its identity is stable.
  if (result === node && !keepsSubtreeMemo(node)) return node;
  if (defaultCache) {
    defaultCache.set(node, result);
    if (result !== node) defaultCache.set(result, result);
    return result;
  }
  let perView = projections.get(node);
  if (!perView) projections.set(node, (perView = new Map()));
  cacheProjection(perView, key, result);
  // A table's cell flow can encounter the projected subtree again.
  if (result !== node) {
    let projectedViews = projections.get(result);
    if (!projectedViews) projections.set(result, (projectedViews = new Map()));
    cacheProjection(projectedViews, key, result);
  }
  return result;
}
