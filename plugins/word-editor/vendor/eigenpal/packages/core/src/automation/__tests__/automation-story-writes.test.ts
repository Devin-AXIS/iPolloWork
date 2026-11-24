// What a write MEANS, at the protocol boundary, against real documents.
//
// Every test here goes through `execute` to a real `TreePackageStore` and asks the document
// afterwards. Nothing is asserted about ops: an op list that looks right and produces the wrong
// document is the failure these tests exist to catch, so the assertions are the document's own
// paragraphs, its text, and — where the point is fidelity — its saved-and-reopened self.

import { describe, expect, test } from 'bun:test';
import {
  cell,
  docx,
  errorAt,
  handleAt,
  open,
  p,
  paragraphsOf,
  paragraphTexts,
  pWithSection,
  refusal,
  row,
  savedMainXml,
  sdt,
  spanAt,
  spansAt,
  storyText,
  table,
  textAt,
  reopen,
} from './support/protocol.ts';
import type { AutomationHandle } from '../protocol.ts';

describe('inserting text at a position', () => {
  test('writes at the offset and answers the span the text now occupies', () => {
    const host = open(docx(p('alpha')));
    const body = bodyOf(host);
    const [first] = paragraphsOf(host, body) as [AutomationHandle];

    const response = host.execute({
      operations: [{ op: 'insertText', at: { paragraph: first, offset: 2 }, text: 'XY' }],
    });

    expect(response.ok).toBe(true);
    expect(response.changed).toBe(true);
    expect(paragraphTexts(host, body)).toEqual(['alXYpha']);
    const span = spanAt(response, 0);
    expect([span.start.offset, span.end.offset]).toEqual([2, 4]);
    expect(span.start.paragraph.ref).toBe(first.ref);
  });

  test('writes at the start and at the end of a story without naming a paragraph', () => {
    const host = open(docx(p('one') + p('two')));
    const body = bodyOf(host);
    host.execute({
      operations: [
        { op: 'insertText', at: { body, at: 'start' }, text: '<' },
        { op: 'insertText', at: { body, at: 'end' }, text: '>' },
      ],
    });
    expect(paragraphTexts(host, body)).toEqual(['<one', 'two>']);
  });

  test('uses raw endpoints around a field while display reads show its result', () => {
    const field =
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:instrText> DATE </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      '<w:r><w:t>1 January 2030</w:t></w:r>' +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
    const paragraph = `<w:p><w:r><w:t>A</w:t></w:r>${field}<w:r><w:t>Z</w:t></w:r></w:p>`;

    for (const [at, expected] of [
      ['start', '<A1 January 2030Z'],
      ['end', 'A1 January 2030Z>'],
    ] as const) {
      const host = open(docx(paragraph));
      const body = bodyOf(host);
      const [handle] = paragraphsOf(host, body);
      const response = host.execute({
        operations: [
          { op: 'insertText', at: { paragraph: handle!, at }, text: at === 'start' ? '<' : '>' },
        ],
      });

      expect(response.ok).toBe(true);
      expect(paragraphTexts(host, body)).toEqual([expected]);
    }

    const host = open(docx(paragraph));
    const body = bodyOf(host);
    const [handle] = paragraphsOf(host, body);
    const response = host.execute({
      operations: [{ op: 'replaceSpan', span: { paragraph: handle! }, text: 'replacement' }],
    });
    expect(response.ok).toBe(true);
    expect(paragraphTexts(host, body)).toEqual(['replacement']);
  });

  test('replaces the field atom behind a visible search result', () => {
    const field =
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:instrText> DATE </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      '<w:r><w:t>1 January 2030</w:t></w:r>' +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
    const host = open(docx(`<w:p><w:r><w:t>A</w:t></w:r>${field}<w:r><w:t>Z</w:t></w:r></w:p>`));
    const body = bodyOf(host);
    const [match] = spansAt(
      host.execute({ operations: [{ op: 'search', scope: { body }, text: 'January' }] }),
      0
    );

    const response = host.execute({
      operations: [{ op: 'replaceSpan', span: match!, text: 'new' }],
    });
    expect(response.ok).toBe(true);
    expect(paragraphTexts(host, body)).toEqual(['AnewZ']);
  });

  test('two inserts retain their positions in the batch snapshot', () => {
    const host = open(docx(p('abcd')));
    const body = bodyOf(host);
    const [first] = paragraphsOf(host, body) as [AutomationHandle];
    const response = host.execute({
      operations: [
        { op: 'insertText', at: { paragraph: first, offset: 0 }, text: '1' },
        { op: 'insertText', at: { paragraph: first, offset: 4 }, text: '2' },
      ],
    });
    expect(response.ok).toBe(true);
    // Both offsets address `abcd`. Rebase the later operation so its source end
    // remains the end after the first insertion changes the live paragraph.
    expect(paragraphTexts(host, body)).toEqual(['1abcd2']);
  });

  test('refuses form feeds and Unicode separators rather than writing a character that lies', () => {
    const host = open(docx(p('alpha')));
    const body = bodyOf(host);
    const [first] = paragraphsOf(host, body) as [AutomationHandle];
    for (const text of ['a\fb', 'a\nb\u2029c', 'a\u2028b']) {
      const response = host.execute({
        operations: [{ op: 'insertText', at: { paragraph: first, offset: 0 }, text }],
      });
      expect(refusal(response)).toBe('unsupported-content');
    }
    expect(paragraphTexts(host, body)).toEqual(['alpha']);
  });

  test('splits the paragraph at each line feed, carriage return, or CRLF pair', () => {
    const host = open(docx(p('alpha')));
    const body = bodyOf(host);
    const [first] = paragraphsOf(host, body) as [AutomationHandle];
    const response = host.execute({
      operations: [{ op: 'insertText', at: { paragraph: first, offset: 2 }, text: '1\r2\n3\r\n' }],
    });
    expect(response.ok).toBe(true);
    expect(paragraphTexts(host, body)).toEqual(['al1', '2', '3', 'pha']);
  });

  test('writes into a table cell paragraph, because it is an ordinary paragraph', () => {
    const host = open(docx(table(row(cell(p('One')), cell(p('Two'))))));
    const body = bodyOf(host);
    const cells = paragraphsOf(host, body);
    host.execute({
      operations: [{ op: 'insertText', at: { paragraph: cells[1]!, offset: 3 }, text: '!' }],
    });
    expect(paragraphTexts(host, body)).toEqual(['One', 'Two!', '']);
  });

  test('survives save and reopen', () => {
    const host = open(docx(p('alpha')));
    const body = bodyOf(host);
    const [first] = paragraphsOf(host, body) as [AutomationHandle];
    host.execute({
      operations: [{ op: 'insertText', at: { paragraph: first, offset: 5 }, text: ' beta' }],
    });
    const reopened = reopen(host);
    expect(paragraphTexts(reopened.host, reopened.body)).toEqual(['alpha beta']);
  });
});

