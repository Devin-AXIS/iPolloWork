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
  equationDefaultFormatting,
  equationRunPropertiesAreDefault,
} from '../package/omml-control-defaults.ts';

const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const m = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const FONT = '<w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/>';
const rPr = (properties: string) => `<w:rPr>${properties}</w:rPr>`;
// Every property the default rule accepts, in the order it is written.
const FULL =
  '<w:rFonts w:ascii="Cambria Math" w:eastAsia="Cambria Math" w:hAnsi="Cambria Math" ' +
  'w:cs="Cambria Math"/><w:i/><w:iCs/><w:sz w:val="22"/><w:szCs w:val="22"/>' +
  '<w:lang w:val="en-US"/>';
const DEFAULT = rPr(FULL);
const CONTROL = `<m:ctrlPr>${rPr(`${FONT}<w:i/>`)}</m:ctrlPr>`;
const runWith = (properties: string) => (text: string) =>
  `<m:r>${properties}<m:t>${text}</m:t></m:r>`;

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
const runOf = (xml: string): OoxmlElement => find(read(xml).root, 'r')!;

/** A fraction over a script, with `top` on the numerator run and `rest` on the others. */
const source = (top: string, rest = top, control = '') => {
  const first = runWith(top);
  const other = runWith(rest);
  const properties = (name: string) => (control ? `<m:${name}>${control}</m:${name}>` : '');
  return (
    `<m:f>${properties('fPr')}<m:num>${first('a')}</m:num>` +
    `<m:den><m:sSup>${properties('sSupPr')}<m:e>${other('b')}</m:e>` +
    `<m:sup>${other('2')}</m:sup></m:sSup></m:den></m:f>`
  );
};

test.each([
  ['the math font', rPr(FONT)],
  ['the math font and italic', rPr(`${FONT}<w:i/>`)],
  ['every default property', DEFAULT],
  ['italic spelled on', rPr('<w:i w:val="true"/><w:iCs w:val="1"/>')],
  ['one size', rPr('<w:sz w:val="24"/>')],
  ['every language slot', rPr('<w:lang w:val="pl-PL" w:eastAsia="zh-CN" w:bidi="he-IL"/>')],
  ['no properties', rPr('')],
])('treats run properties with %s as default', (_name, properties) => {
  expect(equationRunPropertiesAreDefault(runOf(runWith(properties)('x')))).toBe(true);
});

test.each([
  ['no run properties', '<m:r><m:t>x</m:t></m:r>'],
  ['bold', runWith(rPr('<w:b/>'))('x')],
  ['italic off', runWith(rPr('<w:i w:val="0"/>'))('x')],
  ['another font', runWith(rPr('<w:rFonts w:ascii="Public Math"/>'))('x')],
  ['unequal sizes', runWith(rPr('<w:sz w:val="22"/><w:szCs w:val="24"/>'))('x')],
  ['a malformed language', runWith(rPr('<w:lang w:val="en US"/>'))('x')],
  ['color', runWith(rPr('<w:color w:val="FF0000"/>'))('x')],
  ['a math style', `<m:r><m:rPr><m:sty m:val="p"/></m:rPr>${DEFAULT}<m:t>x</m:t></m:r>`],
  ['normal text', `<m:r><m:rPr><m:nor/></m:rPr>${DEFAULT}<m:t>x</m:t></m:r>`],
  ['a literal', `<m:r><m:rPr><m:lit/></m:rPr>${DEFAULT}<m:t>x</m:t></m:r>`],
  ['two run property sets', `<m:r>${DEFAULT}${DEFAULT}<m:t>x</m:t></m:r>`],
  ['run properties after the text', `<m:r><m:t>x</m:t>${DEFAULT}</m:r>`],
])('does not treat a run with %s as default', (_name, xml) => {
  expect(equationRunPropertiesAreDefault(runOf(xml))).toBe(false);
});

test('projects default run properties as an editable equation', () => {
  for (const body of [source(rPr(FONT)), source(DEFAULT), source(DEFAULT, DEFAULT, CONTROL)]) {
    const projection = projectOmmlEquation(equationOf(read(body)))!;
    const size = body.includes('<w:sz ') ? { fontSizePt: 11 } : {};
    expect(projection.expression).toEqual({
      kind: 'fraction',
      numerator: { kind: 'text', value: 'a', ...size },
      denominator: {
        kind: 'script',
        base: { kind: 'text', value: 'b', ...size },
        superscript: { kind: 'text', value: '2', ...size },
      },
    });
    expect(equationExpressionToLinearMath(projection.expression)).toBe('{a}/{b^{2}}');
  }
});

const SIZED = rPr(`${FONT}<w:sz w:val="22"/>`);
const mixed = [
  ['a bare run beside default runs', source('', rPr(FONT))],
  ['a bold run beside default runs', source(rPr(`${FONT}<w:b/>`), rPr(FONT))],
  ['different default sizes', source(SIZED, rPr(`${FONT}<w:sz w:val="28"/>`))],
  ['a sized run beside an unsized run', source(SIZED, rPr(FONT))],
  ['different languages', source(rPr('<w:lang w:val="en-US"/>'), rPr('<w:lang w:val="pl-PL"/>'))],
  ['italic on only some runs', source(rPr(`${FONT}<w:i/>`), rPr(FONT))],
  ['a math style on one run', source(rPr(FONT), `<m:rPr><m:sty m:val="p"/></m:rPr>${rPr(FONT)}`)],
  ['a non-default control', source(rPr(FONT), rPr(FONT), `<m:ctrlPr>${rPr('<w:b/>')}</m:ctrlPr>`)],
] as const;

