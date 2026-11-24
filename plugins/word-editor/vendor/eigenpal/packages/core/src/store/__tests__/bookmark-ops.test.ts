// insertBookmark / deleteBookmark, the authoring name rules, and how typing and deleting treat
// the bookmarks around them.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, validateOoxmlPart, type OoxmlPart } from '../package/ooxml-tree.ts';
import { serializeOoxmlPart } from '../package/ooxml-serialize.ts';
import { listBookmarks } from '../package/bookmark-list.ts';
import { bookmarkNameProblem, isHiddenBookmarkName } from '../package/bookmark-names.ts';
import { applyTreeOp, type TreeDocOp } from '../store/tree-ops.ts';
import { TreeDocumentStore } from '../store/tree-store.ts';
import { enclosedBookmarkDeletions } from '../store/tree-op-bookmarks.ts';
import { findNode, nodeIndexTestRecorder } from '../package/ooxml-edit.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const P = '/word/document.xml#0.0.0';
const P2 = '/word/document.xml#0.0.1';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function apply(part: OoxmlPart, op: TreeDocOp): OoxmlPart {
  const result = applyTreeOp(part, op);
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  expect(validateOoxmlPart(result.part).ok).toBe(true);
  return result.part;
}

/** The body as a compact token string: text in quotes, markers as [name / ]id. */
function shape(part: OoxmlPart): string {
  return serializeOoxmlPart(part)
    .replace(/^.*<w:body>/s, '')
    .replace(/<\/w:body>.*$/s, '')
    .replace(/ xml:space="preserve"/g, '')
    .replace(/<w:bookmarkStart w:id="(\d+)" w:name="([^"]+)"\/>/g, '[$2:$1')
    .replace(/<w:bookmarkEnd w:id="(\d+)"\/>/g, '$1]')
    .replace(/<w:r><w:t>([^<]*)<\/w:t><\/w:r>/g, '"$1"')
    .replace(/<\/?w:p>/g, '|');
}

const SAMPLE =
  '<w:p><w:r><w:t xml:space="preserve">AAA </w:t></w:r><w:bookmarkStart w:id="1" w:name="rng"/>' +
  '<w:r><w:t>BBB</w:t></w:r><w:bookmarkEnd w:id="1"/><w:r><w:t xml:space="preserve"> CCC </w:t></w:r>' +
  '<w:bookmarkStart w:id="2" w:name="pt"/><w:bookmarkEnd w:id="2"/><w:r><w:t>DDD</w:t></w:r></w:p>';

describe('bookmark names', () => {
  test('accept letters, digits and underscores after a letter or underscore', () => {
    for (const name of ['abc', 'A_1', 'x', '_hidden', 'Ünï', '日本', 'a'.repeat(40)]) {
      expect(bookmarkNameProblem(name)).toBeNull();
    }
  });

  test('refuse other names with a reason', () => {
    expect(bookmarkNameProblem('')).toBe('empty');
    expect(bookmarkNameProblem('a'.repeat(41))).toBe('tooLong');
    expect(bookmarkNameProblem('1abc')).toBe('invalidStart');
    for (const name of ['a b', 'a-b', 'a.b', 'ab$', 'a€']) {
      expect(bookmarkNameProblem(name)).toBe('invalidCharacter');
    }
  });

  test('hidden names start with an underscore', () => {
    expect(isHiddenBookmarkName('_Toc1')).toBe(true);
    expect(isHiddenBookmarkName('Toc1')).toBe(false);
  });
});

