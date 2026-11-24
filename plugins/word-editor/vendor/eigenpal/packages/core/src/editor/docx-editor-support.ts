// Pure helpers behind the `createDocxEditor` facade (docx-editor.ts).
//
// Everything here is a function of its arguments — no surface, no session, no DOM.
// The facade closure stays in docx-editor.ts; this module owns command classification,
// source normalization, and the value-equality rules the cached snapshot uses to keep
// sub-object references stable across re-derivations.

import { watermarkRefusal } from './docx-editor-watermark.ts';
import type { EditorCommand, EditorError } from '@docx-editor.dev/core/contracts/editor';
import type { SemanticSelection as SurfaceSelection } from '@docx-editor.dev/core/layout';
// Direct, not through the layout barrel: this is an internal bound the write shares with
// the reader, not something the layout package publishes.
import { MAX_PARAGRAPH_INDENT_TWIPS } from '../layout/paragraph-flow.ts';
import {
  MAX_INSERT_TABLE_CELLS,
  MAX_INSERT_TABLE_COLUMNS,
  MAX_INSERT_TABLE_ROWS,
} from '../store/store/table-constraints.ts';
import { fontFamilyName } from '../store/package/font-family-name.ts';
import { isDocAnchor, isDocAnchorRange } from './anchor-resolution.ts';
import { tableCommandCanSupport } from './table-command-plan.ts';
import { replaceMatchArgumentRefusal } from './docx-editor-replace-match.ts';
import { replaceAcceptedTextArgumentRefusal } from './docx-editor-replace-accepted-text.ts';
import { navigateHighlightArgumentRefusal } from './highlight-navigation.ts';
import { replaceAllMatchesArgumentRefusal } from './docx-editor-replace-all.ts';
import { classifySelectionEdit } from './docx-editor-selection-edits.ts';

import { NOT_A_TEXT_SELECTION, textSelectionOf } from './docx-editor-text-selection.ts';
export { textSelectionOf, type TextSelectionInput } from './docx-editor-text-selection.ts';
export { normalizeSource, unloadableSourceReason } from './docx-editor-document-source.ts';

/** A mutating command, or an `invalidArgs` refusal when its arguments give a reason. */
function mutatingUnlessRefused(refusal: string | null | undefined): CommandSupport {
  return refusal
    ? { supported: false, code: 'invalidArgs', reason: refusal }
    : { supported: true, mutating: true };
}

/** Recursively freeze plain objects and arrays (idempotent). */
export function deepFreezeValue<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) deepFreezeValue(item);
    return Object.freeze(value);
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) deepFreezeValue(record[key]);
  return Object.freeze(value);
}

/**
 * Run-property spellings for the marks the surface can toggle, named as OOXML names them.
 *
 * Superscript and subscript are ONE property with two of its three values (`w:vertAlign`,
 * ST_VerticalAlignRun, 17.3.2.42), not two independent switches. Spelling them as two marks
 * over one `localName` is what makes them mutually exclusive for free — a property write
 * replaces the entry with the same name — and it is why the toggle has to compare the VALUE
 * in force rather than the mere presence of the element.
 *
 * A Map, not an object literal, because the key is CALLER input: an object answers
 * `constructor` and `toString` off the prototype chain, so `toggleMark` with either name
 * passed the support gate and reached the store, which then refused the write — `can` said
 * yes and the press did nothing. `HIGHLIGHT_NAMES` is a Set for the same reason.
 */
export const MARKS: ReadonlyMap<
  string,
  { localName: string; attributes?: Record<string, string> }
> = new Map([
  ['bold', { localName: 'b' }],
  ['italic', { localName: 'i' }],
  ['underline', { localName: 'u', attributes: { val: 'single' } }],
  ['strike', { localName: 'strike' }],
  ['superscript', { localName: 'vertAlign', attributes: { val: 'superscript' } }],
  ['subscript', { localName: 'vertAlign', attributes: { val: 'subscript' } }],
]);

export type CommandSupport =
  | { readonly supported: true; readonly mutating: boolean }
  | {
      readonly supported: false;
      readonly reason: string;
      /** Refusal code for the gate: `invalidArgs` for a malformed value on a supported
       *  command, `unsupported` (the default) for a command outside the wired subset. */
      readonly code?: 'unsupported' | 'invalidArgs';
    };

