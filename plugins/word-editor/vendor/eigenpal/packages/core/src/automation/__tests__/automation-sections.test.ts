// Sections, page setup, and the stories that are not the body.
//
// A DOCUMENT IS NOT ONE STORY, and these are the tests that hold that open. A header is a story
// of its own, in its own part, committing through its own transaction scope; a footnote is one
// story per note in a shared part. The assertions are therefore about which paragraphs an
// operation reached — and, where an edit happened, about the saved package, because a write that
// reads back in the session that made it but does not survive the serializer has been applied to
// a picture of a document rather than to one.

import { describe, expect, test } from 'bun:test';
import {
  docx,
  errorAt,
  handleAt,
  handlesAt,
  open,
  p,
  paragraphTexts,
  pWithSection,
  refusal,
  savedMainXml,
  textAt,
} from './support/protocol.ts';
import {
  footerPart,
  furnitureRef,
  headerPart,
  noteReference,
  notesPart,
  REL_TYPES,
  richDocx,
  sectionProperties,
} from './support/furniture.ts';
import type { AutomationHandle, AutomationHost } from '../protocol.ts';

/** A one-section document whose section declares a default header and footer. */
function withFurniture(): AutomationHost {
  return open(
    richDocx({
      body:
        p('body text') +
        sectionProperties([
          furnitureRef('header', 'rId10', 'default'),
          furnitureRef('footer', 'rId11', 'default'),
        ]),
      rels: [
        { id: 'rId10', type: REL_TYPES.header, target: 'header1.xml' },
        { id: 'rId11', type: REL_TYPES.footer, target: 'footer1.xml' },
      ],
      parts: [
        headerPart('word/header1.xml', p('running head')),
        footerPart('word/footer1.xml', p('page foot')),
      ],
    })
  );
}

/** A document with two footnotes, reached from the body by their references. */
function withFootnotes(): AutomationHost {
  return open(
    richDocx({
      body:
        `<w:p><w:r><w:t>first</w:t></w:r>${noteReference('footnote', 2)}</w:p>` +
        `<w:p><w:r><w:t>second</w:t></w:r>${noteReference('footnote', 3)}</w:p>` +
        sectionProperties([]),
      rels: [{ id: 'rId20', type: REL_TYPES.footnotes, target: 'footnotes.xml' }],
      parts: [
        notesPart('footnote', [
          { id: 2, text: 'the first note' },
          { id: 3, text: 'the second note' },
        ]),
      ],
    })
  );
}

function documentOf(host: AutomationHost): AutomationHandle {
  return handleAt(host.execute({ operations: [{ op: 'getDocument' }] }), 0);
}

function sectionsOf(host: AutomationHost): readonly AutomationHandle[] {
  return handlesAt(
    host.execute({ operations: [{ op: 'getSections', document: documentOf(host) }] }),
    0
  );
}

function pageSetupOf(host: AutomationHost, section: AutomationHandle) {
  const result = host.execute({ operations: [{ op: 'getPageSetup', section }] }).results[0];
  if (result?.status !== 'ok' || result.value.kind !== 'pageSetup') {
    throw new Error(`expected page setup: ${JSON.stringify(result)}`);
  }
  return result.value.setup;
}

describe('the sections of a document', () => {
  test('a document nobody sectioned still has one, because a body-level w:sectPr governs it', () => {
    const host = open(docx(p('alpha')));
    expect(sectionsOf(host)).toHaveLength(1);
  });

  test('a paragraph mark carrying section properties ends a section, so there are two', () => {
    const host = open(docx(pWithSection('first') + p('second')));
    expect(sectionsOf(host)).toHaveLength(2);
  });

  test('are the same handles when asked twice, so a proxy survives across batches', () => {
    const host = open(docx(pWithSection('first') + p('second')));
    expect(sectionsOf(host).map((handle) => handle.ref)).toEqual(
      sectionsOf(host).map((handle) => handle.ref)
    );
  });
});

