import { expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode } from '@docx-editor.dev/core/store';
import { piecesOfParagraph } from '../field-projection.ts';
import { breakParagraph } from '../paragraph-flow.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const ordinary = '<w:rFonts w:ascii="Visible" w:hAnsi="Visible"/><w:sz w:val="20"/>';
const control =
  '<w:rFonts w:ascii="Visible" w:hAnsi="Visible" w:cs="Control"/><w:cs/><w:szCs w:val="80"/>';
const run = (text: string, props = ordinary) =>
  `<w:r><w:rPr>${props}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
function field(result: string, simple: boolean, instruction = 'REF missing') {
  return simple
    ? `<w:fldSimple w:instr="${instruction}">${result}</w:fldSimple>`
    : `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>${instruction}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${result}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
}
function paragraph(content: string): OoxmlNode {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p>${content}</w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!parsed.ok) throw Error(parsed.reason);
  const body = parsed.part.root.children.find(
    (n) => n.kind !== 'textValue' && n.localName === 'body'
  )!;
  if (body.kind === 'textValue') throw Error('missing body');
  return body.children.find((n) => n.kind === 'paragraph')!;
}

for (const simple of [false, true]) {
  for (const prefix of ['\u200e', '\u200f', '\u061c', '\u202a\u202c', '\u2066\u2069']) {
    test(`${simple ? 'simple' : 'complex'} field takes visible style after ${JSON.stringify(prefix)}`, () => {
      const node = paragraph(
        run('A') + field(run(prefix, control) + run('Result'), simple) + run('Z')
      );
      const pieces = piecesOfParagraph(node);
      expect(pieces.map((p) => p.text)).toEqual(['A', prefix + 'Result', 'Z']);
      expect(pieces[1]).toMatchObject({
        start: 1,
        end: 2,
        projected: true,
        style: { fontFamily: 'Visible', fontSizePt: 10 },
      });
      expect(pieces[2]).toMatchObject({ start: 2, end: 3 });
      const lines = breakParagraph(
        node,
        node.id,
        0,
        400,
        createFixedMeasurer(5, 11),
        undefined,
        null
      );
      expect(lines).toHaveLength(1);
      expect(lines[0]!.height).toBe(10);
    });
  }

  test(`${simple ? 'simple' : 'complex'} field preserves direction-only fallback and first visible formatting`, () => {
    const only = piecesOfParagraph(
      paragraph(field(run('\u200e', control) + run('\u200f'), simple))
    )[0]!;
    expect(only.text).toBe('\u200e\u200f');
    expect(only.style.fontFamily).toBe('Control');
    expect(only.style.fontSizePt).toBe(40);
    const mixed = piecesOfParagraph(
      paragraph(
        field(
          run('\u200e', control) + run('First', ordinary + '<w:b/>') + run('Later', control),
          simple
        )
      )
    )[0]!;
    expect(mixed.text).toBe('\u200eFirstLater');
    expect(mixed.style).toMatchObject({ fontFamily: 'Visible', fontSizePt: 10, bold: true });
  });

  test(`${simple ? 'simple' : 'complex'} field ignores hidden donors and retains other zero-width text`, () => {
    const result = piecesOfParagraph(
      paragraph(
        field(
          run('\u200e', control) + run('Hidden', control + '<w:vanish/>') + run('Shown'),
          simple
        )
      )
    )[0]!;
    expect(result.text).toBe('\u200eShown');
    expect(result.style.fontFamily).toBe('Visible');
    // A joiner can change glyph shaping. It is not a directional prefix.
    const joiner = piecesOfParagraph(
      paragraph(field(run('\u200d', control) + run('Shown'), simple))
    )[0]!;
    expect(joiner.text).toBe('\u200dShown');
    expect(joiner.style.fontFamily).toBe('Control');
    const empty = piecesOfParagraph(
      paragraph(run('A') + field('<w:r><w:drawing/></w:r>', simple) + run('Z'))
    );
    expect(empty.map((p) => p.text)).toEqual(['A', 'Z']);
    expect(empty[1]!.start).toBe(2);
  });

  test(`${simple ? 'simple' : 'complex'} field selects visible style inside a nested cache`, () => {
    const result = piecesOfParagraph(
      paragraph(field(run('\u200e', control) + field(run('Nested'), false), simple))
    )[0]!;
    expect(result.text).toBe('\u200eNested');
    expect(result.style.fontFamily).toBe('Visible');
  });
}

test('direction prefix style does not change complex field revision ownership', () => {
  const deletedPrefix = `<w:del w:id="1" w:author="Reviewer"><w:r><w:rPr>${control}</w:rPr><w:delText>\u200e</w:delText></w:r></w:del>`;
  const result = piecesOfParagraph(paragraph(field(deletedPrefix + run('Result'), false)))[0]!;
  expect(result.style.fontFamily).toBe('Visible');
  expect(result.revisions?.map((r) => r.kind)).toEqual(['delete']);
  const inserted = `<w:ins w:id="2" w:author="Reviewer">${run('Result')}</w:ins>`;
  const untracked = piecesOfParagraph(
    paragraph(field(run('\u200e', control) + inserted, false))
  )[0]!;
  expect(untracked.style.fontFamily).toBe('Visible');
  expect(untracked.revisions).toBeUndefined();
});

for (const simple of [false, true]) {
  test(`${simple ? 'simple' : 'complex'} unknown field skips empty result runs before a visible donor`, () => {
    const result = piecesOfParagraph(
      paragraph(
        field(
          run('\u200e', control) + run('', control) + run('Visible'),
          simple,
          'UNRECOGNIZED inert'
        )
      )
    )[0]!;
    expect(result.text).toBe('\u200eVisible');
    expect(result.style.fontFamily).toBe('Visible');
  });

  test(`${simple ? 'simple' : 'complex'} symbol result remains a visible style donor`, () => {
    const symbol = `<w:r><w:rPr>${ordinary}</w:rPr><w:sym w:font="Visible" w:char="03B1"/></w:r>`;
    const result = piecesOfParagraph(
      paragraph(field(run('\u200e', control) + symbol + run('Later', control), simple))
    )[0]!;
    expect(result.text).toBe('\u200eαLater');
    expect(result.style.fontFamily).toBe('Visible');
  });

  test(`${simple ? 'simple' : 'complex'} direction controls in visible text retain that run's style`, () => {
    const result = piecesOfParagraph(
      paragraph(field(run('\u200eVisible', control) + run('Later'), simple))
    )[0]!;
    expect(result.style.fontFamily).toBe('Control');
    expect(result.style.fontSizePt).toBe(40);
  });
}

test('unterminated complex field retains independent result runs', () => {
  const unclosed = field(run('\u200e', control) + run('Result'), false).replace(
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>',
    ''
  );
  const pieces = piecesOfParagraph(paragraph(unclosed));
  expect(pieces.map((p) => p.text)).toEqual(['\u200e', 'Result']);
  expect(pieces[0]!.style.fontFamily).toBe('Control');
  expect(pieces[1]!.style.fontFamily).toBe('Visible');
});
