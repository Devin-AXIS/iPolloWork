// Manual line breaks (`w:br`) written through the automation host: the `Line` break type and
// `\v` inside written text. Both write the same inline element the editor writes for a
// soft return, in any story, and record a tracked insertion when an author is tracking.

import { describe, expect, test } from 'bun:test';
import {
  cell,
  docx,
  errorAt,
  handleAt,
  handlesAt,
  open,
  p,
  paragraphTexts,
  reopen,
  roots,
  row,
  savedMainXml,
  savedPartBytes,
  spanAt,
  spansAt,
  table,
  textAt,
} from './support/protocol.ts';
import {
  furnitureRef,
  headerPart,
  noteReference,
  notesPart,
  REL_TYPES,
  richDocx,
  sectionProperties,
} from './support/furniture.ts';
import type { AutomationHandle, AutomationHost } from '../protocol.ts';
import type { AutomationOperation } from '../operations.ts';

const ADDRESS = 'Acme Ltd 1 Main Street';

function firstParagraph(host: AutomationHost, body: AutomationHandle): AutomationHandle {
  return handlesAt(host.execute({ operations: [{ op: 'getParagraphs', body }] }), 0)[0]!;
}

function at(paragraph: AutomationHandle, offset: number) {
  return { start: { paragraph, offset }, end: { paragraph, offset } };
}

function lineBreak(paragraph: AutomationHandle, offset: number): AutomationOperation {
  return { op: 'insertBreak', span: at(paragraph, offset), breakType: 'Line', location: 'Before' };
}

function bodyText(host: AutomationHost, body: AutomationHandle): string {
  return textAt(host.execute({ operations: [{ op: 'getText', target: body }] }), 0);
}

const TRACK = { op: 'setChangeTrackingMode', mode: 'TrackMineOnly', author: 'Agent' } as const;