describe('replacing a span', () => {
  test('replaces inside one paragraph', () => {
    const host = open(docx(p('alpha beta')));
    const body = bodyOf(host);
    const [first] = paragraphsOf(host, body) as [AutomationHandle];
    const response = host.execute({
      operations: [
        {
          op: 'replaceSpan',
          span: { start: { paragraph: first, offset: 0 }, end: { paragraph: first, offset: 5 } },
          text: 'omega',
        },
      ],
    });
    expect(response.ok).toBe(true);
    expect(paragraphTexts(host, body)).toEqual(['omega beta']);
    expect([spanAt(response, 0).start.offset, spanAt(response, 0).end.offset]).toEqual([0, 5]);
  });

  test('deletes when the replacement is empty', () => {
    const host = open(docx(p('alpha beta')));
    const body = bodyOf(host);
    const [first] = paragraphsOf(host, body) as [AutomationHandle];
    host.execute({
      operations: [
        {
          op: 'replaceSpan',
          span: { start: { paragraph: first, offset: 5 }, end: { paragraph: first, offset: 10 } },
          text: '',
        },
      ],
    });
    expect(paragraphTexts(host, body)).toEqual(['alpha']);
  });

  test('across paragraph marks removes what is between and joins the ends', () => {
    const host = open(docx(p('alpha') + p('beta') + p('gamma')));
    const body = bodyOf(host);
    const list = paragraphsOf(host, body);
    const response = host.execute({
      operations: [
        {
          op: 'replaceSpan',
          span: {
            start: { paragraph: list[0]!, offset: 2 },
            end: { paragraph: list[2]!, offset: 3 },
          },
          text: '-',
        },
      ],
    });
    expect(response.ok).toBe(true);
    expect(paragraphTexts(host, body)).toEqual(['al-ma']);
  });
});

