// A control a content edit emptied shows its prompt again.
//
// Word's rule: delete the last character of a text, date or list control and the
// placeholder comes back under `w:showingPlcHdr`, ready for the next keystroke to replace
// it whole. The text is the glossary block's that `w:placeholder/w:docPart` names, which the
// store hands in through `EditOptions.placeholderText`; without one, the type's own prompt
// stands in. The `w:placeholder` reference itself survives for other readers and for the next open,
// where `materializeGlossaryPlaceholders` resolves the whole block. Split from
// `tree-op-content-controls.ts` to keep that file under its line cap.

import type { ContentControlKind } from '../package/content-control-nodes.ts';
import {
  contentControlPropertiesContainerOf,
  contentControlPropertiesOf,
} from '../package/content-control-nodes.ts';
import {
  createNodeIdAllocator,
  findNode,
  replaceNode,
  type EditOptions,
} from '../package/ooxml-edit.ts';
import { MAX_INLINE_CONTAINER_DEPTH } from '../package/ooxml-shared.ts';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { isInlineControl, isWml } from './content-control-checkbox.ts';
import { contentWithText, editedProperties, promptFor } from './tree-op-content-controls.ts';
import {
  contentControlContentOf,
  findContentControl,
  isRunPropertiesNode,
} from './tree-op-nodes.ts';
import { paragraphLength } from './tree-op-segments.ts';
import type { TreeOpEffect, TreeOpResult } from './tree-op-types.ts';

/** The kinds whose empty content shows a prompt. A checkbox or a picture has none. */
const PROMPT_KINDS: ReadonlySet<ContentControlKind> = new Set<ContentControlKind>([
  'plainText',
  'richText',
  'date',
  'dropDownList',
  'comboBox',
  'docPartList',
]);

/** @internal Exported for the restore order oracle test. */
export function holdsContent(node: OoxmlNode, depth: number): boolean {
  if (node.kind === 'textValue' || depth > MAX_INLINE_CONTAINER_DEPTH) return false;
  if (node.kind === 'run') return node.children.some((child) => !isRunPropertiesNode(child));
  if (node.localName === 'sdtPr' || node.localName === 'pPr') return false;
  return node.children.some((child) => holdsContent(child, depth + 1));
}

/**
 * Restore the prompt of a control the edit in `result` has just emptied. The wrapper stays,
 * the type's prompt goes back under `w:showingPlcHdr`, and the next keystroke replaces it
 * whole. Deleting the last character used to leave a zero-width control the caret could not
 * enter, which read as the control having vanished. A control that still holds content,
 * already shows its prompt, or has no prompt to show leaves `result` unchanged.
 */
export function restoreEmptiedPlaceholder(
  result: TreeOpResult,
  controlId: string,
  options?: EditOptions,
  /** The text that stands in for the content; the type's own prompt when absent. */
  prompt?: string
): TreeOpResult {
  if (!result.ok) return result;
  const control = findContentControl(result.part, controlId);
  if (!control) return result;
  const summary = contentControlPropertiesOf(control);
  // A decision's placeholder also stands in an untyped control, which reads as rich text, and
  // replaces a prompt the decision emptied.
  const decision = prompt !== undefined;
  if (summary.showingPlaceholder && !decision) return result;
  if (!PROMPT_KINDS.has(summary.type) && !(decision && summary.type === 'untyped')) return result;
  const content = contentControlContentOf(control);
  if (!content || holdsContent(content, 0)) return result;
  const nextId = createNodeIdAllocator(result.part);
  const inline = isInlineControl(result.part, control.id);
  const authored =
    summary.placeholderDocPart === undefined
      ? undefined
      : options?.placeholderText?.(summary.placeholderDocPart);
  const children = contentWithText(
    content,
    prompt ?? authored ?? promptFor(summary.type),
    nextId,
    inline
  );
  if (!children) return result;
  const sdtPr = contentControlPropertiesContainerOf(control);
  const properties = editedProperties(sdtPr, { showingPlaceholder: true }, nextId);
  const rebuilt = {
    ...control,
    children: [
      properties,
      ...control.children.filter((child) => child.id !== sdtPr?.id && child.id !== content.id),
      { ...content, children } as OoxmlNode,
    ],
  } as OoxmlNode;
  const written = replaceNode(result.part, control.id, rebuilt, options);
  return written.ok ? { ...result, part: written.part } : result;
}

/** A control the walk met, and whether it sits in run content. */
interface Control {
  readonly node: OoxmlElement;
  readonly inline: boolean;
}

