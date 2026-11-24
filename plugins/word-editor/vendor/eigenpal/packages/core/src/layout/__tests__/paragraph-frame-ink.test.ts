import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/index.ts';
import { paintSemanticLayout } from '../../output/semantic-paint.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { ParagraphFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const frame = '<w:framePr w:w="2000" w:h="2000" w:hRule="exact"/>';
const paragraph = (text: string, position: number, framed = true) =>
  `<w:p><w:pPr><w:widowControl w:val="0"/><w:spacing w:before="0" w:after="0" w:line="200" w:lineRule="exact"/>${framed ? frame : ''}</w:pPr><w:r><w:rPr><w:sz w:val="22"/><w:position w:val="${position}"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;

for (const position of [-40, -220]) {
  test(`shared exact-height frame clips shifted ink at the frame boundary: ${position}`, () => {
    const parsed = readOoxmlPart(
      `<w:document xmlns:w="${W}"><w:body>${paragraph('shifted', position)}${paragraph('second', 0)}${paragraph('anchor', 0, false)}</w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'application/xml' }
    );
    if (!parsed.ok) throw new Error(parsed.reason);
    const before = serializeOoxmlPart(parsed.part);
    const layout = layoutSemanticDocument(parsed.part, 0, {
      measurer: createFixedMeasurer(6, 10),
      geometry: { width: 200, height: 200, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
    });
    const frames = layout.pages
      .flatMap((page) => page.fragments)
      .filter(
        (fragment): fragment is ParagraphFragmentRecord =>
          fragment.kind === 'paragraph' && fragment.positionedFrame !== undefined
      );
    expect(frames).toHaveLength(2);
    const [first, second] = frames;
    expect(first!.box).toEqual(first!.positionedFrame!.box);
    expect(second!.box).toEqual(first!.box);
    const line = first!.lines[0]!;
    const baseline = line.box.y + line.baseline - line.spans[0]!.style.baselineShiftPt;
    const bottom = first!.box.y + first!.box.height;
    if (position === -40) expect(baseline).toBeLessThan(bottom);
    else expect(baseline).toBeGreaterThan(bottom);
    expect(second!.lines[0]!.box.y).toBe(line.box.y + 10);

    const container = document.createElement('div');
    paintSemanticLayout(container, layout, { scale: 1 });
    const painted = container.querySelectorAll<HTMLElement>('.docx-paragraph-fragment');
    for (const element of [painted[0]!, painted[1]!]) {
      expect(element.style.overflow).toBe('hidden');
      expect(element.style.height).toBe('100px');
      expect(element.style.top).toBe(`${first!.box.y}px`);
    }
    expect(painted[0]!.textContent).toBe('shifted');
    expect(painted[1]!.textContent).toBe('second');
    expect(serializeOoxmlPart(parsed.part)).toBe(before);
  });
}
