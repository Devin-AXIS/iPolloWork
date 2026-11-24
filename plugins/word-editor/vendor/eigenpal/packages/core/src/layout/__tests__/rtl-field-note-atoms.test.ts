import { describe, expect, test } from 'bun:test';
import { paragraphTextOf } from '@docx-editor.dev/core/store';
import { loadBody } from './float-over-table-harness.ts';
import { breakParagraph, type ParagraphFlowOptions } from '../paragraph-flow.ts';
import { createFixedMeasurer } from '../semantic-layout.ts';
import type { FieldPageContext } from '../field-page-furniture.ts';
import { bidiPieces, reorderBidiSpans } from '../rtl-paragraph.ts';
import { DEFAULT_RUN_STYLE } from '../run-style.ts';
import type { FieldAwarePiece } from '../field-pieces.ts';

const FONT =
  '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/>' +
  '<w:sz w:val="24"/><w:szCs w:val="24"/>';
const run = (text: string, rtl = true) =>
  `<w:r><w:rPr>${FONT}${rtl ? '<w:rtl/>' : ''}</w:rPr>` +
  `<w:t xml:space="preserve">${text}</w:t></w:r>`;
const atomRun = (xml: string) => `<w:r><w:rPr>${FONT}</w:rPr>${xml}</w:r>`;
const before = 'אחת שתיים שלוש ';
const after = ' ארבע חמש שש';
const simplePage = (text: string, instruction = 'PAGE') =>
  `<w:fldSimple w:instr="${instruction}">${run(text, false)}</w:fldSimple>`;
const complexPage = (text: string) =>
  atomRun('<w:fldChar w:fldCharType="begin"/>') +
  atomRun('<w:instrText xml:space="preserve"> PAGE </w:instrText>') +
  atomRun('<w:fldChar w:fldCharType="separate"/>') +
  run(text, false) +
  atomRun('<w:fldChar w:fldCharType="end"/>');

function layout(content: string, flow?: ParagraphFlowOptions, page?: FieldPageContext) {
  const part = loadBody(
    '<w:p><w:pPr><w:bidi/><w:jc w:val="start"/>' +
      '<w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>' +
      content +
      '</w:p>'
  );
  const paragraph = part.root.children
    .flatMap((node) => node.children)
    .find((node) => node.kind === 'paragraph')!;
  const lines = breakParagraph(
    paragraph,
    paragraph.id,
    0,
    500,
    createFixedMeasurer(6, 14),
    undefined,
    null,
    [],
    undefined,
    page,
    undefined,
    flow
  );
  expect(lines).toHaveLength(1);
  const line = lines[0]!;
  return {
    line: { ...line, spans: reorderBidiSpans(line.spans, true) },
    model: paragraphTextOf(part, paragraph.id),
  };
}

function expectWordOrder(line: ReturnType<typeof layout>['line']) {
  const words = ['אחת', 'שתיים', 'שלוש', 'ארבע', 'חמש', 'שש'];
  const positions = words.map((word) => {
    const span = line.spans.find((candidate) => candidate.text.includes(word));
    expect(span).toBeDefined();
    return span!.box.x;
  });
  for (let index = 1; index < positions.length; index++) {
    expect(positions[index - 1]!).toBeGreaterThan(positions[index]!);
  }
}

test('ordinary Hebrew text preserves descending physical word positions', () => {
  const { line } = layout(run(before) + run('12', false) + run(after));
  expectWordOrder(line);
});

describe.each(['1', '12'])('a projected mark displaying %s', (mark) => {
  test.each([
    ['complex PAGE', complexPage],
    ['simple PAGE', simplePage],
  ] as const)('%s preserves word order and its one-character model range', (_label, field) => {
    const { line, model } = layout(run(before) + field(mark) + run(after));
    const spans = line.spans.filter((span) => span.fieldAtom);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.text).toBe(mark);
    expect(spans[0]!.range.start).toBe(before.length);
    expect(spans[0]!.range.end).toBe(before.length + 1);
    expect(model.length).toBe(before.length + 1 + after.length);
    expectWordOrder(line);
  });

  test.each(['footnoteReference', 'footnoteRef'] as const)(
    '%s preserves word order, navigation, and its one-character model range',
    (kind) => {
      const atom = atomRun(`<w:${kind}${kind === 'footnoteReference' ? ' w:id="1"' : ''}/>`);
      const { line, model } = layout(run(before) + atom + run(after), {
        noteMarks: {
          marks: new Map([['footnote:1', mark]]),
          activeNoteKey: 'footnote:1',
        },
      });
      const spans = line.spans.filter((span) => span.noteNav);
      expect(spans).toHaveLength(1);
      expect(spans[0]!.text).toBe(mark);
      expect(spans[0]!.noteNav?.direction).toBe(
        kind === 'footnoteReference' ? 'to-note' : 'to-body'
      );
      expect(spans[0]!.range.start).toBe(before.length);
      expect(spans[0]!.range.end).toBe(before.length + 1);
      expect(model.length).toBe(before.length + 1 + after.length);
      expectWordOrder(line);
    }
  );
});

