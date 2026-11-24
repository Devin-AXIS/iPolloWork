import { expect, test } from 'bun:test';
import {
  applyTreeOp,
  canonicalOoxmlFingerprint,
  equationExpressionToLinearMath,
  projectOmmlEquation,
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../index.ts';
import {
  equationControlPropertiesAreDefault,
  equationDefaultControlProperties,
} from '../package/omml-control-defaults.ts';

const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const m = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const run = (text: string) => `<m:r><m:t>${text}</m:t></m:r>`;
const FONT = '<w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/>';
const control = (properties: string) => `<m:ctrlPr><w:rPr>${properties}</w:rPr></m:ctrlPr>`;
// A full default control: every property the rule accepts, in the order it is written.
const DEFAULT_CONTROL = control(
  '<w:rFonts w:ascii="Cambria Math" w:eastAsia="Cambria Math" w:hAnsi="Cambria Math" ' +
    'w:cs="Cambria Math"/><w:i/><w:iCs/><w:sz w:val="22"/><w:szCs w:val="22"/>' +
    '<w:lang w:val="en-US"/>'
);

function read(body: string): OoxmlPart {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${w}" xmlns:m="${m}"><w:body><w:p><w:r><w:t>A</w:t></w:r>` +
      `<m:oMath>${body}</m:oMath></w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}

function find(node: OoxmlNode, localName: string): OoxmlElement | undefined {
  if (node.kind === 'textValue') return undefined;
  if (node.namespaceUri === m && node.localName === localName) return node;
  for (const child of node.children) {
    const found = find(child, localName);
    if (found) return found;
  }
  return undefined;
}

const equationOf = (part: OoxmlPart): OoxmlElement => find(part.root, 'oMath')!;

function controlOf(xml: string): OoxmlElement {
  const part = read(`<m:f><m:fPr>${xml}</m:fPr><m:num>${run('a')}</m:num><m:den/></m:f>`);
  return find(part.root, 'ctrlPr')!;
}

test.each([
  ['empty', '<m:ctrlPr/>'],
  ['empty run properties', control('')],
  ['math font and italic', control(`${FONT}<w:i/>`)],
  ['every default property', DEFAULT_CONTROL],
  ['italic spelled on', control('<w:i w:val="true"/><w:iCs w:val="1"/>')],
  ['one size', control('<w:sz w:val="24"/>')],
  ['every language slot', control('<w:lang w:val="pl-PL" w:eastAsia="zh-CN" w:bidi="he-IL"/>')],
])('treats %s control properties as default', (_name, xml) => {
  expect(equationControlPropertiesAreDefault(controlOf(xml))).toBe(true);
});

test.each([
  ['bold', control('<w:b/>')],
  ['italic off', control('<w:i w:val="0"/>')],
  ['another font', control('<w:rFonts w:ascii="Public Math"/>')],
  ['a mixed font', control('<w:rFonts w:ascii="Cambria Math" w:hAnsi="Public Math"/>')],
  ['a font hint', control('<w:rFonts w:hint="eastAsia"/>')],
  ['unequal sizes', control('<w:sz w:val="22"/><w:szCs w:val="24"/>')],
  ['a zero size', control('<w:sz w:val="0"/>')],
  ['a size without a value', control('<w:sz/>')],
  ['a malformed language', control('<w:lang w:val="en US"/>')],
  ['a repeated property', control('<w:i/><w:i/>')],
  ['color', control('<w:color w:val="FF0000"/>')],
  ['two run property sets', '<m:ctrlPr><w:rPr/><w:rPr/></m:ctrlPr>'],
  ['an attribute', '<m:ctrlPr m:val="1"/>'],
  [
    'a tracked insertion',
    `<m:ctrlPr><w:ins w:id="1" w:author="Public Author"><w:rPr>${FONT}<w:i/></w:rPr></w:ins></m:ctrlPr>`,
  ],
  [
    'a tracked deletion',
    `<m:ctrlPr><w:del w:id="2" w:author="Public Author"><w:rPr><w:i/></w:rPr></w:del></m:ctrlPr>`,
  ],
])('does not treat %s as default control properties', (_name, xml) => {
  expect(equationControlPropertiesAreDefault(controlOf(xml))).toBe(false);
});

const sourceWithDefaults =
  `<m:f><m:fPr>${DEFAULT_CONTROL}</m:fPr><m:num>${run('a')}</m:num>` +
  `<m:den><m:sSup><m:sSupPr>${DEFAULT_CONTROL}</m:sSupPr><m:e>${run('b')}</m:e>` +
  `<m:sup>${run('2')}</m:sup></m:sSup></m:den></m:f>`;

test('projects default control properties as an editable equation', () => {
  const projection = projectOmmlEquation(equationOf(read(sourceWithDefaults)))!;
  expect(projection.expression).toEqual({
    kind: 'fraction',
    controlFontSizePt: 11,
    numerator: { kind: 'text', value: 'a' },
    denominator: {
      kind: 'script',
      controlFontSizePt: 11,
      base: { kind: 'text', value: 'b' },
      superscript: { kind: 'text', value: '2' },
    },
  });
  expect(equationExpressionToLinearMath(projection.expression)).toBe('{a}/{b^{2}}');
});

test('keeps the control mark when any control of the equation is not default', () => {
  for (const other of [control('<w:b/>'), control('<w:sz w:val="24"/>')]) {
    const body =
      `<m:f><m:fPr>${control('<w:sz w:val="22"/>')}</m:fPr><m:num>${run('a')}</m:num>` +
      `<m:den>${run('b')}</m:den></m:f><m:sSup><m:sSupPr>${other}</m:sSupPr>` +
      `<m:e>${run('c')}</m:e><m:sup>${run('2')}</m:sup></m:sSup>`;
    const projection = projectOmmlEquation(equationOf(read(body)))!;
    expect(projection.expression.kind).toBe('row');
    expect(equationExpressionToLinearMath(projection.expression)).toBe('');
  }
});

test('classifies the controls of an equation within the reader limits', () => {
  const equation = equationOf(read(sourceWithDefaults));
  const first = find(equation, 'ctrlPr');
  expect(equationDefaultControlProperties(equation, 256, 24)).toEqual({
    kind: 'default',
    control: first,
  });
  expect(equationDefaultControlProperties(equationOf(read(run('x'))), 256, 24)).toEqual({
    kind: 'none',
  });
  expect(equationDefaultControlProperties(equation, 4, 24)).toEqual({ kind: 'other' });
  expect(equationDefaultControlProperties(equation, 256, 2)).toEqual({ kind: 'other' });
});

function replace(body: string, linear: string): { part: OoxmlPart; xml: string } {
  const part = read(body);
  const result = applyTreeOp(part, {
    op: 'setMathEquation',
    equationId: equationOf(part).id,
    linear,
  });
  if (!result.ok) throw new Error(result.reason);
  return { part: result.part, xml: serializeOoxmlPart(result.part) };
}

// The saved spelling of the source control, as the serializer writes it.
const SAVED_CONTROL = /<m:ctrlPr>.*?<\/m:ctrlPr>/.exec(
  serializeOoxmlPart(read(sourceWithDefaults))
)![0];
const equationContent = (xml: string) => /<m:oMath[^>]*>(.*)<\/m:oMath>/.exec(xml)![1];

function ids(node: OoxmlNode, into: string[] = []): string[] {
  into.push(node.id);
  if (node.kind !== 'textValue') for (const child of node.children) ids(child, into);
  return into;
}

test('replacement writes the default control as the last child of each emitted structure', () => {
  const { part, xml } = replace(sourceWithDefaults, '{x}/{√[3]{y}}+∑[i]^[n]{z_k^2}+q_1+p^2');
  const properties = ['fPr', 'radPr', 'naryPr', 'sSubSupPr', 'sSubPr', 'sSupPr'];
  for (const name of properties) {
    expect(xml).toContain(`${SAVED_CONTROL}</m:${name}>`);
  }
  expect(xml).toContain(
    `<m:naryPr><m:chr m:val="∑"/><m:limLoc m:val="undOvr"/>${SAVED_CONTROL}</m:naryPr>`
  );
  expect(xml.split('<m:ctrlPr>').length - 1).toBe(properties.length);
  // Every cloned node receives its own part-scoped id.
  const all = ids(part.root);
  expect(new Set(all).size).toBe(all.length);
  // The result reopens to the same canonical tree.
  const reopened = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!reopened.ok) throw new Error(reopened.reason);
  expect(canonicalOoxmlFingerprint(reopened.part)).toBe(canonicalOoxmlFingerprint(part));
});

test('replacing with the same structures keeps their default control source', () => {
  const plain = `<m:f><m:fPr>${DEFAULT_CONTROL}</m:fPr><m:num>${run('a')}</m:num><m:den>${run('b')}</m:den></m:f>`;
  const before = equationContent(serializeOoxmlPart(read(plain)));
  expect(equationContent(replace(plain, '{a}/{b}').xml)).toBe(before);
});

test('replacement writes no control properties when the source has none or non-default ones', () => {
  expect(replace(run('x'), '{a}/{b}').xml).not.toContain('ctrlPr');
  const bold = `<m:f><m:fPr>${control('<w:b/>')}</m:fPr><m:num>${run('a')}</m:num><m:den>${run('b')}</m:den></m:f>`;
  expect(replace(bold, '{a}/{b}').xml).not.toContain('ctrlPr');
});

test('keeps the control mark when default controls of one equation differ', () => {
  const nary = (properties: string) =>
    `<m:nary><m:naryPr><m:chr m:val="∑"/><m:limLoc m:val="undOvr"/>${control(properties)}` +
    `</m:naryPr><m:sub/><m:sup/><m:e>${run('c')}</m:e></m:nary>`;
  const fraction = (properties: string) =>
    `<m:f><m:fPr>${control(properties)}</m:fPr><m:num>${run('a')}</m:num>` +
    `<m:den>${run('b')}</m:den></m:f>`;
  for (const [first, second] of [
    // One structure sized and one not: a single copy would drop or impose the size.
    [`${FONT}<w:i/>`, `${FONT}<w:i/><w:sz w:val="40"/><w:szCs w:val="40"/>`],
    [`${FONT}<w:i/><w:sz w:val="40"/>`, `${FONT}<w:i/>`],
    ['<w:i/><w:lang w:val="ar-SA"/>', '<w:i/><w:lang w:val="he-IL"/>'],
  ]) {
    const equation = equationOf(read(fraction(first!) + nary(second!)));
    expect(equationDefaultControlProperties(equation, 256, 24)).toEqual({ kind: 'other' });
    expect(equationExpressionToLinearMath(projectOmmlEquation(equation)!.expression)).toBe('');
  }
  // The same properties in another order are the same control.
  const same = equationOf(
    read(fraction(`${FONT}<w:i/><w:sz w:val="24"/>`) + nary(`<w:sz w:val="24"/><w:i/>${FONT}`))
  );
  expect(equationDefaultControlProperties(same, 256, 24).kind).toBe('default');
});
