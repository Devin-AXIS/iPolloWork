import { inlineCharacterTextOf } from '../store/package/hyphen-text.ts';
import { WML_NAMESPACE_URI } from '../store/package/ooxml-shared.ts';
import { isRunLevelMcAlternateContent } from '../store/package/drawing-projection.ts';
// Canonical tree <-> ProseMirror binding (tasks 6.1, 6.2, 6.3).
//
// Forward: project one revision of the tree into a ProseMirror doc.
// Reverse: map an edited doc back into typed tree ops, or REFUSE.
//
// The reverse direction never reconstructs the tree from the projection. It compares the
// edited doc to the tree it was projected from and emits the smallest ops that explain the
// difference, so anything the projection does not model — unknown nodes, lexical form,
// node identities — is carried by the tree rather than round-tripped through the editor.
// A shape it cannot explain is rejected outright (task 6.3): a silently-dropped edit is
// worse than a refused one, because only the refusal can be reconciled.

import type { OoxmlProperty, TreeDocOp } from '../store/store/tree-op-types.ts';
import { createRecentRootCache } from '../store/store/recent-root-cache.ts';
import { createSubtreeAggregateMemo } from '../store/package/subtree-memo-policy.ts';
import { Node as PMNode } from 'prosemirror-model';
import {
  collectStoryParagraphs,
  findNode,
  isPageBreakNode,
  PAGE_BREAK_CHAR,
  storyRootsOf,
  type OoxmlNode,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import {
  contentControlContentOf,
  isContentControl,
} from '../store/package/content-control-walk.ts';
import { isInlineContainerProperty } from '../store/package/inline-container-properties.ts';
import {
  isContentRevisionKind,
  isInlineRunContainer,
  MAX_INLINE_CONTAINER_DEPTH,
  nextInlineContainerDepth,
} from '../store/package/ooxml-shared.ts';
import { isLegacyVmlAtom } from '../store/package/legacy-vml-projection.ts';
import { FIELD_ATOM_CHAR } from '../store/package/field-nodes.ts';
import { runPropsOf, treeSchema } from './tree-schema.ts';

/**
 * Why an edited projection could not be mapped back into tree ops.
 *
 * A refusal, not a fallback. The reverse direction never RECONSTRUCTS the tree from the
 * projection — it explains a difference — so a shape it cannot explain is rejected outright.
 * A silently-dropped edit is worse than a refused one, because only the refusal can be
 * reconciled.
 */
export type TreeBindingRejection =
  | 'paragraph-count-unexplained'
  | 'paragraph-reordered'
  | 'unknown-paragraph-id'
  | 'unknown-content-moved'
  | 'unsupported-node'
  | 'split-not-clean'
  | 'join-not-clean';

/**
 * The ops explaining one edit, or the reason it could not be explained.
 *
 * `ops` is the SMALLEST set that accounts for the difference, so anything the projection does not
 * model — unknown nodes, lexical form, node identities — stays carried by the tree rather than
 * round-tripping through the editor.
 */
export type MapResult =
  | { readonly ok: true; readonly ops: readonly TreeDocOp[] }
  | { readonly ok: false; readonly reason: TreeBindingRejection; readonly detail?: string };

/** One projected inline token, in paragraph order. */
type Token =
  | {
      readonly kind: 'text';
      readonly text: string;
      readonly props: readonly OoxmlProperty[];
    }
  | { readonly kind: 'tab' }
  | { readonly kind: 'hardBreak' }
  | { readonly kind: 'pageBreak' }
  | {
      readonly kind: 'unknown';
      readonly nodeId: string;
      readonly label: string;
      readonly modelLength: 0 | 1;
    };

type TokenReader = (node: PMNode) => Token[];

function propsEqual(a: readonly OoxmlProperty[], b: readonly OoxmlProperty[]): boolean {
  return JSON.stringify(normalizeProps(a)) === JSON.stringify(normalizeProps(b));
}

/** Sorted by name so property ORDER inside `w:rPr` is not treated as a difference. */
function normalizeProps(props: readonly OoxmlProperty[]): OoxmlProperty[] {
  return [...props]
    .map((property) => ({
      localName: property.localName,
      attributes: Object.fromEntries(
        Object.entries(property.attributes ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))
      ),
    }))
    .sort((a, b) => (a.localName < b.localName ? -1 : 1));
}