describe('insertBookmark', () => {
  test('wraps a range inside one run and keeps the text', () => {
    const part = apply(load('<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>'), {
      op: 'insertBookmark',
      name: 'Greeting',
      start: { paragraphId: P, offset: 6 },
      end: { paragraphId: P, offset: 11 },
    });
    expect(shape(part)).toBe('|"Hello "[Greeting:1"world"1]|');
    const [record] = listBookmarks(part);
    expect(record).toMatchObject({
      name: 'Greeting',
      hidden: false,
      start: { paragraphId: P, offset: 6 },
      end: { paragraphId: P, offset: 11 },
    });
  });

  test('writes a point bookmark as a start followed by its end', () => {
    const part = apply(load('<w:p><w:r><w:t>Hello</w:t></w:r></w:p>'), {
      op: 'insertBookmark',
      name: 'here',
      start: { paragraphId: P, offset: 2 },
      end: { paragraphId: P, offset: 2 },
    });
    expect(shape(part)).toBe('|"He"[here:11]"llo"|');
  });

  test('spans paragraphs', () => {
    const part = apply(
      load('<w:p><w:r><w:t>One</w:t></w:r></w:p><w:p><w:r><w:t>Two</w:t></w:r></w:p>'),
      {
        op: 'insertBookmark',
        name: 'both',
        start: { paragraphId: P, offset: 1 },
        end: { paragraphId: P2, offset: 2 },
      }
    );
    expect(shape(part)).toBe('|"O"[both:1"ne"||"Tw"1]"o"|');
    expect(listBookmarks(part)[0]?.end).toEqual({ paragraphId: P2, offset: 2 });
  });

  test('moves an existing bookmark with the same name in any case', () => {
    const part = apply(load(SAMPLE), {
      op: 'insertBookmark',
      name: 'RNG',
      start: { paragraphId: P, offset: 0 },
      end: { paragraphId: P, offset: 3 },
    });
    const names = listBookmarks(part).map((record) => [record.name, record.start.offset]);
    expect(names).toEqual([
      ['RNG', 0],
      ['pt', 12],
    ]);
  });

  test('mints an unused id', () => {
    const part = apply(load(SAMPLE), {
      op: 'insertBookmark',
      name: 'third',
      start: { paragraphId: P, offset: 0 },
      end: { paragraphId: P, offset: 0 },
    });
    const third = listBookmarks(part).find((record) => record.name === 'third');
    expect(third?.markerId).toBe('3');
  });

  test('refuses invalid names, reversed ranges and offsets past the text', () => {
    const part = load(SAMPLE);
    const refuse = (op: TreeDocOp) => {
      const result = applyTreeOp(part, op);
      return result.ok ? 'applied' : result.reason;
    };
    const at = (offset: number) => ({ paragraphId: P, offset });
    expect(refuse({ op: 'insertBookmark', name: '1x', start: at(0), end: at(1) })).toBe(
      'invalidArgs'
    );
    expect(refuse({ op: 'insertBookmark', name: 'x', start: at(3), end: at(1) })).toBe(
      'invalid-range'
    );
    expect(refuse({ op: 'insertBookmark', name: 'x', start: at(0), end: at(99) })).toBe(
      'offset-out-of-range'
    );
    expect(
      refuse({
        op: 'insertBookmark',
        name: 'x',
        start: { paragraphId: 'missing', offset: 0 },
        end: at(1),
      })
    ).toBe('unknown-paragraph');
  });

  test('refuses content-locked controls', () => {
    const part = load(
      '<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>' +
        '<w:p><w:r><w:t>Locked</w:t></w:r></w:p></w:sdtContent></w:sdt>'
    );
    const paragraphId = listParagraphIds(part)[0]!;
    const result = applyTreeOp(part, {
      op: 'insertBookmark',
      name: 'x',
      start: { paragraphId, offset: 0 },
      end: { paragraphId, offset: 1 },
    });
    expect(result.ok ? 'applied' : result.reason).toBe('locked');
  });
});

describe('deleteBookmark', () => {
  test('removes the marker pair and keeps the text', () => {
    const part = apply(load(SAMPLE), { op: 'deleteBookmark', name: 'RnG' });
    expect(shape(part)).toBe('|"AAA ""BBB"" CCC "[pt:22]"DDD"|');
  });

  test('refuses a name the part does not declare', () => {
    const result = applyTreeOp(load(SAMPLE), { op: 'deleteBookmark', name: 'missing' });
    expect(result.ok ? 'applied' : result.reason).toBe('invalidArgs');
  });

  test('removes markers between blocks', () => {
    const part = apply(
      load(
        '<w:bookmarkStart w:id="5" w:name="block"/><w:p><w:r><w:t>One</w:t></w:r></w:p>' +
          '<w:bookmarkEnd w:id="5"/>'
      ),
      { op: 'deleteBookmark', name: 'block' }
    );
    expect(shape(part)).toBe('|"One"|');
  });
});

describe('listBookmarks', () => {
  test('resolves block-level markers to the paragraphs they bound', () => {
    const part = load(
      '<w:p><w:r><w:t>Zero</w:t></w:r></w:p><w:bookmarkStart w:id="5" w:name="block"/>' +
        '<w:p><w:r><w:t>One</w:t></w:r></w:p><w:bookmarkEnd w:id="5"/>'
    );
    expect(listBookmarks(part)[0]).toMatchObject({
      name: 'block',
      start: { paragraphId: '/word/document.xml#0.0.2', offset: 0 },
      end: { paragraphId: '/word/document.xml#0.0.2', offset: 3 },
    });
  });

  test('lists hidden names, skips unpaired starts and keeps the first of a repeated name', () => {
    const part = load(
      '<w:p><w:bookmarkStart w:id="1" w:name="_Toc1"/><w:r><w:t>A</w:t></w:r>' +
        '<w:bookmarkEnd w:id="1"/><w:bookmarkStart w:id="2" w:name="open"/>' +
        '<w:bookmarkStart w:id="3" w:name="Dup"/><w:bookmarkEnd w:id="3"/>' +
        '<w:bookmarkStart w:id="4" w:name="dup"/><w:bookmarkEnd w:id="4"/></w:p>'
    );
    expect(listBookmarks(part).map((record) => [record.name, record.hidden])).toEqual([
      ['_Toc1', true],
      ['Dup', false],
    ]);
  });
});

