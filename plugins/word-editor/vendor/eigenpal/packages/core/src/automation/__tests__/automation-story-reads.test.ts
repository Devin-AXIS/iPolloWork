// What the protocol answers when an object model asks a document about itself.
//
// Reads only. Everything here is a property of the CANONICAL TREE — traversal order, offset
// vocabulary, paragraph identity, what a story's text is — and every one of them is something
// an object model would otherwise have to guess and get subtly wrong.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { documentReads } from '../reads.ts';
import { spanOffsets } from '../spans.ts';
import {
  cell,
  docx,
  open,
  p,
  pWithId,
  paragraphTexts,
  paragraphsOf,
  refusal,
  roots,
  row,
  spanAt,
  spansAt,
  storyText,
  table,
  textAt,
} from './support/protocol.ts';

describe('the paragraphs of a story', () => {
  test('are the body ones, in document order', () => {
    const host = open(docx(`${p('alpha')}${p('beta')}${p('gamma')}`));
    const { body } = roots(host);
    expect(paragraphTexts(host, body)).toEqual(['alpha', 'beta', 'gamma']);
  });

  test('include the paragraphs inside a table, in reading order', () => {
    const host = open(
      docx(
        `${p('head')}${table(row(cell(p('r1c1')), cell(p('r1c2'))), row(cell(p('r2c1'))))}${p('tail')}`
      )
    );
    const { body } = roots(host);
    expect(paragraphTexts(host, body)).toEqual(['head', 'r1c1', 'r1c2', 'r2c1', 'tail']);
  });

  test('descend into a table nested inside a cell', () => {
    const inner = table(row(cell(p('inner'))));
    const host = open(docx(`${table(row(cell(p('outer'), inner)))}${p('after')}`));
    const { body } = roots(host);
    expect(paragraphTexts(host, body)).toEqual(['outer', 'inner', 'after']);
  });

  test('include an empty paragraph, which reads as empty text rather than being skipped', () => {
    const host = open(docx(`${p('alpha')}${p('')}${p('beta')}`));
    const { body } = roots(host);
    expect(paragraphTexts(host, body)).toEqual(['alpha', '', 'beta']);
  });

  test('are none at all in a body that holds no paragraph', () => {
    const host = open(docx(''));
    const { body } = roots(host);
    expect(paragraphsOf(host, body)).toEqual([]);
    expect(storyText(host, body)).toBe('');
  });

  test('are the same handles when asked twice, so a proxy can be held across batches', () => {
    const host = open(docx(`${p('alpha')}${p('beta')}`));
    const { body } = roots(host);
    expect(paragraphsOf(host, body)).toEqual(paragraphsOf(host, body));
  });
});

describe("a story's text", () => {
  test('separates paragraphs with a carriage return, the way Word does', () => {
    const host = open(docx(`${p('alpha')}${p('beta')}`));
    const { body } = roots(host);
    expect(storyText(host, body)).toBe('alpha\rbeta');
  });

  test('includes table-cell paragraphs, in the same reading order', () => {
    const host = open(docx(`${p('head')}${table(row(cell(p('in'))))}`));
    const { body } = roots(host);
    expect(storyText(host, body)).toBe('head\rin\r');
  });
});

