import { expect, test } from 'bun:test';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  canonicalOoxmlFingerprint,
  projectOmmlEquation,
  type OoxmlGenericElementNode,
} from '@docx-editor.dev/core/store';
import { layoutEquation, type EquationGeometry } from '../equation-layout.ts';
import { resolveRunStyle } from '../run-style.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';

const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const m = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const run = (text: string, properties = '') => `<m:r>${properties}<m:t>${text}</m:t></m:r>`;

function project(body: string) {
  const read = readOoxmlPart(`<m:oMath xmlns:w="${w}" xmlns:m="${m}">${body}</m:oMath>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  return {
    part: read.part,
    projection: projectOmmlEquation(read.part.root as OoxmlGenericElementNode),
  };
}

function texts(node: EquationGeometry): string[] {
  if (node.kind === 'text' || node.kind === 'fallback') return [node.text];
  if (node.kind === 'row') return node.items.flatMap(texts);
  if (node.kind === 'script')
    return [node.base, node.subscript, node.superscript].flatMap((n) => (n ? texts(n) : []));
  if (node.kind === 'bar') return texts(node.body);
  throw new Error('Unexpected test geometry');
}

test('measures and publishes mathematical italic letters while saving ordinary source letters', () => {
  const { part, projection } = project(
    '<m:sSubSup><m:e>' +
      run('Q', '<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr>') +
      '</m:e><m:sub>' +
      run('4') +
      '</m:sub><m:sup>' +
      run('al', '<m:rPr><m:lit/><m:nor/></m:rPr>') +
      '</m:sup></m:sSubSup>' +
      '<m:bar><m:e>' +
      run('N') +
      '</m:e></m:bar>'
  );
  const before = canonicalOoxmlFingerprint(part);
  const measured: { text: string; family: string | null; bold: boolean; italic: boolean }[] = [];
  const fixed = createFixedMeasurer();
  const geometry = layoutEquation(
    projection,
    {
      ...fixed,
      measure: (text, style) => {
        measured.push({ text, family: style.fontFamily, bold: style.bold, italic: style.italic });
        return fixed.measure(text, style);
      },
    },
    resolveRunStyle([])
  ).geometry;
  expect(texts(geometry)).toEqual(['𝑄', '4', 'al', '𝑁']);
  expect(measured.map((row) => row.text)).toEqual(['𝑄', '4', 'al', '𝑁']);
  expect(measured[0]).toEqual({ text: '𝑄', family: 'Cambria Math', bold: false, italic: false });
  expect(projection.fallbackText).toBe('Q4alN');
  expect(canonicalOoxmlFingerprint(part)).toBe(before);
  const saved = serializeOoxmlPart(part);
  expect(saved).toContain('<m:t>Q</m:t>');
  expect(saved).toContain('<m:t>N</m:t>');
  expect(saved).not.toContain('𝑄');
  const reopened = readOoxmlPart(saved, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!reopened.ok) throw new Error(reopened.reason);
  expect(canonicalOoxmlFingerprint(reopened.part)).toBe(before);
});

test.each([
  ['p', 'Qh4', 'Qh4'],
  ['i', 'Qh4', '𝑄ℎ4'],
  ['b', 'Qh4', '𝐐𝐡𝟒'],
  ['bi', 'Qh4', '𝑸𝒉𝟒'],
] as const)(
  'uses explicit math style %s without a synthetic font style',
  (mathStyle, source, expected) => {
    const { projection } = project(
      run(source, `<w:rPr><w:b/><w:i/></w:rPr><m:rPr><m:sty m:val="${mathStyle}"/></m:rPr>`)
    );
    const result = layoutEquation(projection, createFixedMeasurer(), resolveRunStyle([]));
    if (result.geometry.kind !== 'text') throw new Error('Missing styled text');
    expect(result.geometry.text).toBe(expected);
    expect(result.geometry.runStyle?.bold).toBe(false);
    expect(result.geometry.runStyle?.italic).toBe(false);
  }
);

test('normal text disables the math variant but literal text alone keeps it', () => {
  const { projection } = project(
    run('QN', '<m:rPr><m:sty m:val="bi"/><m:nor/></m:rPr>') + run('QN', '<m:rPr><m:lit/></m:rPr>')
  );
  expect(
    texts(layoutEquation(projection, createFixedMeasurer(), resolveRunStyle([])).geometry)
  ).toEqual(['QN', '𝑄𝑁']);
});

test('keeps the default math style separate from inherited and Word-run bold or italic', () => {
  const { projection } = project(run('QN', '<w:rPr><w:b/><w:i w:val="0"/></w:rPr>'));
  const inherited = Object.freeze({ ...resolveRunStyle([]), bold: true, italic: false });
  const result = layoutEquation(projection, createFixedMeasurer(), inherited);
  expect(texts(result.geometry)).toEqual(['𝑄𝑁']);
  expect(inherited.bold).toBe(true);
});

test.each([
  ['', '', '𝑄𝑁', 'Cambria Math', false, false],
  ['', '<w:b/>', '𝑄𝑁', 'Cambria Math', false, false],
  ['<m:sty m:val="b"/>', '', '𝐐𝐍', 'Cambria Math', false, false],
  ['<m:sty m:val="bi"/>', '', '𝑸𝑵', 'Cambria Math', false, false],
  ['<m:sty m:val="p"/>', '', 'QN', 'Arial', false, false],
  ['<m:sty m:val="p"/>', '<w:b/>', 'QN', 'Arial', true, false],
  ['<m:sty m:val="p"/>', '<w:i/>', 'QN', 'Arial', false, true],
  ['<m:nor/>', '<w:b/>', 'QN', 'Arial', true, false],
] as const)(
  'draws styled letters of an authored text face in the math face (%s %s)',
  (mathProperties, runProperties, text, family, bold, italic) => {
    const { projection } = project(
      run(
        'QN',
        (mathProperties ? `<m:rPr>${mathProperties}</m:rPr>` : '') +
          `<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/>${runProperties}</w:rPr>`
      )
    );
    const result = layoutEquation(projection, createFixedMeasurer(), resolveRunStyle([]));
    if (result.geometry.kind !== 'text') throw new Error('Missing text geometry');
    expect(result.geometry.text).toBe(text);
    expect(result.geometry.runStyle?.fontFamily).toBe(family);
    expect(result.geometry.runStyle?.bold).toBe(bold);
    expect(result.geometry.runStyle?.italic).toBe(italic);
  }
);

test.each(['cambria math', 'CAMBRIA MATH'])(
  'keeps math styles when the authored math face is spelled %s',
  (family) => {
    const { projection } = project(
      run('QN', `<w:rPr><w:rFonts w:ascii="${family}" w:hAnsi="${family}"/></w:rPr>`)
    );
    expect(
      texts(layoutEquation(projection, createFixedMeasurer(), resolveRunStyle([])).geometry)
    ).toEqual(['𝑄𝑁']);
  }
);

test('keeps punctuation, combining marks, source supplementary letters, and other scripts unchanged', () => {
  const { projection } = project(run('h\u0301 + 𝑄甲😀'));
  expect(
    texts(layoutEquation(projection, createFixedMeasurer(), resolveRunStyle([])).geometry)
  ).toEqual(['ℎ\u0301 ', '+', ' 𝑄甲😀']);
});

test('maps Greek letters and variant symbols without using an italic font program', () => {
  const { projection } = project(run('ΑΩαως∇∂ϵϑϰϕϱϖ'));
  expect(
    texts(layoutEquation(projection, createFixedMeasurer(), resolveRunStyle([])).geometry)
  ).toEqual(['𝛢𝛺𝛼𝜔𝜍𝛻𝜕𝜖𝜗𝜘𝜙𝜚𝜛']);
});
