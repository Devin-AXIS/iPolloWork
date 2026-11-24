import { leadingPromptSite, siteLandingNodeId } from './tree-op-leading-prompt-site.ts';
// UTF-16 paragraph segmentation for tree ops (tree-ops seam).
//
// Flattens a paragraph into addressable units — text, tab, hard break, atomic field, and
// note reference — including content nested under `w:hyperlink`. Appliers and validation
// share this model so offsets agree across insert/delete/format/link.

import { inlineCharacterTextOf } from '../package/hyphen-text.ts';
import type { OoxmlElement, OoxmlNode, OoxmlParagraphNode } from '../package/ooxml-tree.ts';
import { isLegacyVmlAtom } from '../package/legacy-vml-projection.ts';
import { isOmmlEquationAtom } from '../package/omml-display.ts';
import {
  DEFAULT_SUPPORTED_MC_REQUIRES,
  emptyNamespaceScope,
  isRunLevelMcAlternateContent,
  namespaceScopeForNode,
  resolveRunLevelMcAtom,
} from '../package/drawing-projection.ts';
import { FieldResultsModeMemo } from '../package/field-result-mode.ts';
import {
  atomicFieldSpansOf,
  parsedFieldSpansOf,
  isFieldChrome,
  isFldChar,
  isFldSimple,
  isInstrText,
  type AtomicFieldSpan,
} from '../package/field-nodes.ts';
import { atomicNoteSpansOf, isNoteAtomNode } from '../package/note-nodes.ts';
import {
  isContentRevisionKind,
  isInlineRunContainer,
  MAX_INLINE_CONTAINER_DEPTH,
  nextInlineContainerDepth,
} from '../package/ooxml-shared.ts';
import {
  contentControlContentOf,
  inlineContainersOf,
  isContentControlNode,
} from './tree-op-nodes.ts';
import {
  afterTrailingFieldEnd,
  directParentOf,
  insertionSiteAfterAtom,
} from './tree-op-field-end-site.ts';
import { continuedRevisionRun } from './same-revision.ts';
import {
  besideRestrictedControl,
  holdsContentControl,
  restrictedControlsWithEdgeAt,
} from './tree-op-restricted-edge.ts';

/**
 * A paragraph-level equation: inline `m:oMath` or a display `m:oMathPara`. Its internal OMML
 * is one editable model atom.
 */
const isMathEquation = isOmmlEquationAtom;

/** One addressable unit of paragraph text: text, tab, hard break, or atomic field. */
export interface Segment {
  readonly runId: string;
  readonly node: OoxmlNode;
  readonly start: number;
  readonly end: number;
  /**
   * When set, deleting this segment removes every listed node id in one step (atomic
   * field begin→end or `fldSimple`). Absent for ordinary text/tab/break segments.
   */
  readonly removeNodeIds?: readonly string[];
  /**
   * When set, run formatting for this atom targets these runs (field result ownership),
   * not necessarily `runId`. Absent for ordinary text/tab/break segments.
   */
  readonly formatRunIds?: readonly string[];
}

/** Node id that locates a segment in paragraph ancestry: its run, or its runless atom. */
export function segmentAncestryNodeId(segment: Segment): string {
  return segment.runId || segment.node.id;
}

export function isParagraph(node: OoxmlNode | null): node is OoxmlParagraphNode {
  return node !== null && node.kind === 'paragraph';
}

/**
 * Flatten a paragraph into UTF-16 addressable segments, in document order.
 *
 * A HYPERLINK's runs are addressed too. `w:hyperlink` is a run container, not a leaf, and
 * the characters inside a link are ordinary paragraph text: the user selects them, types
 * over them and deletes them like any other. Skipping the container — which is what
 * iterating only direct `w:r` children did — left every link's text with no offsets at all,
 * so `paragraphTextOf` read "Visit  or ." for a sentence that says "Visit Example.com or
 * Anthropic's website." and layout, selection and the ops all agreed on the wrong string.
 *
 * Inline CONTENT CONTROLS are the same class of wrapper: their `w:sdtContent` runs join the
 * paragraph's offset stream with no break opportunity at the boundary. Nesting is bounded
 * (`MAX_INLINE_CONTAINER_DEPTH`); beyond the bound the wrapper is opaque so recursion
 * cannot exhaust the stack.
 *
 * `runId` stays the id of the run the content actually lives in, at whatever depth: the
 * appliers resolve it with `findNode` and rebuild that run's children, so nesting costs them
 * nothing.
 */
export function segmentsOf(paragraph: OoxmlParagraphNode): readonly Segment[] {
  // The offset index walks the same segments; one array per paragraph, not two.
  const indexed = offsetIndexCache.get(paragraph);
  if (indexed) return indexed.segments;
  const cached = segmentsCache.get(paragraph);
  if (cached) return cached;
  const segments = freezeSegments(walkParagraph(paragraph, null, null));
  segmentsCache.set(paragraph, segments);
  return segments;
}

/** Shared by every reader of a paragraph, so no reader can change another's segments. */
function freezeSegments(segments: Segment[]): readonly Segment[] {
  for (const segment of segments) Object.freeze(segment);
  return Object.freeze(segments);
}

