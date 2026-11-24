// Saved field results laid out under the two field-result modes.
//
// `atomic` (the default) lays every field out as one model unit. `editable` lays the saved
// result of a DATE, MERGEFIELD, or HYPERLINK field out as ordinary text at the offsets the
// store's editable mode addresses, so the caret, a hit, and a selection inside the result land
// on its characters, also when the result wraps onto another line.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import {
  paragraphTextOf,
  readOoxmlPart,
  type FieldResultsMode,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { caretAt, paragraphTextFromLayout } from '../semantic-interaction.ts';
import { hitTestSemantic } from '../semantic-point-queries.ts';
import { selectionRects } from '../selection-rects.ts';
import type {
  ParagraphFragmentRecord,
  SemanticLayout,
  SpanLinkRecord,
} from '../semantic-records.ts';
import type { FieldLinkProjector } from '../field-pieces.ts';
import { paintSemanticLayout } from '../../output/semantic-paint.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const complex = (instruction: string, result: string) =>
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  `<w:r><w:instrText xml:space="preserve">${instruction}</w:instrText></w:r>` +
  `<w:r><w:fldChar w:fldCharType="separate"/></w:r>${result}` +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
const simple = (instruction: string, result: string) =>
  `<w:fldSimple w:instr="${instruction}">${result}</w:fldSimple>`;

function load(field: string): { part: OoxmlPart; id: string } {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p>${run('ab ')}${field}${run(' cd')}</w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!read.ok) throw Error(read.reason);
  const body = read.part.root.children[0]!;
  if (body.kind === 'textValue') throw Error('no body');
  return { part: read.part, id: body.children[0]!.id };
}

const linkProjector: FieldLinkProjector = (spec): SpanLinkRecord => ({
  id: `field:${spec.target}`,
  kind: 'external',
  href: spec.target,
});

function lay(
  part: OoxmlPart,
  fieldResults?: FieldResultsMode,
  extra: Partial<Parameters<typeof layoutSemanticDocument>[2]> = {}
): SemanticLayout {
  return layoutSemanticDocument(part, 1, {
    measurer,
    projectFieldLink: linkProjector,
    ...(fieldResults ? { fieldResults } : {}),
    ...extra,
  });
}

function fragmentOf(layout: SemanticLayout): ParagraphFragmentRecord {
  for (const page of layout.pages) {
    for (const fragment of page.fragments) if (fragment.kind === 'paragraph') return fragment;
  }
  throw Error('no paragraph');
}

const KINDS = [
  { label: 'complex DATE', field: complex(' DATE ', run('2020-01-02')), result: '2020-01-02' },
  {
    label: 'complex MERGEFIELD with two result runs',
    field: complex(' MERGEFIELD Name ', run('Na') + run('me')),
    result: 'Name',
  },
  {
    label: 'complex HYPERLINK',
    field: complex(' HYPERLINK "https://e/" ', run('link words')),
    result: 'link words',
  },
  { label: 'simple MERGEFIELD', field: simple(' MERGEFIELD Name ', run('Name')), result: 'Name' },
  {
    label: 'simple HYPERLINK with two result runs',
    field: simple(' HYPERLINK &quot;https://e/&quot; ', run('link ') + run('words')),
    result: 'link words',
  },
] as const;

describe('laid-out text follows the store addressing of each mode', () => {
  for (const { label, field, result } of KINDS) {
    test(`${label}: the default lays the field out as one unit`, () => {
      const { part, id } = load(field);
      const spans = fragmentOf(lay(part)).lines.flatMap((line) => line.spans);
      const fieldSpans = spans.filter((span) => span.fieldAtom);
      expect(fieldSpans.length).toBeGreaterThan(0);
      for (const span of fieldSpans) expect([span.range.start, span.range.end]).toEqual([3, 4]);
      expect(paragraphTextFromLayout(lay(part), id).length).toBe(paragraphTextOf(part, id)!.length);
    });

    test(`${label}: the editable mode lays the result out at its own offsets`, () => {
      const { part, id } = load(field);
      const layout = lay(part, 'editable');
      const text = paragraphTextOf(part, id, { fieldResults: 'editable' })!;
      expect(text).toBe(`ab ${result} cd`);
      expect(paragraphTextFromLayout(layout, id)).toBe(text);
      const fieldSpans = fragmentOf(layout)
        .lines.flatMap((line) => line.spans)
        .filter((span) => span.fieldAtom);
      // Every result piece is marked as the same field, by the range of the whole result.
      expect(
        fieldSpans.map((span) => [span.fieldAtom?.resultStart, span.fieldAtom?.resultEnd])
      ).toEqual(fieldSpans.map(() => [3, 3 + result.length]));
      expect(Math.min(...fieldSpans.map((span) => span.range.start))).toBe(3);
      expect(Math.max(...fieldSpans.map((span) => span.range.end))).toBe(3 + result.length);
    });

    test(`${label}: caret, hit test, and selection land inside the result`, () => {
      const { part, id } = load(field);
      const layout = lay(part, 'editable');
      const xs: number[] = [];
      for (let offset = 3; offset <= 3 + result.length; offset += 1) {
        const caret = caretAt(layout, { paragraphId: id, offset }, measurer)!;
        expect(caret).not.toBeNull();
        xs.push(caret.x);
        const hit = hitTestSemantic(layout, { x: caret.x + 1, y: caret.y + 2, pageIndex: 0 });
        if (offset < 3 + result.length) expect(hit?.position.offset).toBe(offset);
      }
      // One character apart each, at the measurer's advance.
      const step = xs[1]! - xs[0]!;
      expect(step).toBeGreaterThan(0);
      for (let index = 1; index < xs.length; index += 1) {
        expect(xs[index]! - xs[index - 1]!).toBeCloseTo(step, 5);
      }
      const rects = selectionRects(
        layout,
        { anchor: { paragraphId: id, offset: 4 }, head: { paragraphId: id, offset: 6 } },
        [id],
        measurer
      );
      expect(rects.reduce((sum, rect) => sum + rect.width, 0)).toBeCloseTo(2 * step, 5);
    });
  }

  test('live fields and a field holding another field stay one unit', () => {
    for (const field of [
      complex(' PAGE ', run('7')),
      complex(' QUOTE "x" ', run('a ') + complex(' QUOTE "y" ', run('b')) + run(' c')),
      simple(' PAGE ', run('7')),
    ]) {
      const { part, id } = load(field);
      const layout = lay(part, 'editable');
      expect(paragraphTextFromLayout(layout, id).length).toBe(
        paragraphTextOf(part, id, { fieldResults: 'editable' })!.length
      );
      expect(paragraphTextOf(part, id, { fieldResults: 'editable' })!.length).toBe(7);
    }
  });
});

