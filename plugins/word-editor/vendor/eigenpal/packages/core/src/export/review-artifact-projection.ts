// Normalize comments and tracked changes onto the exact layout/package revision being published.

import { withHyphenGlyphs } from '../store/package/hyphen-text.ts';
import {
  commentBodyText,
  commentInitials,
  commentPartNameOf,
  commentsExtendedPartNameOf,
  reviewItemRanges,
  resolveHeaderFooterPartsBySection,
  resolveNotesPart,
  type OoxmlPackage,
  type OoxmlNode,
  type OoxmlPart,
  type ReviewItem,
  type ReviewRange,
} from '@docx-editor.dev/core/store';
import { createExportReviewDerivationScope } from '../store/store/review-export-derivation.ts';
import {
  inertPropertyChangeInputsOf,
  withoutInertPropertyChanges,
} from '../layout/review-inert-property-changes.ts';
import {
  collectRevisionSites,
  isPotentialRevisionElement,
} from '../store/store/tree-op-revisions.ts';
import { stylesAndNumberingKey, unlistedSitesOf } from '../store/store/review-unlisted-sites.ts';
import { numberingRootOf, stylesPartOf } from '../store/package/ooxml-indexes.ts';
import { attribute } from '../store/package/comment-lifecycle-scan.ts';
import { WML_NAMESPACE_URI } from '../store/package/ooxml-tree.ts';
import type { UnlistedRevisionSites } from '../layout/revision-hidden-sites.ts';
import {
  forEachSemanticDrawing,
  forEachSemanticStory,
  forEachStoryParagraphFragment,
  type SemanticStoryVisit,
} from '../layout/semantic-record-queries.ts';
import type { SemanticLayout } from '../layout/semantic-records.ts';
import type {
  SemanticArtifactStoryKind,
  SemanticReviewArtifactOccurrence,
  SemanticReviewArtifactRecord,
} from '../layout/review-artifact-records.ts';

interface ParagraphOccurrence {
  readonly pageIndex: number;
  readonly story: SemanticArtifactStoryKind;
  readonly rootStory: Exclude<SemanticArtifactStoryKind, 'textbox'>;
  readonly textboxPath: readonly string[];
  readonly noteScopeId: string | null;
  readonly noteAreaKind: 'footnotes' | 'endnotes' | null;
  /** Authored Word story lane, including note scope and exact nested textbox path. */
  readonly laneKey: string;
  readonly intervals: Array<{ readonly start: number; readonly end: number }>;
  intervalKeys?: Set<string>;
}

interface ParagraphBounds {
  readonly lower: number;
  readonly upper: number;
}

interface ParagraphOccurrenceIndex {
  readonly byPart: ReadonlyMap<string, ReadonlyMap<string, readonly ParagraphOccurrence[]>>;
  readonly orderByPart: ReadonlyMap<string, ReadonlyMap<string, number>>;
  readonly visibleByPart: ReadonlyMap<
    string,
    readonly {
      readonly paragraphId: string;
      readonly position: number;
      readonly laneKeys: ReadonlySet<string>;
    }[]
  >;
}

function hasReviewMarkup(
  parts: readonly OoxmlPart[],
  commentsPart: OoxmlPart | undefined
): boolean {
  // A comments part can contain unanchored comments, so its presence alone requires derivation.
  if (commentsPart) return true;
  const pending: OoxmlNode[] = parts.map((part) => part.root);
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (isPotentialRevisionElement(node)) return true;
    if (node.kind !== 'textValue') {
      for (const child of node.children) pending.push(child);
    }
  }
  return false;
}

function storyParts(pkg: OoxmlPackage, main: OoxmlPart): readonly OoxmlPart[] {
  const parts: OoxmlPart[] = [];
  const seen = new Set<string>([main.name]);
  const add = (part: OoxmlPart | null | undefined): void => {
    if (!part || seen.has(part.name)) return;
    seen.add(part.name);
    parts.push(part);
  };
  for (const section of resolveHeaderFooterPartsBySection(pkg)) {
    for (const part of section.headers.values()) add(part);
    for (const part of section.footers.values()) add(part);
  }
  add(resolveNotesPart(pkg, 'footnote'));
  add(resolveNotesPart(pkg, 'endnote'));
  return parts;
}

