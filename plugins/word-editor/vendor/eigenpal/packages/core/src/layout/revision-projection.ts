import { carrySymbolRun } from './symbol-run.ts';
import type { ResolvedRevisionMarkup } from '../contracts/revision-markup.ts';
// Revision attribution and display modes for layout.
//
// The canonical tree keeps `w:ins` / `w:del` / `w:moveFrom` / `w:moveTo` as wrappers, because
// the tree is the authored state and an unedited round trip must stay fingerprint-identical.
// Layout does not get to flatten them away either — it needs to know which text is tracked, by
// whom, in order to present it. So the projection carries an ATTRIBUTION alongside each piece
// rather than rewriting the tree into a resolved shape.
//
// The display mode is an input to that projection, never a mutation. "Show the proposed result"
// implemented as accept-all would mean a user who switches view, saves, and sends the file has
// silently accepted every proposal in it.

import {
  WML_NAMESPACE_URI,
  isContentRevisionKind,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlProperty,
} from '@docx-editor.dev/core/store';

/**
 * What a revision wrapper asserts about the content inside it.
 *
 * `moveFrom` / `moveTo` are deliberately distinct from `delete` / `insert`: a move is one
 * decision with two halves, and presenting it as an unrelated deletion and insertion invites
 * resolving one without the other, which duplicates or loses the content.
 */
export type RevisionKind = 'insert' | 'delete' | 'moveFrom' | 'moveTo' | 'format';

/**
 * One revision wrapper's provenance, as authored.
 *
 * `id` is the verbatim `@w:id` string rather than a number: `ST_DecimalNumber` restricts
 * `xsd:integer` with no bounds, so a file may carry a value outside the safe integer range, and
 * parsing it to a number would silently merge two distinct revisions.
 *
 * `date` is absent when the file omits it. `@w:date` is optional on `CT_TrackChange`, and
 * inventing one is a silent content change.
 */
export interface RevisionAttribution {
  readonly kind: RevisionKind;
  readonly id: string;
  readonly author: string;
  readonly date?: string;
  /** The wrapper's node id, so a surface can address this exact site. */
  readonly nodeId: string;
}

/**
 * Which revisions layout resolves before producing pages.
 *
 * - `all-markup` shows both halves of every change.
 * - `proposed` shows what the document becomes if every change is accepted.
 * - `original` shows what it was before any of them.
 *
 * The last two are specified as equal to accept-all and reject-all OUTPUT, which is what makes
 * them testable, without either applying an op.
 */
export type RevisionDisplayMode = 'all-markup' | 'proposed' | 'original';

/**
 * The views the review chrome offers, in Word's terms: the three layout projections plus
 * Simple Markup, which reads as the proposed result with a red change bar beside every line
 * a change touched — the document as accepting everything would leave it, and where.
 */
export type ReviewDisplayMode = RevisionDisplayMode | 'simple-markup';

/** The projection the layout performs for a review view: Simple Markup lays out the proposal. */
export function layoutProjectionOf(mode: ReviewDisplayMode): RevisionDisplayMode {
  return mode === 'simple-markup' ? 'proposed' : mode;
}

/**
 * How a document renders tracked changes when nothing says otherwise.
 *
 * `all-markup` matches Word's own default: a reader who opens a document with pending changes
 * sees them, rather than a clean-looking document hiding edits nobody has accepted.
 */
export const DEFAULT_REVISION_DISPLAY_MODE: RevisionDisplayMode = 'all-markup';

/**
 * A view-time tracked-change filter. Revisions rejected by `includes` use the filter's accepted
 * or rejected projection, while included revisions keep the display mode's normal projection.
 *
 * `cacheKey` is a canonical, content-based identity for layout caches. The set itself is kept
 * because author names are attacker-controlled strings and must never be parsed back from a
 * delimiter-based key.
 */