describe('revision text projections', () => {
  const revisions =
    '<w:p><w:r><w:t xml:space="preserve">keep </w:t></w:r>' +
    '<w:del w:id="1" w:author="Ada"><w:r><w:delText>gone</w:delText></w:r></w:del>' +
    '<w:ins w:id="2" w:author="Ada"><w:r><w:t>added</w:t></w:r></w:ins></w:p>';

  test('preserves all revision text by default and exposes the original document explicitly', () => {
    const host = open(docx(revisions));
    const { body } = roots(host);
    const paragraph = paragraphsOf(host, body)[0]!;
    const response = host.execute({
      operations: [
        { op: 'getText', target: body },
        { op: 'getText', target: body, projection: 'original' },
        { op: 'getText', target: paragraph, projection: 'original' },
      ],
    });
    expect(textAt(response, 0)).toBe('keep goneadded');
    expect(textAt(response, 1)).toBe('keep gone');
    expect(textAt(response, 2)).toBe('keep gone');
  });

  test('searches, reads, and edits through one original-view offset mapping', () => {
    const replacement =
      '<w:p><w:r><w:t xml:space="preserve">before </w:t></w:r>' +
      '<w:del w:id="1" w:author="Ada"><w:r><w:delText>old</w:delText></w:r></w:del>' +
      '<w:ins w:id="2" w:author="Ada"><w:r><w:t>new</w:t></w:r></w:ins>' +
      '<w:r><w:t xml:space="preserve"> after</w:t></w:r></w:p>';
    const host = open(docx(replacement));
    const { body } = roots(host);
    const searched = host.execute({
      operations: [
        {
          op: 'search',
          scope: { body },
          text: 'before old after',
          options: { projection: 'original' },
        },
        { op: 'search', scope: { body }, text: 'new', options: { projection: 'original' } },
      ],
    });
    const [span] = spansAt(searched, 0);
    expect(span).toBeDefined();
    expect(spansAt(searched, 1)).toEqual([]);
    expect(
      textAt(
        host.execute({
          operations: [{ op: 'getSpanText', span: span!, projection: 'original' }],
        }),
        0
      )
    ).toBe('before old after');

    expect(
      host.execute({ operations: [{ op: 'replaceSpan', span: span!, text: 'clean' }] }).ok
    ).toBe(true);
    expect(storyText(host, body)).toBe('clean');
  });

  test('refuses an unknown projection instead of silently choosing a view', () => {
    const host = open(docx(revisions));
    const { body } = roots(host);
    const response = host.execute({
      operations: [
        {
          op: 'search',
          scope: { body },
          text: 'gone',
          options: { projection: 'resolved' as 'allMarkup' },
        },
      ],
    });
    expect(refusal(response)).toBe('unsupported-content');
  });
});

describe('paragraph identity', () => {
  test("is the document's own w14:paraId when the file wrote one", () => {
    const host = open(docx(pWithId('alpha', '1A2B3C4D')));
    const { body } = roots(host);
    const [paragraph] = paragraphsOf(host, body);
    const response = host.execute({
      operations: [{ op: 'getParagraphId', paragraph: paragraph! }],
    });
    expect(textAt(response, 0)).toBe('1A2B3C4D');
  });

  test('is stable across reads and distinct between paragraphs', () => {
    const host = open(docx(`${p('alpha')}${p('beta')}`));
    const { body } = roots(host);
    const list = paragraphsOf(host, body);
    const read = () =>
      list.map((paragraph, index) =>
        textAt(
          host.execute({
            operations: list.map((h) => ({ op: 'getParagraphId' as const, paragraph: h })),
          }),
          index
        )
      );
    const first = read();
    expect(first[0]).not.toBe(first[1]);
    expect(read()).toEqual(first);
  });

  test('is never a position: deleting the paragraph before it leaves the identity alone', () => {
    const host = open(docx(`${p('alpha')}${p('beta')}`));
    const { body } = roots(host);
    const list = paragraphsOf(host, body);
    const before = textAt(
      host.execute({ operations: [{ op: 'getParagraphId', paragraph: list[1]! }] }),
      0
    );
    host.execute({ operations: [{ op: 'deleteParagraph', paragraph: list[0]! }] });
    const after = textAt(
      host.execute({ operations: [{ op: 'getParagraphId', paragraph: list[1]! }] }),
      0
    );
    expect(after).toBe(before);
  });
});