describe('insertBreak Line', () => {
  test('writes one w:br at the position and survives save and reopen', () => {
    const host = open(docx(p(ADDRESS)));
    const { body } = roots(host);
    const response = host.execute({ operations: [lineBreak(firstParagraph(host, body), 9)] });
    expect(response.ok).toBe(true);
    expect(bodyText(host, body)).toBe('Acme Ltd \v1 Main Street');
    expect(savedMainXml(host)).toMatch(/<w:t[^>]*>Acme Ltd <\/w:t><w:br\/>/);
    const again = reopen(host);
    expect(bodyText(again.host, again.body)).toBe('Acme Ltd \v1 Main Street');
  });

  test('After places the break at the end of the span', () => {
    const host = open(docx(p(ADDRESS)));
    const { body } = roots(host);
    const paragraph = firstParagraph(host, body);
    const response = host.execute({
      operations: [
        {
          op: 'insertBreak',
          span: { start: { paragraph, offset: 0 }, end: { paragraph, offset: 8 } },
          breakType: 'Line',
          location: 'After',
        },
      ],
    });
    expect(response.ok).toBe(true);
    expect(bodyText(host, body)).toBe('Acme Ltd\v 1 Main Street');
  });

  test('shares one batch with edits in other paragraphs', () => {
    const host = open(docx(p(ADDRESS) + p('Signed')));
    const { body } = roots(host);
    const [first, second] = handlesAt(
      host.execute({ operations: [{ op: 'getParagraphs', body }] }),
      0
    );
    const response = host.execute({
      operations: [
        lineBreak(first!, 9),
        { op: 'insertText', at: { paragraph: second!, at: 'end' }, text: ' here' },
      ],
    });
    expect(response.ok).toBe(true);
    expect(paragraphTexts(host, body)).toEqual(['Acme Ltd \v1 Main Street', 'Signed here']);
  });

  test('writes into a table cell, a header, and a footnote', () => {
    const host = open(
      richDocx({
        body:
          table(row(cell(p('Cell one')))) +
          `<w:p><w:r><w:t>Body</w:t></w:r>${noteReference('footnote', 2)}</w:p>` +
          sectionProperties([furnitureRef('header', 'rId10', 'default')]),
        rels: [
          { id: 'rId10', type: REL_TYPES.header, target: 'header1.xml' },
          { id: 'rId20', type: REL_TYPES.footnotes, target: 'footnotes.xml' },
        ],
        parts: [
          headerPart('word/header1.xml', p('Head one')),
          notesPart('footnote', [{ id: 2, text: 'Note one' }]),
        ],
      })
    );
    const { document, body } = roots(host);
    const section = handlesAt(
      host.execute({ operations: [{ op: 'getSections', document }] }),
      0
    )[0]!;
    const header = handleAt(
      host.execute({
        operations: [{ op: 'getFurniture', section, kind: 'header', variant: 'default' }],
      }),
      0
    );
    const note = handlesAt(
      host.execute({ operations: [{ op: 'getNotes', document, noteKind: 'footnote' }] }),
      0
    )[0]!;
    const noteBody = handleAt(host.execute({ operations: [{ op: 'getNoteBody', note }] }), 0);
    const cellParagraph = firstParagraph(host, body);
    for (const [story, paragraph] of [
      [body, cellParagraph],
      [header, firstParagraph(host, header)],
      [noteBody, firstParagraph(host, noteBody)],
    ] as const) {
      const response = host.execute({ operations: [lineBreak(paragraph, 4)] });
      expect(response.ok).toBe(true);
      expect(paragraphTexts(host, story)[0]).toMatch(/^\w+\v one$/);
    }
    expect(savedPartBytes(host, 'word/header1.xml')).toContain('<w:br/>');
    expect(savedPartBytes(host, 'word/footnotes.xml')).toContain('<w:br/>');
    expect(savedMainXml(host)).toContain('<w:br/>');
  });

  test('records a tracked insertion that reject removes', () => {
    const host = open(docx(p(ADDRESS)));
    const { body } = roots(host);
    const response = host.execute({
      operations: [TRACK, lineBreak(firstParagraph(host, body), 9)],
    });
    expect(response.ok).toBe(true);
    expect(savedMainXml(host)).toMatch(
      /<w:ins [^>]*w:author="Agent"[^>]*><w:r><w:br\/><\/w:r><\/w:ins>/
    );
    const revisions = handlesAt(host.execute({ operations: [{ op: 'getRevisions', body }] }), 0);
    expect(revisions).toHaveLength(1);
    expect(
      host.execute({ operations: [{ op: 'rejectRevision', revision: revisions[0]! }] }).ok
    ).toBe(true);
    expect(bodyText(host, body)).toBe(ADDRESS);
    expect(savedMainXml(host)).not.toContain('<w:br');
  });

  test('a tracked line break over text records a replacement', () => {
    const host = open(docx(p(ADDRESS)));
    const { body } = roots(host);
    const paragraph = firstParagraph(host, body);
    const response = host.execute({
      operations: [
        TRACK,
        {
          op: 'insertBreak',
          span: { start: { paragraph, offset: 8 }, end: { paragraph, offset: 9 } },
          breakType: 'Line',
          location: 'Replace',
        },
      ],
    });
    expect(response.ok).toBe(true);
    const xml = savedMainXml(host);
    expect(xml).toContain('<w:delText xml:space="preserve"> </w:delText>');
    expect(xml).toMatch(/<w:ins [^>]*><w:r><w:br\/><\/w:r><\/w:ins>/);
  });

  test('a line break and text edits share one paragraph in one batch', () => {
    const host = open(docx(p('Name')));
    const { body } = roots(host);
    const paragraph = firstParagraph(host, body);
    const response = host.execute({
      operations: [
        { op: 'insertText', at: { paragraph, at: 'end' }, text: ' Surname' },
        {
          op: 'insertBreak',
          span: { paragraph },
          breakType: 'Line',
          location: 'After',
        },
        { op: 'insertText', at: { paragraph, offset: 0 }, text: 'Dr ' },
      ],
    });
    expect(response.ok).toBe(true);
    expect(bodyText(host, body)).toBe('Dr Name Surname\v');
  });

  test('a line break at the start of a replacement stays in the replaced link', () => {
    const host = open(
      docx(
        '<w:p><w:r><w:t xml:space="preserve">See </w:t></w:r>' +
          '<w:hyperlink w:anchor="target"><w:r><w:t>link</w:t></w:r></w:hyperlink></w:p>'
      )
    );
    const { body } = roots(host);
    const paragraph = firstParagraph(host, body);
    const response = host.execute({
      operations: [
        {
          op: 'replaceSpan',
          span: { start: { paragraph, offset: 4 }, end: { paragraph, offset: 8 } },
          text: '\vHere',
        },
      ],
    });
    expect(response.ok).toBe(true);
    expect(savedMainXml(host)).toMatch(
      /<w:hyperlink w:anchor="target"><w:r><w:br\/><w:t>Here<\/w:t><\/w:r><\/w:hyperlink>/
    );
  });

  test('a missing header is created by its first line break', () => {
    const host = open(richDocx({ body: p('Body') + sectionProperties([]), rels: [], parts: [] }));
    const { document } = roots(host);
    const section = handlesAt(
      host.execute({ operations: [{ op: 'getSections', document }] }),
      0
    )[0]!;
    const header = handleAt(
      host.execute({
        operations: [{ op: 'getFurniture', section, kind: 'header', variant: 'default' }],
      }),
      0
    );
    const response = host.execute({
      operations: [
        { op: 'insertBreak', span: { body: header }, breakType: 'Line', location: 'End' },
      ],
    });
    expect(response.ok).toBe(true);
    expect(bodyText(host, header)).toBe('\v');
  });

  test('line breaks share the element cap with hyphen characters', () => {
    const host = open(docx(p('Name')));
    const { body } = roots(host);
    const paragraph = firstParagraph(host, body);
    const before = savedMainXml(host);
    const response = host.execute({
      operations: [
        {
          op: 'insertText',
          at: { paragraph, at: 'end' },
          text: '\u001e'.repeat(4000) + '\v'.repeat(97),
        },
      ],
    });
    expect(response.ok).toBe(false);
    expect(savedMainXml(host)).toBe(before);
  });

  test('Page and section breaks are tracked, and a tracked break never replaces text', () => {
    for (const breakType of ['Page', 'SectionNext']) {
      const host = open(docx(p(ADDRESS)));
      const { body } = roots(host);
      const at9 = at(firstParagraph(host, body), 9);
      const tracked = host.execute({
        operations: [TRACK, { op: 'insertBreak', span: at9, breakType, location: 'Before' }],
      });
      expect(tracked.ok).toBe(true);
      const replace = host.execute({
        operations: [TRACK, { op: 'insertBreak', span: at9, breakType, location: 'Replace' }],
      });
      expect(replace.ok).toBe(false);
      expect(errorAt(replace, 1)).toBe('unsupported-capability');
    }
  });

  test('other break types still refuse', () => {
    const host = open(docx(p(ADDRESS)));
    const { body } = roots(host);
    for (const breakType of ['line', 'LineClearBoth', 'SectionOdd']) {
      const response = host.execute({
        operations: [
          {
            op: 'insertBreak',
            span: at(firstParagraph(host, body), 9),
            breakType,
            location: 'Before',
          },
        ],
      });
      expect(errorAt(response, 0)).toBe('unsupported-content');
    }
  });
});

