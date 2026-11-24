import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { breakParagraph, type PendingLine } from '../paragraph-flow.ts';
import { createFixedMeasurer } from '../semantic-layout.ts';
import { numericLinesHoldAtWidth } from '../numeric-width-proof.ts';
import { reuseParagraphAtWidth } from '../paragraph-cache-width-reuse.ts';
import type { ParagraphFlowOptions } from '../paragraph-flow-options.ts';

function paragraph(text: string, extra = '') {
  const read = readOoxmlPart(
    `<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${extra}<w:r><w:t>${text}</w:t></w:r></w:p>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw Error(read.reason);
  return read.part.root;
}
const measurer = createFixedMeasurer(6, 14);

function capture(text: string, width: number, flow?: ParagraphFlowOptions, indentLeft = 0) {
  const source = paragraph(text);
  const cache = createParagraphLayoutCache<readonly PendingLine[]>();
  const key = cache.keyFor!({ paragraph: source, properties: [], width, producer: 'test' });
  const lines = breakParagraph(
    source,
    source.id,
    indentLeft,
    width,
    measurer,
    cache,
    key,
    [],
    undefined,
    undefined,
    undefined,
    flow
  );
  return { source, cache, lines, cached: cache.get(key)! };
}

test('a numeric paragraph retains the exact observed break interval on live and frozen lines', () => {
  let accepted = 0;
  let refused = 0;
  for (const text of ['12345', '918273645', '11111111111111111111']) {
    for (const width of [7, 12, 19, 25, 37]) {
      const { source, lines, cached } = capture(text, width);
      if (lines.length < 2) continue;
      expect(numericLinesHoldAtWidth(lines, width)).toBe(true);
      expect(numericLinesHoldAtWidth(cached, width)).toBe(true);
      for (let candidate = 1; candidate < 60; candidate += 0.125) {
        const holds = numericLinesHoldAtWidth(cached, candidate);
        expect(numericLinesHoldAtWidth(lines, candidate)).toBe(holds);
        if (!holds) {
          refused++;
          continue;
        }
        accepted++;
        expect(cached).toEqual(
          breakParagraph(source, source.id, 0, candidate, measurer, undefined, null)
        );
      }
    }
  }
  expect(accepted).toBeGreaterThan(100);
  expect(refused).toBeGreaterThan(100);
});

test('numeric proof refuses other text and flow dependencies', () => {
  for (const text of ['12 345', '12-345', '12.345', 'abc123', '١٢٣٤٥', '1'.repeat(65)]) {
    const { lines } = capture(text, 19);
    expect(numericLinesHoldAtWidth(lines, 19)).toBe(false);
  }
  for (const flow of [
    { firstLineOffset: 1 },
    { paragraphRtl: true },
    { startOffset: 1 },
    { ownBandsFromFirstLine: new Set([0]) },
    { contentOriginX: -1 },
  ]) {
    const { lines } = capture('123456789', 19, flow);
    expect(numericLinesHoldAtWidth(lines, 19)).toBe(false);
  }
  expect(numericLinesHoldAtWidth(capture('123456789', 19, undefined, -20).lines, 19)).toBe(false);
});

test('certified numeric width alternatives reuse the frozen entry and reject changed dependencies', () => {
  const { source, cache, cached } = capture('123456789', 19);
  for (const width of [18, 19.125, 19.5]) {
    const key = cache.keyFor!({ paragraph: source, properties: [], width, producer: 'test' });
    expect(reuseParagraphAtWidth(cache, source, key, width)).toBe(cached);
    expect(cached).toEqual(breakParagraph(source, source.id, 0, width, measurer, undefined, null));
  }
  for (const width of [12, 24, 30]) {
    const key = cache.keyFor!({ paragraph: source, properties: [], width, producer: 'test' });
    expect(reuseParagraphAtWidth(cache, source, key, width)).toBeUndefined();
  }
  for (const changed of [
    { producer: 'different' },
    { projectionToken: 'changed-field' },
    { exclusionToken: 'float' },
  ]) {
    const key = cache.keyFor!({
      paragraph: source,
      properties: [],
      width: 20,
      producer: 'test',
      ...changed,
    });
    expect(reuseParagraphAtWidth(cache, source, key, 20)).toBeUndefined();
  }
  expect(cache.stats.size).toBe(1);
});

test('numeric width reuse preserves the line-origin clamp with negative indents', () => {
  let accepted = 0;
  for (const indent of [-100, -20, -1.25, -0.75, 0, 10]) {
    for (const origin of [0, 0.5, 100]) {
      const flow = { contentOriginX: origin };
      for (const width of [12, 19, 25, 37]) {
        const { source, cached } = capture('12345678901234567890', width, flow, indent);
        for (let candidate = 1; candidate < 45; candidate += 0.25) {
          if (!numericLinesHoldAtWidth(cached, candidate)) continue;
          accepted++;
          expect(candidate).toBeGreaterThanOrEqual(Math.max(1, -(origin + indent)));
          expect(cached).toEqual(
            breakParagraph(
              source,
              source.id,
              indent,
              candidate,
              measurer,
              undefined,
              null,
              [],
              undefined,
              undefined,
              undefined,
              flow
            )
          );
        }
      }
    }
  }
  expect(accepted).toBeGreaterThan(100);
});