describe('a span of a story', () => {
  test('reads the characters between its endpoints inside one paragraph', () => {
    const host = open(docx(p('alphabet')));
    const { body } = roots(host);
    const [paragraph] = paragraphsOf(host, body);
    const response = host.execute({
      operations: [
        {
          op: 'getSpanText',
          span: {
            start: { paragraph: paragraph!, offset: 2 },
            end: { paragraph: paragraph!, offset: 5 },
          },
        },
      ],
    });
    expect(textAt(response, 0)).toBe('pha');
  });

  test('reads across paragraphs with a carriage return at each mark', () => {
    const host = open(docx(`${p('alpha')}${p('beta')}${p('gamma')}`));
    const { body } = roots(host);
    const list = paragraphsOf(host, body);
    const response = host.execute({
      operations: [
        {
          op: 'getSpanText',
          span: {
            start: { paragraph: list[0]!, offset: 3 },
            end: { paragraph: list[2]!, offset: 2 },
          },
        },
      ],
    });
    expect(textAt(response, 0)).toBe('ha\rbeta\rga');
  });

  test('reads the whole story when it names the body', () => {
    const host = open(docx(`${p('alpha')}${p('beta')}`));
    const { body } = roots(host);
    const response = host.execute({ operations: [{ op: 'getSpanText', span: { body } }] });
    expect(textAt(response, 0)).toBe('alpha\rbeta');
  });

  test('answers the paragraphs it covers, and no others', () => {
    const host = open(docx(`${p('alpha')}${p('beta')}${p('gamma')}`));
    const { body } = roots(host);
    const list = paragraphsOf(host, body);
    const response = host.execute({
      operations: [
        {
          op: 'getSpanParagraphs',
          span: {
            start: { paragraph: list[0]!, offset: 1 },
            end: { paragraph: list[1]!, offset: 1 },
          },
        },
      ],
    });
    const result = response.results[0];
    expect(result?.status).toBe('ok');
    if (result?.status === 'ok' && result.value.kind === 'handles') {
      expect(result.value.handles).toEqual([list[0]!, list[1]!]);
    }
  });

  test('is refused when its endpoints run backwards', () => {
    const host = open(docx(`${p('alpha')}${p('beta')}`));
    const { body } = roots(host);
    const list = paragraphsOf(host, body);
    const response = host.execute({
      operations: [
        {
          op: 'getSpanText',
          span: {
            start: { paragraph: list[1]!, offset: 0 },
            end: { paragraph: list[0]!, offset: 0 },
          },
        },
      ],
    });
    expect(refusal(response)).toBe('invalid-offset');
  });

  test('is refused when an endpoint is outside its paragraph', () => {
    const host = open(docx(p('alpha')));
    const { body } = roots(host);
    const [paragraph] = paragraphsOf(host, body);
    const response = host.execute({
      operations: [
        {
          op: 'getSpanText',
          span: {
            start: { paragraph: paragraph!, offset: 0 },
            end: { paragraph: paragraph!, offset: 99 },
          },
        },
      ],
    });
    expect(refusal(response)).toBe('invalid-offset');
  });
});

describe('UTF-16 offsets over astral and combining text', () => {
  test('a surrogate pair counts as the two code units it is', () => {
    const host = open(docx(p('a\u{1F600}b')));
    const { body } = roots(host);
    const [paragraph] = paragraphsOf(host, body);
    expect(paragraphTexts(host, body)[0]).toHaveLength(4);
    const response = host.execute({
      operations: [
        {
          op: 'getSpanText',
          span: {
            start: { paragraph: paragraph!, offset: 1 },
            end: { paragraph: paragraph!, offset: 3 },
          },
        },
      ],
    });
    expect(textAt(response, 0)).toBe('\u{1F600}');
  });

  test('an endpoint that would cut a surrogate pair in half is refused', () => {
    const host = open(docx(p('a\u{1F600}b')));
    const { body } = roots(host);
    const [paragraph] = paragraphsOf(host, body);
    const response = host.execute({
      operations: [
        {
          op: 'replaceSpan',
          span: {
            start: { paragraph: paragraph!, offset: 1 },
            end: { paragraph: paragraph!, offset: 2 },
          },
          text: '',
        },
      ],
    });
    expect(response.ok).toBe(false);
    expect(paragraphTexts(host, body)[0]).toBe('a\u{1F600}b');
  });

  test('a combining mark is its own code unit, and a span may end between base and mark', () => {
    const host = open(docx(p('e\u0301x')));
    const { body } = roots(host);
    const [paragraph] = paragraphsOf(host, body);
    const response = host.execute({
      operations: [
        {
          op: 'getSpanText',
          span: {
            start: { paragraph: paragraph!, offset: 0 },
            end: { paragraph: paragraph!, offset: 1 },
          },
        },
      ],
    });
    expect(textAt(response, 0)).toBe('e');
  });
});

