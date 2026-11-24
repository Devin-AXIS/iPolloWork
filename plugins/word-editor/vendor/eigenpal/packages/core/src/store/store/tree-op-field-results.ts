import { applySetLegacyDropdown } from './legacy-dropdown-fields.ts';
import { validLocale } from './text-form-date-locale.ts';
import {
  validTextFormOptions,
  formatTextFormValue,
  formatTextFormDefault,
  textFormInputLength,
} from './text-form-field-options.ts';
import { splitsSurrogate } from './tree-op-segments.ts';
import { namedOwnerRefusal } from './tree-op-validate.ts';
import type { TextFormFieldRange } from './text-form-fields.ts';
import { textFormFieldsOf, textFormFieldForEdit } from './text-form-fields.ts';
import { applySetLegacyCheckbox } from './legacy-checkbox-fields.ts';
// Field-result refresh TreeDocOp — rewrite a field's cached RESULT runs in place.
//
// The op carries the paragraph, the field anchor (the run holding the `begin` fldChar, or
// the `w:fldSimple` element) and the new result text; the INSTRUCTION is never modified.
// The rewrite is fail-closed per field: it re-locates the anchor at apply time and touches
// only a result made of plain runs (`w:rPr` / `w:t` / `w:tab`). A result carrying revision
// markup, nested fields, bookmarks or any other structure is left exactly as it was — a
// stale cached value is recoverable in Word; a corrupted revision is not.

import {
  fieldOnOffAttribute,
  fldSimpleInstr,
  instrTextValue,
  isFldChar,
  isFldSimple,
  isInstrText,
} from '../package/field-nodes.ts';
import {
  createNodeIdAllocator,
  findNode,
  replaceChildren,
  replaceNode,
  type EditOptions,
} from '../package/ooxml-edit.ts';
import {
  MAX_INLINE_CONTAINER_DEPTH,
  nextInlineContainerDepth,
  WML_NAMESPACE_URI,
} from '../package/ooxml-shared.ts';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { isValidXmlText } from '../package/sinks.ts';
import { hardBreakKind } from '../package/hard-break.ts';
import { withFreshIds } from '../package/hf-lifecycle-shell.ts';
import { simpleElement } from './tree-op-inline-elements.ts';
import { effectiveContentLockAt, isBoundAt, ok, parentOf } from './tree-op-nodes.ts';
import type { TreeDocOp, TreeOpRejection, TreeOpResult } from './tree-op-types.ts';

export type RefreshFieldResultsOp = Extract<TreeDocOp, { op: 'refreshFieldResults' }>;

/** Ceiling on updates per op — mirrors the layout-side cap on live-resolved fields. */
export const MAX_FIELD_RESULT_UPDATES = 512;
/** Length cap on one rewritten result — a computed value must not inflate the tree. */
export const MAX_FIELD_RESULT_TEXT_CHARS = 2048;
/** Node budget for one paragraph's locate walk (hostile fan-out fails closed to "not found"). */
const MAX_LOCATE_NODES = 4096;
const MAX_LOCATE_DEPTH = 16;

/**
 * One field whose cached result the refresh op can address, as the planner sees it.
 *
 * `rewritable` is the whole plainness contract: the field is unlocked (`w:fldLock`), its
 * boundaries sit under one parent, and the result region is plain runs only, at least one.
 * The planner never emits an update for a non-rewritable field, and the applier re-checks,
 * so a hand-crafted op degrades to a skip rather than a structural rewrite.
 */
export interface LocatedFieldResult {
  /**
   * The field's begin `w:fldChar` node, or the `w:fldSimple` element itself — the SAME key
   * the layout's calibration registry uses, so a planner can pair a located result with the
   * field's live-vs-cached verdict without a second identity vocabulary.
   */
  readonly fieldNodeId: string;
  /** Raw instruction text (concatenated `w:instrText`, or `@w:instr`). Never executed. */
  readonly instruction: string;
  /** The cached result's text (`w:t` values, `w:tab` as `\t`) — `''` when not rewritable. */
  readonly cachedText: string;
  readonly rewritable: boolean;
}

/** @internal A located field with the node ids a result rewrite needs. */
export interface LocatedField extends LocatedFieldResult {
  /** Whether the result could be rewritten if no pending insertion held the field. */
  readonly resultWritable?: boolean;
  /** Element whose child list holds the field (paragraph, hyperlink, …) or the fldSimple. */
  readonly containerId: string;
  /** Result runs in order; the first receives the new text, the rest lose theirs. */
  readonly resultRunIds: readonly string[];
  readonly emptyResultEndRunId?: string;
  readonly needsSeparator?: boolean;
}

interface LocateBudget {
  nodes: number;
}

function isElement(node: OoxmlNode): node is OoxmlElement {
  return node.kind !== 'textValue';
}