describe('page setup', () => {
  test('reads the page and its margins in points, from the twips the file states', () => {
    const host = withFurniture();
    const [section] = sectionsOf(host) as [AutomationHandle];
    const setup = pageSetupOf(host, section);
    // 11906 x 16838 twips is A4; 1440 twips is one inch.
    expect([setup.pageWidth, setup.pageHeight]).toEqual([595.3, 841.9]);
    expect(setup.orientation).toBe('portrait');
    expect([setup.topMargin, setup.rightMargin, setup.bottomMargin, setup.leftMargin]).toEqual([
      72, 72, 72, 72,
    ]);
  });

  test('answers the orientation the dimensions describe, not the one w:orient claims', () => {
    // `w:orient` is advisory: the size paginates. A file claiming portrait on a landscape page
    // renders landscape, and reporting its claim would describe a document nobody sees.
    const host = open(
      richDocx({
        body:
          p('wide') + `<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="portrait"/></w:sectPr>`,
      })
    );
    const [section] = sectionsOf(host) as [AutomationHandle];
    expect(pageSetupOf(host, section).orientation).toBe('landscape');
  });

  test('writes a margin, and the document keeps it across save and reopen', () => {
    const host = withFurniture();
    const [section] = sectionsOf(host) as [AutomationHandle];
    const response = host.execute({
      operations: [{ op: 'setPageSetup', section, setup: { leftMargin: 36 } }],
    });
    expect(response.ok).toBe(true);
    expect(pageSetupOf(host, section).leftMargin).toBe(36);
    expect(savedMainXml(host)).toContain('w:left="720"');

    const reopened = open(
      (() => {
        const saved = host.save();
        if (!saved.ok) throw new Error('save refused');
        return saved.bytes;
      })()
    );
    const [again] = sectionsOf(reopened) as [AutomationHandle];
    expect(pageSetupOf(reopened, again).leftMargin).toBe(36);
  });

  test('writes only the section it names, leaving the other one as it was', () => {
    const host = open(docx(pWithSection('first') + p('second')));
    const sections = sectionsOf(host);
    host.execute({
      operations: [{ op: 'setPageSetup', section: sections[1]!, setup: { topMargin: 18 } }],
    });
    expect(pageSetupOf(host, sections[1]!).topMargin).toBe(18);
    expect(pageSetupOf(host, sections[0]!).topMargin).not.toBe(18);
  });

  test('turning the page sideways swaps the dimensions rather than only setting a flag', () => {
    const host = withFurniture();
    const [section] = sectionsOf(host) as [AutomationHandle];
    host.execute({
      operations: [{ op: 'setPageSetup', section, setup: { orientation: 'landscape' } }],
    });
    const setup = pageSetupOf(host, section);
    expect(setup.pageWidth).toBeGreaterThan(setup.pageHeight);
    expect(setup.orientation).toBe('landscape');
  });

  test('refuses a page size no page can be, rather than clamping it silently', () => {
    const host = withFurniture();
    const [section] = sectionsOf(host) as [AutomationHandle];
    for (const setup of [
      { pageWidth: -1 },
      { pageWidth: 0 },
      { pageHeight: Number.POSITIVE_INFINITY },
      { pageWidth: 1_000_000 },
      { topMargin: Number.NaN },
    ]) {
      expect(refusal(host.execute({ operations: [{ op: 'setPageSetup', section, setup }] }))).toBe(
        'unsupported-content'
      );
    }
    // And the document is exactly as it was.
    expect(pageSetupOf(host, section).pageWidth).toBe(595.3);
  });

  test('a setup naming nothing at all is refused rather than committing an empty transaction', () => {
    const host = withFurniture();
    const [section] = sectionsOf(host) as [AutomationHandle];
    expect(
      refusal(host.execute({ operations: [{ op: 'setPageSetup', section, setup: {} }] }))
    ).toBe('unsupported-content');
  });
});