/**
 * `w:rPr` / `w:pPr` children of a container, as authored, for the ProseMirror projection.
 *
 * A tracked FORMAT RECORD is not one of them. `w:rPrChange` and `w:pPrChange` hold the
 * container as it WAS, in children of their own, and neither the projection nor an op can
 * express that — so carrying them across put a name outside the accepted boundary into the
 * bag the reverse diff builds its op from, and the store refused the whole transaction as
 * `unsupported-property`. A formatting edit over a run with a pending record did nothing at
 * all. They are preserved on the node, like every other child a write cannot name.
 */
function propertiesOf(container: OoxmlNode | undefined): OoxmlProperty[] {
  if (!container || container.kind === 'textValue') return [];
  const props: OoxmlProperty[] = [];
  for (const child of container.children) {
    if (child.kind === 'textValue') continue;
    // Only `w:` qualified children and attributes are properties. Foreign extensions stay on
    // the node, so a projected edit can neither read them as properties nor write them back.
    if (child.namespaceUri !== WML_NAMESPACE_URI) continue;
    if (child.localName === 'rPrChange' || child.localName === 'pPrChange') continue;
    const attributes: Record<string, string> = {};
    for (const attribute of child.attributes) {
      if (attribute.namespaceUri === WML_NAMESPACE_URI)
        attributes[attribute.localName] = attribute.value;
    }
    props.push(
      Object.keys(attributes).length > 0
        ? { localName: child.localName, attributes }
        : { localName: child.localName }
    );
  }
  return props;
}

/**
 * A human label for content the editor cannot model, from the element's own name.
 *
 * Shown in the placeholder's tooltip. A drawing should read as a picture rather than as an
 * anonymous gap, because the user needs to know it is still there.
 */
function unknownLabel(node: OoxmlNode): string {
  if (node.kind === 'textValue') return '';
  const friendly: Record<string, string> = {
    drawing: 'Picture',
    pict: 'Picture',
    object: 'Embedded object',
    fldSimple: 'Field',
    hyperlink: 'Hyperlink',
    sdt: 'Content control',
    tbl: 'Table',
  };
  const name = friendly[node.localName] ?? node.localName;
  return `${name} — preserved, not editable yet`;
}

/** Flatten a tree paragraph into projected tokens. */
function tokensOfParagraph(paragraph: OoxmlNode): Token[] {
  if (paragraph.kind === 'textValue') return [];
  const tokens: Token[] = [];
  const emitRun = (run: OoxmlNode): void => {
    if (run.kind !== 'run') return;
    const rPr = run.children.find((grand) => grand.kind === 'runProperties');
    const props = propertiesOf(rPr);
    for (const grand of run.children) {
      if (grand.kind === 'runProperties') continue;
      if (grand.kind === 'tab') {
        tokens.push({ kind: 'tab' });
        continue;
      }
      if (grand.kind === 'hardBreak') {
        tokens.push(isPageBreakNode(grand) ? { kind: 'pageBreak' } : { kind: 'hardBreak' });
        continue;
      }
      if (grand.kind === 'text') {
        let text = '';
        for (const value of grand.children) {
          if (value.kind === 'textValue') text += value.value;
        }
        if (text.length > 0) tokens.push({ kind: 'text', text, props });
        continue;
      }
      tokens.push({
        kind: 'unknown',
        nodeId: grand.id,
        label: unknownLabel(grand),
        modelLength:
          grand.kind === 'drawing' ||
          isRunLevelMcAlternateContent(grand) ||
          isLegacyVmlAtom(grand) ||
          inlineCharacterTextOf(grand) !== null
            ? 1
            : 0,
      });
    }
  };
  const visit = (child: OoxmlNode): void => {
    if (child.kind === 'run') {
      emitRun(child);
      return;
    }
    // Paragraph-level unknown content keeps a position in the inline sequence.
    tokens.push({ kind: 'unknown', nodeId: child.id, label: unknownLabel(child), modelLength: 0 });
  };
  const walkEditable = (children: readonly OoxmlNode[], depth: number): void => {
    for (const child of children) {
      if (child.kind === 'textValue' || child.kind === 'paragraphProperties') continue;
      // Match the paragraph-offset walk exactly: children AT the cap are not addressable.
      if (depth >= MAX_INLINE_CONTAINER_DEPTH) continue;
      if (
        isInlineRunContainer(child) &&
        !isContentRevisionKind(child.kind) &&
        depth < MAX_INLINE_CONTAINER_DEPTH
      ) {
        walkEditable(
          child.children.filter((grand) => !isInlineContainerProperty(child, grand)),
          nextInlineContainerDepth(child, depth)
        );
        continue;
      }
      if (isContentControl(child)) {
        const content = contentControlContentOf(child);
        if (content) {
          walkEditable(content, nextInlineContainerDepth(child, depth));
        }
        continue;
      }
      visit(child);
    }
  };
  // Revisions stay opaque here. The reverse PM binding must preserve their authored identity.
  walkEditable(paragraph.children, 0);
  return tokens;
}