/** Text of one plain result run: `w:t` values, `w:tab` as `\t`, line breaks as `\n`. */
function plainRunText(run: OoxmlElement): string {
  let text = '';
  for (const child of run.children) {
    if (child.kind === 'text') {
      for (const value of child.children) {
        if (value.kind === 'textValue') text += value.value;
      }
    } else if (child.kind === 'tab') {
      text += '\t';
    } else if (child.kind === 'hardBreak') {
      text += '\n';
    }
  }
  return text;
}

/**
 * Whether a run is PLAIN — only `w:rPr`, `w:t` and `w:tab` children, and an `w:rPr` free of
 * `w:rPrChange` (a tracked formatting change is revision markup the rewrite must not touch).
 * A computed refresh also admits line breaks, which it writes back as `w:br`; a form edit
 * does not.
 */
function isPlainResultRun(node: OoxmlNode, lineBreaks: boolean): node is OoxmlElement {
  if (node.kind !== 'run') return false;
  for (const child of node.children) {
    if (child.kind === 'runProperties') {
      const properties: readonly OoxmlNode[] = child.children;
      for (const property of properties) {
        if (property.kind !== 'textValue' && property.localName === 'rPrChange') return false;
      }
      continue;
    }
    if (child.kind === 'text') {
      if (child.children.some((value) => value.kind !== 'textValue')) return false;
      continue;
    }
    if (child.kind === 'tab') continue;
    if (lineBreaks && child.kind === 'hardBreak' && hardBreakKind(child) === 'line') continue;
    return false;
  }
  return true;
}

/** Whether a run holds exactly one field boundary (`w:fldChar`) beside its `w:rPr`. */
function isBoundaryOnlyRun(run: OoxmlElement, type: 'separate' | 'end'): boolean {
  let sawBoundary = false;
  for (const child of run.children) {
    if (child.kind === 'runProperties') continue;
    if (isFldChar(child, type) && !sawBoundary) {
      sawBoundary = true;
      continue;
    }
    return false;
  }
  return sawBoundary;
}

/**
 * Consume one complex field starting at `children[beginIndex]` (a run whose children include
 * the `begin` fldChar). Returns the located field, or null when the field does not close
 * inside this child list — nested fields, boundaries split across containers, and anything
 * else outside the plain shape either fail the locate or mark the field non-rewritable.
 */
function consumeComplexField(
  containerId: string,
  children: readonly OoxmlNode[],
  beginIndex: number,
  budget: LocateBudget,
  allowInstructionBookmarks = false
): { field: LocatedField | null; nextIndex: number } {
  const beginRun = children[beginIndex] as OoxmlElement;
  let anchorId: string | null = null;
  let instruction = '';
  let locked = false;
  let plain = true;
  let phase: 'instruction' | 'result' = 'instruction';
  const resultRunIds: string[] = [];
  let cachedText = '';

  // The begin run itself: instruction text may share the run with the `begin` marker.
  for (const child of beginRun.children) {
    if (isFldChar(child, 'begin')) {
      if (anchorId !== null) return { field: null, nextIndex: beginIndex + 1 };
      anchorId = child.id;
      if (fieldOnOffAttribute(child, 'fldLock') === true) locked = true;
      continue;
    }
    if (child.kind === 'runProperties') continue;
    if (isInstrText(child)) {
      instruction += instrTextValue(child);
      continue;
    }
    // A second `begin` (nested field) or any other content makes the shape unsupported.
    return { field: null, nextIndex: beginIndex + 1 };
  }

  for (let index = beginIndex + 1; index < children.length; index += 1) {
    budget.nodes -= 1;
    if (budget.nodes <= 0) return { field: null, nextIndex: children.length };
    const node = children[index]!;
    // Word's legacy forms place the named bookmark before their instruction.
    // Keep it in place; it is outside the rewritten result. Computed refresh stays strict.
    if (
      allowInstructionBookmarks &&
      phase === 'instruction' &&
      (node.kind === 'bookmarkStart' || node.kind === 'bookmarkEnd')
    )
      continue;
    // Only sibling RUNS are understood; a hyperlink, bookmark, SDT or revision wrapper
    // inside the field means the boundaries cannot be tracked here — fail the locate.
    if (node.kind !== 'run') return { field: null, nextIndex: index + 1 };
    if (node.children.some((child) => isFldChar(child, 'begin'))) {
      // A nested field anywhere within this one is out of scope for the rewrite.
      return { field: null, nextIndex: index + 1 };
    }
    if (node.children.some((child) => isFldChar(child, 'end'))) {
      if (!isBoundaryOnlyRun(node, 'end')) plain = false;
      if (anchorId === null) return { field: null, nextIndex: index + 1 };
      const rewritable =
        plain &&
        !locked &&
        (phase === 'result' ||
          (allowInstructionBookmarks && instruction.trim().toUpperCase() === 'FORMDROPDOWN')) &&
        (resultRunIds.length > 0 || allowInstructionBookmarks);
      return {
        field: {
          fieldNodeId: anchorId,
          instruction,
          cachedText: rewritable ? cachedText : '',
          rewritable,
          containerId,
          resultRunIds,
          ...(phase === 'instruction' ? { needsSeparator: true } : {}),
          ...(resultRunIds.length === 0 ? { emptyResultEndRunId: node.id } : {}),
        },
        nextIndex: index + 1,
      };
    }
    if (node.children.some((child) => isFldChar(child, 'separate'))) {
      if (phase !== 'instruction' || !isBoundaryOnlyRun(node, 'separate')) plain = false;
      phase = 'result';
      continue;
    }
    if (phase === 'instruction') {
      for (const child of node.children) {
        if (child.kind === 'runProperties') continue;
        if (isInstrText(child)) instruction += instrTextValue(child);
        else plain = false;
      }
      continue;
    }
    if (!isPlainResultRun(node, !allowInstructionBookmarks)) {
      plain = false;
      continue;
    }
    resultRunIds.push(node.id);
    cachedText += plainRunText(node);
  }
  // The field never closed in this child list.
  return { field: null, nextIndex: children.length };
}

