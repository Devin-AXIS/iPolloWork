// Bounded complex-field instruction recognition for PAGE / NUMPAGES / SECTIONPAGES.
//
// Field instructions are attacker-controlled and MUST NEVER execute. This module recognizes
// only exact normalized allowlisted `PAGE`, `NUMPAGES`, and `SECTIONPAGES` instructions with
// the numeric picture and number-format switches `field-page-switches.ts` accepts. Everything
// else stays inert. Legacy form-field payloads under `w:fldChar` (`w:ffData`, entry/exit
// macros) are never read or auto-resolved.
//
// Detection and piece projection share one bounded complex-field machine: no recursive walk
// over hostile OOXML, and node/depth/character budgets apply to instruction extraction.
// Callers reset state at paragraph boundaries so malformed cross-paragraph fields stay inert.

import {
  fldSimpleInstr,
  isFldChar as isFldCharHelper,
  isFldSimple,
  isInstrText as isInstrTextHelper,
  type OoxmlNode,
} from '@docx-editor.dev/core/store';
import {
  isDeletedInstrText,
  MAX_FIELD_INSTRUCTION_CHARS,
  MAX_FIELD_NESTING,
} from '../store/package/field-nodes.ts';
import {
  parsePageFieldInstruction,
  type PageFieldSwitches,
  type ParsedPageFieldInstruction,
} from './field-page-switches.ts';

/**
 * Caps hostile instruction blobs and nesting depth (fail closed → inert).
 *
 * The character cap is the store's `MAX_FIELD_INSTRUCTION_CHARS` — one source of truth, so
 * `parsedFieldSpansOf` addressing never diverges from what this machine buffers. It matches
 * the `w:fldSimple` lane (`MAX_HYPERLINK_INSTRUCTION_CHARS`): a long `HYPERLINK` URL parses
 * identically as a complex field and as a simple field.
 */
export { MAX_FIELD_INSTRUCTION_CHARS, MAX_FIELD_NESTING };

/**
 * Caps for furniture field-presence scans and paragraph projection walks. Attacker-controlled
 * OOXML can nest arbitrarily under `instrText`; every descendant counts against these budgets.
 * Exceeding any budget fails closed (no detect / no project).
 */
export const MAX_STORY_FIELD_SCAN_NODES = 4096;
export const MAX_STORY_FIELD_SCAN_DEPTH = 64;

export type AllowlistedPageField = 'PAGE' | 'NUMPAGES' | 'SECTIONPAGES';

/**
 * Which allowlisted page fields a header/footer story actually contains.
 *
 * Drives layout reuse: no fields → one baseline; NUMPAGES only → one layout per page count;
 * SECTIONPAGES only → one layout per section page count; PAGE (alone or combined) → per
 * distinct evaluated values with a bounded cache. Counts both complex markers and
 * `w:fldSimple` (including an allowlisted page field nested inside a non-page simple field).
 */
export interface StoryPageFieldNeeds {
  readonly hasPage: boolean;
  readonly hasNumPages: boolean;
  readonly hasSectionPages: boolean;
  /**
   * The story places something by the physical sheet's parity: a header frame aligned
   * `inside` or `outside`. Set by the header/footer layout, never by field detection. The
   * story then lays out once per sheet parity, with or without a page field.
   */
  readonly hasPageParity?: boolean;
}

export const NO_STORY_PAGE_FIELDS: StoryPageFieldNeeds = Object.freeze({
  hasPage: false,
  hasNumPages: false,
  hasSectionPages: false,
});

const MERGEFORMAT_SUFFIX = /\s*\\\*\s*MERGEFORMAT\s*$/i;

/**
 * Normalize a raw `instrText` blob for allowlist matching.
 *
 * Trims, collapses whitespace, uppercases, and strips a trailing inert `\* MERGEFORMAT`.
 * Returns null when the instruction exceeds the length cap (hostile / truncated → inert).
 */