test('a reserved multi-digit note mark retains its complete width and atomic range', () => {
  const { line } = layout(run(before) + atomRun('<w:footnoteReference w:id="1"/>') + run(after), {
    noteMarks: { marks: new Map([['footnote:1', '12']]), reservedMarkText: '999' },
  });
  const mark = line.spans.find((span) => span.noteNav)!;
  expect(mark.text).toBe('12');
  expect(mark.box.width).toBeCloseTo(createFixedMeasurer(6, 14).measure('999', mark.style), 8);
  expect(mark.range.end - mark.range.start).toBe(1);
  expectWordOrder(line);
});

test('live footer PAGE and NUMPAGES fields preserve their physical order and atomic ranges', () => {
  const { line } = layout(
    run('עמוד ') + simplePage('1') + run(' מתוך ') + simplePage('2', 'NUMPAGES'),
    undefined,
    { pageNumber: 12, pageCount: 24 }
  );
  const marks = line.spans.filter((span) => span.fieldAtom);
  expect(marks.map((span) => span.text)).toEqual(['12', '24']);
  expect(marks.map((span) => span.range.end - span.range.start)).toEqual([1, 1]);
  const first = line.spans.find((span) => span.text.includes('עמוד'))!;
  const middle = line.spans.find((span) => span.text.includes('מתוך'))!;
  expect(first.box.x).toBeGreaterThan(marks[0]!.box.x);
  expect(marks[0]!.box.x).toBeGreaterThan(middle.box.x);
  expect(middle.box.x).toBeGreaterThan(marks[1]!.box.x);
});

test.each(['\f', '\u00ad'])(
  'a numeric atom retains its range and metadata beside an ignored character %j',
  (ignored) => {
    const plain = (text: string, start: number): FieldAwarePiece => ({
      text,
      start,
      end: start + text.length,
      props: [{ localName: 'rtl' }],
      style: DEFAULT_RUN_STYLE,
    });
    const atom: FieldAwarePiece = {
      ...plain('12', 3),
      end: 4,
      projected: true,
      measureText: '999',
      noteNav: { scopeId: 'footnote:1', direction: 'to-note' },
    };
    const boundary: FieldAwarePiece = {
      ...plain(ignored, 2),
      ...(ignored === '\u00ad' ? { projected: true, measureText: '' } : {}),
    };
    const pieces = bidiPieces(
      [plain('אב', 0), boundary, atom, plain('גד', 4)],
      true,
      new Set([3, 4]),
      true
    );
    const resolved = pieces.find((piece) => piece.noteNav)!;
    expect(resolved.text).toBe('12');
    expect(resolved.start).toBe(3);
    expect(resolved.end).toBe(4);
    expect(resolved.measureText).toBe('999');
    expect(resolved.noteNav).toBe(atom.noteNav);
    expect(resolved.projected).toBe(true);
    expect(resolved.style.shaping).toBeDefined();
    expect(pieces.at(-1)!.end).toBe(6);
  }
);

test('a numeric field with a multi-character model range keeps the existing fallback', () => {
  const piece: FieldAwarePiece = {
    text: '12',
    start: 0,
    end: 2,
    props: [],
    style: DEFAULT_RUN_STYLE,
    projected: true,
    fieldAtom: { formField: false },
  };
  const pieces = [piece];
  expect(bidiPieces(pieces, true)).toBe(pieces);
});

test('many numeric atoms retain distinct metadata and complete source ranges', () => {
  const pieces: FieldAwarePiece[] = [];
  for (let index = 0; index < 128; index++) {
    const start = index * 3;
    pieces.push({
      text: 'אב',
      start,
      end: start + 2,
      props: [{ localName: 'rtl' }],
      style: DEFAULT_RUN_STYLE,
    });
    pieces.push({
      text: String(index + 10),
      start: start + 2,
      end: start + 3,
      props: [],
      style: DEFAULT_RUN_STYLE,
      projected: true,
      measureText: '999',
      noteNav: { scopeId: `footnote:${index}`, direction: 'to-note' },
    });
  }
  const result = bidiPieces(pieces, true);
  const atoms = result.filter((piece) => piece.noteNav);
  expect(atoms).toHaveLength(128);
  atoms.forEach((atom, index) => {
    expect(atom.text).toBe(String(index + 10));
    expect(atom.start).toBe(index * 3 + 2);
    expect(atom.end).toBe(index * 3 + 3);
    expect(atom.noteNav).toBe(pieces[index * 2 + 1]!.noteNav);
    expect(atom.measureText).toBe('999');
    expect(atom.style.shaping).toBeDefined();
  });
  expect(result.map((piece) => piece.text).join('')).toBe(
    pieces.map((piece) => piece.text).join('')
  );
});
