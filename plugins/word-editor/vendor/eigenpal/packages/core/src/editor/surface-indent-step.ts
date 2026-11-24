// Indent steps: Increase/Decrease Indent and Tab over a selection (paginated-surface seam).
//
// Outside a list, Tab normally types a tab character, and a typed character replaces the
// selection. A selection over paragraphs, or from a paragraph start, is different: Tab
// indents and keeps the text, and Shift+Tab reverses it. Without that rule, selecting a
// paragraph and pressing Tab deleted it.

import { readTwipsMeasure, type OoxmlPart } from '@docx-editor.dev/core/store';
import type { SemanticLayout, SemanticPosition } from '@docx-editor.dev/core/layout';
import { lineSegmentFor, logicalLineSegments } from '../layout/line-segments.ts';
import { paragraphLinesIndex } from '../layout/paragraph-lines.ts';
import { MAX_PARAGRAPH_INDENT_TWIPS } from '../layout/paragraph-indent.ts';
import { findNode } from '../store/package/ooxml-edit.ts';
import {
  directParagraphProperties,
  paragraphIndentOf,
  signedFirstLine,
} from './surface-formatting.ts';
import { firstEditableNoteOffset } from './surface-note-ops.ts';
import { placeholderSelectionRange } from './surface-atomic-controls.ts';

/** Word's Increase/Decrease Indent step: one default tab stop. */
export const INDENT_STEP_TWIPS = 720;

/**
 * One indent step from `current`, never past the margin or the layout's indent bound. An
 * increase never moves the other way: an authored value past the bound stays put rather
 * than jumping back to the bound. A decrease stops at the margin, as it always has.
 */
export function nextLeftIndent(current: number, step: number, size = INDENT_STEP_TWIPS): number {
  return boundedIndent(current, step, current + step * size);
}

/**
 * The next stop on a tab grid of `size` from `current`, in the direction of `step`, with the
 * same bounds as {@link nextLeftIndent}. An indent off the grid moves to the nearest grid
 * stop, so Shift+Tab never leaves a sliver of indent behind.
 */
export function nextGridIndent(current: number, step: number, size: number): number {
  const stops = step > 0 ? Math.floor(current / size) + 1 : Math.ceil(current / size) - 1;
  return boundedIndent(current, step, stops * size);
}

function boundedIndent(current: number, step: number, next: number): number {
  return step > 0
    ? Math.max(current, Math.min(MAX_PARAGRAPH_INDENT_TWIPS, next))
    : Math.max(0, next);
}

/**
 * `w:ind/@left` in twips, zero when nothing states it.
 *
 * Resolved across the whole list rather than picked out of it: this reads a CASCADE, whose
 * entries run lowest precedence first, so taking the first `w:ind` answered the style's
 * indent for a paragraph that had already been indented past it — and Increase Indent then
 * rewrote the same one step forever.
 *
 * Resolved PER LEVEL, not per attribute, which is where `cascadedParagraphAttributes` is
 * the wrong tool: `w:left` and `w:start` are two SPELLINGS OF ONE SETTING (transitional and
 * ISO Strict), so flattening both into one bag and preferring `left` answers whichever
 * level happened to use that word. A paragraph spelling it `w:start` over a style spelling
 * it `w:left` then stepped BACKWARDS on Increase Indent. This is the rule `paragraphIndent`
 * already applies, and the two must agree or the ruler and the button disagree.
 */
export function leftIndentTwipsOf(
  properties: readonly { localName: string; attributes?: Readonly<Record<string, string>> }[]
): number {
  let raw: string | undefined;
  for (const property of properties) {
    if (property.localName !== 'ind') continue;
    const stated = property.attributes?.left ?? property.attributes?.start;
    if (stated !== undefined) raw = stated;
  }
  const twips = readTwipsMeasure(raw);
  return twips === null || Math.abs(twips) > 9_999_999 ? 0 : twips;
}

/** The indent Tab or Shift+Tab writes over a selection, and the paragraphs it covers. */
export interface TabIndent {
  readonly write: 'stepLeft' | 'setFirstLine' | 'clearFirstLine';
  readonly paragraphs: readonly string[];
}

/**
 * Where a paragraph starts, for Tab. `empty` paints nothing. `midLine` opens on a line that
 * another paragraph's text starts (after a style separator, or a deleted paragraph mark in a
 * resolved view), so no offset in it is a paragraph start. Otherwise `offset` is the first
 * offset the paragraph paints: hidden leading content, a field instruction, or a note
 * reference mark is not a start.
 */
export type ParagraphStart =
  | { readonly kind: 'start'; readonly offset: number }
  | { readonly kind: 'empty' }
  | { readonly kind: 'midLine' };

/** What {@link tabIndentFor} reads about one paragraph. */
export interface TabIndentReads {
  start(paragraphId: string): ParagraphStart;
  /** Whether the paragraph is the last one in its story. */
  endsStory(paragraphId: string): boolean;
  /**
   * The first-line indent: `resolved` is the effective signed value in twips, negative when
   * hanging; `direct` is whether the paragraph states one itself.
   */
  firstLine(paragraphId: string): { readonly resolved: number; readonly direct: boolean };
}

/** Whether `offset` is at or before where the paragraph starts. */
function atStart(start: ParagraphStart, offset: number): boolean {
  if (start.kind === 'midLine') return false;
  return start.kind === 'empty' || offset <= start.offset;
}