export function normalizeFieldInstruction(raw: string): string | null {
  if (raw.length > MAX_FIELD_INSTRUCTION_CHARS) return null;
  const collapsed = raw.replace(/\s+/g, ' ').trim().toUpperCase();
  if (collapsed.length > MAX_FIELD_INSTRUCTION_CHARS) return null;
  return collapsed.replace(MERGEFORMAT_SUFFIX, '').trim();
}

/** An allowlisted page field with the switches that render its value. */
export interface AllowlistedPageFieldMatch extends PageFieldSwitches {
  readonly kind: AllowlistedPageField;
}

/**
 * Split one instruction into its keyword and its switches, in ONE read.
 *
 * Every question asked about a page-field instruction routes through here, so a
 * `fldChar separate` on the paragraph walk pays for one whitespace collapse and one bounded
 * scan rather than one of each per question. See `field-page-switches.ts` for the grammar.
 */
function splitPageFieldInstruction(raw: string): ParsedPageFieldInstruction | null {
  if (raw.length > MAX_FIELD_INSTRUCTION_CHARS) return null;
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (collapsed.length > MAX_FIELD_INSTRUCTION_CHARS) return null;
  return parsePageFieldInstruction(collapsed);
}

/**
 * The allowlisted kind and its switches, from ONE read of the instruction.
 *
 * The keyword has to match exactly. A `\#` picture and the `\*` number formats
 * (`Arabic`, `roman`, `alphabetic`, `ArabicDash`) only decide how the computed value is
 * rendered; `\* MERGEFORMAT` and `\* CHARFORMAT` are inert. Broader keywords (DATE, TOC,
 * INCLUDE*, DDE, …) remain unevaluated here on purpose, and so does every other switch —
 * `\n`, `\* Ordinal`, `\* Upper` and a stray word leave the field inert.
 */
export function matchAllowlistedPageField(instruction: string): AllowlistedPageFieldMatch | null {
  const split = splitPageFieldInstruction(instruction);
  if (split === null) return null;
  const { keyword, ...switches } = split;
  if (keyword !== 'PAGE' && keyword !== 'NUMPAGES' && keyword !== 'SECTIONPAGES') return null;
  return { kind: keyword, ...switches };
}

/** Exact allowlist for live page-field projection — {@link matchAllowlistedPageField}'s kind. */
export function allowlistedPageField(instruction: string): AllowlistedPageField | null {
  return matchAllowlistedPageField(instruction)?.kind ?? null;
}

export function isFldChar(node: OoxmlNode, type: 'begin' | 'separate' | 'end'): boolean {
  return isFldCharHelper(node, type);
}

export function isInstrText(node: OoxmlNode): boolean {
  return isInstrTextHelper(node);
}

/** Shared node/depth budget for detection and paragraph projection walks. */
export interface FieldScanBudget {
  nodes: number;
  exhausted: boolean;
}

export function createScanBudget(): FieldScanBudget {
  return { nodes: 0, exhausted: false };
}

export function consumeScanNode(budget: FieldScanBudget): boolean {
  if (budget.exhausted) return false;
  budget.nodes += 1;
  if (budget.nodes > MAX_STORY_FIELD_SCAN_NODES) {
    budget.exhausted = true;
    return false;
  }
  return true;
}

/**
 * Shared complex-field parse machine used by furniture detection and piece projection.
 *
 * State spans runs in document order within one paragraph (Word's normal split of
 * begin / instrText / separate / result / end). Callers reset at paragraph boundaries so
 * malformed cross-paragraph fields stay inert. Nested fields beyond {@link MAX_FIELD_NESTING}
 * and instructions past {@link MAX_FIELD_INSTRUCTION_CHARS} fail closed.
 *
 * `w:fldChar` children (including hostile `w:ffData` / macros) are never walked for
 * evaluation — only `@w:fldCharType` is read.
 */
