import { expect, test } from 'bun:test';
import { loadBody, squareWrapZone } from './float-over-table-harness.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import type { PendingLine } from '../paragraph-flow.ts';
import type { ParagraphFragmentRecord } from '../semantic-records.ts';

const text = 'abcdefghij abcdefghij abcdefghij';
const p = (value: string, props = '') =>
  `<w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="exact"/>${props}</w:pPr><w:r><w:t>${value}</w:t></w:r></w:p>`;
const spacing = (before: number, after = 0) =>
  `<w:spacing w:before="${before * 20}" w:after="${after * 20}" w:line="240" w:lineRule="exact"/>`;

function render(bodyXml: string, top: number, height = 25, pageHeight = 200) {
  const source = loadBody(bodyXml);
  const body = source.root.children.find((n) => n.kind !== 'textValue' && n.localName === 'body')!;
  const anchorParagraphId = body.children[0]!.id;
  const options = {
    measurer: createFixedMeasurer(6, 12),
    geometry: { width: 180, height: pageHeight, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
    drawingExclusionZonesByPage: new Map([
      [0, [squareWrapZone({ anchorParagraphId, top, height, left: 0, width: 90 })]],
    ]),
    drawingExclusionPass: 0,
  };
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache<readonly PendingLine[]>();
  const cold = layoutSemanticDocument(source, 0, options);
  for (let revision = 0; revision < 2; revision++) {
    expect(layoutSemanticDocument(source, revision, { ...options, session, cache }).pages).toEqual(
      cold.pages
    );
  }
  return cold.pages.map((page) =>
    page.fragments.filter((f): f is ParagraphFragmentRecord => f.kind === 'paragraph')
  );
}

for (const top of [12, 40]) {
  test(`wrap uses the placed paragraph top with an exclusion beginning at ${top} pt`, () => {
    const para = render(p('Lead') + p(text, spacing(30)), top)[0]![1]!;
    expect(para.lines[0]!.box.y).toBe(42);
    expect(para.lines).toHaveLength(top === 12 ? 1 : 3);
    expect(para.lines[0]!.spans[0]!.box.x).toBe(top === 12 ? 0 : 90);
  });
}

test('before and after spacing collapse before selecting the wrap band', () => {
  const para = render(p('Lead', spacing(0, 20)) + p(text, spacing(30)), 40)[0]![1]!;
  expect(para.lines[0]!.box.y).toBe(42);
  expect(para.lines).toHaveLength(3);
  expect(para.lines[0]!.spans[0]!.box.x).toBe(90);
});

test('contextual spacing suppression keeps wrapping at the unspaced origin', () => {
  const sameStyle = '<w:pStyle w:val="Shared"/><w:contextualSpacing/>';
  const para = render(p('Lead', sameStyle) + p(text, sameStyle + spacing(30)), 40)[0]![1]!;
  expect(para.lines[0]!.box.y).toBe(12);
  expect(para.lines).toHaveLength(1);
  expect(para.lines[0]!.spans[0]!.box.x).toBe(0);
});

test('opening paragraph border clearance participates in the wrap origin', () => {
  const border = '<w:pBdr><w:top w:val="single" w:sz="16" w:space="4"/></w:pBdr>';
  const para = render(p('Lead') + p(text, border), 16)[0]![1]!;
  expect(para.lines[0]!.box.y).toBe(18);
  expect(para.lines).toHaveLength(3);
  expect(para.lines[0]!.spans[0]!.box.x).toBe(90);
});

test('continuation pages do not reapply paragraph before-spacing or the opening border', () => {
  const border = '<w:pBdr><w:top w:val="single" w:sz="16" w:space="4"/></w:pBdr>';
  const pages = render(
    p('Lead') + p(text.repeat(3), spacing(10) + border + '<w:widowControl w:val="0"/>'),
    25,
    100,
    65
  );
  expect(pages.length).toBeGreaterThan(1);
  expect(pages[0]![1]!.lines[0]!.box.y).toBe(28);
  expect(pages[1]![0]!.lines[0]!.box.y).toBe(0);
  expect(
    pages
      .flat()
      .slice(1)
      .flatMap((p) => p.lines)
      .flatMap((l) => l.spans)
      .map((s) => s.text)
      .join('')
  ).toBe(text.repeat(3));
});

test('a kept paragraph moved whole measures its opening border only once', () => {
  const border = '<w:pBdr><w:top w:val="single" w:sz="16" w:space="4"/></w:pBdr>';
  const source = loadBody(
    p('Lead', '<w:spacing w:after="0" w:line="800" w:lineRule="exact"/>') +
      p(text.repeat(3), border + '<w:keepLines/>')
  );
  const body = source.root.children.find((n) => n.kind !== 'textValue' && n.localName === 'body')!;
  const options = {
    measurer: createFixedMeasurer(6, 12),
    geometry: { width: 180, height: 70, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
    drawingExclusionPass: 0,
    drawingExclusionZonesByPage: new Map([
      [
        1,
        [
          squareWrapZone({
            anchorParagraphId: body.children[0]!.id,
            top: 6,
            height: 4,
            left: 0,
            width: 180,
          }),
        ],
      ],
    ]),
  };
  const layout = layoutSemanticDocument(source, 0, options);
  const moved = layout.pages[1]!.fragments.find(
    (f): f is ParagraphFragmentRecord => f.kind === 'paragraph'
  )!;
  expect(moved.lines[0]!.box.y).toBe(10);
});

test('one-shot pagination releases superseded wrap breaks before measuring the next suffix', () => {
  const source = loadBody(p('body text '.repeat(400), '<w:widowControl w:val="0"/>'));
  const body = source.root.children.find((n) => n.kind !== 'textValue' && n.localName === 'body')!;
  const zone = squareWrapZone({
    anchorParagraphId: body.children[0]!.id,
    top: 60,
    height: 24,
    left: 0,
    width: 180,
  });
  const base = createParagraphLayoutCache<readonly PendingLine[]>({ retainAcrossPasses: false });
  const resident = new Map<string, readonly PendingLine[]>();
  let peakLines = 0,
    largestBreak = 0;
  const cache = {
    ...base,
    set(key: string, value: readonly PendingLine[]) {
      base.set(key, value);
      resident.set(key, value);
      largestBreak = Math.max(largestBreak, value.length);
      peakLines = Math.max(
        peakLines,
        [...resident.values()].reduce((n, lines) => n + lines.length, 0)
      );
    },
    release(key: string) {
      base.release!(key);
      resident.delete(key);
    },
  };
  const layout = layoutSemanticDocument(source, 0, {
    measurer: createFixedMeasurer(6, 12),
    cache,
    geometry: { width: 180, height: 84, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
    drawingExclusionPass: 0,
    drawingExclusionZonesByPage: new Map(Array.from({ length: 100 }, (_, i) => [i, [zone]])),
  });
  expect(layout.pages.length).toBeGreaterThan(10);
  expect(peakLines).toBeLessThanOrEqual(largestBreak * 2);
  expect(resident.size).toBe(0);
});
