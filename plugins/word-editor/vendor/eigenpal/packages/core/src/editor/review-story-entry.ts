// Moving to a position inside a text box opens that box.
//
// A change or a match inside a text box has its range in the box's own paragraph. A caret put
// there without opening the box typed into it while the box stayed closed: no frame, and the
// toolbar read the formatting of the story behind it. In a header, the open header clamped the
// caret to its own first paragraph instead. The box opens first, as a press on its text does.

import { findNode, parentNodeOf } from '../store/package/ooxml-edit.ts';
import type { OoxmlNode, OoxmlPart } from '../store/package/ooxml-tree.ts';
import { textboxStoriesInPart, type TextboxStoryRoot } from '../store/package/textbox-stories.ts';
import type { ViewScope } from '../contracts/editor.ts';
import type { SemanticPosition } from '../layout/semantic-interaction.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { partOfNodeId } from './surface-scope.ts';

type FrameScope = Extract<ViewScope, { kind: 'frame' }>;

/** Nested boxes and the containers between them stay well within this. */
const MAX_ANCESTORS = 256;

const storyIndexes = new WeakMap<readonly TextboxStoryRoot[], Map<string, TextboxStoryRoot>>();

/** The part's text box stories by root id; a scan per ancestor was quadratic in boxes. */
function storiesByRootId(part: OoxmlPart): ReadonlyMap<string, TextboxStoryRoot> {
  const stories = textboxStoriesInPart(part);
  let index = storyIndexes.get(stories);
  if (!index) {
    index = new Map(stories.map((story) => [story.root.id, story]));
    storyIndexes.set(stories, index);
  }
  return index;
}

/** The frame scope of the innermost text box in `part` holding `paragraphId`, or null. */
export function textboxScopeOfParagraph(part: OoxmlPart, paragraphId: string): FrameScope | null {
  const stories = storiesByRootId(part);
  if (stories.size === 0 || !findNode(part, paragraphId)) return null;
  let ancestor = parentNodeOf(part, paragraphId);
  for (let depth = 0; ancestor && depth < MAX_ANCESTORS; depth += 1) {
    const id = ancestor.id;
    const story = stories.get(id);
    if (story)
      return {
        kind: 'frame',
        id: story.root.id,
        drawingNodeId: story.drawingNodeId,
        hostParagraphId: story.hostParagraphId,
      };
    ancestor = parentNodeOf(part, id);
  }
  return null;
}

/** Per part revision: text box paragraph id to the paragraph its drawing rides in. */
const hostsByRoot = new WeakMap<OoxmlNode, Map<string, string | null>>();

/**
 * The paragraph that anchors the text box holding `paragraphId`, or null when the paragraph
 * is in no text box. A box's text has no place of its own in the story's flow, so a card or
 * a comment affordance on it sits beside the paragraph the box rides in.
 */
export function textboxHostParagraphOf(
  surface: PaginatedSurface | null,
  paragraphId: string
): string | null {
  const part = surface && partOfNodeId(surface.session, paragraphId);
  if (!part) return null;
  let hosts = hostsByRoot.get(part.root);
  if (!hosts) hostsByRoot.set(part.root, (hosts = new Map()));
  const known = hosts.get(paragraphId);
  if (known !== undefined) return known;
  const host = textboxScopeOfParagraph(part, paragraphId)?.hostParagraphId ?? null;
  hosts.set(paragraphId, host);
  return host;
}

/**
 * Open the text box holding `position`, if any, and put the caret at `position` in it. `rId`
 * names the header or footer the box sits in. A box that cannot take a caret, or a document
 * open for viewing, leaves the caret where it is.
 */
export function openTextboxAt(
  surface: PaginatedSurface,
  position: SemanticPosition,
  rId?: string
): void {
  const part = partOfNodeId(surface.session, position.paragraphId);
  const scope = part && textboxScopeOfParagraph(part, position.paragraphId);
  if (!scope) return;
  if (!surface.setActiveScope(rId ? { ...scope, owner: { kind: 'headerFooter', rId } } : scope))
    return;
  surface.setSelection({ anchor: position, head: position });
}

/**
 * Document order of the paragraphs in the open text box, nested boxes included, or empty
 * when no box is open. A selection inside a box is in no story's paragraph list, so this is
 * the order a comment on box text is ruled by.
 */
export function openTextboxParagraphOrder(surface: PaginatedSurface): ReadonlyMap<string, number> {
  const order = new Map<string, number>();
  const scope = surface.activeScope();
  if (scope.kind !== 'frame') return order;
  const part = partOfNodeId(surface.session, scope.id);
  const root = part && findNode(part, scope.id);
  if (!root) return order;
  // Depth-first, children pushed in reverse so they pop in document order.
  const stack: OoxmlNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.kind === 'paragraph') order.set(node.id, order.size);
    const children = 'children' in node ? node.children : undefined;
    if (!children) continue;
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]!);
  }
  return order;
}

/**
 * Leave a note or header the caret sits in from a previous card, and open the body text box
 * the card's change sits in, if any.
 */
export function openBodyStoryOf(surface: PaginatedSurface, position: SemanticPosition): void {
  surface.exitNote?.();
  surface.exitHeaderFooter?.();
  openTextboxAt(surface, position);
}

/**
 * Why a selection cannot be installed because of the text boxes it touches, or null.
 *
 * Both endpoints must be in the same box, or both outside any box, for the same reason two
 * stories are refused. Asked BEFORE anything opens, so a refused selection changes nothing.
 */
export function textboxSelectionRefusal(
  surface: PaginatedSurface,
  selection: { readonly anchor: SemanticPosition; readonly head: SemanticPosition }
): string | null {
  const part = partOfNodeId(surface.session, selection.head.paragraphId);
  const box = part ? textboxScopeOfParagraph(part, selection.head.paragraphId) : null;
  const anchorBox = part ? textboxScopeOfParagraph(part, selection.anchor.paragraphId) : null;
  return (box?.id ?? null) === (anchorBox?.id ?? null)
    ? null
    : 'a selection cannot span two stories';
}

/**
 * Open or leave the text box a selection is in, once the story around it is open.
 *
 * A selection inside a box was installed with the box closed: the caret sat in the box's
 * paragraph while the scope stayed on the story behind it. A box that cannot open, because
 * the document is open for viewing or the box takes no caret, leaves the scope on the story
 * around it, and the selection is still installed, so a read-only selection keeps working.
 */
export function openTextboxForSelection(
  surface: PaginatedSurface,
  selection: { readonly head: SemanticPosition }
): void {
  const part = partOfNodeId(surface.session, selection.head.paragraphId);
  const box = part ? textboxScopeOfParagraph(part, selection.head.paragraphId) : null;
  const active = surface.activeScope();
  const owner =
    active.kind === 'headerFooter'
      ? { kind: 'headerFooter' as const, rId: active.rId }
      : active.kind === 'frame'
        ? active.owner
        : undefined;
  if (!box) {
    // Leave an open box for the story it sits in.
    if (active.kind === 'frame') surface.setActiveScope(owner ?? { kind: 'body' });
    return;
  }
  if (active.kind === 'frame' && active.id === box.id) return;
  surface.setActiveScope(owner ? { ...box, owner } : box);
}
