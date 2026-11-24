import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { caretAt, keyedRangeRects } from '../semantic-interaction.ts';
import { hitTestFragments } from '../semantic-hit-test.ts';
import { positionedFramePages } from './fixtures/positioned-frame-pages.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const regular = (content: string) =>
  `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="0" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr></w:pPr><w:r><w:rPr><w:sz w:val="2"/></w:rPr>${content}</w:r></w:p>`;

function fixture() {
  const pages = positionedFramePages.map((frames, pageIndex) => {
    const body = frames
      .map(
        ([x, y, width, line, count]) =>
          `<w:p><w:pPr><w:framePr w:x="${x}" w:y="${y}" w:w="${width}"/><w:widowControl w:val="off"/><w:spacing w:before="0" w:after="0" w:line="${line}" w:lineRule="exact"/></w:pPr><w:r><w:t>${'文'.repeat(count!)}</w:t></w:r></w:p>`
      )
      .join('');
    return (
      regular('<w:t xml:space="preserve"> </w:t>') +
      body +
      regular(pageIndex < positionedFramePages.length - 1 ? '<w:br w:type="page"/>' : '')
    );
  });
  const xml = `<w:document xmlns:w="${W}"><w:body>${pages.join('')}<w:sectPr><w:pgSz w:w="11900" w:h="16820"/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0"/></w:sectPr></w:body></w:document>`;
  const parsed = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'application/xml' });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}

test('retains authored pages and cover/TOC frame coordinates from the issue 237 reduction', () => {
  const source = fixture();
  const saved = serializeOoxmlPart(source);
  const layout = layoutSemanticDocument(source, 0, { measurer: createFixedMeasurer(2, 10) });
  expect(layout.pages).toHaveLength(3);
  for (const [pageIndex, expected] of positionedFramePages.entries()) {
    const page = layout.pages[pageIndex]!;
    const frames = page.fragments.filter(
      (fragment) =>
        fragment.kind === 'paragraph' &&
        fragment.props.some((property) => property.localName === 'framePr')
    );
    expect(frames).toHaveLength(expected.length);
    let groupOffset = 0;
    for (const [index, frame] of frames.entries()) {
      if (frame.kind !== 'paragraph') throw new Error('paragraph required');
      const [x, y, width] = expected[index]!;
      const previous = expected[index - 1];
      groupOffset =
        previous && previous[0] === x && previous[1] === y && previous[2] === width
          ? groupOffset + previous[3]! / 20
          : 0;
      expect(frame.box.x).toBeCloseTo(x! / 20, 3);
      expect(frame.box.width).toBeCloseTo(width! / 20, 3);
      // Omitted anchors use the regular paragraph's text origin. The source has
      // only zero-height page furniture before that anchor, bounded to one point.
      expect(frame.box.y).toBeGreaterThanOrEqual(y! / 20 + groupOffset);
      expect(frame.box.y).toBeLessThanOrEqual(y! / 20 + groupOffset + 1);
      const line = frame.lines[0]!;
      const position = { paragraphId: frame.paragraphId, offset: 0 };
      expect(caretAt(layout, position)).toMatchObject({ pageIndex, x: line.box.x, y: line.box.y });
      const hit = hitTestFragments(layout, pageIndex, [frame], {
        x: line.box.x + 0.1,
        y: line.box.y + line.box.height / 2,
      });
      expect(hit?.caret.position.paragraphId).toBe(frame.paragraphId);
      const rects = keyedRangeRects(layout, [
        { key: 'frame', from: position, to: { ...position, offset: 1 } },
      ]).get('frame');
      expect(rects?.[0]).toMatchObject({ pageIndex, x: line.box.x, y: line.box.y });
    }
  }
  expect(serializeOoxmlPart(source)).toBe(saved);
  const reopened = readOoxmlPart(saved, { name: source.name, contentType: source.contentType });
  if (!reopened.ok) throw new Error(reopened.reason);
  expect(
    layoutSemanticDocument(reopened.part, 0, { measurer: createFixedMeasurer(2, 10) }).pages
  ).toEqual(layout.pages);
});
