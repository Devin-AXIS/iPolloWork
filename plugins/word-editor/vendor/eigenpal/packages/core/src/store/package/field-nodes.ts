// Typed field vocabulary helpers (`w:fldChar`, `w:instrText`, `w:fldSimple`).
//
// Canonical nodes preserve schema order and authored attributes (`w:fldCharType`,
// `w:dirty`, `w:fldLock`, `w:instr`). Legacy `CT_FldChar/w:ffData` stays generic payload
// under `fldChar`. Its render STATE (`w:checkBox` / `w:ddList`) is read through the bounded
// {@link legacyFormFieldDataOf}; its macro references (entryMacro/exitMacro) are never read,
// never auto-resolved, never executed.
//
// Well-formed computed fields (begin→end within one paragraph) and `fldSimple` each contribute
// exactly one UTF-16 unit ({@link FIELD_ATOM_CHAR}) to paragraph addressing. A FORMTEXT field
// is different: its result is authored form input, so those runs remain normally addressable.
// Malformed fields demote too: markers contribute nothing and interior result text remains
// visible/addressable so content never disappears.

import { inlineCharacterTextOf } from './hyphen-text.ts';
import { currentFieldResultsMode, type FieldResultsMode } from './field-result-mode.ts';
import {
  contentControlContentChildren,
  isContentControl,
  MAX_CONTENT_CONTROL_NESTING,
} from './content-control-walk.ts';
import { hardBreakText } from './hard-break.ts';
import {
  isInlineRunContainer,
  MAX_INLINE_CONTAINER_DEPTH,
  nextInlineContainerDepth,
  WML_NAMESPACE_URI,
} from './ooxml-shared.ts';
import type {
  OoxmlFldCharNode,
  OoxmlFldSimpleNode,
  OoxmlInstrTextNode,
  OoxmlNode,
  OoxmlParagraphNode,
} from './ooxml-tree.ts';

/** UTF-16 placeholder for one atomic field unit in `paragraphTextOf` / segments. */
export const FIELD_ATOM_CHAR = '\uFFFC';

/**
 * Which part of a complex field a `w:fldChar` marks.
 *
 * A complex field spans many runs: `begin`, the instruction, `separate`, the cached result, then
 * `end` — which is why a field is one logical unit across several nodes.
 */
export type FldCharType = 'begin' | 'separate' | 'end';

const FLD_CHAR_TYPES: ReadonlySet<string> = new Set(['begin', 'separate', 'end']);

function attributeValue(node: OoxmlNode, localName: string): string | undefined {
  if (node.kind === 'textValue' || !('attributes' in node)) return undefined;
  for (const entry of node.attributes) {
    if (entry.namespaceUri === WML_NAMESPACE_URI && entry.localName === localName) {
      return entry.value;
    }
    // Unprefixed attributes on WML elements are common in authored packages.
    if (entry.namespaceUri === '' && entry.localName === localName) return entry.value;
  }
  return undefined;
}

function isWml(node: OoxmlNode, localName: string): boolean {
  return (
    node.kind !== 'textValue' &&
    node.namespaceUri === WML_NAMESPACE_URI &&
    node.localName === localName
  );
}

/** Read `@w:fldCharType` when present and schema-legal. */
export function fldCharType(node: OoxmlNode): FldCharType | null {
  if (!isWml(node, 'fldChar')) return null;
  const value = attributeValue(node, 'fldCharType');
  if (value === 'begin' || value === 'separate' || value === 'end') return value;
  return null;
}

/** Whether a node is a `w:fldChar` field boundary marker. */
export function isFldCharNode(node: OoxmlNode): node is OoxmlFldCharNode {
  return node.kind === 'fldChar';
}

/**
 * Whether a node is `w:instrText` — a field's instruction.
 *
 * Instructions are never EXECUTED or auto-resolved: `DDE` and `INCLUDE*` render inert.
 */
export function isInstrTextNode(node: OoxmlNode): node is OoxmlInstrTextNode {
  return node.kind === 'instrText';
}

/** Whether a node is `w:fldSimple` — a field whose instruction and result are one element. */
export function isFldSimpleNode(node: OoxmlNode): node is OoxmlFldSimpleNode {
  return node.kind === 'fldSimple';
}

/** Typed or generic `w:fldChar` with the given type. */
export function isFldChar(node: OoxmlNode, type: FldCharType): boolean {
  return fldCharType(node) === type;
}

