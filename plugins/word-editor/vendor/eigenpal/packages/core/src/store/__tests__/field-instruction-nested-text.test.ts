// Visible text for simple fields nested inside a complex field's instruction.
//
// A nested field between an atomic field's `begin` and `separate` is input to that field.
// Its saved result is not document text: visible text and automation reads show only
// the outer saved result, as layout paints it. Every nested field keeps its model unit, so
// raw offsets and the saved source do not change.

import { describe, expect, test } from 'bun:test';
import { atomicFieldSpansOf, FIELD_ATOM_CHAR } from '../package/field-nodes.ts';
import { fieldResultTextsOf } from '../package/field-result-text.ts';
import type { OoxmlParagraphNode } from '../package/ooxml-tree.ts';
import { readOoxmlPart, serializeOoxmlPart } from '../package/index.ts';
import { paragraphModelTextOf } from '../store/paragraph-model-text.ts';
import { projectVisibleParagraphText } from '../store/text-projection.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const run = (content: string) => `<w:r>${content}</w:r>`;
const text = (value: string) => run(`<w:t xml:space="preserve">${value}</w:t>`);
const instr = (value: string) => run(`<w:instrText xml:space="preserve">${value}</w:instrText>`);
const BEGIN = run('<w:fldChar w:fldCharType="begin"/>');
const SEPARATE = run('<w:fldChar w:fldCharType="separate"/>');
const END = run('<w:fldChar w:fldCharType="end"/>');
const simple = (instruction: string, result: string) =>
  `<w:fldSimple w:instr="${instruction}">${result}</w:fldSimple>`;
const styleRef = (result: string) => simple(' STYLEREF Heading ', result);
const complex = (instruction: string, result: string) =>
  BEGIN + instr(instruction) + SEPARATE + result + END;

/** `IF {first} <> "x" {second}` with a saved outer result. */
const conditional = (first: string, second: string, result: string) =>
  BEGIN +
  instr(' IF ') +
  first +
  instr(' &lt;&gt; "x" ') +
  second +
  instr(' ') +
  SEPARATE +
  result +
  END;

const TRIGGER =
  text('A') +
  conditional(styleRef(run('<w:t>S1</w:t><w:cr/>')), styleRef(text('S2')), text('R')) +
  text('Z');

function paragraphOf(body: string): OoxmlParagraphNode {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p>${body}</w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  const paragraph = read.part.root.children[0]!;
  if (paragraph.kind === 'textValue') throw new Error('no body');
  return paragraph.children[0] as OoxmlParagraphNode;
}

function visible(body: string, view: 'allMarkup' | 'original' = 'allMarkup'): string {
  const paragraph = paragraphOf(body);
  return projectVisibleParagraphText(paragraph, paragraphModelTextOf(paragraph), view).text;
}