/** A `w:fldSimple`: the element is both anchor and result container. */
function locateSimpleField(node: OoxmlElement): LocatedField {
  const instruction = fldSimpleInstr(node) ?? '';
  const locked = fieldOnOffAttribute(node, 'fldLock') === true;
  let plain = true;
  const resultRunIds: string[] = [];
  let cachedText = '';
  for (const child of node.children) {
    if (!isPlainResultRun(child, true)) {
      plain = false;
      continue;
    }
    resultRunIds.push(child.id);
    cachedText += plainRunText(child);
  }
  const rewritable = plain && !locked && resultRunIds.length > 0;
  return {
    fieldNodeId: node.id,
    instruction,
    cachedText: rewritable ? cachedText : '',
    rewritable,
    containerId: node.id,
    resultRunIds,
  };
}

function isDrawingContainer(node: OoxmlElement): boolean {
  return node.kind === 'drawing' || node.localName === 'drawing' || node.localName === 'pict';
}

/** A field under `w:ins` / `w:del` is revision content; the refresh leaves it untouched. */
function isRevisionContainer(node: OoxmlElement): boolean {
  return node.localName === 'ins' || node.localName === 'del';
}

function locateFieldsInContainer(
  container: OoxmlElement,
  depth: number,
  budget: LocateBudget,
  out: LocatedField[],
  allowInstructionBookmarks = false,
  insertions: 'skip' | 'enter' | 'inside' = 'skip'
): void {
  if (allowInstructionBookmarks ? depth >= MAX_INLINE_CONTAINER_DEPTH : depth > MAX_LOCATE_DEPTH)
    return;
  const children = container.children;
  // A field inside a pending insertion is read, never refreshed: its result belongs to the
  // proposal, so a rewrite would change what a reviewer accepts or rejects.
  const found = (field: LocatedField): LocatedField =>
    insertions === 'inside'
      ? { ...field, rewritable: false, resultWritable: field.rewritable }
      : field;
  let index = 0;
  while (index < children.length) {
    budget.nodes -= 1;
    if (budget.nodes <= 0) return;
    const node = children[index]!;
    if (!isElement(node)) {
      index += 1;
      continue;
    }
    if (isFldSimple(node)) {
      // The OUTER field only — content nested in a cached result is never live-refreshed.
      out.push(found(locateSimpleField(node)));
      index += 1;
      continue;
    }
    if (node.kind === 'run') {
      if (node.children.some((child) => isFldChar(child, 'begin'))) {
        const consumed = consumeComplexField(
          container.id,
          children,
          index,
          budget,
          allowInstructionBookmarks
        );
        if (consumed.field) out.push(found(consumed.field));
        index = consumed.nextIndex;
        continue;
      }
      index += 1;
      continue;
    }
    const insertion = insertions !== 'skip' && node.localName === 'ins';
    if (!isDrawingContainer(node) && (!isRevisionContainer(node) || insertion)) {
      locateFieldsInContainer(
        node,
        allowInstructionBookmarks ? nextInlineContainerDepth(node, depth) : depth + 1,
        budget,
        out,
        allowInstructionBookmarks,
        insertion ? 'inside' : insertions
      );
    }
    index += 1;
  }
}

/**
 * The fields inside one paragraph whose cached results this op could address, in document
 * order. Bounded walk; a paragraph past the budget answers what it found so far. With
 * `pendingInsertions`, fields inside a `w:ins` are listed too, as not rewritable.
 */
