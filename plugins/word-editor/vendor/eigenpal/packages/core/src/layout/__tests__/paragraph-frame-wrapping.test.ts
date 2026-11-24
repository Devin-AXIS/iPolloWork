import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { ParagraphFragmentRecord } from '../semantic-records.ts';

function render(wrap: string, extra = '', members = 1) {
  const frame = `<w:p><w:pPr><w:framePr w:x="0" w:y="0" w:w="1600" ${wrap ? `w:wrap="${wrap}"` : ''} ${extra}/><w:spacing w:line="400" w:lineRule="exact" w:after="0"/></w:pPr><w:r><w:t>Frame</w:t></w:r></w:p>`;
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${frame.repeat(members)}<w:p><w:pPr><w:spacing w:line="200" w:lineRule="exact"/></w:pPr><w:r><w:t>${'word '.repeat(24)}</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="4000" w:h="6000"/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0"/></w:sectPr></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const layout = layoutSemanticDocument(parsed.part, 0, { measurer: createFixedMeasurer(10, 10) });
  const paragraphs = layout.pages
    .flatMap((page) => page.fragments)
    .filter((block): block is ParagraphFragmentRecord => block.kind === 'paragraph');
  return { layout, frames: paragraphs.slice(0, members), anchor: paragraphs[members]! };
}

test('wraps text beside numeric frames without an image layout port, including default around wrapping', () => {
  for (const wrap of ['', 'auto', 'around', 'tight', 'through']) {
    const { layout, frames, anchor } = render(wrap);
    expect(layout.pages).toHaveLength(1);
    expect(frames[0]!.box.y).toBe(0);
    expect(anchor.lines[0]!.box.y).toBe(0);
    expect(anchor.lines[0]!.contentX).toBeGreaterThanOrEqual(80);
    const below = anchor.lines.find((line) => line.box.y >= 20)!;
    expect(below.contentX).toBe(0);
  }
});

test('none and notBeside clear following text below the frame without moving its text anchor again', () => {
  for (const wrap of ['none', 'notBeside']) {
    const { layout, frames, anchor } = render(wrap, 'w:vSpace="100"');
    expect(layout.pages).toHaveLength(1);
    expect(frames[0]!.box.y).toBe(0);
    expect(anchor.lines[0]!.box.y).toBeCloseTo(25, 3);
    expect(anchor.lines[0]!.contentX).toBe(0);
  }
  const { frames, anchor } = render('around', 'w:vAnchor="page" w:yAlign="inline"');
  expect(frames[0]!.box.y).toBe(0);
  expect(anchor.lines[0]!.box.y).toBe(20);
  const textAnchored = render('around', 'w:yAlign="inline"');
  expect(textAnchored.frames[0]!.box.y).toBe(0);
  expect(textAnchored.anchor.lines[0]!.box.y).toBe(20);
});

test('applies horizontal text distance and wraps around the complete shared frame', () => {
  const { frames, anchor } = render('around', 'w:hSpace="200"', 2);
  expect(frames[0]!.box.y).toBe(0);
  expect(frames[1]!.box.y).toBe(20);
  expect(anchor.lines.filter((line) => line.box.y < 40).every((line) => line.contentX >= 90)).toBe(
    true
  );
  expect(anchor.lines.find((line) => line.box.y >= 40)!.contentX).toBe(0);
});

test('a page-positioned frame wraps the earlier text on its page; a text-positioned one does not', () => {
  const lines = Array.from(
    { length: 10 },
    (_, index) =>
      `<w:p><w:pPr><w:spacing w:line="200" w:lineRule="exact" w:after="0"/></w:pPr><w:r><w:t>Line ${index}</w:t></w:r></w:p>`
  ).join('');
  const layoutWith = (vertical: string) => {
    const frame = `<w:p><w:pPr><w:framePr w:w="1600" w:hAnchor="page" w:x="0" ${vertical}/><w:spacing w:line="400" w:lineRule="exact" w:after="0"/></w:pPr><w:r><w:t>Frame</w:t></w:r></w:p>`;
    const parsed = readOoxmlPart(
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${lines}${frame}<w:p><w:r><w:t>Anchor</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="4000" w:h="6000"/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0"/></w:sectPr></w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'application/xml' }
    );
    if (!parsed.ok) throw new Error(parsed.reason);
    const layout = layoutSemanticDocument(parsed.part, 0, {
      measurer: createFixedMeasurer(10, 10),
    });
    return layout.pages[0]!.fragments.filter(
      (block): block is ParagraphFragmentRecord => block.kind === 'paragraph'
    );
  };
  // The frame covers y 42.5..62.5, which "Line 4" to "Line 6" cross.
  const paged = layoutWith('w:vAnchor="page" w:y="850"');
  for (const index of [4, 5, 6])
    expect(paged[index]!.lines[0]!.contentX).toBeGreaterThanOrEqual(80);
  expect(paged[3]!.lines[0]!.contentX).toBe(0);
  expect(paged[7]!.lines[0]!.contentX).toBe(0);
  const flowing = layoutWith('w:vAnchor="text" w:y="0"');
  expect(flowing.slice(0, 10).every((block) => block.lines[0]!.contentX === 0)).toBe(true);
});

test('an auto-width frame of one single-line paragraph shrinks to its line; more lines keep the column width', () => {
  const layoutWith = (members: readonly string[], jc = 'left') => {
    const frames = members
      .map(
        (text) =>
          `<w:p><w:pPr><w:framePr w:hAnchor="page" w:vAnchor="text" w:x="0" w:y="0" w:hSpace="100"/><w:jc w:val="${jc}"/><w:spacing w:line="200" w:lineRule="exact" w:after="0"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`
      )
      .join('');
    const parsed = readOoxmlPart(
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${frames}<w:p><w:pPr><w:spacing w:line="200" w:lineRule="exact"/></w:pPr><w:r><w:t>${'word '.repeat(24)}</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="4000" w:h="6000"/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0"/></w:sectPr></w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'application/xml' }
    );
    if (!parsed.ok) throw new Error(parsed.reason);
    const layout = layoutSemanticDocument(parsed.part, 0, {
      measurer: createFixedMeasurer(10, 10),
    });
    const paragraphs = layout.pages[0]!.fragments.filter(
      (block): block is ParagraphFragmentRecord => block.kind === 'paragraph'
    );
    return { frames: paragraphs.slice(0, members.length), anchor: paragraphs[members.length]! };
  };
  for (const jc of ['left', 'center', 'right']) {
    const { frames, anchor } = layoutWith(['Short'], jc);
    const line = frames[0]!.lines[0]!;
    const right = Math.max(...line.spans.map((span) => span.box.x + span.box.width));
    expect(line.contentX).toBe(0);
    expect(frames[0]!.positionedFrame!.box.width).toBeCloseTo(right, 6);
    expect(right).toBeLessThan(60);
    // The text beside starts after the frame and its horizontal distance.
    expect(anchor.lines[0]!.contentX).toBeCloseTo(right + 5, 6);
  }
  const two = layoutWith(['Short', 'Tiny']);
  expect(two.frames[0]!.positionedFrame!.box.width).toBe(200);
  expect(two.anchor.lines[0]!.box.y).toBe(20);
});