// Replacing THE WHOLE STORY is not the same operation as replacing a stretch of one, and the
// difference is the reason these tests are their own describe. A stretch is deleted by removing
// text and joining what is left of the two ends; a story that holds a table cannot be joined —
// `joinParagraphs` refuses across a cell boundary, and rightly so — so "empty this story" is
// planned STRUCTURALLY: take the blocks out, keep one paragraph to write into. `Body.clear()` and
// `Body.insertText(…, 'Replace')` are the two members that mean this, and a document with a table
// in it is not an edge case for them, it is the ordinary shape of a report.
describe('replacing a whole story', () => {
  test('empties a story whose blocks include a table, cell paragraphs and all', () => {
    const host = open(docx(p('alpha') + table(row(cell(p('One')), cell(p('Two')))) + p('omega')));
    const body = bodyOf(host);
    expect(paragraphTexts(host, body)).toEqual(['alpha', 'One', 'Two', 'omega']);

    const response = host.execute({
      operations: [{ op: 'replaceSpan', span: { body }, text: '' }],
    });

    expect(response.ok).toBe(true);
    expect(paragraphTexts(host, body)).toEqual(['']);
    expect(storyText(host, body)).toBe('');
    // The table is GONE, not merely emptied: a story cleared of its text that still paints a
    // two-by-two grid is not a cleared story.
    expect(savedMainXml(host)).not.toContain('<w:tbl>');
  });

  test('writes the replacement text into the paragraph it keeps', () => {
    const host = open(docx(p('alpha') + table(row(cell(p('One')))) + p('omega')));
    const body = bodyOf(host);
    const response = host.execute({
      operations: [{ op: 'replaceSpan', span: { body }, text: 'fresh' }],
    });
    expect(response.ok).toBe(true);
    expect(paragraphTexts(host, body)).toEqual(['fresh']);
    // And it answers the span the text now occupies, in that paragraph.
    const span = spanAt(response, 0);
    expect([span.start.offset, span.end.offset]).toEqual([0, 5]);
    expect(span.start.paragraph.ref).toBe(span.end.paragraph.ref);
  });

  test('the paragraph it keeps is the story\u2019s first, which keeps its identity', () => {
    const host = open(docx(p('alpha') + table(row(cell(p('One')))) + p('omega')));
    const body = bodyOf(host);
    const [first] = paragraphsOf(host, body) as [AutomationHandle];
    host.execute({ operations: [{ op: 'replaceSpan', span: { body }, text: 'fresh' }] });
    // The handle a caller already held still names the paragraph, so a script can clear a story
    // and go on writing to the paragraph it cleared.
    expect(textAt(host.execute({ operations: [{ op: 'getText', target: first }] }), 0)).toBe(
      'fresh'
    );
  });

  test('survives save and reopen', () => {
    const host = open(docx(p('alpha') + table(row(cell(p('One')), cell(p('Two')))) + p('omega')));
    const body = bodyOf(host);
    host.execute({ operations: [{ op: 'replaceSpan', span: { body }, text: 'only this' }] });
    const reopened = reopen(host);
    expect(paragraphTexts(reopened.host, reopened.body)).toEqual(['only this']);
  });

  test('keeps a paragraph whose mark ends a section, and empties it instead', () => {
    // Deleting it would merge the section into the next one — taking that section's page size and
    // headers over every page this one governed — so the store refuses to, and so does this. The
    // story ends up with the text it was told to have and the sections it started with.
    const host = open(docx(pWithSection('first section') + p('second section')));
    const body = bodyOf(host);
    const response = host.execute({
      operations: [{ op: 'replaceSpan', span: { body }, text: 'after' }],
    });
    expect(response.ok).toBe(true);
    expect(paragraphTexts(host, body)).toEqual(['after']);
    expect(savedMainXml(host)).toContain('<w:sectPr>');
  });

  test('keeps a paragraph inside a block content control, because the control is not a block it removes', () => {
    const host = open(docx(sdt(p('inside')) + p('outside')));
    const body = bodyOf(host);
    const response = host.execute({
      operations: [{ op: 'replaceSpan', span: { body }, text: '' }],
    });
    expect(response.ok).toBe(true);
    expect(paragraphTexts(host, body)).toEqual(['']);
    expect(savedMainXml(host)).toContain('<w:sdt>');
  });

  test('removes a table that ends the story and keeps the empty paragraph read after it', () => {
    const host = open(docx(table(row(cell(p('One'))))));
    const body = bodyOf(host);
    const response = host.execute({
      operations: [{ op: 'replaceSpan', span: { body }, text: '' }],
    });
    expect(response.ok).toBe(true);
    expect(paragraphTexts(host, body)).toEqual(['']);
    expect(savedMainXml(host)).not.toContain('<w:tbl>');
  });

  test('keeps the paragraph after a final control that holds a table', () => {
    const host = open(docx(p('before') + sdt(table(row(cell(p('One')))))));
    const body = bodyOf(host);
    const response = host.execute({
      operations: [{ op: 'replaceSpan', span: { body }, text: 'new' }],
    });
    expect(response.ok).toBe(true);
    expect(savedMainXml(host)).toMatch(/<\/w:sdt><w:p[ />]/);
    // The cell is cleared and holds the text; the paragraph after the control stays empty.
    expect(paragraphTexts(host, body)).toEqual(['new', '']);
  });

  test('is one claim on every paragraph in the story, so a second edit in the batch is refused', () => {
    const host = open(docx(p('alpha') + p('beta')));
    const body = bodyOf(host);
    const list = paragraphsOf(host, body);
    const response = host.execute({
      operations: [
        { op: 'replaceSpan', span: { body }, text: 'fresh' },
        { op: 'insertText', at: { paragraph: list[1]!, offset: 0 }, text: 'X' },
      ],
    });
    expect(errorAt(response, 1)).toBe('conflicting-operations');
    expect(paragraphTexts(host, body)).toEqual(['alpha', 'beta']);
  });

  test('an empty story is still refused rather than answered', () => {
    const host = open(docx(''));
    const body = bodyOf(host);
    expect(
      refusal(host.execute({ operations: [{ op: 'replaceSpan', span: { body }, text: '' }] }))
    ).toBe('invalid-offset');
  });

  test('a story of plain paragraphs still ends as one paragraph holding nothing', () => {
    const host = open(docx(p('alpha') + p('beta')));
    const body = bodyOf(host);
    host.execute({ operations: [{ op: 'replaceSpan', span: { body }, text: '' }] });
    expect(paragraphTexts(host, body)).toEqual(['']);
    expect(storyText(host, body)).toBe('');
  });
});

