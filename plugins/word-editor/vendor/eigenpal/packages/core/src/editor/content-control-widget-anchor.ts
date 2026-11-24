import { contentControlsInLayout, type SemanticLayout } from '@docx-editor.dev/core/layout';
import type { ContentControlMenuAnchor } from './content-control-widget-menu.ts';

/** Where a control's pop-up anchors: under its first fragment, clamped to that page sheet. */
export function contentControlMenuAnchor(
  currentLayout: SemanticLayout,
  scale: number,
  controlId: string,
  pagesLayer: HTMLElement,
  pageOffsets?: ReadonlyMap<number, number>
): ContentControlMenuAnchor | null {
  const record = contentControlsInLayout(currentLayout).find((c) => c.id === controlId);
  const frag = record?.fragments[0];
  const page = frag ? currentLayout.pages[frag.pageIndex] : undefined;
  if (!frag || !page) return null;
  const offsetX = pageOffsets?.get(frag.pageIndex) ?? 0;
  const contentLeft = page.contentBox.x - page.box.x;
  const contentTop = page.contentBox.y - page.box.y;
  return {
    left: (page.box.x + offsetX + contentLeft + frag.box.x) * scale,
    top: (page.box.y + contentTop + frag.box.y + frag.box.height) * scale,
    element:
      [...pagesLayer.querySelectorAll<HTMLElement>('[data-docx-content-control]')]
        .find((node) => node.dataset.docxContentControl === controlId)
        ?.querySelector<HTMLElement>('.docx-content-control-boundary') ?? undefined,
    sheetLeft: (page.box.x + offsetX) * scale,
    sheetRight: (page.box.x + offsetX + page.box.width) * scale,
  };
}