/** Body paragraphs of a part, in document order. */
export function bodyParagraphs(part: OoxmlPart): OoxmlNode[] {
  const paragraphs: OoxmlNode[] = [];
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'body') {
      for (const child of node.children) {
        if (child.kind === 'paragraph') paragraphs.push(child);
      }
      return;
    }
    for (const child of node.children) walk(child);
  };
  walk(part.root);
  return paragraphs;
}

/**
 * EVERY editable paragraph of a part, in reading order — body paragraphs AND paragraphs
 * inside table cells (descending through nested tables), including header/footer story
 * roots (`w:hdr` / `w:ftr`) and typed note bodies (`w:footnote` / `w:endnote`) so scoped
 * furniture / note editing addresses the same set.
 *
 * Deliberately separate from `bodyParagraphs`: the PM projection (`treeToDoc`/
 * `docToTreeOps`) stays a body-level lane, while the paginated surface addresses cell
 * paragraphs directly by node id — selection clamping, Enter's minted-tail diff and
 * select-all all need the full set.
 */
/**
 * Memoized on the PART's identity. Parts are immutable, so one walk per part is always
 * enough — and the paraId index reads every story on every package revision, so without this
 * a keystroke in the body re-walked each header, footer and notes part to rediscover
 * paragraphs that had not moved. Entries die with their part.
 *
 * Callers treat the result as read-only; nothing in the tree mutates it.
 *
 * BOUNDED, not a bare `WeakMap`, for the reason `story-roots.ts` gives about its own cache:
 * undo history retains up to 200 package snapshots by reference, and every part it keeps
 * alive would keep an O(document) array alive with it. `paragraphAnchors` populates one per
 * revision, so a bare map would grow with the history rather than with the document.
 */
const paragraphsByPart = createRecentRootCache<OoxmlNode[]>(16);
const paragraphsByStoryChild = createSubtreeAggregateMemo<readonly OoxmlNode[]>();

function appendStoryChildParagraphs(child: OoxmlNode, into: OoxmlNode[]): void {
  let paragraphs = paragraphsByStoryChild.get(child);
  if (!paragraphs) {
    const collected: OoxmlNode[] = [];
    collectStoryParagraphs([child], collected, 0);
    paragraphs = Object.freeze(collected);
    paragraphsByStoryChild.set(child, paragraphs, paragraphs.length);
  }
  for (const paragraph of paragraphs) into.push(paragraph);
}

export function allParagraphs(part: OoxmlPart): OoxmlNode[] {
  const cached = paragraphsByPart.get(part);
  if (cached) return cached;
  // The walk itself lives in the store lane (`story-blocks.ts`) because the automation lane
  // asks the same question and the two must not answer it differently — a paragraph inside a
  // nested table or a content control has to be in the story for both, or an offset computed
  // through one and applied through the other lands in a different paragraph.
  const paragraphs: OoxmlNode[] = [];
  for (const story of storyRootsOf(part)) {
    if (story.root.kind === 'textValue') continue;
    for (const child of story.root.children) appendStoryChildParagraphs(child, paragraphs);
  }
  paragraphsByPart.set(part, paragraphs);
  return paragraphs;
}

/** Project one tree revision into a ProseMirror doc (task 6.1). */
export function treeToDoc(part: OoxmlPart): PMNode {
  const paragraphs = bodyParagraphs(part).map((paragraph) => {
    const pPr =
      paragraph.kind === 'textValue'
        ? undefined
        : paragraph.children.find((child) => child.kind === 'paragraphProperties');
    const inline = tokensOfParagraph(paragraph).map((token) => {
      switch (token.kind) {
        case 'text':
          return treeSchema.text(
            token.text,
            token.props.length > 0 ? [treeSchema.marks.runProps.create({ props: token.props })] : []
          );
        case 'tab':
          return treeSchema.node('tab');
        case 'hardBreak':
          return treeSchema.node('hardBreak');
        case 'pageBreak':
          return treeSchema.node('pageBreak');
        default:
          return treeSchema.node('unknownInline', {
            nodeId: token.nodeId,
            label: token.label,
          });
      }
    });
    return treeSchema.node('paragraph', { nodeId: paragraph.id, props: propertiesOf(pPr) }, inline);
  });
  return treeSchema.node(
    'doc',
    null,
    paragraphs.length > 0 ? paragraphs : [treeSchema.node('paragraph')]
  );
}

