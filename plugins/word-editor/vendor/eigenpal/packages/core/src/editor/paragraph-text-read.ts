import {
  buildStyleCascadeTable,
  createRunProofingReader,
  eastAsianTextRanges,
  readTableStructure,
  type RunProofing,
  type StyleCascadeTable,
  type TableCellStyleFormatting,
} from '@docx-editor.dev/core/layout';
import { findNode, paragraphOffsetIndex, type OoxmlElement } from '@docx-editor.dev/core/store';
import { allParagraphs } from '../binding/tree-binding.ts';
import type {
  EditorParagraphText,
  ParagraphText,
  ParagraphTextProofing,
  ParagraphTextReadOptions,
  ParagraphTextSpan,
} from '../contracts/editor-paragraph-text.ts';
import { atomicFieldSpansOf } from '../store/package/field-nodes.ts';
import { withFieldResultsMode, type FieldResultsMode } from '../store/package/field-result-mode.ts';
import { fieldResultTextsOf } from '../store/package/field-result-text.ts';
import {
  hyphenTextOf,
  isSymbolElement,
  NON_BREAKING_HYPHEN_TEXT,
  OPTIONAL_HYPHEN_TEXT,
} from '../store/package/hyphen-text.ts';
import type { OoxmlNode, OoxmlParagraphNode, OoxmlPart } from '../store/package/ooxml-tree.ts';
import {
  blockStoryContainerChildren,
  MAX_STORY_SDT_NESTING,
  storyParagraphs,
  storyRootsOf,
} from '../store/package/story-blocks.ts';
import { textboxStoriesInPart } from '../store/package/textbox-stories.ts';
import { paragraphModelTextOf } from '../store/store/paragraph-model-text.ts';
import { createRecentRootCache } from '../store/store/recent-root-cache.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { partOfNodeId } from './surface-scope.ts';

type RunProofingReader = (
  paragraph: OoxmlParagraphNode,
  run: OoxmlNode,
  cellStyle?: TableCellStyleFormatting
) => RunProofing;
type FieldsOption = NonNullable<ParagraphTextReadOptions['fields']>;

/** A stretch of model text with one set of proofing settings. */
interface ProofedRange {
  readonly start: number;
  readonly end: number;
  readonly lang: string | null;
  readonly eastAsiaLang: string | null;
  readonly noProof: boolean;
}

/**
 * A piece of accepted text: a span that maps to `text`, or a field result read with
 * `fields: 'result'`, which has no `text` offsets of its own and sits at the field's atom.
 */
type AcceptedPiece =
  | { readonly mapped: true; readonly span: ParagraphTextSpan }
  | {
      readonly mapped: false;
      readonly acceptedStart: number;
      readonly length: number;
      readonly at: number;
    };

/** One stretch of accepted text before merging: its settings for both script classes. */
interface Stretch {
  readonly from: number;
  readonly to: number;
  readonly range: ProofedRange | undefined;
}

/** The range that covers `at`, from `ranges` sorted by start, or undefined. */
function rangeAt(ranges: readonly ProofedRange[], at: number): ProofedRange | undefined {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const range = ranges[middle]!;
    if (range.end <= at) low = middle + 1;
    else if (range.start > at) high = middle - 1;
    else return range;
  }
  return undefined;
}

/**
 * `ranges` in accepted-text offsets: stretches that share settings merge, and gaps get none.
 * East Asian characters take their run's `w:eastAsia` tag.
 */
