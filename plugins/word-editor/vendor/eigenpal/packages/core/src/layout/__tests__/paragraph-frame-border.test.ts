import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { ParagraphFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const BORDER = '<w:pBdr><w:bottom w:val="single" w:sz="4" w:space="1" w:color="auto"/></w:pBdr>';
const AFTER = '<w:spacing w:line="400" w:lineRule="exact" w:after="2200"/>';

function layoutWith(props: string) {
  const body =
    `<w:p><w:pPr>${props}</w:pPr><w:r><w:t>Contents</w:t></w:r></w:p>` +
    `<w:p><w:r><w:t>Clause</w:t></w:r></w:p>`;
  const parsed = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  const layout = layoutSemanticDocument(parsed.part, 1, {
    measurer: createFixedMeasurer(5, 20),
    geometry: { width: 400, height: 600, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
  });
  return layout.pages
    .flatMap((page) => page.fragments)
    .filter((block): block is ParagraphFragmentRecord => block.kind === 'paragraph');
}

test('a framed paragraph draws its bottom border below its space after, at the frame edge', () => {
  // 2200 twips of space after is 110pt. In a text frame that space is inside the frame, so
  // Word's rule sits under it; a free paragraph's rule sits under the text.
  const framed = layoutWith(
    `<w:framePr w:w="9072" w:hAnchor="text" w:vAnchor="text" w:y="7"/>${BORDER}${AFTER}`
  );
  const free = layoutWith(`${BORDER}${AFTER}`);
  const [framedHeading, framedNext] = framed as [ParagraphFragmentRecord, ParagraphFragmentRecord];
  const [freeHeading] = free as [ParagraphFragmentRecord, ParagraphFragmentRecord];
  const lineBottom = (fragment: ParagraphFragmentRecord) => {
    const line = fragment.lines[fragment.lines.length - 1]!;
    return line.box.y + line.box.height;
  };
  expect(freeHeading.bottomBorder!.box.y).toBeCloseTo(lineBottom(freeHeading) + 1, 3);
  expect(framedHeading.bottomBorder!.box.y).toBeCloseTo(lineBottom(framedHeading) + 110 + 1, 3);
  // The rule moves; the next paragraph does not, since the block's height is unchanged.
  const gap = (heading: ParagraphFragmentRecord, next: ParagraphFragmentRecord) =>
    next.box.y - lineBottom(heading);
  expect(gap(framedHeading, framedNext)).toBeGreaterThanOrEqual(110);
  expect(framedHeading.box.height).toBeCloseTo(freeHeading.box.height, 3);
});
