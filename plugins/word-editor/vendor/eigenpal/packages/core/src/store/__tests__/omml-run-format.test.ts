import { expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement, type OoxmlNode } from '../index.ts';
import { equationRunFormat } from '../package/omml-run-format.ts';

const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const m = 'http://schemas.openxmlformats.org/officeDocument/2006/math';

function run(properties: string, text = 'al'): OoxmlElement {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${w}" xmlns:m="${m}"><w:body><w:p><m:oMath><m:r>${properties}<m:t>${text}</m:t></m:r></m:oMath></w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  function visit(node: OoxmlNode): OoxmlElement | undefined {
    if (node.kind === 'textValue') return undefined;
    if (node.namespaceUri === m && node.localName === 'r') return node;
    return node.children.map(visit).find(Boolean);
  }
  const found = visit(result.part.root);
  if (!found) throw new Error('missing math run');
  return found;
}

test('reads explicit Word face and math normal/literal without mutating canonical source', () => {
  const node = run(
    '<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/><w:b w:val="0"/></w:rPr><m:rPr><m:lit/><m:nor/></m:rPr>'
  );
  const before = JSON.stringify(node);
  expect(equationRunFormat(node)).toEqual({
    fontFamily: 'Cambria Math',
    bold: false,
    literal: true,
    normalText: true,
  });
  expect(JSON.stringify(node)).toBe(before);
});

test.each(['0', 'false', 'off'])('retains explicit false math toggle %s', (value) => {
  expect(equationRunFormat(run(`<m:rPr><m:nor m:val="${value}"/></m:rPr>`))).toEqual({
    normalText: false,
  });
});

test.each(['p', 'b', 'i', 'bi'] as const)(
  'retains math style %s independently of Word italics',
  (mathStyle) => {
    const node = run(`<w:rPr><w:i w:val="0"/></w:rPr><m:rPr><m:sty m:val="${mathStyle}"/></m:rPr>`);
    const before = JSON.stringify(node);
    expect(equationRunFormat(node)).toEqual({ italic: false, mathStyle });
    expect(JSON.stringify(node)).toBe(before);
  }
);

test('uses italic for an empty math style and retains the normal-text override', () => {
  expect(equationRunFormat(run('<m:rPr><m:sty/><m:nor/></m:rPr>'))).toEqual({
    mathStyle: 'i',
    normalText: true,
  });
});

test.each(['1', '16', '48', '9999'])('reads bounded half-point size %s', (value) => {
  const node = run(`<w:rPr><w:sz w:val="${value}"/><w:szCs w:val="${value}"/><w:b/></w:rPr>`);
  const before = JSON.stringify(node);
  expect(equationRunFormat(node)).toEqual({ fontSizePt: Number(value) / 2, bold: true });
  expect(JSON.stringify(node)).toBe(before);
});

test('keeps the size when default language and italic properties use the default reader', () => {
  const node = run('<w:rPr><w:iCs/><w:sz w:val="48"/><w:lang w:val="en-US"/></w:rPr>');
  expect(equationRunFormat(node)).toEqual({ fontFamily: 'Cambria Math', fontSizePt: 24 });
});

test('does not use a complex-script-only size for math text', () => {
  expect(equationRunFormat(run('<w:rPr><w:szCs w:val="48"/></w:rPr>'))).toEqual({
    fontFamily: 'Cambria Math',
  });
});

test.each([
  '<w:sz w:val="0"/>',
  '<w:sz w:val="-1"/>',
  '<w:sz w:val="1.5"/>',
  '<w:sz w:val="10000"/>',
  '<w:sz w:val="Infinity"/>',
  '<w:sz w:val=" 24"/>',
  '<w:sz/>',
  '<w:sz m:val="24"/>',
  '<w:sz w:val="24"><w:b/></w:sz>',
  '<w:sz w:val="24"/><w:sz w:val="24"/>',
  '<w:bCs w:val="maybe"/><w:sz w:val="24"/>',
  '<w:bCs><w:b/></w:bCs><w:sz w:val="24"/>',
])('rejects invalid or conflicting size properties %s', (properties) => {
  expect(equationRunFormat(run(`<w:rPr>${properties}</w:rPr>`))).toBeNull();
});

// `w:bCs` and `w:szCs` format complex-script characters only (ISO/IEC 29500-1 17.3.2.2,
// 17.3.2.39), so text without them draws with `w:sz` and no bold.
test.each([
  ['a smaller complex-script size', '<w:sz w:val="22"/><w:szCs w:val="20"/>'],
  ['a complex-script size before the size', '<w:szCs w:val="48"/><w:sz w:val="22"/>'],
  ['complex-script bold', '<w:bCs/><w:sz w:val="22"/>'],
  ['complex-script bold turned off', '<w:bCs w:val="0"/><w:sz w:val="22"/>'],
])('draws text without complex-script characters through %s', (_name, properties) => {
  expect(equationRunFormat(run(`<w:rPr>${properties}</w:rPr>`, 'ODexp-1'))).toEqual({
    fontSizePt: 11,
  });
});

test.each([
  ['a different complex-script size', '<w:sz w:val="22"/><w:szCs w:val="20"/>'],
  ['complex-script bold', '<w:bCs/><w:sz w:val="22"/>'],
])('rejects %s on complex-script text', (_name, properties) => {
  expect(equationRunFormat(run(`<w:rPr>${properties}</w:rPr>`, 'xשלום'))).toBeNull();
});

test('keeps the fallback when complex-script bold is all a run names, so replacement cannot drop it', () => {
  expect(equationRunFormat(run('<w:rPr><w:bCs/></w:rPr>'))).toBeNull();
});