function acceptedProofing(
  ranges: readonly ProofedRange[],
  pieces: readonly AcceptedPiece[],
  acceptedText: string
): readonly ParagraphTextProofing[] {
  const stretches: Stretch[] = [];
  for (const piece of pieces) {
    if (!piece.mapped) {
      // A field result takes the settings of the run that holds its field.
      const range = rangeAt(ranges, piece.at);
      stretches.push({ from: piece.acceptedStart, to: piece.acceptedStart + piece.length, range });
      continue;
    }
    const { span } = piece;
    for (let at = span.start; at < span.start + span.length;) {
      const range = rangeAt(ranges, at);
      const next = range ? undefined : ranges.find((candidate) => candidate.start > at);
      // Text outside every run, such as a simple field, takes no language and is checked.
      const end = Math.min(span.start + span.length, range ? range.end : (next?.start ?? Infinity));
      const from = at - span.start + span.acceptedStart;
      stretches.push({ from, to: from + end - at, range });
      at = end;
    }
  }
  const result: ParagraphTextProofing[] = [];
  const push = (acceptedStart: number, length: number, lang: string | null, noProof: boolean) => {
    if (length <= 0) return;
    const last = result.at(-1);
    if (last && last.lang === lang && last.noProof === noProof) {
      result[result.length - 1] = { ...last, length: last.length + length };
    } else result.push({ acceptedStart, length, lang, noProof });
  };
  const eastAsian = /[^\u0000-\u007f]/.test(acceptedText) ? eastAsianTextRanges(acceptedText) : [];
  let cursor = 0;
  for (const stretch of stretches) {
    const lang = stretch.range?.lang ?? null;
    const eastAsiaLang = stretch.range?.eastAsiaLang ?? null;
    const noProof = stretch.range?.noProof ?? false;
    let at = stretch.from;
    while (cursor < eastAsian.length && eastAsian[cursor]!.to <= at) cursor += 1;
    for (let index = cursor; index < eastAsian.length && at < stretch.to; index += 1) {
      const range = eastAsian[index]!;
      if (range.from >= stretch.to) break;
      const from = Math.max(at, range.from);
      push(at, from - at, lang, noProof);
      const to = Math.min(stretch.to, range.to);
      push(from, to - from, eastAsiaLang, noProof);
      at = to;
    }
    push(at, stretch.to - at, lang, noProof);
  }
  if (result.length === 0 && acceptedText.length > 0) push(0, acceptedText.length, null, false);
  return Object.freeze(result.map((entry) => Object.freeze(entry)));
}

/** Saved field results by the offset of their atom in model text, read with every change accepted. */
function fieldResultsAt(paragraph: OoxmlParagraphNode): ReadonlyMap<number, string> {
  const spans = atomicFieldSpansOf(paragraph);
  if (spans.length === 0) return new Map();
  const results = fieldResultTextsOf(paragraph, spans, 'current');
  const byOffset = new Map<number, string>();
  for (const segment of paragraphOffsetIndex(paragraph).segments) {
    if (!segment.removeNodeIds?.length) continue;
    const result = results.get(segment.node.id);
    if (result !== undefined) byOffset.set(segment.start, result);
  }
  return byOffset;
}

function readParagraph(
  paragraph: OoxmlParagraphNode,
  fieldResults: FieldResultsMode,
  fields: FieldsOption,
  proofingOf: RunProofingReader,
  cellStyle: TableCellStyleFormatting | undefined
): ParagraphText {
  return withFieldResultsMode(fieldResults, () => {
    const text = paragraphModelTextOf(paragraph);
    const index = paragraphOffsetIndex(paragraph);
    // Model offsets a reader does not see as text: tracked deletions, move sources, hidden
    // runs and optional hyphens. Accepted text skips them; a span ends at each one.
    const gaps: { start: number; end: number }[] = [];
    const runs: ProofedRange[] = [];
    const visit = (node: OoxmlNode): void => {
      if (node.kind === 'revisionDelete' || node.kind === 'revisionMoveFrom') {
        const span = index.spanOf(node);
        if (span && span.end > span.start) gaps.push(span);
        return;
      }
      if (node.kind === 'run') {
        const span = index.spanOf(node);
        if (span && span.end > span.start) {
          const proofing = proofingOf(paragraph, node, cellStyle);
          if (proofing.hidden) gaps.push(span);
          else
            runs.push({
              ...span,
              lang: proofing.lang,
              eastAsiaLang: proofing.eastAsiaLang,
              noProof: proofing.noProof,
            });
        }
      }
      if ('children' in node) for (const child of node.children) visit(child);
    };
    for (const child of paragraph.children) visit(child);
    // Placeholder characters read as what they show, one for one, so span lengths still
    // hold in both texts: a symbol is an object, a non-breaking hyphen is U+2011.
    const shown = new Map<number, string>();
    for (const segment of index.segments) {
      if (segment.end - segment.start !== 1) continue;
      const hyphen = hyphenTextOf(segment.node);
      if (hyphen === OPTIONAL_HYPHEN_TEXT) gaps.push(segment);
      else if (hyphen === NON_BREAKING_HYPHEN_TEXT) shown.set(segment.start, '\u2011');
      else if (isSymbolElement(segment.node)) shown.set(segment.start, '\uFFFC');
    }
    // With `fields: 'result'`, a field atom reads as its saved result, which no span maps.
    const expanded = fields === 'result' ? fieldResultsAt(paragraph) : new Map<number, string>();
    gaps.sort((a, b) => a.start - b.start);
    const acceptedSpans: ParagraphTextSpan[] = [];
    const pieces: AcceptedPiece[] = [];
    let acceptedText = '';
    let cursor = 0;
    const map = (end: number): void => {
      if (end <= cursor) return;
      const span = Object.freeze({
        start: cursor,
        length: end - cursor,
        acceptedStart: acceptedText.length,
      });
      acceptedSpans.push(span);
      pieces.push({ mapped: true, span });
      if (shown.size === 0) acceptedText += text.slice(cursor, end);
      else for (let at = cursor; at < end; at += 1) acceptedText += shown.get(at) ?? text[at];
      cursor = end;
    };
    const acceptUntil = (end: number): void => {
      if (expanded.size > 0) {
        for (let at = cursor; at < end; at += 1) {
          const result = expanded.get(at);
          if (result === undefined) continue;
          map(at);
          if (result.length > 0)
            pieces.push({
              mapped: false,
              acceptedStart: acceptedText.length,
              length: result.length,
              at,
            });
          acceptedText += result;
          cursor = at + 1;
        }
      }
      map(end);
    };
    for (const gap of gaps) {
      acceptUntil(gap.start);
      cursor = Math.max(cursor, gap.end);
    }
    acceptUntil(text.length);
    runs.sort((a, b) => a.start - b.start);
    return Object.freeze({
      blockId: paragraph.id,
      text,
      acceptedText,
      acceptedSpans: Object.freeze(acceptedSpans),
      proofing: acceptedProofing(runs, pieces, acceptedText),
    });
  });
}

