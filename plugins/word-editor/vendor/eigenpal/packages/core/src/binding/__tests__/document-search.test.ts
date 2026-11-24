// Document text search over the tree session (`collectTextMatches`, facade `findMatches`).
//
// What these pin down: matches are found in body-story paragraphs in document order and
// addressed in `paragraphTextOf`'s offset vocabulary (so `selectMatch` can hand one
// straight to `setSelection`); matching is non-overlapping, case-insensitive by default,
// and whole-word when asked; run addressing follows the same walk as the offsets,
// including runs inside a hyperlink; file-derived strings are bounded at the derivation
// boundary; and the pathological inputs (empty query, over-long query, one-character query
// against a long document) are refused or capped rather than allowed to allocate.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { bodyStoryRoot, storyParagraphs } from '../../store/package/story-blocks.ts';
import { openTreeSession, type TreeDocxSession } from '../tree-session.ts';
import type { OoxmlNode, OoxmlParagraphNode } from '../../store/package/ooxml-tree.ts';
import {
  collectTextMatches,
  searchableTextEntry,
  SEARCH_MATCH_LIMIT,
  SEARCH_QUERY_MAX,
} from '../document-search.ts';
import { rememberedStoryParagraphRoots } from '../document-search-frames.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_DOC =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT_NS}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rId1" Type="${OFFICE_DOC}" Target="word/document.xml"/>` +
        '</Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R_NS}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

function open(bytes: Uint8Array): TreeDocxSession {
  const result = openTreeSession(bytes);
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  return result.session;
}

/** The body story's paragraph nodes of the session's current part, in order. */
function bodyParagraphs(session: TreeDocxSession): OoxmlParagraphNode[] {
  const root = bodyStoryRoot(session.part());
  if (!root) throw new Error('body missing');
  return storyParagraphs(root).filter(
    (node: OoxmlNode): node is OoxmlParagraphNode => node.kind === 'paragraph'
  );
}

const para = (...runs: string[]) => `<w:p>${runs.join('')}</w:p>`;
const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const cell = (...blocks: string[]) => `<w:tc>${blocks.join('')}</w:tc>`;
const row = (...cells: string[]) => `<w:tr>${cells.join('')}</w:tr>`;
const table = (...rows: string[]) => `<w:tbl>${rows.join('')}</w:tbl>`;

describe('session search cache', () => {
  test('keeps single and batch result shapes separate in either call order', () => {
    for (const batchFirst of [false, true]) {
      const session = open(docx(para(run('Supplier signs'))));
      if (batchFirst) session.findText(['Supplier']);
      else session.findText('Supplier');

      const single = session.findText('Supplier');
      const batch = session.findText(['Supplier']);
      expect(single.matches).toHaveLength(1);
      expect(Array.isArray(batch)).toBe(true);
      expect(batch).toHaveLength(1);
      expect(batch[0]).toEqual(single);
      expect(session.findText('Supplier')).toBe(single);
      expect(session.findText(['Supplier'])).toBe(batch);
    }
  });

  test('keeps query array boundaries separate from query characters', () => {
    const session = open(docx(para(run('Supplier signs'))));
    const separate = session.findText(['Supplier', 'signs']);
    const joined = session.findText(['Supplier\u0001signs']);
    expect(separate).toHaveLength(2);
    expect(separate.map((result) => result.matches.length)).toEqual([1, 1]);
    expect(joined).toHaveLength(1);
    expect(joined[0]!.matches).toEqual([]);
  });

  test('keeps empty batches separate from batches with an empty query', () => {
    const session = open(docx(para(run('Supplier signs'))));
    expect(session.findText([])).toEqual([]);
    expect(session.findText([''])).toEqual([{ matches: [], truncated: false }]);
  });
});

const complexField = (instruction: string, result: string) =>
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  `<w:r><w:instrText xml:space="preserve">${instruction}</w:instrText></w:r>` +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  run(result) +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';

const complexFieldMarkup = (instruction: string, result: string) =>
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  `<w:r><w:instrText xml:space="preserve">${instruction}</w:instrText></w:r>` +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  result +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';

function search(body: string, query: string, options?: Parameters<typeof collectTextMatches>[2]) {
  return collectTextMatches(open(docx(body)).part(), query, options);
}