/**
 * Typed or generic `w:instrText`, and `w:delInstrText` — the form a tracked deletion gives
 * the instruction (§17.16.13), always generic in the canonical tree.
 *
 * One predicate for both on purpose: everything that consumes instruction text (the offset
 * authority, the layout field machine, span collection) must treat a deleted field's
 * instruction exactly like a live one — ingested per phase, never painted. Excluding the
 * deleted form let its `w:delInstrText` fall through those walks as ordinary run content.
 */
export function isInstrText(node: OoxmlNode): boolean {
  return (
    node.kind === 'instrText' ||
    (node.kind === 'generic' && (isWml(node, 'instrText') || isWml(node, 'delInstrText')))
  );
}

/**
 * Whether an instruction node is the DELETED form `w:delInstrText` (always generic — no
 * typed kind).
 *
 * Consumers that ingest instruction text must keep deleted chunks in their own buffer:
 * a tracked field-code edit puts `w:delInstrText` next to `w:instrText` in one field, and
 * concatenating them produces an instruction nobody authored. The effective instruction is
 * the live text when any live element exists, else the deleted text (a fully-deleted field
 * keeps its meaning, with delete attribution).
 */
export function isDeletedInstrText(node: OoxmlNode): boolean {
  return node.kind === 'generic' && isWml(node, 'delInstrText');
}

/** Typed or generic `w:fldSimple`. */
export function isFldSimple(node: OoxmlNode): boolean {
  return node.kind === 'fldSimple' || (node.kind === 'generic' && isWml(node, 'fldSimple'));
}

/** Concatenated text descendants of `w:instrText` (instruction only — never executed). */
export function instrTextValue(node: OoxmlNode): string {
  if (!isInstrText(node) || node.kind === 'textValue') return '';
  let text = '';
  const stack: OoxmlNode[] = [...(node.children ?? [])];
  while (stack.length > 0) {
    const next = stack.pop()!;
    if (next.kind === 'textValue') {
      text = next.value + text;
      continue;
    }
    for (const child of next.children ?? []) stack.push(child);
  }
  return text;
}

/** `@w:instr` on `w:fldSimple`, or undefined when absent. */
export function fldSimpleInstr(node: OoxmlNode): string | undefined {
  if (!isFldSimple(node)) return undefined;
  return attributeValue(node, 'instr');
}

/**
 * Read an on/off WML attribute (`dirty` / `fldLock`).
 *
 * Returns `undefined` when absent, otherwise the OOXML on/off interpretation
 * (present without val, or val not explicitly off → true).
 */
export function fieldOnOffAttribute(
  node: OoxmlNode,
  localName: 'dirty' | 'fldLock'
): boolean | undefined {
  if (node.kind === 'textValue' || !('attributes' in node)) return undefined;
  const raw = attributeValue(node, localName);
  if (raw === undefined) {
    // Attribute missing entirely.
    const present = node.attributes.some(
      (entry) =>
        entry.localName === localName &&
        (entry.namespaceUri === WML_NAMESPACE_URI || entry.namespaceUri === '')
    );
    return present ? true : undefined;
  }
  return !(raw === '0' || raw === 'false' || raw === 'off');
}

/** Model text contributed by one atomic field unit. */
export function fieldAtomText(): typeof FIELD_ATOM_CHAR {
  return FIELD_ATOM_CHAR;
}

/**
 * True when a node is field chrome that never contributes its own model text outside
 * an atomic span (markers + instruction). Cached result `w:t` is separate.
 */
export function isFieldChrome(node: OoxmlNode): boolean {
  const type = fldCharType(node);
  if (type !== null) return true;
  return isInstrText(node);
}

/**
 * True when a `w:fldChar` carries `w:ffData` — a LEGACY FORM FIELD (§17.16.17).
 *
 * FORMTEXT, FORMCHECKBOX and FORMDROPDOWN are what a fillable Word form is made of, and Word
 * shades them on sight so a reader can find the blanks. That is a presentation question,
 * answered by the element's presence alone — this predicate never looks inside.
 *
 * Rendering STATE (a checkbox's checked bit, a dropdown's entries and selection) is different:
 * {@link legacyFormFieldDataOf} reads exactly that, bounded, and nothing else. The contract
 * stands: `w:ffData` macro references (`w:entryMacro` / `w:exitMacro`), `w:name`, help/status
 * text and behavior flags are attacker-supplied script references and are NEVER read, returned
 * or resolved by anything in this module.
 */
export function hasLegacyFormFieldData(node: OoxmlNode): boolean {
  if (node.kind === 'textValue') return false;
  if (fldCharType(node) === null) return false;
  for (const child of node.children) {
    if (child.kind === 'textValue') continue;
    if (child.localName === 'ffData' && isWml(child, 'ffData')) return true;
  }
  return false;
}

