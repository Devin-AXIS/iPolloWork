// Document text search over the canonical tree, for the navigation pane's Find tab.
//
// Sibling of `document-outline.ts` and under the same discipline: the derivation reads the
// CANONICAL TREE — never the DOM, never the layout — and every string that leaves this
// module is bounded here at the derivation boundary. A match's text and its surrounding
// context are authored file content, and the panel rows that render them are chrome, so
// downstream sinks only ever receive strings this module has already bounded.
//
// NO REGEX ON THE HAYSTACK OR THE NEEDLE. Both are attacker-influenced (the document is a
// zip of XML the author controls; the query is host input), and a pattern built from either
// is a catastrophic-backtracking hazard. Scanning is `indexOf` only. The one regex here
// runs against a SINGLE character at a time for the whole-word test, where there is no
// backtracking to trigger.
//
// OFFSETS ARE `paragraphTextOf`'s VOCABULARY — UTF-16 offsets with tabs, hard breaks, and
// atomic fields counted as one character each. Match text and context use the visible text
// projection, so a field result can be longer than the editable model range it maps to.
//
// WHAT IS SEARCHED: body, furniture, footnotes, then endnotes. Each story uses the shared
// paragraph walk, which descends into tables, nested tables, and block controls. Selectable
// body and furniture text boxes follow their owners: ANCHORED ones only, because layout paints
// no story for an inline box. Note-owned text boxes remain excluded.

import { withDisplayedHyphens } from '../store/package/hyphen-text.ts';
import {
  SEARCH_MATCH_LIMIT,
  SEARCH_QUERY_MAX,
  isSearchableQuery,
} from '@docx-editor.dev/core/store';
import type { ViewScope } from '../contracts/editor.ts';
import {
  headerFooterVariantCanPaint,
  type HeaderFooterSectionResolution,
} from '../store/package/hf-references.ts';
import {
  formatNoteScopeId,
  isNormalNote,
  noteIdOf,
  resolvableNotesOf,
  type NoteKind,
} from '../store/package/note-nodes.ts';
import { isFldSimple } from '../store/package/field-nodes.ts';
import { FieldResultsModeMemo } from '../store/package/field-result-mode.ts';
import { bodyStoryRoot, storyRootsOf } from '../store/package/story-blocks.ts';
import { walkParagraphInline } from '../store/package/content-control-walk.ts';
import type { OoxmlParagraphNode, OoxmlPart } from '../store/package/ooxml-tree.ts';
import {
  projectVisibleParagraphText,
  type ProjectedParagraphText,
} from '../store/store/text-projection.ts';
import { paragraphModelTextOf } from '../store/store/paragraph-model-text.ts';
import { paragraphOffsetIndex } from '../store/store/tree-op-segments.ts';
import {
  beginStoryParagraphSearch,
  expandSelectableTextboxStories,
  searchStoryParagraphs,
  type SearchStory,
} from './document-search-frames.ts';

export { SEARCH_MATCH_LIMIT, SEARCH_QUERY_MAX };

/** Characters of surrounding paragraph text carried on each side of a match. */
const CONTEXT_RADIUS = 48;

/** Control characters are flattened to spaces in every string that leaves this module. */
const CONTROL_CHARS_ALL = /[\u0000-\u001F\u007F-\u009F]/g;

/** How a search is narrowed. Both flags default to off, matching Word's initial state. */
export interface DocumentSearchOptions {
  readonly matchCase?: boolean;
  readonly wholeWord?: boolean;
  /** Override the default {@link SEARCH_MATCH_LIMIT}. Clamped to it; never raised past it. */
  readonly limit?: number;
  /** Stories the facade can navigate in its current mode. */
  readonly stories?: 'all' | 'body';
}

/**
 * One occurrence of a query in an editable document story.
 *
 * Carries the engine's own address (`blockId` + `start`) and the positional one a find UI
 * needs (`paragraphIndex` / `runIndex` / `runOffset`), both derived from the SAME walk —
 * a caller reconstructing run boundaries itself is where an off-by-one would come from.
 * A match can span runs when formatting changes mid-word; the run address is where it
 * STARTS.
 */
export interface DocumentSearchMatch {
  readonly blockId: string;
  readonly start: number;
  readonly length: number;
  readonly paragraphIndex: number;
  readonly runIndex: number;
  readonly runOffset: number;
  /** Story containing the match. Omitted for the body. */
  readonly scope?: ViewScope;
  /** The matched text as it appears in the document, control characters flattened. */
  readonly text: string;
  /** Paragraph text immediately before the match, bounded and flattened. */
  readonly contextBefore: string;
  /** Paragraph text immediately after the match, bounded and flattened. */
  readonly contextAfter: string;
}

