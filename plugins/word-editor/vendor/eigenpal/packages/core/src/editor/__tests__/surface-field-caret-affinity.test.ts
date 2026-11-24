import { afterEach, expect, test } from 'bun:test';
import { createFixedMeasurer } from '../../layout/semantic-layout.ts';
import { linesOf } from '../../layout/semantic-records.ts';
import { hitTestPage } from '../../layout/semantic-hit-test.ts';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { semanticSelectionFromDom } from '../dom-selection.ts';
import {
  FIELD_AFFINITY_RESULTS,
  fieldAffinityDocument,
} from './fixtures/field-affinity-document.ts';

const mounted: { surface: PaginatedSurface; container: HTMLElement }[] = [];
afterEach(() => {
  for (const item of mounted.splice(0)) {
    item.surface.destroy();
    item.container.remove();
  }
});
for (const [label, result] of FIELD_AFFINITY_RESULTS) {
  for (const fraction of [0.2, 0.8]) {
    test(`pointer caret and DOM selection keep the clicked field line: ${label}, ${fraction}`, () => {
      const container = document.createElement('div');
      document.body.append(container);
      const opened = mountPaginatedSurface(container, fieldAffinityDocument(result), { scale: 1 });
      if (!opened.ok) throw Error(opened.reason);
      const surface = opened.surface;
      mounted.push({ surface, container });
      const pages = container.querySelector<HTMLElement>('.docx-pages')!;
      Object.defineProperty(pages, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ left: 100, top: 50, width: 1000, height: 2000, right: 1100, bottom: 2050 }),
      });
      const layout = surface.layout();
      const lines = linesOf(layout);
      expect(lines.length).toBeGreaterThanOrEqual(3);
      const middle = lines[1]!;
      const span = middle.spans.find((span) => span.projected)!;
      const point = {
        x: span.box.x + span.box.width * fraction,
        y: middle.box.y + middle.box.height / 2,
      };
      const hit = hitTestPage(layout, 0, point, { measurer: createFixedMeasurer(6, 14) })!;
      const page = layout.pages[0]!;
      const init = {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 1,
        pointerType: 'mouse',
        clientX: 100 + page.contentBox.x + point.x,
        clientY: 50 + page.contentBox.y + point.y,
      };
      pages.dispatchEvent(new PointerEvent('pointerdown', init));
      document.dispatchEvent(new PointerEvent('pointerup', init));
      const caret = container.querySelector<HTMLElement>('[data-docx-caret]')!;
      expect(Boolean(caret)).toBe(true);
      expect(Number.parseFloat(caret.style.left)).toBeCloseTo(hit.caret.x, 4);
      expect(Number.parseFloat(caret.style.top)).toBeCloseTo(hit.caret.y, 4);
      const native = document.getSelection()!;
      const node = native.focusNode!;
      const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement!;
      expect((element.closest('[data-line-id]') as HTMLElement)?.dataset.lineId).toBe(middle.id);
      expect(semanticSelectionFromDom(pages, native)).toEqual(surface.state().selection);
      expect(surface.state().selection.head).toEqual(hit.position);

      // Programmatic movement uses the canonical field boundary, not a stale click hint.
      const position = hit.position;
      surface.setSelection({ anchor: position, head: position });
      const canonical = container.querySelector<HTMLElement>('[data-docx-caret]')!;
      expect(Number.parseFloat(canonical.style.top)).toBeCloseTo(
        (position.offset === 0 ? lines[0]! : lines.at(-1)!).box.y,
        4
      );
    });
  }
}
