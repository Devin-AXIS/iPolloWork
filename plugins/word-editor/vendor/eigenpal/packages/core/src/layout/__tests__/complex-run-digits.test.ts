import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import type { TextMeasurer } from '../paragraph-flow.ts';

// A complex-script run draws its European digits in its Latin face, and only those: spaces
// between digit groups, spaces beside letters, punctuation and Latin letters
// stay in the complex-script face, and a space raises no line.

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
/** The Latin face has a 14pt line, the complex-script face a 25pt line. */
const measurer: TextMeasurer = {
  measure: (text) => text.length * 6,
  lineMetrics: (style) =>
    style.fontFamily === 'Script Face'
      ? { height: 25, baseline: 20 }
      : { height: 14, baseline: 11 },
};

function line(text: string, lang = 'ar-JO') {
  const run =
    '<w:r><w:rPr><w:rFonts w:ascii="Latin Face" w:hAnsi="Latin Face" w:cs="Script Face" w:hint="cs"/>' +
    `<w:rtl/><w:lang w:bidi="${lang}"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
  const xml = `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:bidi/></w:pPr>${run}</w:p></w:body></w:document>`;
  const read = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'application/xml' });
  if (!read.ok) throw new Error(read.reason);
  const result = layoutSemanticDocument(read.part, 1, { measurer });
  const fragment = result.pages[0]!.fragments.find((f) => f.kind === 'paragraph');
  if (fragment?.kind !== 'paragraph') throw new Error('paragraph');
  const first = fragment.lines[0]!;
  return {
    height: first.box.height,
    faces: first.spans.map((span) => [span.text, span.style.fontFamily]),
  };
}

test('digits alone take the Latin face and its line', () => {
  const result = line('15');
  expect(result.height).toBe(14);
  expect(result.faces).toEqual([['15', 'Latin Face']]);
});

test('spaces between digit groups stay in the script face without raising the line', () => {
  const result = line('15 15 15');
  expect(result.height).toBe(14);
  expect(result.faces).toContainEqual([' ', 'Script Face']);
});

test('digits beside letters keep the Latin face while the line takes the script face', () => {
  const result = line('15 مرحبا');
  expect(result.height).toBe(25);
  expect(result.faces).toContainEqual(['15', 'Latin Face']);
  expect(result.faces.some(([text, face]) => text!.includes(' ') && face === 'Script Face')).toBe(
    true
  );
});

test('Latin letters and punctuation stay in the complex-script face', () => {
  expect(line('abc').height).toBe(25);
  expect(line('- . , :').height).toBe(25);
});

test('a Hebrew run keeps its digits in the complex-script face', () => {
  const result = line('15', 'he-IL');
  expect(result.height).toBe(25);
  expect(result.faces).toEqual([['15', 'Script Face']]);
});
