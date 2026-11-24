import type { OoxmlElement, OoxmlNode } from '../package/ooxml-tree.ts';
import { WML_NAMESPACE_URI } from '../package/ooxml-tree.ts';
import {
  registerRevisionSiteNodeIds,
  revisionSiteNodeIdsOf,
  type ReviewRevisionItem,
} from './review-items.ts';
import type { RevisionSite } from './tree-op-revisions.ts';
import { preservedRevisionProperty } from './revision-property-records.ts';

const canonical = (node: OoxmlNode): unknown =>
  node.kind === 'textValue'
    ? node.value
    : [
        node.namespaceUri,
        node.localName,
        node.attributes
          .map((a) => [a.namespaceUri, a.localName, a.value])
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
        node.children.map(canonical),
      ];
const properties = (node: OoxmlElement) =>
  new Map(
    node.children
      .filter(
        (child) =>
          child.kind !== 'textValue' &&
          // The record itself, and what its reject keeps, such as a mark's own insertion, are
          // not formatting.
          !(child.namespaceUri === WML_NAMESPACE_URI && child.localName === 'rPrChange') &&
          !preservedRevisionProperty('rPrChange', child)
      )
      .map((child) =>
        child.kind === 'textValue'
          ? ['', '']
          : [
              JSON.stringify([child.namespaceUri, child.localName]),
              JSON.stringify(canonical(child)),
            ]
      )
  );

/**
 * Compare the formatting delta, including properties not exposed by UI summaries. A paragraph
 * mark's record has one only when `marks` asks for it: run grouping keeps to text.
 */
export function runFormattingSignature(site: RevisionSite, marks = false): string | undefined {
  if (
    site.node.localName !== 'rPrChange' ||
    !site.parent ||
    (site.paragraphMark && !marks) ||
    site.refused
  )
    return;
  const previous = site.node.children.find(
    (node) =>
      node.kind !== 'textValue' &&
      node.namespaceUri === WML_NAMESPACE_URI &&
      node.localName === 'rPr'
  );
  if (!previous || previous.kind === 'textValue') return;
  const before = properties(previous);
  const after = properties(site.parent);
  const changes = [...new Set([...before.keys(), ...after.keys()])]
    .sort()
    .filter((key) => before.get(key) !== after.get(key))
    .map((key) => [key, after.get(key) ?? null]);
  return changes.length ? JSON.stringify(changes) : undefined;
}

export function groupAdjacentRunFormatting(
  items: readonly ReviewRevisionItem[],
  sites: readonly RevisionSite[],
  /** Where the item sits: a wrapper's edge or a field character ends a change. */
  segmentOf: (item: ReviewRevisionItem) => string = () => ''
): ReviewRevisionItem[] {
  const signatures = new Map(sites.map((site) => [site.node.id, runFormattingSignature(site)]));
  const buckets = new Map<string, ReviewRevisionItem[]>();
  for (const item of items) {
    if (
      item.revisionKind !== 'format' ||
      item.formattingKind !== 'rPrChange' ||
      item.readOnly ||
      item.ranges.length !== 1
    )
      continue;
    const range = item.ranges[0]!;
    if (
      range.start.paragraphId !== range.end.paragraphId ||
      range.start.offset === range.end.offset
    )
      continue;
    const ids = revisionSiteNodeIdsOf(item);
    const change = ids.length ? signatures.get(ids[0]!) : undefined;
    if (!change || !ids.every((id) => signatures.get(id) === change)) continue;
    const key = JSON.stringify([
      item.author,
      range.partName,
      range.start.paragraphId,
      change,
      segmentOf(item),
    ]);
    const bucket = buckets.get(key) ?? [];
    bucket.push(item);
    buckets.set(key, bucket);
  }
  const consumed = new Set<ReviewRevisionItem>();
  const replacements = new Map<ReviewRevisionItem, ReviewRevisionItem>();
  const close = (chain: ReviewRevisionItem[]) => {
    if (chain.length < 2) return;
    const first = chain[0]!;
    const addresses = [
      ...new Map(
        chain
          .flatMap((item) => item.addresses)
          .map((address) => [
            JSON.stringify([address.id, address.author, address.date ?? null]),
            address,
          ])
      ).values(),
    ];
    replacements.set(
      first,
      registerRevisionSiteNodeIds(
        {
          ...first,
          addresses,
          ranges: chain.flatMap((item) => item.ranges),
          text: chain.map((item) => item.text).join(''),
        },
        chain.flatMap(revisionSiteNodeIdsOf)
      )
    );
    for (const item of chain.slice(1)) consumed.add(item);
  };
  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => a.ranges[0]!.start.offset - b.ranges[0]!.start.offset);
    let chain: ReviewRevisionItem[] = [];
    for (const item of bucket) {
      if (
        chain.length &&
        chain[chain.length - 1]!.ranges[0]!.end.offset !== item.ranges[0]!.start.offset
      ) {
        close(chain);
        chain = [];
      }
      chain.push(item);
    }
    close(chain);
  }
  return items.filter((item) => !consumed.has(item)).map((item) => replacements.get(item) ?? item);
}