/**
 * `ST_HighlightColor` names accepted by `setMarkAttr` for the `highlight` mark — the
 * same closed enumeration the paint lane maps to swatches (semantic-paint.ts's
 * `HIGHLIGHT` map). A Set, not an object literal, because the value is caller input:
 * membership must not answer `constructor` or `__proto__` from the prototype chain.
 */
export const HIGHLIGHT_NAMES: ReadonlySet<string> = new Set([
  // `none` is part of the enumeration: Word's "No Color". The read lane reports it as
  // "no highlight" (run-style maps it to null), so writing it clears the swatch.
  'none',
  'black',
  'blue',
  'cyan',
  'darkBlue',
  'darkCyan',
  'darkGray',
  'darkGreen',
  'darkMagenta',
  'darkRed',
  'darkYellow',
  'green',
  'lightGray',
  'magenta',
  'red',
  'yellow',
  'white',
]);

const HEX_COLOR_VALUE = /^[0-9A-Fa-f]{6}$/;

export type ResolvedMarkAttr =
  | {
      readonly ok: true;
      readonly localName: string;
      readonly attributes: Record<string, string>;
    }
  | {
      readonly ok: false;
      readonly code: 'unsupported' | 'invalidArgs';
      readonly reason: string;
    };

/**
 * Resolve a `setMarkAttr` command to the run property it writes, refusing invalid
 * values with a typed reason. One resolver serves `classifyCommand` and `exec`, so the
 * dry run can never disagree with the real one about what is accepted.
 *
 * Spellings are the ones the ENGINE READS back (`resolveRunStyle`): `w:rFonts` is read
 * as `ascii ?? hAnsi`, so a family write sets both; `w:sz` is half-points; `w:color`
 * and `w:highlight` are `val`-carrying elements.
 */
export function resolveMarkAttr(command: { mark: string; value: unknown }): ResolvedMarkAttr {
  const { mark, value } = command;
  switch (mark) {
    case 'fontFamily': {
      // The same shape the font list and the CSS sink accept (semantic-paint.ts's
      // `FONT_NAME`), so every listed name is selectable and an invalid name never
      // reaches the tree. No quote, backslash, or control character; at most 64.
      if (typeof value !== 'string' || fontFamilyName(value) === null) {
        return {
          ok: false,
          code: 'invalidArgs',
          reason: 'fontFamily requires a family name of 1-64 letters, digits, or [ -.+_,;]',
        };
      }
      return { ok: true, localName: 'rFonts', attributes: { ascii: value, hAnsi: value } };
    }
    case 'fontSize': {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 2 || value > 3276) {
        return {
          ok: false,
          code: 'invalidArgs',
          reason: 'fontSize requires an integer half-point value between 2 and 3276',
        };
      }
      return { ok: true, localName: 'sz', attributes: { val: String(value) } };
    }
    case 'color': {
      // `auto` is ST_HexColor's other member — Word's "Automatic". The read lane
      // already treats it as "no colour" (run-style's hexColor), so it round-trips.
      if (typeof value !== 'string' || (value !== 'auto' && !HEX_COLOR_VALUE.test(value))) {
        return {
          ok: false,
          code: 'invalidArgs',
          reason: "color requires a six-digit hex value like FF0000, or 'auto'",
        };
      }
      return { ok: true, localName: 'color', attributes: { val: value } };
    }
    case 'highlight': {
      if (typeof value !== 'string' || !HIGHLIGHT_NAMES.has(value)) {
        return {
          ok: false,
          code: 'invalidArgs',
          reason: 'highlight requires an ST_HighlightColor name (yellow, cyan, ...)',
        };
      }
      return { ok: true, localName: 'highlight', attributes: { val: value } };
    }
    default:
      return {
        ok: false,
        code: 'unsupported',
        reason: `mark '${mark}' is not supported by setMarkAttr`,
      };
  }
}

export function editorError(code: string, message: string): EditorError {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
}

export function selectionsMatch(a: SurfaceSelection | null, b: SurfaceSelection | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.anchor.paragraphId === b.anchor.paragraphId &&
    a.anchor.offset === b.anchor.offset &&
    a.head.paragraphId === b.head.paragraphId &&
    a.head.offset === b.head.offset
  );
}

/**
 * Whether a command is in the wired subset, and whether it writes.
 *
 * One classifier serves `exec` and `can`, so a dry run can never disagree with the real
 * one about what is supported.
 */
