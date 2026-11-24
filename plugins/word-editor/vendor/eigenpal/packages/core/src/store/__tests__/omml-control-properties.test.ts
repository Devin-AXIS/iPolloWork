import { expect, test } from 'bun:test';
import {
  canonicalOoxmlFingerprint,
  equationExpressionToLinearMath,
  projectOmmlEquation,
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlNode,
  type OoxmlPart,
} from '../index.ts';

const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const m = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const run = (text: string) => `<m:r><m:t>${text}</m:t></m:r>`;
const control =
  '<m:ctrlPr><w:rPr><w:rFonts w:ascii="Public Math" w:hAnsi="Public Math"/><w:i/></w:rPr></m:ctrlPr>';

function readXml(xml: string): OoxmlPart {
  const parsed = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}

const read = (body: string): OoxmlPart =>
  readXml(
    `<w:document xmlns:w="${w}" xmlns:m="${m}"><w:body><w:p><m:oMath>${body}</m:oMath></w:p></w:body></w:document>`
  );

function equationOf(part: OoxmlPart): OoxmlNode {
  const find = (node: OoxmlNode): OoxmlNode | undefined =>
    node.kind !== 'textValue' && node.namespaceUri === m && node.localName === 'oMath'
      ? node
      : node.kind === 'textValue'
        ? undefined
        : node.children.map(find).find(Boolean);
  const equation = find(part.root);
  if (!equation) throw new Error('missing equation');
  return equation;
}

function project(body: string) {
  const part = read(body);
  const before = canonicalOoxmlFingerprint(part);
  const beforeSerialized = serializeOoxmlPart(part);
  const projection = projectOmmlEquation(equationOf(part));
  expect(canonicalOoxmlFingerprint(part)).toBe(before);
  expect(serializeOoxmlPart(part)).toEqual(beforeSerialized);
  if (!projection) throw new Error('missing projection');
  return projection;
}

const structures = [
  ['bar', `<m:bar><m:barPr><m:pos m:val="top"/>${control}</m:barPr><m:e>${run('N')}</m:e></m:bar>`],
  ['bar without position', `<m:bar><m:barPr>${control}</m:barPr><m:e>${run('N')}</m:e></m:bar>`],
  [
    'fraction',
    `<m:f><m:fPr>${control}</m:fPr><m:num>${run('a')}</m:num><m:den>${run('b')}</m:den></m:f>`,
  ],
  [
    'typed fraction',
    `<m:f><m:fPr><m:type m:val="bar"/>${control}</m:fPr><m:num>${run('a')}</m:num><m:den>${run('b')}</m:den></m:f>`,
  ],
  [
    'radical',
    `<m:rad><m:radPr>${control}</m:radPr><m:deg>${run('3')}</m:deg><m:e>${run('x')}</m:e></m:rad>`,
  ],
  [
    'radical with hidden degree',
    `<m:rad><m:radPr><m:degHide m:val="1"/>${control}</m:radPr><m:deg/><m:e>${run('x')}</m:e></m:rad>`,
  ],
  [
    'n-ary operator',
    `<m:nary><m:naryPr><m:chr m:val="∑"/><m:limLoc m:val="undOvr"/>${control}</m:naryPr>` +
      `<m:sub>${run('i')}</m:sub><m:sup>${run('n')}</m:sup><m:e>${run('x')}</m:e></m:nary>`,
  ],
  [
    'subscript',
    `<m:sSub><m:sSubPr>${control}</m:sSubPr><m:e>${run('x')}</m:e><m:sub>${run('1')}</m:sub></m:sSub>`,
  ],
  [
    'superscript',
    `<m:sSup><m:sSupPr>${control}</m:sSupPr><m:e>${run('x')}</m:e><m:sup>${run('2')}</m:sup></m:sSup>`,
  ],
  [
    'sub-superscript',
    `<m:sSubSup><m:sSubSupPr>${control}</m:sSubSupPr><m:e>${run('x')}</m:e>` +
      `<m:sub>${run('1')}</m:sub><m:sup>${run('2')}</m:sup></m:sSubSup>`,
  ],
] as const;

const expectedKinds: Record<string, string> = {
  bar: 'bar',
  'bar without position': 'bar',
  fraction: 'fraction',
  'typed fraction': 'fraction',
  radical: 'radical',
  'radical with hidden degree': 'radical',
  'n-ary operator': 'nary',
  subscript: 'script',
  superscript: 'script',
  'sub-superscript': 'script',
};