/** Read a PM paragraph back into the same token shape, for comparison. */
function tokensOfNode(node: PMNode, modelAtomIds: ReadonlySet<string>): Token[] {
  const tokens: Token[] = [];
  node.forEach((child) => {
    if (child.isText && child.text) {
      tokens.push({ kind: 'text', text: child.text, props: runPropsOf(child) });
      return;
    }
    if (child.type.name === 'tab') tokens.push({ kind: 'tab' });
    else if (child.type.name === 'hardBreak') tokens.push({ kind: 'hardBreak' });
    else if (child.type.name === 'pageBreak') tokens.push({ kind: 'pageBreak' });
    else if (child.type.name === 'unknownInline') {
      tokens.push({
        kind: 'unknown',
        nodeId: String(child.attrs.nodeId ?? ''),
        label: String(child.attrs.label ?? ''),
        modelLength: modelAtomIds.has(String(child.attrs.nodeId ?? '')) ? 1 : 0,
      });
    }
  });
  return tokens;
}

/** Plain text of a token list, as the ops address it. */
function textOf(tokens: readonly Token[]): string {
  let text = '';
  for (const token of tokens) {
    if (token.kind === 'text') text += token.text;
    else if (token.kind === 'tab') text += '\t';
    else if (token.kind === 'hardBreak') text += '\n';
    else if (token.kind === 'pageBreak') text += PAGE_BREAK_CHAR;
    else if (token.modelLength === 1) text += FIELD_ATOM_CHAR;
    // Other opaque content keeps its existing zero-length model.
  }
  return text;
}

/**
 * Where each unknown node sits, as `id@textOffset`.
 *
 * The id sequence alone is not enough: moving an unknown node from after the text to
 * before it leaves the same ids in the same order, so only its OFFSET reveals the move.
 */
function unknownPositions(tokens: readonly Token[]): string[] {
  const positions: string[] = [];
  let offset = 0;
  for (const token of tokens) {
    if (token.kind === 'text') offset += token.text.length;
    else if (token.kind === 'tab' || token.kind === 'hardBreak' || token.kind === 'pageBreak')
      offset += 1;
    else {
      positions.push(`${token.nodeId}@${offset}`);
      offset += token.modelLength;
    }
  }
  return positions;
}

/** Longest common prefix / suffix, so a one-character edit maps to a one-character op. */
function diffRange(
  before: string,
  after: string
): { start: number; endBefore: number; endAfter: number } | null {
  if (before === after) return null;
  let start = 0;
  const max = Math.min(before.length, after.length);
  while (start < max && before[start] === after[start]) start += 1;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore -= 1;
    endAfter -= 1;
  }
  return { start, endBefore, endAfter };
}

/** The accepted run properties in force at each text offset. */
function propsByOffset(tokens: readonly Token[]): (readonly OoxmlProperty[])[] {
  const at: (readonly OoxmlProperty[])[] = [];
  for (const token of tokens) {
    if (token.kind === 'text') {
      for (let i = 0; i < token.text.length; i += 1) at.push(token.props);
    } else if (token.kind === 'tab' || token.kind === 'hardBreak' || token.kind === 'pageBreak') {
      // A tab or break carries its run's properties too, but the projection does not model
      // them, so it inherits whatever the surrounding text has rather than claiming none.
      at.push(at[at.length - 1] ?? []);
    } else if (token.kind === 'unknown' && token.modelLength === 1) {
      // Reserve the model unit without pretending the picture has editable text marks.
      at.push([]);
    }
  }
  return at;
}