/**
 * A paragraph's segments as caller-owned objects: {@link segmentsOf} for the public entry
 * point. Internal readers share one frozen array; a host gets its own copies, as it did when
 * every call walked the paragraph again.
 */
export function segmentsOfCopy(paragraph: OoxmlParagraphNode): Segment[] {
  return segmentsOf(paragraph).map((segment) => ({ ...segment }));
}

/**
 * MEMOIZED ON NODE IDENTITY, like {@link paragraphOffsetIndex}. One op asks for the same
 * paragraph's segments several times (validation, the split at each range edge, the apply),
 * and each walk costs the whole paragraph.
 */
const segmentsCache = new FieldResultsModeMemo<OoxmlParagraphNode, readonly Segment[]>();

/**
 * Hand `previous`'s segments to `next`, a rebuild of it that changed ONLY run properties.
 *
 * A `w:rPr` contributes no offsets and every other child is kept by identity, so the
 * segments are the same values. A formatting press emits one op per run it covers, and
 * without this each op walked the whole paragraph again: quadratic in its run count.
 * @internal
 */
export function carrySegmentsAcrossRunPropertyEdit(
  previous: OoxmlParagraphNode,
  next: OoxmlParagraphNode,
  /** Whether `node` is in the rebuilt tree, as the same object. */
  holds: (node: OoxmlNode) => boolean
): void {
  const segments = segmentsCache.get(previous) ?? offsetIndexCache.get(previous)?.segments;
  if (!segments || segmentsCache.has(next) || offsetIndexCache.has(next)) return;
  // A segment's node is a text value or an atom. Only an atom with children can hold an edited
  // run, such as a simple field and its result runs, and the write rebuilt that atom.
  for (const segment of containerSegmentsOf(segments)) if (!holds(segment.node)) return;
  segmentsCache.set(next, segments);
}

/** The segments whose node holds other nodes, which a run-property write can rebuild. */
const containerSegments = new WeakMap<readonly Segment[], readonly Segment[]>();
function containerSegmentsOf(segments: readonly Segment[]): readonly Segment[] {
  const known = containerSegments.get(segments);
  if (known) return known;
  const found = segments.filter((s) => s.node.kind !== 'textValue' && s.node.children.length > 0);
  containerSegments.set(segments, found);
  return found;
}

let paragraphWalks: { count: number } | null = null;
/** @internal Counts whole-paragraph segment walks while `run` executes, for scaling tests. */
export function countParagraphWalksForTest(run: () => void): number {
  const observer = { count: 0 };
  paragraphWalks = observer;
  try {
    run();
  } finally {
    paragraphWalks = null;
  }
  return observer.count;
}

/** Build segments with field spans already computed by the caller. @internal */
export function segmentsOfWithFieldSpans(
  paragraph: OoxmlParagraphNode,
  fieldSpans: readonly AtomicFieldSpan[]
): Segment[] {
  return walkParagraph(paragraph, null, null, fieldSpans);
}

export interface NoteSegmentProjection {
  readonly segments: readonly Segment[];
  readonly ancestorsByNodeId: ReadonlyMap<string, readonly OoxmlNode[]>;
}

const noteSegmentProjectionCache = new FieldResultsModeMemo<
  OoxmlParagraphNode,
  NoteSegmentProjection
>();

/** Segment offsets plus note ancestry, derived by the same single paragraph walk. */
export function noteSegmentsWithAncestorsOf(paragraph: OoxmlParagraphNode): NoteSegmentProjection {
  const cached = noteSegmentProjectionCache.get(paragraph);
  if (cached) return cached;
  const ancestorsByNodeId = new Map<string, readonly OoxmlNode[]>();
  const result = {
    segments: walkParagraph(paragraph, null, ancestorsByNodeId),
    ancestorsByNodeId,
  };
  noteSegmentProjectionCache.set(paragraph, result);
  return result;
}

/** Half-open `[start, end)` of one node in its paragraph's model offset space. */
export interface OffsetSpan {
  readonly start: number;
  readonly end: number;
}

/**
 * Every node's place in the paragraph's model offset space, from the SAME walk `segmentsOf`
 * uses.
 *
 * The offset model has exactly one authority, and this is how a caller borrows it. Three
 * private walkers used to re-derive it — one in the tracked-change writer, one in the comment
 * anchor reader, one in the review queue — and all three disagreed with `segmentsOf` and with
 * each other: none gave a note reference or an atomic field its length of one, one counted a
 * field's instruction text as visible characters, and one never descended into `w:hyperlink`
 * at all. The consequences were an anchor short by a link's length, two unrelated comments
 * threaded onto one zero-width offset, and a tracked insert landing a character out in any
 * paragraph carrying a footnote. Patching each walker only resets the clock on the next drift.
 *
 * A node the walk never reaches — content under a `generic` container, or past the nesting cap
 * — has NO span, and {@link ParagraphOffsetIndex.lengthOf} reports zero for it. That is the
 * same answer `segmentsOf` gives: it contributes no addressable characters.
 */