/**
 * Legacy form-field render state read from `w:ffData` (§17.16.17), and nothing else.
 *
 * `checkbox`: `sizeHalfPoints` is the explicit `w:size` in half-points, clamped to a sane
 * render range, or null for auto-size (`w:sizeAuto`, absent, malformed, or negative —
 * ST_HpsMeasure is unsigned, so a negative value is invalid, not small).
 * `dropdown`: `selectedIndex` is already resolved (in-range `w:result`, else in-range
 * `w:default`, else 0 — an out-of-range index counts as absent, and the FIRST `w:result` /
 * `w:default` element wins even when malformed) and always in range when `entries` is
 * non-empty; `entries` may be empty (layout paints nothing).
 */
export type LegacyFormFieldData =
  | {
      readonly kind: 'checkbox';
      readonly checked: boolean;
      readonly sizeHalfPoints: number | null;
    }
  | {
      readonly kind: 'dropdown';
      readonly entries: readonly string[];
      readonly selectedIndex: number;
    };

/** Total direct-child visits the ffData walk will spend before failing closed. */
const MAX_FF_DATA_NODES = 256;
/** Dropdown entries collected — capped BEFORE collection, never sized by the file. */
const MAX_DROPDOWN_ENTRIES = 64;
/** Characters kept per dropdown entry. */
const MAX_DROPDOWN_ENTRY_CHARS = 256;
/** `w:size` clamp in half-points: 1pt .. 144pt. */
const MIN_CHECKBOX_SIZE_HALF_POINTS = 2;
const MAX_CHECKBOX_SIZE_HALF_POINTS = 288;
/**
 * Largest `w:val` index accepted for `w:result` / `w:default` on `w:ddList`: the engine's own
 * entry cap ({@link MAX_DROPDOWN_ENTRIES} collected entries → indices 0..63), not a schema
 * limit. An index outside 0..63 is treated as ABSENT, never clamped onto an entry the file
 * did not choose — clamping let a hostile `w:result` shadow a valid `w:default`.
 */
const MAX_DROPDOWN_INDEX = MAX_DROPDOWN_ENTRIES - 1;

type NodeBudget = { left: number };

/** On/off child element (`w:checked` / `w:default`): present without `w:val` means true. */
function onOffElementValue(element: OoxmlNode): boolean {
  const raw = attributeValue(element, 'val');
  if (raw === undefined) return true;
  return !(raw === '0' || raw === 'false' || raw === 'off');
}

/**
 * Bounded `w:size` parse (ST_HpsMeasure — half-points, UNSIGNED): null when absent, malformed
 * or negative (auto size); large values clamp to the render cap. A negative value is not a
 * small size, it is schema-invalid, so it must not clamp up to a 1pt box.
 */
function checkboxSizeAttribute(element: OoxmlNode): number | null {
  const raw = attributeValue(element, 'val');
  if (raw === undefined || !/^\d{1,7}$/.test(raw)) return null;
  const value = Number.parseInt(raw, 10);
  return Math.min(MAX_CHECKBOX_SIZE_HALF_POINTS, Math.max(MIN_CHECKBOX_SIZE_HALF_POINTS, value));
}

/**
 * Bounded index parse for `w:result` / `w:default`: null when absent, malformed, negative or
 * past {@link MAX_DROPDOWN_INDEX} — out of range means ABSENT, never a clamped neighbor.
 */
function dropdownIndexAttribute(element: OoxmlNode): number | null {
  const raw = attributeValue(element, 'val');
  if (raw === undefined || !/^-?\d{1,7}$/.test(raw)) return null;
  const value = Number.parseInt(raw, 10);
  return value >= 0 && value <= MAX_DROPDOWN_INDEX ? value : null;
}

function checkboxDataOf(checkbox: OoxmlNode, budget: NodeBudget): LegacyFormFieldData {
  let checked: boolean | undefined;
  let fallback: boolean | undefined;
  let sizeHalfPoints: number | null = null;
  // First-wins via its own flag ("first state element wins", like `checked` / `default`
  // above): `??=` cannot express it here because a malformed first size also resolves null.
  let sizeSeen = false;
  let sizeAuto = false;
  if (checkbox.kind !== 'textValue') {
    for (const child of checkbox.children) {
      if (budget.left-- <= 0) break;
      if (child.kind === 'textValue') continue;
      if (isWml(child, 'checked')) checked ??= onOffElementValue(child);
      else if (isWml(child, 'default')) fallback ??= onOffElementValue(child);
      else if (isWml(child, 'size')) {
        if (!sizeSeen) {
          sizeSeen = true;
          sizeHalfPoints = checkboxSizeAttribute(child);
        }
      } else if (isWml(child, 'sizeAuto')) sizeAuto = true;
      // Anything else under checkBox is ignored — never descended into.
    }
  }
  return {
    kind: 'checkbox',
    checked: checked ?? fallback ?? false,
    sizeHalfPoints: sizeAuto ? null : sizeHalfPoints,
  };
}