function paragraphOps(
  paragraphId: string,
  before: readonly Token[],
  after: readonly Token[],
  beforeProps: readonly OoxmlProperty[],
  afterProps: readonly OoxmlProperty[]
): MapResult {
  const ops: TreeDocOp[] = [];

  const beforeText = textOf(before);
  const afterText = textOf(after);
  const range = diffRange(beforeText, afterText);

  // Unknown content must survive an edit unchanged and in place. A projection that lost or
  // reordered it means the editor mutated something it does not model.
  const shiftedBefore: string[] = [];
  let offset = 0;
  let crossesAtom = false;
  for (const token of before) {
    if (token.kind !== 'unknown') {
      offset += token.kind === 'text' ? token.text.length : 1;
      continue;
    }
    let projectedOffset = offset;
    if (token.modelLength === 1 && range) {
      if (range.start < offset + 1 && range.endBefore > offset) crossesAtom = true;
      if (range.endBefore <= offset) projectedOffset += range.endAfter - range.endBefore;
    }
    shiftedBefore.push(`${token.nodeId}@${projectedOffset}`);
    offset += token.modelLength;
  }
  if (crossesAtom || JSON.stringify(shiftedBefore) !== JSON.stringify(unknownPositions(after))) {
    return { ok: false, reason: 'unknown-content-moved', detail: paragraphId };
  }

  if (!propsEqual(beforeProps, afterProps)) {
    ops.push({ op: 'setParagraphProperties', paragraphId, properties: normalizeProps(afterProps) });
  }

  if (range) {
    // Delete first, then insert at the same offset: two ops that compose to a replacement
    // without needing a replace primitive.
    if (range.endBefore > range.start) {
      ops.push({ op: 'deleteText', paragraphId, start: range.start, end: range.endBefore });
    }
    if (range.endAfter > range.start) {
      const inserted = afterText.slice(range.start, range.endAfter);
      // A tab or newline inside the inserted text is a CONTENT TOKEN, not a character, so
      // it maps to its own op rather than being written into a `w:t`.
      let cursor = range.start;
      let buffer = '';
      const flush = (): void => {
        if (buffer.length === 0) return;
        ops.push({ op: 'insertText', paragraphId, offset: cursor, text: buffer });
        cursor += buffer.length;
        buffer = '';
      };
      for (const character of inserted) {
        if (character === '\t') {
          flush();
          ops.push({ op: 'insertTab', paragraphId, offset: cursor });
          cursor += 1;
        } else if (character === '\n') {
          flush();
          ops.push({ op: 'insertHardBreak', paragraphId, offset: cursor });
          cursor += 1;
        } else if (character === PAGE_BREAK_CHAR) {
          flush();
          ops.push({ op: 'insertPageBreak', paragraphId, offset: cursor });
          cursor += 1;
        } else buffer += character;
      }
      flush();
    }
  }

  // Formatting is diffed POINTWISE over text offsets, then coalesced into maximal ranges.
  //
  // Comparing span-to-span by exact bounds does not work: bolding the first half of a run
  // re-segments one span into two, so the untouched second half has no counterpart and
  // reads as a change, emitting a redundant `setRunProperties []` over text whose
  // properties never moved. Offsets are stable across that re-segmentation; span bounds
  // are not.
  if (!range) {
    const beforeAt = propsByOffset(before);
    const afterAt = propsByOffset(after);
    let index = 0;
    while (index < afterAt.length) {
      if (propsEqual(beforeAt[index] ?? [], afterAt[index]!)) {
        index += 1;
        continue;
      }
      const start = index;
      const target = afterAt[index]!;
      while (
        index < afterAt.length &&
        propsEqual(afterAt[index]!, target) &&
        !propsEqual(beforeAt[index] ?? [], afterAt[index]!)
      ) {
        index += 1;
      }
      ops.push({
        op: 'setRunProperties',
        paragraphId,
        start,
        end: index,
        properties: normalizeProps(target),
      });
    }
  }

  return { ok: true, ops };
}

/**
 * Map an edited ProseMirror doc back into typed tree ops (task 6.2), or refuse (6.3).
 *
 * Handles a paragraph count delta of 0 (in-place edits), +1 (a clean split) and -1 (a clean
 * join). Anything else — a reorder, a multi-paragraph paste, a structural change combined
 * with an edit elsewhere — is refused rather than approximated, because the approximation
 * is what silently loses content.
 */
