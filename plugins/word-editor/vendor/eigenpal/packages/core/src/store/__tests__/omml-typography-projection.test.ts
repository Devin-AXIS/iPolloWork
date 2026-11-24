import { expect, test } from 'bun:test';
import {
  canonicalOoxmlFingerprint,
  equationExpressionToLinearMath,
  projectOmmlEquation,
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlNode,
} from '../index.ts';

const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const m = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const font = '<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr>';
const run = (text: string, properties = '') =>
  `<m:r>${properties}<m:t xml:space="preserve">${text}</m:t></m:r>`;

function project(body: string) {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${w}" xmlns:m="${m}"><w:body><w:p><m:oMath>${body}</m:oMath></w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const find = (node: OoxmlNode): OoxmlNode | undefined =>
    node.kind !== 'textValue' && node.namespaceUri === m && node.localName === 'oMath'
      ? node
      : node.kind === 'textValue'
        ? undefined
        : node.children.map(find).find(Boolean);
  const equation = find(parsed.part.root);
  if (!equation) throw new Error('missing equation');
  const before = canonicalOoxmlFingerprint(parsed.part);
  const beforeSerialized = serializeOoxmlPart(parsed.part);
  const projection = projectOmmlEquation(equation);
  expect(canonicalOoxmlFingerprint(parsed.part)).toBe(before);
  expect(serializeOoxmlPart(parsed.part)).toEqual(beforeSerialized);
  if (!projection) throw new Error('missing projection');
  return projection;
}

test('keeps both script roles with legal Word fonts and normal/literal math properties', () => {
  const projection = project(
    `<m:sSubSup><m:e>${run('Q', font)}</m:e><m:sub>${run('4', font)}</m:sub><m:sup>${run('al', '<m:rPr><m:lit/><m:nor/></m:rPr>' + font)}</m:sup></m:sSubSup>`
  );
  expect(projection.expression).toEqual({
    kind: 'script',
    base: { kind: 'text', value: 'Q', format: { fontFamily: 'Cambria Math' } },
    subscript: { kind: 'text', value: '4', format: { fontFamily: 'Cambria Math' } },
    superscript: {
      kind: 'text',
      value: 'al',
      format: { fontFamily: 'Cambria Math', literal: true, normalText: true },
    },
  });
  expect(projection.fallbackText).toBe('Q4al');
  // Compact linear syntax cannot represent these run properties. Declining it preserves source.
  expect(equationExpressionToLinearMath(projection.expression)).toBe('');
});

test.each(['top', 'bot'])(
  'keeps a %s bar structurally and preserves its authored OMML',
  (position) => {
    const projection = project(
      `<m:bar><m:barPr><m:pos m:val="${position}"/></m:barPr><m:e>${run('N', font)}</m:e></m:bar>`
    );
    expect(projection.expression.kind).toBe('bar');
    if (projection.expression.kind !== 'bar') throw new Error('missing bar');
    expect(projection.expression.position).toBe(position === 'top' ? 'top' : 'bottom');
    expect(equationExpressionToLinearMath(projection.expression)).toBe('');
  }
);

test.each(['', '<m:barPr/>'])('places a bar without a position below its body: %s', (pr) => {
  const projection = project(`<m:bar>${pr}<m:e>${run('N', font)}</m:e></m:bar>`);
  // The only run carries default run properties, so it projects without format.
  expect(projection.expression).toEqual({
    kind: 'bar',
    body: { kind: 'text', value: 'N' },
    position: 'bottom',
  });
});

test.each([
  `<m:bar><m:barPr><m:pos m:val="top"/><m:constructor/></m:barPr><m:e>${run('N')}</m:e></m:bar>`,
  `<m:bar><m:toString>${run('H')}</m:toString><m:e>${run('N')}</m:e></m:bar>`,
  `<m:f><m:__proto__>${run('H')}</m:__proto__><m:num>${run('a')}</m:num><m:den>${run('b')}</m:den></m:f>`,
  `<m:sSup><m:valueOf/><m:e>${run('x')}</m:e><m:sup>${run('2')}</m:sup></m:sSup>`,
])('keeps structures with unknown child names in the bounded fallback %s', (body) => {
  expect(project(body).expression.kind).toBe('fallback');
});

test.each([
  '<w:rPr><w:rFonts w:ascii="Font A" w:hint="eastAsia"/></w:rPr>',
  '<m:rPr><m:unknown/></m:rPr>',
  '<w:rPr><w:constructor/></w:rPr>',
  '<m:rPr><m:__proto__/></m:rPr>',
])('keeps unsupported source typography in the bounded fallback', (properties) => {
  const projection = project(
    `<m:sSup><m:e>${run('Q', properties)}</m:e><m:sup>${run('2')}</m:sup></m:sSup>`
  );
  expect(projection.expression).toEqual({ kind: 'fallback', text: 'Q2' });
});

test('keeps conflicting sizes on complex-script text in the bounded fallback', () => {
  // `w:szCs` sizes the Hebrew letter, and the lane draws one size per run.
  const projection = project(
    `<m:sSup><m:e>${run('Qש', '<w:rPr><w:sz w:val="28"/><w:szCs w:val="24"/></w:rPr>')}</m:e>` +
      `<m:sup>${run('2')}</m:sup></m:sSup>`
  );
  expect(projection.expression).toEqual({ kind: 'fallback', text: 'Qש2' });
});