test.each(structures)('projects a %s whose properties carry m:ctrlPr', (name, body) => {
  const projection = project(body);
  expect(projection.expression.kind).toBe(expectedKinds[name]!);
  expect(projection.expression).toMatchObject({ controlProperties: true });
  // Compact syntax cannot spell control properties, so it declines rather than drop them.
  expect(equationExpressionToLinearMath(projection.expression)).toBe('');
});

test('keeps compact syntax for the same structure without m:ctrlPr', () => {
  const projection = project(
    `<m:f><m:fPr/><m:num>${run('a')}</m:num><m:den>${run('b')}</m:den></m:f>`
  );
  expect(projection.expression).toEqual({
    kind: 'fraction',
    numerator: { kind: 'text', value: 'a' },
    denominator: { kind: 'text', value: 'b' },
  });
  expect(equationExpressionToLinearMath(projection.expression)).toBe('{a}/{b}');
});

test.each([
  ['bold', '<m:ctrlPr><w:rPr><w:b/></w:rPr></m:ctrlPr>'],
  ['complex-script bold', '<m:ctrlPr><w:rPr><w:bCs/><w:i/></w:rPr></m:ctrlPr>'],
  [
    'tracked insertion',
    '<m:ctrlPr><w:ins w:id="7" w:author="Public Author" w:date="2026-01-02T03:04:05Z">' +
      '<w:rPr><w:rFonts w:ascii="Public Math" w:hAnsi="Public Math"/><w:i/></w:rPr></w:ins></m:ctrlPr>',
  ],
  [
    'tracked deletion',
    '<m:ctrlPr><w:del w:id="8" w:author="Public Author"><w:rPr><w:b/></w:rPr></w:del></m:ctrlPr>',
  ],
])('projects a fraction with %s control properties', (_name, properties) => {
  const projection = project(
    `<m:f><m:fPr>${properties}</m:fPr><m:num>${run('a')}</m:num><m:den>${run('b')}</m:den></m:f>`
  );
  expect(projection.expression).toEqual({
    kind: 'fraction',
    numerator: { kind: 'text', value: 'a' },
    denominator: { kind: 'text', value: 'b' },
    controlProperties: true,
  });
});

test('projects a bracketed fraction that carries complex-script properties', () => {
  // Complex-script bold on each control, and a complex-script size that differs from the size
  // on each run, as DOCX applications write them. The text has no complex-script character.
  const fonts =
    '<w:rFonts w:ascii="Cambria Math" w:eastAsia="Public East" w:hAnsi="Cambria Math" w:cs="Public Complex"/>';
  const control = `<m:ctrlPr><w:rPr>${fonts}<w:bCs/><w:i/><w:sz w:val="22"/></w:rPr></m:ctrlPr>`;
  const text = (value: string) =>
    `<m:r><m:rPr><m:sty m:val="p"/></m:rPr><w:rPr>${fonts}<w:sz w:val="22"/>` +
    `<w:szCs w:val="20"/></w:rPr><m:t>${value}</m:t></m:r>`;
  const projection = project(
    `<m:d><m:dPr><m:begChr m:val="["/><m:endChr m:val="]"/>${control}</m:dPr><m:e>` +
      `<m:f><m:fPr>${control}</m:fPr><m:num>${text('ODexp-ODblnk')}</m:num>` +
      `<m:den>${text('ODcon-ODblnk')}</m:den></m:f></m:e></m:d>`
  );
  expect(projection.expression).toMatchObject({
    kind: 'delimiter',
    controlProperties: true,
    items: [
      {
        kind: 'fraction',
        controlProperties: true,
        numerator: { kind: 'text', value: 'ODexp-ODblnk', format: { fontSizePt: 11 } },
        denominator: { kind: 'text', value: 'ODcon-ODblnk', format: { fontSizePt: 11 } },
      },
    ],
  });
});

test('projects a fraction whose controls repeat the run sizes, with a larger complex-script size', () => {
  const properties =
    '<w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math" w:cs="Public Complex"/>' +
    '<w:sz w:val="28"/><w:szCs w:val="32"/><w:lang w:bidi="ar-LY"/>';
  const text = (value: string) => `<m:r><w:rPr>${properties}</w:rPr><m:t>${value}</m:t></m:r>`;
  const projection = project(
    `<m:f><m:fPr><m:ctrlPr><w:rPr>${properties.replace('<w:sz', '<w:i/><w:sz')}</w:rPr>` +
      `</m:ctrlPr></m:fPr><m:num>${text('a')}</m:num><m:den>${text('b')}</m:den></m:f>`
  );
  expect(projection.expression).toMatchObject({
    kind: 'fraction',
    controlProperties: true,
    controlFontSizePt: 14,
    numerator: { kind: 'text', value: 'a', format: { fontSizePt: 14 } },
    denominator: { kind: 'text', value: 'b', format: { fontSizePt: 14 } },
  });
});