describe('collectTextMatches', () => {
  test('finds occurrences in document order, addressed by paragraph offset', () => {
    const { matches, truncated } = search(
      para(run('Exhibit A is attached.')) + para(run('See Exhibit B.')),
      'Exhibit'
    );

    expect(truncated).toBe(false);
    expect(matches.map((match) => [match.paragraphIndex, match.start, match.length])).toEqual([
      [0, 0, 7],
      [1, 4, 7],
    ]);
    expect(matches.map((match) => match.text)).toEqual(['Exhibit', 'Exhibit']);
    // Distinct paragraphs, so distinct block ids — the address `scrollToBlock` accepts.
    expect(matches[0]!.blockId).not.toBe(matches[1]!.blockId);
  });

  test('is case-insensitive by default and case-sensitive on request', () => {
    const body = para(run('Exhibit and exhibit and EXHIBIT.'));

    expect(search(body, 'exhibit').matches).toHaveLength(3);
    expect(search(body, 'exhibit', { matchCase: true }).matches.map((m) => m.start)).toEqual([12]);
  });

  test('counts non-overlapping occurrences, the way a find dialog does', () => {
    // `aa` in `aaaa` is two matches, not three: the scan resumes past each occurrence.
    expect(search(para(run('aaaa')), 'aa').matches.map((m) => m.start)).toEqual([0, 2]);
  });

  test('wholeWord rejects a match glued to a letter, digit or underscore on either side', () => {
    const body = para(run('cat cats concat cat_ 9cat cat.'));
    const starts = search(body, 'cat', { wholeWord: true }).matches.map((m) => m.start);

    // 'cat' at 0, and 'cat' at 26 (before the period). Everything else is glued.
    expect(starts).toEqual([0, 26]);
  });

  test('carries bounded surrounding context on both sides of the match', () => {
    const { matches } = search(
      para(run('the Walter SaaS Services as described in this Exhibit A ("Support Services").')),
      'Exhibit'
    );

    expect(matches).toHaveLength(1);
    expect(matches[0]!.contextBefore.endsWith('described in this ')).toBe(true);
    expect(matches[0]!.contextAfter.startsWith(' A ("Support')).toBe(true);
  });

  test('addresses the run a match starts in, counting runs inside a hyperlink', () => {
    const body = para(
      run('Go to '),
      `<w:hyperlink r:id="rId9">${run('Example')}${run('.com')}</w:hyperlink>`,
      run(' now.')
    );
    // Paragraph text is "Go to Example.com now." — 'com' starts at 14, inside the SECOND
    // run of the link, which is run index 2 overall (run 0 is "Go to ").
    const { matches } = search(body, 'com');

    expect(matches).toHaveLength(1);
    expect(matches[0]!.start).toBe(14);
    expect(matches[0]!.runIndex).toBe(2);
    expect(matches[0]!.runOffset).toBe(1);
  });

  test('finds and addresses runs inside each inline run wrapper', () => {
    const body = para(
      run('start '),
      `<w:smartTag>${run('smart')}</w:smartTag>`,
      `<w:customXml>${run('custom')}</w:customXml>`,
      `<w:dir>${run('direction')}</w:dir>`,
      `<w:bdo>${run('override')}</w:bdo>`
    );
    const expected = [
      ['smart', 1],
      ['custom', 2],
      ['direction', 3],
      ['override', 4],
    ] as const;

    for (const [query, runIndex] of expected) {
      const matches = search(body, query).matches;
      expect(matches).toHaveLength(1);
      expect(matches[0]!.runIndex).toBe(runIndex);
      expect(matches[0]!.runOffset).toBe(0);
    }
  });

  test('counts a tab as one character, so offsets match the tree ops', () => {
    const body = para(`<w:r><w:tab/><w:t>Exhibit</w:t></w:r>`);
    const { matches } = search(body, 'Exhibit');

    expect(matches[0]!.start).toBe(1);
    expect(matches[0]!.runOffset).toBe(1);
  });

  test('finds a cell in a 2x3 table by its paragraph block id', () => {
    const body = table(
      row(cell(para(run('one'))), cell(para(run('two'))), cell(para(run('three')))),
      row(cell(para(run('four'))), cell(para(run('five'))), cell(para(run('six'))))
    );
    const session = open(docx(body));
    const root = bodyStoryRoot(session.part());
    if (!root) throw new Error('body missing');
    const cellParagraph = storyParagraphs(root)[3]!;
    const { matches } = collectTextMatches(session.part(), 'four');

    expect(matches).toHaveLength(1);
    expect(matches[0]!.blockId).toBe(cellParagraph.id);
    expect(matches[0]!.paragraphIndex).toBe(3);
  });

  test('finds text in a nested table', () => {
    const nested = table(row(cell(para(run('outer')), table(row(cell(para(run('deep'))))))));
    expect(search(nested, 'deep').matches).toHaveLength(1);
  });

  test('finds a paragraph in a block content control', () => {
    const body = `<w:sdt><w:sdtPr/><w:sdtContent>${para(run('controlled'))}</w:sdtContent></w:sdt>`;
    expect(search(body, 'controlled').matches).toHaveLength(1);
  });

  test('keeps body, cell, and later body paragraphs in document order', () => {
    const body =
      para(run('needle before')) +
      table(row(cell(para(run('needle cell'))))) +
      para(run('needle after'));
    const { matches } = search(body, 'needle');

    expect(matches.map((match) => match.paragraphIndex)).toEqual([0, 1, 2]);
  });

  test('searches a visible field result through its one model atom', () => {
    const body = para(
      run('Renewal date: '),
      complexField(' DATE \\@ "d MMMM yyyy" ', '1 January 2030'),
      run(' is synthetic.')
    );
    const result = search(body, '1 January 2030', { matchCase: true });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({
      start: 'Renewal date: '.length,
      length: 1,
      text: '1 January 2030',
    });
    expect(search(body, '\uFFFC').matches).toEqual([]);
  });

  test('reports repeated text inside one field result as one atom match', () => {
    const result = search(para(run('A'), complexField(' PAGE ', 'x x'), run('B')), 'x');

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({ start: 1, length: 1, text: 'x' });
    expect(result.truncated).toBe(false);
  });

  test('addresses a simple field result run and the following plain run', () => {
    const simple = `<w:fldSimple w:instr=" PAGE ">${run('7')}</w:fldSimple>`;
    const body = para(run('A'), simple, run('Z'));

    expect(search(body, '7').matches[0]).toMatchObject({
      start: 1,
      runIndex: 1,
      runOffset: 0,
    });
    expect(search(body, 'Z').matches[0]).toMatchObject({
      start: 2,
      runIndex: 2,
      runOffset: 0,
    });
  });

  test('addresses visible offsets inside each simple-field result run', () => {
    const simple = `<w:fldSimple w:instr=" PAGE ">${run('abc')}${run('def')}</w:fldSimple>`;
    const body = para(run('A'), simple, run('Z'));

    expect(search(body, 'def').matches[0]).toMatchObject({
      runIndex: 2,
      runOffset: 0,
    });
    expect(search(body, 'cd').matches[0]).toMatchObject({
      runIndex: 1,
      runOffset: 2,
    });
    expect(search(body, 'Aab').matches[0]).toMatchObject({
      runIndex: 0,
      runOffset: 0,
    });
  });

  test('addresses revision-wrapped fields and every later run', () => {
    const simple = `<w:fldSimple w:instr=" PAGE ">${run('field')}</w:fldSimple>`;
    const body = para(
      run('before'),
      `<w:ins w:id="1" w:author="Ada">${simple}</w:ins>`,
      run('after')
    );

    expect(search(body, 'field').matches[0]).toMatchObject({ runIndex: 1, runOffset: 0 });
    expect(search(body, 'after').matches[0]).toMatchObject({ runIndex: 2, runOffset: 0 });
  });

  test('addresses a run inside a tracked deletion', () => {
    const body = para(
      run('before'),
      `<w:del w:id="1" w:author="Ada"><w:r><w:delText>gone</w:delText></w:r></w:del>`,
      run('after')
    );

    expect(search(body, 'gone').matches[0]).toMatchObject({ runIndex: 1, runOffset: 0 });
    expect(search(body, 'after').matches[0]).toMatchObject({ runIndex: 2, runOffset: 0 });
  });

  test('orders hyperlink, simple-field, and plain result runs together', () => {
    const simple = `<w:fldSimple w:instr=" PAGE ">${run('field')}</w:fldSimple>`;
    const body = para(
      run('before'),
      `<w:hyperlink r:id="rId9">${run('link-one')}${run('link-two')}</w:hyperlink>`,
      simple,
      run('after')
    );

    expect(
      ['before', 'link-one', 'link-two', 'field', 'after'].map((query) => {
        const match = search(body, query).matches[0];
        return [match?.runIndex, match?.runOffset];
      })
    ).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
    ]);
  });

  test('keeps store segment order for a nested simple field without endorsing visible order', () => {
    const simple = `<w:fldSimple w:instr=" PAGE ">${run('7')}</w:fldSimple>`;
    const outer = complexFieldMarkup(' IF ', run('x') + simple + run('y'));
    const result = search(para(run('A'), outer, run('Z')), '7');

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({ start: 2, length: 1, text: '7' });
  });

  test('keeps the complex-field atom addressed at its begin run', () => {
    const body = para(run('A'), complexField(' PAGE ', '12'), run('B'));
    const after = search(body, 'B').matches[0];
    const fieldResult = search(body, '12').matches[0];

    expect(after).toMatchObject({ start: 2, runIndex: 6, runOffset: 0 });
    expect(fieldResult).toMatchObject({ start: 1, runIndex: 1, runOffset: 0 });
  });

  test('flattens control characters out of every string it returns', () => {
    // A hard break is one character in the offset vocabulary and must not reach a panel
    // row as a control character.
    const body = para(`<w:r><w:t>Exhibit</w:t><w:br/><w:t>A</w:t></w:r>`);
    const { matches } = search(body, 'Exhibit');

    expect(matches[0]!.contextAfter).not.toMatch(/[\u0000-\u001F\u007F-\u009F]/);
  });

  test('refuses an empty or over-long query rather than matching everything', () => {
    const body = para(run('Exhibit A'));

    expect(search(body, '').matches).toEqual([]);
    expect(search(body, 'x'.repeat(SEARCH_QUERY_MAX + 1)).matches).toEqual([]);
    expect(search(body, 'x'.repeat(SEARCH_QUERY_MAX)).matches).toEqual([]);
  });

  test('caps the result set and reports that it stopped early', () => {
    // One paragraph of 3000 'a' characters: uncapped this would allocate a match each.
    const { matches, truncated } = search(para(run('a'.repeat(SEARCH_MATCH_LIMIT + 1000))), 'a');

    expect(matches).toHaveLength(SEARCH_MATCH_LIMIT);
    expect(truncated).toBe(true);
  });

  test('honours a caller limit below the cap but never above it', () => {
    const body = para(run('a'.repeat(50)));

    expect(search(body, 'a', { limit: 10 }).matches).toHaveLength(10);
    expect(search(body, 'a', { limit: 10 }).truncated).toBe(true);
    expect(search(body, 'a', { limit: SEARCH_MATCH_LIMIT * 10 }).matches).toHaveLength(50);
  });

  test('treats a regex-shaped query as literal text', () => {
    // A query is host input; if it were compiled as a pattern this would match everything
    // (and `(a+)+$` against a long run would be the backtracking hazard).
    const body = para(run('a literal .* stays literal'));

    expect(search(body, '.*').matches.map((m) => m.start)).toEqual([10]);
    expect(search(para(run('a'.repeat(64))), '(a+)+$').matches).toEqual([]);
  });

  test('answers from the text as it stands after an edit, not as it was searched before', () => {
    const session = open(docx(para(run('Exhibit A')) + para(run('Exhibit B'))));
    const [firstId, secondId] = session.paragraphIds();
    expect(session.findText('Exhibit A!', { matchCase: true }).matches).toEqual([]);
    expect(session.findText('Exhibit', { matchCase: true }).matches).toHaveLength(2);

    const edited = session.applyTreeOps([
      { op: 'insertText', paragraphId: firstId!, offset: 9, text: '!' },
    ]);
    expect(edited.committed).toBe(true);

    const after = session.findText('Exhibit A!', { matchCase: true }).matches;
    expect(after.map((match) => [match.blockId, match.start, match.length])).toEqual([
      [firstId, 0, 10],
    ]);
    // The paragraph the edit did not touch is still found where it was.
    expect(
      session.findText('Exhibit B', { matchCase: true }).matches.map((m) => m.blockId)
    ).toEqual([secondId]);
  });

  test('keeps the searchable text of the paragraphs an edit did not touch', () => {
    const session = open(
      docx(para(run('Exhibit A')) + para(run('Exhibit B')) + para(run('Exhibit C')))
    );
    const [firstId] = session.paragraphIds();
    expect(session.findText('Exhibit').matches).toHaveLength(3);
    const before = bodyParagraphs(session);
    const entries = before.map((paragraph) => searchableTextEntry(paragraph));
    expect(entries.every((entry) => entry !== undefined)).toBe(true);

    const edited = session.applyTreeOps([
      { op: 'insertText', paragraphId: firstId!, offset: 9, text: '!' },
    ]);
    expect(edited.committed).toBe(true);

    // The edit made a new node for the paragraph it changed and kept the other two.
    const after = bodyParagraphs(session);
    expect(after[0]).not.toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(after[2]).toBe(before[2]);
    // Before any search, the untouched paragraphs keep their entries; the edited one has none.
    expect(searchableTextEntry(after[0]!)).toBeUndefined();
    expect(searchableTextEntry(after[1]!)).toBe(entries[1]);
    expect(searchableTextEntry(after[2]!)).toBe(entries[2]);

    // The search after the edit builds the edited paragraph's text and reuses the rest.
    expect(session.findText('Exhibit').matches).toHaveLength(3);
    expect(searchableTextEntry(after[0]!)?.text).toBe('Exhibit A!');
    expect(searchableTextEntry(after[1]!)).toBe(entries[1]);
    expect(searchableTextEntry(after[2]!)).toBe(entries[2]);
  });

  test('builds one entry per edit across revisions, not one document per revision', () => {
    const count = 40;
    const revisions = 30;
    const session = open(
      docx(
        Array.from({ length: count }, (_, index) => para(run(`Clause ${index} applies`))).join('')
      )
    );
    const ids = session.paragraphIds();
    expect(session.findText('applies').matches).toHaveLength(count);
    const seen = new Set(
      bodyParagraphs(session).map((paragraph) => searchableTextEntry(paragraph))
    );
    expect(seen.size).toBe(count);

    for (let revision = 0; revision < revisions; revision += 1) {
      const edited = session.applyTreeOps([
        { op: 'insertText', paragraphId: ids[revision % count]!, offset: 0, text: 'x' },
      ]);
      expect(edited.committed).toBe(true);
      expect(session.findText('applies').matches).toHaveLength(count);
      for (const paragraph of bodyParagraphs(session)) seen.add(searchableTextEntry(paragraph));
    }
    // Every entry a search ever built: the first revision's, plus one per edited paragraph.
    expect(seen.has(undefined)).toBe(false);
    expect(seen.size).toBe(count + revisions);
  });

  test('keeps story paragraph lists for the last two searches, not for every revision', () => {
    const session = open(docx(para(run('alpha applies')) + para(run('beta applies'))));
    const id = session.paragraphIds()[0]!;
    session.findText('applies');
    const stories = rememberedStoryParagraphRoots();
    expect(stories).toBeGreaterThan(0);

    for (let revision = 0; revision < 30; revision += 1) {
      const edited = session.applyTreeOps([
        { op: 'insertText', paragraphId: id, offset: 0, text: 'x' },
      ]);
      expect(edited.committed).toBe(true);
      expect(session.findText('applies').matches).toHaveLength(2);
    }
    // Each edit makes a new body root; only this search's and the previous one's remain.
    expect(rememberedStoryParagraphRoots()).toBeLessThanOrEqual(2 * stories);
  });

  test('keeps offsets aligned when case folding would otherwise expand the text', () => {
    // U+0130 lowercases to TWO code units. Folding must not slide the offsets after it,
    // or the match is reported where the editor would select the wrong text.
    const body = para(run('İstanbul Exhibit'));
    const { matches } = search(body, 'exhibit');

    expect(matches).toHaveLength(1);
    expect(matches[0]!.start).toBe(9);
  });
});