describe('\\v in written text', () => {
  test('insertText writes each \\v as a w:br and answers the whole inserted span', () => {
    const host = open(docx(p('Acme Ltd')));
    const { body } = roots(host);
    const paragraph = firstParagraph(host, body);
    const response = host.execute({
      operations: [
        { op: 'insertText', at: { paragraph, at: 'end' }, text: '\v1 Main Street\vLondon' },
      ],
    });
    expect(response.ok).toBe(true);
    expect(spanAt(response, 0).end.offset - spanAt(response, 0).start.offset).toBe(21);
    expect(bodyText(host, body)).toBe('Acme Ltd\v1 Main Street\vLondon');
    expect(savedMainXml(host).match(/<w:br\/>/g)).toHaveLength(2);
  });

  test('replaceSpan writes \\v as a w:br in place of the replaced text', () => {
    const host = open(docx(p(ADDRESS)));
    const { body } = roots(host);
    const paragraph = firstParagraph(host, body);
    const response = host.execute({
      operations: [
        {
          op: 'replaceSpan',
          span: { start: { paragraph, offset: 8 }, end: { paragraph, offset: 9 } },
          text: '\v',
        },
      ],
    });
    expect(response.ok).toBe(true);
    expect(bodyText(host, body)).toBe('Acme Ltd\v1 Main Street');
  });

  test('a whole-story replacement and a new paragraph accept \\v', () => {
    const host = open(docx(p('Old')));
    const { body } = roots(host);
    const paragraph = firstParagraph(host, body);
    const response = host.execute({
      operations: [{ op: 'replaceSpan', span: { body }, text: 'A\vB' }],
    });
    expect(response.ok).toBe(true);
    const inserted = host.execute({
      operations: [{ op: 'insertParagraph', anchor: { paragraph }, where: 'after', text: 'C\vD' }],
    });
    expect(inserted.ok).toBe(true);
    expect(paragraphTexts(host, body)).toEqual(['A\vB', 'C\vD']);
  });

  test('tracked insertText records the text and its break as one insertion', () => {
    const host = open(docx(p('Acme Ltd')));
    const { body } = roots(host);
    const paragraph = firstParagraph(host, body);
    const response = host.execute({
      operations: [
        TRACK,
        { op: 'insertText', at: { paragraph, at: 'end' }, text: '\v1 Main Street' },
      ],
    });
    expect(response.ok).toBe(true);
    const xml = savedMainXml(host);
    expect(xml).toMatch(/<w:ins [^>]*><w:r><w:br\/><w:t>1 Main Street<\/w:t><\/w:r><\/w:ins>/);
    const revisions = handlesAt(host.execute({ operations: [{ op: 'getRevisions', body }] }), 0);
    expect(revisions).toHaveLength(1);
    host.execute({ operations: [{ op: 'rejectRevision', revision: revisions[0]! }] });
    expect(bodyText(host, body)).toBe('Acme Ltd');
  });

  test('form feeds and Unicode separators stay refused', () => {
    const host = open(docx(p('Acme Ltd')));
    const { body } = roots(host);
    const paragraph = firstParagraph(host, body);
    for (const text of ['a\fb', 'a\u2028b', 'a\u2029b']) {
      const response = host.execute({
        operations: [{ op: 'insertText', at: { paragraph, at: 'end' }, text }],
      });
      expect(errorAt(response, 0)).toBe('unsupported-content');
    }
    expect(bodyText(host, body)).toBe('Acme Ltd');
  });

  test('a plain-text control refuses \\v rather than writing a break into it', () => {
    const host = open(
      docx(
        '<w:p><w:sdt><w:sdtPr><w:text/></w:sdtPr><w:sdtContent>' +
          '<w:r><w:t>Name</w:t></w:r></w:sdtContent></w:sdt></w:p>'
      )
    );
    const { body } = roots(host);
    const paragraph = firstParagraph(host, body);
    const before = savedMainXml(host);
    const response = host.execute({
      operations: [
        {
          op: 'replaceSpan',
          span: { start: { paragraph, offset: 0 }, end: { paragraph, offset: 4 } },
          text: 'A\vB',
        },
      ],
    });
    expect(errorAt(response, 0)).toBe('unsupported-content');
    expect(savedMainXml(host)).toBe(before);
  });

  test('a multi-line plain-text control and a placeholder prompt accept \\v', () => {
    const host = open(
      docx(
        '<w:p><w:sdt><w:sdtPr><w:text w:multiLine="1"/></w:sdtPr><w:sdtContent>' +
          '<w:r><w:t>Name</w:t></w:r></w:sdtContent></w:sdt></w:p>' +
          '<w:p><w:sdt><w:sdtPr><w:showingPlcHdr/></w:sdtPr><w:sdtContent>' +
          '<w:r><w:t>Click here</w:t></w:r></w:sdtContent></w:sdt></w:p>'
      )
    );
    const { body } = roots(host);
    const [multi, prompt] = handlesAt(
      host.execute({ operations: [{ op: 'getParagraphs', body }] }),
      0
    );
    const response = host.execute({
      operations: [
        {
          op: 'replaceSpan',
          span: { start: { paragraph: multi!, offset: 0 }, end: { paragraph: multi!, offset: 4 } },
          text: 'A\vB',
        },
        { op: 'insertText', at: { paragraph: prompt!, offset: 0 }, text: 'C\vD' },
      ],
    });
    expect(response.ok).toBe(true);
    expect(paragraphTexts(host, body)).toEqual(['A\vB', 'C\vD']);
  });

  test('a line break into a single-line plain-text control refuses', () => {
    const host = open(
      docx(
        '<w:p><w:sdt><w:sdtPr><w:text/></w:sdtPr><w:sdtContent>' +
          '<w:r><w:t>Name</w:t></w:r></w:sdtContent></w:sdt></w:p>'
      )
    );
    const { body } = roots(host);
    const response = host.execute({ operations: [lineBreak(firstParagraph(host, body), 2)] });
    expect(errorAt(response, 0)).toBe('unsupported-content');
  });

  test('an explicit proposal writes \\v as a tracked w:br', () => {
    const host = open(docx(p(ADDRESS)));
    const { body } = roots(host);
    const paragraph = firstParagraph(host, body);
    const response = host.execute({
      operations: [
        {
          op: 'proposeReplacement',
          span: { start: { paragraph, offset: 8 }, end: { paragraph, offset: 9 } },
          text: '\v',
          author: 'Agent',
        },
      ],
    });
    expect(response.ok).toBe(true);
    const xml = savedMainXml(host);
    expect(xml).toContain('<w:delText xml:space="preserve"> </w:delText>');
    expect(xml).toMatch(/<w:ins [^>]*><w:r><w:br\/><\/w:r><\/w:ins>/);
  });

  test('control text writes keep line breaks out of single-line controls only', () => {
    const control = (properties: string, text: string) =>
      `<w:sdt><w:sdtPr>${properties}</w:sdtPr><w:sdtContent><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:sdtContent></w:sdt>`;
    const host = open(
      docx(
        control('<w:richText/>', 'Rich') +
          control('<w:text/>', 'Single') +
          control('<w:date/>', 'Date')
      )
    );
    const { body } = roots(host);
    const controls = handlesAt(
      host.execute({ operations: [{ op: 'getContentControls', scope: { body } }] }),
      0
    );
    expect(controls).toHaveLength(3);
    const write = (contentControl: AutomationHandle, op: 'insert' | 'value') =>
      host.execute({
        operations: [
          op === 'insert'
            ? { op: 'insertContentControlText', contentControl, text: '\vLine', at: 'end' }
            : {
                op: 'setContentControlValue',
                contentControl,
                value: { kind: 'text', text: 'A\vB' },
              },
        ],
      });
    expect(write(controls[0]!, 'insert').ok).toBe(true);
    expect(write(controls[0]!, 'value').ok).toBe(true);
    expect(write(controls[1]!, 'insert').ok).toBe(false);
    expect(write(controls[1]!, 'value').ok).toBe(false);
    expect(write(controls[2]!, 'insert').ok).toBe(false);
    expect(paragraphTexts(host, body)).toEqual(['A\vB', 'Single', 'Date']);
  });

  test('a paragraph inside a building-block or group control takes a line break', () => {
    const wrapped = (properties: string, text: string) =>
      `<w:sdt><w:sdtPr>${properties}</w:sdtPr><w:sdtContent>${p(text)}</w:sdtContent></w:sdt>`;
    const host = open(
      docx(
        wrapped(
          '<w:docPartObj><w:docPartGallery w:val="Page Numbers (Bottom of Page)"/></w:docPartObj>',
          'Page'
        ) + wrapped('<w:group/>', 'Form')
      )
    );
    const { body } = roots(host);
    const paragraphs = handlesAt(host.execute({ operations: [{ op: 'getParagraphs', body }] }), 0);
    const response = host.execute({
      operations: paragraphs.map((paragraph): AutomationOperation => ({
        op: 'insertBreak',
        span: { paragraph },
        breakType: 'Line',
        location: 'After',
      })),
    });
    expect(response.ok).toBe(true);
    expect(paragraphTexts(host, body)).toEqual(['Page\v', 'Form\v']);
  });
});

