// Body inert field projection + formatting ownership.
//
// DATE / TOC / REF / SEQ / MERGEFIELD paint cached result text over one model atom.
// Hit-test spans must publish that atom range; Bold must target result runs, not the
// begin fldChar chrome run, without homogenising differently formatted result runs.

import { describe, expect, test } from 'bun:test';
import { createFixedMeasurer } from '../index.ts';
import { piecesOfParagraph } from '../field-projection.ts';
import { breakParagraph } from '../paragraph-flow.ts';
import { projectParagraphText } from '../../automation/text-projection.ts';
import { runPropertyEdits } from '../../editor/surface-formatting.ts';
import {
  FIELD_ATOM_CHAR,
  applyTreeOp,
  atomicFieldSpansOf,
  findNode,
  paragraphTextOf,
  readOoxmlPart,
  segmentsOf,
  type OoxmlNode,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const metadata = {
  name: '/word/document.xml',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
};

const measurer = createFixedMeasurer(6, 14);

function parse(bodyInner: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${bodyInner}</w:body></w:document>`,
    metadata
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function paragraphOf(part: OoxmlPart) {
  return part.root.children[0]!.children.find((c) => c.kind === 'paragraph')!;
}

function complexField(instr: string, resultRuns: string): string {
  return (
    `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
    `<w:r><w:instrText>${instr}</w:instrText></w:r>` +
    `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
    resultRuns +
    `<w:r><w:fldChar w:fldCharType="end"/></w:r>`
  );
}

function runHasBold(run: OoxmlNode | null | undefined): boolean {
  if (!run || run.kind !== 'run') return false;
  const rPr = run.children.find((c) => c.kind === 'runProperties');
  if (!rPr || rPr.kind === 'textValue') return false;
  return rPr.children.some((c) => c.kind !== 'textValue' && c.localName === 'b');
}

function runHasItalic(run: OoxmlNode | null | undefined): boolean {
  if (!run || run.kind !== 'run') return false;
  const rPr = run.children.find((c) => c.kind === 'runProperties');
  if (!rPr || rPr.kind === 'textValue') return false;
  return rPr.children.some((c) => c.kind !== 'textValue' && c.localName === 'i');
}

describe('inert body field atom projection', () => {
  for (const instr of ['DATE', 'TOC', 'REF bookmark', 'SEQ Figure', 'MERGEFIELD Name'] as const) {
    test(`${instr.split(' ')[0]} cached result publishes one-unit projected range`, () => {
      const part = parse(
        `<w:p>` +
          `<w:r><w:t>A</w:t></w:r>` +
          complexField(instr, `<w:r><w:t>January</w:t></w:r>`) +
          `<w:r><w:t>Z</w:t></w:r>` +
          `</w:p>`
      );
      const paragraph = paragraphOf(part);
      expect(paragraphTextOf(part, paragraph.id)).toBe(`A${FIELD_ATOM_CHAR}Z`);
      const pieces = piecesOfParagraph(paragraph);
      expect(pieces.map((p) => p.text)).toEqual(['A', 'January', 'Z']);
      expect(pieces[1]).toMatchObject({ start: 1, end: 2, projected: true });
      expect(pieces[2]).toMatchObject({ start: 2, end: 3 });

      const lines = breakParagraph(paragraph, paragraph.id, 0, 400, measurer, undefined, null);
      const fieldSpans = lines.flatMap((line) =>
        line.spans.filter((span) => span.text.includes('January') || span.projected)
      );
      expect(fieldSpans.length).toBeGreaterThan(0);
      for (const span of fieldSpans) {
        if (span.text === 'A' || span.text === 'Z') continue;
        expect(span.range).toEqual({ paragraphId: paragraph.id, start: 1, end: 2 });
        expect(span.projected).toBe(true);
        expect(span.range.end).toBeLessThanOrEqual(3);
      }
    });
  }

  test('nested result content occupies the same outer atom in store and layout', () => {
    const nested = complexField('DATE', '<w:r><w:t>inner</w:t></w:r>');
    const part = parse(
      '<w:p><w:r><w:t>A</w:t></w:r>' +
        complexField('IF', `<w:r><w:t>outer </w:t></w:r>${nested}<w:r><w:t> tail</w:t></w:r>`) +
        '<w:r><w:t>Z</w:t></w:r></w:p>'
    );
    const paragraph = paragraphOf(part);
    const model = paragraphTextOf(part, paragraph.id)!;
    const pieces = piecesOfParagraph(paragraph);

    expect(model).toBe(`A${FIELD_ATOM_CHAR}Z`);
    expect(pieces.at(-1)?.end).toBe(model.length);
    expect(pieces.filter((piece) => piece.projected)).toEqual([
      expect.objectContaining({ start: 1, end: 2 }),
    ]);
  });

  test('deep simple-field cached text agrees across store, projection, and layout', () => {
    let nested = '<w:r><w:t>deep</w:t></w:r>';
    for (let depth = 0; depth < 6; depth += 1) {
      nested = `<w:fldSimple w:instr=" IF ">${nested}</w:fldSimple>`;
    }
    const part = parse(`<w:p>${nested}</w:p>`);
    const paragraph = paragraphOf(part);
    const model = paragraphTextOf(part, paragraph.id)!;

    expect(model).toBe(FIELD_ATOM_CHAR);
    expect(projectParagraphText(paragraph, model, 'allMarkup').text).toBe('deep');
    expect(
      piecesOfParagraph(paragraph)
        .map((piece) => piece.text)
        .join('')
    ).toBe('deep');
  });

  test('an unmatched begin in a simple cache fails open everywhere', () => {
    const malformed =
      '<w:fldSimple w:instr=" IF "><w:r><w:t>A</w:t></w:r>' +
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:t>B</w:t></w:r></w:fldSimple>';
    const part = parse(`<w:p>${malformed}</w:p>`);
    const paragraph = paragraphOf(part);
    const model = paragraphTextOf(part, paragraph.id)!;

    expect(model).toBe(FIELD_ATOM_CHAR);
    expect(projectParagraphText(paragraph, model, 'allMarkup').text).toBe('AB');
    expect(
      piecesOfParagraph(paragraph)
        .map((piece) => piece.text)
        .join('')
    ).toBe('AB');
  });

  test('an unmatched begin in a complex result demotes to visible text everywhere', () => {
    const malformed =
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:instrText> IF </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      '<w:r><w:t>A</w:t></w:r>' +
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:t>B</w:t></w:r>' +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
    const part = parse(`<w:p>${malformed}</w:p>`);
    const paragraph = paragraphOf(part);
    const model = paragraphTextOf(part, paragraph.id)!;

    expect(model).toBe('AB');
    expect(projectParagraphText(paragraph, model, 'allMarkup').text).toBe('AB');
    expect(
      piecesOfParagraph(paragraph)
        .map((piece) => piece.text)
        .join('')
    ).toBe('AB');
  });
});

describe('field format ownership', () => {
  test('formatRunIds point at result run, not chrome-only begin', () => {
    const part = parse(
      `<w:p>` +
        `<w:r><w:t>A</w:t></w:r>` +
        complexField('DATE', `<w:r><w:rPr><w:i/></w:rPr><w:t>January</w:t></w:r>`) +
        `<w:r><w:t>Z</w:t></w:r>` +
        `</w:p>`
    );
    const paragraph = paragraphOf(part);
    const [span] = atomicFieldSpansOf(paragraph);
    expect(span).toBeDefined();
    expect(span!.formatRunIds).toHaveLength(1);
    expect(span!.formatRunIds[0]).not.toBe(span!.runId);
    expect(segmentsOf(paragraph)[1]!.formatRunIds).toEqual(span!.formatRunIds);
  });

  test('Select-All Bold formats the result run and leaves begin chrome unbolded', () => {
    const part = parse(
      `<w:p>` +
        `<w:r><w:t>A</w:t></w:r>` +
        complexField('DATE', `<w:r><w:rPr><w:i/></w:rPr><w:t>January</w:t></w:r>`) +
        `<w:r><w:t>Z</w:t></w:r>` +
        `</w:p>`
    );
    const paragraph = paragraphOf(part);
    const text = paragraphTextOf(part, paragraph.id)!;
    const span = atomicFieldSpansOf(paragraph)[0]!;
    const beginRunId = span.runId;
    const resultRunId = span.formatRunIds[0]!;

    const edits = runPropertyEdits(part, paragraph.id, 0, text.length, { localName: 'b' });
    expect(edits.some((edit) => edit.targetRunIds?.includes(resultRunId))).toBe(true);
    expect(edits.every((edit) => !edit.targetRunIds?.includes(beginRunId))).toBe(true);

    let current = part;
    for (const edit of edits) {
      const applied = applyTreeOp(current, {
        op: 'setRunProperties',
        paragraphId: paragraph.id,
        start: edit.start,
        end: edit.end,
        properties: edit.properties,
        ...(edit.targetRunIds ? { targetRunIds: edit.targetRunIds } : {}),
      });
      expect(applied.ok).toBe(true);
      if (!applied.ok) return;
      current = applied.part;
    }

    expect(runHasBold(findNode(current, beginRunId))).toBe(false);
    expect(runHasBold(findNode(current, resultRunId))).toBe(true);
    expect(runHasItalic(findNode(current, resultRunId))).toBe(true);

    const pieces = piecesOfParagraph(paragraphOf(current));
    const fieldPiece = pieces.find((p) => p.text === 'January');
    expect(fieldPiece?.style.bold).toBe(true);
    expect(fieldPiece?.style.italic).toBe(true);
  });

  test('Bold formats multiple differently styled result runs without homogenising', () => {
    const part = parse(
      `<w:p>` +
        complexField(
          'MERGEFIELD Name',
          `<w:r><w:rPr><w:i/></w:rPr><w:t>Jan</w:t></w:r>` +
            `<w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>uary</w:t></w:r>`
        ) +
        `</w:p>`
    );
    const paragraph = paragraphOf(part);
    const span = atomicFieldSpansOf(paragraph)[0]!;
    expect(span.formatRunIds).toHaveLength(2);
    const [firstId, secondId] = span.formatRunIds;

    const edits = runPropertyEdits(part, paragraph.id, 0, 1, { localName: 'b' });
    expect(edits).toHaveLength(2);
    expect(new Set(edits.flatMap((e) => e.targetRunIds ?? []))).toEqual(
      new Set([firstId, secondId])
    );

    let current = part;
    for (const edit of edits) {
      const applied = applyTreeOp(current, {
        op: 'setRunProperties',
        paragraphId: paragraph.id,
        start: edit.start,
        end: edit.end,
        properties: edit.properties,
        ...(edit.targetRunIds ? { targetRunIds: edit.targetRunIds } : {}),
      });
      expect(applied.ok).toBe(true);
      if (!applied.ok) return;
      current = applied.part;
    }

    const first = findNode(current, firstId!);
    const second = findNode(current, secondId!);
    expect(runHasBold(first)).toBe(true);
    expect(runHasItalic(first)).toBe(true);
    expect(runHasBold(second)).toBe(true);
    expect(runHasItalic(second)).toBe(false);
    const secondRPr =
      second!.kind === 'run' ? second!.children.find((c) => c.kind === 'runProperties') : null;
    expect(
      secondRPr &&
        secondRPr.kind !== 'textValue' &&
        secondRPr.children.some((c) => c.kind !== 'textValue' && c.localName === 'u')
    ).toBe(true);
  });

  test('same-run PAGE still formats the shared begin/result run', () => {
    const part = parse(
      `<w:p><w:r>` +
        `<w:fldChar w:fldCharType="begin"/>` +
        `<w:instrText>PAGE</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/>` +
        `<w:t>9</w:t>` +
        `<w:fldChar w:fldCharType="end"/>` +
        `</w:r></w:p>`
    );
    const paragraph = paragraphOf(part);
    const span = atomicFieldSpansOf(paragraph)[0]!;
    expect(span.formatRunIds).toEqual([span.runId]);
    const edits = runPropertyEdits(part, paragraph.id, 0, 1, { localName: 'b' });
    expect(edits).toHaveLength(1);
    const applied = applyTreeOp(part, {
      op: 'setRunProperties',
      paragraphId: paragraph.id,
      start: edits[0]!.start,
      end: edits[0]!.end,
      properties: edits[0]!.properties,
      ...(edits[0]!.targetRunIds ? { targetRunIds: edits[0]!.targetRunIds } : {}),
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(runHasBold(findNode(applied.part, span.runId))).toBe(true);
  });
});

for (const simple of [false, true]) {
  test(`${simple ? 'simple' : 'complex'} direction-prefix field formats its visible result`, () => {
    const result =
      '<w:r><w:rPr><w:rFonts w:cs="Control"/><w:cs/><w:szCs w:val="80"/></w:rPr><w:t>\u200e</w:t></w:r>' +
      '<w:r><w:rPr><w:rFonts w:ascii="Visible" w:hAnsi="Visible"/><w:sz w:val="20"/></w:rPr><w:t>Result</w:t></w:r>';
    const part = parse(
      `<w:p>${simple ? `<w:fldSimple w:instr="REF missing">${result}</w:fldSimple>` : complexField('REF missing', result)}</w:p>`
    );
    const paragraph = paragraphOf(part);
    const span = atomicFieldSpansOf(paragraph)[0]!;
    expect(span.formatRunIds).toHaveLength(2);
    const edits = runPropertyEdits(part, paragraph.id, 0, 1, {
      localName: 'sz',
      attributes: { val: '32' },
    });
    expect(new Set(edits.flatMap((edit) => edit.targetRunIds ?? []))).toEqual(
      new Set(span.formatRunIds)
    );
    let current = part;
    for (const edit of edits) {
      const applied = applyTreeOp(current, {
        op: 'setRunProperties',
        paragraphId: paragraph.id,
        start: edit.start,
        end: edit.end,
        properties: edit.properties,
        ...(edit.targetRunIds ? { targetRunIds: edit.targetRunIds } : {}),
      });
      expect(applied.ok).toBe(true);
      if (!applied.ok) return;
      current = applied.part;
    }
    const changed = paragraphOf(current);
    expect(piecesOfParagraph(changed)[0]).toMatchObject({
      text: '\u200eResult',
      style: { fontFamily: 'Visible', fontSizePt: 16 },
    });
    const plain = paragraphOf(
      parse('<w:p><w:r><w:rPr><w:sz w:val="32"/></w:rPr><w:t>Result</w:t></w:r></w:p>')
    );
    expect(breakParagraph(changed, changed.id, 0, 400, measurer, undefined, null)[0]!.height).toBe(
      breakParagraph(plain, plain.id, 0, 400, measurer, undefined, null)[0]!.height
    );
    expect(paragraphTextOf(current, changed.id)).toBe(FIELD_ATOM_CHAR);
  });
}
