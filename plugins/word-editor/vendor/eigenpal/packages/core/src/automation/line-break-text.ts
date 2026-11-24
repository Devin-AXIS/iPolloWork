// A manual line break inside written text. `\v` is the character Office text uses for one.
import type { PlannedOperation } from './plan-types.ts';
import type { AutomationStoryReads } from './reads.ts';
import { withBreakReadText } from '../store/store/paragraph-model-text.ts';
import { findNode } from '../store/package/ooxml-edit.ts';
import type { OoxmlNode, OoxmlPart } from '../store/package/ooxml-tree.ts';
import {
  LINE_BREAK_TEXT,
  propertiesHoldLineBreaks,
} from '../store/store/tree-op-inline-elements.ts';
import { isParagraph } from '../store/store/tree-op-segments.ts';
import { contentControlAtCaret } from '../store/store/tree-op-validate.ts';
import { contentControlPropertiesOf } from '../store/package/content-control-nodes.ts';
import type { TreeDocOp } from '../store/store/tree-ops.ts';

/** The written form of a manual line break (`w:br`). Text reads answer it the same way. */
export const LINE_BREAK_CHAR = LINE_BREAK_TEXT;

/** Paragraph-breaking characters a text write refuses. A manual line break is not one. */
export const PARAGRAPH_MARK_IN_TEXT = /[\r\n\f\u2028\u2029]/;

/** One plain text insertion at an offset; empty text writes nothing. */
export function insertTextOps(paragraphId: string, offset: number, text: string): TreeDocOp[] {
  return text.length ? [{ op: 'insertText', paragraphId, offset, text }] : [];
}

/** Text as the model reads it back after an insertion wrote it. */
export function modelTextOf(text: string): string {
  return text.replaceAll(LINE_BREAK_CHAR, '\n');
}

const SINGLE_LINE_REFUSAL: PlannedOperation = {
  ok: false,
  error: {
    code: 'unsupported-content',
    message: 'a single-line control cannot hold a line break',
    detail: 'line-break-in-single-line-control',
  },
};

/** {@link lineBreakRefusal} for a write that names its control. */
export function controlLineBreakRefusal(control: OoxmlNode, text: string): PlannedOperation | null {
  return text.includes(LINE_BREAK_CHAR) &&
    !propertiesHoldLineBreaks(contentControlPropertiesOf(control))
    ? SINGLE_LINE_REFUSAL
    : null;
}

/**
 * A line break refused where it lands: inside a control that holds one line.
 *
 * `w:text` without `w:multiLine`, a list, and a date are single-line fields, so a break written
 * into one would give the control a value its own definition says it cannot hold.
 */
export function lineBreakRefusal(
  part: OoxmlPart,
  paragraphId: string,
  start: number,
  end: number,
  text: string = LINE_BREAK_CHAR
): PlannedOperation | null {
  if (!text.includes(LINE_BREAK_CHAR)) return null;
  const paragraph = findNode(part, paragraphId);
  if (!isParagraph(paragraph)) return null;
  const control = contentControlAtCaret(part, paragraph, start, end);
  return control ? controlLineBreakRefusal(control, text) : null;
}

/** A query or delimiter that spells a line break `\n`, as model text does, spelled as reads do. */
export function searchableLineBreaks(text: string): string {
  return text.replaceAll('\n', LINE_BREAK_CHAR);
}

/** A paragraph's model text with its breaks spelled as a text read spells them. */
export function readTextOf(reads: AutomationStoryReads, paragraphId: string): string {
  const raw = reads.rawText(paragraphId) ?? '';
  const node = reads.node(paragraphId);
  return node?.kind === 'paragraph' ? withBreakReadText(node, raw) : raw;
}