describe('replacing a span that is not the whole story', () => {
  test('a span that would join across a table cell is refused, and nothing is written', () => {
    const host = open(docx(table(row(cell(p('One')), cell(p('Two'))))));
    const body = bodyOf(host);
    const cells = paragraphsOf(host, body);
    const response = host.execute({
      operations: [
        {
          op: 'replaceSpan',
          span: {
            start: { paragraph: cells[0]!, offset: 1 },
            end: { paragraph: cells[1]!, offset: 1 },
          },
          text: 'X',
        },
      ],
    });
    // The canonical mutation path refuses the join; half a deletion is not an outcome.
    expect(refusal(response)).toBe('transaction-refused');
    expect(paragraphTexts(host, body)).toEqual(['One', 'Two', '']);
  });

  test('survives save and reopen', () => {
    const host = open(docx(p('alpha') + p('beta')));
    const body = bodyOf(host);
    const list = paragraphsOf(host, body);
    host.execute({
      operations: [
        {
          op: 'replaceSpan',
          span: {
            start: { paragraph: list[0]!, offset: 5 },
            end: { paragraph: list[1]!, offset: 0 },
          },
          text: ' ',
        },
      ],
    });
    const reopened = reopen(host);
    expect(paragraphTexts(reopened.host, reopened.body)).toEqual(['alpha beta']);
  });
});