test.each(mixed)('keeps linear editing disabled for %s', (_name, body) => {
  const equation = equationOf(read(body));
  expect(equationDefaultFormatting(equation, 256, 24).runs).toEqual({ kind: 'other' });
  expect(equationExpressionToLinearMath(projectOmmlEquation(equation)!.expression)).toBe('');
});

test('classifies the runs of an equation within the reader limits', () => {
  const equation = equationOf(read(source(DEFAULT)));
  expect(equationDefaultFormatting(equation, 256, 24).runs).toEqual({
    kind: 'default',
    properties: find(equation, 'r')!.children[0],
  });
  // Property order does not matter: every run writes the same formatting.
  const reordered = rPr(
    '<w:lang w:val="en-US"/><w:szCs w:val="22"/><w:sz w:val="22"/><w:iCs/><w:i/>' +
      '<w:rFonts w:cs="Cambria Math" w:hAnsi="Cambria Math" w:eastAsia="Cambria Math" ' +
      'w:ascii="Cambria Math"/>'
  );
  expect(
    equationDefaultFormatting(equationOf(read(source(DEFAULT, reordered))), 256, 24).runs.kind
  ).toBe('default');
  expect(equationDefaultFormatting(equationOf(read(source(''))), 256, 24).runs).toEqual({
    kind: 'none',
  });
  expect(equationDefaultFormatting(equation, 4, 24).runs).toEqual({ kind: 'other' });
  expect(equationDefaultFormatting(equation, 256, 2).runs).toEqual({ kind: 'other' });
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

const savedOf = (xml: string, pattern: RegExp) => pattern.exec(xml)![0];
const SAVED_RUN_PROPERTIES = savedOf(
  serializeOoxmlPart(read(source(DEFAULT))),
  /<w:rPr>.*?<\/w:rPr>/
);
const SAVED_CONTROL = savedOf(
  serializeOoxmlPart(read(source(DEFAULT, DEFAULT, CONTROL))),
  /<m:ctrlPr>.*?<\/m:ctrlPr>/
);
const equationContent = (xml: string) => /<m:oMath[^>]*>(.*)<\/m:oMath>/.exec(xml)![1];

function ids(node: OoxmlNode, into: string[] = []): string[] {
  into.push(node.id);
  if (node.kind !== 'textValue') for (const child of node.children) ids(child, into);
  return into;
}

test('replacement writes the default run properties before the text of each emitted run', () => {
  const { part, xml } = replace(
    source(DEFAULT, DEFAULT, CONTROL),
    '{x}/{√[3]{y}}+∑[i]^[n]{z_k^2}+q_1+p^2'
  );
  const runs = xml.match(/<m:r>.*?<\/m:r>/g)!;
  expect(runs.length).toBeGreaterThan(8);
  for (const run of runs) {
    expect(run).toMatch(/^<m:r><w:rPr>.*?<\/w:rPr><m:t[ >]/);
    expect(run.startsWith(`<m:r>${SAVED_RUN_PROPERTIES}<m:t`)).toBe(true);
  }
  // Default controls carry over as before, beside the run properties.
  expect(xml.split('<m:ctrlPr>').length - 1).toBe(6);
  expect(xml).toContain(`${SAVED_CONTROL}</m:fPr>`);
  // Every cloned node receives its own part-scoped id.
  const all = ids(part.root);
  expect(new Set(all).size).toBe(all.length);
  // The result reopens to the same canonical tree.
  const reopened = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!reopened.ok) throw new Error(reopened.reason);
  expect(canonicalOoxmlFingerprint(reopened.part)).toBe(canonicalOoxmlFingerprint(part));
  // The reopened equation stays editable.
  const projection = projectOmmlEquation(equationOf(reopened.part))!;
  expect(equationExpressionToLinearMath(projection.expression)).toBe(
    '{x}/{√[3]{y}}+∑[i]^[n]{z_{k}^{2}}+q_{1}+p^{2}'
  );
});

test('replacing with the same structures keeps the default run source', () => {
  const plain =
    `<m:f><m:fPr>${CONTROL}</m:fPr><m:num>${runWith(DEFAULT)('a')}</m:num>` +
    `<m:den>${runWith(DEFAULT)('b')}</m:den></m:f>`;
  const before = equationContent(serializeOoxmlPart(read(plain)));
  expect(equationContent(replace(plain, '{a}/{b}').xml)).toBe(before);
});

test('replacement writes no run properties when the runs have none or differ', () => {
  expect(replace(source(''), '{a}/{b}').xml).not.toContain('<w:rPr>');
  for (const [, body] of mixed) {
    const xml = equationContent(replace(body, '{a}/{b}').xml);
    expect(xml).not.toContain('<w:rPr>');
  }
});