function rootPartName(pkg: OoxmlPackage, root: SemanticStoryVisit): string | null {
  switch (root.story) {
    case 'body':
      return pkg.mainDocumentPart;
    case 'header':
    case 'footer':
      return root.host.partName;
    case 'footnote':
      return resolveNotesPart(pkg, 'footnote')?.name ?? null;
    case 'endnote':
      return resolveNotesPart(pkg, 'endnote')?.name ?? null;
    case 'note-separator':
      return (
        resolveNotesPart(pkg, root.noteAreaKind === 'footnotes' ? 'footnote' : 'endnote')?.name ??
        null
      );
    default:
      return root satisfies never;
  }
}

function paragraphBoundsByPart(
  ranges: readonly ReviewRange[],
  orderByPart: ReadonlyMap<string, ReadonlyMap<string, number>>
): ReadonlyMap<string, ParagraphBounds> {
  const bounds = new Map<string, ParagraphBounds>();
  for (const range of ranges) {
    const order = orderByPart.get(range.partName);
    const start = order?.get(range.start.paragraphId);
    const end = order?.get(range.end.paragraphId);
    if (start === undefined || end === undefined) continue;
    const lower = Math.min(start, end);
    const upper = Math.max(start, end);
    const previous = bounds.get(range.partName);
    bounds.set(range.partName, {
      lower: Math.min(previous?.lower ?? lower, lower),
      upper: Math.max(previous?.upper ?? upper, upper),
    });
  }
  return bounds;
}

