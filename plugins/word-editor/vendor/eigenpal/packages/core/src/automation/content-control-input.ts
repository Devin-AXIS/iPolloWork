// What a caller may say ABOUT a content control, before the planner acts on it.
//
// The vocabularies the operation protocol accepts for a control — its lock names, the places a
// range may name on it, the subtypes it may be created as — and the validation of a caller-supplied
// value. Split from `plan.ts`, which consults these while planning and is long enough already;
// nothing here reads the document, so it needs no planner state.

import type { OoxmlNode } from '../store/package/ooxml-tree.ts';
import {
  contentControlContentNodeOf,
  contentControlsIn,
  type ContentControlProperties,
} from '../store/package/content-control-nodes.ts';
import type { ContentControlValueInput } from '../store/store/tree-op-content-controls.ts';
import {
  LINE_BREAK_TEXT,
  propertiesHoldLineBreaks,
} from '../store/store/tree-op-inline-elements.ts';
import type { AutomationError, AutomationErrorCode } from './protocol.ts';

/**
 * Every control under a scope, nested ones included, in document order.
 *
 * For the lookups that search what the FILE wrote — an id, a tag, a title. Word's own numbering
 * is not scoped to a nesting level, so a lookup restricted to a scope's direct children would
 * report a control that plainly exists as absent.
 */
export function allControlsUnder(scope: OoxmlNode): readonly OoxmlNode[] {
  const root = scope.kind === 'contentControl' ? contentControlContentNodeOf(scope) : scope;
  if (!root) return [];
  return contentControlsIn(root).map((entry) => entry.node);
}

export const CONTENT_CONTROL_LOCKS: ReadonlySet<string> = new Set([
  'unlocked',
  'sdtLocked',
  'contentLocked',
  'sdtContentLocked',
]);

export const CONTENT_CONTROL_RANGE_LOCATIONS: ReadonlySet<string> = new Set([
  'whole',
  'content',
  'start',
  'end',
  'before',
  'after',
]);

export const CONTENT_CONTROL_SUBTYPES: ReadonlySet<string> = new Set([
  'richText',
  'plainText',
  'dropDownList',
  'comboBox',
  'date',
]);

/** Longest tag/title/value a caller may author, so a script cannot ask for an unbounded write. */
const MAX_CONTROL_STRING = 4_096;

/** Text insertion cannot replace or append to a typed control value. */
export function contentControlTextInsertionError(
  properties: Pick<ContentControlProperties, 'type' | 'multiLine'>,
  text: unknown,
  at: unknown
): AutomationError | null {
  const { type } = properties;
  if (!['richText', 'plainText', 'comboBox', 'untyped'].includes(type))
    return {
      code: 'unsupported-capability',
      message: 'this control requires a typed value rather than a text insertion',
      detail: type,
    };
  if (typeof text !== 'string')
    return { code: 'unsupported-content', message: 'text is required', detail: 'text' };
  // A line break is for rich text and multi-line plain text; a single-line field holds one line.
  if (text.includes(LINE_BREAK_TEXT) && !propertiesHoldLineBreaks(properties))
    return {
      code: 'unsupported-content',
      message: 'a single-line control cannot hold a line break',
      detail: 'line-break-in-single-line-control',
    };
  if (at !== 'replace' && at !== 'start' && at !== 'end')
    return {
      code: 'unsupported-content',
      message: 'that is not a place to insert at',
      detail: String(at),
    };
  return null;
}

/**
 * The typed value a caller offered, or why it is not one.
 *
 * Validated HERE and not only in the store, because a caller-supplied object is untrusted input
 * arriving over a transport: a `value` that is a number, or a `kind` nobody declares, must be a
 * named refusal rather than something the tree lane has to defend against.
 */
export function contentControlValueOf(value: unknown):
  | { readonly ok: true; readonly value: ContentControlValueInput }
  | {
      readonly ok: false;
      readonly code: AutomationErrorCode;
      readonly message: string;
      readonly detail?: string;
    } {
  const bad = (message: string, detail?: string) => ({
    ok: false as const,
    code: 'unsupported-content' as AutomationErrorCode,
    message,
    detail,
  });
  if (typeof value !== 'object' || value === null || !('kind' in value)) {
    return bad('a control value states its kind', 'value');
  }
  const offered = value as Record<string, unknown>;
  const kind = offered.kind;
  if (kind === 'text' || kind === 'listItem') {
    const raw = kind === 'text' ? offered.text : offered.value;
    if (typeof raw !== 'string') return bad('that value is not a string', String(kind));
    if (raw.length > MAX_CONTROL_STRING) return bad('that value is too long', String(raw.length));
    return {
      ok: true,
      value: kind === 'text' ? { kind: 'text', text: raw } : { kind: 'listItem', value: raw },
    };
  }
  if (kind === 'checkbox') {
    const checked = offered.checked;
    if (typeof checked !== 'boolean') return bad('a checkbox is checked or not', 'checked');
    return { ok: true, value: { kind: 'checkbox', checked } };
  }
  if (kind === 'date') {
    const iso = offered.iso;
    if (typeof iso !== 'string') return bad('a date is an ISO-8601 string', 'iso');
    if (iso.length > 64) return bad('that is not a date', String(iso.length));
    return { ok: true, value: { kind: 'date', iso } };
  }
  return bad('that is not a value any control accepts', String(kind));
}