function dropdownDataOf(list: OoxmlNode, budget: NodeBudget): LegacyFormFieldData {
  let result: number | null = null;
  let fallback: number | null = null;
  // First-wins via their own flags, exactly like checkbox `w:size`: `??=` cannot express
  // "first ELEMENT wins" because a malformed / out-of-range first value also resolves null,
  // which let a later valid sibling shadow it.
  let resultSeen = false;
  let fallbackSeen = false;
  const entries: string[] = [];
  if (list.kind !== 'textValue') {
    for (const child of list.children) {
      if (budget.left-- <= 0) break;
      if (child.kind === 'textValue') continue;
      if (isWml(child, 'result')) {
        if (!resultSeen) {
          resultSeen = true;
          result = dropdownIndexAttribute(child);
        }
      } else if (isWml(child, 'default')) {
        if (!fallbackSeen) {
          fallbackSeen = true;
          fallback = dropdownIndexAttribute(child);
        }
      } else if (isWml(child, 'listEntry')) {
        if (entries.length >= MAX_DROPDOWN_ENTRIES) continue;
        const value = attributeValue(child, 'val');
        if (value !== undefined) entries.push(value.slice(0, MAX_DROPDOWN_ENTRY_CHARS));
      }
      // Anything else under ddList is ignored — never descended into.
    }
  }
  const inRange = (index: number | null): index is number =>
    index !== null && index >= 0 && index < entries.length;
  return {
    kind: 'dropdown',
    entries,
    selectedIndex: inRange(result) ? result : inRange(fallback) ? fallback : 0,
  };
}

/**
 * Read a legacy form field's RENDER STATE from the `w:ffData` under a `w:fldChar`, bounded.
 *
 * The one sanctioned walk into `w:ffData`: fldChar → ffData → checkBox/ddList → leaf
 * attributes, direct children only, no recursion, at most {@link MAX_FF_DATA_NODES} child
 * visits. It reads the checkbox checked/size state and the dropdown entries/selection —
 * NEVER `w:name`, `w:entryMacro`, `w:exitMacro`, `w:helpText`, `w:statusText`, `w:enabled`
 * or `w:calcOnExit`: those carry attacker-supplied macro references and behavior, which
 * rendering must not observe.
 *
 * Returns null for anything else (no ffData, a FORMTEXT ffData, malformed content), so
 * callers fall back to the presence-only behavior of {@link hasLegacyFormFieldData}.
 */
export function legacyFormFieldDataOf(node: OoxmlNode): LegacyFormFieldData | null {
  if (node.kind === 'textValue') return null;
  if (fldCharType(node) === null) return null;
  const budget: NodeBudget = { left: MAX_FF_DATA_NODES };
  for (const child of node.children) {
    if (budget.left-- <= 0) return null;
    if (child.kind === 'textValue' || !isWml(child, 'ffData')) continue;
    // First ffData wins; inside it, the first state element wins.
    for (const entry of child.children) {
      if (budget.left-- <= 0) return null;
      if (entry.kind === 'textValue') continue;
      if (isWml(entry, 'checkBox')) return checkboxDataOf(entry, budget);
      if (isWml(entry, 'ddList')) return dropdownDataOf(entry, budget);
      // `w:textInput` (FORMTEXT), `w:name`, macros, help/status text: deliberately not read.
    }
    return null;
  }
  return null;
}

/**
 * One atomic field span inside a paragraph for caret / delete / selection.
 *
 * `removeNodeIds` lists every node that must leave with the unit (begin…end chrome and
 * cached-result content for complex fields; the `fldSimple` element for simple fields).
 *
 * `formatRunIds` lists the runs whose `w:rPr` owns displayed result formatting — result-phase
 * runs with measurable cache text for complex fields, child `w:r`s for `fldSimple`, or the
 * separate/begin run when the result is empty. Delete / caret addressing still uses `runId`
 * (the begin / simple node); formatting must not rewrite chrome-only begin runs when the
 * painted glyphs come from a different result run.
 */
