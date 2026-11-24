// Tracked deletions over whole paragraphs, through the automation host.
//
// A tracked range deletion strikes the text as deleted runs and every paragraph mark it covers
// as a deleted paragraph mark. A tracked paragraph deletion is the range from the paragraph's
// start to the next paragraph's start. Accept removes what was struck; reject restores it.

import { describe, expect, test } from 'bun:test';
import { canonicalOoxmlFingerprint, readOoxmlPackage, semanticDigest } from '../../store/index.ts';
import {
  docx,
  open,
  p,
  pWithSection,
  paragraphTexts,
  paragraphsOf,
  refusal,
  reopen,
  roots,
  savedMainXml,
  sdt,
  storyText,
} from './support/protocol.ts';
import type { AutomationHandle, AutomationHost } from '../protocol.ts';
import type { AutomationOperation } from '../operations.ts';

const TRACK = { op: 'setChangeTrackingMode', mode: 'TrackMineOnly', author: 'Agent' } as const;
const FOUR = docx(p('Alpha one') + p('Bravo two') + p('Charlie three') + p('Delta four'));

function oracles(host: AutomationHost) {
  const saved = host.save();
  if (!saved.ok) throw new Error(saved.error.code);
  const opened = readOoxmlPackage(saved.bytes);
  if (!opened.ok) throw new Error(opened.reason);
  const main = opened.package.parts.get(opened.package.mainDocumentPart)!;
  return {
    fingerprint: canonicalOoxmlFingerprint(main),
    digest: JSON.stringify(semanticDigest(opened.package.parts.values())),
  };
}

function run(host: AutomationHost, operations: readonly AutomationOperation[]) {
  const response = host.execute({ operations: [TRACK, ...operations] });
  expect(response.ok).toBe(true);
  return response;
}

function decide(host: AutomationHost, body: AutomationHandle, accept: boolean) {
  const operation: AutomationOperation = accept
    ? { op: 'acceptAllRevisions', body }
    : { op: 'rejectAllRevisions', body };
  expect(host.execute({ operations: [operation] }).ok).toBe(true);
}

function deleteBetween(
  paragraphs: readonly AutomationHandle[],
  from: [number, number],
  to: [number, number]
): AutomationOperation {
  return {
    op: 'replaceSpan',
    span: {
      start: { paragraph: paragraphs[from[0]]!, offset: from[1] },
      end: { paragraph: paragraphs[to[0]]!, offset: to[1] },
    },
    text: '',
  };
}

describe('tracked range deletion across paragraphs', () => {
  test('a range inside the first and last paragraphs strikes the whole paragraphs between', () => {
    const host = open(FOUR);
    const { body } = roots(host);
    run(host, [deleteBetween(paragraphsOf(host, body), [0, 6], [3, 6])]);
    const xml = savedMainXml(host);
    expect(xml.match(/<w:pPr><w:rPr><w:del /g)).toHaveLength(3);
    expect(paragraphTexts(host, body)).toEqual([
      'Alpha one',
      'Bravo two',
      'Charlie three',
      'Delta four',
    ]);

    const accepted = reopen(host);
    decide(accepted.host, accepted.body, true);
    expect(paragraphTexts(accepted.host, accepted.body)).toEqual(['Alpha four']);
    const again = reopen(accepted.host);
    expect(oracles(again.host)).toEqual(oracles(accepted.host));

    // Reject restores every paragraph and mark. The struck runs come back as separate runs.
    decide(host, body, false);
    expect(storyText(host, body)).toBe('Alpha one\rBravo two\rCharlie three\rDelta four');
    expect(savedMainXml(host)).not.toContain('<w:pPr>');
    expect(savedMainXml(host)).not.toContain('<w:del ');
  });

  test('a range that ends at a paragraph start removes whole paragraphs and their marks', () => {
    const host = open(FOUR);
    const { body } = roots(host);
    run(host, [deleteBetween(paragraphsOf(host, body), [1, 0], [3, 0])]);
    decide(host, body, true);
    expect(paragraphTexts(host, body)).toEqual(['Alpha one', 'Delta four']);
  });
});

