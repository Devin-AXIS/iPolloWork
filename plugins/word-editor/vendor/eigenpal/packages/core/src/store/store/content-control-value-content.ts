import { isInlineRunContainer, WML_NAMESPACE_URI } from '../package/ooxml-shared.ts';
import type { OoxmlElement, OoxmlNode } from '../package/ooxml-tree.ts';
import {
  cloneWithFreshIds,
  isInertInline,
  isRangeEnd,
  isTextRun,
  isWhitespaceText,
  isWml,
  paragraphMarkProperties,
  paragraphOf,
  runContentOf,
  withoutPlaceholderStyle,
} from './content-control-checkbox.ts';
import { runPropertiesNodeOf } from './tree-op-nodes.ts';
import type { TreeOpEffect } from './tree-op-types.ts';

/** Mints the single run that becomes a control's display, given the face it should keep. */
export type DisplayRunMinter = (properties?: OoxmlNode) => OoxmlNode;

const STRUCTURAL_KINDS: ReadonlySet<OoxmlNode['kind']> = new Set([
  'table',
  'tableRow',
  'tableCell',
]);

/** Run properties that record a revision or belong to a wrapper the value removes. */
const FACE_DROPPED_NAMES: ReadonlySet<string> = new Set([
  'ins',
  'del',
  'moveFrom',
  'moveTo',
  'rPrChange',
]);

const MAX_DEPTH = 32;

function isParagraph(node: OoxmlNode): boolean {
  return node.kind === 'paragraph' || isWml(node, 'p');
}

function isContent(node: OoxmlNode): boolean {
  return node.kind === 'contentControlContent' || isWml(node, 'sdtContent');
}

/** Containers a display paragraph may sit under: the control's content, cells, rows, tables. */
function isBlockContainer(node: OoxmlNode): boolean {
  return (
    isContent(node) ||
    node.kind === 'contentControl' ||
    STRUCTURAL_KINDS.has(node.kind) ||
    isWml(node, 'customXml')
  );
}

/** A properties element (`w:tcPr`, `w:sdtPr`, `w:tblGrid`, ...) that describes its container. */
function isPropertiesElement(node: OoxmlNode): boolean {
  return (
    node.kind !== 'textValue' &&
    node.namespaceUri === WML_NAMESPACE_URI &&
    (node.localName.endsWith('Pr') || node.localName === 'tblGrid')
  );
}

/**
 * Block content beside a display paragraph that a value cannot stand in for: anything but
 * another paragraph, a zero-length marker, or the container's own properties. A table, a
 * nested control, an `w:altChunk` or an unknown element beside the value would leave the
 * control's text different from what was written.
 */
function isOtherBlock(node: OoxmlNode): boolean {
  return (
    !isWhitespaceText(node) &&
    !isParagraph(node) &&
    !isInertInline(node) &&
    !isPropertiesElement(node)
  );
}

/** A run that only anchors a comment. The range markers around it stay, so it stays too. */
function isCommentAnchorRun(node: OoxmlNode): boolean {
  if (node.kind !== 'run') return false;
  const content = runContentOf(node);
  return content.length === 1 && isWml(content[0]!, 'commentReference');
}

/** A run that anchors a comment AND carries other content: neither kept whole nor dropped. */
function isMixedAnchorRun(node: OoxmlNode): boolean {
  if (node.kind !== 'run') return false;
  const content = runContentOf(node);
  return content.length > 1 && content.some((child) => isWml(child, 'commentReference'));
}

/** Content that stays beside the value: history, zero-length marks, comment anchors. */
function isKept(node: OoxmlNode): boolean {
  return isInertInline(node) || isCommentAnchorRun(node);
}

/** Inline content a text value replaces: runs, the containers that hold them, nested controls. */
function isReplaceableInline(node: OoxmlNode): boolean {
  if (node.kind === 'textValue') return isWhitespaceText(node);
  if (isMixedAnchorRun(node)) return false;
  return (
    node.kind === 'run' ||
    node.kind === 'contentControl' ||
    node.kind === 'revisionInsert' ||
    node.kind === 'revisionMoveTo' ||
    isInlineRunContainer(node) ||
    isWml(node, 'fldSimple') ||
    isWml(node, 'sdtContent') ||
    isKept(node)
  );
}

/**
 * Whether every complex field that begins among `children` also ends there. A field with one
 * boundary outside the control cannot be replaced by a value without orphaning the other.
 */
function fieldsBalanced(children: readonly OoxmlNode[]): boolean {
  let open = 0;
  const walk = (node: OoxmlNode, depth: number): void => {
    if (node.kind === 'textValue' || depth > MAX_DEPTH) return;
    if (isWml(node, 'fldChar')) {
      const type = node.attributes.find((a) => a.localName === 'fldCharType')?.value;
      if (type === 'begin') open++;
      else if (type === 'end') open--;
      return;
    }
    for (const child of node.children) walk(child, depth + 1);
  };
  for (const child of children) walk(child, 0);
  return open === 0;
}

