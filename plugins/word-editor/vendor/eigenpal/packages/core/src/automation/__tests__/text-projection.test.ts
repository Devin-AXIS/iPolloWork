import { describe, expect, test } from 'bun:test';
import { bodyStoryRoot, storyParagraphs } from '../../store/package/story-blocks.ts';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { readOoxmlPart, type OoxmlParagraphNode } from '../../store/package/ooxml-tree.ts';
import {
  MAX_FIELD_NESTING,
  collectFieldRunChildren,
  type AtomicFieldSpan,
  type FieldRunChildRef,
} from '../../store/package/field-nodes.ts';
import {
  MAX_FIELD_RESULT_CHARS,
  fieldResultTextsOf,
} from '../../store/package/field-result-text.ts';
import { SEARCH_MATCH_LIMIT } from '../../store/store/text-match.ts';
import { paragraphTextOf } from '../../store/store/tree-op-apply.ts';
import { docx } from './support/protocol.ts';
import {
  hideInsertionSpansFromPieces,
  projectionFromPieces,
  projectParagraphText,
  visibleParagraphPieces,
  type RawSpan,
} from '../text-projection.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const run = (text: string): string => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const begin = '<w:r><w:fldChar w:fldCharType="begin"/></w:r>';
const separate = '<w:r><w:fldChar w:fldCharType="separate"/></w:r>';
const end = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
const field = (instruction: string, result: string): string =>
  begin +
  `<w:r><w:instrText xml:space="preserve">${instruction}</w:instrText></w:r>` +
  separate +
  result +
  end;

function lowCompressionText(length: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let state = 0x1234_5678;
  let text = '';
  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    text += alphabet[state % alphabet.length];
  }
  return text;
}

function paragraphOf(inline: string): { paragraph: OoxmlParagraphNode; rawText: string } {
  const loaded = readOoxmlPackage(docx(`<w:p>${inline}</w:p>`));
  if (!loaded.ok) throw new Error(`fixture did not open: ${loaded.reason}`);
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart);
  if (!part) throw new Error('main part missing');
  const root = bodyStoryRoot(part);
  if (!root) throw new Error('body missing');
  const paragraph = storyParagraphs(root)[0];
  if (!paragraph || paragraph.kind !== 'paragraph') throw new Error('paragraph missing');
  return { paragraph, rawText: paragraphTextOf(part, paragraph.id) ?? '' };
}