describe('tracked paragraph deletion', () => {
  test('deletes text and mark, and deleting adjacent paragraphs shares one batch', () => {
    const host = open(FOUR);
    const { body } = roots(host);
    const paragraphs = paragraphsOf(host, body);
    run(host, [
      { op: 'deleteParagraph', paragraph: paragraphs[1]! },
      { op: 'deleteParagraph', paragraph: paragraphs[2]! },
    ]);
    expect(storyText(host, body)).toBe('Alpha one\rBravo two\rCharlie three\rDelta four');
    decide(host, body, true);
    expect(paragraphTexts(host, body)).toEqual(['Alpha one', 'Delta four']);
  });

  test('a paragraph inside a block content control needs a next paragraph in the control', () => {
    const host = open(docx(sdt(p('Inside first'), p('Inside last')) + p('Outside')));
    const { body } = roots(host);
    const paragraphs = paragraphsOf(host, body);
    const last = host.execute({
      operations: [TRACK, { op: 'deleteParagraph', paragraph: paragraphs[1]! }],
    });
    expect(refusal(last)).toBe('unsupported-capability');
    run(host, [{ op: 'deleteParagraph', paragraph: paragraphs[0]! }]);
    decide(host, body, true);
    expect(paragraphTexts(host, body)).toEqual(['Inside last', 'Outside']);
  });

  test('the last paragraph of the story refuses', () => {
    const host = open(FOUR);
    const { body } = roots(host);
    const before = oracles(host);
    const paragraphs = paragraphsOf(host, body);
    const response = host.execute({
      operations: [TRACK, { op: 'deleteParagraph', paragraph: paragraphs[3]! }],
    });
    expect(refusal(response)).toBe('unsupported-capability');
    expect(oracles(host)).toEqual(before);
  });
});

/** A tracked paragraph deletion of `index` refuses with `code` and changes nothing. */
function expectRefused(bytes: Uint8Array, index: number, code: string) {
  const host = open(bytes);
  const { body } = roots(host);
  const before = oracles(host);
  const response = host.execute({
    operations: [TRACK, { op: 'deleteParagraph', paragraph: paragraphsOf(host, body)[index]! }],
  });
  expect(refusal(response)).toBe(code);
  expect(oracles(host)).toEqual(before);
}

const ins = (text: string) =>
  `<w:ins w:id="9" w:author="Reviewer" w:date="2026-01-01T00:00:00Z"><w:r><w:t>${text}</w:t></w:r></w:ins>`;