describe('inserting a paragraph', () => {
  test('after another one, and answers a handle for the new paragraph', () => {
    const host = open(docx(p('one') + p('three')));
    const body = bodyOf(host);
    const list = paragraphsOf(host, body);
    const response = host.execute({
      operations: [
        { op: 'insertParagraph', anchor: { paragraph: list[0]! }, where: 'after', text: 'two' },
      ],
    });
    expect(response.ok).toBe(true);
    expect(paragraphTexts(host, body)).toEqual(['one', 'two', 'three']);

    const created = handleAt(response, 0);
    expect(created.kind).toBe('paragraph');
    expect(textAt(host.execute({ operations: [{ op: 'getText', target: created }] }), 0)).toBe(
      'two'
    );
    // The anchor still names the paragraph it named before.
    expect(textAt(host.execute({ operations: [{ op: 'getText', target: list[0]! }] }), 0)).toBe(
      'one'
    );
  });

  test('before another one, without the anchor coming to name the new paragraph', () => {
    // The engine's split leaves the head on the original node, so a naive implementation hands
    // the caller's existing reference to the paragraph it just created. This is that regression.
    const host = open(docx(p('two') + p('three')));
    const body = bodyOf(host);
    const list = paragraphsOf(host, body);
    const response = host.execute({
      operations: [
        { op: 'insertParagraph', anchor: { paragraph: list[0]! }, where: 'before', text: 'one' },
      ],
    });
    expect(response.ok).toBe(true);
    expect(paragraphTexts(host, body)).toEqual(['one', 'two', 'three']);

    const created = handleAt(response, 0);
    expect(textAt(host.execute({ operations: [{ op: 'getText', target: created }] }), 0)).toBe(
      'one'
    );
    expect(textAt(host.execute({ operations: [{ op: 'getText', target: list[0]! }] }), 0)).toBe(
      'two'
    );
    expect(created.ref).not.toBe(list[0]!.ref);
  });

  test('at the end of a story without naming a paragraph', () => {
    const host = open(docx(p('one')));
    const body = bodyOf(host);
    host.execute({
      operations: [
        { op: 'insertParagraph', anchor: { body, at: 'last' }, where: 'after', text: 'two' },
      ],
    });
    expect(paragraphTexts(host, body)).toEqual(['one', 'two']);
  });

  test('with no text at all, which is a blank line', () => {
    const host = open(docx(p('one')));
    const body = bodyOf(host);
    const list = paragraphsOf(host, body);
    host.execute({
      operations: [
        { op: 'insertParagraph', anchor: { paragraph: list[0]! }, where: 'after', text: '' },
      ],
    });
    expect(paragraphTexts(host, body)).toEqual(['one', '']);
  });

  test('inside a table cell, beside the paragraph it was anchored to', () => {
    const host = open(docx(table(row(cell(p('One')), cell(p('Two'))))));
    const body = bodyOf(host);
    const cells = paragraphsOf(host, body);
    host.execute({
      operations: [
        { op: 'insertParagraph', anchor: { paragraph: cells[0]! }, where: 'after', text: 'More' },
      ],
    });
    expect(paragraphTexts(host, body)).toEqual(['One', 'More', 'Two', '']);
  });

  test('gets the identity a document writes for itself', () => {
    const host = open(docx(p('one')));
    const body = bodyOf(host);
    const list = paragraphsOf(host, body);
    const created = handleAt(
      host.execute({
        operations: [
          { op: 'insertParagraph', anchor: { paragraph: list[0]! }, where: 'after', text: 'two' },
        ],
      }),
      0
    );
    const paraId = textAt(
      host.execute({ operations: [{ op: 'getParagraphId', paragraph: created }] }),
      0
    );
    expect(paraId).toMatch(/^[0-9A-F]{8}$/);
    const other = textAt(
      host.execute({ operations: [{ op: 'getParagraphId', paragraph: list[0]! }] }),
      0
    );
    expect(paraId).not.toBe(other);
  });

  test('two insertions beside the same paragraph in one batch are refused, not guessed at', () => {
    const host = open(docx(p('one')));
    const body = bodyOf(host);
    const list = paragraphsOf(host, body);
    const response = host.execute({
      operations: [
        { op: 'insertParagraph', anchor: { paragraph: list[0]! }, where: 'after', text: 'a' },
        { op: 'insertParagraph', anchor: { paragraph: list[0]! }, where: 'after', text: 'b' },
      ],
    });
    expect(errorAt(response, 1)).toBe('conflicting-operations');
    expect(paragraphTexts(host, body)).toEqual(['one']);
  });

  test('one insertion beside each of many paragraphs in one batch is ordinary', () => {
    const host = open(docx(p('one') + p('two')));
    const body = bodyOf(host);
    const list = paragraphsOf(host, body);
    const response = host.execute({
      operations: [
        { op: 'insertParagraph', anchor: { paragraph: list[0]! }, where: 'after', text: '1' },
        { op: 'insertParagraph', anchor: { paragraph: list[1]! }, where: 'after', text: '2' },
      ],
    });
    expect(response.ok).toBe(true);
    expect(paragraphTexts(host, body)).toEqual(['one', '1', 'two', '2']);
    expect(handleAt(response, 0).ref).not.toBe(handleAt(response, 1).ref);
    expect(
      textAt(host.execute({ operations: [{ op: 'getText', target: handleAt(response, 0) }] }), 0)
    ).toBe('1');
    expect(
      textAt(host.execute({ operations: [{ op: 'getText', target: handleAt(response, 1) }] }), 0)
    ).toBe('2');
  });

  test('survives save and reopen', () => {
    const host = open(docx(p('one')));
    const body = bodyOf(host);
    const list = paragraphsOf(host, body);
    host.execute({
      operations: [
        { op: 'insertParagraph', anchor: { paragraph: list[0]! }, where: 'after', text: 'two' },
      ],
    });
    const reopened = reopen(host);
    expect(paragraphTexts(reopened.host, reopened.body)).toEqual(['one', 'two']);
  });
});