export function locateFieldResults(
  paragraph: OoxmlElement,
  allowInstructionBookmarks = false,
  pendingInsertions = false
): readonly LocatedFieldResult[] {
  return locatePlainFields(paragraph, allowInstructionBookmarks, pendingInsertions);
}

function locatePlainFields(
  paragraph: OoxmlElement,
  allowInstructionBookmarks = false,
  pendingInsertions = false
): LocatedField[] {
  const out: LocatedField[] = [];
  locateFieldsInContainer(
    paragraph,
    0,
    { nodes: MAX_LOCATE_NODES },
    out,
    allowInstructionBookmarks,
    pendingInsertions ? 'enter' : 'skip'
  );
  return out;
}

/**
 * One field of a paragraph, by its anchor id, for a cached-result write by the editing API.
 *
 * The form-field locate rules apply: an empty result is writable (the write mints the result
 * run before `end`), and a result holding a line break is not. Fields inside a pending
 * insertion are found too; `resultWritable` then says whether the result itself could take
 * the write.
 */
export function locateFieldForResultWrite(
  paragraph: OoxmlElement,
  fieldNodeId: string
): LocatedField | null {
  const located: LocatedField[] = [];
  locateFieldsInContainer(paragraph, 0, { nodes: MAX_LOCATE_NODES }, located, true, 'enter');
  return located.find((entry) => entry.fieldNodeId === fieldNodeId) ?? null;
}

/**
 * Why a paragraph's field results may not be rewritten, or null when they may.
 *
 * ONE statement of the content-control rules, shared by validation below and by the
 * save-time PLANNER: validation rejects the WHOLE op (all-or-nothing is the transaction
 * contract), so the planner must exclude these paragraphs up front or one locked field
 * would silently starve every other stale field in the part.
 */
export function fieldResultUpdateRefusal(
  part: OoxmlPart,
  paragraphId: string
): 'bound' | 'locked' | null {
  if (isBoundAt(part, paragraphId)) return 'bound';
  if (effectiveContentLockAt(part, paragraphId).content) return 'locked';
  return null;
}

export function validateRefreshFieldResults(
  part: OoxmlPart,
  op: RefreshFieldResultsOp
): TreeOpRejection | null {
  if (!Array.isArray(op.updates) || op.updates.length > MAX_FIELD_RESULT_UPDATES) {
    return 'invalidArgs';
  }
  for (const update of op.updates) {
    if (
      typeof update.paragraphId !== 'string' ||
      update.paragraphId.length === 0 ||
      typeof update.fieldNodeId !== 'string' ||
      update.fieldNodeId.length === 0 ||
      typeof update.text !== 'string' ||
      update.text.length > MAX_FIELD_RESULT_TEXT_CHARS ||
      !isValidXmlText(update.text) ||
      // The rewrite expresses a tab as `w:tab` and a newline as `w:br`; a carriage return
      // has no single form, so it is refused.
      update.text.includes('\r')
    ) {
      return 'invalidArgs';
    }
    const paragraph = findNode(part, update.paragraphId);
    if (!paragraph || paragraph.kind !== 'paragraph') return 'unknown-paragraph';
    const refusal = fieldResultUpdateRefusal(part, update.paragraphId);
    if (refusal) return refusal;
  }
  return null;
}

/** Fresh `w:t` / `w:tab` / `w:br` children for one rewritten result run. */
function resultRunContent(text: string, mint: () => string): OoxmlNode[] {
  const content: OoxmlNode[] = [];
  // Bounded by the op's text length cap; a capturing split keeps each separator.
  for (const piece of text.split(/([\t\n])/)) {
    if (piece === '\t') content.push(simpleElement(mint, 'tab'));
    else if (piece === '\n') content.push(simpleElement(mint, 'br'));
    else if (piece.length > 0) {
      content.push({
        id: mint(),
        kind: 'text',
        namespaceUri: WML_NAMESPACE_URI,
        localName: 't',
        prefix: 'w',
        namespaceBindings: [],
        // `xml:space` is not set here: the serializer owns lexical form and adds
        // `preserve` when boundary whitespace requires it.
        attributes: [],
        children: [{ id: mint(), kind: 'textValue', value: piece }],
      } as unknown as OoxmlNode);
    }
  }
  return content;
}

/**
 * Rewrite one located field's result inside an immutable paragraph rebuild: the first
 * result run keeps its `w:rPr` and receives the new text; surplus result runs keep their
 * `w:rPr` and lose their `w:t` / `w:tab` children. Nothing else in the paragraph moves.
 */