/**
 * What Tab (`increase`) or Shift+Tab (`decrease`) does over a selection outside a list, or
 * `null` when the keymap keeps its plain behavior: Tab types a tab character, Shift+Tab
 * steps the left indent of every touched paragraph.
 *
 * - A selection over two or more paragraphs steps the left indent of all of them.
 * - A selection in one paragraph that starts at the paragraph start, whole or partial,
 *   works on the first line. Tab sets a first-line indent of one `step`, the document's
 *   default tab stop. When the first line already has one step or more, or a hanging
 *   indent, Tab steps the left indent instead. Shift+Tab clears a first-line indent the
 *   paragraph states itself, and otherwise steps the left indent back.
 * - A caret, or a selection in one paragraph that starts inside the text, answers `null`.
 *
 * `touched` is every paragraph from the range start to the range end, in order. A range
 * that ends at the start of a later paragraph selects only the mark before it, so that
 * paragraph does not count, unless it is the empty last paragraph of the story (Select
 * All). The other paragraph commands keep that paragraph, as they always have.
 */
export function tabIndentFor(
  range: { readonly from: SemanticPosition; readonly to: SemanticPosition },
  touched: readonly string[],
  reads: TabIndentReads,
  direction: 'increase' | 'decrease',
  step: number
): TabIndent | null {
  const { from, to } = range;
  if (from.paragraphId === to.paragraphId && from.offset === to.offset) return null;
  const last = touched.length > 1 ? reads.start(to.paragraphId) : null;
  const markOnly =
    last !== null &&
    atStart(last, to.offset) &&
    !(last.kind === 'empty' && reads.endsStory(to.paragraphId));
  const paragraphs = markOnly ? touched.slice(0, -1) : touched;
  if (paragraphs.length > 1) return { write: 'stepLeft', paragraphs };
  if (!atStart(reads.start(from.paragraphId), from.offset)) return null;
  const { resolved, direct } = reads.firstLine(from.paragraphId);
  if (direction === 'increase') {
    const opensFirstLine = resolved >= 0 && resolved < step;
    return { write: opensFirstLine ? 'setFirstLine' : 'stepLeft', paragraphs };
  }
  return { write: direct && resolved > 0 ? 'clearFirstLine' : 'stepLeft', paragraphs };
}

/** {@link ParagraphStart} from the published layout alone. */
export function paintedStart(layout: SemanticLayout, paragraphId: string): ParagraphStart {
  let first = Number.POSITIVE_INFINITY;
  let checkedFirstLine = false;
  for (const { line } of paragraphLinesIndex(layout).get(paragraphId) ?? []) {
    if (!checkedFirstLine) {
      checkedFirstLine = true;
      // Logical order: a right-to-left line draws its first paragraph on the right.
      if (logicalLineSegments(line)[0]?.paragraphId !== paragraphId) return { kind: 'midLine' };
    }
    const segment = lineSegmentFor(line, paragraphId);
    if (!segment) continue;
    for (const span of segment.spans) {
      if (span.range.end > span.range.start) first = Math.min(first, span.range.start);
    }
    for (const drawing of segment.drawings) first = Math.min(first, drawing.start);
    // Later lines hold later offsets; the first line that paints anything decides.
    if (Number.isFinite(first)) break;
  }
  return Number.isFinite(first) ? { kind: 'start', offset: first } : { kind: 'empty' };
}

/** The `w:ind` attributes that state a first-line or hanging indent. */
const FIRST_LINE_ATTRIBUTES = ['firstLine', 'hanging', 'firstLineChars', 'hangingChars'];

/**
 * {@link TabIndentReads} over a published layout and the story part that holds the
 * paragraphs. Starts are cached, since one key press asks about a paragraph more than once.
 */
export function layoutTabIndentReads(
  layout: SemanticLayout,
  part: OoxmlPart,
  order: readonly string[]
): TabIndentReads {
  const starts = new Map<string, ParagraphStart>();
  return {
    start(paragraphId) {
      const cached = starts.get(paragraphId);
      if (cached) return cached;
      let start = paintedStart(layout, paragraphId);
      if (start.kind === 'start') {
        // A note paragraph starts after its reference mark, which is not note text.
        const node = findNode(part, paragraphId);
        const note = node?.kind === 'paragraph' ? firstEditableNoteOffset(node) : 0;
        if (note > start.offset) start = { kind: 'start', offset: note };
      }
      starts.set(paragraphId, start);
      return start;
    },
    endsStory: (paragraphId) => order[order.length - 1] === paragraphId,
    firstLine(paragraphId) {
      const entry = paragraphIndentOf(layout, paragraphId);
      const ind = directParagraphProperties(part, paragraphId).find(
        (property) => property.localName === 'ind'
      )?.attributes;
      const direct = FIRST_LINE_ATTRIBUTES.some((name) => ind?.[name] !== undefined);
      return { resolved: entry ? signedFirstLine(entry.indent) : 0, direct };
    },
  };
}

/**
 * Whether a range is exactly one placeholder content control. Clicking into a control that
 * shows its placeholder selects the placeholder, but the user sees a caret in an empty
 * field, so Tab types there like a caret does.
 */
export function selectsOnlyPlaceholder(
  layout: SemanticLayout,
  range: { readonly from: SemanticPosition; readonly to: SemanticPosition }
): boolean {
  const same = (a: SemanticPosition, b: SemanticPosition) =>
    a.paragraphId === b.paragraphId && a.offset === b.offset;
  return (layout.contentControls ?? []).some((control) => {
    if (!control.placeholder) return false;
    const placeholder = placeholderSelectionRange(layout, control);
    return (
      placeholder !== null && same(placeholder.from, range.from) && same(placeholder.to, range.to)
    );
  });
}