export interface ParagraphOffsetIndex {
  /** The paragraph's own length, identical to {@link paragraphLength}. */
  readonly length: number;
  readonly segments: readonly Segment[];
  /** Where a node sits, or null when the offset walk never reached it. */
  spanOf(node: OoxmlNode | string): OffsetSpan | null;
  /** A node's model length: `end - start` of its span, and 0 when it has none. */
  lengthOf(node: OoxmlNode | string): number;
}

/**
 * MEMOIZED ON NODE IDENTITY. A paragraph node is immutable — a transaction rebuilds the path
 * to what it edited and leaves every other paragraph object-identical — so the index derived
 * from one can be reused until that paragraph itself changes.
 *
 * This is not a micro-optimization. Three whole-document readers call this per paragraph on
 * every commit (the review queue, the comment anchors, the tracked-change writer), so on a
 * long document one keystroke re-walked every paragraph in the file several times over, and
 * the cost showed up as typing latency that grew with document length.
 */
const offsetIndexCache = new FieldResultsModeMemo<OoxmlParagraphNode, ParagraphOffsetIndex>();

/**
 * THE paragraph offset authority: maps a paragraph's UTF-16 offsets to the nodes holding them.
 *
 * One authority on purpose. An atomic field spans many nodes but is ONE unit to an offset, and a
 * second implementation that disagreed would place edits inside content that cannot be split.
 */
export function paragraphOffsetIndex(paragraph: OoxmlParagraphNode): ParagraphOffsetIndex {
  const cached = offsetIndexCache.get(paragraph);
  if (cached) return cached;
  const index = buildParagraphOffsetIndex(paragraph);
  offsetIndexCache.set(paragraph, index);
  // `segmentsOf` reads the index's array from now on.
  segmentsCache.delete(paragraph);
  return index;
}

/** Addressable length of one node, read from the paragraph offset authority. */
export function paragraphInlineLengthOf(paragraph: OoxmlParagraphNode, node: OoxmlNode): number {
  return paragraphOffsetIndex(paragraph).lengthOf(node);
}

/** Build an offset index without populating the interactive paragraph memo. @internal */
export function transientParagraphOffsetIndex(paragraph: OoxmlParagraphNode): ParagraphOffsetIndex {
  return buildParagraphOffsetIndex(paragraph);
}

function buildParagraphOffsetIndex(paragraph: OoxmlParagraphNode): ParagraphOffsetIndex {
  const spans = new Map<string, OffsetSpan>();
  const segments = freezeSegments(walkParagraph(paragraph, spans, null));
  const length = segments.length === 0 ? 0 : segments[segments.length - 1]!.end;
  const lookup = (node: OoxmlNode | string): OffsetSpan | null =>
    spans.get(typeof node === 'string' ? node : node.id) ?? null;
  return {
    length,
    segments,
    spanOf: lookup,
    lengthOf: (node) => {
      const span = lookup(node);
      return span === null ? 0 : span.end - span.start;
    },
  };
}

