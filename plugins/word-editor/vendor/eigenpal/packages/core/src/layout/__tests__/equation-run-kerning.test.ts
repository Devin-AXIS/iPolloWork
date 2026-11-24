// `w:kern` (17.3.2.19) in the run properties of a math run: the smallest font size that takes
// pair kerning. Zero turns kerning off and leaves the run as it is without the property; a
// positive threshold at or below the run size turns kerning on. The equation keeps its math
// structure either way, and save keeps the property.
import { expect, test } from 'bun:test';
import {
  canonicalOoxmlFingerprint,
  projectOmmlEquation,
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlGenericElementNode,
} from '@docx-editor.dev/core/store';
import { layoutEquation, type EquationGeometry } from '../equation-layout.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { resolveRunStyle, type ResolvedRunStyle } from '../run-style.ts';
import { isRunKerningEnabled } from '../run-kerning.ts';

const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const m = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const properties = (kern: string) =>
  `<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/>${kern}<w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr>`;
const run = (text: string, kern: string) =>
  `<m:r><m:rPr><m:sty m:val="p"/></m:rPr>${properties(kern)}<m:t>${text}</m:t></m:r>`;
const control = (kern: string) =>
  `<m:ctrlPr>${properties(kern).replace('<w:sz', '<w:i/><w:sz')}</m:ctrlPr>`;
const power = (kern: string) =>
  `${run('±', kern)}<m:sSup><m:sSupPr>${control(kern)}</m:sSupPr><m:e>${run('5', kern)}</m:e>` +
  `<m:sup><m:f><m:fPr>${control(kern)}</m:fPr><m:num>${run('p+1', kern)}</m:num>` +
  `<m:den>${run('4', kern)}</m:den></m:f></m:sup></m:sSup>`;

function read(xml: string) {
  const result = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function project(body: string) {
  const part = read(`<m:oMath xmlns:w="${w}" xmlns:m="${m}">${body}</m:oMath>`);
  const projection = projectOmmlEquation(part.root as OoxmlGenericElementNode);
  if (!projection) throw new Error('missing projection');
  return { part, projection };
}

function textStyles(node: EquationGeometry): { text: string; style?: ResolvedRunStyle }[] {
  if (node.kind === 'text' || node.kind === 'fallback')
    return [{ text: `${node.kind}:${node.text}`, style: node.runStyle }];
  const parts =
    node.kind === 'row'
      ? node.items
      : node.kind === 'script'
        ? [node.base, node.subscript, node.superscript]
        : node.kind === 'fraction'
          ? [node.numerator, node.denominator]
          : [];
  return parts.flatMap((part) => (part ? textStyles(part) : []));
}

const surrounding = Object.freeze({ ...resolveRunStyle([]), fontSizePt: 11 });

test.each([
  ['off', '<w:kern w:val="0"/>', false],
  ['on at 1pt', '<w:kern w:val="2"/>', true],
  ['on at the run size', '<w:kern w:val="40"/>', true],
  ['above the run size', '<w:kern w:val="42"/>', false],
])('a math run with kerning %s lays out as math', (_name, kern, kerned) => {
  const { part, projection } = project(power(kern));
  const before = canonicalOoxmlFingerprint(part);
  const geometry = layoutEquation(projection, createFixedMeasurer(6, 14), surrounding).geometry;
  const texts = textStyles(geometry);
  expect(texts.map((entry) => entry.text)).toEqual(['text:±', 'text:5', 'text:p+1', 'text:4']);
  const base = texts[0]!.style!;
  expect(base.fontSizePt).toBe(20);
  expect(isRunKerningEnabled(base)).toBe(kerned);
  const saved = serializeOoxmlPart(part);
  if (kern) expect(saved).toContain(kern.replace('/>', ''));
  expect(canonicalOoxmlFingerprint(read(saved))).toBe(before);
});

test('a math run without kerning keeps the surrounding kerning', () => {
  const kerning = Object.freeze({ ...surrounding, kerningMinPt: 8, kerningEnabled: true });
  const geometry = layoutEquation(
    project(run('AV', '')).projection,
    createFixedMeasurer(6, 14),
    kerning
  ).geometry;
  expect(isRunKerningEnabled(textStyles(geometry)[0]!.style!)).toBe(true);
  const off = layoutEquation(
    project(run('AV', '<w:kern w:val="0"/>')).projection,
    createFixedMeasurer(6, 14),
    kerning
  ).geometry;
  expect(isRunKerningEnabled(textStyles(off)[0]!.style!)).toBe(false);
});