function paragraphOccurrences(
  layout: SemanticLayout,
  pkg: OoxmlPackage,
  parts: readonly OoxmlPart[],
  ranges: readonly ReviewRange[],
  deepOrder: (part: OoxmlPart) => ReadonlyMap<string, number>
): ParagraphOccurrenceIndex {
  const orderByPart = new Map(parts.map((part) => [part.name, deepOrder(part)]));
  const boundsByPart = paragraphBoundsByPart(ranges, orderByPart);
  const byPart = new Map<string, Map<string, ParagraphOccurrence[]>>();
  const occurrenceMaps = new Map<string, Map<string, ParagraphOccurrence>>();
  const addInterval = (
    partName: string,
    root: SemanticStoryVisit,
    story: SemanticArtifactStoryKind,
    textboxPath: readonly string[],
    paragraphId: string,
    start: number,
    end: number
  ): void => {
    const order = orderByPart.get(partName)?.get(paragraphId);
    const bounds = boundsByPart.get(partName);
    if (order === undefined || !bounds || order < bounds.lower || order > bounds.upper) return;
    const byParagraph = byPart.get(partName) ?? new Map<string, ParagraphOccurrence[]>();
    byPart.set(partName, byParagraph);
    const occurrenceByKey = occurrenceMaps.get(partName) ?? new Map<string, ParagraphOccurrence>();
    occurrenceMaps.set(partName, occurrenceByKey);
    const rootLane = JSON.stringify([root.story, root.noteScopeId, root.noteAreaKind]);
    const laneKey =
      story === 'textbox' ? JSON.stringify([rootLane, 'textbox', textboxPath]) : rootLane;
    const entries = byParagraph.get(paragraphId) ?? [];
    const key = `${paragraphId}\0${root.page.index}\0${laneKey}`;
    let occurrence = occurrenceByKey.get(key);
    if (!occurrence) {
      occurrence = {
        pageIndex: root.page.index,
        story,
        rootStory: root.story,
        textboxPath,
        noteScopeId: root.noteScopeId,
        noteAreaKind: root.noteAreaKind,
        laneKey,
        intervals: [],
        intervalKeys: new Set(),
      };
      occurrenceByKey.set(key, occurrence);
      entries.push(occurrence);
      byParagraph.set(paragraphId, entries);
    }
    const intervalKey = `${start}\0${end}`;
    if (!occurrence.intervalKeys?.has(intervalKey)) {
      occurrence.intervalKeys?.add(intervalKey);
      occurrence.intervals.push({ start, end });
    }
  };
  forEachSemanticStory(layout, (root) => {
    const partName = rootPartName(pkg, root);
    if (!partName || !boundsByPart.has(partName)) return;
    forEachStoryParagraphFragment(root.host, (fragment, context) => {
      const story: SemanticArtifactStoryKind = context.textboxDepth > 0 ? 'textbox' : root.story;
      const textboxPath = context.textboxPath.map((drawing) => drawing.drawingNodeId);
      const held: Array<{ paragraphId: string; start: number; end: number }> = [];
      for (const line of fragment.lines) {
        // Index only atoms physically published by this display mode. `line.range` can bridge a
        // projected-away deletion/insertion and would falsely place hidden review artifacts.
        for (const span of line.spans) held.push(span.range);
        for (const drawing of line.drawings ?? []) {
          held.push({
            paragraphId: drawing.paragraphId,
            start: drawing.start,
            end: drawing.start + 1,
          });
        }
      }
      if (held.length === 0) {
        held.push({
          paragraphId: fragment.range.paragraphId,
          start: fragment.range.start,
          end: fragment.range.end,
        });
      }
      for (const { paragraphId, start, end } of held) {
        addInterval(partName, root, story, textboxPath, paragraphId, start, end);
      }
    });
  });
  // Floating anchors are visible semantic atoms but are not owned by a line. Canonical drawing
  // traversal covers body, furniture, notes, separators, tables, and nested textboxes uniformly.
  forEachSemanticDrawing(layout, (visit) => {
    const partName = visit.drawing.ownerPartName;
    // A hidden record (an MC wrap footprint) reserves space but shows no atom.
    if (visit.drawing.accessibility.hidden || !boundsByPart.has(partName)) return;
    addInterval(
      partName,
      visit.root,
      visit.story,
      visit.textboxPath.map((drawing) => drawing.drawingNodeId),
      visit.drawing.paragraphId,
      visit.drawing.start,
      visit.drawing.start + 1
    );
  });
  for (const paragraphs of byPart.values()) {
    for (const occurrences of paragraphs.values()) {
      for (const occurrence of occurrences) {
        occurrence.intervals.sort(
          (left, right) => left.start - right.start || left.end - right.end
        );
        const merged: Array<{ start: number; end: number }> = [];
        for (const interval of occurrence.intervals) {
          const previous = merged.at(-1);
          if (previous && interval.start <= previous.end) {
            previous.end = Math.max(previous.end, interval.end);
          } else {
            merged.push({ ...interval });
          }
        }
        occurrence.intervals.splice(0, occurrence.intervals.length, ...merged);
        occurrence.intervalKeys = undefined;
      }
    }
  }
  const visibleByPart = new Map<
    string,
    readonly {
      readonly paragraphId: string;
      readonly position: number;
      readonly laneKeys: ReadonlySet<string>;
    }[]
  >();
  for (const [partName, paragraphs] of byPart) {
    const order = orderByPart.get(partName);
    if (!order) continue;
    const visible: Array<{
      paragraphId: string;
      position: number;
      laneKeys: ReadonlySet<string>;
    }> = [];
    for (const [paragraphId, occurrences] of paragraphs) {
      const position = order.get(paragraphId);
      if (position === undefined) continue;
      visible.push({
        paragraphId,
        position,
        laneKeys: new Set(occurrences.map(({ laneKey }) => laneKey)),
      });
    }
    visible.sort((left, right) => left.position - right.position);
    visibleByPart.set(partName, visible);
  }
  return {
    byPart,
    orderByPart,
    visibleByPart,
  };
}

