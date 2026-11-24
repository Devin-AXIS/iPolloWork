import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { caretAt, paragraphTextFromLayout } from '../semantic-interaction.ts';
import { hitTestPage } from '../semantic-hit-test.ts';
import { forEachSemanticSpan } from '../export-traversal.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const run = (text: string) => `<w:r><w:t>${text}</w:t></w:r>`;
const measurer = createFixedMeasurer(6, 14);

for (const displayMode of ['proposed', 'original'] as const) {
  test.each([false, true])(
    `${displayMode} RTL merged members retain source identity (table=%s)`,
    (table) => {
      const mark = displayMode === 'proposed' ? 'del' : 'ins';
      const paragraphs = `<w:p><w:pPr><w:rPr><w:${mark} w:id="1" w:author="A"/></w:rPr></w:pPr>${run('مر')}${run('حبا')}</w:p><w:p><w:pPr><w:bidi/></w:pPr>${run('عالم')}${run('عالمعالم')}</w:p>`;
      const content = table
        ? `<w:tbl><w:tblGrid><w:gridCol w:w="6000"/></w:tblGrid><w:tr><w:tc>${paragraphs}</w:tc></w:tr></w:tbl>`
        : paragraphs;
      const source = readOoxmlPart(
        `<w:document xmlns:w="${W}"><w:body>${content}</w:body></w:document>`,
        { name: '/word/document.xml', contentType: 'app/xml' }
      );
      if (!source.ok) throw Error(source.reason);
      const layout = layoutSemanticDocument(source.part, 0, { measurer, displayMode });
      const spans: Array<{ text: string; paragraphId: string; start: number; end: number }> = [];
      forEachSemanticSpan(layout, ({ span }) => spans.push({ text: span.text, ...span.range }));
      spans.sort((a, b) => a.paragraphId.localeCompare(b.paragraphId));
      expect(spans.map((s) => [s.text, s.start, s.end])).toEqual([
        ['مرحبا', 0, 5],
        ['عالمعالمعالم', 0, 12],
      ]);
      expect(spans[0]!.paragraphId).not.toBe(spans[1]!.paragraphId);
      forEachSemanticSpan(layout, ({ span }) => {
        const point = { x: span.box.x + 0.1, y: span.box.y + 2 };
        expect(hitTestPage(layout, 0, point, { measurer })?.position).toEqual({
          paragraphId: span.range.paragraphId,
          offset: span.range.end,
        });
      });
      for (const span of spans) {
        expect(paragraphTextFromLayout(layout, span.paragraphId)).toBe(span.text);
        for (let offset = 0; offset <= span.end; offset++) {
          expect(
            caretAt(layout, { paragraphId: span.paragraphId, offset }, measurer)
          ).not.toBeNull();
        }
      }
    }
  );
}

test('hits in mixed bidi merged members retain the physical span owner', () => {
  const body = `<w:p><w:pPr><w:rPr><w:del w:id="1" w:author="A"/></w:rPr></w:pPr>${run('ABC مرحبا DEF')}</w:p><w:p><w:pPr><w:bidi/></w:pPr>${run('عالم XYZ عالمعالم')}</w:p>`;
  const source = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!source.ok) throw Error(source.reason);
  const layout = layoutSemanticDocument(source.part, 0, { measurer, displayMode: 'proposed' });
  forEachSemanticSpan(layout, ({ span }) => {
    const hit = hitTestPage(
      layout,
      0,
      { x: span.box.x + span.box.width / 2, y: span.box.y + 2 },
      { measurer }
    );
    expect(hit?.position.paragraphId).toBe(span.range.paragraphId);
    expect(hit!.position.offset).toBeGreaterThanOrEqual(span.range.start);
    expect(hit!.position.offset).toBeLessThanOrEqual(span.range.end);
  });
});