export function classifyCommand(command: EditorCommand): CommandSupport {
  switch (command.type) {
    case 'toggleMark':
      return MARKS.has(command.mark)
        ? { supported: true, mutating: true }
        : { supported: false, reason: `mark '${command.mark}' is not supported` };
    case 'setMarkAttr': {
      const resolved = resolveMarkAttr(command);
      return resolved.ok
        ? { supported: true, mutating: true }
        : { supported: false, reason: resolved.reason, code: resolved.code };
    }
    case 'setAlignment':
      return { supported: true, mutating: true };
    case 'setParagraphDirection':
      return command.direction === 'ltr' || command.direction === 'rtl'
        ? { supported: true, mutating: true }
        : {
            supported: false,
            code: 'invalidArgs',
            reason: "setParagraphDirection requires a direction of 'ltr' or 'rtl'",
          };
    case 'clearFormatting':
      return { supported: true, mutating: true };
    // The painter's two halves gate differently, which is why they are two commands: copying
    // formatting reads and writes nothing, so a document open for viewing still allows it —
    // the same reason `selectAll` and `copy` stay live there. Applying is an edit.
    case 'copyFormatting':
      return { supported: true, mutating: false };
    case 'pasteFormatting':
      return { supported: true, mutating: true };
    case 'setLineSpacing': {
      // Bounds are `w:spacing/@w:line`'s own (ST_SignedTwipsMeasure in practice, but Word
      // rejects a non-positive line height outright). Checked here so a malformed pick is
      // refused with a typed reason rather than writing a `w:spacing` Word will not open.
      const rules = ['multiple', 'exact', 'atLeast'];
      if (!rules.includes(command.rule)) {
        return {
          supported: false,
          code: 'invalidArgs',
          reason: "setLineSpacing requires a rule of 'multiple', 'exact' or 'atLeast'",
        };
      }
      const raw = command.rule === 'multiple' ? command.value * 240 : command.value * 20;
      if (!Number.isFinite(command.value) || command.value <= 0 || Math.round(raw) > 31680) {
        return {
          supported: false,
          code: 'invalidArgs',
          reason: 'setLineSpacing requires a positive value no taller than 1584pt',
        };
      }
      return { supported: true, mutating: true };
    }
    case 'setParagraphSpacing': {
      for (const field of ['beforePt', 'afterPt'] as const) {
        const value = command[field];
        if (value === undefined || value === null) continue;
        if (!Number.isFinite(value) || value < 0 || value > 1584) {
          return {
            supported: false,
            code: 'invalidArgs',
            reason: `setParagraphSpacing requires ${field} between 0 and 1584 points`,
          };
        }
      }
      return { supported: true, mutating: true };
    }
    case 'setParagraphStyle': {
      // Shape gate only, like `insertText`: whether the styleId names a style the DOCUMENT
      // defines is checked at exec, where the styles part is in hand. The bounds mirror the
      // catalog's own (`collectDocumentStyles`), so no listed style can be refused here.
      if (command.target !== undefined) {
        return {
          supported: false,
          reason: 'DocTarget addressing is not supported; the style applies at the selection',
        };
      }
      if (
        typeof command.styleId !== 'string' ||
        command.styleId.length === 0 ||
        command.styleId.length > 128 ||
        /[\u0000-\u001f\u007f-\u009f]/.test(command.styleId)
      ) {
        return {
          supported: false,
          code: 'invalidArgs',
          reason: 'setParagraphStyle requires a styleId of 1-128 printable characters',
        };
      }
      return { supported: true, mutating: true };
    }
    case 'insertHyperlink': {
      if (command.target !== undefined) {
        return {
          supported: false,
          reason: 'DocTarget addressing is not supported; a link applies at the selection',
        };
      }
      // The `href` vocabulary is the WEB's, because that is what the contract declares and
      // what a host already has: `#name` is a bookmark in this document, anything else is
      // an external target. The allowlist is applied where the relationship is written, so
      // `can` reports only what it can check without touching the package.
      if (typeof command.href !== 'string' || command.href.length === 0) {
        return {
          supported: false,
          code: 'invalidArgs',
          reason: 'insertHyperlink requires an href',
        };
      }
      return { supported: true, mutating: true };
    }
    case 'removeHyperlink':
      return command.target === undefined
        ? { supported: true, mutating: true }
        : {
            supported: false,
            reason: 'DocTarget addressing is not supported; unlink acts at the selection',
          };
    case 'setParagraphFormat': {
      // Every bound the single-purpose commands apply, applied here too: this command is a
      // convenience over the same writes, not a way around their validation.
      const indents = [
        command.indentLeftTwips,
        command.indentRightTwips,
        command.indentFirstLineTwips,
      ];
      for (const value of indents) {
        if (value === undefined || value === null) continue;
        if (!Number.isInteger(value) || Math.abs(value) > MAX_PARAGRAPH_INDENT_TWIPS) {
          return {
            supported: false,
            code: 'invalidArgs',
            reason: `indent values must be whole twips within ±${MAX_PARAGRAPH_INDENT_TWIPS}`,
          };
        }
      }
      for (const field of ['spaceBeforePt', 'spaceAfterPt'] as const) {
        const value = command[field];
        if (value === undefined || value === null) continue;
        if (!Number.isFinite(value) || value < 0 || value > 1584) {
          return {
            supported: false,
            code: 'invalidArgs',
            reason: `setParagraphFormat requires ${field} between 0 and 1584 points`,
          };
        }
      }
      const line = command.lineSpacing;
      if (line !== undefined && line !== null) {
        if (line.rule !== 'multiple' && line.rule !== 'exact' && line.rule !== 'atLeast') {
          return {
            supported: false,
            code: 'invalidArgs',
            reason: "lineSpacing requires a rule of 'multiple', 'exact' or 'atLeast'",
          };
        }
        const raw = line.rule === 'multiple' ? line.value * 240 : line.value * 20;
        if (!Number.isFinite(line.value) || line.value <= 0 || Math.round(raw) > 31680) {
          return {
            supported: false,
            code: 'invalidArgs',
            reason: 'lineSpacing requires a positive value no taller than 1584pt',
          };
        }
      }
      if (
        command.alignment !== undefined &&
        !['left', 'center', 'right', 'justify'].includes(command.alignment)
      ) {
        return { supported: false, code: 'invalidArgs', reason: 'unknown alignment' };
      }
      if (command.direction !== undefined && !['ltr', 'rtl'].includes(command.direction)) {
        return { supported: false, code: 'invalidArgs', reason: 'unknown direction' };
      }
      if (command.tabStops !== undefined) {
        if (command.tabStops.length > 64) {
          return {
            supported: false,
            code: 'invalidArgs',
            reason: 'setParagraphFormat accepts at most 64 tab stops',
          };
        }
        // `can()` must agree with `exec()` and must never throw: a host calls it to decide
        // whether to enable a control, and both a false yes and an exception there are
        // worse than a refusal. Every rule the tree op enforces is enforced here too.
        const positions = new Set<number>();
        for (const stop of command.tabStops) {
          // Guarded before any member is read. `can()` is reachable from untyped JS, where
          // a null entry used to throw out of the classifier rather than be refused.
          if (typeof stop !== 'object' || stop === null) {
            return {
              supported: false,
              code: 'invalidArgs',
              reason: 'a tab stop must be an object',
            };
          }
          // Not `Math.abs`: a negative position is refused outright. The reader drops it
          // (`clampPositionTwips` returns null below zero), so accepting one wrote markup
          // the engine then reported as no stop at all — success that did nothing.
          if (
            !Number.isInteger(stop.positionTwips) ||
            stop.positionTwips < 0 ||
            stop.positionTwips > 31680
          ) {
            return {
              supported: false,
              code: 'invalidArgs',
              reason: 'tab stop positions must be whole twips between 0 and 31680',
            };
          }
          // `bar` is deliberately absent: it draws a vertical rule rather than stopping the
          // caret, the reader does not model it, and writing one round-tripped to nothing.
          // An existing bar tab in a file is preserved by the op; authoring a new one is not
          // something this engine can honour.
          if (!['left', 'center', 'right', 'decimal'].includes(stop.alignment)) {
            return { supported: false, code: 'invalidArgs', reason: 'unknown tab alignment' };
          }
          if (
            stop.leader !== undefined &&
            !['none', 'dot', 'hyphen', 'underscore', 'heavy', 'middleDot'].includes(stop.leader)
          ) {
            return { supported: false, code: 'invalidArgs', reason: 'unknown tab leader' };
          }
          // Two stops at one position is markup Word never writes, and the reader keeps
          // only the last — so the file would say one thing and the editor another.
          if (positions.has(stop.positionTwips)) {
            return {
              supported: false,
              code: 'invalidArgs',
              reason: 'two tab stops cannot share a position',
            };
          }
          positions.add(stop.positionTwips);
        }
      }
      return { supported: true, mutating: true };
    }
    case 'setIndent': {
      const fields = [command.left, command.right, command.firstLine];
      if (fields.every((value) => value === undefined)) {
        return { supported: false, reason: 'setIndent requires at least one indent field' };
      }
      // Bounded here because nothing downstream does: the store validates `w:ind`
      // attribute NAMES and XML-safety only, so an unchecked value reached the file as
      // `w:left="NaN"`. The read side clamps out-of-range values; a write refuses them,
      // because silently storing something other than what was asked for is the worse lie.
      for (const value of fields) {
        if (value === undefined || value === null) continue;
        if (!Number.isInteger(value)) {
          return { supported: false, reason: 'indent values must be whole twips' };
        }
        if (Math.abs(value) > MAX_PARAGRAPH_INDENT_TWIPS) {
          return {
            supported: false,
            reason: `indent values must be within ±${MAX_PARAGRAPH_INDENT_TWIPS} twips`,
          };
        }
      }
      return { supported: true, mutating: true };
    }
    case 'toggleList':
      return command.kind === 'bullet' || command.kind === 'ordered'
        ? { supported: true, mutating: true }
        : { supported: false, reason: `list kind '${command.kind}' is not supported` };
    case 'adjustIndent':
      return command.direction === 'increase' || command.direction === 'decrease'
        ? { supported: true, mutating: true }
        : { supported: false, reason: `indent direction '${command.direction}' is not supported` };
    case 'insertBreak':
      // Line, hard page, and both section breaks are wired. `column` belongs to the
      // multi-column lane, which layout does not own yet.
      return command.kind === 'line' ||
        command.kind === 'page' ||
        command.kind === 'section' ||
        command.kind === 'sectionContinuous'
        ? { supported: true, mutating: true }
        : { supported: false, reason: `break kind '${command.kind}' is not supported` };
    case 'replaceText':
    case 'applyFormatting':
    case 'splitParagraph':
    case 'mergeParagraphs':
    case 'removeTabMark':
      return classifySelectionEdit(command);
    case 'insertText':
      return command.target === undefined
        ? { supported: true, mutating: true }
        : {
            supported: false,
            reason: 'DocTarget addressing is not supported; text inserts at the selection',
          };
    case 'deleteText':
      return command.target === undefined
        ? { supported: true, mutating: true }
        : {
            supported: false,
            reason: 'DocTarget addressing is not supported; deletion removes the selection',
          };
    case 'proposeInsertion':
    case 'proposeReplacement': {
      const text = command.type === 'proposeInsertion' ? command.text : command.replaceWith;
      // Empty text refused too: it would commit a phantom `w:ins` holding nothing, a
      // tracked change the review pane must carry with no content to show for it. A
      // replacement that only removes is `proposeDeletion`.
      if (typeof text !== 'string' || text.length === 0) {
        return {
          supported: false,
          code: 'invalidArgs',
          reason: `${command.type} requires non-empty text`,
        };
      }
      if (/[\r\n\v\f\u2028\u2029]/.test(text)) {
        return {
          supported: false,
          code: 'invalidArgs',
          reason: `${command.type} requires text without a paragraph mark`,
        };
      }
      if (command.author !== undefined && command.author.trim().length === 0) {
        return {
          supported: false,
          code: 'invalidArgs',
          reason: `${command.type} requires a non-empty author`,
        };
      }
      return { supported: true, mutating: true };
    }
    case 'replaceAllMatches':
      return mutatingUnlessRefused(replaceAllMatchesArgumentRefusal(command));
    case 'replaceMatch':
      return mutatingUnlessRefused(replaceMatchArgumentRefusal(command));
    case 'replaceAcceptedText':
      return mutatingUnlessRefused(replaceAcceptedTextArgumentRefusal(command));
    case 'navigateHighlight': {
      const refusal = navigateHighlightArgumentRefusal(command);
      return refusal
        ? { supported: false, code: 'invalidArgs', reason: refusal }
        : { supported: true, mutating: false };
    }
    case 'proposeDeletion':
      return command.author !== undefined && command.author.trim().length === 0
        ? {
            supported: false,
            code: 'invalidArgs',
            reason: 'proposeDeletion requires a non-empty author',
          }
        : { supported: true, mutating: true };
    case 'setPageSetup': {
      const dims = [command.pageWidth, command.pageHeight];
      const margins = [
        command.marginTop,
        command.marginRight,
        command.marginBottom,
        command.marginLeft,
      ];
      if (
        dims.every((value) => value === undefined) &&
        margins.every((value) => value === undefined) &&
        command.orientation === undefined
      ) {
        return { supported: false, reason: 'setPageSetup requires at least one field' };
      }
      // The same bounds the op layer enforces, refused here so `can` answers honestly
      // BEFORE a dialog submits.
      for (const value of dims) {
        if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 63360)) {
          return {
            supported: false,
            code: 'invalidArgs',
            reason: 'page dimensions must be integer twips between 1 and 63360',
          };
        }
      }
      for (const value of margins) {
        if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > 31680)) {
          return {
            supported: false,
            code: 'invalidArgs',
            reason: 'margins must be integer twips between 0 and 31680',
          };
        }
      }
      if (
        command.orientation !== undefined &&
        command.orientation !== 'portrait' &&
        command.orientation !== 'landscape'
      ) {
        return {
          supported: false,
          code: 'invalidArgs',
          reason: "orientation must be 'portrait' or 'landscape'",
        };
      }
      if (
        command.scope !== undefined &&
        command.scope !== 'document' &&
        command.scope !== 'section'
      ) {
        return {
          supported: false,
          code: 'invalidArgs',
          reason: "scope must be 'document' or 'section'",
        };
      }
      return { supported: true, mutating: true };
    }
    case 'undo':
    case 'redo':
      return { supported: true, mutating: true };
    case 'insertTable':
      // Shape gate only — WHERE the caret is, and whether that story admits a block, is the
      // document's question and belongs to the surface's `canInsertTable`.
      return Number.isInteger(command.rows) &&
        Number.isInteger(command.cols) &&
        command.rows >= 1 &&
        command.cols >= 1 &&
        command.rows <= MAX_INSERT_TABLE_ROWS &&
        command.cols <= MAX_INSERT_TABLE_COLUMNS &&
        command.rows * command.cols <= MAX_INSERT_TABLE_CELLS
        ? { supported: true, mutating: true }
        : {
            supported: false,
            code: 'invalidArgs',
            reason: `insertTable needs whole rows and cols of at least 1, at most ${MAX_INSERT_TABLE_ROWS}×${MAX_INSERT_TABLE_COLUMNS}, and at most ${MAX_INSERT_TABLE_CELLS} cells`,
          };
    case 'insertToc':
      return { supported: true, mutating: true };
    case 'editTextFormField':
      return { supported: true, mutating: false };
    case 'refreshToc':
      if (
        command.mode !== undefined &&
        command.mode !== 'entire' &&
        command.mode !== 'pageNumbers'
      ) {
        return {
          supported: false,
          code: 'invalidArgs',
          reason: "refreshToc mode must be 'entire' or 'pageNumbers'",
        };
      }
      if (
        command.tocId !== undefined &&
        (typeof command.tocId !== 'string' || command.tocId.length === 0)
      ) {
        return {
          supported: false,
          code: 'invalidArgs',
          reason: 'refreshToc tocId must be a non-empty string',
        };
      }
      return { supported: true, mutating: true };
    case 'removeToc':
      if (
        command.tocId !== undefined &&
        (typeof command.tocId !== 'string' || command.tocId.length === 0)
      ) {
        return {
          supported: false,
          code: 'invalidArgs',
          reason: 'removeToc tocId must be a non-empty string',
        };
      }
      return { supported: true, mutating: true };
    case 'editHeaderFooter': {
      if (command.position !== 'header' && command.position !== 'footer') {
        return {
          supported: false,
          reason: "editHeaderFooter requires position 'header' or 'footer'",
        };
      }
      if (
        command.variant !== undefined &&
        command.variant !== 'default' &&
        command.variant !== 'first' &&
        command.variant !== 'even'
      ) {
        return {
          supported: false,
          reason: "editHeaderFooter variant must be 'default', 'first', or 'even'",
        };
      }
      return { supported: true, mutating: true };
    }
    case 'exitHeaderFooter':
      return { supported: true, mutating: false };
    case 'removeHeaderFooter':
    case 'linkHeaderFooterToPrevious':
    case 'unlinkHeaderFooterFromPrevious': {
      if (
        'variant' in command &&
        command.variant !== undefined &&
        command.variant !== 'default' &&
        command.variant !== 'first' &&
        command.variant !== 'even'
      ) {
        return {
          supported: false,
          reason: "furniture variant must be 'default', 'first', or 'even'",
        };
      }
      return { supported: true, mutating: true };
    }
    case 'setHeaderFooterOptions': {
      const empty =
        command.titlePage === undefined &&
        command.evenAndOddHeaders === undefined &&
        command.headerDistanceTwips === undefined &&
        command.footerDistanceTwips === undefined;
      return empty
        ? { supported: false, reason: 'setHeaderFooterOptions requires at least one option' }
        : { supported: true, mutating: true };
    }
    case 'insertPageField':
      return command.field === 'PAGE' ||
        command.field === 'NUMPAGES' ||
        command.field === 'SECTIONPAGES' ||
        command.field === 'PAGE_X_OF_Y'
        ? { supported: true, mutating: true }
        : {
            supported: false,
            reason:
              "insertPageField field must be 'PAGE', 'NUMPAGES', 'SECTIONPAGES', or 'PAGE_X_OF_Y'",
          };
    case 'insertNote':
      return command.noteKind === 'footnote' || command.noteKind === 'endnote'
        ? { supported: true, mutating: true }
        : { supported: false, reason: "insertNote noteKind must be 'footnote' or 'endnote'" };
    case 'deleteNote':
      return command.noteKind === 'footnote' || command.noteKind === 'endnote'
        ? { supported: true, mutating: true }
        : { supported: false, reason: "deleteNote noteKind must be 'footnote' or 'endnote'" };
    case 'convertNote':
      return command.fromKind === 'footnote' || command.fromKind === 'endnote'
        ? { supported: true, mutating: true }
        : { supported: false, reason: "convertNote fromKind must be 'footnote' or 'endnote'" };
    case 'convertAllNotes':
      return command.fromKind === 'footnote' || command.fromKind === 'endnote'
        ? { supported: true, mutating: true }
        : { supported: false, reason: "convertAllNotes fromKind must be 'footnote' or 'endnote'" };
    case 'setNoteProperties':
      if (command.endnote?.position === 'pageBottom') {
        return {
          supported: false,
          reason: 'endnote-pageBottom',
        };
      }
      return command.footnote !== undefined || command.endnote !== undefined
        ? { supported: true, mutating: true }
        : { supported: false, reason: 'setNoteProperties requires footnote and/or endnote fields' };
    // Selection is not document state, so neither selecting everything nor copying out of
    // the selection mutates. `copy` stays available in a read-only document — reading a
    // contract you may not edit and copying a clause out of it is the whole point of a
    // viewer. Whether there is anything to copy is a question about the SELECTION, which
    // this function cannot see; `gateCommand` asks it against the surface.
    case 'selectAll':
    case 'copy':
      return { supported: true, mutating: false };
    case 'cut':
      return { supported: true, mutating: true };
    case 'paste':
    case 'pasteWithoutFormatting': {
      if (typeof command.text !== 'string') {
        return { supported: false, code: 'invalidArgs', reason: 'paste requires text' };
      }
      const html = command.type === 'paste' ? command.html : undefined;
      if (html !== undefined && typeof html !== 'string') {
        return { supported: false, code: 'invalidArgs', reason: 'paste html must be a string' };
      }
      // An empty payload is refused rather than run. `paste` replaces the selection, so
      // "paste nothing" over a select-all is a whole-document delete wearing the wrong
      // name — and an empty clipboard is the ordinary way to reach it.
      return command.text === '' && (html === undefined || html === '')
        ? { supported: false, code: 'invalidArgs', reason: 'there is nothing to paste' }
        : { supported: true, mutating: true };
    }
    case 'insertRow':
    case 'deleteRow':
    case 'insertColumn':
    case 'deleteColumn':
    case 'deleteTable':
    case 'setCellFill':
    case 'setTableCellVerticalAlignment':
    case 'setTableBorders':
    case 'commitTableColumnDividerResize':
    case 'commitTableRightEdgeResize':
    case 'mergeCells':
    case 'splitCell':
    case 'toggleHeaderRow':
    case 'setTableProperties': {
      const tableSupport = tableCommandCanSupport(command);
      return tableSupport.supported
        ? { supported: true, mutating: true }
        : { supported: false, reason: tableSupport.reason ?? 'unsupported table command' };
    }
    case 'selectTableRegion':
      return command.region === 'table'
        ? { supported: true, mutating: false }
        : { supported: false, reason: `selecting a table ${command.region} is not supported yet` };
    case 'setSelection': {
      // Shape gate only: whether an anchor's paraId exists (and its `search` phrase is
      // unique) is a property of the DOCUMENT, checked at exec — the same split as
      // `insertText`, whose target cannot be pre-verified either.
      const text = 'range' in command ? textSelectionOf(command.range) : NOT_A_TEXT_SELECTION;
      if (text.kind === 'invalid') {
        return { supported: false, code: 'invalidArgs', reason: text.reason };
      }
      return text.kind === 'ok' ||
        ('range' in command && isDocAnchorRange(command.range)) ||
        ('anchor' in command && isDocAnchor(command.anchor))
        ? { supported: true, mutating: false }
        : {
            supported: false,
            reason:
              'setSelection accepts { anchor: { paraId } }, a { range } whose from/to are paraId anchors, or a { range } carrying an { anchor: { blockId, offset }, head } selection',
          };
    }
    case 'insertTextBox':
      return { supported: true, mutating: true };
    case 'insertChart':
    case 'setChartData':
    case 'setChartType':
    case 'setChartFormat':
    case 'setChartColor':
      return { supported: true, mutating: true };
    case 'insertImage':
      return command.data instanceof Uint8Array &&
        (command.mime === 'image/png' ||
          command.mime === 'image/jpeg' ||
          command.mime === 'image/gif') &&
        Number.isFinite(command.widthPoints) &&
        Number.isFinite(command.heightPoints) &&
        command.widthPoints > 0 &&
        command.heightPoints > 0
        ? { supported: true, mutating: true }
        : {
            supported: false,
            code: 'invalidArgs',
            reason: 'insertImage requires png/jpeg/gif bytes and finite dimensions',
          };
    case 'replaceImage':
      return command.data instanceof Uint8Array
        ? { supported: true, mutating: true }
        : { supported: false, code: 'invalidArgs', reason: 'replaceImage requires image bytes' };
    case 'deleteImage':
      return { supported: true, mutating: true };
    case 'setImageWrapType': {
      const wraps = [
        'inline',
        'square',
        'squareLeft',
        'squareRight',
        'tight',
        'through',
        'topAndBottom',
        'behind',
        'inFront',
      ] as const;
      return wraps.includes(command.target)
        ? { supported: true, mutating: true }
        : { supported: false, code: 'invalidArgs', reason: 'unsupported wrap target' };
    }
    case 'transformImage':
      return command.action === 'rotateCW' ||
        command.action === 'rotateCCW' ||
        command.action === 'flipH' ||
        command.action === 'flipV'
        ? { supported: true, mutating: true }
        : { supported: false, code: 'invalidArgs', reason: 'unsupported transform action' };
    case 'setImagePosition':
    case 'setShapeFill':
    case 'setShapeOutline':
      return { supported: true, mutating: true };
    case 'setImageProperties':
      return { supported: true, mutating: true };
    case 'insertBookmark':
    case 'deleteBookmark':
    case 'keepFirstBookmark':
    case 'goToBookmark':
      return typeof command.name === 'string' && command.name.length > 0
        ? { supported: true, mutating: command.type !== 'goToBookmark' }
        : { supported: false, code: 'invalidArgs', reason: `${command.type} needs a name` };
    case 'setWatermark':
      return mutatingUnlessRefused(watermarkRefusal(command.watermark));
    default:
      return { supported: false, reason: unknownCommandReason(command.type) };
  }
}

/** The classifier's refusal for a command type it has no case for. */
export function unknownCommandReason(type: string): string {
  return `command '${type}' is not supported by the tree editor`;
}

// ---------------------------------------------------------------------------------------
// Snapshot value equality.
//
// The cached snapshot re-derives once per state tick, and reuses the PREVIOUS `formatting`
// and `page` sub-objects when they are value-equal — so a selector like
// `snapshot().formatting` stays reference-stable across ticks that did not change it, and
// a React store comparing by reference does not re-render every subscriber on every tick.
// ---------------------------------------------------------------------------------------

export {
  createTocContextCache,
  docRangeEqual,
  formattingEqual,
  pageEqual,
  pageSetupEqual,
  snapshotsEqual,
  tableContextEqual,
} from './docx-editor-equality.ts';
