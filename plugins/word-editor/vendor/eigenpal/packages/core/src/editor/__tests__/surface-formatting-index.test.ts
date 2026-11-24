import { expect, test } from 'bun:test';
import { paragraphFormattingEntry } from '../surface-formatting-index.ts';
import { lay, load, para } from '../../layout/__tests__/table-row-keep-fixtures.ts';
import type { ParagraphFragmentRecord, SemanticLayout } from '../../layout/semantic-records.ts';

const initial = lay(load(para('first')));
const base = initial.pages[0]!.fragments[0] as ParagraphFragmentRecord;
function paragraph(id: string): ParagraphFragmentRecord {
  return {
    ...base,
    id,
    paragraphId: id,
    range: { ...base.range, paragraphId: id },
    lines: base.lines.map((line) => ({
      ...line,
      range: { ...line.range, paragraphId: id },
      spans: line.spans.map((span) => ({ ...span, range: { ...span.range, paragraphId: id } })),
    })),
  };
}
function layout(fragments: readonly ParagraphFragmentRecord[]): SemanticLayout {
  return { ...initial, pages: [{ ...initial.pages[0]!, fragments }] };
}

test('continuations keep opening properties and the first available empty style', () => {
  const first = paragraph('shared');
  const emptyStyle = first.lines[0]!.spans[0]!.style;
  const continuation = { ...first, props: [], emptyParagraphStyle: emptyStyle };
  const result = paragraphFormattingEntry(layout([first, continuation]), 'shared');
  expect(result?.fragment).toBe(first);
  expect(result?.emptyStyle).toBe(emptyStyle);
  expect(result?.indent.inTable).toBe(false);
});

test('reused pages share formatting entries between layout revisions', () => {
  const source = layout([paragraph('shared')]);
  const next = { ...source, revision: source.revision + 1 };
  expect(paragraphFormattingEntry(source, 'shared')).toBe(paragraphFormattingEntry(next, 'shared'));
  expect(paragraphFormattingEntry(next, 'missing')).toBeUndefined();
});

test('merged paragraph members receive the survivor formatting', () => {
  const survivor = paragraph('survivor');
  const absorbed = paragraph('absorbed');
  const merged = {
    ...survivor,
    lines: [
      { ...survivor.lines[0]!, spans: [...survivor.lines[0]!.spans, ...absorbed.lines[0]!.spans] },
    ],
  };
  const source = layout([merged]);
  expect(paragraphFormattingEntry(source, 'absorbed')?.fragment).toBe(merged);
  expect(paragraphFormattingEntry(source, 'survivor')?.fragment).toBe(merged);
});

test('a point read visits later pages only when their formatting is requested', () => {
  const first = paragraph('first');
  const last = paragraph('last');
  let visits = 0;
  const later = {
    ...initial.pages[0]!,
    index: 1,
    get fragments() {
      visits++;
      return [last];
    },
  };
  const source = { ...initial, pages: [{ ...initial.pages[0]!, fragments: [first] }, later] };
  expect(paragraphFormattingEntry(source, 'first')?.fragment).toBe(first);
  expect(visits).toBe(0);
  expect(paragraphFormattingEntry(source, 'last')?.fragment).toBe(last);
  expect(visits).toBe(1);
  expect(paragraphFormattingEntry(source, 'first')?.fragment).toBe(first);
  expect(visits).toBe(1);
});

test('an empty-style query can continue across pages without replacing opening properties', () => {
  const first = paragraph('shared');
  const emptyStyle = first.lines[0]!.spans[0]!.style;
  const continuation = { ...first, props: [], emptyParagraphStyle: emptyStyle };
  const source = {
    ...initial,
    pages: [
      { ...initial.pages[0]!, fragments: [first] },
      { ...initial.pages[0]!, index: 1, fragments: [continuation] },
    ],
  };
  expect(paragraphFormattingEntry(source, 'shared')?.emptyStyle).toBeUndefined();
  const result = paragraphFormattingEntry(source, 'shared', true);
  expect(result?.emptyStyle).toBe(emptyStyle);
  expect(result?.fragment).toBe(first);
});