export interface RevisionFilter {
  readonly revisionMarkup?: ResolvedRevisionMarkup;
  readonly hiddenAuthors: ReadonlySet<string>;
  readonly includes?: (revision: RevisionAttribution) => boolean;
  readonly includesNode?: (nodeId: string, author: string) => boolean;
  /** Accepted/original projection for a revision excluded by `includesNode`. */
  readonly excludedNodeMode?: (nodeId: string, author: string) => 'proposed' | 'original';
  /**
   * In a resolved view, content the view keeps paints as ORDINARY text: no author ink, no
   * decoration, no change bar of its own. This is Word's No Markup, Original and Simple
   * Markup, which the review chrome asks for. Without it the accepted projection keeps the
   * attribution on kept insertions, which is what the engine paints when no review module
   * is registered — colour by author, deletions resolved — and what its roster reads.
   */
  readonly resolvedMarkup?: 'plain';
  readonly cacheKey: string;
  /**
   * @internal Revision records the review queue leaves out, by change-element node id, and the
   * paragraphs that hold them. Their paragraphs project without those records, so they paint
   * no markup. Not a selection: it never moves a projection off the unfiltered path.
   */
  readonly unlisted?: {
    readonly sites: ReadonlySet<string>;
    /** Each paragraph that holds one, keyed by the records it holds. */
    readonly paragraphs: ReadonlyMap<string, string>;
    /** Names the styles and numbering the records were decided against. */
    readonly key: string;
  };
}

/**
 * Whether a filter changes which revisions a projection keeps.
 *
 * The editor always hands layout a filter, because the filter also carries viewer settings
 * such as revision markup. One that hides no author and excludes no change keeps every
 * revision, so an All Markup projection takes the same path as no filter at all. A
 * projection reads markup settings through `revisionMarkup` itself, never through this test.
 */
export function revisionFilterSelects(filter: RevisionFilter | undefined): boolean {
  return (
    filter !== undefined &&
    (filter.hiddenAuthors.size > 0 ||
      filter.includes !== undefined ||
      filter.includesNode !== undefined ||
      filter.excludedNodeMode !== undefined)
  );
}

/** The plain-resolved policy with nobody hidden, for a review view that filters no one. */
const PLAIN_RESOLVED_FILTER: RevisionAuthorFilter = Object.freeze({
  hiddenAuthors: Object.freeze(new Set<string>()) as ReadonlySet<string>,
  resolvedMarkup: 'plain' as const,
  cacheKey: 'plain',
});

/** One wrapped filter per base, so identity-keyed layout memos see one object per session state. */
const plainResolvedFilters = new WeakMap<RevisionAuthorFilter, RevisionAuthorFilter>();

/** The same filter, with the review chrome's plain-resolved policy applied. */
export function withPlainResolvedMarkup(
  filter: RevisionAuthorFilter | undefined
): RevisionAuthorFilter {
  if (!filter) return PLAIN_RESOLVED_FILTER;
  if (filter.resolvedMarkup === 'plain') return filter;
  let wrapped = plainResolvedFilters.get(filter);
  if (!wrapped) {
    wrapped = Object.freeze({
      ...filter,
      resolvedMarkup: 'plain' as const,
      cacheKey: `${filter.cacheKey}|plain`,
    });
    plainResolvedFilters.set(filter, wrapped);
  }
  return wrapped;
}

/** A read-only Set facade whose backing collection is unreachable to consumers. */
class ImmutableStringSet implements ReadonlySet<string> {
  readonly #values: Set<string>;

  constructor(values: Iterable<string>) {
    this.#values = new Set(values);
    Object.freeze(this);
  }

  get size(): number {
    return this.#values.size;
  }

  has(value: string): boolean {
    return this.#values.has(value);
  }

  forEach(
    callbackfn: (value: string, value2: string, set: ReadonlySet<string>) => void,
    thisArg?: unknown
  ): void {
    this.#values.forEach((value) => callbackfn.call(thisArg, value, value, this));
  }

  entries() {
    return this.#values.entries();
  }

  keys() {
    return this.#values.keys();
  }

  values() {
    return this.#values.values();
  }