export function docToTreeOps(part: OoxmlPart, doc: PMNode): MapResult {
  const treeParagraphs = bodyParagraphs(part);
  // Only canonical run tokens decide which unknown nodes occupy one model unit.
  // A projection cannot forge a length, or promote an opaque descendant to an atom.
  const modelAtomIds = new Set<string>();
  for (const paragraph of treeParagraphs) {
    for (const token of tokensOfParagraph(paragraph)) {
      if (token.kind === 'unknown' && token.modelLength === 1) modelAtomIds.add(token.nodeId);
    }
  }
  const readTokens: TokenReader = (node) => tokensOfNode(node, modelAtomIds);
  const docParagraphs: PMNode[] = [];
  doc.forEach((node) => {
    if (node.type.name === 'paragraph') docParagraphs.push(node);
  });
  if (docParagraphs.length !== doc.childCount) {
    return { ok: false, reason: 'unsupported-node' };
  }

  const delta = docParagraphs.length - treeParagraphs.length;

  if (delta === 0) {
    const ops: TreeDocOp[] = [];
    for (const [index, node] of docParagraphs.entries()) {
      const paragraph = treeParagraphs[index]!;
      if (node.attrs.nodeId !== paragraph.id) {
        return { ok: false, reason: 'paragraph-reordered', detail: String(node.attrs.nodeId) };
      }
      const result = paragraphOps(
        paragraph.id,
        tokensOfParagraph(paragraph),
        readTokens(node),
        propertiesOf(
          paragraph.kind === 'textValue'
            ? undefined
            : paragraph.children.find((child) => child.kind === 'paragraphProperties')
        ),
        (node.attrs.props as OoxmlProperty[]) ?? []
      );
      if (!result.ok) return result;
      ops.push(...result.ops);
    }
    return { ok: true, ops };
  }

  if (delta === 1) return mapSplit(treeParagraphs, docParagraphs, readTokens);
  if (delta === -1) return mapJoin(treeParagraphs, docParagraphs, readTokens);
  return { ok: false, reason: 'paragraph-count-unexplained', detail: String(delta) };
}

/**
 * Exactly one paragraph divided in two, with everything else untouched.
 *
 * Every index is tried as the candidate split point rather than scanning for the first
 * divergence. An END split — Enter at the end of a paragraph, the most common one — leaves
 * the head IDENTICAL to the source paragraph, so a first-divergence scan walks straight
 * past it, runs off the end of the tree paragraphs, and refuses a perfectly clean split.
 */
function mapSplit(
  treeParagraphs: readonly OoxmlNode[],
  docParagraphs: readonly PMNode[],
  readTokens: TokenReader
): MapResult {
  for (let index = 0; index < treeParagraphs.length; index += 1) {
    const source = treeParagraphs[index]!;
    const head = docParagraphs[index];
    const tail = docParagraphs[index + 1];
    if (!head || !tail) continue;
    if (head.attrs.nodeId !== source.id) continue;
    // ProseMirror's splitBlock copies the source attrs onto the tail, so the tail carries
    // either the source id or none. Any OTHER id would be forging an existing identity.
    const tailId = tail.attrs.nodeId;
    if (tailId !== null && tailId !== source.id) continue;

    const headTokens = readTokens(head),
      tailTokens = readTokens(tail);
    const sourceTokens = tokensOfParagraph(source);
    const headText = textOf(headTokens);
    if (headText + textOf(tailTokens) !== textOf(sourceTokens)) continue;
    if (
      JSON.stringify(unknownPositions([...headTokens, ...tailTokens])) !==
      JSON.stringify(unknownPositions(sourceTokens))
    )
      continue;
    if (!alignsBefore(treeParagraphs, docParagraphs, index, readTokens)) continue;
    // Everything after the split must be untouched, or a structural change is riding along
    // with an edit and the two cannot be told apart afterwards.
    if (!alignsAfter(treeParagraphs, docParagraphs, index + 1, index + 2, readTokens)) continue;

    return {
      ok: true,
      ops: [{ op: 'splitParagraph', paragraphId: source.id, offset: headText.length }],
    };
  }
  return { ok: false, reason: 'split-not-clean' };
}

/** Exactly two adjacent paragraphs merged, with everything else untouched. */
function mapJoin(
  treeParagraphs: readonly OoxmlNode[],
  docParagraphs: readonly PMNode[],
  readTokens: TokenReader
): MapResult {
  for (let index = 0; index + 1 < treeParagraphs.length; index += 1) {
    const first = treeParagraphs[index]!;
    const second = treeParagraphs[index + 1]!;
    const survivor = docParagraphs[index];
    if (!survivor || survivor.attrs.nodeId !== first.id) continue;
    const expectedTokens = [...tokensOfParagraph(first), ...tokensOfParagraph(second)];
    const survivorTokens = readTokens(survivor);
    if (textOf(survivorTokens) !== textOf(expectedTokens)) continue;
    if (
      JSON.stringify(unknownPositions(survivorTokens)) !==
      JSON.stringify(unknownPositions(expectedTokens))
    )
      continue;
    if (!alignsBefore(treeParagraphs, docParagraphs, index, readTokens)) continue;
    if (!alignsAfter(treeParagraphs, docParagraphs, index + 2, index + 1, readTokens)) continue;

    return { ok: true, ops: [{ op: 'joinParagraphs', firstId: first.id, secondId: second.id }] };
  }
  return { ok: false, reason: 'join-not-clean' };
}