type FieldParsePhase = 'idle' | 'instruction' | 'result';

/**
 * Instruction capture for one NESTED field level (2..{@link MAX_FIELD_NESTING}).
 *
 * LIVE (`w:instrText`) and DELETED (`w:delInstrText`) chunks buffer separately — see
 * {@link ComplexFieldParseState} for why concatenating them invents an instruction nobody
 * authored.
 */
interface NestedInstructionLevel {
  instruction: string;
  overflow: boolean;
  deletedInstruction: string;
  deletedOverflow: boolean;
  /** A live `instrText` element was seen — the live buffer answers, even when empty. */
  sawLive: boolean;
  separated: boolean;
}

export interface ComplexFieldParseState {
  nesting: number;
  /**
   * Level 1 (outermost) LIVE instruction buffer; levels 2+ live in
   * {@link ComplexFieldParseState.inner}.
   *
   * A tracked edit of a field code leaves `w:delInstrText` (the deleted chunks) NEXT TO
   * `w:instrText` (the live ones) in the same field. They buffer separately because
   * concatenating them produces an instruction nobody authored — ` PAGE  NUMPAGES ` from a
   * live NUMPAGES whose old PAGE code is still pending deletion — and that merged string
   * fails the allowlist, flips FORMTEXT addressing, and lets a large deleted chunk overflow
   * a small live instruction. The EFFECTIVE instruction is the live buffer whenever any live
   * element exists, else the deleted buffer (a fully-deleted field keeps evaluating, with
   * delete attribution). Overflow is accounted per buffer for the same reason.
   */
  instruction: string;
  instructionOverflow: boolean;
  /** Level 1 DELETED (`w:delInstrText`) buffer; answers only when no live element exists. */
  deletedInstruction: string;
  deletedInstructionOverflow: boolean;
  /** A live level-1 `instrText` element was seen — the live buffer answers, even when empty. */
  sawLiveInstruction: boolean;
  nestingOverflow: boolean;
  phase: FieldParsePhase;
  /** Level N (2..{@link MAX_FIELD_NESTING}) at index N-2; deeper levels are never captured. */
  inner: NestedInstructionLevel[];
}

export function createFieldParseState(): ComplexFieldParseState {
  return {
    nesting: 0,
    instruction: '',
    instructionOverflow: false,
    deletedInstruction: '',
    deletedInstructionOverflow: false,
    sawLiveInstruction: false,
    nestingOverflow: false,
    phase: 'idle',
    inner: [],
  };
}

export function resetFieldParseState(state: ComplexFieldParseState): void {
  state.nesting = 0;
  state.instruction = '';
  state.instructionOverflow = false;
  state.deletedInstruction = '';
  state.deletedInstructionOverflow = false;
  state.sawLiveInstruction = false;
  state.nestingOverflow = false;
  state.phase = 'idle';
  state.inner.length = 0;
}

/** The instruction that would take effect if the field's tracked edits were accepted. */
export interface EffectiveFieldInstruction {
  readonly instruction: string;
  readonly overflow: boolean;
}

/**
 * Resolve the level-1 EFFECTIVE instruction: the live buffer when any live `instrText`
 * element exists (even an empty one — accepting the deletion leaves exactly that), else the
 * deleted buffer, so a fully-deleted field keeps evaluating with delete attribution.
 */
export function effectiveFieldInstruction(
  state: ComplexFieldParseState
): EffectiveFieldInstruction {
  return state.sawLiveInstruction
    ? { instruction: state.instruction, overflow: state.instructionOverflow }
    : { instruction: state.deletedInstruction, overflow: state.deletedInstructionOverflow };
}

function effectiveLevelInstruction(level: NestedInstructionLevel): EffectiveFieldInstruction {
  return level.sawLive
    ? { instruction: level.instruction, overflow: level.overflow }
    : { instruction: level.deletedInstruction, overflow: level.deletedOverflow };
}

