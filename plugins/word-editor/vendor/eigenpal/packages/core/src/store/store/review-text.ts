import {
  inlineCharacterTextOf,
  isSymbolElement,
  withDisplayedHyphens,
} from '../package/hyphen-text.ts';
import { symbolDisplayText } from '../package/symbol-glyph.ts';
import type { OoxmlNode } from '../package/ooxml-tree.ts';
import { hardBreakText } from '../package/hard-break.ts';
import { fldCharType, fldSimpleInstr, isFldSimple, isInstrText } from '../package/field-nodes.ts';
import type { CommentRecord } from './comment-reads.ts';

/**
 * Plain text of a comment's body, as a card shows it: a non-breaking hyphen is U+2011, an
 * optional hyphen shows nothing, and a symbol shows its glyph. A card never re-implements the
 * run walk.
 */
export function commentBodyText(comment: CommentRecord): string {
  return withDisplayedHyphens(commentBodyTextOf(comment, true));
}

/** A comment body in paragraph-text characters, as automation reads it (U+001E, U+001F, "("). */
export function commentBodyModelText(comment: CommentRecord): string {
  return commentBodyTextOf(comment, false);
}

/**
 * Text per comment block, per reading. Comment blocks are immutable nodes of the comments part,
 * so a rail that lists every comment on each update reads each block once.
 */
const blockTexts = {
  display: new WeakMap<OoxmlNode, string>(),
  model: new WeakMap<OoxmlNode, string>(),
};

function commentBodyTextOf(comment: CommentRecord, display: boolean): string {
  const memo = display ? blockTexts.display : blockTexts.model;
  let text = '';
  let first = true;
  for (const block of comment.blocks) {
    let own = memo.get(block);
    if (own === undefined) {
      own = blockTextOf(block, display);
      memo.set(block, own);
    }
    if (!first) text += '\n';
    first = false;
    text += own;
  }
  return text;
}

function blockTextOf(block: OoxmlNode, display: boolean): string {
  const parts: string[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') {
      parts.push(node.value);
      return;
    }
    if (node.kind === 'tab') {
      parts.push('\t');
      return;
    }
    if (node.kind === 'hardBreak') {
      parts.push(hardBreakText(node));
      return;
    }
    if (display && isSymbolElement(node)) {
      parts.push(symbolDisplayText(node));
      return;
    }
    // One character each, as in paragraph text; a card maps them for display.
    const hyphen = inlineCharacterTextOf(node);
    if (hyphen !== null) {
      parts.push(hyphen);
      return;
    }
    for (const child of node.children) visit(child);
  };
  visit(block);
  return parts.join('');
}

/** The most initials an avatar or marker shows. `@w:initials` comes from the file, unbounded. */
const MAX_INITIALS = 3;

/**
 * Author initials for an avatar, from `@w:initials` or the name, at most three characters.
 * Characters are code points, so a surrogate pair is never split.
 */
export function commentInitials(comment: CommentRecord): string {
  const declared = comment.initials?.trim();
  if (declared) return Array.from(declared).slice(0, MAX_INITIALS).join('');
  const words = comment.author.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return words
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('');
}

/** Text under a node, counting `w:t` and `w:delText` alike. */
export function textUnder(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.value;
  // A tab or a break carries no text value, so a card derived from a tracked one read as
  // EMPTY — the reviewer was asked to accept content they were never shown, and a tab
  // replacing a word presented as a pure deletion. Project the same characters the offset
  // model counts for them.
  if (node.kind === 'tab') return '\t';
  if (node.kind === 'hardBreak') return hardBreakText(node);
  // A card shows a symbol's glyph, not the "(" its model text reads as.
  if (isSymbolElement(node)) return symbolDisplayText(node);
  const hyphen = inlineCharacterTextOf(node);
  if (hyphen !== null) return hyphen;
  // A field's instruction is CODE, not content: it measures nothing in the offset model,
  // and a tracked page field would otherwise present its ` PAGE ` source as inserted
  // words. `isInstrText` covers all three spellings — the typed kind, the parse-demoted
  // generic, and `w:delInstrText`, which a struck field's card would otherwise read out.
  if (isInstrText(node)) return '';
  let text = '';
  for (const child of node.children) text += textUnder(child);
  return text;
}

/** Nested fields a card walk tracks; a deeper one reads as its result only. */
const MAX_CARD_FIELD_DEPTH = 64;

/** `{PAGE}` for ` PAGE \* MERGEFORMAT `: the field name, as a card can show it. */
function fieldNameText(instruction: string): string {
  const name = /^\s*([A-Za-z][A-Za-z0-9]{0,31})/.exec(instruction)?.[1];
  return name === undefined ? '' : `{${name.toUpperCase()}}`;
}

function valueTextOf(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.value;
  let text = '';
  for (const child of node.children) text += valueTextOf(child);
  return text;
}

/**
 * The text a revision card shows: `textUnder`, except that a field with no saved result reads
 * as its field name (`{PAGE}`). Such a field shows a value computed at layout, so a deleted
 * PAGE or TITLE field otherwise made a card with no text at all.
 */
export function reviewCardText(nodes: readonly OoxmlNode[]): string {
  const fields: { instruction: string; result: string; separated: boolean }[] = [];
  let skipped = 0;
  let out = '';
  const emit = (text: string): void => {
    const field = fields[fields.length - 1];
    if (field === undefined) out += text;
    else if (field.separated) field.result += text;
  };
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return emit(node.value);
    const type = fldCharType(node);
    const field = fields[fields.length - 1];
    if (type === 'begin') {
      if (fields.length < MAX_CARD_FIELD_DEPTH) {
        fields.push({ instruction: '', result: '', separated: false });
      } else skipped += 1;
      return;
    }
    if (type === 'separate') {
      if (field && skipped === 0) field.separated = true;
      return;
    }
    if (type === 'end') {
      if (skipped > 0) skipped -= 1;
      else {
        const closed = fields.pop();
        if (closed) emit(closed.result || fieldNameText(closed.instruction));
      }
      return;
    }
    if (isInstrText(node)) {
      if (field && !field.separated && skipped === 0) field.instruction += valueTextOf(node);
      return;
    }
    if (isFldSimple(node)) {
      return emit(reviewCardText(node.children) || fieldNameText(fldSimpleInstr(node) ?? ''));
    }
    if (
      node.kind === 'tab' ||
      node.kind === 'hardBreak' ||
      isSymbolElement(node) ||
      inlineCharacterTextOf(node) !== null
    ) {
      return emit(textUnder(node));
    }
    for (const child of node.children) visit(child);
  };
  for (const node of nodes) visit(node);
  // A field the revision covers only the start of shows the result it holds.
  while (fields.length > 0) emit(fields.pop()!.result);
  return out;
}
