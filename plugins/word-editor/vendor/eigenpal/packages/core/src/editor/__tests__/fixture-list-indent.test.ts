// Regression guard against the real comprehensive fixture.
//
// Its "Simple Bullet List" and "Upper Roman" list both use a `w:abstractNum` that declares
// only `ilvl 0`. Demoting past the deepest declared level resolved to no marker at all, so
// the paragraph silently stopped being a list item and sprang back to the margin — the
// bullet and the roman numeral simply vanished.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';

const BYTES = new Uint8Array(
  readFileSync(
    new URL('../../../../../e2e/fixtures/comprehensive-word-element-test.docx', import.meta.url)
  )
);

/**
 * Mount, run, tear down.
 *
 * The surface owns the DOCUMENT selection while it is mounted, and these tests share a
 * happy-dom global with every other suite — a surface left behind keeps the selection and
 * the next file's assertions read this document's caret instead of their own.
 */
function withFixture(run: (surface: PaginatedSurface) => void): void {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, BYTES);
  if (!opened.ok) throw new Error(opened.reason);
  try {
    run(opened.surface);
  } finally {
    opened.surface.destroy();
    container.remove();
  }
}

/** The paragraph whose text starts with `prefix`, and the marker layout resolved for it. */
function itemNamed(surface: PaginatedSurface, prefix: string) {
  for (const page of surface.layout().pages) {
    for (const fragment of page.fragments) {
      if (fragment.kind !== 'paragraph') continue;
      const text = fragment.lines.flatMap((line) => line.spans.map((span) => span.text)).join('');
      if (text.startsWith(prefix)) return fragment;
    }
  }
  throw new Error(`no paragraph starting "${prefix}"`);
}

const caretIn = (surface: PaginatedSurface, paragraphId: string) =>
  surface.setSelection({
    anchor: { paragraphId, offset: 0 },
    head: { paragraphId, offset: 0 },
  });

describe('a real document whose list declares only level 0', () => {
  test('indenting declares the level and the bullet cycles, as Word does', () => {
    withFixture((surface) => {
      const item = itemNamed(surface, 'First bullet item');
      expect(item.marker?.text).toBe('•');
      caretIn(surface, item.paragraphId);

      expect(surface.canAdjustIndent('increase')).toBe(true);
      expect(surface.adjustIndent('increase')).toBe(true);
      // Depth 1 of Word's stock bullet cycle: Courier `o`.
      expect(itemNamed(surface, 'First bullet item').marker).toMatchObject({
        text: 'o',
        level: 1,
      });
      // And back out to the item's own authored level.
      expect(surface.adjustIndent('decrease')).toBe(true);
      expect(itemNamed(surface, 'First bullet item').marker?.text).toBe('•');
    });
  });

  test('the roman numeral cycles through the number formats too', () => {
    withFixture((surface) => {
      const item = itemNamed(surface, 'Introduction');
      expect(item.marker?.text).toBe('I.');
      caretIn(surface, item.paragraphId);

      expect(surface.canAdjustIndent('increase')).toBe(true);
      expect(surface.adjustIndent('increase')).toBe(true);
      // Depth 1 of Word's default cycle is lowerLetter.
      expect(itemNamed(surface, 'Introduction').marker?.text).toBe('a.');
    });
  });

  test('a list that DOES declare deeper levels still demotes', () => {
    withFixture((surface) => {
      const item = itemNamed(surface, 'Level 0: Main category');
      caretIn(surface, item.paragraphId);
      expect(surface.canAdjustIndent('increase')).toBe(true);
      expect(surface.adjustIndent('increase')).toBe(true);
      // Its own definition declares four levels, so level 1 resolves to a real marker.
      expect(itemNamed(surface, 'Level 0: Main category').marker?.level).toBe(1);
    });
  });

  test('a numbered item never reports itself as a bullet', () => {
    withFixture((surface) => {
      const item = itemNamed(surface, 'First numbered item');
      caretIn(surface, item.paragraphId);
      expect(surface.isListActive('ordered')).toBe(true);
      expect(surface.isListActive('bullet')).toBe(false);
    });
  });

  test('a level-0 item of a MULTI-level list still cannot outdent', () => {
    // Its definition declares four levels, so indenting IS possible — but there is no
    // level above 0 to outdent to, and Word greys Decrease Indent out there.
    withFixture((surface) => {
      const item = itemNamed(surface, 'Level 0: Main category');
      expect(item.marker?.level).toBe(0);
      caretIn(surface, item.paragraphId);
      expect(surface.canAdjustIndent('increase')).toBe(true);
      expect(surface.canAdjustIndent('decrease')).toBe(false);
      expect(surface.adjustIndent('decrease')).toBe(false);
    });
  });

  test('a nested item CAN outdent', () => {
    withFixture((surface) => {
      const item = itemNamed(surface, 'Level 1: Sub-category');
      expect(item.marker?.level).toBe(1);
      caretIn(surface, item.paragraphId);
      expect(surface.canAdjustIndent('decrease')).toBe(true);
    });
  });

  test('a level-0 item cannot outdent', () => {
    withFixture((surface) => {
      const item = itemNamed(surface, 'First bullet item');
      caretIn(surface, item.paragraphId);
      expect(surface.canAdjustIndent('decrease')).toBe(false);
    });
  });
});

describe('the snapshot follows the caret', () => {
  test('moving the caret to a different paragraph publishes a new snapshot', () => {
    // `snapshot().selection` is deliberately null, so two paragraphs with the same
    // formatting derive a VALUE-equal snapshot. Reusing the reference then froze every
    // control whose enabled state is a question about the caret: Decrease Indent stayed
    // live on an outermost list item, and the bullet button stayed pressed after the
    // caret moved into a numbered one.
    withFixture((surface) => {
      const first = itemNamed(surface, 'First bullet item');
      const second = itemNamed(surface, 'Second bullet item');
      caretIn(surface, first.paragraphId);
      expect(surface.canAdjustIndent('decrease')).toBe(false);
      caretIn(surface, second.paragraphId);
      expect(surface.canAdjustIndent('decrease')).toBe(false);

      // And the answer genuinely changes when the caret lands somewhere it differs.
      const nested = itemNamed(surface, 'Level 1: Sub-category');
      caretIn(surface, nested.paragraphId);
      expect(surface.canAdjustIndent('decrease')).toBe(true);
    });
  });
});