describe('a header is a story of its own', () => {
  test('answers a body whose paragraphs are the header part\u2019s, not the document\u2019s', () => {
    const host = withFurniture();
    const [section] = sectionsOf(host) as [AutomationHandle];
    const header = handleAt(
      host.execute({
        operations: [{ op: 'getFurniture', section, kind: 'header', variant: 'default' }],
      }),
      0
    );
    expect(paragraphTexts(host, header)).toEqual(['running head']);
  });

  test('and a footer likewise', () => {
    const host = withFurniture();
    const [section] = sectionsOf(host) as [AutomationHandle];
    const footer = handleAt(
      host.execute({
        operations: [{ op: 'getFurniture', section, kind: 'footer', variant: 'default' }],
      }),
      0
    );
    expect(paragraphTexts(host, footer)).toEqual(['page foot']);
  });

  test('an absent variant reads as an empty virtual body without creating a part', () => {
    const host = withFurniture();
    const before = host.save();
    const [section] = sectionsOf(host) as [AutomationHandle];
    const header = handleAt(
      host.execute({
        operations: [{ op: 'getFurniture', section, kind: 'header', variant: 'first' }],
      }),
      0
    );
    expect(textAt(host.execute({ operations: [{ op: 'getText', target: header }] }), 0)).toBe('');
    expect(paragraphTexts(host, header)).toEqual([]);
    expect(host.save()).toEqual(before);
  });

  test('text written into a header lands in the header part and survives save and reopen', () => {
    const host = withFurniture();
    const [section] = sectionsOf(host) as [AutomationHandle];
    const header = handleAt(
      host.execute({
        operations: [{ op: 'getFurniture', section, kind: 'header', variant: 'default' }],
      }),
      0
    );
    const [paragraph] = handlesAt(
      host.execute({ operations: [{ op: 'getParagraphs', body: header }] }),
      0
    ) as [AutomationHandle];

    const response = host.execute({
      operations: [{ op: 'insertText', at: { paragraph, offset: 0 }, text: 'NEW ' }],
    });
    expect(response.ok).toBe(true);
    expect(paragraphTexts(host, header)).toEqual(['NEW running head']);
    // The BODY is untouched: a header write that reached the body would be the failure that
    // makes story identity worth carrying at all.
    expect(savedMainXml(host)).not.toContain('NEW');

    const saved = host.save();
    if (!saved.ok) throw new Error('save refused');
    const reopened = open(saved.bytes);
    const [again] = sectionsOf(reopened) as [AutomationHandle];
    const header2 = handleAt(
      reopened.execute({
        operations: [{ op: 'getFurniture', section: again, kind: 'header', variant: 'default' }],
      }),
      0
    );
    expect(paragraphTexts(reopened, header2)).toEqual(['NEW running head']);
  });

  test('one batch writing into the body and into a header is refused, because a batch is one transaction', () => {
    const host = withFurniture();
    const [section] = sectionsOf(host) as [AutomationHandle];
    const header = handleAt(
      host.execute({
        operations: [{ op: 'getFurniture', section, kind: 'header', variant: 'default' }],
      }),
      0
    );
    const [inHeader] = handlesAt(
      host.execute({ operations: [{ op: 'getParagraphs', body: header }] }),
      0
    ) as [AutomationHandle];
    const document = documentOf(host);
    const body = handleAt(host.execute({ operations: [{ op: 'getBody', document }] }), 0);
    const [inBody] = handlesAt(
      host.execute({ operations: [{ op: 'getParagraphs', body }] }),
      0
    ) as [AutomationHandle];

    const response = host.execute({
      operations: [
        { op: 'insertText', at: { paragraph: inBody, offset: 0 }, text: 'B' },
        { op: 'insertText', at: { paragraph: inHeader, offset: 0 }, text: 'H' },
      ],
    });
    expect(errorAt(response, 1)).toBe('conflicting-operations');
    expect(paragraphTexts(host, body)).toEqual(['body text']);
    expect(paragraphTexts(host, header)).toEqual(['running head']);
  });

  test('a span with one end in the body and one in a header is not a stretch of any document', () => {
    const host = withFurniture();
    const [section] = sectionsOf(host) as [AutomationHandle];
    const header = handleAt(
      host.execute({
        operations: [{ op: 'getFurniture', section, kind: 'header', variant: 'default' }],
      }),
      0
    );
    const [inHeader] = handlesAt(
      host.execute({ operations: [{ op: 'getParagraphs', body: header }] }),
      0
    ) as [AutomationHandle];
    const body = handleAt(
      host.execute({ operations: [{ op: 'getBody', document: documentOf(host) }] }),
      0
    );
    const [inBody] = handlesAt(
      host.execute({ operations: [{ op: 'getParagraphs', body }] }),
      0
    ) as [AutomationHandle];
    expect(
      errorAt(
        host.execute({
          operations: [
            {
              op: 'getSpanText',
              span: {
                start: { paragraph: inBody, offset: 0 },
                end: { paragraph: inHeader, offset: 1 },
              },
            },
          ],
        }),
        0
      )
    ).toBe('invalid-handle');
  });
});