/** Whether doc paragraphs [0, count) match tree paragraphs [0, count) in identity and text. */
function alignsBefore(
  treeParagraphs: readonly OoxmlNode[],
  docParagraphs: readonly PMNode[],
  count: number,
  readTokens: TokenReader
): boolean {
  for (let i = 0; i < count; i += 1) {
    const node = docParagraphs[i];
    const paragraph = treeParagraphs[i]!;
    if (!node || node.attrs.nodeId !== paragraph.id) return false;
    if (textOf(readTokens(node)) !== textOf(tokensOfParagraph(paragraph))) return false;
    if (
      JSON.stringify(unknownPositions(readTokens(node))) !==
      JSON.stringify(unknownPositions(tokensOfParagraph(paragraph)))
    )
      return false;
  }
  return true;
}

/** Whether the tree tail from `treeFrom` matches the doc tail from `docFrom`. */
function alignsAfter(
  treeParagraphs: readonly OoxmlNode[],
  docParagraphs: readonly PMNode[],
  treeFrom: number,
  docFrom: number,
  readTokens: TokenReader
): boolean {
  for (let offset = 0; treeFrom + offset < treeParagraphs.length; offset += 1) {
    const paragraph = treeParagraphs[treeFrom + offset]!;
    const node = docParagraphs[docFrom + offset];
    if (!node || node.attrs.nodeId !== paragraph.id) return false;
    if (textOf(readTokens(node)) !== textOf(tokensOfParagraph(paragraph))) return false;
    if (
      JSON.stringify(unknownPositions(readTokens(node))) !==
      JSON.stringify(unknownPositions(tokensOfParagraph(paragraph)))
    )
      return false;
  }
  return true;
}

/** Whether a tree node id is still present, for reconciliation checks. */
export function partHasNode(part: OoxmlPart, nodeId: string): boolean {
  return findNode(part, nodeId) !== null;
}

/**
 * Rebuild a projected doc from a new tree revision, reusing untouched paragraphs (task 6.4).
 *
 * A full reprojection is always CORRECT, so this only ever narrows the work: paragraphs the
 * change did not name are carried over by reference, which lets ProseMirror keep their node
 * identity and redraw nothing. When the change is structural — a paragraph created, deleted,
 * split or joined — positions shift in ways a per-paragraph patch cannot express, so it
 * falls back to a full projection rather than guessing.
 *
 * Passing `null` means "no evidence available", which also takes the full path. Reconciling
 * on partial evidence is how a projection silently diverges from the model.
 */
export function reconcileDoc(
  previousDoc: PMNode,
  part: OoxmlPart,
  change: {
    readonly dirty: readonly string[];
    readonly created: readonly string[];
    readonly deleted: readonly string[];
    readonly splitJoin: readonly unknown[];
  } | null
): PMNode {
  if (!change) return treeToDoc(part);
  if (change.created.length > 0 || change.deleted.length > 0 || change.splitJoin.length > 0) {
    return treeToDoc(part);
  }

  const previous = new Map<string, PMNode>();
  previousDoc.forEach((node) => {
    const nodeId = node.attrs.nodeId;
    if (typeof nodeId === 'string') previous.set(nodeId, node);
  });

  const dirty = new Set(change.dirty);
  const paragraphs = bodyParagraphs(part);
  // A paragraph count mismatch means the evidence did not describe the whole change.
  if (paragraphs.length !== previousDoc.childCount) return treeToDoc(part);

  const projected = treeToDoc(part);
  const next: PMNode[] = [];
  for (const [index, paragraph] of paragraphs.entries()) {
    const reusable = previous.get(paragraph.id);
    next.push(reusable && !dirty.has(paragraph.id) ? reusable : projected.child(index));
  }
  return treeSchema.node('doc', null, next);
}
