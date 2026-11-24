// `pageBreakMarkOnNextPage`: with `w:splitPgBreakAndParaMark` in a legacy compatibility mode,
// the paragraph mark after a closing page break takes one line at the top of the next page, so
// the next block starts one line lower. Modern modes ignore the option.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import { createFixedMeasurer } from '../index.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const URI = 'http://schemas.microsoft.com/office/word';
const measurer = createFixedMeasurer(6, 14);

function cascadeOf(mode: number | undefined, split: boolean) {
  const declaration =
    mode === undefined
      ? ''
      : `<w:compatSetting w:name="compatibilityMode" w:uri="${URI}" w:val="${mode}"/>`;
  const read = readOoxmlPart(
    `<w:settings xmlns:w="${W}"><w:compat>${split ? '<w:splitPgBreakAndParaMark/>' : ''}${declaration}</w:compat></w:settings>`,
    { name: '/word/settings.xml', contentType: 'application/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  return buildStyleCascadeTable(null, undefined, read.part.root);
}

const PART = (() => {
  const p = (content: string) =>
    `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr>${content}</w:p>`;
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>` +
      p('<w:r><w:t>Top</w:t></w:r>') +
      p('<w:r><w:br w:type="page"/></w:r>') +
      p('<w:r><w:t>Next</w:t></w:r>') +
      '<w:sectPr><w:pgSz w:w="4000" w:h="4000"/><w:pgMar w:left="300" w:right="300" w:top="300" w:bottom="300"/></w:sectPr>' +
      '</w:body></w:document>',
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  return read.part;
})();

/** The page index and top of the paragraph after the break. */
function next(mode: number | undefined, split: boolean): [number, number] {
  const layout = layoutSemanticDocument(PART, 0, {
    measurer,
    compatibilityMode: mode,
    styleCascade: cascadeOf(mode, split),
  });
  for (const [index, page] of layout.pages.entries()) {
    for (const fragment of page.fragments) {
      if (fragment.kind !== 'paragraph') continue;
      const line = fragment.lines.find((l) => l.spans.some((span) => span.text === 'Next'));
      if (line) return [index, fragment.box.y + line.box.y];
    }
  }
  throw new Error('Missing paragraph');
}

describe('a page break that ends its paragraph', () => {
  test('the rule is on only with the option in a legacy mode', () => {
    for (const mode of [undefined, 11, 12, 14])
      expect(cascadeOf(mode, true).pageBreakMarkOnNextPage).toBe(true);
    expect(cascadeOf(15, true).pageBreakMarkOnNextPage).toBeUndefined();
    expect(cascadeOf(undefined, false).pageBreakMarkOnNextPage).toBeUndefined();
  });

  test('the mark takes a line at the top of the next page', () => {
    const [plainPage, plainTop] = next(undefined, false);
    const [splitPage, splitTop] = next(undefined, true);
    expect(plainPage).toBe(1);
    expect(splitPage).toBe(1);
    expect(plainTop).toBe(0);
    expect(splitTop).toBeGreaterThan(10);
  });

  test('a modern mode ignores the option', () => {
    expect(next(15, true)).toEqual(next(15, false));
  });
});
