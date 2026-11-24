import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';

test.each(['center', 'right'] as const)(
  '%s ignores the wrapped space while retaining its model range',
  (alignment) => {
    const read = readOoxmlPart(
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
    <w:p><w:pPr><w:jc w:val="${alignment}"/></w:pPr><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>AB CD EF</w:t></w:r></w:p>
    </w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!read.ok) throw new Error(read.reason);
    const xml = serializeOoxmlPart(read.part);
    const laid = layoutSemanticDocument(read.part, 0, {
      measurer: createFixedMeasurer(6, 12),
      geometry: { width: 45, height: 200, margin: { left: 10, right: 10, top: 10, bottom: 10 } },
    });
    const paragraph = laid.pages[0]!.fragments.find((fragment) => fragment.kind === 'paragraph')!;
    expect(paragraph.lines).toHaveLength(3);
    const first = paragraph.lines[0]!.spans[0]!;
    expect(first.text).toBe('AB ');
    expect(first.range).toMatchObject({ start: 0, end: 3 });
    expect(first.box.width).toBe(18);
    expect(first.box.x).toBeCloseTo(alignment === 'center' ? 6.5 : 13, 6);
    expect(serializeOoxmlPart(read.part)).toBe(xml);
  }
);

// Word spells a bidi paragraph's physical RIGHT edge `left`: it is the leading edge.
const jcFor = (alignment: 'center' | 'right') => (alignment === 'right' ? 'left' : alignment);

// A wrapped space stands at the left of right-to-left text. In a `w:rtl` run it hangs there;
// in a left-to-right run, where its direction differs from the run's, it takes room.
test.each([
  { alignment: 'center', rtlRun: true, visibleX: 6.5 },
  { alignment: 'right', rtlRun: true, visibleX: 13 },
  { alignment: 'center', rtlRun: false, visibleX: 9.5 },
  { alignment: 'right', rtlRun: false, visibleX: 13 },
] as const)(
  'RTL $alignment anchors visible text beside its wrapped space (w:rtl run: $rtlRun)',
  ({ alignment, rtlRun, visibleX }) => {
    const read = readOoxmlPart(
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
      <w:p><w:pPr><w:bidi/><w:jc w:val="${jcFor(alignment)}"/></w:pPr><w:r><w:rPr>${rtlRun ? '<w:rtl/><w:szCs w:val="22"/>' : ''}<w:sz w:val="22"/></w:rPr><w:t>אב גד הו</w:t></w:r></w:p>
      </w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!read.ok) throw new Error(read.reason);
    const before = serializeOoxmlPart(read.part);
    const laid = layoutSemanticDocument(read.part, 0, {
      measurer: createFixedMeasurer(6, 12),
      geometry: { width: 45, height: 200, margin: { left: 10, right: 10, top: 10, bottom: 10 } },
    });
    const paragraph = laid.pages[0]!.fragments.find((fragment) => fragment.kind === 'paragraph')!;
    expect(paragraph.lines).toHaveLength(3);
    const spans = paragraph.lines[0]!.spans;
    expect(spans.map((span) => span.text).join('')).toBe('אב ');
    const visible = spans.find((span) => span.text === 'אב')!;
    const whitespace = spans.find((span) => span.text === ' ')!;
    expect(visible.box.x).toBeCloseTo(visibleX, 6);
    expect(whitespace.box.x + whitespace.box.width).toBeCloseTo(visible.box.x, 6);
    expect(whitespace.range).toMatchObject({ start: 2, end: 3 });
    expect(serializeOoxmlPart(read.part)).toBe(before);
  }
);