describe('splitting a paragraph', () => {
  test('at every delimiter, answering a range per resulting paragraph', () => {
    const host = open(docx(p('a,b,c')));
    const body = bodyOf(host);
    const list = paragraphsOf(host, body);
    const response = host.execute({
      operations: [{ op: 'splitParagraph', paragraph: list[0]!, delimiters: [','] }],
    });
    expect(response.ok).toBe(true);
    expect(paragraphTexts(host, body)).toEqual(['a,', 'b,', 'c']);
    const spans = spansAt(response, 0);
    expect(spans).toHaveLength(3);
    expect(spans.map((span) => [span.start.offset, span.end.offset])).toEqual([
      [0, 2],
      [0, 2],
      [0, 1],
    ]);
    expect(spans[0]!.start.paragraph.ref).toBe(list[0]!.ref);
  });

  test('dropping the delimiters when asked', () => {
    const host = open(docx(p('a,b,c')));
    const body = bodyOf(host);
    const list = paragraphsOf(host, body);
    host.execute({
      operations: [
        { op: 'splitParagraph', paragraph: list[0]!, delimiters: [','], trimDelimiters: true },
      ],
    });
    expect(paragraphTexts(host, body)).toEqual(['a', 'b', 'c']);
  });

  test('trims whitespace out of the answered ranges and leaves the document alone', () => {
    const host = open(docx(p('a ; b ; c')));
    const body = bodyOf(host);
    const list = paragraphsOf(host, body);
    const response = host.execute({
      operations: [
        {
          op: 'splitParagraph',
          paragraph: list[0]!,
          delimiters: [';'],
          trimDelimiters: true,
          trimSpacing: true,
        },
      ],
    });
    expect(paragraphTexts(host, body)).toEqual(['a ', ' b ', ' c']);
    expect(spansAt(response, 0).map((span) => [span.start.offset, span.end.offset])).toEqual([
      [0, 1],
      [1, 2],
      [1, 2],
    ]);
  });

  test('with no delimiter present writes nothing and answers the one paragraph', () => {
    const host = open(docx(p('alpha')));
    const body = bodyOf(host);
    const list = paragraphsOf(host, body);
    const response = host.execute({
      operations: [{ op: 'splitParagraph', paragraph: list[0]!, delimiters: [';'] }],
    });
    expect(response.ok).toBe(true);
    expect(response.changed).toBe(false);
    expect(spansAt(response, 0)).toHaveLength(1);
    expect(paragraphTexts(host, body)).toEqual(['alpha']);
  });

  test('takes the longest delimiter where two start at the same place', () => {
    const host = open(docx(p('a--b-c')));
    const body = bodyOf(host);
    const list = paragraphsOf(host, body);
    host.execute({
      operations: [
        {
          op: 'splitParagraph',
          paragraph: list[0]!,
          delimiters: ['-', '--'],
          trimDelimiters: true,
        },
      ],
    });
    expect(paragraphTexts(host, body)).toEqual(['a', 'b', 'c']);
  });

  test('refuses a delimiter set with nothing in it', () => {
    const host = open(docx(p('alpha')));
    const body = bodyOf(host);
    const list = paragraphsOf(host, body);
    expect(
      refusal(
        host.execute({
          operations: [{ op: 'splitParagraph', paragraph: list[0]!, delimiters: [] }],
        })
      )
    ).toBe('unsupported-content');
    expect(
      refusal(
        host.execute({
          operations: [{ op: 'splitParagraph', paragraph: list[0]!, delimiters: [''] }],
        })
      )
    ).toBe('unsupported-content');
  });

  test('survives save and reopen', () => {
    const host = open(docx(p('a,b')));
    const body = bodyOf(host);
    const list = paragraphsOf(host, body);
    host.execute({
      operations: [
        { op: 'splitParagraph', paragraph: list[0]!, delimiters: [','], trimDelimiters: true },
      ],
    });
    const reopened = reopen(host);
    expect(paragraphTexts(reopened.host, reopened.body)).toEqual(['a', 'b']);
  });
});