/** Package stories outside the body, supplied without opening their story stores. */
export interface DocumentSearchSources {
  readonly headerFooterBySection: readonly HeaderFooterSectionResolution[];
  readonly footnotes: OoxmlPart | null;
  readonly endnotes: OoxmlPart | null;
  /** Normal note ids with a body reference that the surface can place. */
  readonly referencedNoteIds: {
    readonly footnote: ReadonlySet<number>;
    readonly endnote: ReadonlySet<number>;
  };
}

/**
 * What one search answers with.
 *
 * `truncated` says the scan stopped at the cap with matches still ahead of it, so a caller
 * can show "2000+" honestly instead of claiming an exact total it does not have.
 */
export interface DocumentSearchResult {
  readonly matches: readonly DocumentSearchMatch[];
  readonly truncated: boolean;
}

/**
 * Where each run starts, in paragraph-text offsets, in document order. Hyperlink runs and
 * `w:fldSimple` result runs are flattened where a reader meets them. An empty simple field
 * contributes no run, and its empty result cannot start a match. A complex field keeps its
 * existing run sequence; its atom starts in the begin run.
 */
interface RunStart {
  readonly id: string;
  readonly start: number;
}

function runStarts(paragraph: OoxmlParagraphNode): RunStart[] {
  const starts: RunStart[] = [];
  const offsets = paragraphOffsetIndex(paragraph);
  const simpleResultRuns = new Map<string, readonly string[]>();
  for (const segment of offsets.segments) {
    if (isFldSimple(segment.node)) {
      simpleResultRuns.set(segment.node.id, segment.formatRunIds ?? []);
    }
  }
  walkParagraphInline(
    paragraph.children,
    0,
    (node) => {
      if (node.kind === 'run') {
        starts.push({ id: node.id, start: offsets.spanOf(node)?.start ?? 0 });
        return;
      }
      if (!isFldSimple(node)) return;
      for (const runId of simpleResultRuns.get(node.id) ?? []) {
        const span = offsets.spanOf(runId);
        if (span) starts.push({ id: runId, start: span.start });
      }
    },
    { descendRevisions: true }
  );
  return starts;
}

function bodyStories(part: OoxmlPart): SearchStory[] {
  const body = bodyStoryRoot(part);
  return body ? [{ part, root: body }] : [];
}

function furnitureStories(
  sections: readonly HeaderFooterSectionResolution[],
  seen: Set<OoxmlPart>
): SearchStory[] {
  const stories: SearchStory[] = [];
  for (const kind of ['header', 'footer'] as const) {
    for (const section of sections) {
      const slots = kind === 'header' ? section.headers : section.footers;
      for (const [variant, slot] of slots) {
        if (!headerFooterVariantCanPaint(section, variant)) continue;
        if (seen.has(slot.part)) continue;
        seen.add(slot.part);
        const story = storyRootsOf(slot.part).find((candidate) => candidate.kind === kind);
        if (story) {
          stories.push({
            part: slot.part,
            root: story.root,
            scope: { kind: 'headerFooter', rId: slot.rId },
          });
        }
      }
    }
  }
  return stories;
}

function noteStories(
  part: OoxmlPart | null,
  noteKind: NoteKind,
  referencedIds: ReadonlySet<number>
): SearchStory[] {
  if (!part) return [];
  const stories: SearchStory[] = [];
  for (const note of resolvableNotesOf(part.root)) {
    const noteId = noteIdOf(note);
    if (!isNormalNote(note) || noteId === null || !referencedIds.has(noteId)) continue;
    stories.push({
      part,
      root: note,
      scope: { kind: 'note', id: formatNoteScopeId(noteKind, noteId) },
    });
  }
  return stories;
}

function searchStories(part: OoxmlPart, sources?: DocumentSearchSources): SearchStory[] {
  const stories = bodyStories(part);
  if (sources) {
    const seen = new Set<OoxmlPart>();
    for (const story of furnitureStories(sources.headerFooterBySection, seen)) stories.push(story);
    for (const story of noteStories(
      sources.footnotes,
      'footnote',
      sources.referencedNoteIds.footnote
    )) {
      stories.push(story);
    }
    for (const story of noteStories(
      sources.endnotes,
      'endnote',
      sources.referencedNoteIds.endnote
    )) {
      stories.push(story);
    }
  }
  return expandSelectableTextboxStories(stories);
}