export function rewriteFieldResult(
  paragraph: OoxmlElement,
  field: LocatedField,
  text: string,
  mint: () => string
): OoxmlElement {
  const firstRunId = field.resultRunIds[0]!;
  const surplus = new Set(field.resultRunIds.slice(1));
  const rewrite = (node: OoxmlNode): OoxmlNode => {
    if (node.kind === 'textValue') return node;
    if (node.id === firstRunId || surplus.has(node.id)) {
      const properties = node.children.filter((child) => child.kind === 'runProperties');
      const content = node.id === firstRunId ? resultRunContent(text, mint) : [];
      return { ...node, children: [...properties, ...content] } as OoxmlNode;
    }
    const children = node.children.flatMap((child) => {
      if (child.id === field.emptyResultEndRunId && child.kind === 'run') {
        const separator: OoxmlNode[] = field.needsSeparator
          ? [
              {
                ...child,
                id: mint(),
                children: [
                  {
                    id: mint(),
                    kind: 'fldChar',
                    namespaceUri: WML_NAMESPACE_URI,
                    prefix: 'w',
                    localName: 'fldChar',
                    namespaceBindings: [],
                    attributes: [
                      {
                        kind: 'genericExtension',
                        namespaceUri: WML_NAMESPACE_URI,
                        prefix: 'w',
                        localName: 'fldCharType',
                        value: 'separate',
                      },
                    ],
                    children: [],
                  },
                ],
              } as OoxmlNode,
            ]
          : [];
        // The minted result run keeps the end run's formatting, so the result shows in the
        // face the field's own runs carry.
        const properties = child.children
          .filter((entry) => entry.kind === 'runProperties')
          .map((entry) => withFreshIds(entry, mint));
        return [
          ...separator,
          {
            ...child,
            id: mint(),
            children: [...properties, ...resultRunContent(text, mint)],
          } as OoxmlNode,
          child,
        ];
      }
      return [rewrite(child)];
    });
    return children.some((child, index) => child !== node.children[index])
      ? ({ ...node, children } as OoxmlNode)
      : node;
  };
  return rewrite(paragraph) as OoxmlElement;
}

/**
 * Apply the refresh: every update re-locates its field in the CURRENT paragraph and skips —
 * without failing the op — when the field is gone, not rewritable, or already carries the
 * text. An op whose every update skips commits no change (`dirty` empty, same part).
 */
export function applyRefreshFieldResults(
  part: OoxmlPart,
  op: RefreshFieldResultsOp,
  options?: EditOptions
): TreeOpResult {
  return applyFieldResults(part, op, options);
}

export function applyFieldResults(
  part: OoxmlPart,
  op: RefreshFieldResultsOp,
  options?: EditOptions,
  allowInstructionBookmarks = false
): TreeOpResult {
  let current = part;
  const dirty: string[] = [];
  for (const update of op.updates) {
    const paragraph = findNode(current, update.paragraphId);
    if (!paragraph || paragraph.kind !== 'paragraph') continue;
    const located: LocatedField[] = [];
    locateFieldsInContainer(
      paragraph,
      0,
      { nodes: MAX_LOCATE_NODES },
      located,
      allowInstructionBookmarks
    );
    const field = located.find((entry) => entry.fieldNodeId === update.fieldNodeId);
    if (!field || !field.rewritable || field.cachedText === update.text) continue;
    const mint = createNodeIdAllocator(current);
    const rewritten = rewriteFieldResult(paragraph, field, update.text, mint);
    const parent = parentOf(current, paragraph.id);
    if (!parent) return { ok: false, reason: 'unknown-paragraph' };
    const siblings = parent.children.map((child) =>
      child.id === paragraph.id ? rewritten : child
    );
    const replaced = replaceChildren(current, parent.id, siblings, options);
    if (!replaced.ok) return { ok: false, reason: 'tree-invariant' };
    current = replaced.part;
    dirty.push(update.paragraphId);
  }
  return ok(current, {
    dirty,
    created: [],
    deleted: [],
    dependencyKeys: dirty,
    impact: 'text-local',
  });
}