describe('typing at bookmark markers', () => {
  const insert = (offset: number) =>
    shape(apply(load(SAMPLE), { op: 'insertText', paragraphId: P, offset, text: 'X' }));

  test('text typed at a start joins the bookmark', () => {
    expect(insert(4)).toBe('|"AAA "[rng:1"X""BBB"1]" CCC "[pt:22]"DDD"|');
  });

  test('text typed at an end stays outside', () => {
    expect(insert(7)).toBe('|"AAA "[rng:1"BBB"1]"X"" CCC "[pt:22]"DDD"|');
  });

  test('text typed at a point bookmark follows it', () => {
    expect(insert(12)).toBe('|"AAA "[rng:1"BBB"1]" CCC "[pt:22]"X""DDD"|');
  });

  test('text typed inside stays inside', () => {
    const part = apply(load(SAMPLE), { op: 'insertText', paragraphId: P, offset: 5, text: 'X' });
    expect(listBookmarks(part)[0]).toMatchObject({ start: { offset: 4 }, end: { offset: 8 } });
  });

  test('tracked typing follows the same rule', () => {
    const part = apply(load(SAMPLE), {
      op: 'insertText',
      paragraphId: P,
      offset: 4,
      text: 'X',
      revision: { author: 'Ada', date: '2026-01-01T00:00:00Z' },
    });
    expect(listBookmarks(part)[0]).toMatchObject({ start: { offset: 4 }, end: { offset: 8 } });
  });
});

describe('breaks and Enter at bookmark markers', () => {
  const at = (op: TreeDocOp) => shape(apply(load(SAMPLE), op));

  test('a line break or tab at a start joins the bookmark, at an end stays outside', () => {
    expect(at({ op: 'insertHardBreak', paragraphId: P, offset: 4 })).toContain(
      '[rng:1<w:r><w:br/>'
    );
    expect(at({ op: 'insertHardBreak', paragraphId: P, offset: 7 })).toContain('1]<w:r><w:br/>');
    expect(at({ op: 'insertTab', paragraphId: P, offset: 4 })).toContain('[rng:1<w:r><w:tab/>');
  });

  test('Enter keeps every bookmark marker at the split in the first paragraph', () => {
    const split = (offset: number) =>
      at({ op: 'splitParagraph', paragraphId: P, offset }).split('||');
    // At a start: the bookmark starts at the end of the first paragraph.
    expect(split(4)[0]).toMatch(/\[rng:1\|?$/);
    // At an end: the bookmark stays closed around its text.
    expect(split(7)[0]).toMatch(/1\]\|?$/);
    // At a point bookmark: the point stays before the new paragraph mark.
    expect(split(12)[0]).toMatch(/\[pt:22\]\|?$/);
  });
});

describe('deleting around bookmark markers', () => {
  const remove = (start: number, end: number) =>
    listBookmarks(apply(load(SAMPLE), { op: 'deleteText', paragraphId: P, start, end })).map(
      (record) => `${record.name}@${record.start.offset}-${record.end.offset}`
    );

  test('a deletion that covers the whole range removes the bookmark', () => {
    expect(remove(4, 7)).toEqual(['pt@9-9']);
    expect(remove(3, 8)).toEqual(['pt@7-7']);
  });

  test('a partial deletion keeps the remaining text bookmarked', () => {
    expect(remove(2, 5)).toEqual(['rng@2-4', 'pt@9-9']);
    expect(remove(6, 9)).toEqual(['rng@4-6', 'pt@9-9']);
  });

  test('a point bookmark goes only when strictly inside the deletion', () => {
    expect(remove(11, 13)).toEqual(['rng@4-7']);
    expect(remove(12, 14)).toEqual(['rng@4-7', 'pt@12-12']);
    expect(remove(10, 12)).toEqual(['rng@4-7', 'pt@10-10']);
  });

  test('a tracked deletion keeps every bookmark', () => {
    const part = apply(load(SAMPLE), {
      op: 'deleteText',
      paragraphId: P,
      start: 3,
      end: 8,
      revision: { author: 'Ada', date: '2026-01-01T00:00:00Z' },
    });
    expect(listBookmarks(part).map((record) => record.name)).toEqual(['rng', 'pt']);
  });
});

