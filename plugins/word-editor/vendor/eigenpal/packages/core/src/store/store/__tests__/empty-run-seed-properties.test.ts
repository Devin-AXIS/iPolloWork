// The run minted for the first text of an empty paragraph keeps a zero-length run's `w:rPr`
// only when that run states exactly the mark's formatting. Two properties agree only when
// every attribute agrees, not only `w:val`: a font or a theme color differs in attributes
// that have no `w:val`.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode, type OoxmlParagraphNode } from '../../index.ts';
import { emptyParagraphRunProperties } from '../mark-character-style-run.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const BIG = '<w:rStyle w:val="Big"/>';

function paragraph(markRPr: string, runRPr: string): OoxmlParagraphNode {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:rPr>${markRPr}</w:rPr></w:pPr>` +
      `<w:r><w:rPr>${runRPr}</w:rPr></w:r></w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const body = parsed.part.root.children[0];
  const found = body && body.kind !== 'textValue' ? body.children[0] : undefined;
  if (!found || found.kind !== 'paragraph') throw new Error('no paragraph');
  return found as OoxmlParagraphNode;
}

/** The minted `w:rPr` children, as `name attr=value ...` strings. */
function minted(markRPr: string, runRPr: string): string[] {
  let id = 0;
  const [rPr] = emptyParagraphRunProperties(paragraph(markRPr, runRPr), () => `n${++id}`);
  if (!rPr || rPr.kind === 'textValue') return [];
  return rPr.children.flatMap((child: OoxmlNode) =>
    child.kind === 'textValue'
      ? []
      : [[child.localName, ...child.attributes.map((a) => `${a.localName}=${a.value}`)].join(' ')]
  );
}

describe('the empty run a new run takes its properties from', () => {
  test('a run that states exactly the mark is kept', () => {
    const fonts = '<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/>';
    expect(minted(`${BIG}${fonts}`, `${BIG}${fonts}`)).toEqual([
      'rStyle val=Big',
      'rFonts ascii=Arial hAnsi=Arial',
    ]);
  });

  test('a run whose fonts differ is not kept', () => {
    expect(
      minted(
        `${BIG}<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/>`,
        `${BIG}<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>`
      )
    ).toEqual(['rStyle val=Big']);
  });

  test('a run whose theme color differs is not kept', () => {
    expect(
      minted(
        `${BIG}<w:color w:val="000000" w:themeColor="accent1"/>`,
        `${BIG}<w:color w:val="000000" w:themeColor="accent2"/>`
      )
    ).toEqual(['rStyle val=Big']);
  });

  test('attribute order does not matter', () => {
    expect(
      minted(
        `${BIG}<w:color w:val="000000" w:themeColor="accent1"/>`,
        `${BIG}<w:color w:themeColor="accent1" w:val="000000"/>`
      )
    ).toHaveLength(2);
  });
});