describe('a footnote is a story too', () => {
  test('the document lists its notes, and each one answers its own body', () => {
    const host = withFootnotes();
    const notes = handlesAt(
      host.execute({
        operations: [{ op: 'getNotes', document: documentOf(host), noteKind: 'footnote' }],
      }),
      0
    );
    expect(notes).toHaveLength(2);
    const bodies = notes.map((note) =>
      handleAt(host.execute({ operations: [{ op: 'getNoteBody', note }] }), 0)
    );
    expect(bodies.map((body) => paragraphTexts(host, body))).toEqual([
      ['the first note'],
      ['the second note'],
    ]);
  });

  test('a note text read is exactly its body text without an intermediate body handle', () => {
    const host = withFootnotes();
    const notes = handlesAt(
      host.execute({
        operations: [{ op: 'getNotes', document: documentOf(host), noteKind: 'footnote' }],
      }),
      0
    );
    const direct = notes.map((note) =>
      textAt(host.execute({ operations: [{ op: 'getNoteText', note }] }), 0)
    );
    const throughBody = notes.map((note) => {
      const body = handleAt(host.execute({ operations: [{ op: 'getNoteBody', note }] }), 0);
      return textAt(host.execute({ operations: [{ op: 'getText', target: body }] }), 0);
    });
    expect(direct).toEqual(throughBody);
  });

  test('the reserved separators are not notes a caller can reach', () => {
    // `w:id="-1"` and `w:id="0"` are the separator and continuation-separator Word writes into
    // every notes part. Listing them would report a document with two more footnotes than it has.
    const host = withFootnotes();
    const notes = handlesAt(
      host.execute({
        operations: [{ op: 'getNotes', document: documentOf(host), noteKind: 'footnote' }],
      }),
      0
    );
    expect(notes).toHaveLength(2);
  });

  test('a note says which kind it is', () => {
    const host = withFootnotes();
    const [note] = handlesAt(
      host.execute({
        operations: [{ op: 'getNotes', document: documentOf(host), noteKind: 'footnote' }],
      }),
      0
    ) as [AutomationHandle];
    expect(textAt(host.execute({ operations: [{ op: 'getNoteKind', note }] }), 0)).toBe('footnote');
  });

  test('a document with no notes of that kind answers none rather than refusing', () => {
    const host = open(docx(p('alpha')));
    expect(
      handlesAt(
        host.execute({
          operations: [{ op: 'getNotes', document: documentOf(host), noteKind: 'endnote' }],
        }),
        0
      )
    ).toHaveLength(0);
  });

  test('text written into a note body lands in the notes part and survives save and reopen', () => {
    const host = withFootnotes();
    const [note] = handlesAt(
      host.execute({
        operations: [{ op: 'getNotes', document: documentOf(host), noteKind: 'footnote' }],
      }),
      0
    ) as [AutomationHandle];
    const noteBody = handleAt(host.execute({ operations: [{ op: 'getNoteBody', note }] }), 0);
    const [paragraph] = handlesAt(
      host.execute({ operations: [{ op: 'getParagraphs', body: noteBody }] }),
      0
    ) as [AutomationHandle];
    const response = host.execute({
      operations: [{ op: 'insertText', at: { paragraph, offset: 0 }, text: 'edited ' }],
    });
    expect(response.ok).toBe(true);
    expect(paragraphTexts(host, noteBody)).toEqual(['edited the first note']);

    const saved = host.save();
    if (!saved.ok) throw new Error('save refused');
    const reopened = open(saved.bytes);
    const [again] = handlesAt(
      reopened.execute({
        operations: [{ op: 'getNotes', document: documentOf(reopened), noteKind: 'footnote' }],
      }),
      0
    ) as [AutomationHandle];
    const body2 = handleAt(
      reopened.execute({ operations: [{ op: 'getNoteBody', note: again }] }),
      0
    );
    expect(paragraphTexts(reopened, body2)).toEqual(['edited the first note']);
  });

  test('two notes in one part are two stories: editing one leaves the other alone', () => {
    const host = withFootnotes();
    const notes = handlesAt(
      host.execute({
        operations: [{ op: 'getNotes', document: documentOf(host), noteKind: 'footnote' }],
      }),
      0
    );
    const first = handleAt(
      host.execute({ operations: [{ op: 'getNoteBody', note: notes[0]! }] }),
      0
    );
    const second = handleAt(
      host.execute({ operations: [{ op: 'getNoteBody', note: notes[1]! }] }),
      0
    );
    const [paragraph] = handlesAt(
      host.execute({ operations: [{ op: 'getParagraphs', body: first }] }),
      0
    ) as [AutomationHandle];
    host.execute({ operations: [{ op: 'insertText', at: { paragraph, offset: 0 }, text: 'X' }] });
    expect(paragraphTexts(host, first)).toEqual(['Xthe first note']);
    expect(paragraphTexts(host, second)).toEqual(['the second note']);
  });

  test('deleting a note removes its body and the reference that reached it, in one revision', () => {
    const host = withFootnotes();
    const notes = handlesAt(
      host.execute({
        operations: [{ op: 'getNotes', document: documentOf(host), noteKind: 'footnote' }],
      }),
      0
    );
    const before = host.revision();
    const response = host.execute({ operations: [{ op: 'deleteNote', note: notes[0]! }] });
    expect(response.ok).toBe(true);
    expect(host.revision()).toBe(before + 1);
    expect(
      handlesAt(
        host.execute({
          operations: [{ op: 'getNotes', document: documentOf(host), noteKind: 'footnote' }],
        }),
        0
      )
    ).toHaveLength(1);
    expect(savedMainXml(host)).not.toContain('w:footnoteReference w:id="2"');
  });

  test('a lifecycle command shares its batch with nothing, because it is its own transaction', () => {
    const host = withFootnotes();
    const notes = handlesAt(
      host.execute({
        operations: [{ op: 'getNotes', document: documentOf(host), noteKind: 'footnote' }],
      }),
      0
    );
    const body = handleAt(
      host.execute({ operations: [{ op: 'getBody', document: documentOf(host) }] }),
      0
    );
    const [inBody] = handlesAt(
      host.execute({ operations: [{ op: 'getParagraphs', body }] }),
      0
    ) as [AutomationHandle];
    const response = host.execute({
      operations: [
        { op: 'deleteNote', note: notes[0]! },
        { op: 'insertText', at: { paragraph: inBody, offset: 0 }, text: 'X' },
      ],
    });
    expect(errorAt(response, 1)).toBe('conflicting-operations');
    // Nothing was written: not the deletion either.
    expect(
      handlesAt(
        host.execute({
          operations: [{ op: 'getNotes', document: documentOf(host), noteKind: 'footnote' }],
        }),
        0
      )
    ).toHaveLength(2);
  });

  test('a handle for a note the document no longer has is refused', () => {
    const host = withFootnotes();
    const notes = handlesAt(
      host.execute({
        operations: [{ op: 'getNotes', document: documentOf(host), noteKind: 'footnote' }],
      }),
      0
    );
    host.execute({ operations: [{ op: 'deleteNote', note: notes[0]! }] });
    expect(errorAt(host.execute({ operations: [{ op: 'getNoteBody', note: notes[0]! }] }), 0)).toBe(
      'invalid-handle'
    );
    expect(errorAt(host.execute({ operations: [{ op: 'getNoteText', note: notes[0]! }] }), 0)).toBe(
      'invalid-handle'
    );
  });
});