/** The table style formatting of each paragraph in a table cell of `part`, as layout reads it. */
function cellStylesOf(
  part: OoxmlPart,
  styles: StyleCascadeTable | undefined
): ReadonlyMap<OoxmlNode, TableCellStyleFormatting> {
  const result = new Map<OoxmlNode, TableCellStyleFormatting>();
  if (!styles) return result;
  const walk = (
    blocks: readonly OoxmlNode[],
    cellStyle: TableCellStyleFormatting | undefined,
    depth: number,
    wrappers: number
  ): void => {
    for (const block of blocks) {
      if (block.kind === 'paragraph') {
        if (cellStyle) result.set(block, cellStyle);
        continue;
      }
      if (block.kind === 'table') {
        // The width only sizes columns; the style formatting of a cell does not depend on it.
        const structure = readTableStructure(block, 468, depth, styles);
        for (const row of structure?.rows ?? []) {
          for (const cell of row.cells)
            walk(cell.blocks, cell.styleFormatting, depth + 1, wrappers);
        }
        continue;
      }
      const nested = blockStoryContainerChildren(block);
      if (nested !== null && wrappers < MAX_STORY_SDT_NESTING)
        walk(nested, cellStyle, depth, wrappers + 1);
    }
  };
  for (const story of storyRootsOf(part)) {
    if (story.root.kind !== 'textValue') walk(story.root.children, undefined, 0, 0);
  }
  return result;
}

/** A key for the run properties a table cell style gives proofing, so equal cells share one. */
const cellKeys = new WeakMap<TableCellStyleFormatting, string>();
function cellKeyOf(cellStyle: TableCellStyleFormatting | undefined): string {
  if (!cellStyle || cellStyle.runProperties.length === 0) return '';
  let key = cellKeys.get(cellStyle);
  if (key === undefined) {
    key = JSON.stringify(
      cellStyle.runProperties.map((property) => [property.localName, property.attributes ?? {}])
    );
    cellKeys.set(cellStyle, key);
  }
  return key;
}

/** One part's reads: in list order, and by paragraph node. */
interface PartRead {
  readonly list: readonly ParagraphText[];
  readonly byNode: ReadonlyMap<OoxmlNode, ParagraphText>;
}

/** The reads for one `fields` option, so each option keeps its own object identities. */
interface OptionReads {
  readonly paragraphs: WeakMap<OoxmlParagraphNode, { key: string; value: ParagraphText }>;
  readonly parts: ReturnType<typeof createRecentRootCache<PartRead>>;
  previousParts: readonly OoxmlPart[];
  result: readonly ParagraphText[];
}