export interface AtomicFieldSpan {
  readonly kind: 'complex' | 'simple';
  /** Addressable segment node (begin `fldChar` or `fldSimple`). */
  readonly node: OoxmlNode;
  /** Run that owns the begin marker; empty string for paragraph-level `fldSimple`. */
  readonly runId: string;
  readonly removeNodeIds: readonly string[];
  /** Runs that own displayed result formatting (may differ from `runId`). */
  readonly formatRunIds: readonly string[];
}

/** A closed field and the addressing policy its instruction gives its result. */
export interface ParsedFieldSpan extends AtomicFieldSpan {
  readonly addressing: 'atomic' | 'editable-result' | 'saved-result';
}

/** One field-machine entry from the shared paragraph-inline flatten. @internal */
export interface FieldRunChildRef {
  readonly runId: string;
  readonly node: OoxmlNode;
  readonly hiddenInOriginal: boolean;
  /** Inside a pending deletion or move source: absent once every revision is accepted. */
  readonly hiddenInCurrent: boolean;
}

/** Text contributed by one supported field-result inline node. @internal */
export function fieldResultInlineTextOf(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.value;
  const hyphen = inlineCharacterTextOf(node);
  if (hyphen !== null) return hyphen;
  if (node.kind === 'tab') return '\t';
  if (node.kind === 'hardBreak') return hardBreakText(node);
  if (node.kind !== 'text' && node.kind !== 'deletedText') return '';
  let text = '';
  for (const child of node.children) if (child.kind === 'textValue') text += child.value;
  return text;
}

/**
 * Flatten the inline nodes one field machine sees. Only content controls spend nesting depth.
 * @internal
 */
export function collectFieldRunChildren(
  container: OoxmlNode,
  entries: FieldRunChildRef[],
  budget?: { left: number }
): boolean {
  let complete = true;
  const visit = (
    child: OoxmlNode,
    sdtDepth: number,
    hiddenInOriginal: boolean,
    hiddenInCurrent: boolean
  ): void => {
    if (!complete) return;
    if (sdtDepth >= MAX_INLINE_CONTAINER_DEPTH) return;
    if (budget && budget.left-- <= 0) {
      complete = false;
      return;
    }
    const hidden =
      hiddenInOriginal || child.kind === 'revisionInsert' || child.kind === 'revisionMoveTo';
    const removed =
      hiddenInCurrent || child.kind === 'revisionDelete' || child.kind === 'revisionMoveFrom';
    if (isFldSimple(child)) {
      entries.push({
        runId: '',
        node: child,
        hiddenInOriginal: hidden,
        hiddenInCurrent: removed,
      });
      return;
    }
    if (child.kind === 'run') {
      for (const node of child.children) {
        if (node.kind === 'runProperties') continue;
        if (budget && budget.left-- <= 0) {
          complete = false;
          return;
        }
        entries.push({
          runId: child.id,
          node,
          hiddenInOriginal: hidden,
          hiddenInCurrent: removed,
        });
      }
      return;
    }
    if (isContentControl(child)) {
      if (sdtDepth >= MAX_CONTENT_CONTROL_NESTING) return;
      for (const inner of contentControlContentChildren(child))
        visit(inner, sdtDepth + 1, hidden, removed);
      return;
    }
    if (child.kind === 'textValue') return;
    // Every transparent run container descends: a link, a revision wrapper, and the generic
    // wrappers (`w:smartTag`, `w:customXml`, `w:dir`, `w:bdo`) all hold ordinary run content,
    // and a field inside one is an ordinary field. Depth follows the shared authority so this
    // walk and `segmentsOf` agree about what is addressable.
    if (isInlineRunContainer(child)) {
      const depth = nextInlineContainerDepth(child, sdtDepth);
      for (const inner of child.children) visit(inner, depth, hidden, removed);
    }
  };
  if (container.kind !== 'textValue') {
    for (const child of container.children) visit(child, 0, false, false);
  }
  return complete;
}

const MERGEFORMAT_SUFFIX = /\s*\\\*\s*MERGEFORMAT\s*$/i;

/**
 * Caps hostile complex-field instruction buffers (fail closed → inert).
 *
 * ONE bound for the store's span parser and layout's field machine (which re-exports this
 * constant): if they disagreed, FORMTEXT addressing here would diverge from what layout
 * paints. Sized to admit a full-length `HYPERLINK` instruction — the same bound the
 * `w:fldSimple` attribute lane applies (`MAX_HYPERLINK_INSTRUCTION_CHARS` in
 * `layout/field-link.ts`), so a long URL behaves identically as a complex field and as a
 * simple field. Short-grammar parsers (SYMBOL, MACROBUTTON) keep their own tighter local
 * caps on purpose.
 */