function walkParagraph(
  paragraph: OoxmlParagraphNode,
  spans: Map<string, OffsetSpan> | null,
  noteAncestors: Map<string, readonly OoxmlNode[]> | null,
  suppliedFieldSpans?: readonly AtomicFieldSpan[]
): Segment[] {
  if (paragraphWalks) paragraphWalks.count += 1;
  const segments: Segment[] = [];
  let offset = 0;
  /** Record a node's span. No-op for `segmentsOf`, which asks for none. */
  const record = (node: OoxmlNode, start: number): void => {
    if (spans !== null) spans.set(node.id, { start, end: offset });
  };
  const atoms = suppliedFieldSpans ?? atomicFieldSpansOf(paragraph);
  const noteAtoms = atomicNoteSpansOf(paragraph);
  const atomByBeginId = new Map(atoms.map((span) => [span.node.id, span]));
  const noteAtomById = new Map(noteAtoms.map((span) => [span.node.id, span]));
  /** Node ids swallowed by a well-formed atomic field (chrome + cached result). */
  const covered = new Set<string>();
  const ancestorPath: OoxmlNode[] = [paragraph];
  const captureNoteAncestors = (node: OoxmlNode): void => {
    if (noteAncestors !== null && node.kind === 'noteReference') {
      noteAncestors.set(node.id, ancestorPath.slice());
    }
  };
  for (const span of atoms) {
    for (const id of span.removeNodeIds) covered.add(id);
  }

  const emitAtom = (span: {
    readonly runId: string;
    readonly node: OoxmlNode;
    readonly removeNodeIds: readonly string[];
    readonly formatRunIds?: readonly string[];
  }): void => {
    captureNoteAncestors(span.node);
    segments.push({
      runId: span.runId,
      node: span.node,
      start: offset,
      end: offset + 1,
      removeNodeIds: span.removeNodeIds,
      ...(span.formatRunIds && span.formatRunIds.length > 0
        ? { formatRunIds: span.formatRunIds }
        : {}),
    });
    offset += 1;
  };

  const visitRunChild = (
    node: OoxmlNode,
    runId: string,
    namespaceScope: ReadonlyMap<string, string> = emptyNamespaceScope()
  ): void => {
    const start = offset;
    const scope =
      node.kind !== 'textValue' && 'localName' in node
        ? namespaceScopeForNode(namespaceScope, node as OoxmlElement)
        : namespaceScope;
    const atom = atomByBeginId.get(node.id);
    if (atom && atom.kind === 'complex') {
      emitAtom(atom);
      record(node, start);
      return;
    }
    if (covered.has(node.id)) {
      record(node, start);
      return;
    }
    const noteAtom = noteAtomById.get(node.id);
    if (noteAtom) {
      emitAtom(noteAtom);
      record(node, start);
      return;
    }
    if (isNoteAtomNode(node)) {
      // Should not happen — typed atoms are always in noteAtomById — but fail soft.
      emitAtom({ runId, node, removeNodeIds: [node.id] });
      record(node, start);
      return;
    }
    if (
      isFieldChrome(node) ||
      isFldChar(node, 'begin') ||
      isFldChar(node, 'separate') ||
      isFldChar(node, 'end') ||
      isInstrText(node)
    ) {
      // Demoted / orphan markers: no model contribution; content preserved in the tree.
      record(node, start);
      return;
    }
    if (node.kind === 'textValue') {
      segments.push({ runId, node, start: offset, end: offset + node.value.length });
      offset += node.value.length;
      record(node, start);
      return;
    }
    if (node.kind === 'tab' || node.kind === 'hardBreak') {
      segments.push({ runId, node, start: offset, end: offset + 1 });
      offset += 1;
      record(node, start);
      return;
    }
    if (node.kind === 'drawing' || isLegacyVmlAtom(node)) {
      emitAtom({ runId, node, removeNodeIds: [node.id] });
      record(node, start);
      return;
    }
    if (node.kind === 'runProperties') {
      record(node, start);
      return;
    }
    if (node.kind === 'generic') {
      // A non-breaking or optional hyphen is one character, like a tab.
      if (inlineCharacterTextOf(node) !== null) {
        segments.push({ runId, node, start: offset, end: offset + 1 });
        offset += 1;
        record(node, start);
        return;
      }
      if (isRunLevelMcAlternateContent(node)) {
        const mcAtom = resolveRunLevelMcAtom(node, scope, DEFAULT_SUPPORTED_MC_REQUIRES);
        emitAtom({ runId, node: mcAtom.segmentNode, removeNodeIds: mcAtom.removeNodeIds });
      }
      record(node, start);
      return;
    }
    // Misplaced typed control inside a run (should demote on read) — stay opaque so a
    // husk cannot invent atoms the way a paragraph-level inline control legitimately does.
    if (isContentControlNode(node)) {
      record(node, start);
      return;
    }
    if (node.kind === 'text' || node.kind === 'deletedText') {
      ancestorPath.push(node);
      for (const child of node.children) visitRunChild(child, runId, scope);
      ancestorPath.pop();
      record(node, start);
      return;
    }
    ancestorPath.push(node);
    for (const child of node.children) visitRunChild(child, runId, scope);
    ancestorPath.pop();
    record(node, start);
  };
  const visitInline = (child: OoxmlNode, depth: number): void => {
    const start = offset;
    if (child.kind === 'textValue' || depth >= MAX_INLINE_CONTAINER_DEPTH) {
      record(child, start);
      return;
    }
    if (isMathEquation(child)) {
      emitAtom({ runId: child.id, node: child, removeNodeIds: [child.id] });
      record(child, start);
      return;
    }
    if (isFldSimple(child)) {
      const atom = atomByBeginId.get(child.id);
      if (atom) {
        emitAtom(atom);
        // A simple field is one model atom, but its result runs remain public run addresses.
        // Give every result run the atom span without changing the paragraph offset space.
        if (spans !== null) {
          for (const runId of atom.formatRunIds) spans.set(runId, { start, end: offset });
        }
      } else {
        // An editable saved result: its runs are ordinary text inside the field element.
        ancestorPath.push(child);
        for (const inner of child.children) visitInline(inner, depth + 1);
        ancestorPath.pop();
      }
      record(child, start);
      return;
    }
    if (child.kind === 'run') {
      const runScope = namespaceScopeForNode(emptyNamespaceScope(), child);
      ancestorPath.push(child);
      for (const grand of child.children) visitRunChild(grand, child.id, runScope);
      ancestorPath.pop();
      record(child, start);
      return;
    }
    // Bookmark and range markers measure nothing; only a run CONTAINER descends. A link and a
    // revision wrapper are both containers, and either can hold the other — a link inside a
    // tracked insertion is ordinary. Not descending is what made tracked text invisible to the
    // op offset space, so every op past it was refused as out of range.
    if (isInlineRunContainer(child)) {
      ancestorPath.push(child);
      for (const inner of child.children) visitInline(inner, depth + 1);
      ancestorPath.pop();
      // The container owns the full span its descendants contributed. Tracked typing uses
      // this span to descend back into the author's existing `w:ins`; without it, the first
      // character was addressable but the second saw the wrapper as length zero and was
      // refused as past the paragraph.
      record(child, start);
      return;
    }
    // Inline content controls: descend into `w:sdtContent` with a nesting bound.
    if (isContentControlNode(child)) {
      const content = contentControlContentOf(child);
      if (content) {
        const contentStart = offset;
        ancestorPath.push(child, content);
        for (const inner of content.children) visitInline(inner, depth + 1);
        ancestorPath.pop();
        ancestorPath.pop();
        // The CONTENT node owns the span its children contributed, not only the wrapper.
        // Without this a caller that descends into `w:sdtContent` — placing a comment
        // marker inside a control, which the schema allows — asks for its span, gets null,
        // and refuses every offset inside the control.
        spans?.set(content.id, { start: contentStart, end: offset });
      }
    }
    record(child, start);
  };
  for (const child of paragraph.children) visitInline(child, 0);
  return segments;
}