/** Whether a node's subtree is one the face search and the live-text test may enter. */
function entersForText(node: OoxmlElement): boolean {
  if (node.kind === 'revisionDelete' || node.kind === 'revisionMoveFrom') return false;
  if (node.kind === 'hyperlink') return false;
  return isBlockContainer(node) || isParagraph(node) || isReplaceableInline(node);
}

/** The first live text run under `node`: a run that shows characters, not one that is empty. */
function firstLiveTextRun(node: OoxmlNode, depth: number): OoxmlElement | undefined {
  if (node.kind === 'textValue' || depth > MAX_DEPTH) return undefined;
  if (node.kind === 'run') {
    if (!isTextRun(node) || isCommentAnchorRun(node) || runContentOf(node).length === 0) {
      return undefined;
    }
    return node;
  }
  if (!entersForText(node)) return undefined;
  for (const child of node.children) {
    const found = firstLiveTextRun(child, depth + 1);
    if (found) return found;
  }
  return undefined;
}

/** The first text run under `node`, empty or not, whose face the value inherits. */
function firstTextRun(node: OoxmlNode, depth: number): OoxmlElement | undefined {
  if (node.kind === 'textValue' || depth > MAX_DEPTH) return undefined;
  if (node.kind === 'run') {
    return isTextRun(node) && !isCommentAnchorRun(node) ? node : undefined;
  }
  if (!entersForText(node)) return undefined;
  for (const child of node.children) {
    const found = firstTextRun(child, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function hasLiveText(node: OoxmlNode): boolean {
  return firstLiveTextRun(node, 0) !== undefined;
}

/**
 * The face a value inherits from `node`. The first text run answers, even without `w:rPr`:
 * a plain run means a plain value. Only when no text run exists does the paragraph mark
 * answer. Hyperlinks are not entered: their link styling belongs to the link the value
 * removes; revision records are dropped with the runs they described.
 */
function faceOf(node: OoxmlNode, nextId: () => string): OoxmlNode | undefined {
  const run = firstLiveTextRun(node, 0) ?? firstTextRun(node, 0);
  if (!run) {
    return isParagraph(node) ? paragraphMarkProperties(node as OoxmlElement, nextId) : undefined;
  }
  const properties = runPropertiesNodeOf(run);
  if (!properties) return undefined;
  const formatting = properties.children.filter(
    (child) => child.kind !== 'textValue' && !FACE_DROPPED_NAMES.has(child.localName)
  );
  if (formatting.length === 0) return undefined;
  return withoutPlaceholderStyle(
    cloneWithFreshIds({ ...properties, children: formatting } as OoxmlNode, nextId)
  );
}

/** Insert the value run before the closing markers, so a range over the content covers it. */
function withValueRun(node: OoxmlElement, kept: readonly OoxmlNode[], run: OoxmlNode): OoxmlNode {
  const children: OoxmlNode[] = [...kept];
  let at = children.length;
  while (at > 0 && (isRangeEnd(children[at - 1]!) || isCommentAnchorRun(children[at - 1]!))) {
    at--;
  }
  children.splice(at, 0, run);
  return { ...node, children } as OoxmlNode;
}

/**
 * Replace a paragraph's content with one run. Properties, zero-length markers and comment
 * anchors stay, in order. Refuses when the paragraph holds something a value cannot stand in
 * for, or a field that reaches past the paragraph.
 */
function paragraphWithRun(
  paragraph: OoxmlElement,
  mint: DisplayRunMinter,
  nextId: () => string
): OoxmlNode | null {
  const kept: OoxmlNode[] = [];
  for (const child of paragraph.children) {
    if (isWml(child, 'pPr') || isKept(child)) {
      kept.push(child);
      continue;
    }
    if (!isReplaceableInline(child)) return null;
  }
  if (!fieldsBalanced(paragraph.children)) return null;
  return withValueRun(paragraph, kept, mint(faceOf(paragraph, nextId)));
}

function containsId(node: OoxmlNode, id: string, depth: number): boolean {
  if (node.id === id) return true;
  if (node.kind === 'textValue' || depth > MAX_DEPTH) return false;
  return node.children.some((child) => containsId(child, id, depth + 1));
}

type Walk = { readonly node: OoxmlNode } | 'refused' | 'none';

/**
 * The children a control's `w:sdtContent` holds after its display text changes.
 *
 * A value is one run. It lands in the control's display paragraph: the preferred paragraph
 * when the caller names one under the content (the caret's, when typing replaces a prompt);
 * else, at each level, the first paragraph holding text, else the first paragraph. Cells
 * that hold text are searched before empty ones. So a control around a cell keeps the cell,
 * its properties and its sibling cells, and a control around a row keeps every cell. Other
 * paragraphs beside the display paragraph go, as a text value has no second paragraph; any
 * other block beside it, a table or a nested control, is refused, because the value would
 * not be the control's text while that content stayed. Inline content is replaced in place,
 * keeping its zero-length markers and comment anchors. Empty content grows the run, inside a
 * paragraph when the control is block-level.
 *
 * Content this walk does not understand is refused rather than flattened: replacing an
 * unknown shape with a run is how a cell disappeared from a table. A refusal anywhere under
 * the content refuses the write; a block-level control never receives a bare run.
 */
export function valueContent(
  content: OoxmlElement | undefined,
  mint: DisplayRunMinter,
  nextId: () => string,
  inline: boolean,
  preferredParagraphId?: string
): readonly OoxmlNode[] | null {
  if (!content || content.children.every(isWhitespaceText)) {
    return inline ? [mint()] : [paragraphOf(nextId, [mint()])];
  }

  const replaceInline = (node: OoxmlElement): OoxmlNode | null => {
    if (!node.children.every(isReplaceableInline) || !fieldsBalanced(node.children)) return null;
    return withValueRun(node, node.children.filter(isKept), mint(faceOf(node, nextId)));
  };

  const preferred =
    preferredParagraphId !== undefined && containsId(content, preferredParagraphId, 0)
      ? preferredParagraphId
      : undefined;

  const rewrite = (node: OoxmlNode, depth: number): Walk => {
    if (node.kind === 'textValue' || !isBlockContainer(node)) return 'none';
    if (depth > MAX_DEPTH) return 'refused';
    const paragraphs = node.children.filter(isParagraph);
    const target =
      paragraphs.find((paragraph) => paragraph.id === preferred) ??
      (preferred !== undefined && !paragraphs.some((p) => containsId(p, preferred, 0))
        ? undefined
        : (paragraphs.find(hasLiveText) ?? paragraphs[0]));
    if (target) {
      if (node.children.some(isOtherBlock)) return 'refused';
      const replaced = paragraphWithRun(target as OoxmlElement, mint, nextId);
      if (!replaced) return 'refused';
      const children = node.children
        .map((child) => (child === target ? replaced : child))
        .filter((child) => child === replaced || !isParagraph(child));
      return { node: { ...node, children } as OoxmlNode };
    }
    // Descend toward the preferred paragraph first, then into children that hold text, then
    // the rest, in document order within each group.
    const ordered = [...node.children.keys()].sort((a, b) => rank(node, a) - rank(node, b));
    for (const i of ordered) {
      const walked = rewrite(node.children[i]!, depth + 1);
      if (walked === 'none') continue;
      if (walked === 'refused') return walked;
      const children = [...node.children];
      children[i] = walked.node;
      return { node: { ...node, children } as OoxmlNode };
    }
    return 'none';
  };
  const rank = (node: OoxmlElement, index: number): number => {
    const child = node.children[index]!;
    if (preferred !== undefined && containsId(child, preferred, 0)) return 0;
    return hasLiveText(child) ? 1 : 2;
  };

  const walked = rewrite(content, 0);
  if (walked === 'refused') return null;
  if (walked !== 'none') return walked.node.kind === 'textValue' ? null : walked.node.children;
  // No paragraph anywhere. Inline content is replaced in place; block content with no
  // paragraph to hold the value (a nested block control with nothing in it) is refused.
  if (!inline) return null;
  const replaced = replaceInline(content);
  return replaced && replaced.kind !== 'textValue' ? replaced.children : null;
}

/**
 * Whether {@link valueContent} can write this content. The validator asks so `can()` and
 * `exec()` agree; the probe's ids are discarded with its result.
 */
export function valueContentWritable(content: OoxmlElement | undefined, inline: boolean): boolean {
  const probe: DisplayRunMinter = () =>
    ({
      id: 'probe',
      kind: 'run',
      namespaceUri: WML_NAMESPACE_URI,
      localName: 'r',
      prefix: 'w',
      namespaceBindings: [],
      attributes: [],
      children: [],
    }) as unknown as OoxmlNode;
  return valueContent(content, probe, () => 'probe', inline) !== null;
}

/** Every paragraph id under a node, in document order. Bounded on imported XML. */
export function paragraphIdsUnder(node: OoxmlNode): readonly string[] {
  const ids: string[] = [];
  const walk = (current: OoxmlNode, depth: number): void => {
    if (current.kind === 'textValue' || depth > MAX_DEPTH) return;
    if (current.kind === 'paragraph') {
      ids.push(current.id);
      return;
    }
    for (const child of current.children) walk(child, depth + 1);
  };
  walk(node, 0);
  return ids;
}

/**
 * An effect that tells paragraph-keyed consumers what a value write did to the paragraph set:
 * paragraphs that went are `deleted`, minted ones `created`, and a display paragraph kept in
 * place with new runs is `dirty`. A paragraph that changed hands silently is a stale cache.
 */
export function withParagraphDiff(
  effect: TreeOpEffect,
  before: OoxmlNode,
  after: OoxmlNode
): TreeOpEffect {
  const was = paragraphIdsUnder(before);
  const is = paragraphIdsUnder(after);
  const kept = is.filter((id) => was.includes(id));
  const created = is.filter((id) => !was.includes(id));
  const deleted = was.filter((id) => !is.includes(id));
  return {
    ...effect,
    dirty: [...effect.dirty, ...kept.filter((id) => !effect.dirty.includes(id))],
    created: [...effect.created, ...created],
    deleted: [...effect.deleted, ...deleted],
    impact: created.length > 0 || deleted.length > 0 ? 'flow-structural' : effect.impact,
  };
}
