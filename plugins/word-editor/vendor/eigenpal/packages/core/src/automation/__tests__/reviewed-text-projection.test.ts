import { describe, expect, test } from 'bun:test';
import { bodyStoryRoot, storyParagraphs } from '../../store/package/story-blocks.ts';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import type { OoxmlParagraphNode } from '../../store/package/ooxml-tree.ts';
import { paragraphTextOf } from '../../store/store/tree-op-apply.ts';
import { docx } from './support/protocol.ts';
import { hasUnpairedSurrogate, textRangeBoundaries } from '../plan-text-ranges.ts';
import { projectParagraphText, projectReviewedParagraphText } from '../text-projection.ts';

const run = (text: string): string => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const AUTHOR = 'w:author="Ada" w:date="2026-01-01T00:00:00Z"';
const deleted = (text: string): string =>
  `<w:del w:id="1" ${AUTHOR}><w:r><w:delText xml:space="preserve">${text}</w:delText></w:r></w:del>`;
const inserted = (text: string): string => `<w:ins w:id="2" ${AUTHOR}>${run(text)}</w:ins>`;

function paragraphOf(inline: string): { paragraph: OoxmlParagraphNode; rawText: string } {
  const loaded = readOoxmlPackage(docx(`<w:p>${inline}</w:p>`));
  if (!loaded.ok) throw new Error(`fixture did not open: ${loaded.reason}`);
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  const paragraph = storyParagraphs(bodyStoryRoot(part)!)[0];
  if (!paragraph || paragraph.kind !== 'paragraph') throw new Error('paragraph missing');
  return { paragraph, rawText: paragraphTextOf(part, paragraph.id) ?? '' };
}

describe('projectReviewedParagraphText', () => {
  test('current drops deletions and original drops insertions', () => {
    const { paragraph, rawText } = paragraphOf(
      run('Pay ') + deleted('sixty') + inserted('thirty') + run(' days.')
    );
    expect(projectReviewedParagraphText(paragraph, rawText, 'current').text).toBe(
      'Pay thirty days.'
    );
    expect(projectReviewedParagraphText(paragraph, rawText, 'original').text).toBe(
      'Pay sixty days.'
    );
  });

  test('current drops deleted text inside a field result', () => {
    const { paragraph, rawText } = paragraphOf(
      run('See ') +
        `<w:fldSimple w:instr=" REF x ">${run('old ')}${deleted('gone ')}${run('new')}</w:fldSimple>`
    );
    expect(projectReviewedParagraphText(paragraph, rawText, 'current').text).toBe('See old new');
    expect(projectReviewedParagraphText(paragraph, rawText, 'original').text).toBe(
      'See old gone new'
    );
  });
});

describe('textRangeBoundaries', () => {
  test('ends a range after each mark, longest mark first', () => {
    const text = 'a, b,, c';
    const slices = (marks: string[], trim: boolean) =>
      textRangeBoundaries(
        text,
        0,
        text.length,
        [...marks].sort((l, r) => r.length - l.length),
        trim
      ).map(([start, end]) => text.slice(start, end));
    expect(slices([','], false)).toEqual(['a,', ' b,', ',', ' c']);
    expect(slices([',,', ','], true)).toEqual(['a,', 'b,,', 'c']);
  });

  test('never splits a surrogate pair and clips to the requested window', () => {
    const text = 'x \u{1F600}y z';
    const found = textRangeBoundaries(text, 2, text.length, [' '], true).map(([start, end]) =>
      text.slice(start, end)
    );
    expect(found).toEqual(['\u{1F600}y', 'z']);
  });

  test('hidden characters hold no mark and never start or end a range', () => {
    // "ab[ ]cd ef[gh]": the bracketed characters are hidden.
    const text = 'ab cd efgh';
    const hidden = new Set([2, 8, 9]);
    const found = textRangeBoundaries(text, 0, text.length, [' '], false, (at) => !hidden.has(at));
    expect(found.map(([start, end]) => text.slice(start, end))).toEqual(['ab cd ', 'ef']);
  });

  test('finds unpaired surrogates', () => {
    expect(hasUnpairedSurrogate('\u{1F600}')).toBe(false);
    expect(hasUnpairedSurrogate('\uD83D')).toBe(true);
    expect(hasUnpairedSurrogate('\uDE00x')).toBe(true);
    expect(hasUnpairedSurrogate('x\uD83D')).toBe(true);
  });
});

describe('projectedOffsets', () => {
  test('matches projectedOffset at every model boundary', () => {
    const field = `<w:fldSimple w:instr=" PAGE ">${run('12')}</w:fldSimple>`;
    const { paragraph, rawText } = paragraphOf(
      run('a ') + field + inserted('new ') + run('b ') + field + deleted('old') + run(' c')
    );
    for (const view of ['allMarkup', 'original', 'model'] as const) {
      const projected = projectParagraphText(paragraph, rawText, view);
      for (const [from, to] of [
        [0, rawText.length],
        [1, rawText.length - 1],
        [3, 3],
      ] as const) {
        const expected = Array.from({ length: to - from + 1 }, (_, i) =>
          projected.projectedOffset(from + i)
        );
        expect(Array.from(projected.projectedOffsets(from, to))).toEqual(expected);
      }
    }
  });
});