export { MAX_INLINE_CONTAINER_DEPTH } from '../package/ooxml-shared.ts';

/**
 * The runs a paragraph child owns, at any depth — a `w:r`, or every run inside a container.
 *
 * Links, revision wrappers, and inline content controls are all run containers.
 */
export function runsUnder(child: OoxmlNode, depth = 0): OoxmlNode[] {
  if (child.kind === 'textValue' || depth >= MAX_INLINE_CONTAINER_DEPTH) return [];
  if (child.kind === 'run') return [child];
  if (isInlineRunContainer(child)) {
    return child.children.flatMap((inner) => runsUnder(inner, depth + 1));
  }
  if (isContentControlNode(child)) {
    const content = contentControlContentOf(child);
    if (!content) return [];
    return content.children.flatMap((inner) => runsUnder(inner, depth + 1));
  }
  return [];
}

/**
 * Where an insertion at a UTF-16 offset actually puts its content.
 *
 * THE OFFSET IS NOT THE ANSWER ON ITS OWN. A boundary belongs to the run that starts there, an
 * offset past everything in scope appends to the last run in scope, and a scope holding no run
 * at all needs one minted INTO A PARTICULAR NODE. Validation has to resolve the same site the
 * applier writes at, or a refusal is reasoning about a different place than the write — which is
 * how a named insertion into an unlocked outer control ended up landing inside a locked nested
 * one, first through the run it joined and then through the paragraph it minted a run in.
 */
export type InsertionSite =
  /** Inside a text value: it splits and the content goes between the halves. */
  | { readonly kind: 'withinValue'; readonly segment: Segment }
  /** At a run boundary: the content goes into that run, before the segment's own node. */
  | { readonly kind: 'atBoundary'; readonly segment: Segment }
  /** Past every segment in scope: the content is appended to this run. */
  | { readonly kind: 'appendToRun'; readonly run: OoxmlElement }
  /** Between run children, after zero-width field chrome. */
  | { readonly kind: 'atRunIndex'; readonly run: OoxmlElement; readonly index: number }
  /** No run in scope holds the offset: a run is minted in this node at `index`. */
  | { readonly kind: 'newRun'; readonly holder: OoxmlElement; readonly index?: number };

/**
 * Resolve {@link InsertionSite} for an offset, optionally narrowed to one owner's own content.
 *
 * `owner` is the content control a caller NAMED as the destination. Narrowing to it makes a
 * control's trailing edge mean "the end of the field" rather than "the run after it". Without
 * one, an outer run-wrapper edge receives a sibling run.
 */
export function insertionSite(
  paragraph: OoxmlParagraphNode,
  offset: number,
  owner: OoxmlNode | null,
  bias?: 'left' | 'right'
): InsertionSite {
  const before =
    owner === null && bias === 'left'
      ? leadingPromptSite(paragraph, offset, paragraphOffsetIndex(paragraph))
      : null;
  const raw = before ?? rawInsertionSite(paragraph, offset, owner, bias);
  if (owner !== null) return raw;
  // Beside a control typing cannot enter, then out of a deletion around wherever that is.
  const site = besideRestrictedControlAt(paragraph, offset, raw) ?? raw;
  if (site.kind !== 'newRun' && site.kind !== 'atRunIndex') return site;
  const target = site.kind === 'newRun' ? site.holder : site.run;
  const ancestors = [target, ...inlineContainersOf(paragraph, target.id)];
  if (
    !ancestors.some((node) => node.kind === 'revisionDelete' || node.kind === 'revisionMoveFrom')
  ) {
    return site;
  }
  // A newly minted run must survive accepting the deletion. Escape the outermost
  // revision, using the same destination for protection checks and application.
  const revision = ancestors.filter((node) => isContentRevisionKind(node.kind)).at(-1)!;
  const holder = directParentOf(paragraph, revision.id) ?? paragraph;
  const index = holder.children.findIndex((child) => child.id === revision.id);
  const span = paragraphOffsetIndex(paragraph).spanOf(revision);
  return { kind: 'newRun', holder, index: index + (span && offset > span.start ? 1 : 0) };
}

function besideRestrictedControlAt(
  paragraph: OoxmlParagraphNode,
  offset: number,
  site: InsertionSite
): InsertionSite | null {
  return besideRestrictedControl(
    paragraph,
    offset,
    siteLandingNodeId(site),
    paragraphOffsetIndex(paragraph)
  );
}

/**
 * Whether an unowned insertion at `offset` lands beside a control that typing cannot enter,
 * at that control's edge, rather than in the run the default rule reads. Validation then
 * checks the place the insert actually lands. That covers a control wrapped in a revision or
 * a hyperlink too, where the default site already leaves the wrapper.
 */