describe('marks a tracked deletion does not strike', () => {
  test('a paragraph mark that ends a section refuses, by paragraph and by range', () => {
    const bytes = docx(p('One') + pWithSection('Two') + p('Three'));
    expectRefused(bytes, 1, 'unsupported-capability');
    const host = open(bytes);
    const { body } = roots(host);
    const response = host.execute({
      operations: [TRACK, deleteBetween(paragraphsOf(host, body), [1, 1], [2, 1])],
    });
    expect(refusal(response)).toBe('unsupported-capability');
  });

  test('a paragraph with an inline content control refuses', () => {
    const control =
      '<w:p><w:sdt><w:sdtPr/><w:sdtContent><w:r><w:t>Control</w:t></w:r></w:sdtContent></w:sdt></w:p>';
    expectRefused(docx(control + p('Next')), 0, 'unsupported-capability');
  });

  test('a content control inside a text box does not block the deletion', () => {
    const box =
      '<w:p><w:r><w:t>Before box</w:t></w:r><w:r><w:pict xmlns:v="urn:schemas-microsoft-com:vml">' +
      '<v:shape><v:textbox><w:txbxContent><w:p><w:sdt><w:sdtPr/><w:sdtContent>' +
      '<w:r><w:t>Boxed control</w:t></w:r></w:sdtContent></w:sdt></w:p></w:txbxContent>' +
      '</v:textbox></v:shape></w:pict></w:r></w:p>';
    const host = open(docx(box + p('Next')));
    const { body } = roots(host);
    run2(host, body, 0);
    decide(host, body, true);
    expect(paragraphTexts(host, body)).toEqual(['Next']);
  });

  test('a paragraph where a field crosses the mark refuses, and a closed field deletes', () => {
    const run = (inner: string) => `<w:r>${inner}</w:r>`;
    const begin = run('<w:fldChar w:fldCharType="begin"/>');
    const code = run('<w:instrText xml:space="preserve"> QUOTE "x" </w:instrText>');
    const separate = run('<w:fldChar w:fldCharType="separate"/>');
    const end = run('<w:fldChar w:fldCharType="end"/>');
    const crossing =
      `<w:p>${run('<w:t>Head </w:t>')}${begin}${code}${separate}${run('<w:t>x</w:t>')}</w:p>` +
      `<w:p>${run('<w:t>tail</w:t>')}${end}</w:p>` +
      p('Last');
    expectRefused(docx(crossing), 0, 'unsupported-capability');
    expectRefused(docx(crossing), 1, 'unsupported-capability');

    const closed = `<w:p>${run('<w:t>Head </w:t>')}${begin}${code}${separate}${run('<w:t>x</w:t>')}${end}</w:p>`;
    const host = open(docx(closed + p('Last')));
    const { body } = roots(host);
    run2(host, body, 0);
    decide(host, body, true);
    expect(paragraphTexts(host, body)).toEqual(['Last']);
    expect(savedMainXml(host)).not.toContain('fldChar');
  });

  test('an interior field-result paragraph can be deleted and reviewed', () => {
    const fieldStart =
      '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:instrText> QUOTE "x" </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      '<w:r><w:t>Head</w:t></w:r></w:p>';
    const fieldEnd =
      '<w:p><w:r><w:t>Tail</w:t></w:r>' + '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';
    const bytes = docx(fieldStart + p('Middle') + fieldEnd + p('Last'));
    for (const accept of [true, false]) {
      const host = open(bytes);
      const { body } = roots(host);
      run2(host, body, 1);
      decide(host, body, accept);
      const xml = savedMainXml(host);
      expect(xml.includes('<w:t>Middle</w:t>')).toBe(!accept);
      for (const boundary of ['begin', 'separate', 'end']) {
        expect(xml.match(new RegExp(`w:fldCharType="${boundary}"`, 'g'))).toHaveLength(1);
      }
      expect(oracles(reopen(host).host)).toEqual(oracles(host));
    }
  });

  test('content nested deeper than the checks reach refuses', () => {
    const open70 = '<w:smartTag w:uri="u" w:element="e">'.repeat(70);
    const close70 = '</w:smartTag>'.repeat(70);
    const deep =
      `<w:p><w:r><w:t>Head </w:t></w:r>${open70}` +
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      `${close70}</w:p>`;
    expectRefused(docx(deep + p('Next') + p('Last')), 0, 'unsupported-capability');
  });

  test('a paragraph directly before a block content control refuses', () => {
    expectRefused(docx(p('One') + sdt(p('Inside')) + p('After')), 0, 'unsupported-capability');
  });

  test('a next paragraph that starts with another author pending insertion refuses', () => {
    const next = `<w:p>${ins('New ')}<w:r><w:t>Two</w:t></w:r></w:p>`;
    expectRefused(docx(p('One') + next + p('Three')), 0, 'unsupported-revision');
  });
});

describe('position markers between paragraphs', () => {
  const marked = docx(
    p('One') +
      '<w:bookmarkStart w:id="0" w:name="mark"/>' +
      p('Two') +
      '<w:bookmarkEnd w:id="0"/>' +
      p('Three')
  );

  test('do not stop a tracked paragraph deletion, and survive accept and reject', () => {
    for (const accept of [true, false]) {
      const host = open(marked);
      const { body } = roots(host);
      const paragraphs = paragraphsOf(host, body);
      run(host, [
        { op: 'deleteParagraph', paragraph: paragraphs[0]! },
        { op: 'deleteParagraph', paragraph: paragraphs[1]! },
      ]);
      decide(host, body, accept);
      expect(paragraphTexts(host, body)).toEqual(accept ? ['Three'] : ['One', 'Two', 'Three']);
      const xml = savedMainXml(host);
      expect(xml).toContain('<w:bookmarkStart w:id="0" w:name="mark"/>');
      expect(xml).toContain('<w:bookmarkEnd w:id="0"/>');
      const again = reopen(host);
      expect(paragraphTexts(again.host, again.body)).toEqual(paragraphTexts(host, body));
    }
  });

  test('do not stop a tracked range deletion across the paragraphs', () => {
    const host = open(marked);
    const { body } = roots(host);
    run(host, [deleteBetween(paragraphsOf(host, body), [0, 1], [2, 1])]);
    decide(host, body, true);
    expect(paragraphTexts(host, body)).toEqual(['Ohree']);
  });
});

