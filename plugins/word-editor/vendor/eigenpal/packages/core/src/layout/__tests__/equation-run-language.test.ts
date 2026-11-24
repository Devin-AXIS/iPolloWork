import { expect, test } from 'bun:test';
import {
  canonicalOoxmlFingerprint,
  equationExpressionToLinearMath,
  projectOmmlEquation,
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlGenericElementNode,
} from '@docx-editor.dev/core/store';
import { layoutEquation, type EquationGeometry } from '../equation-layout.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { resolveRunStyle } from '../run-style.ts';

const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const m = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const FONT = '<w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math" w:cs="Complex Face"/>';
const run = (text: string, properties: string) =>
  `<m:r><w:rPr>${FONT}<w:sz w:val="20"/><w:szCs w:val="20"/>${properties}</w:rPr><m:t>${text}</m:t></m:r>`;
const subscript = (language: string) =>
  `<m:sSub><m:e>${run('R', '')}</m:e><m:sub>${run('ab', language)}${run('cd', '')}</m:sub></m:sSub>`;

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

function texts(node: EquationGeometry): { text: string; size: number }[] {
  if (node.kind === 'text') return [{ text: node.text, size: node.fontSizePt }];
  if (node.kind === 'fallback') return [{ text: `fallback:${node.text}`, size: node.fontSizePt }];
  const parts =
    node.kind === 'row'
      ? node.items
      : node.kind === 'script'
        ? [node.base, node.subscript, node.superscript]
        : [];
  return parts.flatMap((part) => (part ? texts(part) : []));
}

test.each([
  ['a language', '<w:lang w:val="en-US"/>'],
  ['an East Asian and a bidirectional language', '<w:lang w:eastAsia="en-US" w:bidi="ar-SA"/>'],
])('a run that names %s lays out as math at its own size', (_name, language) => {
  const { part, projection } = project(subscript(language));
  const before = canonicalOoxmlFingerprint(part);
  expect(projection.expression).toMatchObject({ kind: 'script' });
  const style = Object.freeze({ ...resolveRunStyle([]), fontSizePt: 11 });
  const geometry = layoutEquation(projection, createFixedMeasurer(6, 14), style).geometry;
  expect(texts(geometry)).toEqual([
    { text: '𝑅', size: 10 },
    { text: '𝑎𝑏', size: 7 },
    { text: '𝑐𝑑', size: 7 },
  ]);
  expect(canonicalOoxmlFingerprint(part)).toBe(before);
  const saved = serializeOoxmlPart(part);
  for (const attribute of language.match(/w:[a-zA-Z]+="[^"]*"/g)!) {
    expect(saved).toContain(attribute);
  }
  expect(canonicalOoxmlFingerprint(read(saved))).toBe(before);
});

test('a run that names a language keeps compact replacement refused', () => {
  const body = `<m:r><w:rPr>${FONT}<w:lang w:val="en-US"/></w:rPr><m:t>a</m:t></m:r>`;
  expect(project(body).projection.expression).toMatchObject({ kind: 'text', format: {} });
  // An empty linear form means compact replacement cannot reproduce the source.
  expect(equationExpressionToLinearMath(project(body).projection.expression)).toBe('');
});

test.each([
  ['an unbounded tag', '<w:lang w:val="not a language tag"/>'],
  ['an unknown slot', '<w:lang w:other="en-US"/>'],
  ['a repeated language', '<w:lang w:val="en-US"/><w:lang w:val="fr-FR"/>'],
  ['a child element', '<w:lang w:val="en-US"><w:b/></w:lang>'],
])('a run whose language has %s keeps the bounded fallback', (_name, language) => {
  expect(project(subscript(language)).projection.expression).toMatchObject({ kind: 'fallback' });
});
