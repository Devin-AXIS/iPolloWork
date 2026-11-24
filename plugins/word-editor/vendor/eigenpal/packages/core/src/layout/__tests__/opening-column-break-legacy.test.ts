// A column break that opens a body paragraph, at the end of a balanced two-column continuous
// section. Legacy modes (no declaration, 11, 12, 14) leave no line for the break in the column it
// ends, so the section is only as tall as that column's text. Mode 15 keeps the break line there.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer } from '../index.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);
const PAGE =
  '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>';
const ONE = `<w:sectPr><w:type w:val="continuous"/>${PAGE}</w:sectPr>`;
const TWO = `<w:sectPr><w:type w:val="continuous"/>${PAGE}<w:cols w:num="2" w:space="720"/></w:sectPr>`;
const NONE = '<w:spacing w:before="0" w:after="0"/>';

function parseDoc(bodyInner: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${bodyInner}${ONE}</w:body></w:document>`,
    {
      name: '/word/document.xml',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const para = (text: string, sect = ''): string =>
  `<w:p><w:pPr>${NONE}${sect}</w:pPr>${text ? `<w:r><w:t>${text}</w:t></w:r>` : ''}</w:p>`;

/** The tops of the paragraph fragments that hold `text`, in page order. */
function topsOf(compatibilityMode: number | undefined, opening: string): Map<string, number[]> {
  const part = parseDoc(
    para('Top', ONE) +
      para('Left one') +
      para('Left two') +
      `<w:p><w:pPr>${NONE}</w:pPr>${opening}<w:r><w:t>Right</w:t></w:r></w:p>` +
      para('', TWO) +
      para('After')
  );
  const layout = layoutSemanticDocument(part, 1, {
    measurer,
    ...(compatibilityMode === undefined ? {} : { compatibilityMode }),
  });
  const tops = new Map<string, number[]>();
  for (const fragment of layout.pages[0]!.fragments) {
    if (fragment.kind !== 'paragraph') continue;
    for (const line of fragment.lines) {
      const text = line.spans.map((span) => span.text).join('');
      if (!/\w/.test(text)) continue;
      tops.set(text, [...(tops.get(text) ?? []), line.box.y]);
    }
  }
  return tops;
}

const BREAK = '<w:r><w:br w:type="column"/></w:r>';

describe('a column break that opens a paragraph', () => {
  test('legacy modes leave no break line below the column text', () => {
    for (const mode of [undefined, 12, 14]) {
      const tops = topsOf(mode, BREAK);
      const lineHeight = tops.get('Left two')![0]! - tops.get('Left one')![0]!;
      expect(tops.get('After')![0]).toBeCloseTo(tops.get('Left two')![0]! + lineHeight, 3);
      // The text after the break still opens the second column.
      expect(tops.get('Right')![0]).toBeCloseTo(tops.get('Left one')![0]!, 3);
    }
  });

  test('mode 15 keeps the break line in the column it ends', () => {
    const tops = topsOf(15, BREAK);
    const lineHeight = tops.get('Left two')![0]! - tops.get('Left one')![0]!;
    expect(tops.get('After')![0]).toBeCloseTo(tops.get('Left two')![0]! + 2 * lineHeight, 3);
  });

  test('a break after text keeps its line in every mode', () => {
    for (const mode of [undefined, 15]) {
      const tops = topsOf(mode, `<w:r><w:t>Mid</w:t></w:r>${BREAK}`);
      const lineHeight = tops.get('Left two')![0]! - tops.get('Left one')![0]!;
      expect(tops.get('After')![0]).toBeCloseTo(tops.get('Left two')![0]! + 2 * lineHeight, 3);
    }
  });
});