export function onFldCharBegin(state: ComplexFieldParseState): void {
  if (state.nesting === 0) {
    state.instruction = '';
    state.instructionOverflow = false;
    state.deletedInstruction = '';
    state.deletedInstructionOverflow = false;
    state.sawLiveInstruction = false;
    state.nestingOverflow = false;
    state.phase = 'instruction';
    state.inner.length = 0;
  }
  state.nesting += 1;
  if (state.nesting > MAX_FIELD_NESTING) {
    state.nestingOverflow = true;
  } else if (state.nesting >= 2) {
    // A sibling reopening this level replaces its capture, so one overflowed inner field
    // never poisons the well-formed inner field after it.
    state.inner[state.nesting - 2] = {
      instruction: '',
      overflow: false,
      deletedInstruction: '',
      deletedOverflow: false,
      sawLive: false,
      separated: false,
    };
  }
}

/** The capture for the innermost OPEN nested level, or null at level 1 / past the depth cap. */
function innerLevelOf(state: ComplexFieldParseState): NestedInstructionLevel | null {
  if (state.nesting < 2 || state.nesting > MAX_FIELD_NESTING) return null;
  return state.inner[state.nesting - 2] ?? null;
}

/** True when the innermost open level is still in its instruction phase at all. */
function levelAcceptsInstruction(state: ComplexFieldParseState): boolean {
  if (state.nesting === 1) return state.phase === 'instruction';
  const level = innerLevelOf(state);
  return level !== null && !level.separated;
}

/** True when the innermost open level still accepts text into the given buffer. */
function collectingLevelInstruction(state: ComplexFieldParseState, deleted: boolean): boolean {
  if (!levelAcceptsInstruction(state)) return false;
  if (state.nesting === 1) {
    return deleted ? !state.deletedInstructionOverflow : !state.instructionOverflow;
  }
  const level = innerLevelOf(state)!;
  return deleted ? !level.deletedOverflow : !level.overflow;
}

/** Note a live `instrText` ELEMENT so the live buffer answers, even when it stays empty. */
function markLiveInstructionSeen(state: ComplexFieldParseState): void {
  if (state.nesting === 1) {
    state.sawLiveInstruction = true;
    return;
  }
  const level = innerLevelOf(state);
  if (level) level.sawLive = true;
}

/** Mark ONE buffer of the innermost open level inert (its own character cap). */
function overflowLevelBuffer(state: ComplexFieldParseState, deleted: boolean): void {
  if (state.nesting === 1) {
    if (deleted) {
      state.deletedInstructionOverflow = true;
      state.deletedInstruction = '';
    } else {
      state.instructionOverflow = true;
      state.instruction = '';
    }
    return;
  }
  const level = innerLevelOf(state);
  if (!level) return;
  if (deleted) {
    level.deletedOverflow = true;
    level.deletedInstruction = '';
  } else {
    level.overflow = true;
    level.instruction = '';
  }
}

/**
 * Mark the innermost open level's instruction inert entirely (budget / depth miss).
 *
 * Both buffers fail closed together: a scan that ran out of budget cannot say which chunks
 * it never saw, so neither buffer may claim to be complete.
 */
function overflowLevelInstruction(state: ComplexFieldParseState): void {
  overflowLevelBuffer(state, false);
  overflowLevelBuffer(state, true);
}

export function onInstrText(state: ComplexFieldParseState, chunk: string, deleted = false): void {
  if (!collectingLevelInstruction(state, deleted)) return;
  const level = innerLevelOf(state);
  if (!deleted) markLiveInstructionSeen(state);
  const buffer = level
    ? deleted
      ? level.deletedInstruction
      : level.instruction
    : deleted
      ? state.deletedInstruction
      : state.instruction;
  if (buffer.length + chunk.length > MAX_FIELD_INSTRUCTION_CHARS) {
    // Per-buffer accounting: a huge deleted chunk must not overflow a small live
    // instruction sitting next to it, and vice versa.
    overflowLevelBuffer(state, deleted);
    return;
  }
  if (level) {
    if (deleted) level.deletedInstruction = buffer + chunk;
    else level.instruction = buffer + chunk;
  } else if (deleted) {
    state.deletedInstruction = buffer + chunk;
  } else {
    state.instruction = buffer + chunk;
  }
}