  union<U>(other: {
    readonly size: number;
    has(value: U): boolean;
    keys(): Iterator<U>;
  }): Set<string | U> {
    const result = new Set<string | U>(this.#values);
    const keys = other.keys();
    let next = keys.next();
    while (!next.done) {
      result.add(next.value);
      next = keys.next();
    }
    return result;
  }

  intersection<U>(other: {
    readonly size: number;
    has(value: U): boolean;
    keys(): Iterator<U>;
  }): Set<string & U> {
    const result = new Set<string & U>();
    for (const value of this.#values) {
      if (other.has(value as unknown as U)) result.add(value as string & U);
    }
    return result;
  }

  difference<U>(other: {
    readonly size: number;
    has(value: U): boolean;
    keys(): Iterator<U>;
  }): Set<string> {
    const result = new Set<string>();
    for (const value of this.#values) {
      if (!other.has(value as unknown as U)) result.add(value);
    }
    return result;
  }

  symmetricDifference<U>(other: {
    readonly size: number;
    has(value: U): boolean;
    keys(): Iterator<U>;
  }): Set<string | U> {
    const result = new Set<string | U>(this.#values);
    const keys = other.keys();
    let next = keys.next();
    while (!next.done) {
      const value = next.value;
      if (this.#values.has(value as unknown as string)) result.delete(value);
      else result.add(value);
      next = keys.next();
    }
    return result;
  }

  isSubsetOf(other: {
    readonly size: number;
    has(value: unknown): boolean;
    keys(): Iterator<unknown>;
  }): boolean {
    if (this.size > other.size) return false;
    for (const value of this.#values) if (!other.has(value)) return false;
    return true;
  }

  isSupersetOf(other: {
    readonly size: number;
    has(value: unknown): boolean;
    keys(): Iterator<unknown>;
  }): boolean {
    if (this.size < other.size) return false;
    const keys = other.keys();
    let next = keys.next();
    while (!next.done) {
      if (!this.#values.has(next.value as string)) return false;
      next = keys.next();
    }
    return true;
  }

  isDisjointFrom(other: {
    readonly size: number;
    has(value: unknown): boolean;
    keys(): Iterator<unknown>;
  }): boolean {
    for (const value of this.#values) if (other.has(value)) return false;
    return true;
  }

  [Symbol.iterator]() {
    return this.#values[Symbol.iterator]();
  }
}

/** Shared immutable empty author set for editor-facing visibility snapshots. @internal */
export const EMPTY_REVISION_AUTHOR_SET: ReadonlySet<string> = new ImmutableStringSet([]);

/** @deprecated Use {@link RevisionFilter}. */
export interface RevisionAuthorFilter extends RevisionFilter {}

/** Build a canonical reviewer filter. An empty input returns `undefined` for the fast path. */
export function revisionAuthorFilter(
  hiddenAuthors: Iterable<string>
): RevisionAuthorFilter | undefined {
  const hidden = new Set<string>();
  for (const author of hiddenAuthors) hidden.add(author);
  if (hidden.size === 0) return undefined;
  const ordered = [...hidden].sort();
  const hiddenSnapshot = new ImmutableStringSet(ordered);
  return Object.freeze({
    hiddenAuthors: hiddenSnapshot,
    includes: (revision: RevisionAttribution) => !hiddenSnapshot.has(revision.author),
    includesNode: (_nodeId: string, author: string) => !hiddenSnapshot.has(author),
    cacheKey: JSON.stringify(ordered),
  });
}

/** Whether a reviewer filter keeps this revision's markup and change bar. */
export function revisionIncluded(filter: RevisionFilter, revision: RevisionAttribution): boolean {
  return (
    filter.includes?.(revision) ?? revisionNodeIncluded(filter, revision.nodeId, revision.author)
  );
}

/** Whether one revision site remains tracked in the filtered view. */
export function revisionNodeIncluded(
  filter: RevisionFilter,
  nodeId: string,
  author: string
): boolean {
  return filter.includesNode?.(nodeId, author) ?? !filter.hiddenAuthors.has(author);
}

/** The display mode one attributed revision uses after applying a view-time filter. */
export function revisionProjectionMode(
  filter: RevisionFilter,
  revision: RevisionAttribution,
  includedMode: RevisionDisplayMode
): RevisionDisplayMode {
  if (revisionIncluded(filter, revision)) return includedMode;
  return filter.excludedNodeMode?.(revision.nodeId, revision.author) ?? 'proposed';
}

/** Node-addressed form of {@link revisionProjectionMode} for structural revision sites. */
export function revisionNodeProjectionMode(
  filter: RevisionFilter,
  nodeId: string,
  author: string,
  includedMode: RevisionDisplayMode
): RevisionDisplayMode {
  if (revisionNodeIncluded(filter, nodeId, author)) return includedMode;
  return filter.excludedNodeMode?.(nodeId, author) ?? 'proposed';
}

/** No enclosing revision. Shared so the common untracked case allocates nothing. */
export const NO_REVISIONS: readonly RevisionAttribution[] = Object.freeze([]);

/**
 * Nested revision wrappers deeper than this stop being descended.
 *
 * A file is attacker-controlled, and depth is the cheapest unbounded axis in it. Content below
 * the cap is preserved in the tree and simply not laid out, which is the same conservative
 * answer the rest of the projection gives when a budget runs out.
 */
const MAX_REVISION_NESTING = 32;

const KIND_BY_NODE_KIND: Readonly<Record<string, RevisionKind>> = {
  revisionInsert: 'insert',
  revisionDelete: 'delete',
  revisionMoveFrom: 'moveFrom',
  revisionMoveTo: 'moveTo',
};

function attributeValue(node: OoxmlElement, localName: string): string | undefined {
  for (const attribute of node.attributes) {
    if (attribute.localName !== localName) continue;
    // WML attributes are namespaced; an unprefixed same-named attribute is someone else's.
    if (attribute.namespaceUri !== node.namespaceUri) continue;
    if (attribute.kind === 'wmlVal' || attribute.kind === 'genericExtension')
      return attribute.value;
    if (attribute.kind === 'xmlSpace') return attribute.value;
  }
  return undefined;
}

/**
 * The attribution a content-revision wrapper carries, or null when it is not one.
 *
 * A wrapper missing `@w:author` still yields an attribution with an empty author: the schema
 * requires the attribute, but a file that omits it must still render its content rather than
 * being refused, and the empty author is visible rather than invented.
 */
export function revisionAttributionOf(node: OoxmlNode): RevisionAttribution | null {
  if (node.kind === 'textValue') return null;
  const kind = KIND_BY_NODE_KIND[node.kind];
  if (kind === undefined) return null;
  const date = attributeValue(node, 'date');
  return {
    kind,
    id: attributeValue(node, 'id') ?? '',
    author: attributeValue(node, 'author') ?? '',
    ...(date === undefined ? {} : { date }),
    nodeId: node.id,
  };
}

/** Push one wrapper's attribution onto an enclosing stack, outermost first. */
export function withRevision(
  enclosing: readonly RevisionAttribution[],
  attribution: RevisionAttribution
): readonly RevisionAttribution[] {
  return enclosing.length === 0 ? [attribution] : [...enclosing, attribution];
}

/** True when the node is a wrapper layout should descend into rather than skip. */
export function isRevisionWrapper(node: OoxmlNode): node is Extract<
  OoxmlElement,
  {
    readonly kind: 'revisionInsert' | 'revisionDelete' | 'revisionMoveFrom' | 'revisionMoveTo';
  }
> {
  return node.kind !== 'textValue' && isContentRevisionKind(node.kind);
}

export const MAX_REVISION_DEPTH = MAX_REVISION_NESTING;

/**
 * Whether content under this stack of revisions is laid out in the given mode.
 *
 * Containment governs, so a single enclosing wrapper the mode resolves away suppresses
 * everything inside it regardless of what the inner wrappers say. An insertion inside a
 * deletion does not survive the proposed result: the deletion it sits in was accepted.
 */
export function revisionsVisible(
  revisions: readonly RevisionAttribution[],
  mode: RevisionDisplayMode,
  authorFilter?: RevisionAuthorFilter
): boolean {
  if (revisions.length === 0 || (mode === 'all-markup' && !revisionFilterSelects(authorFilter)))
    return true;
  for (const revision of revisions) {
    const revisionMode = authorFilter ? revisionProjectionMode(authorFilter, revision, mode) : mode;
    if (revisionMode === 'all-markup') continue;
    const removed =
      revisionMode === 'proposed'
        ? revision.kind === 'delete' || revision.kind === 'moveFrom'
        : revision.kind === 'insert' || revision.kind === 'moveTo';
    if (removed) return false;
  }
  return true;
}

/**
 * The attribution that remains visible after the author filter is applied.
 *
 * `null` means the accepted projection removes the content. The shared empty array means the
 * content remains as ordinary text, without reviewer colour, decoration, or a change bar.
 */
export function projectedRevisions(
  revisions: readonly RevisionAttribution[],
  mode: RevisionDisplayMode,
  authorFilter?: RevisionAuthorFilter
): readonly RevisionAttribution[] | null {
  if (mode === 'all-markup' && !revisionFilterSelects(authorFilter)) return revisions;
  if (!revisionsVisible(revisions, mode, authorFilter)) return null;
  // A review view that resolves shows the document as accepting (or rejecting) every change
  // would leave it: content it keeps is ordinary text, so it carries no markup to paint.
  // Returning the attribution here underlined every kept insertion in No Markup.
  if (mode !== 'all-markup' && authorFilter?.resolvedMarkup === 'plain') return NO_REVISIONS;
  if (!authorFilter) return revisions;
  const visible = revisions.filter((revision) => revisionIncluded(authorFilter, revision));
  return visible.length === 0 ? NO_REVISIONS : visible;
}

/**
 * The revisions a resolved view answered for some content — kept as ordinary text or
 * removed — that the reader can still be told about: what Simple Markup's change bar marks.
 *
 * Empty in All Markup, where the content carries its own markup, and empty for a revision
 * the reviewer filter hides, whose content the view resolves silently.
 */
export function resolvedChangeSites(
  revisions: readonly RevisionAttribution[],
  mode: RevisionDisplayMode,
  authorFilter?: RevisionAuthorFilter
): readonly RevisionAttribution[] {
  if (mode === 'all-markup' || revisions.length === 0) return NO_REVISIONS;
  if (!authorFilter) return revisions;
  const included = revisions.filter((revision) => revisionIncluded(authorFilter, revision));
  return included.length === 0 ? NO_REVISIONS : included;
}

/** Whether one attributed mark remains markup in the current reviewer view. */
export function revisionMarkupVisible(
  revision: RevisionAttribution,
  mode: RevisionDisplayMode,
  authorFilter?: RevisionAuthorFilter
): boolean {
  return mode === 'all-markup' && (!authorFilter || revisionIncluded(authorFilter, revision));
}

/** Remove hidden revision provenance while preserving the accepted formatting itself. */
export function projectedRevisionProperties(
  properties: readonly OoxmlProperty[],
  authorFilter?: RevisionAuthorFilter
): readonly OoxmlProperty[] {
  if (!authorFilter) return properties;
  const projected = properties.filter((property) => {
    if (property.localName !== 'rPrChange' && property.localName !== 'pPrChange') return true;
    const nodeId =
      'revisionNodeId' in property && typeof property.revisionNodeId === 'string'
        ? property.revisionNodeId
        : '';
    return revisionIncluded(authorFilter, {
      kind: 'format',
      id: property.attributes?.id ?? '',
      author: property.attributes?.author ?? '',
      ...(property.attributes?.date === undefined ? {} : { date: property.attributes.date }),
      nodeId,
    });
  });
  if (projected.length === properties.length) return properties;
  carrySymbolRun(properties, projected);
  return projected;
}

/** What one laid-out piece carries after the reviewer view is applied to it. */
export interface PieceAttribution {
  /** Run properties with hidden-reviewer provenance (`rPrChange`) removed. */
  readonly props: readonly OoxmlProperty[];
  /** The revisions still shown as markup; absent when the piece paints as ordinary text. */
  readonly revisions?: readonly RevisionAttribution[];
  /**
   * The revisions a resolved view accepted into this piece, which paints as ordinary text.
   * Absent in All Markup and for content no included revision touched. Simple Markup's
   * change bar reads it; nothing inline does.
   */
  readonly changeSites?: readonly RevisionAttribution[];
}

/**
 * The attribution and properties one piece publishes under the current reviewer view, or
 * `null` when that view removes the content altogether.
 *
 * The ONE projection for every piece the paragraph walk emits, whichever route it takes to the
 * piece list. An ordinary run is projected as it is pushed; a field's editable or demoted
 * result is buffered first and flushed later, and a buffered piece that skipped this step kept
 * a hidden reviewer's colour and `rPrChange` while the review list and the change bar had
 * already dropped them. Both routes call this so they cannot disagree again.
 */
export function projectPieceAttribution(
  revisions: readonly RevisionAttribution[],
  props: readonly OoxmlProperty[],
  mode: RevisionDisplayMode,
  authorFilter?: RevisionFilter
): PieceAttribution | null {
  const projected = projectedRevisions(revisions, mode, authorFilter);
  if (projected === null) return null;
  const publishedProps = authorFilter ? projectedRevisionProperties(props, authorFilter) : props;
  const changeSites = resolvedChangeSites(revisions, mode, authorFilter);
  return {
    props: publishedProps,
    ...(projected.length === 0 ? {} : { revisions: projected }),
    ...(changeSites.length === 0 ? {} : { changeSites }),
  };
}

/** Paragraph-mark revisions that remain attributed in the current reviewer view. */
export function visibleParagraphMarkRevisionsOf(
  paragraph: OoxmlNode,
  mode: RevisionDisplayMode,
  authorFilter?: RevisionAuthorFilter
): {
  readonly revisions: readonly RevisionAttribution[];
  readonly formatRevision: RevisionAttribution | null;
} {
  if (mode !== 'all-markup') {
    return { revisions: NO_REVISIONS, formatRevision: null };
  }
  if (!authorFilter) {
    return {
      revisions: paragraphMarkRevisionsOf(paragraph),
      formatRevision: paragraphMarkFormatRevisionOf(paragraph),
    };
  }
  const revisions = paragraphMarkRevisionsOf(paragraph).filter((revision) =>
    revisionMarkupVisible(revision, mode, authorFilter)
  );
  const formatRevision = paragraphMarkFormatRevisionOf(paragraph);
  return {
    revisions,
    formatRevision:
      formatRevision && revisionMarkupVisible(formatRevision, mode, authorFilter)
        ? formatRevision
        : null,
  };
}

export function paragraphMarkMarkupVisible(
  paragraph: OoxmlNode,
  mode: RevisionDisplayMode,
  authorFilter?: RevisionAuthorFilter
): boolean {
  if (mode !== 'all-markup') return false;
  const revisions = paragraphMarkRevisionsOf(paragraph);
  if (!authorFilter) {
    return revisions.length > 0 || paragraphMarkFormatRevisionOf(paragraph) !== null;
  }
  if (revisions.some((revision) => revisionIncluded(authorFilter, revision))) return true;
  const formatRevision = paragraphMarkFormatRevisionOf(paragraph);
  return formatRevision !== null && revisionIncluded(authorFilter, formatRevision);
}

/**
 * Every revision on a paragraph's own MARK, from `w:pPr/w:rPr/w:ins|w:del|w:moveFrom|w:moveTo`.
 *
 * All four members of `EG_ParaRPrTrackChanges`. A moved paragraph carries `w:moveFrom` on the
 * mark of the copy it left and `w:moveTo` on the mark of the copy it arrived at, so a move
 * that spans whole paragraphs is recorded here and nowhere else.
 *
 * `EG_ParaRPrTrackChanges` records that the pilcrow itself was inserted or deleted, which is how
 * Word writes a paragraph split or merge. It is not content — there is no text to decorate — so
 * a surface shows it as a mark of its own beside the paragraph, the way Word draws a struck-
 * through ¶.
 *
 * A LIST, because the group is `ins? del? moveFrom? moveTo?` and the first two can both be
 * there: that pair is what Word writes when a second author proposes removing a mark the first
 * proposed adding, and it is what this engine's own writer emits (`tree-op-tracked.ts`).
 * Answering with the first one hid the second author's decision from the PAGE. The review pane
 * walks the tree itself and always listed both, which is the worse shape of the two: a card
 * offering a decision the reader could see no sign of.
 *
 * Ordered as the file orders them, which is the order the group declares.
 *
 * Property-position `w:ins`/`w:del` stay `generic` in the tree deliberately, so this reads them
 * by name rather than by kind.
 */
export function paragraphMarkRevisionsOf(paragraph: OoxmlNode): readonly RevisionAttribution[] {
  return markRevisionDataOf(paragraph).revisions;
}

/** `EG_ParaRPrTrackChanges` in full: `ins? del? moveFrom? moveTo?` (§17.13.5.20-25). */
const MARK_REVISION_KINDS: Readonly<Record<string, RevisionKind | undefined>> = {
  ins: 'insert',
  del: 'delete',
  moveFrom: 'moveFrom',
  moveTo: 'moveTo',
};

/**
 * The tracked FORMAT change on a paragraph's own mark, from `w:pPr/w:rPr/w:rPrChange`.
 *
 * `CT_ParaRPr` ends with it (§17.13.5.32), and Word writes it when a user changes the mark's
 * own run properties with tracking on. It reaches the fragment rather than a span because it
 * decorates no characters, and it is not in `props`: a fragment's `props` carry the mark's
 * `w:rPr` by NAME only, with none of its children.
 *
 * Note that `w:rPrChange/w:rPr` is `CT_ParaRPrOriginal`, which may carry its own revision
 * marks. Those describe the mark as it WAS and must not be read as live ones, which is why
 * this reads the change element's own attributes and never descends into it.
 */
export function paragraphMarkFormatRevisionOf(paragraph: OoxmlNode): RevisionAttribution | null {
  return markRevisionDataOf(paragraph).format;
}

/** One shared empty, so an unmarked paragraph publishes no array of its own. */
const EMPTY_MARK_REVISIONS: readonly RevisionAttribution[] = Object.freeze([]);
interface MarkRevisionData {
  readonly revisions: readonly RevisionAttribution[];
  readonly format: RevisionAttribution | null;
}
const EMPTY_MARK_DATA: MarkRevisionData = Object.freeze({
  revisions: EMPTY_MARK_REVISIONS,
  format: null,
});
const markRevisionData = new WeakMap<OoxmlNode, MarkRevisionData>();

function markRevisionDataOf(paragraph: OoxmlNode): MarkRevisionData {
  const known = markRevisionData.get(paragraph);
  if (known) return known;
  const read = (): MarkRevisionData => {
    if (paragraph.kind === 'textValue') return EMPTY_MARK_DATA;
    const pPr = paragraph.children.find((child) => child.kind === 'paragraphProperties');
    if (!pPr || pPr.kind === 'textValue') return EMPTY_MARK_DATA;
    const rPr = pPr.children.find((child) => child.kind === 'runProperties');
    if (!rPr || rPr.kind === 'textValue') return EMPTY_MARK_DATA;
    const revisions: RevisionAttribution[] = [];
    let format: RevisionAttribution | null = null;
    for (const child of rPr.children) {
      if (child.kind === 'textValue' || child.namespaceUri !== WML_NAMESPACE_URI) continue;
      const kind =
        MARK_REVISION_KINDS[child.localName] ??
        (child.localName === 'rPrChange' ? 'format' : undefined);
      if (kind === undefined) continue;
      const date = attributeValue(child, 'date');
      const revision: RevisionAttribution = {
        kind,
        id: attributeValue(child, 'id') ?? '',
        author: attributeValue(child, 'author') ?? '',
        ...(date === undefined ? {} : { date }),
        nodeId: child.id,
      };
      if (kind === 'format') format ??= revision;
      else revisions.push(revision);
    }
    return revisions.length || format
      ? { revisions: revisions.length ? revisions : EMPTY_MARK_REVISIONS, format }
      : EMPTY_MARK_DATA;
  };
  const result = read();
  markRevisionData.set(paragraph, result);
  return result;
}

/**
 * The single decision a one-field reader sees.
 *
 * A DELETION wins when a mark carries both, for the reason paint draws it that way: a break
 * proposed and then unproposed ends up removed, so that is the decision a reader who can only
 * see one must see. One function decides it, so the deprecated field, the deprecated function
 * and the painted glyph cannot answer differently.
 */
export function shownMarkRevision(
  revisions: readonly RevisionAttribution[]
): RevisionAttribution | undefined {
  return revisions.find((revision) => markRevisionRemovesMark(revision)) ?? revisions[0];
}

/**
 * Does this decision, taken, remove the paragraph mark?
 *
 * A deletion does, and so does a `moveFrom`: the copy the paragraph moved OUT of goes away
 * when the move is accepted. `insert` and `moveTo` are the other half of each pair, and they
 * keep the break. Paint, the change bar and the resolved views all ask this one question, so
 * a `moveFrom` cannot end up struck through in the margin and blue on the glyph.
 */
export function markRevisionRemovesMark(revision: RevisionAttribution): boolean {
  return revision.kind === 'delete' || revision.kind === 'moveFrom';
}

/**
 * What a fragment publishes for one mark: the list, and the single decision derived from it.
 *
 * Both lanes that build a paragraph fragment call this, so the body and the cell cannot come
 * to publish different shapes for the same markup.
 */
export function markRevisionFields(
  revisions: readonly RevisionAttribution[],
  formatRevision?: RevisionAttribution | null
): {
  markRevisions?: readonly RevisionAttribution[];
  markRevision?: RevisionAttribution;
  markFormatRevision?: RevisionAttribution;
} {
  const shown = shownMarkRevision(revisions);
  return {
    ...(shown ? { markRevisions: revisions, markRevision: shown } : {}),
    ...(formatRevision ? { markFormatRevision: formatRevision } : {}),
  };
}

/**
 * The one decision on a paragraph's mark that a single-field reader sees.
 *
 * @deprecated Reads one of the revisions a mark can carry. Use {@link paragraphMarkRevisionsOf},
 * which answers with all of them.
 */
export function paragraphMarkRevisionOf(paragraph: OoxmlNode): RevisionAttribution | null {
  return shownMarkRevision(paragraphMarkRevisionsOf(paragraph)) ?? null;
}

/**
 * The tracked FORMAT change on a property list, from `w:rPrChange` or `w:pPrChange`.
 *
 * A property change alters no characters, so it has no span of its own to strike or underline.
 * Word marks the affected text and says what changed; the minimum a reader needs is to see that
 * this text's formatting is itself a pending decision.
 *
 * Read from the flattened property list because that is what layout already carries — the
 * change wrapper is a `w:rPr`/`w:pPr` child like any other.
 */
export function formatRevisionOf(
  properties: readonly {
    readonly localName: string;
    readonly attributes?: Readonly<Record<string, string>>;
  }[]
): RevisionAttribution | null {
  for (const property of properties) {
    if (property.localName !== 'rPrChange' && property.localName !== 'pPrChange') continue;
    const attributes = property.attributes ?? {};
    const date = attributes.date;
    return {
      kind: 'format',
      id: attributes.id ?? '',
      author: attributes.author ?? '',
      ...(date === undefined ? {} : { date }),
      nodeId: '',
    };
  }
  return null;
}

/** True when this stack of revisions marks its content as deleted from the live document. */
export function revisionsAreDeletion(revisions: readonly RevisionAttribution[]): boolean {
  return revisions.some((revision) => {
    switch (revision.kind) {
      case 'delete':
      case 'moveFrom':
        return true;
      case 'insert':
      case 'moveTo':
      case 'format':
        return false;
      default:
        return revision.kind satisfies never;
    }
  });
}