describe('searching a story', () => {
  test('finds every occurrence, in reading order, as spans', () => {
    const host = open(docx(`${p('one two one')}${p('one')}`));
    const { body } = roots(host);
    const list = paragraphsOf(host, body);
    const response = host.execute({ operations: [{ op: 'search', scope: { body }, text: 'one' }] });
    const spans = spansAt(response, 0);
    expect(spans).toEqual([
      { start: { paragraph: list[0]!, offset: 0 }, end: { paragraph: list[0]!, offset: 3 } },
      { start: { paragraph: list[0]!, offset: 8 }, end: { paragraph: list[0]!, offset: 11 } },
      { start: { paragraph: list[1]!, offset: 0 }, end: { paragraph: list[1]!, offset: 3 } },
    ]);
  });

  test('finds text inside a table cell, because those paragraphs are in the story', () => {
    const host = open(docx(`${p('head')}${table(row(cell(p('needle'))))}`));
    const { body } = roots(host);
    const response = host.execute({
      operations: [{ op: 'search', scope: { body }, text: 'needle' }],
    });
    expect(spansAt(response, 0)).toHaveLength(1);
  });

  test('is case-insensitive by default and case-sensitive when asked', () => {
    const host = open(docx(p('Alpha alpha')));
    const { body } = roots(host);
    expect(
      spansAt(host.execute({ operations: [{ op: 'search', scope: { body }, text: 'alpha' }] }), 0)
    ).toHaveLength(2);
    expect(
      spansAt(
        host.execute({
          operations: [
            { op: 'search', scope: { body }, text: 'alpha', options: { matchCase: true } },
          ],
        }),
        0
      )
    ).toHaveLength(1);
  });

  test('matches whole words only when asked', () => {
    const host = open(docx(p('cat category')));
    const { body } = roots(host);
    expect(
      spansAt(
        host.execute({
          operations: [
            { op: 'search', scope: { body }, text: 'cat', options: { matchWholeWord: true } },
          ],
        }),
        0
      )
    ).toHaveLength(1);
  });

  test('counts repeated text without overlapping', () => {
    const host = open(docx(p('aaaa')));
    const { body } = roots(host);
    expect(
      spansAt(host.execute({ operations: [{ op: 'search', scope: { body }, text: 'aa' }] }), 0)
    ).toHaveLength(2);
  });

  test('stops at the result cap instead of allocating one entry per character', () => {
    const host = open(docx(p('x'.repeat(5000))));
    const { body } = roots(host);
    const spans = spansAt(
      host.execute({ operations: [{ op: 'search', scope: { body }, text: 'x' }] }),
      0
    );
    expect(spans.length).toBeLessThanOrEqual(2000);
    expect(spans.length).toBe(2000);
  });

  test('refuses an over-long query rather than scanning it', () => {
    const host = open(docx(p('alpha')));
    const { body } = roots(host);
    const response = host.execute({
      operations: [{ op: 'search', scope: { body }, text: 'x'.repeat(257) }],
    });
    expect(refusal(response)).toBe('unsupported-content');
  });

  test('refuses empty search text rather than answering that it is everywhere', () => {
    const host = open(docx(p('alpha')));
    const { body } = roots(host);
    const response = host.execute({ operations: [{ op: 'search', scope: { body }, text: '' }] });
    expect(refusal(response)).toBe('unsupported-content');
  });

  test('refuses a search option it cannot honour instead of ignoring it', () => {
    const host = open(docx(p('alpha')));
    const { body } = roots(host);
    for (const option of ['matchWildcards', 'ignorePunct', 'ignoreSpace'] as const) {
      const response = host.execute({
        operations: [{ op: 'search', scope: { body }, text: 'alpha', options: { [option]: true } }],
      });
      expect(refusal(response)).toBe('unsupported-capability');
    }
  });

  test('a search scoped to a span only looks inside it', () => {
    const host = open(docx(`${p('one two')}${p('one three')}`));
    const { body } = roots(host);
    const list = paragraphsOf(host, body);
    const response = host.execute({
      operations: [{ op: 'search', scope: { paragraph: list[1]! }, text: 'one' }],
    });
    expect(spansAt(response, 0)).toEqual([
      { start: { paragraph: list[1]!, offset: 0 }, end: { paragraph: list[1]!, offset: 3 } },
    ]);
  });

  test('a scoped search will not report a match that only partly overlaps the scope', () => {
    const host = open(docx(p('alphabet')));
    const { body } = roots(host);
    const [paragraph] = paragraphsOf(host, body);
    const scope = {
      start: { paragraph: paragraph!, offset: 0 },
      end: { paragraph: paragraph!, offset: 4 },
    };
    // 'alph' is in scope; 'alpha' runs one character past its end, so it is not a match here.
    expect(
      spansAt(host.execute({ operations: [{ op: 'search', scope, text: 'alph' }] }), 0)
    ).toHaveLength(1);
    expect(
      spansAt(host.execute({ operations: [{ op: 'search', scope, text: 'alpha' }] }), 0)
    ).toHaveLength(0);
  });

  test('a scoped search still reads word boundaries from the whole paragraph', () => {
    const host = open(docx(p('category')));
    const { body } = roots(host);
    const [paragraph] = paragraphsOf(host, body);
    // The scope ends exactly where 'cat' does, but the paragraph carries on with 'egory', so
    // 'cat' is not a whole word — a scope is a window on the text, not a truncation of it.
    const response = host.execute({
      operations: [
        {
          op: 'search',
          scope: {
            start: { paragraph: paragraph!, offset: 0 },
            end: { paragraph: paragraph!, offset: 3 },
          },
          text: 'cat',
          options: { matchWholeWord: true },
        },
      ],
    });
    expect(spansAt(response, 0)).toHaveLength(0);
  });

  test('a span a search returned reads back as the text that was searched for', () => {
    const host = open(docx(p('find me here')));
    const { body } = roots(host);
    const found = spansAt(
      host.execute({ operations: [{ op: 'search', scope: { body }, text: 'me' }] }),
      0
    );
    const response = host.execute({ operations: [{ op: 'getSpanText', span: found[0]! }] });
    expect(textAt(response, 0)).toBe('me');
  });

  test('maps a cached field result search to its one editable atom', () => {
    const field =
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:instrText xml:space="preserve"> DATE \\@ "d MMMM yyyy" </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      '<w:r><w:t>1 January 2030</w:t></w:r>' +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
    const host = open(
      docx(
        `<w:p><w:r><w:t xml:space="preserve">Renewal date: </w:t></w:r>${field}<w:r><w:t xml:space="preserve"> is synthetic.</w:t></w:r></w:p>`
      )
    );
    const { body } = roots(host);
    const [paragraph] = paragraphsOf(host, body);
    expect(paragraphTexts(host, body)).toEqual(['Renewal date: 1 January 2030 is synthetic.']);
    expect(storyText(host, body)).toBe('Renewal date: 1 January 2030 is synthetic.');
    const found = spansAt(
      host.execute({
        operations: [
          {
            op: 'search',
            scope: { body },
            text: '1 January 2030',
            options: { matchCase: true },
          },
        ],
      }),
      0
    );

    expect(found).toEqual([
      {
        start: { paragraph: paragraph!, offset: 'Renewal date: '.length },
        end: { paragraph: paragraph!, offset: 'Renewal date: '.length + 1 },
      },
    ]);
    expect(textAt(host.execute({ operations: [{ op: 'getSpanText', span: found[0]! }] }), 0)).toBe(
      '1 January 2030'
    );
  });

  test('reports repeated result text once for its one editable atom', () => {
    const field =
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:instrText> PAGE </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      '<w:r><w:t>aa aa</w:t></w:r>' +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
    const host = open(docx(`<w:p>${field}</w:p>`));
    const { body } = roots(host);
    const [paragraph] = paragraphsOf(host, body);
    const found = spansAt(
      host.execute({ operations: [{ op: 'search', scope: { body }, text: 'aa' }] }),
      0
    );

    expect(found).toEqual([
      {
        start: { paragraph: paragraph!, offset: 0 },
        end: { paragraph: paragraph!, offset: 1 },
      },
    ]);
  });

  test('offers raw field text through the model projection', () => {
    const field =
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:instrText> DATE </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      '<w:r><w:t>1 January 2030</w:t></w:r>' +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
    const host = open(docx(`<w:p><w:r><w:t>A</w:t></w:r>${field}<w:r><w:t>Z</w:t></w:r></w:p>`));
    const { body } = roots(host);
    const [paragraph] = paragraphsOf(host, body);
    const response = host.execute({
      operations: [
        { op: 'getText', target: body, projection: 'model' },
        { op: 'getText', target: paragraph!, projection: 'model' },
        { op: 'getSpanText', span: { paragraph: paragraph! }, projection: 'model' },
      ],
    });

    expect([textAt(response, 0), textAt(response, 1), textAt(response, 2)]).toEqual([
      'A\uFFFCZ',
      'A\uFFFCZ',
      'A\uFFFCZ',
    ]);
  });

  test('uses raw field offsets when deciding that a paragraph span is whole', () => {
    const field =
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:instrText> DATE </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      '<w:r><w:t>1 January 2030</w:t></w:r>' +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
    const loaded = readOoxmlPackage(
      docx(`<w:p><w:r><w:t>A</w:t></w:r>${field}<w:r><w:t>Z</w:t></w:r></w:p>`)
    );
    if (!loaded.ok) throw new Error(loaded.reason);
    const body = documentReads(loaded.package).body;
    if (!body) throw new Error('body reads missing');
    const paragraphId = body.paragraphIds[0]!;
    const point = { story: body.story, paragraphId, index: 0 };

    expect(
      spanOffsets({ start: { ...point, offset: 0 }, end: { ...point, offset: 3 } }, body)
    ).toEqual([{ paragraphId, start: 0, end: 3, whole: true }]);
  });

  test('clips field result matches against raw scope boundaries', () => {
    const field =
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:instrText> DATE </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      '<w:r><w:t>four</w:t></w:r>' +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
    const host = open(docx(`<w:p><w:r><w:t>A</w:t></w:r>${field}<w:r><w:t>Z</w:t></w:r></w:p>`));
    const { body } = roots(host);
    const [paragraph] = paragraphsOf(host, body);
    const inside = {
      start: { paragraph: paragraph!, offset: 1 },
      end: { paragraph: paragraph!, offset: 2 },
    };
    const before = {
      start: { paragraph: paragraph!, offset: 0 },
      end: { paragraph: paragraph!, offset: 1 },
    };

    expect(
      spansAt(host.execute({ operations: [{ op: 'search', scope: inside, text: 'four' }] }), 0)
    ).toEqual([inside]);
    expect(
      spansAt(host.execute({ operations: [{ op: 'search', scope: before, text: 'four' }] }), 0)
    ).toEqual([]);
  });
});