function run2(host: AutomationHost, body: AutomationHandle, index: number) {
  run(host, [{ op: 'deleteParagraph', paragraph: paragraphsOf(host, body)[index]! }]);
}

describe('deletions beside the author own pending deletion', () => {
  for (const [first, second] of [
    [1, 2],
    [2, 1],
  ] as const)
    test(`deleting paragraph ${second} in a later sync after ${first} refuses`, () => {
      const host = open(FOUR);
      const { body } = roots(host);
      run2(host, body, first);
      const before = oracles(host);
      const response = host.execute({
        operations: [
          TRACK,
          { op: 'deleteParagraph', paragraph: paragraphsOf(host, body)[second]! },
        ],
      });
      expect(refusal(response)).toBe('unsupported-revision');
      expect(oracles(host)).toEqual(before);
    });

  for (const [name, text] of [
    ['deletion', ''],
    ['replacement', 'Changed'],
  ] as const)
    test(`a later ${name} of the next paragraph's first word refuses`, () => {
      const host = open(FOUR);
      const { body } = roots(host);
      run2(host, body, 0);
      const before = oracles(host);
      const next = paragraphsOf(host, body)[1]!;
      const response = host.execute({
        operations: [
          TRACK,
          {
            op: 'replaceSpan',
            span: { start: { paragraph: next, offset: 0 }, end: { paragraph: next, offset: 5 } },
            text,
          },
        ],
      });
      expect(refusal(response)).toBe('unsupported-revision');
      expect(oracles(host)).toEqual(before);
    });

  test('a later insertion at the next paragraph start is its own decision', () => {
    const host = open(FOUR);
    const { body } = roots(host);
    run2(host, body, 0);
    const next = paragraphsOf(host, body)[1]!;
    run(host, [{ op: 'insertText', at: { paragraph: next, offset: 0 }, text: 'X ' }]);
    const xml = savedMainXml(host);
    const ids = new Set([...xml.matchAll(/<w:(?:ins|del) [^>]*w:id="(\d+)"/g)].map((m) => m[1]));
    expect(ids.size).toBe(3);
  });

  test('a paragraph that is not adjacent to the earlier deletion records its own decision', () => {
    const host = open(FOUR);
    const { body } = roots(host);
    run2(host, body, 0);
    run2(host, body, 2);
    const ids = [...savedMainXml(host).matchAll(/<w:rPr><w:del [^>]*w:id="(\d+)"/g)].map(
      (match) => match[1]
    );
    expect(new Set(ids).size).toBe(2);
  });
});

describe('reject restores the source paragraph properties exactly', () => {
  for (const [name, properties] of [
    ['no properties', ''],
    ['empty properties', '<w:pPr/>'],
    ['empty mark properties', '<w:pPr><w:rPr/></w:pPr>'],
    ['alignment', '<w:pPr><w:jc w:val="center"/></w:pPr>'],
  ] as const)
    test(name, () => {
      const host = open(
        docx(`<w:p>${properties}<w:r><w:t>One</w:t></w:r></w:p>` + p('Two') + p('Three'))
      );
      const { body } = roots(host);
      const before = oracles(host);
      run2(host, body, 0);
      decide(host, body, false);
      expect(oracles(host)).toEqual(before);
    });
});