function optionReads(): OptionReads {
  return {
    paragraphs: new WeakMap(),
    parts: createRecentRootCache<PartRead>(16),
    previousParts: [],
    result: Object.freeze([]),
  };
}

function fieldsOf(options: ParagraphTextReadOptions | undefined): FieldsOption {
  const fields = options?.fields;
  if (fields === undefined || fields === 'object') return 'object';
  if (fields === 'result') return 'result';
  throw new TypeError("fields must be 'object' or 'result'");
}

export function createParagraphTextReads(deps: {
  surface(): PaginatedSurface | null;
  fieldResults: FieldResultsMode;
}): EditorParagraphText {
  // Everything read depends on the styles part, so a new styles root starts every cache again:
  // a commit can add a style definition that a paragraph already names.
  let generation:
    | {
        readonly root: OoxmlElement | null;
        readonly styles: StyleCascadeTable | undefined;
        readonly read: RunProofingReader;
        readonly options: Map<FieldsOption, OptionReads>;
      }
    | undefined;
  const current = () => {
    const session = deps.surface()?.session;
    const root = session?.stylesRoot() ?? null;
    if (!generation || generation.root !== root) {
      const styles: StyleCascadeTable | undefined = root
        ? buildStyleCascadeTable(root, session?.documentThemeFonts())
        : undefined;
      generation = { root, styles, read: createRunProofingReader(styles), options: new Map() };
    }
    return generation;
  };
  const readsFor = (fields: FieldsOption): OptionReads => {
    const { options } = current();
    let reads = options.get(fields);
    if (!reads) options.set(fields, (reads = optionReads()));
    return reads;
  };
  const readPart = (part: OoxmlPart, fields: FieldsOption): PartRead => {
    const reads = readsFor(fields);
    const cached = reads.parts.get(part);
    if (cached) return cached;
    const { styles, read: proofingOf } = current();
    const cells = cellStylesOf(part, styles);
    const read = (paragraph: OoxmlParagraphNode): ParagraphText => {
      const cellStyle = cells.get(paragraph);
      const key = cellKeyOf(cellStyle);
      const known = reads.paragraphs.get(paragraph);
      if (known && known.key === key) return known.value;
      const value = readParagraph(paragraph, deps.fieldResults, fields, proofingOf, cellStyle);
      reads.paragraphs.set(paragraph, { key, value });
      return value;
    };
    const boxes = new Map<string, OoxmlNode[]>();
    for (const box of textboxStoriesInPart(part)) {
      const nested = boxes.get(box.hostParagraphId) ?? [];
      nested.push(...storyParagraphs(box.root));
      boxes.set(box.hostParagraphId, nested);
    }
    const list: ParagraphText[] = [];
    const byNode = new Map<OoxmlNode, ParagraphText>();
    const add = (paragraph: OoxmlParagraphNode) => {
      const value = read(paragraph);
      list.push(value);
      byNode.set(paragraph, value);
    };
    for (const paragraph of allParagraphs(part)) {
      if (paragraph.kind !== 'paragraph') continue;
      add(paragraph);
      for (const nested of boxes.get(paragraph.id) ?? []) {
        if (nested.kind === 'paragraph') add(nested);
      }
    }
    const value = { list: Object.freeze(list), byNode };
    reads.parts.set(part, value);
    return value;
  };
  return {
    getParagraphText(blockId, options) {
      const fields = fieldsOf(options);
      const surface = deps.surface();
      const part = surface ? partOfNodeId(surface.session, blockId) : null;
      if (!part || !surface!.session.storyParts().includes(part)) return null;
      // Only paragraphs that getParagraphs() lists: never a fallback copy of a text box.
      const paragraph = findNode(part, blockId);
      return paragraph ? (readPart(part, fields).byNode.get(paragraph) ?? null) : null;
    },
    getParagraphs(options) {
      const fields = fieldsOf(options);
      const currentParts = deps.surface()?.session.storyParts() ?? [];
      const reads = readsFor(fields);
      if (
        currentParts.length !== reads.previousParts.length ||
        currentParts.some((part, i) => part !== reads.previousParts[i])
      ) {
        reads.result = Object.freeze(currentParts.flatMap((part) => readPart(part, fields).list));
        reads.previousParts = currentParts;
      }
      return reads.result;
    },
  };
}