export function insertsBesideRestrictedControl(
  paragraph: OoxmlParagraphNode,
  offset: number,
  bias: 'left' | 'right' = 'left'
): boolean {
  if (!holdsContentControl(paragraph)) return false;
  const controls = restrictedControlsWithEdgeAt(paragraph, offset, paragraphOffsetIndex(paragraph));
  if (controls.length === 0) return false;
  const landingId = siteLandingNodeId(insertionSite(paragraph, offset, null, bias));
  return controls.every((control) => !containsNode(control, landingId));
}

/**
 * The closing marker at the trailing caret boundary of a field whose result is addressable (a
 * legacy text form, or a saved result in the `editable` mode): text typed there lands after
 * the field, not inside its result.
 */
export function textFormFieldEndAt(
  paragraph: OoxmlParagraphNode,
  offset: number
): string | undefined {
  const offsets = paragraphOffsetIndex(paragraph);
  for (const field of parsedFieldSpansOf(paragraph)) {
    if (field.addressing === 'atomic') continue;
    const endId = field.removeNodeIds.at(-1);
    if (endId && offsets.spanOf(endId)?.end === offset) return endId;
  }
  return undefined;
}

const orphanFieldEnds = new FieldResultsModeMemo<OoxmlParagraphNode, ReadonlyMap<number, string>>();

/** A trailing field marker must stay before content inserted at its zero-width boundary. */
export function fieldInsertionEndAt(
  paragraph: OoxmlParagraphNode,
  offset: number
): string | undefined {
  const form = textFormFieldEndAt(paragraph, offset);
  if (form) return form;
  return orphanFieldEndAt(paragraph, offset);
}

export function orphanFieldEndAt(
  paragraph: OoxmlParagraphNode,
  offset: number
): string | undefined {
  let ends = orphanFieldEnds.get(paragraph);
  if (!ends) {
    const found = new Map<number, string>();
    const offsets = paragraphOffsetIndex(paragraph);
    const closed = new Set(parsedFieldSpansOf(paragraph).flatMap((field) => field.removeNodeIds));
    const walk = (node: OoxmlNode, depth: number): void => {
      if (node.kind === 'textValue' || depth >= MAX_INLINE_CONTAINER_DEPTH) return;
      if (isFldChar(node, 'end') && !closed.has(node.id)) {
        const span = offsets.spanOf(node);
        if (span && span.start === span.end) found.set(span.end, node.id);
      }
      for (const child of node.children) walk(child, nextInlineContainerDepth(node, depth));
    };
    walk(paragraph, 0);
    ends = found;
    orphanFieldEnds.set(paragraph, ends);
  }
  return ends.get(offset);
}