function largeParagraphOf(inline: string): { paragraph: OoxmlParagraphNode; rawText: string } {
  const loaded = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p>${inline}</w:p></w:body></w:document>`,
    {
      name: '/word/document.xml',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    }
  );
  if (!loaded.ok) throw new Error(`fixture did not open: ${loaded.reason}`);
  const root = bodyStoryRoot(loaded.part);
  const paragraph = root ? storyParagraphs(root)[0] : undefined;
  if (!paragraph || paragraph.kind !== 'paragraph') throw new Error('paragraph missing');
  return { paragraph, rawText: paragraphTextOf(loaded.part, paragraph.id) ?? '' };
}

describe('projected text offset mapping', () => {
  test('maps identity ranges and refuses invalid ranges', () => {
    const { paragraph, rawText } = paragraphOf(run('alpha'));
    const projected = projectParagraphText(paragraph, rawText, 'allMarkup');

    expect(projected.rawRange(1, 4)).toEqual({ start: 1, end: 4 });
    expect(projected.rawRange(0, 0)).toBeNull();
    expect(projected.rawRange(-1, 1)).toBeNull();
    expect(projected.rawRange(0, 6)).toBeNull();
  });

  test('expands one field atom and snaps visible ranges to its model edges', () => {
    const { paragraph, rawText } = paragraphOf(run('A') + field(' DATE ', run('four')) + run('Z'));
    const projected = projectParagraphText(paragraph, rawText, 'allMarkup');

    expect(rawText).toBe('A\uFFFCZ');
    expect(projected.text).toBe('AfourZ');
    expect(projected.projectedOffset(1)).toBe(1);
    expect(projected.projectedOffset(2)).toBe(5);
    expect(projected.rawRange(2, 4)).toEqual({ start: 1, end: 2 });
    expect(projected.rawRange(0, 3)).toEqual({ start: 0, end: 2 });
    expect(projected.sliceRaw(1, 2)).toBe('four');
    expect(projected.sliceRaw(0, 1)).toBe('A');
    expect(projected.sliceRaw(2, 3)).toBe('Z');
  });

  test('projects an empty field result as no visible text', () => {
    const { paragraph, rawText } = paragraphOf(run('A') + field(' DATE ', '') + run('Z'));
    const projected = projectParagraphText(paragraph, rawText, 'allMarkup');

    expect(rawText).toBe('A\uFFFCZ');
    expect(projected.text).toBe('AZ');
    expect(projected.projectedOffset(1)).toBe(1);
    expect(projected.projectedOffset(2)).toBe(1);
    expect(projected.sliceRaw(1, 2)).toBe('');
  });

  test('uses only nested field result text inside an outer result', () => {
    const nested = field(' REF outer ', run('see ') + field(' REF inner ', run('Section 4')));
    const { paragraph, rawText } = paragraphOf(nested);
    const projected = projectParagraphText(paragraph, rawText, 'allMarkup');

    expect(rawText).toBe('\uFFFC');
    expect(projected.text).toBe('see Section 4');
    expect(projected.rawRange(4, 11)).toEqual({ start: 0, end: 1 });
  });

  test('keeps store order for a nested simple field without endorsing visible order', () => {
    const simple = `<w:fldSimple w:instr=" PAGE ">${run('7')}</w:fldSimple>`;
    const outer = field(' IF ', run('x') + simple + run('y'));
    const { paragraph, rawText } = paragraphOf(run('A') + outer + run('Z'));
    const projected = projectParagraphText(paragraph, rawText, 'allMarkup');

    expect(rawText).toBe('A\uFFFC\uFFFCZ');
    expect(projected.text).toBe('Axy7Z');
    expect(projected.rawRange(3, 4)).toEqual({ start: 2, end: 3 });
  });

  test('folds a complex field nested inside a simple field exactly once', () => {
    const nested = field(' PAGE ', run('7'));
    const simple = `<w:fldSimple w:instr=" IF ">${run('x')}${nested}${run('y')}</w:fldSimple>`;
    const { paragraph, rawText } = paragraphOf(run('A') + simple + run('Z'));
    const projected = projectParagraphText(paragraph, rawText, 'allMarkup');

    expect(rawText).toBe('A\uFFFCZ');
    expect(projected.text).toBe('Ax7yZ');
    expect(projected.rawRange(2, 3)).toEqual({ start: 1, end: 2 });
  });

  test('keeps cached text from a simple field nested past the evaluation cap', () => {
    let nested = run('deep');
    for (let depth = 0; depth < MAX_FIELD_NESTING + 2; depth += 1) {
      nested = `<w:fldSimple w:instr=" IF ">${nested}</w:fldSimple>`;
    }
    const { paragraph, rawText } = paragraphOf(nested);

    expect(rawText).toBe('\uFFFC');
    expect(projectParagraphText(paragraph, rawText, 'allMarkup').text).toBe('deep');
  });

  test('treats an unclosed nested begin in a simple-field cache as inert', () => {
    const simple = `<w:fldSimple w:instr=" IF ">${run('A')}${begin}${run('B')}</w:fldSimple>`;
    const { paragraph, rawText } = paragraphOf(simple);

    expect(rawText).toBe('\uFFFC');
    expect(projectParagraphText(paragraph, rawText, 'allMarkup').text).toBe('AB');
  });

  test('treats an unclosed nested begin in a complex-field result scan as inert', () => {
    const malformed =
      begin +
      `<w:r><w:instrText xml:space="preserve"> IF </w:instrText></w:r>` +
      separate +
      run('A') +
      begin +
      run('B') +
      end;
    const { paragraph } = paragraphOf(malformed);
    const entries: FieldRunChildRef[] = [];
    collectFieldRunChildren(paragraph, entries);
    const outerBegin = entries[0]!;
    const syntheticOuterSpan: AtomicFieldSpan = {
      kind: 'complex',
      node: outerBegin.node,
      runId: outerBegin.runId,
      removeNodeIds: entries.map((entry) => entry.node.id),
      formatRunIds: [],
    };

    expect(fieldResultTextsOf(paragraph, [syntheticOuterSpan]).get(outerBegin.node.id)).toBe('AB');
  });

  test('projects a simple field result through one atom', () => {
    const simple = `<w:fldSimple w:instr=" DATE ">${run('1 January 2030')}</w:fldSimple>`;
    const { paragraph, rawText } = paragraphOf(simple);
    const projected = projectParagraphText(paragraph, rawText, 'allMarkup');

    expect(rawText).toBe('\uFFFC');
    expect(projected.text).toBe('1 January 2030');
    expect(projected.rawRange(0, 14)).toEqual({ start: 0, end: 1 });
  });

  test('projects a field nested in an inline content control', () => {
    const controlled = `<w:sdt><w:sdtContent>${field(' DATE ', run('visible'))}</w:sdtContent></w:sdt>`;
    const { paragraph, rawText } = paragraphOf(run('A') + controlled + run('Z'));
    const projected = projectParagraphText(paragraph, rawText, 'allMarkup');

    expect(rawText).toBe('A\uFFFCZ');
    expect(projected.text).toBe('AvisibleZ');
    expect(projected.rawRange(2, 5)).toEqual({ start: 1, end: 2 });
  });

  test('uses one field walk through deep hyperlink, revision, and control wrappers', () => {
    const wrapped =
      '<w:hyperlink w:anchor="a"><w:ins w:id="1" w:author="Ada">' +
      '<w:del w:id="2" w:author="Ada"><w:moveFrom w:id="3" w:author="Ada">' +
      '<w:moveTo w:id="4" w:author="Ada"><w:sdt><w:sdtContent>' +
      field(' DATE ', run('visible')) +
      '</w:sdtContent></w:sdt></w:moveTo></w:moveFrom></w:del></w:ins></w:hyperlink>';
    const { paragraph, rawText } = paragraphOf(wrapped);

    expect(rawText).toBe('\uFFFC');
    expect(projectParagraphText(paragraph, rawText, 'allMarkup').text).toBe('visible');
  });

  test('hides a pending inserted field from the original view', () => {
    const inserted = `<w:ins w:id="1" w:author="Ada">${field(' DATE ', run('future'))}</w:ins>`;
    const { paragraph, rawText } = paragraphOf(run('A') + inserted + run('Z'));

    expect(projectParagraphText(paragraph, rawText, 'allMarkup').text).toBe('AfutureZ');
    expect(projectParagraphText(paragraph, rawText, 'original').text).toBe('AZ');
  });

  test('hides an insertion inside a field result from the original view', () => {
    const result = run('old ') + '<w:ins w:id="1" w:author="Ada">' + run('NEW') + '</w:ins>';
    const { paragraph, rawText } = paragraphOf(run('A') + field(' DATE ', result) + run('Z'));

    expect(projectParagraphText(paragraph, rawText, 'allMarkup').text).toBe('Aold NEWZ');
    expect(projectParagraphText(paragraph, rawText, 'original').text).toBe('Aold Z');
  });

  test('hides a move destination inside a field result from the original view', () => {
    const result =
      run('old ') + '<w:moveTo w:id="1" w:author="Ada">' + run('MOVED') + '</w:moveTo>';
    const { paragraph, rawText } = paragraphOf(run('A') + field(' DATE ', result) + run('Z'));

    expect(projectParagraphText(paragraph, rawText, 'allMarkup').text).toBe('Aold MOVEDZ');
    expect(projectParagraphText(paragraph, rawText, 'original').text).toBe('Aold Z');
  });

  test('walks thousands of fields and hidden insertions with a forward-only cursor', () => {
    const count = 2_000;
    const insertion = '<w:ins w:id="1" w:author="Ada">' + run('I') + '</w:ins>';
    const { paragraph, rawText } = largeParagraphOf(
      (field(' PAGE ', run('F')) + insertion).repeat(count)
    );
    const base = visibleParagraphPieces(paragraph, rawText, 'original');
    const spans: RawSpan[] = Array.from({ length: count }, (_, index) => ({
      start: index * 2 + 1,
      end: index * 2 + 2,
    }));
    const visited: number[] = [];
    const traced = new Proxy(spans, {
      get(target, property, receiver) {
        if (typeof property === 'string') {
          const index = Number(property);
          if (Number.isInteger(index) && index >= 0) visited.push(index);
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const merged = hideInsertionSpansFromPieces(base, traced);

    expect(projectParagraphText(paragraph, rawText, 'original').text).toBe('F'.repeat(count));
    expect(projectionFromPieces(merged).text).toBe('F'.repeat(count));
    expect(visited.every((value, index) => index === 0 || value >= visited[index - 1]!)).toBe(true);
  });

  test('does not spend the field result budget on preceding inline nodes', () => {
    const prefix = Array.from(
      { length: 4_200 },
      (_, index) => `<w:bookmarkStart w:id="${index}" w:name="b${index}"/>`
    ).join('');
    const { paragraph, rawText } = paragraphOf(prefix + field(' DATE ', run('visible')));
    const projected = projectParagraphText(paragraph, rawText, 'allMarkup');

    expect(projected.text).toBe('visible');
  });

  test('falls back to the field atom when its own result exceeds the node budget', () => {
    const result = `<w:r>${Array.from({ length: 4_200 }, () => '<w:tab/>').join('')}</w:r>`;
    const { paragraph, rawText } = paragraphOf(field(' DATE ', result));

    expect(rawText).toBe('\uFFFC');
    expect(projectParagraphText(paragraph, rawText, 'allMarkup').text).toBe('\uFFFC');
  });

  test('falls back to the field atom when one result text node exceeds the character budget', () => {
    const oversized = lowCompressionText(MAX_FIELD_RESULT_CHARS + 1);
    const { paragraph, rawText } = paragraphOf(field(' DATE ', run(oversized)));

    expect(rawText).toBe('\uFFFC');
    expect(projectParagraphText(paragraph, rawText, 'allMarkup').text).toBe('\uFFFC');
  });

  test('projects and searches a result just under the character budget in full', () => {
    const suffix = 'Needle';
    const result = lowCompressionText(MAX_FIELD_RESULT_CHARS - suffix.length - 1) + suffix;
    const { paragraph, rawText } = paragraphOf(field(' DATE ', run(result)));
    const projected = projectParagraphText(paragraph, rawText, 'allMarkup');

    expect(projected.text).toBe(result);
    expect(projected.findOccurrences('needle', 1)).toEqual({
      matches: [
        {
          start: result.length - suffix.length,
          length: suffix.length,
          rawStart: 0,
          rawEnd: 1,
        },
      ],
      truncated: false,
    });
  });

  test('applies the character budget to a simple field result', () => {
    const oversized = lowCompressionText(MAX_FIELD_RESULT_CHARS + 1);
    const simple = `<w:fldSimple w:instr=" DATE ">${run(oversized)}</w:fldSimple>`;
    const { paragraph, rawText } = paragraphOf(simple);

    expect(rawText).toBe('\uFFFC');
    expect(projectParagraphText(paragraph, rawText, 'allMarkup').text).toBe('\uFFFC');
  });

  test('does not mark duplicate occurrences in one expansion as truncated', () => {
    const { paragraph, rawText } = paragraphOf(field(' PAGE ', run('x x')));
    const projected = projectParagraphText(paragraph, rawText, 'allMarkup');

    expect(projected.findOccurrences('x', 1)).toEqual({
      matches: [{ start: 0, length: 1, rawStart: 0, rawEnd: 1 }],
      truncated: false,
    });
  });

  test('keeps a match that starts in a field expansion and ends after it', () => {
    const { paragraph, rawText } = paragraphOf(field(' PAGE ', run('xxx')) + run('xx'));
    const projected = projectParagraphText(paragraph, rawText, 'allMarkup');

    expect(projected.findOccurrences('xx', 10)).toEqual({
      matches: [
        { start: 0, length: 2, rawStart: 0, rawEnd: 1 },
        { start: 2, length: 2, rawStart: 0, rawEnd: 2 },
      ],
      truncated: false,
    });
  });

  test('finds a boundary match after dropping an internal field duplicate', () => {
    const { paragraph, rawText } = paragraphOf(field(' PAGE ', run('xxxxx')) + run('x'));
    const projected = projectParagraphText(paragraph, rawText, 'allMarkup');

    expect(projected.findOccurrences('xx', 10)).toEqual({
      matches: [
        { start: 0, length: 2, rawStart: 0, rawEnd: 1 },
        { start: 4, length: 2, rawStart: 0, rawEnd: 2 },
      ],
      truncated: false,
    });
  });

  test('keeps the ordinary match after an equal field-result match', () => {
    const { paragraph, rawText } = paragraphOf(field(' PAGE ', run('ab')) + run('ab'));
    const projected = projectParagraphText(paragraph, rawText, 'allMarkup');

    expect(projected.findOccurrences('ab', 10)).toEqual({
      matches: [
        { start: 0, length: 2, rawStart: 0, rawEnd: 1 },
        { start: 2, length: 2, rawStart: 1, rawEnd: 3 },
      ],
      truncated: false,
    });
  });

  test('skips simple fields nested in a field instruction in every review view', () => {
    const nested = (result: string) =>
      `<w:fldSimple w:instr=" STYLEREF Heading ">${run(result)}</w:fldSimple>`;
    const inserted = `<w:ins w:id="1" w:author="Reviewer">${nested('S2')}</w:ins>`;
    const conditional =
      begin +
      '<w:r><w:instrText xml:space="preserve"> IF </w:instrText></w:r>' +
      nested('S1') +
      inserted +
      separate +
      run('R') +
      end;
    const { paragraph, rawText } = paragraphOf(run('A') + conditional + run('Z'));
    for (const projection of ['allMarkup', 'original'] as const) {
      const projected = projectParagraphText(paragraph, rawText, projection);
      expect(projected.text).toBe('ARZ');
      expect(projected.findOccurrences('S1', 10).matches).toEqual([]);
    }
    // The model view keeps one unit for each field.
    expect(projectParagraphText(paragraph, rawText, 'model').text).toHaveLength(5);
  });

  test('caps a dense long-paragraph search and reports remaining matches', () => {
    const { paragraph, rawText } = paragraphOf(run('A'.repeat(5_000)));
    const projected = projectParagraphText(paragraph, rawText, 'allMarkup');
    const found = projected.findOccurrences('a', SEARCH_MATCH_LIMIT);

    expect(found.matches).toHaveLength(SEARCH_MATCH_LIMIT);
    expect(found.matches[0]).toEqual({ start: 0, length: 1, rawStart: 0, rawEnd: 1 });
    expect(found.matches.at(-1)).toEqual({
      start: SEARCH_MATCH_LIMIT - 1,
      length: 1,
      rawStart: SEARCH_MATCH_LIMIT - 1,
      rawEnd: SEARCH_MATCH_LIMIT,
    });
    expect(found.truncated).toBe(true);
  });
});