const slotFonts =
  '<w:rFonts w:ascii="Latin Face" w:hAnsi="Latin Face" w:eastAsia="East Face" w:cs="Complex Face"/>';

test('keeps the Latin face, size, and math style when other font slots name other faces', () => {
  const node = run(
    `<m:rPr><m:sty m:val="b"/></m:rPr><w:rPr>${slotFonts}<w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr>`,
    '1234'
  );
  const before = JSON.stringify(node);
  expect(equationRunFormat(node)).toEqual({
    fontFamily: 'Latin Face',
    fontSizePt: 18,
    mathStyle: 'b',
  });
  expect(JSON.stringify(node)).toBe(before);
});

test.each([
  ['ASCII text', '<w:rFonts w:ascii="Face A" w:hAnsi="Face B"/>', 'x12', 'Face A'],
  ['Greek text', '<w:rFonts w:ascii="Face A" w:hAnsi="Face B"/>', 'αβ', 'Face B'],
  ['East Asian text', slotFonts, '中文', 'East Face'],
  ['Hebrew text', slotFonts, 'שלום', 'Complex Face'],
  ['Latin text and an unnamed East Asian slot', '<w:rFonts w:ascii="A" w:cs="B"/>', 'x中', 'A'],
  ['Thai text', slotFonts, 'กข', 'Complex Face'],
  ['Arabic mathematical letters', slotFonts, '\u{1EE01}', 'Complex Face'],
  [
    'an operator beside Greek text',
    '<w:rFonts w:ascii="Face A" w:hAnsi="Face B"/>',
    'α+β',
    'Face B',
  ],
  ['Armenian text beside ASCII text', '<w:rFonts w:hAnsi="Face B"/>', 'աx', 'Face B'],
  [
    'operator-only ASCII text',
    '<w:rFonts w:ascii="Face A" w:eastAsia="East Face"/>',
    '+',
    'Face A',
  ],
] as const)('takes the face of the slot that %s reaches', (_name, fonts, text, family) => {
  expect(equationRunFormat(run(`<w:rPr>${fonts}</w:rPr>`, text))).toEqual({
    fontFamily: family,
  });
});

test.each([
  ['other slots', '<w:rFonts w:eastAsia="East Face" w:cs="Complex Face"/>'],
  ['one complex-script slot', '<w:rFonts w:cs="Complex Face"/>'],
])('names no face when the text reaches only unnamed slots (%s)', (_name, fonts) => {
  expect(equationRunFormat(run(`<w:rPr>${fonts}</w:rPr>`, '12'))).toEqual({});
});

test.each([
  ['ASCII and Greek text', '<w:rFonts w:ascii="Face A" w:hAnsi="Face B"/>', 'xα'],
  ['Latin and East Asian text', slotFonts, 'x中'],
  ['Latin and Hebrew text', slotFonts, 'xש'],
])('refuses a run whose %s needs two faces', (_name, fonts, text) => {
  expect(equationRunFormat(run(`<w:rPr>${fonts}</w:rPr>`, text))).toBeNull();
});

test.each([
  '<w:rPr><w:rFonts w:ascii="Face A" w:hint="eastAsia"/></w:rPr>',
  '<w:rPr><w:rFonts w:ascii="Face A" w:eastAsia=""/></w:rPr>',
  '<w:rPr><w:rFonts w:ascii="Face A" w:cs=" Face B"/></w:rPr>',
  '<w:rPr><w:rFonts w:asciiTheme="minorHAnsi"/></w:rPr>',
  '<w:rPr><w:vertAlign w:val="superscript"/></w:rPr>',
  '<w:rPr><w:b w:val="unknown"/></w:rPr>',
  '<w:rPr><w:b/><w:b w:val="0"/></w:rPr>',
  '<w:rPr/><w:rPr/>',
  '<m:rPr><m:sty m:val="unknown"/></m:rPr>',
  '<m:rPr><m:sty w:val="i"/></m:rPr>',
  '<m:rPr><m:sty m:val="i"/><m:sty m:val="p"/></m:rPr>',
  '<m:rPr><m:nor w:val="1"/></m:rPr>',
  '<m:rPr><m:nor/><m:nor m:val="0"/></m:rPr>',
  '<m:rPr/><m:rPr/>',
  '<w:rPr><m:b/></w:rPr>',
  '<w:rPr><w:constructor/></w:rPr>',
  '<w:rPr><w:toString/></w:rPr>',
  '<m:rPr><m:__proto__/></m:rPr>',
])('rejects unrepresented or ambiguous typography %s', (properties) => {
  const node = run(properties);
  const before = JSON.stringify(node);
  expect(equationRunFormat(node)).toBeNull();
  expect(JSON.stringify(node)).toBe(before);
});

test.each([
  ['0', 0],
  ['2', 1],
  ['40', 20],
])('reads the kerning threshold w:kern %s', (value, points) => {
  const node = run(`<w:rPr><w:kern w:val="${value}"/><w:sz w:val="40"/></w:rPr>`);
  expect(equationRunFormat(node)).toEqual({ kerningMinPt: points, fontSizePt: 20 });
});

test.each([
  '<w:kern w:val="-2"/>',
  '<w:kern w:val="1.5"/>',
  '<w:kern w:val="10000"/>',
  '<w:kern w:val="02"/>',
  '<w:kern/>',
  '<w:kern m:val="2"/>',
  '<w:kern w:val="2"><w:b/></w:kern>',
  '<w:kern w:val="0"/><w:kern w:val="2"/>',
])('rejects invalid kerning properties %s', (properties) => {
  expect(equationRunFormat(run(`<w:rPr>${properties}</w:rPr>`))).toBeNull();
});
