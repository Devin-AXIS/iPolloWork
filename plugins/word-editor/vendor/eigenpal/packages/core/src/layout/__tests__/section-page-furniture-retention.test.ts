// A published footer's NUMPAGES projector must not keep the layout pass that placed it.
//
// Finalize keeps each published story's projector so a reused sheet can re-project its page
// count later. The projector used to close over the section factory's inputs, and with them
// the pass's page counter, which reached every prepass, flow state and table memo of that
// pass for as long as the sheet was reused. A long document kept every pass of its open.

import { expect, test } from 'bun:test';
import { createSectionPageFurniture } from '../section-page-furniture.ts';
import type { HeaderFooterStoryLayout } from '../hf-layout.ts';
import type { PageFurniture, PageContentInsets } from '../page-furniture-insets.ts';

test('a footer projector holds its placement, not the pass page counter', () => {
  const story = {
    partName: '/word/footer1.xml',
    contentKey: 'footer',
    fragments: [],
    flowHeight: 12,
    pageFieldNeeds: { hasPage: false, hasNumPages: true, hasSectionPages: false },
    withPageContext: () => story,
  } as unknown as HeaderFooterStoryLayout;
  const furniture: PageFurniture = {
    titlePage: false,
    evenAndOddHeaders: false,
    headers: new Map(),
    footers: new Map([['default', story]]),
  };
  const insets = { top: 72, bottom: 72 } as unknown as PageContentInsets;

  const { footer, released } = (() => {
    // Stands in for the pass state a page counter closure reaches.
    const passState = { pages: new Array(1000).fill(0) };
    const sections = createSectionPageFurniture({
      furniture,
      geometry: {
        width: 612,
        height: 792,
        margin: { top: 72, right: 72, bottom: 72, left: 72 },
      } as never,
      headerDistance: 36,
      footerDistance: 36,
      pageIndexStart: 0,
      contentWidth: 468,
      insetsFor: () => insets,
      pageCount: () => passState.pages.length,
    });
    return {
      footer: sections.furnitureFor('footer', 0, { x: 0, y: 0, width: 612, height: 792 }),
      released: new WeakRef(passState),
    };
  })();

  expect(footer?.pageFieldProjector).toBeDefined();
  Bun.gc(true);
  expect(released.deref()).toBeUndefined();
  // The projector still re-projects from its own placement.
  const projected = footer!.pageFieldProjector!({ pageNumber: 1, pageCount: 3, sheetNumber: 1 });
  expect(projected.box.y).toBe(footer!.box.y);
});
