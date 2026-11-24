// An empty paragraph that carries a section break paints neither its borders nor its shading,
// and it never opens a page of its own, even when its line misses the page bottom.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createLayoutSession } from '../layout-session.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { ParagraphFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const SECT =
  '<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>';
const BORDER =
  '<w:pBdr><w:top w:val="single" w:sz="12" w:space="1" w:color="000000"/>' +
  '<w:bottom w:val="single" w:sz="12" w:space="1" w:color="000000"/></w:pBdr>';
const SHADE = '<w:shd w:val="clear" w:color="auto" w:fill="000000"/>';
/** One exact line `twips` tall; the text column is 648pt. */
const filler = (twips: number) =>
  `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${twips}" w:lineRule="exact"/></w:pPr><w:r><w:t>F</w:t></w:r></w:p>`;
const mark = (extra: string, text = '') =>
  `<w:p><w:pPr>${extra}<w:sectPr>${SECT}</w:sectPr></w:pPr>${text ? `<w:r><w:t>${text}</w:t></w:r>` : ''}</w:p>`;
const lay = (body: string) => {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${body}<w:p><w:r><w:t>Next</w:t></w:r></w:p><w:sectPr>${SECT}</w:sectPr></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  return layoutSemanticDocument(read.part, 0, { measurer: createFixedMeasurer() });
};
const painted = (layout: ReturnType<typeof lay>) =>
  layout.pages.flatMap((page) =>
    page.fragments.filter(
      (fragment): fragment is ParagraphFragmentRecord =>
        fragment.kind === 'paragraph' &&
        (Boolean(fragment.borders?.length) || Boolean(fragment.bottomBorder) || !!fragment.shading)
    )
  );

for (const [label, extra] of [
  ['borders', BORDER],
  ['shading', SHADE],
] as const) {
  test(`a bare section mark with ${label} paints nothing and opens no page`, () => {
    // 638pt of text leaves 10pt: the mark's line misses the bottom, but stays on the page.
    const past = lay(filler(12760) + mark(extra));
    expect(past.pages).toHaveLength(2);
    expect(painted(past)).toEqual([]);
    // With room for it, it still paints nothing.
    const fits = lay(filler(10000) + mark(extra));
    expect(painted(fits)).toEqual([]);
  });
}

test('a section mark that holds text keeps its borders and its own page rules', () => {
  const layout = lay(filler(12760) + mark(BORDER, 'Text'));
  expect(layout.pages).toHaveLength(3);
  expect(painted(layout)).toHaveLength(1);
});

test('a warm pass that changes the next section break lays out like a cold one', () => {
  const load = (inner: string) => {
    const read = readOoxmlPart(
      `<w:document xmlns:w="${W}"><w:body>${inner}</w:body></w:document>`,
      {
        name: '/word/document.xml',
        contentType: 'app/xml',
      }
    );
    if (!read.ok) throw new Error(read.reason);
    return read.part;
  };
  const body = (type: string) =>
    `<w:p><w:pPr>${BORDER}</w:pPr><w:r><w:t>A</w:t></w:r></w:p>${mark(BORDER)}` +
    `<w:p><w:r><w:t>Next</w:t></w:r></w:p><w:sectPr>${type}${SECT}</w:sectPr>`;
  const nextPage = load(body(''));
  // The edited document keeps the first section's nodes; only the final break changes.
  const edited = load(body('<w:type w:val="continuous"/>'));
  const source = nextPage.root.children[0]!;
  const target = edited.root.children[0]!;
  if (source.kind === 'textValue' || target.kind === 'textValue') throw new Error('body');
  const children = target.children.map((node, index) =>
    index < 3 ? source.children[index]! : node
  );
  const continuous = { ...edited, root: { ...edited.root, children: [{ ...target, children }] } };
  const shape = (layout: ReturnType<typeof layoutSemanticDocument>) =>
    layout.pages.map((page) =>
      page.fragments.map((fragment) => [
        fragment.box,
        fragment.kind === 'paragraph' ? (fragment.borders ?? null) : null,
        fragment.kind === 'paragraph' ? (fragment.bottomBorder ?? null) : null,
      ])
    );
  for (const [first, second] of [
    [nextPage, continuous],
    [continuous, nextPage],
  ] as const) {
    const measurer = createFixedMeasurer();
    const session = createLayoutSession();
    layoutSemanticDocument(first, 1, { measurer, session });
    const warm = layoutSemanticDocument(second, 2, { measurer, session });
    const cold = layoutSemanticDocument(second, 2, { measurer });
    expect(shape(warm)).toEqual(shape(cold));
  }
});
