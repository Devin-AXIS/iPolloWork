// The author hooks an overlay rectangle carries.
//
// A review band is the only thing over the text that says whose comment it is, and a host
// styles it with the same selectors it styles the card with. So the two have to agree on the
// slot — including past the eighth author, where the roster index and the ramp part company.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { paintSelectionOverlay, type OverlayRect } from '../semantic-selection-overlay.ts';
import { REVIEW_AUTHOR_SLOTS } from '../revision-presentation.ts';
import type { SemanticLayout } from '../../layout/semantic-records.ts';

/** One page, big enough to hold a rectangle. Only `contentBox` is read. */
const LAYOUT = {
  pages: [{ contentBox: { x: 72, y: 72, width: 468, height: 648 } }],
} as unknown as SemanticLayout;

function paint(rects: readonly OverlayRect[]): HTMLElement {
  const layer = document.createElement('div');
  paintSelectionOverlay(layer, LAYOUT, rects, { scale: 1 });
  return layer;
}

const RECT = { pageIndex: 0, x: 0, y: 0, width: 100, height: 12 } as const;

describe('an overlay rectangle carries its review author', () => {
  test('writes the author, the slot, and the resolved colour', () => {
    const layer = paint([
      {
        ...RECT,
        className: 'docx-comment-band',
        reviewAuthor: { author: 'Ada Lovelace', slot: 2, color: '#7d3c98' },
      },
    ]);
    const band = layer.firstElementChild as HTMLElement;
    expect(band.dataset.reviewAuthor).toBe('Ada Lovelace');
    expect(band.dataset.reviewAuthorSlot).toBe('2');
    expect(band.style.getPropertyValue('--doc-review-author-current')).toBe('#7d3c98');
  });

  test('WRAPS the slot to the ramp, so the ninth author matches their card', () => {
    // The roster hands out raw indices, and the ramp defines eight. The card and the painted
    // span both wrap; a band that did not made author nine `8` here and `0` on the card, so a
    // rule keyed on the slot covered one of the two.
    const layer = paint([
      {
        ...RECT,
        className: 'docx-comment-band',
        reviewAuthor: { author: 'Ninth Author', slot: REVIEW_AUTHOR_SLOTS, color: '#c0392b' },
      },
    ]);
    expect((layer.firstElementChild as HTMLElement).dataset.reviewAuthorSlot).toBe('0');
  });

  test('a rectangle with no author carries no author attributes at all', () => {
    // Cell selection and the retained-selection band go through this same painter. An empty
    // `data-review-author` would make them match a host's `[data-review-author]` rules.
    const layer = paint([{ ...RECT }]);
    const rect = layer.firstElementChild as HTMLElement;
    expect(rect.hasAttribute('data-review-author')).toBe(false);
    expect(rect.hasAttribute('data-review-author-slot')).toBe(false);
    expect(rect.style.getPropertyValue('--doc-review-author-current')).toBe('');
  });

  test('a declared active background paints inline and clears the kind rule', () => {
    // The open revision's band. Inline, so it outranks the kind tokens — and the rule
    // with it, so `transparent` clears the whole band rather than leaving a floating
    // underline.
    const layer = paint([
      {
        ...RECT,
        className: 'docx-revision-band docx-revision-band--insert docx-revision-band--active',
        reviewAuthor: { author: 'Ada Lovelace', slot: 0, color: '#c0392b' },
        activeBackground: 'rgba(1, 2, 3, 0.25)',
      },
    ]);
    const band = layer.firstElementChild as HTMLElement;
    expect(band.style.backgroundColor).toBe('rgba(1, 2, 3, 0.25)');
    expect(band.style.boxShadow).toBe('none');
  });

  test('a band without a declared background leaves the stylesheet in charge', () => {
    const layer = paint([
      {
        ...RECT,
        className: 'docx-revision-band docx-revision-band--insert docx-revision-band--active',
        reviewAuthor: { author: 'Ada Lovelace', slot: 0, color: '#c0392b' },
      },
    ]);
    const band = layer.firstElementChild as HTMLElement;
    expect(band.style.backgroundColor).toBe('');
    expect(band.style.boxShadow).toBe('');
  });

  test('an author name from the file is set as a value, never as markup', () => {
    // `w:author` is attacker-controlled. The name goes through `dataset`, so a name shaped
    // like a tag is a string, not an element.
    const hostile = '"><img src=x onerror=alert(1)>';
    const layer = paint([
      { ...RECT, reviewAuthor: { author: hostile, slot: 0, color: '#c0392b' } },
    ]);
    const rect = layer.firstElementChild as HTMLElement;
    expect(rect.dataset.reviewAuthor).toBe(hostile);
    expect(rect.querySelector('img')).toBeNull();
  });
});

describe('a repaint keeps unchanged rectangles', () => {
  test('an identical band keeps its element; a changed one is rebuilt', () => {
    const layer = document.createElement('div');
    const band = { ...RECT, className: 'docx-comment-band' };
    const moved = { ...RECT, y: 20, className: 'docx-comment-band' };
    paintSelectionOverlay(layer, LAYOUT, [band, moved], { scale: 1 });
    const [first, second] = [...layer.children];
    paintSelectionOverlay(layer, LAYOUT, [band, { ...moved, y: 30 }], { scale: 1 });
    expect(layer.children[0]).toBe(first!);
    expect(layer.children[1]).not.toBe(second!);
    expect((layer.children[1] as HTMLElement).style.top).toBe('102px');
    const active = { ...band, className: 'docx-comment-band docx-comment-band--active' };
    paintSelectionOverlay(layer, LAYOUT, [active], { scale: 1 });
    expect(layer.children).toHaveLength(1);
    expect(layer.children[0]).not.toBe(first!);
  });
});