test('a tracked deletion over 8000 paragraphs stays fast', () => {
  const count = 8000;
  const host = open(docx(Array.from({ length: count }, (_, i) => p(`Paragraph ${i}`)).join('')));
  const { body } = roots(host);
  const paragraphs = paragraphsOf(host, body);
  const started = performance.now();
  run(host, [deleteBetween(paragraphs, [0, 0], [count - 1, 0])]);
  // About 1.7 s here. Walking the part per op, or the siblings per paragraph, took 53 s.
  expect(performance.now() - started).toBeLessThan(15_000);
  expect(savedMainXml(host).match(/<w:rPr><w:del /g)).toHaveLength(count - 1);
}, 120_000);

test('a tracked deletion over 4000 paragraphs separated by bookmarks stays one decision and fast', () => {
  const count = 4000;
  const body = Array.from(
    { length: count },
    (_, i) =>
      p(`Paragraph ${i}`) +
      `<w:bookmarkStart w:id="${i}" w:name="b${i}"/><w:bookmarkEnd w:id="${i}"/>`
  ).join('');
  const host = open(docx(body));
  const { body: story } = roots(host);
  const paragraphs = paragraphsOf(host, story);
  const started = performance.now();
  run(host, [deleteBetween(paragraphs, [0, 0], [count - 1, 0])]);
  const elapsed = performance.now() - started;
  const markIds = new Set(
    [...savedMainXml(host).matchAll(/<w:rPr><w:del [^>]*w:id="(\d+)"/g)].map((m) => m[1])
  );
  // One shared mark id: the marks join across the bookmarks, so the id walk happens once.
  expect(markIds.size).toBe(1);
  // About 4.5 s here. One id walk per mark took 54 s.
  expect(elapsed).toBeLessThan(30_000);
}, 120_000);

describe('position markers at the join after accept', () => {
  const body =
    p('Alpha one') +
    '<w:bookmarkStart w:id="0" w:name="mark"/>' +
    p('Bravo two') +
    '<w:bookmarkEnd w:id="0"/>' +
    p('Charlie three');

  test('a marker between the joined paragraphs lands at the join point', () => {
    const host = open(docx(body));
    const { body: story } = roots(host);
    run(host, [deleteBetween(paragraphsOf(host, story), [0, 6], [1, 6])]);
    decide(host, story, true);
    expect(paragraphTexts(host, story)).toEqual(['Alpha two', 'Charlie three']);
    const xml = savedMainXml(host);
    const joined = xml.slice(xml.indexOf('<w:p'), xml.indexOf('</w:p>') + 6);
    // The bookmark covered "Bravo two"; it now covers "two", not the kept "Alpha ".
    expect(joined).toMatch(/Alpha <\/w:t><\/w:r><w:bookmarkStart w:id="0" w:name="mark"\/><w:r>/);
    expect(xml).toMatch(/<\/w:p><w:bookmarkEnd w:id="0"\/><w:p/);
    expect(xml.indexOf('<w:bookmarkStart')).toBeGreaterThan(xml.indexOf('Alpha'));
  });

  test('a comment range start between the joined paragraphs lands at the join point', () => {
    const host = open(
      docx(
        p('Alpha one') +
          '<w:commentRangeStart w:id="3"/>' +
          p('Bravo two') +
          '<w:commentRangeEnd w:id="3"/>' +
          p('Charlie three')
      )
    );
    const { body: story } = roots(host);
    run(host, [deleteBetween(paragraphsOf(host, story), [0, 6], [1, 6])]);
    decide(host, story, true);
    const xml = savedMainXml(host);
    expect(xml).toMatch(/Alpha <\/w:t><\/w:r><w:commentRangeStart w:id="3"\/><w:r>/);
  });

  test('reject keeps the markers where they were', () => {
    const host = open(docx(body));
    const { body: story } = roots(host);
    run(host, [deleteBetween(paragraphsOf(host, story), [0, 6], [1, 6])]);
    decide(host, story, false);
    expect(paragraphTexts(host, story)).toEqual(['Alpha one', 'Bravo two', 'Charlie three']);
    expect(savedMainXml(host)).toMatch(
      /one<\/w:t><\/w:r><\/w:p><w:bookmarkStart w:id="0" w:name="mark"\/><w:p[^>]*><w:r><w:t xml:space="preserve">Bravo .*two<\/w:t><\/w:r><\/w:p><w:bookmarkEnd w:id="0"\/>/
    );
  });
});