function lowerBound(entries: readonly { readonly position: number }[], value: number): number {
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (entries[middle]!.position < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

function paragraphIdsOfRange(
  range: ReviewRange,
  index: ParagraphOccurrenceIndex
): readonly string[] {
  if (range.start.paragraphId === range.end.paragraphId) return [range.start.paragraphId];
  const order = index.orderByPart.get(range.partName);
  const visible = index.visibleByPart.get(range.partName);
  const start = order?.get(range.start.paragraphId);
  const end = order?.get(range.end.paragraphId);
  if (!order || !visible || start === undefined || end === undefined) {
    return [range.start.paragraphId, range.end.paragraphId];
  }
  const lower = Math.min(start, end);
  const upper = Math.max(start, end);
  const startLanes = new Set(
    index.byPart
      .get(range.partName)
      ?.get(range.start.paragraphId)
      ?.map(({ laneKey }) => laneKey) ?? []
  );
  const endLanes = new Set(
    index.byPart
      .get(range.partName)
      ?.get(range.end.paragraphId)
      ?.map(({ laneKey }) => laneKey) ?? []
  );
  const sharedLanes = new Set([...startLanes].filter((lane) => endLanes.has(lane)));
  // A range cannot cross from a root story into a textbox (or between notes/textboxes). If a
  // malformed file supplies endpoints in different lanes, keep the endpoints as global source
  // facts without assigning unrelated intermediate story paragraphs to it.
  if (sharedLanes.size === 0) return [range.start.paragraphId, range.end.paragraphId];
  return visible
    .slice(lowerBound(visible, lower), lowerBound(visible, upper + 1))
    .filter((entry) => [...entry.laneKeys].some((lane) => sharedLanes.has(lane)))
    .map((entry) => entry.paragraphId);
}

function occurrenceSlices(
  occurrence: ParagraphOccurrence,
  lower: number,
  upper: number,
  point: boolean
): readonly { readonly start: number; readonly end: number }[] {
  if (point) {
    const owning = occurrence.intervals.filter(
      (interval) => interval.start <= lower && lower < interval.end
    );
    if (owning.length > 0) return [{ start: lower, end: lower }];
    return [];
  }
  return occurrence.intervals.flatMap((interval) => {
    // Empty layout fragments can retain structural point anchors, but must never make a
    // non-empty insertion/deletion range appear visible in a projection that hid its content.
    if (interval.start === interval.end) return [];
    const clipped = {
      start: Math.max(interval.start, lower),
      end: Math.min(interval.end, upper),
    };
    return clipped.end > clipped.start ? [clipped] : [];
  });
}

function finalPointOccurrences(
  occurrences: readonly ParagraphOccurrence[],
  point: number
): ReadonlySet<ParagraphOccurrence> {
  let finalEnd = Number.NEGATIVE_INFINITY;
  for (const occurrence of occurrences) {
    for (const interval of occurrence.intervals) finalEnd = Math.max(finalEnd, interval.end);
  }
  if (point !== finalEnd) return new Set();
  return new Set(
    occurrences.filter((occurrence) =>
      occurrence.intervals.some((interval) => interval.end === finalEnd)
    )
  );
}

function occurrencesOf(
  ranges: readonly ReviewRange[],
  index: ParagraphOccurrenceIndex,
  replacementRangeCount?: number | null
): readonly SemanticReviewArtifactOccurrence[] {
  const occurrences: SemanticReviewArtifactOccurrence[] = [];
  const seen = new Set<string>();
  for (const [rangeIndex, range] of ranges.entries()) {
    const revisionRole =
      replacementRangeCount === undefined
        ? undefined
        : replacementRangeCount === null
          ? ('neutral' as const)
          : rangeIndex < replacementRangeCount
            ? ('replaced' as const)
            : ('replacement' as const);
    for (const paragraphId of paragraphIdsOfRange(range, index)) {
      const anchors = index.byPart.get(range.partName)?.get(paragraphId) ?? [];
      const sameParagraph = range.start.paragraphId === range.end.paragraphId;
      const point = sameParagraph && range.start.offset === range.end.offset;
      const lower = paragraphId === range.start.paragraphId ? range.start.offset : 0;
      const upper =
        paragraphId === range.end.paragraphId ? range.end.offset : Number.POSITIVE_INFINITY;
      const finalOwners = point
        ? finalPointOccurrences(anchors, lower)
        : new Set<ParagraphOccurrence>();
      for (const anchor of anchors) {
        let slices = occurrenceSlices(anchor, lower, upper, point);
        if (point && slices.length === 0 && finalOwners.has(anchor)) {
          slices = [{ start: lower, end: lower }];
        }
        for (const slice of slices) {
          const occurrenceKey = `${anchor.pageIndex}\0${anchor.story}\0${anchor.noteScopeId ?? ''}\0${anchor.noteAreaKind ?? ''}\0${anchor.textboxPath.join('\0')}\0${range.partName}\0${paragraphId}\0${slice.start}\0${slice.end}\0${revisionRole ?? ''}`;
          if (seen.has(occurrenceKey)) continue;
          seen.add(occurrenceKey);
          occurrences.push({
            pageIndex: anchor.pageIndex,
            physicalPageNumber: anchor.pageIndex + 1,
            story: anchor.story,
            rootStory: anchor.rootStory,
            textboxPath: anchor.textboxPath,
            noteScopeId: anchor.noteScopeId,
            noteAreaKind: anchor.noteAreaKind,
            ...(revisionRole ? { revisionRole } : {}),
            source: {
              partName: range.partName,
              start: { paragraphId, offset: slice.start },
              // Same paragraph as start: engine occurrences never span paragraphs.
              end: { paragraphId, offset: slice.end },
            },
          });
        }
      }
    }
  }
  return occurrences;
}

interface PublicReviewIds {
  readonly comment: ReadonlyMap<string, string>;
  readonly revision: ReadonlyMap<string, string>;
}

function opaqueId(kind: 'comment' | 'change', sourceId: string): string {
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < sourceId.length; index += 1) {
    const code = sourceId.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193) >>> 0;
    right = Math.imul(right ^ (code + index), 0x85ebca6b) >>> 0;
    right ^= right >>> 13;
  }
  return `${kind}_${sourceId.length.toString(36)}_${left.toString(36)}_${right.toString(36)}`;
}