export const MAX_FIELD_INSTRUCTION_CHARS = 4096;

/** Maximum supported nesting for complex fields inside one paragraph. */
export const MAX_FIELD_NESTING = 4;

/**
 * Field types whose painted result IS the saved result: the engine never computes a new value
 * for them, so the reader can edit the result text in place. Every other type paints a value
 * the engine computes (page numbers, references, document properties, symbols) and stays one
 * unit, because an edit would not show.
 */
const SAVED_RESULT_FIELD_TYPES: ReadonlySet<string> = new Set([
  'CREATEDATE',
  'DATE',
  'FILENAME',
  'FILLIN',
  'HYPERLINK',
  'MERGEFIELD',
  'PRINTDATE',
  'QUOTE',
  'SAVEDATE',
  'SEQ',
  'TIME',
]);

/** The field type named by an instruction: its first word, upper-cased. */
function fieldTypeOf(instruction: string): string {
  return /^\s*([A-Za-z]+)/.exec(instruction)?.[1]?.toUpperCase() ?? '';
}

/**
 * How a closed complex field's result is addressed.
 *
 * - `editable-result`: a FORMTEXT input, with its form behavior.
 * - `saved-result`: a field that shows its saved result; the result runs are ordinary text and
 *   the markers and instruction take no offsets.
 * - `atomic`: one unit. Also used for a saved-result field whose result holds another field
 *   or no text at all (an emptied result stays reachable as one unit).
 *
 * In the `atomic` mode (the default, see `field-result-mode.ts`) saved-result fields stay one
 * unit, so raw paragraph text is unchanged.
 */
export function fieldResultAddressing(
  instruction: string,
  options: {
    readonly maxInstructionChars?: number;
    readonly nestedInResult?: boolean;
    /** The field saves no result text: it stays one unit, which the caret can step over. */
    readonly emptyResult?: boolean;
    readonly fieldResults?: FieldResultsMode;
  } = {}
): ParsedFieldSpan['addressing'] {
  const maxChars = options.maxInstructionChars ?? MAX_FIELD_INSTRUCTION_CHARS;
  if (isEditableFormTextInstruction(instruction, maxChars)) return 'editable-result';
  const mode = options.fieldResults ?? currentFieldResultsMode();
  if (mode !== 'editable' || options.nestedInResult || options.emptyResult) return 'atomic';
  if (instruction.length > maxChars) return 'atomic';
  return SAVED_RESULT_FIELD_TYPES.has(fieldTypeOf(instruction)) ? 'saved-result' : 'atomic';
}

/** Whether a bounded instruction denotes Word's editable legacy text-form input. */
export function isEditableFormTextInstruction(
  raw: string,
  maxChars = MAX_FIELD_INSTRUCTION_CHARS
): boolean {
  if (raw.length > maxChars) return false;
  const collapsed = raw.replace(/\s+/g, ' ').trim().toUpperCase();
  if (collapsed.length > maxChars) return false;
  return collapsed.replace(MERGEFORMAT_SUFFIX, '').trim() === 'FORMTEXT';
}

/**
 * Collect syntactically closed field spans in document order.
 *
 * Demotion (no span emitted — callers surface interior text normally):
 * - `end` without matching `begin`
 * - orphan `instrText` outside an open field
 * - missing `end` before paragraph end
 * - nesting deeper than `maxNesting`
 * - instruction longer than `maxInstructionChars` (still forms a span when begin/end
 *   pair closes, but callers may treat evaluation as inert; addressing stays atomic)
 *
 * Cross-paragraph fields never form: this walk is per paragraph.
 */
