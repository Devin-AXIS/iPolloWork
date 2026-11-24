import type { Editor } from '../contracts/editor.ts';
import { leaveScopeForBodyParagraph } from './docx-editor-story-navigation.ts';
import type { PaginatedSurface, RevealOptions } from './paginated-surface-contract.ts';
import { revealScrollOptions } from './reveal-scroll-options.ts';

/** Shared browser navigation for the editor and its adapters. Anchors: `docx-editor-anchor-navigation.ts`. */
export function createEditorScrolling(
  getSurface: () => PaginatedSurface | null,
  flushOpen: () => void,
  getContainer: () => HTMLElement | null = () => null
): Pick<Editor, 'scrollToPage' | 'scrollToBlock'> {
  return {
    scrollToPage(pageNumber) {
      if (!Number.isInteger(pageNumber) || pageNumber < 1) return false;
      // Mount a pending document before resolving its page number.
      flushOpen();
      return getSurface()?.revealPage(pageNumber - 1) ?? false;
    },
    scrollToBlock(blockId, options) {
      if (typeof blockId !== 'string' || blockId.length === 0) return false;
      // An invalid option is refused, not read as the default. The same validation as
      // `scrollToAnchor`, with this method's own `'start'` default.
      let reveal: RevealOptions;
      try {
        reveal = revealScrollOptions(options ?? {}, 'start', getContainer());
      } catch {
        return false;
      }
      flushOpen();
      const surface = getSurface();
      // Preserve the existing block navigation behavior when leaving a note or header.
      if (surface) leaveScopeForBodyParagraph(surface, blockId);
      return surface?.revealParagraph(blockId, reveal) ?? false;
    },
  };
}