/** Deterministically assign unique opaque ids, including when the compact digest collides. */
export function assignOpaqueReviewIds(
  kind: 'comment' | 'change',
  sourceIds: Iterable<string>,
  digest: (kind: 'comment' | 'change', sourceId: string) => string = opaqueId
): ReadonlyMap<string, string> {
  const groups = new Map<string, Set<string>>();
  for (const sourceId of sourceIds) {
    const base = digest(kind, sourceId);
    const group = groups.get(base) ?? new Set<string>();
    group.add(sourceId);
    groups.set(base, group);
  }
  const assigned = new Map<string, string>();
  for (const [base, group] of groups) {
    const sorted = [...group].sort();
    for (const [index, sourceId] of sorted.entries()) {
      assigned.set(sourceId, sorted.length === 1 ? base : `${base}_${index.toString(36)}`);
    }
  }
  return assigned;
}

function publicReviewIds(items: readonly ReviewItem[]): PublicReviewIds {
  const comment = new Set<string>();
  const revision = new Set<string>();
  for (const item of items) {
    if (item.kind === 'comment') {
      comment.add(item.id);
      if (item.parentId !== undefined) comment.add(item.parentId);
      if (item.parentRevisionId !== undefined) revision.add(item.parentRevisionId);
      for (const id of item.replyIds) comment.add(id);
    }
    if (item.kind === 'revision') {
      revision.add(item.id);
      if (item.pairedWith !== undefined) revision.add(item.pairedWith);
      for (const id of item.replyIds) comment.add(id);
    }
  }
  return {
    comment: assignOpaqueReviewIds('comment', comment),
    revision: assignOpaqueReviewIds('change', revision),
  };
}

function mappedId(
  ids: ReadonlyMap<string, string>,
  kind: 'comment' | 'change',
  sourceId: string
): string {
  return ids.get(sourceId) ?? opaqueId(kind, sourceId);
}

const referenceOrderByRoot = new WeakMap<OoxmlNode, ReadonlyMap<string, number>>();