export function validateTextFormFieldDefault(
  part: OoxmlPart,
  op: Extract<TreeDocOp, { op: 'setTextFormFieldDefault' }>
): TreeOpRejection | null {
  if (!validLocale(op.locale)) return 'invalidArgs';
  if (typeof op.text !== 'string' || !isValidXmlText(op.text) || /[\r\n\t]/.test(op.text))
    return 'invalidArgs';
  if (op.options !== undefined && !validTextFormOptions(op.options)) return 'invalidArgs';
  const refusal = fieldResultUpdateRefusal(part, op.fieldNodeId);
  if (refusal) return refusal;
  const paragraph = findNode(part, op.paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return 'unknown-paragraph';
  const field = textFormFieldsOf(paragraph).find((f) => f.fieldNodeId === op.fieldNodeId);
  if (!field) return 'invalidArgs';
  const config = op.options ?? field;
  // A saved date or numeric picture can be longer than its original input limit.
  // Reopening unchanged options must not reject the value that we wrote.
  const unchangedFormattedDefault =
    (field.type === 'date' || (field.type === 'number' && field.format !== '')) &&
    config.type === field.type &&
    (field.type === 'date' || config.format === field.format) &&
    (config.maxLength === field.maxLength ||
      (field.type === 'date' && field.maxLength > 0 && config.maxLength >= field.maxLength)) &&
    op.text === field.defaultText;
  if (
    (config.maxLength > 0 &&
      [...op.text].length > config.maxLength &&
      !unchangedFormattedDefault) ||
    formatTextFormDefault(op.text, config, field, op.locale) === null
  )
    return 'invalidArgs';
  return locatePlainFields(paragraph, true).some(
    (f) => f.fieldNodeId === op.fieldNodeId && f.rewritable
  )
    ? null
    : 'invalidArgs';
}

export function applyTextFormFieldDefault(
  part: OoxmlPart,
  op: Extract<TreeDocOp, { op: 'setTextFormFieldDefault' }>,
  options?: EditOptions
): TreeOpResult {
  const refusal = validateTextFormFieldDefault(part, op);
  if (refusal) return { ok: false, reason: refusal };
  const p = findNode(part, op.paragraphId)!;
  if (p.kind !== 'paragraph') return { ok: false, reason: 'unknown-paragraph' };
  const previous = textFormFieldsOf(p).find((f) => f.fieldNodeId === op.fieldNodeId)!;
  const config = op.options ?? previous;
  const text = formatTextFormDefault(op.text, config, previous, op.locale)!;
  const result = applyFieldResults(
    part,
    { op: 'refreshFieldResults', updates: [{ ...op, text }] },
    options,
    true
  );
  if (!result.ok) return result;
  const field = findNode(result.part, op.fieldNodeId);
  if (!field || field.kind === 'textValue') return { ok: false, reason: 'invalidArgs' };
  const data = field.children.find(
    (n) =>
      n.kind !== 'textValue' && n.namespaceUri === WML_NAMESPACE_URI && n.localName === 'ffData'
  );
  if (!data || data.kind === 'textValue') return { ok: false, reason: 'invalidArgs' };
  const input = data.children.find(
    (n) =>
      n.kind !== 'textValue' && n.namespaceUri === WML_NAMESPACE_URI && n.localName === 'textInput'
  );
  if (!input || input.kind === 'textValue') return { ok: false, reason: 'invalidArgs' };
  const mint = createNodeIdAllocator(result.part);
  const property = (localName: string, value: string): OoxmlNode => {
    const existing = (localName === 'enabled' ? data : input).children.find(
      (n) =>
        n.kind !== 'textValue' && n.namespaceUri === WML_NAMESPACE_URI && n.localName === localName
    );
    return {
      ...(existing && existing.kind !== 'textValue'
        ? existing
        : {
            id: mint(),
            kind: 'generic',
            namespaceUri: WML_NAMESPACE_URI,
            prefix: 'w',
            localName,
            namespaceBindings: [],
            children: [],
          }),
      attributes: [
        ...(existing && existing.kind !== 'textValue'
          ? existing.attributes.filter(
              (a) => a.namespaceUri !== WML_NAMESPACE_URI || a.localName !== 'val'
            )
          : []),
        {
          kind: 'genericExtension',
          namespaceUri: WML_NAMESPACE_URI,
          prefix: 'w',
          localName: 'val',
          value,
        },
      ],
    } as OoxmlNode;
  };
  const defaultText =
    (config.type === 'number' || config.type === 'date') && config.format ? text : op.text;
  const edits = new Map<string, string | null>([['default', defaultText]]);
  if (op.options) {
    edits.set('type', op.options.type);
    // OOXML represents unlimited input by omitting maxLength, not by writing zero.
    edits.set('maxLength', op.options.maxLength === 0 ? null : String(op.options.maxLength));
    edits.set('format', op.options.format);
  }
  const children = input.children.filter(
    (n) => n.kind === 'textValue' || n.namespaceUri !== WML_NAMESPACE_URI || !edits.has(n.localName)
  );
  for (const [name, value] of edits) {
    if (value !== null) children.push(property(name, value));
  }
  const order = ['type', 'default', 'maxLength', 'format'];
  children.sort((a, b) => {
    const rank = (n: OoxmlNode) =>
      n.kind !== 'textValue' && n.namespaceUri === WML_NAMESPACE_URI && order.includes(n.localName)
        ? order.indexOf(n.localName)
        : 4;
    return rank(a) - rank(b);
  });
  let edited = replaceChildren(result.part, input.id, children, options);
  if (!edited.ok) return { ok: false, reason: 'tree-invariant' };
  if (op.options) {
    const latestData = findNode(edited.part, data.id)!;
    if (latestData.kind === 'textValue') return { ok: false, reason: 'tree-invariant' };
    const enabled = latestData.children.find(
      (n) =>
        n.kind !== 'textValue' && n.namespaceUri === WML_NAMESPACE_URI && n.localName === 'enabled'
    );
    edited = enabled
      ? replaceNode(
          edited.part,
          enabled.id,
          property('enabled', op.options.enabled ? '1' : '0'),
          options
        )
      : replaceChildren(
          edited.part,
          data.id,
          [property('enabled', op.options.enabled ? '1' : '0'), ...latestData.children],
          options
        );
  }
  if (!edited.ok) return { ok: false, reason: 'tree-invariant' };
  return ok(edited.part, {
    dirty: [op.paragraphId],
    created: [],
    deleted: [],
    dependencyKeys: [op.paragraphId],
    impact: 'text-local',
  });
}

/** The ops this seam applies: the legacy form-field family plus result refreshes. */
export type FieldResultOp = Extract<
  TreeDocOp,
  {
    op:
      | 'commitTextFormField'
      | 'setTextFormFieldDefault'
      | 'refreshFieldResults'
      | 'setLegacyCheckbox'
      | 'setLegacyDropdown';
  }
>;

/** A type guard, so the apply dispatcher keeps narrowing `op` past this seam's ops. */
export function isFieldResultOp(op: TreeDocOp): op is FieldResultOp {
  return (
    op.op === 'commitTextFormField' ||
    op.op === 'setTextFormFieldDefault' ||
    op.op === 'refreshFieldResults' ||
    op.op === 'setLegacyCheckbox' ||
    op.op === 'setLegacyDropdown'
  );
}

/**
 * Apply one of {@link FieldResultOp}.
 *
 * One entry for the apply dispatcher, so the legacy form-field family (text default, commit,
 * checkbox toggle) and result refreshes stay together instead of each adding a line to the
 * composition root.
 */
export function applyFieldResultOp(
  part: OoxmlPart,
  op: FieldResultOp,
  options?: EditOptions
): TreeOpResult {
  if (op.op === 'commitTextFormField') return applyCommitTextFormField(part, op, options);
  if (op.op === 'setTextFormFieldDefault') return applyTextFormFieldDefault(part, op, options);
  if (op.op === 'setLegacyCheckbox') return applySetLegacyCheckbox(part, op, options);
  if (op.op === 'setLegacyDropdown') return applySetLegacyDropdown(part, op, options);
  return applyRefreshFieldResults(part, op, options);
}

export function protectedTextFormEditRefusal(
  part: OoxmlPart,
  op: TreeDocOp,
  field: TextFormFieldRange,
  /** Admission only: the end of text replaced before insertion. Commit checks each op. */
  replacementEnd?: number
): TreeOpRejection | null {
  if (op.op !== 'insertText' && op.op !== 'deleteText') return 'invalidArgs';
  const paragraph = findNode(part, op.paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return 'unknown-paragraph';
  // Filling addresses this field's result, not the ordinary paragraph insertion landing.
  if (textFormFieldForEdit(part, op, field.fieldNodeId)?.fieldNodeId !== field.fieldNodeId)
    return 'invalidArgs';
  const start = op.op === 'insertText' ? op.offset : op.start;
  const end = op.op === 'insertText' ? op.offset : op.end;
  if (op.op === 'deleteText' && start >= end) return 'invalid-range';
  if (splitsSurrogate(paragraph, start) || splitsSurrogate(paragraph, end))
    return 'splits-surrogate-pair';
  if (op.op === 'insertText') {
    if (typeof op.text !== 'string' || !isValidXmlText(op.text)) return 'invalid-text';
    if (op.bias !== undefined && op.bias !== 'left' && op.bias !== 'right') return 'invalidArgs';
    if (op.inside !== undefined) {
      const owner = namedOwnerRefusal(part, op.paragraphId, op.offset, op.inside);
      if (owner) return owner;
      let ancestor = parentOf(part, field.fieldNodeId);
      while (ancestor && ancestor.id !== op.inside) ancestor = parentOf(part, ancestor.id);
      if (!ancestor) return 'invalidArgs';
    }
  }

  const located = locatePlainFields(paragraph, true).find(
    (f) => f.fieldNodeId === field.fieldNodeId
  );
  if (!located?.rewritable) return 'invalidArgs';
  if (op.op === 'insertText' && /[\r\n\t]/.test(op.text)) return 'invalidArgs';
  if (
    op.op === 'insertText' &&
    field.maxLength > 0 &&
    textFormInputLength(
      located.cachedText.slice(0, op.offset - field.start) +
        op.text +
        located.cachedText.slice((replacementEnd ?? op.offset) - field.start),
      field,
      located.cachedText
    ) > field.maxLength
  )
    return 'invalidArgs';
  return fieldResultUpdateRefusal(part, field.fieldNodeId);
}

export function applyProtectedTextFormEdit(
  part: OoxmlPart,
  op: TreeDocOp,
  field: TextFormFieldRange,
  options?: EditOptions
): TreeOpResult {
  const refusal = protectedTextFormEditRefusal(part, op, field);
  if (refusal) return { ok: false, reason: refusal };
  if (op.op !== 'insertText' && op.op !== 'deleteText') return { ok: false, reason: 'invalidArgs' };
  const paragraph = findNode(part, op.paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph')
    return { ok: false, reason: 'unknown-paragraph' };
  const located = locatePlainFields(paragraph, true).find(
    (f) => f.fieldNodeId === field.fieldNodeId
  )!;
  const start = (op.op === 'insertText' ? op.offset : op.start) - field.start;
  const end = (op.op === 'insertText' ? op.offset : op.end) - field.start;
  const locked = fieldResultUpdateRefusal(part, field.fieldNodeId);
  if (locked) return { ok: false, reason: locked };
  if (op.op === 'insertText' && /[\r\n]/.test(op.text)) return { ok: false, reason: 'invalidArgs' };
  if (!located.resultRunIds.length && op.op === 'insertText') {
    return applyFieldResults(
      part,
      {
        op: 'refreshFieldResults',
        updates: [{ paragraphId: op.paragraphId, fieldNodeId: field.fieldNodeId, text: op.text }],
      },
      options,
      true
    );
  }
  let current = part;
  let offset = 0;
  let inserted = false;
  const mint = createNodeIdAllocator(part);
  for (const runId of located.resultRunIds) {
    const run = findNode(current, runId);
    if (!run || run.kind !== 'run') return { ok: false, reason: 'tree-invariant' };
    const oldText = plainRunText(run);
    const runEnd = offset + oldText.length;
    let text = oldText;
    if (op.op === 'insertText') {
      if (!inserted && start >= offset && start <= runEnd) {
        text = oldText.slice(0, start - offset) + op.text + oldText.slice(start - offset);
        inserted = true;
      }
    } else if (start < runEnd && end > offset) {
      text =
        oldText.slice(0, Math.max(0, start - offset)) +
        oldText.slice(Math.min(oldText.length, end - offset));
    }
    offset = runEnd;
    if (text === oldText) continue;
    const edited = replaceChildren(
      current,
      runId,
      [
        ...run.children.filter((child) => child.kind === 'runProperties'),
        ...resultRunContent(text, mint),
      ],
      options
    );
    if (!edited.ok) return { ok: false, reason: 'tree-invariant' };
    current = edited.part;
  }
  return ok(current, {
    dirty: [op.paragraphId],
    created: [],
    deleted: [],
    dependencyKeys: [op.paragraphId],
    impact: 'text-local',
  });
}

export function validateCommitTextFormField(
  part: OoxmlPart,
  op: Extract<TreeDocOp, { op: 'commitTextFormField' }>
): TreeOpRejection | null {
  if (!validLocale(op.locale)) return 'invalidArgs';
  const p = findNode(part, op.paragraphId);
  if (!p || p.kind !== 'paragraph') return 'unknown-paragraph';
  const field = textFormFieldsOf(p).find((f) => f.fieldNodeId === op.fieldNodeId);
  const located = locatePlainFields(p, true).find((f) => f.fieldNodeId === op.fieldNodeId);
  if (!field || !field.enabled || !located?.rewritable) return 'invalidArgs';
  if (formatTextFormValue(located.cachedText, field, 'fill', op.locale) === null)
    return 'invalidArgs';
  return fieldResultUpdateRefusal(part, op.fieldNodeId);
}

export function applyCommitTextFormField(
  part: OoxmlPart,
  op: Extract<TreeDocOp, { op: 'commitTextFormField' }>,
  options?: EditOptions
): TreeOpResult {
  const refusal = validateCommitTextFormField(part, op);
  if (refusal) return { ok: false, reason: refusal };
  const p = findNode(part, op.paragraphId)!;
  if (p.kind !== 'paragraph') return { ok: false, reason: 'unknown-paragraph' };
  const field = textFormFieldsOf(p).find((f) => f.fieldNodeId === op.fieldNodeId)!;
  const located = locatePlainFields(p, true).find((f) => f.fieldNodeId === op.fieldNodeId)!;
  const text = formatTextFormValue(located.cachedText, field, 'fill', op.locale)!;
  return applyFieldResults(
    part,
    {
      op: 'refreshFieldResults',
      updates: [{ paragraphId: op.paragraphId, fieldNodeId: op.fieldNodeId, text }],
    },
    options,
    true
  );
}
