import type { DocAnchor, EditorAnchorNavigation } from '../contracts/editor.ts';
import { paragraphFragmentsOf } from '../layout/semantic-record-queries.ts';
import { isDocAnchor, resolveDocAnchor } from './anchor-resolution.ts';
import { createParagraphHighlights } from './paragraph-highlights.ts';
import type { RefreshHost } from './document-refresh-host.ts';
import type { DocxEditorInstance } from './docx-editor-types.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { revealScrollOptions } from './reveal-scroll-options.ts';
import { progressiveOpenPending as stillOpening } from './surface-progressive-open.ts';

/** Resolve against committed text: session reads sit below the input buffer. */
function resolveAnchor(surface: PaginatedSurface, anchor: DocAnchor) {
  surface.flushPendingInput();
  const resolved = resolveDocAnchor(
    surface.session.part(),
    surface.session.paragraphAnchors(),
    anchor
  );
  return resolved.ok ? resolved.span : null;
}

/**
 * External paragraph references: scrolling and temporary highlights. Highlights share the
 * refresh presentation layer with their own overlay set, created on first use.
 */
export function createAnchorNavigation(
  getEditor: () => DocxEditorInstance,
  getHost: () => RefreshHost | undefined,
  flushOpen: () => void
): EditorAnchorNavigation {
  let highlights: ReturnType<typeof createParagraphHighlights> | null = null;
  const presenter = (host: RefreshHost) => {
    if (highlights) return highlights;
    const editor = getEditor();
    const created = createParagraphHighlights(
      editor,
      host,
      {
        marker: 'data-docx-anchor-highlight',
        defaultColor: 'var(--doc-anchor-highlight-color)',
      },
      () => {}
    );
    // Node ids name one loaded document. Never paint them over a replacement or another mount.
    host.invalidated.add(() => created.clear());
    editor.on('change', (change) => {
      if (change.source) created.clear();
    });
    highlights = created;
    return created;
  };
  return {
    scrollToAnchor(anchor, options = {}) {
      const host = getHost();
      const reveal = revealScrollOptions(options, 'centerIfNeeded', host?.container() ?? null);
      if (!isDocAnchor(anchor)) return false;
      flushOpen();
      const surface = host?.surface();
      if (!surface) return false;
      const span = resolveAnchor(surface, anchor);
      // Reveal directly: selecting or entering a story would move the caller's caret.
      return (
        !!span && surface.revealPosition({ paragraphId: span.nodeId, offset: span.start }, reveal)
      );
    },
    highlightAnchor(anchor, options) {
      const host = getHost();
      if (!host) return false;
      const presentation = presenter(host);
      // Validate the complete request before resolving, like highlightChanges().
      presentation.validate(options);
      if (!isDocAnchor(anchor)) return false;
      flushOpen();
      const surface = host.surface();
      if (!surface || !host.container() || host.source) return false;
      const paragraphId = resolveAnchor(surface, anchor)?.nodeId;
      if (!paragraphId) return false;
      // Overlays attach to body page content. Header, footer, and note stories are refused.
      const placed = surface
        .layout()
        .pages.some((page) =>
          paragraphFragmentsOf(page).some((fragment) => fragment.paragraphId === paragraphId)
        );
      // A body paragraph that a large open has not laid out yet shows its highlight when it is.
      if (
        !placed &&
        !(stillOpening(surface) && surface.session.paragraphIds().includes(paragraphId))
      )
        return false;
      presentation.show([{ paragraphId }], options);
      return true;
    },
    clearAnchorHighlight(options) {
      const host = getHost();
      if (host) presenter(host).hide(options);
    },
  };
}