/**
 * The place of each comment's last reference mark among the reference marks of `part`, in
 * tree order. Two comments on the same characters end at the same place, so only the order of
 * their marks tells which one is numbered first. The last mark is the one that stands with the
 * comment's last range end. The walk uses a stack, not recursion, and the tree it reads is
 * already capped in depth and element count where it was parsed. It skips run and paragraph
 * properties and text, which cannot hold a mark.
 */
function referenceOrderOf(part: OoxmlPart): ReadonlyMap<string, number> {
  const cached = referenceOrderByRoot.get(part.root);
  if (cached) return cached;
  const order = new Map<string, number>();
  let marks = 0;
  const stack: OoxmlNode[] = [part.root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (
      node.kind === 'textValue' ||
      node.kind === 'text' ||
      node.kind === 'runProperties' ||
      node.kind === 'paragraphProperties'
    ) {
      continue;
    }
    if (node.kind === 'commentReference') {
      const id = attribute(node, WML_NAMESPACE_URI, 'id');
      if (id !== undefined) order.set(id, marks++);
      continue;
    }
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      stack.push(node.children[index]!);
    }
  }
  referenceOrderByRoot.set(part.root, order);
  return order;
}

function artifactOf(
  item: ReviewItem,
  occurrences: ParagraphOccurrenceIndex | null,
  ids: PublicReviewIds,
  referenceOrder: ReadonlyMap<string, number>
): SemanticReviewArtifactRecord | null {
  if (item.kind === 'revision') {
    return {
      kind: 'tracked-change',
      id: mappedId(ids.revision, 'change', item.id),
      change: item.revisionKind,
      ...(item.structuralChanges ? { structuralChanges: item.structuralChanges } : {}),
      ...(item.markDirection ? { markDirection: item.markDirection } : {}),
      author: item.author,
      ...(item.date !== undefined ? { date: item.date } : {}),
      // One for one, so the text still lines up with its occurrence spans.
      text: withHyphenGlyphs(item.text),
      replacedText: withHyphenGlyphs(item.replacedText),
      nesting: item.nesting,
      ...(item.replacedRangeCount !== undefined
        ? { replacedRangeCount: item.replacedRangeCount }
        : {}),
      readOnly: item.readOnly,
      ...(item.pairedWith !== undefined
        ? { pairedWith: mappedId(ids.revision, 'change', item.pairedWith) }
        : {}),
      replyIds: item.replyIds.map((id) => mappedId(ids.comment, 'comment', id)),
      occurrences: occurrences
        ? occurrencesOf(
            item.ranges,
            occurrences,
            item.revisionKind === 'replace' ? (item.replacedRangeCount ?? null) : undefined
          )
        : [],
    };
  }
  if (item.kind !== 'comment') return null;
  const order = referenceOrder.get(item.id);
  return {
    kind: 'comment',
    id: mappedId(ids.comment, 'comment', item.id),
    author: item.comment.author,
    initials: commentInitials(item.comment),
    ...(item.comment.initials?.trim()
      ? { declaredInitials: commentInitials({ ...item.comment, author: '' }) }
      : {}),
    ...(order !== undefined ? { referenceOrder: order } : {}),
    ...(item.comment.date !== undefined ? { date: item.comment.date } : {}),
    text: commentBodyText(item.comment),
    resolved: item.resolved,
    ...(item.parentId !== undefined
      ? { parentId: mappedId(ids.comment, 'comment', item.parentId) }
      : {}),
    ...(item.parentRevisionId !== undefined
      ? { parentRevisionId: mappedId(ids.revision, 'change', item.parentRevisionId) }
      : {}),
    replyIds: item.replyIds.map((id) => mappedId(ids.comment, 'comment', id)),
    orphaned: item.orphaned,
    occurrences: occurrences && item.range ? occurrencesOf([item.range], occurrences) : [],
  };
}

interface ExportReviewQueue {
  readonly parts: readonly OoxmlPart[];
  readonly derivation: ReturnType<typeof createExportReviewDerivationScope>;
  /** The listed items: property changes that leave the formatting unchanged are left out. */
  readonly items: readonly ReviewItem[];
  /** The records of the items left out and their paragraphs, which paint leaves unmarked. */
  readonly unlistedSites: UnlistedRevisionSites;
}