export function parsedFieldSpansOf(
  paragraph: OoxmlParagraphNode,
  options?: {
    readonly maxNesting?: number;
    readonly maxInstructionChars?: number;
    readonly fieldResults?: FieldResultsMode;
  }
): readonly ParsedFieldSpan[] {
  const fieldResults = options?.fieldResults ?? currentFieldResultsMode();
  const maxNesting = options?.maxNesting ?? MAX_FIELD_NESTING;
  const maxInstructionChars = options?.maxInstructionChars ?? MAX_FIELD_INSTRUCTION_CHARS;
  const spans: ParsedFieldSpan[] = [];

  // Flatten run children in document order for the complex-field machine.
  // Hyperlink is a run container: fields inside a link are ordinary paragraph text.
  const flat: FieldRunChildRef[] = [];
  /** Child `w:r` ids inside a `fldSimple` — those runs own displayed result formatting. */
  const formatRunIdsOfSimple = (simple: OoxmlNode): readonly string[] => {
    if (simple.kind === 'textValue') return [];
    const ids: string[] = [];
    const visit = (node: OoxmlNode): void => {
      if (node.kind === 'run') {
        ids.push(node.id);
        return;
      }
      if (node.kind === 'textValue') return;
      for (const child of node.children ?? []) visit(child);
    };
    for (const child of simple.children ?? []) visit(child);
    return ids;
  };

  /** A result holding another field keeps the simple field one unit, as for complex ones. */
  const simpleHoldsField = (simple: OoxmlNode): boolean => {
    if (simple.kind === 'textValue') return false;
    const visit = (node: OoxmlNode, depth: number): boolean =>
      node.kind !== 'textValue' &&
      depth < MAX_INLINE_CONTAINER_DEPTH &&
      (isFldSimple(node) ||
        isFldChar(node, 'begin') ||
        node.children.some((child) => visit(child, depth + 1)));
    return simple.children.some((child) => visit(child, 1));
  };
  /** Whether a simple field's result holds any text a caret could stand in. */
  const simpleHoldsText = (simple: OoxmlNode): boolean => {
    if (simple.kind === 'textValue') return false;
    const visit = (node: OoxmlNode, depth: number): boolean =>
      ((node.kind === 'text' || node.kind === 'deletedText') &&
        fieldResultInlineTextOf(node).length > 0) ||
      node.kind === 'tab' ||
      node.kind === 'hardBreak' ||
      (node.kind !== 'textValue' &&
        depth < MAX_INLINE_CONTAINER_DEPTH &&
        node.children.some((child) => visit(child, depth + 1)));
    return simple.children.some((child) => visit(child, 1));
  };
  collectFieldRunChildren(paragraph, flat);
  for (const entry of flat) {
    const child = entry.node;
    if (isFldSimple(child)) {
      spans.push({
        kind: 'simple',
        node: child,
        runId: '',
        removeNodeIds: [child.id],
        formatRunIds: formatRunIdsOfSimple(child),
        addressing:
          fieldResultAddressing(fldSimpleInstr(child) ?? '', {
            maxInstructionChars,
            nestedInResult: fieldResults === 'editable' && simpleHoldsField(child),
            emptyResult: fieldResults === 'editable' && !simpleHoldsText(child),
            fieldResults,
          }) === 'saved-result'
            ? 'saved-result'
            : 'atomic',
      });
    }
  }

  let i = 0;
  while (i < flat.length) {
    const current = flat[i]!;
    if (!isFldChar(current.node, 'begin')) {
      i += 1;
      continue;
    }

    // Scan forward for a matching outermost end; track nesting and instruction size.
    // LIVE (`w:instrText`) and DELETED (`w:delInstrText`) chunks buffer separately, with
    // per-buffer overflow: a tracked field-code edit puts both in one field, and the
    // EFFECTIVE instruction is the live text when any live element exists, else the deleted
    // text — the same rule layout's field machine applies, so addressing agrees with what
    // is painted.
    let nesting = 0;
    let nestingOverflow = false;
    let instructionChars = 0;
    let instruction = '';
    let instructionOverflow = false;
    let deletedChars = 0;
    let deletedInstruction = '';
    let deletedOverflow = false;
    let sawLiveInstruction = false;
    let phase: 'instruction' | 'result' | 'done' = 'instruction';
    const removeIds: string[] = [];
    const resultFormatRunIds: string[] = [];
    let resultHasText = false;
    const seenFormatRuns = new Set<string>();
    let separateRunId: string | undefined;
    let endIndex = -1;
    /** A field nested in the RESULT keeps the outer field one unit (see `fieldResultAddressing`). */
    let nestedInResult = false;

    for (let j = i; j < flat.length; j += 1) {
      const entry = flat[j]!;
      const node = entry.node;

      if (isFldChar(node, 'begin')) {
        if (nesting >= 1 && phase === 'result') nestedInResult = true;
        nesting += 1;
        if (nesting > maxNesting) nestingOverflow = true;
        removeIds.push(node.id);
        // ffData and other generic children stay under fldChar — listed via the parent id
        // removal (subtree). Do not execute or resolve them.
        continue;
      }

      if (isInstrText(node)) {
        if (nesting === 1 && phase === 'instruction') {
          const chunk = instrTextValue(node);
          if (isDeletedInstrText(node)) {
            deletedChars += chunk.length;
            if (deletedChars > maxInstructionChars) {
              deletedOverflow = true;
              deletedInstruction = '';
            } else if (!deletedOverflow) {
              deletedInstruction += chunk;
            }
          } else {
            // A live element counts even when empty: accepting the tracked deletion
            // leaves exactly that instruction.
            sawLiveInstruction = true;
            instructionChars += chunk.length;
            if (instructionChars > maxInstructionChars) {
              instructionOverflow = true;
              instruction = '';
            } else if (!instructionOverflow) {
              instruction += chunk;
            }
          }
        }
        if (nesting >= 1) removeIds.push(node.id);
        continue;
      }

      if (isFldChar(node, 'separate')) {
        if (nesting === 1 && phase === 'instruction') {
          phase = 'result';
          separateRunId = entry.runId;
        }
        if (nesting >= 1) removeIds.push(node.id);
        continue;
      }

      if (isFldChar(node, 'end')) {
        if (nesting >= 1) removeIds.push(node.id);
        nesting -= 1;
        if (nesting === 0) {
          phase = 'done';
          endIndex = j;
          break;
        }
        continue;
      }

      // Interior content: instruction-phase run content is chrome (skipped for addressing);
      // result-phase measurable content is part of the atomic unit (removed on delete).
      if (nesting >= 1) {
        if (phase === 'result') {
          // Include nested result content. Layout buffers nested results inside the outer
          // field and commits one atom only when the outer field ends. Only outer-result
          // runs own formatting, so `formatRunIds` remains gated on `nesting === 1` below.
          if (
            node.kind === 'text' ||
            // `w:delText` is result content that a tracked deletion struck — still the field's
            // own text, and still swallowed by the one offset the atom is worth. Leaving it out
            // let the paragraph count those characters a SECOND time as ordinary text while
            // layout folded them into the atom, so every offset after such a field was out by
            // the length of the deleted words.
            node.kind === 'deletedText' ||
            node.kind === 'tab' ||
            node.kind === 'hardBreak' ||
            node.kind === 'textValue'
          ) {
            removeIds.push(node.id);
            if (nesting === 1 && fieldResultInlineTextOf(node).length > 0) resultHasText = true;
            if (nesting === 1 && entry.runId && !seenFormatRuns.has(entry.runId)) {
              seenFormatRuns.add(entry.runId);
              resultFormatRunIds.push(entry.runId);
            }
          } else if (node.kind === 'generic') {
            // Non-text generic inside result stays with the field on delete.
            removeIds.push(node.id);
          }
        } else if (phase === 'instruction') {
          removeIds.push(node.id);
        }
      }
    }

    if (endIndex < 0 || nestingOverflow) {
      // Demote: missing end or hostile nesting — do not emit an atomic span.
      // The forward scan already exhausted the paragraph. Advancing one begin at a time
      // would rescan the same hostile suffix quadratically; fail closed for the suffix.
      break;
    }

    // Instruction overflow still yields an atomic unit (content stays one selectable
    // object); evaluation elsewhere fails closed — an overflowed buffer already cleared
    // itself to '', so the effective instruction resolves inert without another check.
    const effectiveInstruction = sawLiveInstruction ? instruction : deletedInstruction;

    // Empty result: format the separate run when present, else the begin run (matches
    // projection's style fallback when no result run donates `rPr`).
    const formatRunIds =
      resultFormatRunIds.length > 0
        ? resultFormatRunIds
        : separateRunId
          ? [separateRunId]
          : current.runId
            ? [current.runId]
            : [];

    spans.push({
      kind: 'complex',
      node: current.node,
      runId: current.runId,
      removeNodeIds: [...new Set(removeIds)],
      formatRunIds,
      addressing: fieldResultAddressing(effectiveInstruction, {
        maxInstructionChars,
        nestedInResult,
        // No outer result run holds text: the emptied field is one unit again.
        emptyResult: !resultHasText,
        fieldResults,
      }),
    });
    i = endIndex + 1;
  }

  return spans;
}

/** Collect only fields whose cached result is one atomic model unit. */
export function atomicFieldSpansOf(
  paragraph: OoxmlParagraphNode,
  options?: {
    readonly maxNesting?: number;
    readonly maxInstructionChars?: number;
    readonly fieldResults?: FieldResultsMode;
  }
): readonly AtomicFieldSpan[] {
  return parsedFieldSpansOf(paragraph, options).filter((span) => span.addressing === 'atomic');
}

/** Whether `fldCharType` is a legal ST_FldCharType value (used by tests / guards). */
export function isLegalFldCharType(value: string): boolean {
  return FLD_CHAR_TYPES.has(value);
}