describe('a handle the document no longer has', () => {
  test('is refused rather than answered with plausible empty text', () => {
    const host = open(docx(`${p('alpha')}${p('beta')}`));
    const { body } = roots(host);
    const list = paragraphsOf(host, body);
    host.execute({ operations: [{ op: 'deleteParagraph', paragraph: list[0]! }] });
    const response = host.execute({ operations: [{ op: 'getText', target: list[0]! }] });
    expect(refusal(response)).toBe('invalid-handle');
  });

  test('cannot be written to either', () => {
    const host = open(docx(`${p('alpha')}${p('beta')}`));
    const { body } = roots(host);
    const list = paragraphsOf(host, body);
    host.execute({ operations: [{ op: 'deleteParagraph', paragraph: list[0]! }] });
    const response = host.execute({
      operations: [{ op: 'insertText', at: { paragraph: list[0]!, offset: 0 }, text: 'X' }],
    });
    expect(refusal(response)).toBe('invalid-handle');
    expect(paragraphTexts(host, body)).toEqual(['beta']);
  });

  test('a span whose paragraph is gone is refused as a whole', () => {
    const host = open(docx(`${p('alpha')}${p('beta')}`));
    const { body } = roots(host);
    const list = paragraphsOf(host, body);
    const span = spanAt(
      host.execute({
        operations: [{ op: 'insertText', at: { paragraph: list[0]!, offset: 0 }, text: '' }],
      }),
      0
    );
    host.execute({ operations: [{ op: 'deleteParagraph', paragraph: list[0]! }] });
    expect(refusal(host.execute({ operations: [{ op: 'getSpanText', span }] }))).toBe(
      'invalid-handle'
    );
  });
});