/** The run a paragraph offset falls in, and the offset inside it. */
function runAddressAt(
  starts: readonly RunStart[],
  offset: number
): { index: number; offset: number } {
  if (starts.length === 0) return { index: 0, offset };
  for (let index = starts.length - 1; index >= 0; index -= 1) {
    const start = starts[index]!.start;
    if (offset >= start) return { index, offset: offset - start };
  }
  return { index: 0, offset };
}

function resultRunAddressAt(
  starts: readonly RunStart[],
  runId: string,
  offset: number
): { index: number; offset: number } | null {
  const index = starts.findIndex((run) => run.id === runId);
  return index < 0 ? null : { index, offset };
}

/**
 * Each paragraph's searchable text, keyed by the paragraph node. Nodes are frozen and an edit
 * replaces only the nodes it changes, so a paragraph the edit did not touch keeps its entry
 * across revisions, and no revision retains a text of its own: an entry lives exactly as long
 * as its node. The text depends on the node and on the field-results mode of the call, and
 * the memo keeps one entry per mode. Building this text was nearly all of a search's cost: a
 * caller asking many queries of one revision paid the whole document again for each.
 */
const searchableText = new FieldResultsModeMemo<OoxmlParagraphNode, ProjectedParagraphText>();

/** `paragraph`'s text as a search reads it, built once per node and field-results mode. */
function searchableTextOf(paragraph: OoxmlParagraphNode): ProjectedParagraphText {
  let projected = searchableText.get(paragraph);
  if (!projected) {
    projected = projectVisibleParagraphText(paragraph, paragraphModelTextOf(paragraph));
    searchableText.set(paragraph, projected);
  }
  return projected;
}

/**
 * The searchable text already built for `paragraph` in the current field-results mode, or
 * undefined. A read only: the tests observe with it that an edit keeps the entries of the
 * paragraphs it did not touch. @internal
 */
export function searchableTextEntry(
  paragraph: OoxmlParagraphNode
): ProjectedParagraphText | undefined {
  return searchableText.get(paragraph);
}

/**
 * How a model range still holds an expected text: `equal` when its model text or its shown
 * text is exactly `expected`, `partial` when it is a field result that still shows `expected`
 * as the very occurrence a search reported, and `differs` otherwise.
 */
export type RangeTextHold = 'equal' | 'partial' | 'differs';

/**
 * Whether the model range `[start, end)` of `paragraph` still holds `expected`.
 *
 * A search match inside a field result covers the whole field in model offsets while its text
 * is only the part that matched. Such a range holds its text only as that same occurrence: the
 * search runs again for `expected`, and an occurrence must sit at the same model range and show
 * the same `context` the match reported. Without context, a partial range never holds: another
 * field can take the same offsets and show the same words.
 */
export function rangeHoldsText(
  paragraph: OoxmlParagraphNode,
  start: number,
  end: number,
  expected: string,
  context?: { readonly before?: string; readonly after?: string }
): RangeTextHold {
  const model = paragraphModelTextOf(paragraph);
  if (start < 0 || end < start || end > model.length) return 'differs';
  if (model.slice(start, end) === expected) return 'equal';
  const projected = searchableTextOf(paragraph);
  const from = projected.projectedOffset(start);
  const to = projected.projectedOffset(end);
  const raw = projected.displaySlice(from, to);
  const shown = bounded(raw, raw.length);
  if (shown === expected || shown.slice(0, SEARCH_QUERY_MAX) === expected) return 'equal';
  if (
    expected.length === 0 ||
    to - from === end - start ||
    (context?.before === undefined && context?.after === undefined)
  ) {
    return 'differs';
  }
  const found = projected.findOccurrences(expected, SEARCH_MATCH_LIMIT, { matchCase: true });
  for (const occurrence of found.matches) {
    if (occurrence.rawStart !== start || occurrence.rawEnd !== end) continue;
    const at = occurrence.start;
    const past = at + occurrence.length;
    if (bounded(projected.displaySlice(at, past), SEARCH_QUERY_MAX) !== expected) continue;
    const before = bounded(
      projected.displaySlice(Math.max(0, at - CONTEXT_RADIUS), at),
      CONTEXT_RADIUS
    );
    if (context.before !== undefined && before !== context.before) continue;
    const after = bounded(projected.displaySlice(past, past + CONTEXT_RADIUS), CONTEXT_RADIUS);
    if (context.after !== undefined && after !== context.after) continue;
    return 'partial';
  }
  return 'differs';
}

/** Bound and flatten one file-derived string on its way out of this module. */
function bounded(raw: string, max: number): string {
  return withDisplayedHyphens(raw).replace(CONTROL_CHARS_ALL, ' ').slice(0, max);
}

/** Most queries one multi-term search accepts. Queries are host input, so they are bounded. */
export const SEARCH_QUERY_COUNT_MAX = 1000;