/**
 * Iteratively extract `instrText` descendants into the field instruction buffer.
 *
 * Every descendant counts against the shared node budget; depth is absolute from the story
 * or paragraph root. No recursive traversal — hostile wide/deep trees cannot bypass caps.
 * Any budget miss marks the instruction inert (`instructionOverflow`).
 */
export function ingestInstrTextBounded(
  state: ComplexFieldParseState,
  instrNode: OoxmlNode,
  budget: FieldScanBudget,
  instrDepth: number
): void {
  if (!levelAcceptsInstruction(state)) {
    // Still charge the instrText node itself when the caller has not already.
    return;
  }
  // One element is entirely live or entirely deleted — `w:delInstrText` is what a tracked
  // deletion rewrites `w:instrText` into. A live element counts as a live instruction even
  // when it holds no text: accepting the tracked deletion leaves exactly that.
  const deleted = isDeletedInstrText(instrNode);
  if (!deleted) markLiveInstructionSeen(state);
  if (!collectingLevelInstruction(state, deleted)) return;
  if (instrDepth > MAX_STORY_FIELD_SCAN_DEPTH) {
    overflowLevelInstruction(state);
    return;
  }

  // Explicit stack walk: [node, depth] pairs. The instrText element was already consumed by
  // the caller; only descendants are pushed.
  const stack: { node: OoxmlNode; depth: number }[] = [];
  const children = instrNode.kind === 'textValue' ? [] : (instrNode.children ?? []);
  for (let i = children.length - 1; i >= 0; i -= 1) {
    stack.push({ node: children[i]!, depth: instrDepth + 1 });
  }

  while (stack.length > 0) {
    const frame = stack.pop()!;
    if (!consumeScanNode(budget)) {
      overflowLevelInstruction(state);
      return;
    }
    if (frame.depth > MAX_STORY_FIELD_SCAN_DEPTH) {
      overflowLevelInstruction(state);
      return;
    }
    if (frame.node.kind === 'textValue') {
      onInstrText(state, frame.node.value, deleted);
      if (!collectingLevelInstruction(state, deleted)) return;
      continue;
    }
    const grandChildren = frame.node.children ?? [];
    for (let i = grandChildren.length - 1; i >= 0; i -= 1) {
      stack.push({ node: grandChildren[i]!, depth: frame.depth + 1 });
    }
  }
}

/**
 * Advance past `fldChar separate`. Returns an allowlisted kind when the separated field's
 * instruction is evaluable; otherwise null (inert / overflow / nested too deep).
 *
 * At level 1 this also moves the machine into the result phase. At levels 2..
 * {@link MAX_FIELD_NESTING} the outer phase is untouched: the level's own capture answers, so
 * a PAGE nested inside another field's cached result is recognized instead of staying inert.
 * Deeper levels and levels whose own instruction overflowed stay null (fail closed).
 */
export function onFldCharSeparate(state: ComplexFieldParseState): AllowlistedPageFieldMatch | null {
  if (state.nesting === 1) {
    if (state.phase !== 'instruction') return null;
    state.phase = 'result';
    if (state.nestingOverflow) return null;
    const effective = effectiveFieldInstruction(state);
    if (effective.overflow) return null;
    return matchAllowlistedPageField(effective.instruction);
  }
  const level = innerLevelOf(state);
  if (!level || level.separated) return null;
  level.separated = true;
  const effective = effectiveLevelInstruction(level);
  if (effective.overflow) return null;
  return matchAllowlistedPageField(effective.instruction);
}