describe('line breaks read back as \\v', () => {
  const BLOCK =
    '<w:p><w:r><w:t>Acme Ltd</w:t><w:br/><w:t xml:space="preserve">1 Main Street</w:t></w:r></w:p>';

  test('break reads preserve UTF-16 offsets after supplementary characters', () => {
    const host = open(
      docx(
        '<w:p><w:r><w:t>😀a</w:t><w:br/><w:t>𐐀b</w:t>' +
          '<w:br w:type="column"/><w:t>c</w:t></w:r></w:p>'
      )
    );
    const { body } = roots(host);
    const paragraph = firstParagraph(host, body);
    for (const projection of ['allMarkup', 'original', 'model'] as const) {
      expect(
        textAt(host.execute({ operations: [{ op: 'getText', target: paragraph, projection }] }), 0)
      ).toBe('😀a\v𐐀b\u000ec');
    }
    const spans = spansAt(
      host.execute({ operations: [{ op: 'search', scope: { body }, text: '\v𐐀b' }] }),
      0
    );
    expect(spans).toHaveLength(1);
    expect(spans[0]!.start.offset).toBe(3);
    expect(spans[0]!.end.offset).toBe(7);
  });

  test('text read from a paragraph writes back to the same paragraph', () => {
    const host = open(docx(BLOCK));
    const { body } = roots(host);
    const before = savedMainXml(host);
    const paragraph = firstParagraph(host, body);
    for (const projection of ['allMarkup', 'original', 'model'] as const) {
      const read = textAt(
        host.execute({ operations: [{ op: 'getText', target: paragraph, projection }] }),
        0
      );
      expect(read).toBe('Acme Ltd\v1 Main Street');
    }
    const read = textAt(host.execute({ operations: [{ op: 'getText', target: paragraph }] }), 0);
    const response = host.execute({
      operations: [{ op: 'replaceSpan', span: { paragraph }, text: read }],
    });
    expect(response.ok).toBe(true);
    expect(savedMainXml(host)).toBe(before);
  });

  test('search finds a line break as \\v, and as \\n for older callers', () => {
    const host = open(docx(BLOCK));
    const { body } = roots(host);
    for (const text of ['Ltd\v1', 'Ltd\n1']) {
      const spans = spansAt(
        host.execute({ operations: [{ op: 'search', scope: { body }, text }] }),
        0
      );
      expect(spans).toHaveLength(1);
      expect(spans[0]!.end.offset - spans[0]!.start.offset).toBe(5);
    }
  });

  test('a content control reports its line breaks', () => {
    const host = open(
      docx(
        '<w:p><w:sdt><w:sdtPr><w:richText/></w:sdtPr><w:sdtContent><w:r><w:t>A</w:t><w:br/>' +
          '<w:t>B</w:t></w:r></w:sdtContent></w:sdt></w:p>'
      )
    );
    const { body } = roots(host);
    const [control] = handlesAt(
      host.execute({ operations: [{ op: 'getContentControls', scope: { body } }] }),
      0
    );
    for (const projection of ['allMarkup', 'original'] as const) {
      expect(
        textAt(
          host.execute({
            operations: [{ op: 'getContentControlText', contentControl: control!, projection }],
          }),
          0
        )
      ).toBe('A\vB');
    }
  });

  test('control values retain column breaks and refuse writing them back', () => {
    const host = open(
      docx(
        '<w:p><w:sdt><w:sdtPr><w:richText/></w:sdtPr><w:sdtContent>' +
          '<w:r><w:t>A</w:t><w:br w:type="column"/><w:t>B</w:t></w:r>' +
          '</w:sdtContent></w:sdt></w:p>'
      )
    );
    const { body } = roots(host);
    const [control] = handlesAt(
      host.execute({ operations: [{ op: 'getContentControls', scope: { body } }] }),
      0
    );
    const before = savedMainXml(host);
    for (const projection of ['allMarkup', 'original'] as const) {
      expect(
        textAt(
          host.execute({
            operations: [{ op: 'getContentControlText', contentControl: control!, projection }],
          }),
          0
        )
      ).toBe('A\u000eB');
    }
    const write = host.execute({
      operations: [
        {
          op: 'insertContentControlText',
          contentControl: control!,
          text: 'A\u000eB',
          at: 'replace',
        },
      ],
    });
    expect(write.ok).toBe(false);
    expect(savedMainXml(host)).toBe(before);
  });

  test('a column break reads as U+000E and is not written back as a line break', () => {
    const host = open(
      docx(
        '<w:p><w:r><w:t>A</w:t><w:br w:type="column"/><w:t>B</w:t><w:br/><w:t>C</w:t></w:r></w:p>'
      )
    );
    const { body } = roots(host);
    const paragraph = firstParagraph(host, body);
    const before = savedMainXml(host);
    const read = textAt(host.execute({ operations: [{ op: 'getText', target: paragraph }] }), 0);
    expect(read).toBe('A\u000eB\vC');
    const response = host.execute({
      operations: [{ op: 'replaceSpan', span: { paragraph }, text: read }],
    });
    expect(response.ok).toBe(false);
    expect(savedMainXml(host)).toBe(before);
  });

  test('a struck line break is not part of a control value', () => {
    const host = open(
      docx(
        '<w:p><w:sdt><w:sdtPr><w:richText/></w:sdtPr><w:sdtContent><w:r><w:t>a</w:t></w:r>' +
          '<w:del w:id="1" w:author="R"><w:r><w:br/></w:r></w:del><w:r><w:t>b</w:t></w:r>' +
          '</w:sdtContent></w:sdt></w:p>'
      )
    );
    const { body } = roots(host);
    const [control] = handlesAt(
      host.execute({ operations: [{ op: 'getContentControls', scope: { body } }] }),
      0
    );
    expect(
      textAt(
        host.execute({ operations: [{ op: 'getContentControlText', contentControl: control! }] }),
        0
      )
    ).toBe('ab');
  });

  test('a table cell value reports its line breaks and writes back unchanged', () => {
    const host = open(
      docx(table(row(cell('<w:p><w:r><w:t>A</w:t><w:br/><w:t>B</w:t></w:r></w:p>'))) + p('Tail'))
    );
    const { body } = roots(host);
    const [tableHandle] = handlesAt(
      host.execute({ operations: [{ op: 'getTables', scope: { body } }] }),
      0
    );
    const read = host.execute({ operations: [{ op: 'getTable', table: tableHandle! }] })
      .results[0] as unknown as { status: 'ok'; value: { table: { values: string[][] } } };
    expect(read.value.table.values).toEqual([['A\vB']]);
    const before = savedMainXml(host);
    const response = host.execute({
      operations: [
        TRACK,
        {
          op: 'updateTable',
          table: tableHandle!,
          mutation: { kind: 'values', values: [['A\vB']] },
        },
      ],
    });
    expect(response.ok).toBe(true);
    expect(savedMainXml(host)).toBe(before);
  });

  test('split finds a line break given as \\v or as \\n', () => {
    for (const delimiter of ['\v', '\n']) {
      const host = open(docx('<w:p><w:r><w:t>A</w:t><w:br/><w:t>B</w:t></w:r></w:p>'));
      const { body } = roots(host);
      const paragraph = firstParagraph(host, body);
      const response = host.execute({
        operations: [
          { op: 'splitParagraph', paragraph, delimiters: [delimiter], trimDelimiters: true },
        ],
      });
      expect(response.ok).toBe(true);
      expect(paragraphTexts(host, body)).toEqual(['A', 'B']);
    }
  });
});