describe('undo and redo', () => {
  test('restore a deleted bookmark and remove it again', () => {
    const store = new TreeDocumentStore(load(SAMPLE));
    const outcome = store.transact((tx) => tx.apply({ op: 'deleteBookmark', name: 'rng' }));
    expect(outcome.ok).toBe(true);
    expect(listBookmarks(store.part).map((record) => record.name)).toEqual(['pt']);
    store.undo();
    expect(listBookmarks(store.part).map((record) => record.name)).toEqual(['rng', 'pt']);
    store.redo();
    expect(listBookmarks(store.part).map((record) => record.name)).toEqual(['pt']);
  });
});

function listParagraphIds(part: OoxmlPart): string[] {
  const ids: string[] = [];
  const walk = (node: OoxmlPart['root'] | OoxmlPart['root']['children'][number]): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'paragraph') ids.push(node.id);
    for (const child of node.children) walk(child);
  };
  walk(part.root);
  return ids;
}

for (const target of [0, 1]) {
  test(`enclosed bookmark deletion keeps the other duplicate pair when deleting pair ${target}`, () => {
    const part = load(
      [0, 1]
        .map(
          (id) =>
            `<w:p><w:bookmarkStart w:id="${id}" w:name="Same"/><w:r><w:t>Text</w:t></w:r><w:bookmarkEnd w:id="${id}"/></w:p>`
        )
        .join('')
    );
    const paragraphs = [P, P2];
    const drops = enclosedBookmarkDeletions(
      part,
      { paragraphId: paragraphs[target]!, offset: 0 },
      { paragraphId: paragraphs[target]!, offset: 4 },
      paragraphs
    );
    expect(drops).toHaveLength(1);
    const result = apply(part, drops[0]!);
    expect(listBookmarks(result)).toHaveLength(1);
    expect(listBookmarks(result)[0]!.start.paragraphId).toBe(paragraphs[1 - target]);
    expect(listBookmarks(result)[0]!.copies).toBe(1);
  });
}

test('nested duplicate names resolve to the first start, not the first end', () => {
  const part = load(
    '<w:p><w:bookmarkStart w:id="1" w:name="Same"/>' +
      '<w:r><w:t>A</w:t></w:r><w:bookmarkStart w:id="2" w:name="SAME"/>' +
      '<w:r><w:t>B</w:t></w:r><w:bookmarkEnd w:id="2"/>' +
      '<w:r><w:t>C</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>'
  );
  expect(listBookmarks(part)[0]).toMatchObject({
    markerId: '1',
    copies: 2,
    start: { offset: 0 },
    end: { offset: 3 },
  });
  const drops = enclosedBookmarkDeletions(
    part,
    { paragraphId: P, offset: 1 },
    { paragraphId: P, offset: 2 },
    [P]
  );
  expect(drops).toHaveLength(1);
  const result = apply(part, drops[0]!);
  expect(listBookmarks(result)[0]).toMatchObject({ markerId: '1', copies: 1 });
});

test('enclosed deletion addresses canonical pairs when file-level ids repeat', () => {
  const part = load(
    [0, 1]
      .map(
        () =>
          '<w:p><w:bookmarkStart w:id="1" w:name="Same"/><w:r><w:t>Text</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>'
      )
      .join('')
  );
  const drops = enclosedBookmarkDeletions(
    part,
    { paragraphId: P, offset: 0 },
    { paragraphId: P, offset: 4 },
    [P, P2]
  );
  expect(drops).toHaveLength(1);
  const result = apply(part, drops[0]!);
  expect(listBookmarks(result)).toHaveLength(1);
  expect(listBookmarks(result)[0]!.start.paragraphId).toBe(P2);
});

test('typing and deleting at a bookmark index the part no more than once', () => {
  // The rules read the paragraph's markers; reading them in the tree the edit replaced, after
  // the edit moved the index on, walked the whole part again for every keystroke.
  let part = load(SAMPLE + '<w:p><w:r><w:t>tail</w:t></w:r></w:p>');
  findNode(part, P);
  const recorder = nodeIndexTestRecorder();
  recorder.reset();
  part = apply(part, { op: 'insertText', paragraphId: P, offset: 4, text: 'x' });
  // Typed at the bookmark's start, the text joins it.
  expect(shape(part)).toStartWith('|"AAA "[rng:1"x');
  part = apply(part, { op: 'deleteText', paragraphId: P, start: 4, end: 9 });
  // The deletion covered the whole bookmark, so it went with the text.
  expect(shape(part)).toStartWith('|"AAA ""CCC "');
  expect(recorder.completeBuilds).toBe(0);
});