describe('visible text of nested simple fields in an instruction', () => {
  test('only the outer saved result shows; raw offsets keep every unit', () => {
    const paragraph = paragraphOf(TRIGGER);
    const raw = paragraphModelTextOf(paragraph);
    // A, the IF field, two nested simple fields, Z.
    expect(raw).toBe(`A${FIELD_ATOM_CHAR}${FIELD_ATOM_CHAR}${FIELD_ATOM_CHAR}Z`);
    const projected = projectVisibleParagraphText(paragraph, raw);
    expect(projected.text).toBe('ARZ');
    expect([0, 1, 2, 3, 4, 5].map((offset) => projected.projectedOffset(offset))).toEqual([
      0, 1, 2, 2, 2, 3,
    ]);
    expect(projected.rawRange(1, 3)).toEqual({ start: 1, end: 5 });
    expect(projected.sliceRaw(0, raw.length)).toBe('ARZ');
    expect(projected.sliceRaw(2, 4)).toBe('');
  });

  test('the nested results stay out in every review view', () => {
    expect(visible(TRIGGER, 'original')).toBe('ARZ');
  });

  test('tracked, deleted, and linked nested fields stay out', () => {
    const inserted = `<w:ins w:id="1" w:author="Reviewer">${styleRef(text('S'))}</w:ins>`;
    const deleted = `<w:del w:id="2" w:author="Reviewer">${styleRef(text('S'))}</w:del>`;
    const linked = `<w:hyperlink w:anchor="target">${styleRef(text('S'))}</w:hyperlink>`;
    for (const nested of [inserted, deleted, linked]) {
      expect(visible(text('A') + conditional(nested, '', text('R')) + text('Z'))).toBe('ARZ');
    }
  });

  test('a simple field in a nested instruction inside a saved result stays out', () => {
    const body =
      text('A') +
      complex(' QUOTE ', text('R1') + conditional(styleRef(text('S')), '', text('R2'))) +
      text('Z');
    expect(visible(body)).toBe('AR1R2Z');
  });

  test('a simple field in a level-3 instruction stays out', () => {
    const body =
      text('A') +
      complex(' QUOTE ', complex(' QUOTE ', conditional(styleRef(text('S')), '', text('R3')))) +
      text('Z');
    expect(visible(body)).toBe('AR3Z');
  });

  test('a nested field with no separate hides only its own instruction', () => {
    const noSeparate = BEGIN + instr(' IF ') + text('X') + END;
    const body = text('A') + complex(' QUOTE ', text('R') + noSeparate + text('Q')) + text('Z');
    expect(visible(body)).toBe('ARQZ');
  });
});

describe('fields outside an atomic instruction keep their text', () => {
  test('a simple field in the saved result shows its own result', () => {
    const body = complex(' QUOTE ', text('R') + styleRef(text('S')));
    expect(visible(body)).toBe('RS');
  });

  test('an unterminated outer field demotes; its nested field shows as before', () => {
    const body = text('A') + BEGIN + instr(' IF ') + styleRef(text('S')) + SEPARATE + text('R');
    expect(visible(body)).toBe('ASR');
  });

  test('an editable text form field keeps nested instruction fields as before', () => {
    const body = BEGIN + instr(' FORMTEXT ') + styleRef(text('S')) + SEPARATE + text('typed') + END;
    const paragraph = paragraphOf(body);
    expect(atomicFieldSpansOf(paragraph).some((span) => span.kind === 'complex')).toBe(false);
    expect(visible(body)).toBe('Styped');
  });
});

describe('saved results inside a simple field', () => {
  test('a nested instruction inside the cache adds nothing', () => {
    const nestedComplex = complex(' STYLEREF H ', text('C'));
    for (const nested of [styleRef(run('<w:t>S</w:t><w:cr/>')), nestedComplex]) {
      const outer = simple(' QUOTE x ', conditional(nested, '', text('R')));
      const paragraph = paragraphOf(text('A') + outer + text('Z'));
      const spans = atomicFieldSpansOf(paragraph);
      const outerSpan = spans.find((span) => span.kind === 'simple')!;
      expect(fieldResultTextsOf(paragraph, spans).get(outerSpan.node.id)).toBe('R');
    }
  });

  test('an unterminated begin in the cache hides nothing after it', () => {
    const outer = simple(' QUOTE x ', text('R') + BEGIN + instr(' IF ') + text('T'));
    expect(visible(text('A') + outer + text('Z'))).toBe('ARTZ');
  });
});

describe('saved source', () => {
  test('the nested fields and their saved results serialize unchanged', () => {
    const read = readOoxmlPart(
      `<w:document xmlns:w="${W}"><w:body><w:p>${TRIGGER}</w:p></w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!read.ok) throw new Error(read.reason);
    const xml = serializeOoxmlPart(read.part);
    expect(xml.match(/<w:fldSimple w:instr=" STYLEREF Heading ">/g)?.length).toBe(2);
    expect(xml).toContain('S1');
    expect(xml).toContain('<w:cr/>');
    expect(xml).toContain('S2');
  });
});