describe('deleting a paragraph', () => {
  test('removes it and everything in it', () => {
    const host = open(docx(p('one') + p('two') + p('three')));
    const body = bodyOf(host);
    const list = paragraphsOf(host, body);
    const response = host.execute({
      operations: [{ op: 'deleteParagraph', paragraph: list[1]! }],
    });
    expect(response.ok).toBe(true);
    expect(paragraphTexts(host, body)).toEqual(['one', 'three']);
  });

  test('leaves the handles for the paragraphs around it naming the same paragraphs', () => {
    const host = open(docx(p('one') + p('two') + p('three')));
    const body = bodyOf(host);
    const list = paragraphsOf(host, body);
    host.execute({ operations: [{ op: 'deleteParagraph', paragraph: list[1]! }] });
    const response = host.execute({
      operations: [
        { op: 'getText', target: list[0]! },
        { op: 'getText', target: list[2]! },
      ],
    });
    expect([textAt(response, 0), textAt(response, 1)]).toEqual(['one', 'three']);
  });

  test('a handle for the deleted paragraph is refused afterwards', () => {
    const host = open(docx(p('one') + p('two')));
    const body = bodyOf(host);
    const list = paragraphsOf(host, body);
    host.execute({ operations: [{ op: 'deleteParagraph', paragraph: list[1]! }] });
    const response = host.execute({ operations: [{ op: 'getText', target: list[1]! }] });
    expect(errorAt(response, 0)).toBe('invalid-handle');
  });

  test('the only paragraph of a table cell is refused, because a cell must hold one', () => {
    const host = open(docx(table(row(cell(p('One'))))));
    const body = bodyOf(host);
    const list = paragraphsOf(host, body);
    const response = host.execute({ operations: [{ op: 'deleteParagraph', paragraph: list[0]! }] });
    expect(refusal(response)).toBe('unsupported-capability');
    expect(paragraphTexts(host, body)).toEqual(['One', '']);
  });

  test('survives save and reopen', () => {
    const host = open(docx(p('one') + p('two')));
    const body = bodyOf(host);
    const list = paragraphsOf(host, body);
    host.execute({ operations: [{ op: 'deleteParagraph', paragraph: list[0]! }] });
    const reopened = reopen(host);
    expect(paragraphTexts(reopened.host, reopened.body)).toEqual(['two']);
  });
});

