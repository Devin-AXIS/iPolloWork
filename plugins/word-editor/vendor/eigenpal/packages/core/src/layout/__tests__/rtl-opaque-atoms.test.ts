import { describe, expect, test } from 'bun:test';
import { loadBody } from './float-over-table-harness.ts';
import { breakParagraph } from '../paragraph-flow.ts';
import { createFixedMeasurer } from '../semantic-layout.ts';
import { bidiPieces, reorderBidiSpans } from '../rtl-paragraph.ts';
import { DEFAULT_RUN_STYLE } from '../run-style.ts';
import type { FieldAwarePiece } from '../field-pieces.ts';

// Right-to-left text that shares its paragraph with an opaque atom: an anchored drawing's
// placeholder, a symbol, an equation, or unsupported content. The text keeps its own order
// and joining, and the atom keeps its range and metadata.

const RTL = [{ localName: 'rtl' }] as const;
const plain = (text: string, start: number): FieldAwarePiece => ({
  text,
  start,
  end: start + text.length,
  props: RTL,
  style: DEFAULT_RUN_STYLE,
});
const first = 'مرحبا ';
const second = ' بالعالم';

describe.each([
  ['an anchored drawing', { text: '￼', projected: true, anchoredAtom: true } as const],
  ['a symbol glyph', { text: '', projected: true } as const],
  ['an equation', { text: 'x', projected: true, equation: {} as never } as const],
  ['a projected mark', { text: '*', projected: true, measureText: '**' } as const],
])('%s between Arabic words', (_name, extra) => {
  const atomStart = first.length;
  const atom: FieldAwarePiece = { ...plain('x', atomStart), ...extra, end: atomStart + 1 };
  const pieces = [plain(first, 0), atom, plain(second, atomStart + 1)];

  test('resolves the words right to left', () => {
    const resolved = bidiPieces(pieces, true);
    expect(resolved).not.toBe(pieces);
    for (const piece of resolved.filter((candidate) => /\p{L}/u.test(candidate.text))) {
      if (piece === resolved.find((candidate) => candidate.start === atomStart)) continue;
      expect(piece.style.shaping?.direction).toBe('rtl');
      expect(piece.style.shaping?.level).toBe(1);
    }
  });

  test('restores the atom with its range and metadata', () => {
    const resolved = bidiPieces(pieces, true);
    const restored = resolved.find((piece) => piece.start === atomStart)!;
    expect(restored.text).toBe(atom.text);
    expect(restored.end).toBe(atomStart + 1);
    expect(restored.projected).toBe(true);
    expect(restored.anchoredAtom).toBe(atom.anchoredAtom);
    expect(restored.measureText).toBe(atom.measureText);
    expect(restored.equation).toBe(atom.equation);
    expect(restored.style.shaping?.level).toBe(1);
    expect(resolved.map((piece) => piece.text).join('')).toBe(first + atom.text + second);
  });

  test('joins the letters of a word split around the atom by formatting', () => {
    const coloured = { ...plain('با', 3), style: { ...DEFAULT_RUN_STYLE, color: '#c00000' } };
    const word = [plain('مرح', 0), coloured, { ...atom, start: 5, end: 6 }, plain(second, 6)];
    const resolved = bidiPieces(word, true);
    const tail = resolved.find((piece) => piece.text === 'با')!;
    expect(tail.style.shaping?.context?.before).toContain('مرح');
  });
});

test('zero-width unsupported content takes a neighbouring level and keeps the offsets', () => {
  const unsupported: FieldAwarePiece = {
    ...plain('￼', first.length),
    end: first.length,
    projected: true,
    unsupported: {} as never,
  };
  const pieces = [plain(first, 0), unsupported, plain(second, first.length)];
  const resolved = bidiPieces(pieces, true);
  expect(resolved).not.toBe(pieces);
  const placeholder = resolved.find((piece) => piece.unsupported)!;
  expect(placeholder.start).toBe(first.length);
  expect(placeholder.end).toBe(first.length);
  expect(placeholder.style.shaping?.level).toBe(1);
  const text = resolved.filter((piece) => !piece.unsupported);
  expect(text.map((piece) => piece.text).join('')).toBe(first + second);
  expect(text.at(-1)!.end).toBe(first.length + second.length);
  for (const piece of text) expect(piece.style.shaping?.direction).toBe('rtl');
});

test('a positional tab keeps the existing fallback', () => {
  const tab: FieldAwarePiece = {
    ...plain('', first.length),
    end: first.length,
    positionalTab: {} as never,
  };
  const pieces = [plain(first, 0), tab, plain(second, first.length)];
  expect(bidiPieces(pieces, true)).toBe(pieces);
});

test('a symbol in a right-to-left paragraph leaves its words in right-to-left order', () => {
  const run = (text: string) =>
    '<w:r><w:rPr><w:rFonts w:cs="Arial"/><w:rtl/></w:rPr>' +
    `<w:t xml:space="preserve">${text}</w:t></w:r>`;
  const part = loadBody(
    '<w:p><w:pPr><w:bidi/><w:spacing w:after="0"/></w:pPr>' +
      run('אחת שתיים ') +
      '<w:r><w:sym w:font="Wingdings" w:char="F0FE"/></w:r>' +
      run(' שלוש ארבע') +
      '</w:p>'
  );
  const paragraph = part.root.children
    .flatMap((node) => node.children)
    .find((node) => node.kind === 'paragraph')!;
  const lines = breakParagraph(paragraph, paragraph.id, 0, 500, createFixedMeasurer(6, 14));
  expect(lines).toHaveLength(1);
  const spans = reorderBidiSpans(lines[0]!.spans, true);
  const x = (word: string) => spans.find((span) => span.text.includes(word))!.box.x;
  expect(x('אחת')).toBeGreaterThan(x('שתיים'));
  expect(x('שתיים')).toBeGreaterThan(x('שלוש'));
  expect(x('שלוש')).toBeGreaterThan(x('ארבע'));
});