export function onFldCharEnd(state: ComplexFieldParseState): void {
  if (state.nesting > 0) state.nesting -= 1;
  if (state.nesting === 0) resetFieldParseState(state);
}

/** True while inside an outermost field result that was live-projected. */
export function isInsideFieldResult(state: ComplexFieldParseState): boolean {
  return state.phase === 'result' && state.nesting >= 1;
}

/**
 * Bounded scan for allowlisted page fields in a header/footer part.
 *
 * Walks the part tree with node/depth caps. Field state spans runs in document order within
 * each paragraph — the same machine paragraph projection uses — and resets at paragraph
 * boundaries so malformed cross-paragraph fields never count. Allowlisted `w:fldSimple`
 * instructions count too, and a non-page simple field is still descended so a nested complex
 * PAGE inside it is not missed. A complex PAGE nested inside another complex field's RESULT
 * counts the same way: `onFldCharSeparate` answers per level, and the separate branch below
 * notes it when projection can replace it (outer result phase, within the nesting cap).
 * Instruction text is extracted iteratively under the same node/depth/character budgets.
 */
export function detectStoryPageFields(root: OoxmlNode): StoryPageFieldNeeds {
  let hasPage = false;
  let hasNumPages = false;
  let hasSectionPages = false;
  const budget = createScanBudget();
  const field = createFieldParseState();

  const complete = (): boolean => hasPage && hasNumPages && hasSectionPages;

  const note = (kind: AllowlistedPageField): void => {
    if (kind === 'PAGE') hasPage = true;
    else if (kind === 'NUMPAGES') hasNumPages = true;
    else hasSectionPages = true;
  };

  // Once a paragraph shows hostile nesting, the atomic-span parser fails closed for the
  // REST of that paragraph (`parsedFieldSpansOf` refuses the suffix rather than rescanning
  // it quadratically), so projection paints every later field there verbatim. Detection must
  // agree for the same suffix, or a footer with one hostile field pays a per-sheet layout
  // that paints identical text on every page. Cleared at paragraph boundaries.
  let paragraphPoisoned = false;

  // Notes are provisional until the OUTER span closes cleanly. A note fires at separate-time,
  // but a LATER nesting overflow in the same span demotes the whole store span (the parser
  // above breaks for the suffix), so projection paints the noted field's cached digits
  // verbatim — a note that stood would buy a per-sheet relayout of identical text. Level-1
  // notes buffer the same way: the overflow demotes the level-1 span too. Flushed at the
  // outer end when the paragraph was not poisoned; dropped otherwise.
  let pendingNotes: AllowlistedPageField[] = [];

  const processFieldChild = (grand: OoxmlNode, depth: number): void => {
    if (grand.kind === 'runProperties') return;

    if (isFldChar(grand, 'begin')) {
      onFldCharBegin(field);
      if (field.nestingOverflow) paragraphPoisoned = true;
      return;
    }

    if (isInstrText(grand)) {
      ingestInstrTextBounded(field, grand, budget, depth);
      return;
    }

    if (isFldChar(grand, 'separate')) {
      const level = field.nesting;
      const phase = field.phase;
      const match = onFldCharSeparate(field);
      if (paragraphPoisoned) return;
      // Note only what projection can actually replace. A top-level (level-1) field always
      // projects. A NESTED field projects only out of the outer field's RESULT: a page field
      // inside an outer INSTRUCTION (`IF { PAGE } = 1 "x"`) is never painted at all, and a
      // field past the nesting cap demotes to verbatim text — noting either buys a per-sheet
      // relayout that paints identical text on every page.
      if (match && (level <= 1 || phase === 'result')) pendingNotes.push(match.kind);
      return;
    }

    if (isFldChar(grand, 'end')) {
      onFldCharEnd(field);
      if (field.nesting === 0) {
        if (!paragraphPoisoned) for (const kind of pendingNotes) note(kind);
        pendingNotes.length = 0;
      }
    }
  };

  const scanRun = (run: OoxmlNode, depth: number): void => {
    if (run.kind !== 'run') return;
    for (const grand of run.children) {
      if (!consumeScanNode(budget)) return;
      processFieldChild(grand, depth + 1);
      // A drawing (or its MC wrapper) inside the run can carry a textbox story whose
      // paragraphs hold their own PAGE-family fields. Descend with the host field state
      // saved, so the nested story's paragraph resets cannot break a field that spans
      // sibling runs around the drawing.
      if (
        (grand.kind === 'drawing' || grand.kind === 'generic') &&
        !isInstrText(grand) &&
        'children' in grand &&
        grand.children.length > 0
      ) {
        // Deep-copy the per-level captures: a shallow copy aliases the `inner` array and its
        // level objects, so the nested story's paragraph resets would empty the saved capture
        // too and a level-2 field straddling the drawing would lose its instruction. Level-1
        // fields are strings/booleans — the spread copies those by value.
        const saved: ComplexFieldParseState = {
          ...field,
          inner: field.inner.map((level) => ({ ...level })),
        };
        const savedPoison = paragraphPoisoned;
        const savedPending = pendingNotes;
        pendingNotes = [];
        walk(grand, depth + 1);
        Object.assign(field, saved);
        paragraphPoisoned = savedPoison;
        pendingNotes = savedPending;
      }
      if (complete() || budget.exhausted) return;
    }
  };

  const walk = (node: OoxmlNode, depth: number): void => {
    if (complete()) return;
    if (!consumeScanNode(budget)) return;
    if (depth > MAX_STORY_FIELD_SCAN_DEPTH) return;
    if (node.kind === 'textValue') return;

    // Paragraph boundary: Word complex fields do not legally span paragraphs. Reset so a
    // begin in one paragraph cannot pair with separate/end in another.
    if (node.kind === 'paragraph') {
      resetFieldParseState(field);
      paragraphPoisoned = false;
      // A span still open at a paragraph boundary is malformed and never projects; its
      // buffered notes drop with it.
      pendingNotes.length = 0;
      for (const child of node.children) {
        walk(child, depth + 1);
        if (complete()) return;
        if (budget.exhausted) return;
      }
      resetFieldParseState(field);
      paragraphPoisoned = false;
      pendingNotes.length = 0;
      return;
    }

    if (node.kind === 'run') {
      // Shared field state across sibling runs (and nested run containers) in this paragraph.
      scanRun(node, depth);
      return;
    }

    // `w:fldSimple` carries its instruction in an ATTRIBUTE, so none of the marker machine
    // above ever sees it. It was ignored while simple fields painted nothing — harmless then,
    // because the sheet showed a blank either way. Now that the cached result paints, ignoring
    // it is worse than the blank was: the story's page-context key stays empty, one layout is
    // reused for every sheet, and a footer `PAGE` shows page one's number on every page.
    // A wrong number is not a smaller error than a missing one, it is a quieter one.
    if (isFldSimple(node)) {
      const kind = allowlistedPageField(fldSimpleInstr(node) ?? '');
      if (kind) {
        note(kind);
        return;
      }
      // NOT a page field — fall through and keep walking. A simple field's cached result can
      // hold a complex one (`STYLEREF` wrapping a `PAGE` is ordinary in a running header), and
      // returning here hid it: the story reported no page fields, its context token stayed
      // empty, one layout served every sheet, and the number inside showed page one everywhere.
      // Exactly the failure this arm was added to prevent, one level down.
    }

    for (const child of node.children) {
      walk(child, depth + 1);
      if (complete()) return;
      if (budget.exhausted) return;
    }
  };

  walk(root, 0);
  if (!hasPage && !hasNumPages && !hasSectionPages) return NO_STORY_PAGE_FIELDS;
  return { hasPage, hasNumPages, hasSectionPages };
}