function rawInsertionSite(
  paragraph: OoxmlParagraphNode,
  offset: number,
  owner: OoxmlNode | null,
  bias: 'left' | 'right' = 'left'
): InsertionSite {
  const offsets = paragraphOffsetIndex(paragraph);
  const all = offsets.segments;
  const segments =
    owner === null ? all : all.filter((segment) => containsNode(owner, segment.node.id));

  for (const segment of segments) {
    if (segment.node.kind !== 'textValue') continue;
    if (offset <= segment.start || offset >= segment.end) continue;
    return { kind: 'withinValue', segment };
  }
  const afterAtom = insertionSiteAfterAtom(paragraph, offset, owner, bias);
  if (afterAtom) return afterAtom;
  const boundary = segments.find((segment) => segment.start === offset);
  if (owner === null && boundary) {
    const boundaryIndex = all.findIndex((segment) => segment === boundary);
    const preceding = boundaryIndex > 0 ? all[boundaryIndex - 1]! : null;
    const containers = inlineContainersOf(paragraph, segmentAncestryNodeId(boundary));
    // Default typing at a wrapper edge stays outside, but `bias: 'right'` explicitly asks to
    // join the run that starts there. Resolve its innermost transparent container before the
    // ordinary wrapper-edge escape, so the default rule cannot override the caller's request.
    const biasedContainer =
      bias === 'right'
        ? containers.find(
            (container) =>
              isInlineRunContainer(container) && offsets.spanOf(container)?.start === offset
          )
        : null;
    if (biasedContainer) {
      const biasedBoundary = all.find(
        (segment) =>
          segment.start === offset && containsNode(biasedContainer, segmentAncestryNodeId(segment))
      );
      if (biasedBoundary) return { kind: 'atBoundary', segment: biasedBoundary };
    }
    let outermostWrapper = -1;
    for (let index = 0; index < containers.length; index += 1) {
      const container = containers[index]!;
      if (!isInlineRunContainer(container) || offsets.spanOf(container)?.start !== offset) continue;
      const precedingId = preceding?.end === offset ? segmentAncestryNodeId(preceding) : null;
      const holder = directParentOf(paragraph, container.id) ?? paragraph;
      const continued =
        precedingId !== null && !containsNode(container, precedingId)
          ? continuedRevisionRun(holder, container, preceding!.runId)
          : null;
      if (continued) return { kind: 'appendToRun', run: continued };
      const followsContentInSameWrapper =
        precedingId !== null && containsNode(container, precedingId);
      if (!followsContentInSameWrapper) outermostWrapper = index;
    }
    const entered = outermostWrapper >= 0 ? containers[outermostWrapper] : null;
    if (entered) {
      const holder = directParentOf(paragraph, entered.id) ?? paragraph;
      const index = holder.children.findIndex((child) => child.id === entered.id);
      return index < 0 ? { kind: 'newRun', holder } : { kind: 'newRun', holder, index };
    }
  }
  if (owner === null && boundary && bias === 'left') {
    const preceding = [...all].reverse().find((segment) => segment.end === offset);
    if (preceding && preceding.removeNodeIds === undefined) {
      const exited = inlineContainersOf(paragraph, segmentAncestryNodeId(preceding))
        .filter(
          (container) =>
            container.kind === 'generic' &&
            isInlineRunContainer(container) &&
            offsets.spanOf(container)?.end === offset &&
            !containsNode(container, segmentAncestryNodeId(boundary))
        )
        .at(-1);
      if (exited) {
        const holder = directParentOf(paragraph, exited.id) ?? paragraph;
        // Both runs must remain in the same enclosing owner. Leaving a hyperlink or
        // control keeps that owner's established boundary behavior.
        if (containsNode(holder, segmentAncestryNodeId(boundary))) {
          const index = holder.children.findIndex((child) => child.id === exited.id);
          return { kind: 'newRun', holder, index: index + 1 };
        }
      }
    }
  }
  if (owner === null && boundary?.removeNodeIds) {
    const holder = directParentOf(paragraph, boundary.node.id);
    // Runless atoms are siblings of runs inside transparent wrappers too. Resolve
    // the actual holder so the applier never mistakes the atom id for a run id.
    if (holder && isInlineRunContainer(holder)) {
      const index = holder.children.findIndex((child) => child.id === boundary.node.id);
      if (index >= 0) return { kind: 'newRun', holder, index };
    }
  }
  if (boundary) return { kind: 'atBoundary', segment: boundary };

  if (owner === null) {
    const trailing = segments[segments.length - 1];
    if (trailing?.end === offset) {
      const afterField = afterTrailingFieldEnd(paragraph, trailing, offset);
      if (afterField) return afterField;
      const containers = inlineContainersOf(paragraph, segmentAncestryNodeId(trailing));
      let outermostWrapper = -1;
      for (let index = 0; index < containers.length; index += 1) {
        if (isInlineRunContainer(containers[index]!)) outermostWrapper = index;
      }
      const exited = outermostWrapper >= 0 ? containers[outermostWrapper] : (containers[0] ?? null);
      if (exited) {
        const holder = directParentOf(paragraph, exited.id) ?? paragraph;
        const index = holder.children.findIndex((child) => child.id === exited.id);
        return {
          kind: 'newRun',
          holder,
          ...(index < 0 ? {} : { index: index + 1 }),
        };
      }
      const direct = paragraph.children.find(
        (child) => child.id === segmentAncestryNodeId(trailing)
      );
      if (direct?.kind === 'run') return { kind: 'appendToRun', run: direct };
    }
  }

  const runs =
    owner === null
      ? paragraph.children.filter((child) => child.kind === 'run')
      : paragraph.children
          .flatMap((child) => runsUnder(child))
          .filter((run) => containsNode(owner, run.id));
  const last = runs[runs.length - 1];
  if (last && last.kind !== 'textValue') {
    // A named owner still LEAVES an inner wrapper at its trailing edge: typing after the last
    // character of a hyperlink inside a control stays in the control and out of the link, the
    // same escape the unowned path makes, bounded to wrappers the owner holds.
    const exited =
      owner === null || offsets.spanOf(last)?.end !== offset
        ? null
        : inlineContainersOf(paragraph, last.id)
            .filter(
              (container) =>
                container.id !== owner.id &&
                containsNode(owner, container.id) &&
                container.kind !== 'contentControl' &&
                container.kind !== 'contentControlContent' &&
                isInlineRunContainer(container) &&
                offsets.spanOf(container)?.end === offset
            )
            .at(-1);
    if (!exited) return { kind: 'appendToRun', run: last };
    const holder = directParentOf(paragraph, exited.id) ?? paragraph;
    const index = holder.children.findIndex((child) => child.id === exited.id);
    return { kind: 'newRun', holder, ...(index < 0 ? {} : { index: index + 1 }) };
  }
  // Nothing to join, so the run is minted — and WHICH NODE it is minted into is the whole of
  // which controls receive it. A named owner that HOLDS this paragraph gets the run in the
  // paragraph, which is inside every control between the owner and it; an inline owner gets it
  // as the last child of its own content, beside anything nested there rather than inside it.
  const holder =
    owner === null || owner.kind === 'textValue' || containsNode(owner, paragraph.id)
      ? paragraph
      : contentHolder(owner);
  return { kind: 'newRun', holder };
}

export interface InsertionDestination {
  readonly site: InsertionSite;
  readonly landingNodeId: string;
  /** Every node from the paragraph through the landing node, including both endpoints. */
  readonly path: ReadonlySet<string>;
}

