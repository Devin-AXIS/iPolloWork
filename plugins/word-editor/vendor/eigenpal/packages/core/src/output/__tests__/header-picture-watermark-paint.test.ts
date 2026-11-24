// An authored header picture watermark paints in the header's behind-text layer on every page,
// centered on the margin box, before the page's body content.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import {
  docx,
  layoutOf,
  MARGIN_BOX,
} from '../../export/__tests__/header-picture-watermark-fixture.ts';
import { paintSemanticLayout } from '../semantic-paint.ts';
import type { PaintImageUrlPort } from '../semantic-paint-drawings.ts';

const urlPort: PaintImageUrlPort = {
  create: (handle, mime) => `blob:fake/${mime}/${handle.resourceKey}`,
  revoke: () => {},
};

test('the picture paints behind the body text, centered on the margin box, on every page', async () => {
  const layout = await layoutOf(docx());
  const container = document.createElement('div');
  paintSemanticLayout(container, layout, { scale: 1, imageUrlPort: urlPort, ariaHidden: false });
  const pages = [...container.querySelectorAll<HTMLElement>('.docx-page')];
  expect(pages).toHaveLength(3);
  for (const page of pages) {
    const layer = page.querySelector<HTMLElement>('[data-docx-hf-behind="header"]')!;
    const drawing = layer.querySelector<HTMLElement>('[data-drawing-layer="behind"]')!;
    expect(drawing.querySelector('img')?.getAttribute('src')).toStartWith('blob:fake/image/png/');
    const left = parseFloat(drawing.style.left),
      top = parseFloat(drawing.style.top);
    expect(left + parseFloat(drawing.style.width) / 2).toBeCloseTo(
      MARGIN_BOX.x + MARGIN_BOX.width / 2,
      3
    );
    expect(top + parseFloat(drawing.style.height) / 2).toBeCloseTo(
      MARGIN_BOX.y + MARGIN_BOX.height / 2,
      3
    );
    // The sheet's child order is its paint order: the header layer comes before the body.
    const children = [...page.children];
    expect(children.indexOf(layer)).toBeLessThan(
      children.indexOf(page.querySelector<HTMLElement>('.docx-page-content')!)
    );
  }
});