/**
 * Every occurrence of `query` across stories, in navigation order.
 *
 * Matches are NON-OVERLAPPING, which is what a find dialog counts: searching `aa` in
 * `aaaa` finds two, not three. An empty or over-long query finds nothing rather than
 * everything — "find nothing typed" is not a document-wide selection.
 */
export function collectTextMatches(
  part: OoxmlPart,
  query: string,
  options: DocumentSearchOptions = {},
  sources?: DocumentSearchSources
): DocumentSearchResult {
  return collectTextMatchesForQueries(part, [query], options, sources)[0]!;
}

/**
 * Every occurrence of each query, in one walk. Each paragraph is projected once and scanned
 * for every query, so a glossary of many terms costs one pass over the document, not one per
 * term. Each query has its own match budget and `truncated` flag.
 */
export function collectTextMatchesForQueries(
  part: OoxmlPart,
  queries: readonly string[],
  options: DocumentSearchOptions = {},
  sources?: DocumentSearchSources
): DocumentSearchResult[] {
  const limit =
    options.limit !== undefined && Number.isInteger(options.limit) && options.limit > 0
      ? Math.min(options.limit, SEARCH_MATCH_LIMIT)
      : SEARCH_MATCH_LIMIT;
  const scan = {
    ...(options.matchCase === undefined ? {} : { matchCase: options.matchCase }),
    ...(options.wholeWord === undefined ? {} : { wholeWord: options.wholeWord }),
  };
  const bounded_ = queries.slice(0, SEARCH_QUERY_COUNT_MAX);
  const results = bounded_.map(() => ({ matches: [] as DocumentSearchMatch[], truncated: false }));
  // Queries still scanning. An empty or over-long query finds nothing.
  let open = bounded_.map((query, index) => (isSearchableQuery(query) ? index : -1));
  open = open.filter((index) => index >= 0);
  if (open.length === 0) return results;

  const searchableSources = options.stories === 'body' ? undefined : sources;
  beginStoryParagraphSearch();
  for (const story of searchStories(part, searchableSources)) {
    let paragraphIndex = 0;
    for (const paragraph of searchStoryParagraphs(story.root)) {
      if (paragraph.kind !== 'paragraph') continue;
      const index = paragraphIndex;
      paragraphIndex += 1;
      const projected = searchableTextOf(paragraph);
      if (projected.text.length === 0) continue;
      // Run starts are derived once per paragraph that has a hit, not per occurrence.
      let starts: RunStart[] | null = null;
      let closed = false;
      for (const queryIndex of open) {
        const result = results[queryIndex]!;
        // One budget per query, not per paragraph or story.
        const remaining = limit - result.matches.length;
        // Once full, scan for one more occurrence to tell an exact total from truncation.
        const found = projected.findOccurrences(
          bounded_[queryIndex]!,
          Math.max(remaining, 1),
          scan
        );
        if (remaining === 0 && found.matches.length > 0) {
          result.truncated = true;
          closed = true;
          continue;
        }
        for (const occurrence of found.matches) {
          const projectedEnd = occurrence.start + occurrence.length;
          starts ??= runStarts(paragraph);
          // Simple-field expansions retain their visible result-run boundaries. Complex-field
          // results remain one editable atom, so their address names the field's begin run.
          const resultRun = projected.resultRunAddressAt(occurrence.start);
          const address = resultRun
            ? (resultRunAddressAt(starts, resultRun.runId, resultRun.offset) ??
              runAddressAt(starts, occurrence.rawStart))
            : runAddressAt(starts, occurrence.rawStart);
          result.matches.push({
            blockId: paragraph.id,
            start: occurrence.rawStart,
            length: occurrence.rawEnd - occurrence.rawStart,
            paragraphIndex: index,
            runIndex: address.index,
            runOffset: address.offset,
            ...(story.scope ? { scope: story.scope } : {}),
            text: bounded(projected.displaySlice(occurrence.start, projectedEnd), SEARCH_QUERY_MAX),
            contextBefore: bounded(
              projected.displaySlice(
                Math.max(0, occurrence.start - CONTEXT_RADIUS),
                occurrence.start
              ),
              CONTEXT_RADIUS
            ),
            contextAfter: bounded(
              projected.displaySlice(projectedEnd, projectedEnd + CONTEXT_RADIUS),
              CONTEXT_RADIUS
            ),
          });
        }
        if (found.truncated) {
          result.truncated = true;
          closed = true;
        }
      }
      if (closed) open = open.filter((queryIndex) => !results[queryIndex]!.truncated);
      if (open.length === 0) return results;
    }
  }
  return results;
}
