// Keyboard motions at a soft wrap paint the caret where the reader put it, and typed text
// lands where the layout puts it.

import { afterEach, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { caretStops } from '../../layout/semantic-interaction.ts';
import { linesOf } from '../../layout/semantic-records.ts';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WORDS = 'aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk llll mmmm nnnn oooo pppp';
const HEBREW = 'אבגד הוזח טיכל מנסע פצקר שתאב גדהו זחטי כלמנ סעפצ קרשת אבגד הוזח טיכל';

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

function mount(paragraph: string) {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, docx(paragraph), { scale: 1 });
  if (!opened.ok) throw Error(opened.reason);
  mounted.push({ surface: opened.surface, container });
  const surface = opened.surface;
  // The engine paints its own caret only while the pages hold focus.
  surface.focus();
  const lines = linesOf(surface.layout());
  const paragraphId = lines[0]!.range.paragraphId;
  /** The line index the painted caret sits on, matched through the layout's caret stops. */
  const caretLine = () => {
    const caret = container.querySelector<HTMLElement>('[data-docx-caret]')!;
    const top = Number.parseFloat(caret.style.top);
    const ids = linesOf(surface.layout()).map((line) => line.id);
    let best = -1;
    let distance = Infinity;
    for (const stop of caretStops(surface.layout())) {
      const index = ids.indexOf(stop.lineId);
      if (index >= 0 && Math.abs(stop.y - top) < distance) {
        distance = Math.abs(stop.y - top);
        best = index;
      }
    }
    return best;
  };
  const typedLine = () =>
    linesOf(surface.layout()).findIndex((line) => line.spans.some((s) => s.text.includes('#')));
  const at = (offset: number) => {
    surface.setSelection({ anchor: { paragraphId, offset }, head: { paragraphId, offset } });
  };
  return { surface, lines, caretLine, typedLine, at };
}

for (const [label, paragraph] of [
  ['left-to-right', `<w:p><w:r><w:t xml:space="preserve">${WORDS}</w:t></w:r></w:p>`],
  [
    'right-to-left',
    `<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:rPr><w:rtl/></w:rPr><w:t xml:space="preserve">${HEBREW}</w:t></w:r></w:p>`,
  ],
] as const) {
  test(`End, Home, Up and Down at a soft wrap: ${label}`, () => {
    const { surface, lines, caretLine, typedLine, at } = mount(paragraph);
    expect(lines.length).toBeGreaterThan(2);
    const b = lines[1]!.range.start;

    // Placed at the offset: the next line's start.
    at(b);
    expect(caretLine()).toBe(1);

    // End: after the trailing space, painted on the upper line.
    at(2);
    surface.navigate('lineEnd');
    expect(surface.state().selection.head.offset).toBe(b);
    expect(caretLine()).toBe(0);

    // Down from there is the next line, and Up comes back to the end of the upper line.
    surface.navigate('down');
    expect(caretLine()).toBe(1);
    surface.navigate('up');
    expect(caretLine()).toBe(0);

    // Home from the end of the upper line is that line's start.
    at(2);
    surface.navigate('lineEnd');
    surface.navigate('lineStart');
    expect(surface.state().selection.head.offset).toBe(0);

    // Home on the lower line: its first position, not after its first character.
    at(b + 3);
    surface.navigate('lineStart');
    expect(surface.state().selection.head.offset).toBe(b);
    expect(caretLine()).toBe(1);
    surface.type('#');
    expect(typedLine()).toBe(1);
    surface.undo();

    // Shift+End keeps the head's line for the next motion.
    at(2);
    surface.navigate('lineEnd', true);
    expect(surface.state().selection.head.offset).toBe(b);
    surface.navigate('lineStart', true);
    expect(surface.state().selection.head.offset).toBe(0);

    // Typing at the end of the upper line, then undo: the restored caret has no line
    // affinity, so it shows at the next line's start, where the next typed text lands.
    at(2);
    surface.navigate('lineEnd');
    expect(caretLine()).toBe(0);
    surface.type('#');
    surface.undo();
    expect(surface.state().selection.head.offset).toBe(b);
    expect(caretLine()).toBe(1);
  });
}