const complexScriptControl = (properties: string) =>
  `<m:ctrlPr><w:rPr>${properties}<w:sz w:val="22"/></w:rPr></m:ctrlPr>`;

test.each([
  ['a Hebrew opening delimiter', 'dPr', '<m:begChr m:val="א"/>'],
  ['Arabic ornate parentheses', 'dPr', '<m:begChr m:val="\uFD3E"/><m:endChr m:val="\uFD3F"/>'],
  ['an Arabic separator', 'dPr', '<m:sepChr m:val="ب"/>'],
])(
  'keeps the bounded fallback for complex-script control formatting on %s',
  (_name, _property, characters) => {
    for (const formatting of ['<w:bCs/>', '<w:szCs w:val="40"/>']) {
      const projection = project(
        `<m:d><m:dPr>${characters}${complexScriptControl(formatting)}</m:dPr>` +
          `<m:e>${run('a')}</m:e><m:e>${run('b')}</m:e></m:d>`
      );
      expect(projection.expression.kind).toBe('fallback');
    }
  }
);

test('keeps the bounded fallback for complex-script control formatting on an Arabic operator', () => {
  const projection = project(
    `<m:nary><m:naryPr><m:chr m:val="ب"/>${complexScriptControl('<w:bCs/>')}</m:naryPr>` +
      `<m:sub/><m:sup/><m:e>${run('x')}</m:e></m:nary>`
  );
  expect(projection.expression.kind).toBe('fallback');
});

test.each([
  ['a Hebrew delimiter without complex-script formatting', '<m:begChr m:val="א"/>', ''],
  ['default delimiters with complex-script formatting', '', '<w:bCs/><w:szCs w:val="40"/>'],
])('projects %s', (_name, characters, formatting) => {
  const projection = project(
    `<m:d><m:dPr>${characters}${complexScriptControl(formatting)}</m:dPr>` +
      `<m:e>${run('a')}</m:e></m:d>`
  );
  expect(projection.expression).toMatchObject({ kind: 'delimiter', controlFontSizePt: 11 });
});

test.each([
  ['unknown control child', '<m:ctrlPr><m:unknown/></m:ctrlPr>'],
  ['unknown run property', '<m:ctrlPr><w:rPr><w:color w:val="FF0000"/></w:rPr></m:ctrlPr>'],
  ['inherited run property name', '<m:ctrlPr><w:rPr><w:constructor/></w:rPr></m:ctrlPr>'],
  ['math run properties', '<m:ctrlPr><m:rPr><m:sty m:val="p"/></m:rPr></m:ctrlPr>'],
  ['two run property sets', '<m:ctrlPr><w:rPr/><w:rPr/></m:ctrlPr>'],
  ['text content', '<m:ctrlPr>c</m:ctrlPr>'],
  ['attribute', '<m:ctrlPr m:val="1"/>'],
  ['repeated control properties', '<m:ctrlPr/><m:ctrlPr/>'],
  [
    'unknown tracked attribute',
    '<m:ctrlPr><w:ins w:id="1" w:rsid="00AB"><w:rPr/></w:ins></m:ctrlPr>',
  ],
  [
    'tracked property change',
    '<m:ctrlPr><w:ins w:id="1" w:author="Public Author"><w:del w:id="2" w:author="Public Author"/></w:ins></m:ctrlPr>',
  ],
  [
    'unsupported tracked run property',
    '<m:ctrlPr><w:ins w:id="1" w:author="Public Author"><w:rPr><w:color w:val="FF0000"/></w:rPr></w:ins></m:ctrlPr>',
  ],
])('keeps the bounded fallback for %s', (_name, properties) => {
  const projection = project(
    `<m:f><m:fPr>${properties}</m:fPr><m:num>${run('a')}</m:num><m:den>${run('b')}</m:den></m:f>`
  );
  expect(projection.expression.kind).toBe('fallback');
  expect(projection.fallbackText).toBe(properties.includes('>c<') ? 'cab' : 'ab');
});

test('saves control properties verbatim after a read and reopen', () => {
  const body = structures.map(([, source]) => source).join('');
  const part = read(body);
  const saved = serializeOoxmlPart(part);
  const reopened = readXml(saved);
  expect(serializeOoxmlPart(reopened)).toEqual(saved);
  expect(canonicalOoxmlFingerprint(reopened)).toBe(canonicalOoxmlFingerprint(part));
  expect(saved.match(/<m:ctrlPr>/g)).toHaveLength(structures.length);
  expect(projectOmmlEquation(equationOf(reopened))?.expression.kind).toBe('row');
});