describe('a batch is one transaction, or it is nothing', () => {
  test('a refused command leaves every earlier command unwritten', () => {
    const host = open(docx(p('one') + p('two')));
    const body = bodyOf(host);
    const list = paragraphsOf(host, body);
    const response = host.execute({
      operations: [
        { op: 'insertText', at: { paragraph: list[0]!, offset: 0 }, text: 'X' },
        { op: 'insertText', at: { paragraph: list[1]!, offset: 99 }, text: 'Y' },
      ],
    });
    expect(response.ok).toBe(false);
    expect(response.changed).toBe(false);
    expect(paragraphTexts(host, body)).toEqual(['one', 'two']);
  });

  test('several commands commit as one revision and one change event', () => {
    const host = open(docx(p('one') + p('two') + p('three')));
    const body = bodyOf(host);
    const list = paragraphsOf(host, body);
    const events: number[] = [];
    host.subscribe((event) => events.push(event.revision));
    const before = host.revision();
    const response = host.execute({
      operations: [
        { op: 'insertText', at: { paragraph: list[0]!, offset: 0 }, text: 'A' },
        { op: 'insertText', at: { paragraph: list[1]!, offset: 0 }, text: 'B' },
        { op: 'insertParagraph', anchor: { paragraph: list[2]! }, where: 'after', text: 'C' },
      ],
    });
    expect(response.ok).toBe(true);
    expect(host.revision()).toBe(before + 1);
    expect(events).toHaveLength(1);
    expect(paragraphTexts(host, body)).toEqual(['Aone', 'Btwo', 'three', 'C']);
  });

  test('writing into a paragraph and inserting one beside it in the same batch is refused', () => {
    // Both are expressed as ops on the same paragraph, so the text write moves the offset the
    // split was planned at. Refusing is the only answer that is not a coin toss; the caller
    // sequences them across two syncs and gets exactly what it asked for.
    const host = open(docx(p('two')));
    const body = bodyOf(host);
    const list = paragraphsOf(host, body);
    const response = host.execute({
      operations: [
        { op: 'insertText', at: { paragraph: list[0]!, offset: 3 }, text: '!' },
        { op: 'insertParagraph', anchor: { paragraph: list[0]! }, where: 'after', text: 'three' },
      ],
    });
    expect(errorAt(response, 1)).toBe('conflicting-operations');
    expect(paragraphTexts(host, body)).toEqual(['two']);
  });

  test('restructuring a paragraph and writing into it in one batch is refused', () => {
    const host = open(docx(p('one')));
    const body = bodyOf(host);
    const list = paragraphsOf(host, body);
    const response = host.execute({
      operations: [
        { op: 'splitParagraph', paragraph: list[0]!, delimiters: ['n'] },
        { op: 'insertText', at: { paragraph: list[0]!, offset: 0 }, text: 'X' },
      ],
    });
    expect(errorAt(response, 1)).toBe('conflicting-operations');
    expect(paragraphTexts(host, body)).toEqual(['one']);
  });

  test('a query in the same batch answers the state as of its start', () => {
    const host = open(docx(p('one')));
    const body = bodyOf(host);
    const list = paragraphsOf(host, body);
    const response = host.execute({
      operations: [
        { op: 'insertText', at: { paragraph: list[0]!, offset: 0 }, text: 'X' },
        { op: 'getText', target: list[0]! },
      ],
    });
    expect(textAt(response, 1)).toBe('one');
    expect(paragraphTexts(host, body)).toEqual(['Xone']);
  });
});

describe('selection is a capability, not an approximation', () => {
  test('a headless host refuses to move a caret it does not have', () => {
    const host = open(docx(p('alpha')));
    const body = bodyOf(host);
    const list = paragraphsOf(host, body);
    const response = host.execute({
      operations: [
        {
          op: 'selectSpan',
          span: {
            start: { paragraph: list[0]!, offset: 0 },
            end: { paragraph: list[0]!, offset: 3 },
          },
          mode: 'select',
        },
      ],
    });
    expect(refusal(response)).toBe('unsupported-capability');
  });
});

function bodyOf(host: ReturnType<typeof open>): AutomationHandle {
  const document = handleAt(host.execute({ operations: [{ op: 'getDocument' }] }), 0);
  return handleAt(host.execute({ operations: [{ op: 'getBody', document }] }), 0);
}