describe('a result that wraps onto another line', () => {
  const words = 'aaaa bbbb cccc dddd eeee ffff gggg hhhh';
  const narrow = {
    geometry: {
      width: 160,
      height: 400,
      margin: { top: 20, right: 20, bottom: 20, left: 20 },
    },
  };

  test('the caret inside the second line of the result paints on that line', () => {
    const { part, id } = load(complex(' MERGEFIELD Long ', run(words)));
    const layout = lay(part, 'editable', narrow);
    const lines = fragmentOf(layout).lines;
    expect(lines.length).toBeGreaterThan(1);
    const second = lines[1]!;
    const offset = second.spans[0]!.range.start + 1;
    // The offset is inside the result: the field starts at 3 and ends after the words.
    expect(offset).toBeGreaterThan(3);
    expect(offset).toBeLessThan(3 + words.length);
    const caret = caretAt(layout, { paragraphId: id, offset }, measurer)!;
    expect(caret.lineId).toBe(second.id);
    const first = caretAt(layout, { paragraphId: id, offset: 4 }, measurer)!;
    expect(first.lineId).toBe(lines[0]!.id);
  });
});

describe('paint', () => {
  test('a multi-run link result paints one anchor in the editable mode', () => {
    for (const field of [
      complex(' HYPERLINK "https://e/" ', run('link ') + run('words')),
      simple(' HYPERLINK &quot;https://e/&quot; ', run('link ') + run('words')),
    ]) {
      const { part } = load(field);
      const host = document.createElement('div');
      paintSemanticLayout(host, lay(part, 'editable'));
      const anchors = host.querySelectorAll('a.docx-hyperlink');
      expect(anchors.length).toBe(1);
      expect(anchors[0]!.textContent).toBe('link words');
    }
  });
});

describe('caches', () => {
  test('a shared paragraph cache never serves one mode to the other', () => {
    const { part, id } = load(complex(' DATE ', run('2020-01-02')));
    const cache = createParagraphLayoutCache<never>();
    const shared = { cache, producer: 'shared' } as const;
    const atomic = paragraphTextFromLayout(lay(part, undefined, shared), id);
    const editable = paragraphTextFromLayout(lay(part, 'editable', shared), id);
    const atomicAgain = paragraphTextFromLayout(lay(part, undefined, shared), id);
    expect(editable).toBe('ab 2020-01-02 cd');
    expect(atomicAgain).toBe(atomic);
    expect(atomic.length).toBe(paragraphTextOf(part, id)!.length);
  });

  test('an autofit table cell never reuses widths from the other mode', () => {
    const field = complex(' MERGEFIELD Long ', run('aaaa bbbb cccc dddd'));
    const read = readOoxmlPart(
      `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>` +
        '<w:tblLayout w:type="autofit"/></w:tblPr><w:tblGrid><w:gridCol w:w="500"/></w:tblGrid>' +
        `<w:tr><w:tc><w:p>${field}</w:p></w:tc></w:tr></w:tbl><w:p/></w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'application/xml' }
    );
    if (!read.ok) throw Error(read.reason);
    const cache = createParagraphLayoutCache<never>();
    const shared = { cache, producer: 'shared' } as const;
    const widthOf = (layout: SemanticLayout): number => {
      const table = layout.pages[0]!.fragments.find((fragment) => fragment.kind === 'table')!;
      return table.box.width;
    };
    const atomic = widthOf(lay(read.part, undefined, shared));
    const editable = widthOf(lay(read.part, 'editable', shared));
    const atomicAgain = widthOf(lay(read.part, undefined, shared));
    expect(atomicAgain).toBe(atomic);
    // A result that breaks as text needs no wider column than its longest word.
    expect(editable).toBeLessThanOrEqual(atomic);
    expect(
      widthOf(
        lay(read.part, 'editable', {
          cache: createParagraphLayoutCache<never>(),
          producer: 'fresh',
        })
      )
    ).toBe(editable);
  });
});
