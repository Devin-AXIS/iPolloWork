// A click at the start edge of a wrapped line paints the caret on that line, and the next
// typed character lands on the same line.

import { afterEach, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { linesOf } from '../../layout/semantic-records.ts';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function docx(paragraph: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${paragraph}` +
        '<w:sectPr><w:pgSz w:w="4000" w:h="8000"/>' +
        '<w:pgMar w:top="0" w:bottom="0" w:left="0" w:right="0" w:header="0" w:footer="0"/>' +
        '</w:sectPr></w:body></w:document>'
    ),
  });
}

const mounted: { surface: PaginatedSurface; container: HTMLElement }[] = [];
afterEach(() => {
  for (const item of mounted.splice(0)) {
    item.surface.destroy();
    item.container.remove();
  }
});

const CASES = [
  {
    label: 'left-to-right',
    paragraph:
      '<w:p><w:r><w:t xml:space="preserve">' +
      'aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk llll mmmm nnnn oooo pppp' +
      '</w:t></w:r></w:p>',
    edge: () => -2,
  },
  {
    label: 'right-to-left',
    paragraph:
      '<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:rPr><w:rtl/></w:rPr><w:t xml:space="preserve">' +
      'אבגד הוזח טיכל מנסע פצקר שתאב גדהו זחטי כלמנ סעפצ קרשת אבגד הוזח טיכל' +
      '</w:t></w:r></w:p>',
    edge: (width: number) => width + 2,
  },
] as const;

for (const { label, paragraph, edge } of CASES) {
  test(`a click at a wrapped line start keeps the caret and typing on that line: ${label}`, () => {
    const container = document.createElement('div');
    document.body.append(container);
    const opened = mountPaginatedSurface(container, docx(paragraph), { scale: 1 });
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
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const page = layout.pages[0]!;
    const line = lines[1]!;
    const init = {
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 100 + page.contentBox.x + edge(page.contentBox.width),
      clientY: 50 + page.contentBox.y + line.box.y + line.box.height / 2,
    };
    pages.dispatchEvent(new PointerEvent('pointerdown', init));
    document.dispatchEvent(new PointerEvent('pointerup', init));
    // The clicked offset also ends line 0; the caret must not paint there.
    expect(surface.state().selection.head.offset).toBe(line.range.start);
    const caret = container.querySelector<HTMLElement>('[data-docx-caret]')!;
    expect(Number.parseFloat(caret.style.top)).toBeCloseTo(line.box.y, 4);

    surface.type('#');
    const typedLine = linesOf(surface.layout()).findIndex((entry) =>
      entry.spans.some((span) => span.text.includes('#'))
    );
    expect(typedLine).toBe(1);
  });
}