/** Resolve one insertion site and its complete paragraph-local ancestor path. */
export function insertionDestination(
  paragraph: OoxmlParagraphNode,
  offset: number,
  owner: OoxmlNode | null,
  bias?: 'left' | 'right'
): InsertionDestination {
  const site = insertionSite(paragraph, offset, owner, bias);
  const landingNodeId =
    site.kind === 'withinValue' || site.kind === 'atBoundary'
      ? segmentAncestryNodeId(site.segment)
      : site.kind === 'appendToRun' || site.kind === 'atRunIndex'
        ? site.run.id
        : site.holder.id;
  const path = new Set<string>();
  const collect = (node: OoxmlNode): boolean => {
    if (node.id === landingNodeId) {
      path.add(node.id);
      return true;
    }
    if (node.kind === 'textValue') return false;
    const holds = node.children.some(collect);
    if (holds) path.add(node.id);
    return holds;
  };
  collect(paragraph);
  return { site, landingNodeId, path };
}

/** Where a run goes inside a control: its content element, or the control itself. */
function contentHolder(control: OoxmlElement): OoxmlElement {
  for (const child of control.children) {
    if (child.kind === 'textValue') continue;
    if (child.kind === 'contentControlContent') return child;
    if (child.kind === 'generic' && child.localName === 'sdtContent') return child;
  }
  return control;
}

/**
 * The node whose enclosing controls receive an insertion.
 *
 * The run the content joins, or — when there is none to join — the node a run is minted in. The
 * second case is not "nowhere": a control holding an empty paragraph receives the minted run just
 * as surely as one holding a run receives appended text, and answering `null` for it is what let
 * a named write into an unlocked outer control fill a locked inner one's empty paragraph.
 */
export function insertionLandingNodeId(
  paragraph: OoxmlParagraphNode,
  offset: number,
  owner: OoxmlNode | null,
  bias?: 'left' | 'right'
): string {
  return insertionDestination(paragraph, offset, owner, bias).landingNodeId;
}

export interface TrailingInsertionDestination {
  readonly holderId: string;
  readonly path: ReadonlySet<string>;
}

/** Holder and ancestor ids for the shared unowned trailing insertion site. */
export function trailingInsertionDestination(
  paragraph: OoxmlParagraphNode,
  offset: number
): TrailingInsertionDestination | null {
  const destination = insertionDestination(paragraph, offset, null);
  if (destination.site.kind !== 'newRun') return null;
  return { holderId: destination.site.holder.id, path: destination.path };
}

function containsNode(node: OoxmlNode, id: string): boolean {
  if (node.id === id) return true;
  if (node.kind === 'textValue') return false;
  return node.children.some((child) => containsNode(child, id));
}

/** UTF-16 length of a paragraph under the shared segment model. */
export function paragraphLength(paragraph: OoxmlParagraphNode): number {
  const segments = segmentsOf(paragraph);
  return segments.length === 0 ? 0 : segments[segments.length - 1]!.end;
}

export {
  inlineControlEndingAt,
  inlineControlStartingAt,
  type InlineControlSpan,
} from './tree-op-inline-control-spans.ts';

/**
 * Whether `offset` falls strictly inside content that NO split can divide.
 *
 * A run divides at any offset, so a boundary inside one is a place. Three things are not:
 *
 *   - an inline CONTAINER — `w:hyperlink`, an inline `w:sdt`, a revision wrapper — which is a
 *     paragraph child holding runs. Splitting the run inside it leaves the container whole, so
 *     a caller placing a sibling at that offset would put it beside the container instead of
 *     where the offset actually is;
 *   - an ATOMIC FIELD, whose begin/instruction/separate/result/end runs spell ONE unit, and
 *     which the offset model already reports as one segment;
 *   - a note reference, for the same reason.
 *
 * An op that places a node at an offset asks this first and refuses, rather than emitting the
 * node somewhere the caller did not name. The alternative — descending into the container and
 * re-wrapping each half — is what `distributeInline` does for the ops that own that shape.
 *
 * Boundaries are places: `offset === span.start` and `offset === span.end` both answer false,
 * which is what puts a control immediately before or after a link rather than refusing.
 */
export function indivisibleAt(paragraph: OoxmlParagraphNode, offset: number): boolean {
  const index = paragraphOffsetIndex(paragraph);
  for (const segment of index.segments) {
    // `removeNodeIds` is the offset model's own record of "these nodes are one unit".
    if (!segment.removeNodeIds) continue;
    if (segment.start < offset && offset < segment.end) return true;
  }
  for (const child of paragraph.children) {
    // A run divides at any offset inside it, which is what `splitRunsAt` does; every other
    // child is taken whole or not at all.
    if (child.kind === 'run') continue;
    const span = index.spanOf(child);
    if (span && span.start < offset && offset < span.end) return true;
  }
  return false;
}

/** Whether an offset falls between the halves of a surrogate pair. */
export function splitsSurrogate(paragraph: OoxmlParagraphNode, offset: number): boolean {
  for (const segment of segmentsOf(paragraph)) {
    if (segment.node.kind !== 'textValue') continue;
    if (offset <= segment.start || offset >= segment.end) continue;
    const local = offset - segment.start;
    const before = segment.node.value.charCodeAt(local - 1);
    const after = segment.node.value.charCodeAt(local);
    if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) return true;
  }
  return false;
}