/** One transient review derivation of `pkg`, or null when it holds no review markup. */
function exportReviewQueue(pkg: OoxmlPackage): ExportReviewQueue | null {
  const main = pkg.parts.get(pkg.mainDocumentPart);
  if (!main) return null;
  const furnitureParts = storyParts(pkg, main);
  const parts = [main, ...furnitureParts];
  const commentsPart = pkg.parts.get(commentPartNameOf(pkg, main.name));
  if (!hasReviewMarkup(parts, commentsPart)) return null;
  const derivation = createExportReviewDerivationScope();
  const all = derivation.collectReviewItems({
    storyPart: main,
    furnitureParts,
    commentsPart,
    commentsExtendedPart: pkg.parts.get(commentsExtendedPartNameOf(pkg, main.name)),
  });
  const items = withoutInertPropertyChanges(all, inertPropertyChangeInputsOf(pkg));
  const listed = new Set(items.map((item) => item.id));
  const unlisted = unlistedSitesOf(all.filter((item) => !listed.has(item.id)));
  const unlistedSites = {
    sites: new Set(unlisted.sites),
    paragraphs: unlisted.paragraphs,
    key: stylesAndNumberingKey(stylesPartOf(pkg)?.root ?? null, numberingRootOf(pkg)),
  };
  return { parts, derivation, items, unlistedSites };
}

/** Only the site ids are kept per package, so no derivation outlives the call that needed it. */
const NO_REFERENCE_ORDER: ReadonlyMap<string, number> = new Map();
const unlistedSitesByPackage = new WeakMap<OoxmlPackage, UnlistedRevisionSites>();
const NO_SITES: UnlistedRevisionSites = { sites: new Set(), paragraphs: new Map(), key: '' };

/** The revision sites an export of `pkg` leaves unmarked, because they have no review item. */
export function unlistedReviewSites(pkg: OoxmlPackage): UnlistedRevisionSites {
  let sites = unlistedSitesByPackage.get(pkg);
  if (!sites) {
    // Only property changes are ever unlisted, so a package without one needs no derivation.
    const main = pkg.parts.get(pkg.mainDocumentPart);
    const holdsPropertyChanges =
      main !== undefined &&
      [main, ...storyParts(pkg, main)].some((part) =>
        collectRevisionSites(part).some((site) => site.propertyChange)
      );
    sites = (holdsPropertyChanges && exportReviewQueue(pkg)?.unlistedSites) || NO_SITES;
    unlistedSitesByPackage.set(pkg, sites);
  }
  return sites;
}

/** Project every core review item without exposing OOXML nodes or mutation addresses. @internal */
export function projectReviewArtifacts(
  layout: SemanticLayout,
  pkg: OoxmlPackage
): readonly SemanticReviewArtifactRecord[] {
  const queue = exportReviewQueue(pkg);
  if (!queue) return [];
  const { parts, derivation, items } = queue;
  // The overwhelmingly common export has no review artifacts. Do not build a paragraph/page
  // occurrence index over a large settled layout unless there is something to place.
  if (items.length === 0) return [];
  const ranges = items.flatMap((item) => reviewItemRanges(item));
  // Orphan-only documents still publish their metadata, but avoid walking a potentially huge
  // semantic graph when there is no source range that can have a physical page occurrence.
  const occurrences =
    ranges.length > 0
      ? paragraphOccurrences(layout, pkg, parts, ranges, derivation.deepParagraphOrderOfPart)
      : null;
  const ids = publicReviewIds(items);
  // `exportReviewQueue` puts the main document part first.
  const referenceOrder = items.some((item) => item.kind === 'comment')
    ? referenceOrderOf(parts[0]!)
    : NO_REFERENCE_ORDER;
  return items
    .map((item) => artifactOf(item, occurrences, ids, referenceOrder))
    .filter((artifact): artifact is SemanticReviewArtifactRecord => artifact !== null);
}