test('4000 paragraph deletions in one batch stay fast and record each mark', () => {
  const count = 4000;
  const host = open(docx(Array.from({ length: count }, (_, i) => p(`Paragraph ${i}`)).join('')));
  const { body } = roots(host);
  const paragraphs = paragraphsOf(host, body);
  const started = performance.now();
  run(
    host,
    paragraphs.slice(0, -1).map((paragraph) => ({ op: 'deleteParagraph' as const, paragraph }))
  );
  // About 0.6 s here. A revision id walk per mark and a sibling scan per paragraph took 6 s.
  expect(performance.now() - started).toBeLessThan(4000);
  expect(savedMainXml(host).match(/<w:rPr><w:del /g)).toHaveLength(count - 1);
}, 120_000);

test('a file that already uses the highest revision id still gets distinct new ids', () => {
  const ceiling =
    '<w:p><w:ins w:id="2147483647" w:author="Reviewer" w:date="2026-01-01T00:00:00Z">' +
    '<w:r><w:t>Old</w:t></w:r></w:ins></w:p>';
  const host = open(docx(ceiling + p('Alpha one') + p('Bravo two') + p('Charlie three')));
  const { body } = roots(host);
  const paragraphs = paragraphsOf(host, body);
  run(host, [
    { op: 'deleteParagraph', paragraph: paragraphs[1]! },
    { op: 'deleteParagraph', paragraph: paragraphs[2]! },
  ]);
  const ids = [...savedMainXml(host).matchAll(/<w:del [^>]*w:id="(\d+)"/g)].map((m) => m[1]);
  // Two text deletions and one shared mark id, none of them a duplicate of another.
  expect(new Set(ids).size).toBe(3);
  expect(ids).not.toContain('2147483647');
});

test('accepting a join over 8000 paragraphs separated by bookmarks stays fast', () => {
  const count = 8000;
  const body = Array.from(
    { length: count },
    (_, i) =>
      p(`Paragraph ${i}`) +
      `<w:bookmarkStart w:id="${i}" w:name="b${i}"/><w:bookmarkEnd w:id="${i}"/>`
  ).join('');
  const host = open(docx(body));
  const { body: story } = roots(host);
  const paragraphs = paragraphsOf(host, story);
  // Keep "Para" of the first paragraph, so every later marker joins the carried text.
  run(host, [deleteBetween(paragraphs, [0, 4], [count - 1, 0])]);
  const started = performance.now();
  decide(host, story, true);
  // About 1.4 s here; copying the carried content into every dropped paragraph took 2.2 s,
  // and the gap grows with the paragraph count (5.8 s against 10.8 s at 16000).
  expect(performance.now() - started).toBeLessThan(10_000);
  expect(paragraphTexts(host, story)).toEqual([`ParaParagraph ${count - 1}`]);
}, 300_000);

test('after the ceiling, a padded file id such as 05 is not minted again as 5', () => {
  const revision = (id: string, text: string) =>
    `<w:p><w:ins w:id="${id}" w:author="Reviewer" w:date="2026-01-01T00:00:00Z">` +
    `<w:r><w:t>${text}</w:t></w:r></w:ins></w:p>`;
  const taken = ['2147483647', '000', '+1', '2', '0000000000000000003', '4', '05'];
  const host = open(
    docx(
      taken.map((id, i) => revision(id, `Old ${i}`)).join('') +
        p('Alpha one') +
        p('Bravo two') +
        p('Charlie three')
    )
  );
  const { body } = roots(host);
  const paragraphs = paragraphsOf(host, body);
  run(host, [
    { op: 'deleteParagraph', paragraph: paragraphs[taken.length]! },
    { op: 'deleteParagraph', paragraph: paragraphs[taken.length + 1]! },
  ]);
  const ids = [...savedMainXml(host).matchAll(/<w:del [^>]*w:id="(\d+)"/g)].map((m) => m[1]!);
  expect(new Set(ids).size).toBe(3);
  for (const id of ids) expect(['0', '1', '2', '3', '4', '5']).not.toContain(id);
});