/** Block containers: a control below one, with no paragraph between, is block-level. */
const BLOCKS: ReadonlySet<OoxmlNode['kind']> = new Set(['table', 'tableRow', 'tableCell']);

const holdsControl = new WeakMap<OoxmlNode, boolean>();

/**
 * Whether `node` holds a content control. Memoized per node: a decision rebuilds only the path
 * to what it changed, so in the next revision every other subtree answers from the memo.
 */
function holdsContentControl(node: OoxmlNode): boolean {
  if (node.kind === 'textValue') return false;
  const known = holdsControl.get(node);
  if (known !== undefined) return known;
  let holds = node.kind === 'contentControl';
  for (let index = 0; !holds && index < node.children.length; index += 1)
    holds = holdsContentControl(node.children[index]!);
  holdsControl.set(node, holds);
  return holds;
}

/**
 * Restore the placeholder of each inline control a revision decision emptied. A decision writes
 * five spaces under `w:showingPlcHdr`, the placeholder a control without its own prompt text
 * shows, so the control keeps a place for the caret and for the next value.
 */
export function restoreDecisionEmptiedControls(
  before: OoxmlPart,
  decidedIds: Iterable<string>,
  after: OoxmlPart,
  options?: EditOptions
): OoxmlPart {
  // The controls around each decided change, and the ones a removed change held. One walk of
  // `before` that enters only subtrees holding a control, and that keeps each control and
  // whether it sits in run content: looking each change and control up instead indexed the
  // whole part, and each decision makes a new part.
  const order = [...decidedIds];
  const decided = new Set(order);
  /** Per decided id: the controls around it, innermost first, as a walk up meets them. */
  const enclosingOf = new Map<string, readonly Control[]>();
  /** Per decided id: the controls it holds, in document order, within the depth limit. */
  const insideOf = new Map<string, Control[]>();
  type Holder = { readonly id: string; readonly depth: number };
  const noHolders: readonly Holder[] = [];
  const visit = (
    node: OoxmlNode,
    enclosing: readonly Control[],
    holders: readonly Holder[],
    inline: boolean
  ): void => {
    if (node.kind === 'textValue') return;
    let within =
      holders.length === 0
        ? noHolders
        : holders.map((holder) => ({ id: holder.id, depth: holder.depth + 1 }));
    // A repeated id counts where it first appears, as a lookup by id finds it.
    if (decided.has(node.id) && !enclosingOf.has(node.id)) {
      enclosingOf.set(node.id, [...enclosing].reverse());
      insideOf.set(node.id, []);
      within = [...within, { id: node.id, depth: 0 }];
    }
    let around = enclosing;
    if (node.kind === 'contentControl') {
      const control = { node, inline };
      for (const holder of within)
        if (holder.depth <= MAX_INLINE_CONTAINER_DEPTH) insideOf.get(holder.id)!.push(control);
      around = [...enclosing, control];
    }
    // What sits below this node is in run content when the nearest block above it is a
    // paragraph, as `isInlineControl` reads it.
    const childInline =
      node.kind === 'paragraph' || isWml(node, 'p') ? true : BLOCKS.has(node.kind) ? false : inline;
    for (const child of node.children)
      if (around.length > 0 || holdsContentControl(child))
        visit(child, around, within, childInline);
  };
  visit(before.root, [], [], false);
  // In the order of the decided ids, each one's enclosing controls and then the ones it held:
  // the order the restore allocates node ids in, which every peer must share.
  const controls = new Map<string, Control>();
  for (const id of order)
    for (const control of [...(enclosingOf.get(id) ?? []), ...(insideOf.get(id) ?? [])])
      if (!controls.has(control.node.id)) controls.set(control.node.id, control);
  let result: TreeOpResult = { ok: true, part: after, effect: NO_EFFECT };
  for (const { node, inline } of controls.values()) {
    if (!inline) continue;
    const content = contentControlContentOf(node);
    if (!content || !holdsContent(content, 0)) continue;
    result = restoreEmptiedPlaceholder(result, node.id, options, DECISION_PLACEHOLDER);
  }
  return result.ok ? result.part : after;
}
const DECISION_PLACEHOLDER = '     ';
/** The effect is the caller's; the restore reads only the part. */
const NO_EFFECT = {} as TreeOpEffect;

/**
 * Where the caller's characters go once a prompt has been emptied.
 *
 * Prompt replacement uses the prompt's start position. Clamp the position to the shortened
 * paragraph before inserting the replacement text.
 */
export function promptInsertionOffset(
  part: OoxmlPart,
  paragraphId: string,
  planned: number
): number {
  const paragraph = findNode(part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return planned;
  return Math.min(planned, paragraphLength(paragraph));
}
