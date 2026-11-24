// Shared scoped-story navigation for facade search and review activation.

import type { DocumentEditingMode, ExecResult, TextMatch, ViewScope } from '../contracts/editor.ts';
import type { SemanticPosition } from '../layout/semantic-interaction.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { drawingSelectionPosition } from './surface-drawing-selection.ts';
import { captureSearchResult } from './document-search-result.ts';
import { openTextboxAt } from './review-story-entry.ts';
import {
  isActiveStory,
  resolveTextTarget,
  textTargetArgumentRefusal,
  type TextTarget,
} from './text-target.ts';

type ScopedStory =
  | {
      readonly kind: 'headerFooter';
      readonly rId: string;
      readonly furnitureKind?: 'header' | 'footer';
    }
  | { readonly kind: 'note'; readonly id: string };

/** Enter one non-body story at a model position. */
export function enterStoryPosition(
  surface: PaginatedSurface,
  scope: ScopedStory,
  position: SemanticPosition
): ExecResult {
  if (scope.kind === 'note') {
    const entered = surface.enterNote?.(scope.id, position);
    return entered
      ? { ok: true, changed: false }
      : { ok: false, code: 'unsupported', reason: 'the note could not be opened' };
  }

  const entered = scope.furnitureKind
    ? surface.enterHeaderFooter?.({
        rId: scope.rId,
        kind: scope.furnitureKind,
        position,
      })
    : surface.enterHeaderFooter?.({ rId: scope.rId, position });
  if (!entered)
    return { ok: false, code: 'unsupported', reason: 'the header or footer could not be opened' };
  // A position in a box in the header opens the box too; the header alone clamps it away.
  openTextboxAt(surface, position, scope.rId);
  return { ok: true, changed: false };
}

/** Whether a public view scope is one this helper can open. */
export function isScopedStory(scope: ViewScope | undefined): scope is ScopedStory {
  return scope?.kind === 'headerFooter' || scope?.kind === 'note';
}

/** Whether navigation can open every non-body story returned by document search. */
export function searchStoriesForSurface(
  surface: PaginatedSurface,
  editingMode: DocumentEditingMode
): 'all' | 'body' {
  return editingMode !== 'viewing' &&
    typeof surface.enterHeaderFooter === 'function' &&
    typeof surface.enterNote === 'function'
    ? 'all'
    : 'body';
}

/** Leave a scoped story only when the destination is a body paragraph. */
export function leaveScopeForBodyParagraph(surface: PaginatedSurface, paragraphId: string): void {
  if (surface.activeScope().kind === 'body') return;
  if (!surface.session.paragraphIds().includes(paragraphId)) return;
  if (surface.activeScope().kind === 'frame') surface.setActiveScope({ kind: 'body' });
  surface.exitNote?.();
  surface.exitHeaderFooter?.();
}

/**
 * Select and reveal one match, or one computed range, in the story that owns it. The story
 * comes from the paragraph when the target names none, and a target whose expected text is
 * no longer at its offsets is refused before anything opens or moves.
 */
export function selectDocumentSearchMatch(
  surface: PaginatedSurface,
  match: TextTarget
): ExecResult {
  const malformed = textTargetArgumentRefusal(match);
  if (malformed) return { ok: false, code: 'invalidArgs', reason: malformed };
  // Selecting part of a field result selects the field, as typing over it would.
  const resolved = resolveTextTarget(surface, match, 'accept');
  if (!resolved.ok) return resolved;
  const scope = resolved.scope;
  if (scope.kind === 'frame') {
    const { drawingNodeId, hostParagraphId } = scope;
    // The types make an id-less frame scope unrepresentable, but a host calls this from
    // JavaScript, where they are whatever it passed.
    if (
      typeof drawingNodeId !== 'string' ||
      drawingNodeId.length === 0 ||
      typeof hostParagraphId !== 'string' ||
      hostParagraphId.length === 0
    ) {
      return {
        ok: false,
        code: 'invalidArgs',
        reason: 'a frame match must carry drawing and host paragraph ids',
      };
    }
    // Resolve BEFORE opening anything. A text box can be enumerated and still have no painted
    // frame — clipped to nothing, or positioned off the page — and entering a header only to
    // fail would leave the reader in a story they never asked to open, caret moved.
    const unselectable: ExecResult = {
      ok: false,
      code: 'unsupported',
      reason: 'the text box drawing could not be selected',
    };
    if (!drawingSelectionPosition(surface.layout(), drawingNodeId, hostParagraphId)) {
      return unselectable;
    }
    const owner = scope.owner;
    if (owner) {
      const entered = enterStoryPosition(surface, owner, {
        paragraphId: hostParagraphId,
        offset: 0,
      });
      if (!entered.ok) return entered;
    } else {
      leaveScopeForBodyParagraph(surface, hostParagraphId);
    }
    surface.revealParagraph(hostParagraphId);
    return surface.selectDrawing(drawingNodeId, hostParagraphId)
      ? { ok: true, changed: false }
      : unselectable;
  }
  const position = { paragraphId: match.blockId, offset: match.start };
  if (isScopedStory(scope)) {
    const entered = enterStoryPosition(surface, scope, position);
    if (!entered.ok) return entered;
  } else {
    leaveScopeForBodyParagraph(surface, match.blockId);
  }
  // Never select into a story the reader is not in: the toolbar and typing follow the scope.
  if (!isActiveStory(surface, scope)) {
    return {
      ok: false,
      code: 'unsupported',
      reason: 'the story that holds the match could not be opened',
    };
  }
  surface.setSelection({
    anchor: position,
    head: { paragraphId: match.blockId, offset: match.start + match.length },
  });
  surface.revealParagraph(match.blockId);
  return { ok: true, changed: false };
}

/**
 * `findMatches`: one term, or many terms in one walk of the document. Each answer is noted for
 * highlighting and keeps its truncation flag.
 */
export function findDocumentMatches(
  surface: PaginatedSurface | null,
  editingMode: DocumentEditingMode,
  noteMatches: (matches: readonly TextMatch[]) => readonly TextMatch[],
  query: string | readonly string[],
  options?: { readonly matchCase?: boolean; readonly wholeWord?: boolean }
): readonly TextMatch[] | readonly (readonly TextMatch[])[] {
  const scan = {
    ...(options?.matchCase !== undefined ? { matchCase: options.matchCase } : {}),
    ...(options?.wholeWord !== undefined ? { wholeWord: options.wholeWord } : {}),
    ...(surface ? { stories: searchStoriesForSurface(surface, editingMode) } : {}),
  };
  if (typeof query === 'string') {
    return captureSearchResult(surface?.session.findText(query, scan), noteMatches);
  }
  const results = surface?.session.findText(query, scan);
  return query.map((_, index) => captureSearchResult(results?.[index], noteMatches));
}
