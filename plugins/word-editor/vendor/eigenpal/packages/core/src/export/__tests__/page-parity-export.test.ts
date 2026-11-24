// Blank parity sheets through the export pipeline: `w:evenAndOddHeaders` read from
// settings.xml, header parts resolved from relationships, and the notes pass kept off the
// blank sheet.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import type { SemanticLayout } from '../../layout/semantic-records.ts';
import { openDocumentForExport } from '../export-session.ts';
import { paginationSnapshotOf } from '../../automation/pagination.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml';

// Format defaults, pinned so the fixture does not take the application defaults for omitted docDefaults.
const FORMAT_DOC_DEFAULTS =
  '<w:docDefaults><w:rPrDefault><w:rPr><w:kern w:val="2"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>';

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

function sectPr(
  options: { type?: string; start?: number; notes?: string; headers?: boolean } = {}
): string {
  return (
    '<w:sectPr>' +
    (options.headers === false
      ? ''
      : '<w:headerReference w:type="default" r:id="rIdOdd"/>' +
        '<w:headerReference w:type="even" r:id="rIdEven"/>') +
    (options.type ? `<w:type w:val="${options.type}"/>` : '') +
    '<w:pgSz w:w="12240" w:h="7200"/>' +
    '<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360"/>' +
    (options.start !== undefined ? `<w:pgNumType w:start="${options.start}"/>` : '') +
    (options.notes ?? '') +
    '</w:sectPr>'
  );
}

function docx(
  body: string,
  notes: { footnote?: string; endnote?: string } = {},
  evenAndOddHeaders = '<w:evenAndOddHeaders/>'
): Uint8Array {
  const noteBody = (kind: 'footnote' | 'endnote', text: string) =>
    `<w:${kind}s xmlns:w="${W}">` +
    `<w:${kind} w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:${kind}>` +
    `<w:${kind} w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:${kind}>` +
    `<w:${kind} w:id="1">${text}</w:${kind}></w:${kind}s>`;
  // The endnote position is document-wide and settings.xml carries it; a section's own copy
  // does not move its endnotes, so a body that asks for section-end endnotes sets it here.
  const endnotePosition = body.includes('<w:pos w:val="sectEnd"/>')
    ? '<w:endnotePr><w:pos w:val="sectEnd"/></w:endnotePr>'
    : '';
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="${WML}.document.main+xml"/>` +
        `<Override PartName="/word/settings.xml" ContentType="${WML}.settings+xml"/>` +
        `<Override PartName="/word/styles.xml" ContentType="${WML}.styles+xml"/>` +
        `<Override PartName="/word/header1.xml" ContentType="${WML}.header+xml"/>` +
        `<Override PartName="/word/header2.xml" ContentType="${WML}.header+xml"/>` +
        `<Override PartName="/word/footnotes.xml" ContentType="${WML}.footnotes+xml"/>` +
        `<Override PartName="/word/endnotes.xml" ContentType="${WML}.endnotes+xml"/>` +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rDoc" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rIdS" Type="${R}/settings" Target="settings.xml"/>` +
        `<Relationship Id="rIdSt" Type="${R}/styles" Target="styles.xml"/>` +
        `<Relationship Id="rIdOdd" Type="${R}/header" Target="header1.xml"/>` +
        `<Relationship Id="rIdEven" Type="${R}/header" Target="header2.xml"/>` +
        `<Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/>` +
        `<Relationship Id="rIdEn" Type="${R}/endnotes" Target="endnotes.xml"/>` +
        '</Relationships>'
    ),
    'word/styles.xml': strToU8(`<w:styles xmlns:w="${W}">${FORMAT_DOC_DEFAULTS}</w:styles>`),
    'word/settings.xml': strToU8(
      `<w:settings xmlns:w="${W}">${evenAndOddHeaders}${endnotePosition}</w:settings>`
    ),
    'word/header1.xml': strToU8(`<w:hdr xmlns:w="${W}">${p('ODD')}</w:hdr>`),
    'word/header2.xml': strToU8(`<w:hdr xmlns:w="${W}">${p('EVEN')}</w:hdr>`),
    'word/footnotes.xml': strToU8(noteBody('footnote', notes.footnote ?? p('Note'))),
    'word/endnotes.xml': strToU8(noteBody('endnote', notes.endnote ?? p('Note'))),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

async function layoutOf(bytes: Uint8Array): Promise<SemanticLayout> {
  const opened = openDocumentForExport(bytes);
  if (!opened.ok) throw new Error(opened.reason);
  try {
    return await opened.session.layout();
  } finally {
    opened.session.dispose();
  }
}

const text = (fragments: SemanticLayout['pages'][number]['fragments']): string =>
  fragments
    .flatMap((fragment) =>
      fragment.kind === 'paragraph'
        ? fragment.lines.flatMap((line) => line.spans.map((span) => span.text))
        : []
    )
    .join('');

const ending = (body: string, sect: string) =>
  `<w:p><w:pPr>${sect}</w:pPr><w:r><w:t>${body}</w:t></w:r></w:p>`;

describe('export places blank parity sheets from the document settings', () => {
  test.each([0, 2])(
    'an even initial number %i continues to restart 1 without a blank',
    async (start) => {
      const layout = await layoutOf(
        docx(ending('First', sectPr({ start })) + p('Second') + sectPr({ start: 1 }))
      );
      expect(layout.pages.map((page) => page.parityBlank === true)).toEqual([false, false]);
      expect(text(layout.pages[1]!.fragments)).toBe('Second');
      expect(layout.pages.map((page) => page.pageFieldSource?.pageNumber)).toEqual([start, 1]);
    }
  );

  test('a restart at 1 on the second sheet gets an empty sheet in front of it', async () => {
    const layout = await layoutOf(
      docx(ending('First', sectPr({ start: 1 })) + p('Second') + sectPr({ start: 1 }))
    );
    expect(layout.pages.map((page) => page.parityBlank === true)).toEqual([false, true, false]);
    const blank = layout.pages[1]!;
    expect(blank.fragments).toHaveLength(0);
    expect(blank.header).toBeUndefined();
    expect(text(layout.pages[2]!.header?.fragments ?? [])).toBe('ODD');
    expect(text(layout.pages[2]!.fragments)).toBe('Second');
  });

  test('the settings flag applies when no section references a header or footer', async () => {
    const plain = { start: 1, headers: false };
    const layout = await layoutOf(
      docx(ending('First', sectPr(plain)) + p('Second') + sectPr(plain))
    );
    expect(layout.pages.map((page) => page.parityBlank === true)).toEqual([false, true, false]);
  });

  test('a footnote continuation skips the blank sheet', async () => {
    const long = Array.from({ length: 30 }, (_, index) => p(`Note line ${index}`)).join('');
    const layout = await layoutOf(
      docx(
        `<w:p><w:pPr>${sectPr({ start: 1 })}</w:pPr><w:r><w:t>First</w:t></w:r>` +
          '<w:r><w:footnoteReference w:id="1"/></w:r></w:p>' +
          p('Second') +
          sectPr({ start: 1 }),
        { footnote: long }
      )
    );
    const blanks = layout.pages.filter((page) => page.parityBlank);
    expect(blanks.length).toBeGreaterThan(0);
    for (const page of blanks) {
      expect(page.footnotes).toBeUndefined();
      expect(page.endnotes).toBeUndefined();
      expect(page.fragments).toHaveLength(0);
    }
  });

  const sectEnd = '<w:endnotePr><w:pos w:val="sectEnd"/></w:endnotePr>';
  const endnoteLines = (count: number) =>
    Array.from({ length: count }, (_, index) => p(`Endnote line ${index}`)).join('');
  /** Section 1 with `bodyPages` body sheets and an endnote collected at its end. */
  const firstSection = (bodyPages: 1 | 2, sect: string) =>
    '<w:p><w:r><w:t>First</w:t></w:r><w:r><w:endnoteReference w:id="1"/></w:r></w:p>' +
    (bodyPages === 2 ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : '') +
    ending('End', sect);
  const secondAt = (layout: SemanticLayout) =>
    layout.pages.findIndex((page) => text(page.fragments) === 'Second');

  function expectNotesInFront(layout: SemanticLayout): void {
    const second = secondAt(layout);
    expect(layout.pages.some((page) => page.noteStream === 'endnote-overflow')).toBe(true);
    layout.pages.forEach((page, index) => {
      if (page.endnotes) expect(index).toBeLessThan(second);
      if (page.parityBlank) {
        expect(page.endnotes).toBeUndefined();
        expect(page.header).toBeUndefined();
      }
    });
    expect(layout.pages.filter((page) => page.parityBlank).length).toBeLessThanOrEqual(1);
  }

  test.each([0, 2])('furniture follows numbering after notes from initial %i', async (start) => {
    const layout = await layoutOf(
      docx(
        firstSection(1, sectPr({ start, notes: sectEnd })) +
          p('Second') +
          sectPr({ start: 1, notes: sectEnd }),
        { endnote: endnoteLines(30) }
      )
    );
    expectNotesInFront(layout);
    for (const page of layout.pages) {
      if (page.parityBlank) continue;
      const number = page.pageFieldSource!.pageNumber;
      expect(text(page.header?.fragments ?? [])).toBe(number % 2 === 0 ? 'EVEN' : 'ODD');
    }
  });

  test.each([
    [1, 20],
    [1, 30],
    [2, 40],
  ] as const)(
    'a restart keeps its sheet parity after endnote sheets (%i body sheets, %i lines)',
    async (bodyPages, lines) => {
      const layout = await layoutOf(
        docx(
          firstSection(bodyPages, sectPr({ start: 1, notes: sectEnd })) +
            p('Second') +
            sectPr({ start: 1, notes: sectEnd }),
          { endnote: endnoteLines(lines) }
        )
      );
      expectNotesInFront(layout);
      const second = secondAt(layout);
      // Restarted page 1 on an odd physical sheet, so the odd header shows.
      expect(second % 2).toBe(0);
      expect(layout.pages[second]!.pageFieldSource?.pageNumber).toBe(1);
      expect(text(layout.pages[second]!.header?.fragments ?? [])).toBe('ODD');
      // Numbering restarts, so no sheet in front of it takes a number: at most one blank.
      expect(layout.pages[second - 2]?.parityBlank).not.toBe(true);
    }
  );

  test.each([
    [1, 20],
    [1, 30],
    [2, 40],
  ] as const)(
    'oddPage keeps an odd start number after endnote sheets (%i body sheets, %i lines)',
    async (bodyPages, lines) => {
      const layout = await layoutOf(
        docx(
          firstSection(bodyPages, sectPr({ notes: sectEnd })) +
            p('Second') +
            sectPr({ type: 'oddPage', notes: sectEnd }),
          { endnote: endnoteLines(lines) }
        )
      );
      expectNotesInFront(layout);
      const second = secondAt(layout);
      const blank = layout.pages[second - 1]!.parityBlank === true;
      const before = layout.pages[second - (blank ? 2 : 1)]!.pageFieldSource!.pageNumber;
      const number = layout.pages[second]!.pageFieldSource!.pageNumber;
      expect(number % 2).toBe(1);
      // The blank sheet takes the number in between, and only when that number is even.
      expect(number).toBe(before + (blank ? 2 : 1));
      if (blank) expect((before + 1) % 2).toBe(0);
      // Every numbered sheet counts on from the one before it.
      const numbers = layout.pages.flatMap((page) =>
        page.parityBlank ? [] : [page.pageFieldSource!.pageNumber]
      );
      for (let index = 1; index < numbers.length; index += 1) {
        expect(numbers[index]!).toBeGreaterThan(numbers[index - 1]!);
      }
    }
  );

  test('a continued section counts the endnote sheets in front of it', async () => {
    const layout = await layoutOf(
      docx(firstSection(1, sectPr({ notes: sectEnd })) + p('Second') + sectPr({ notes: sectEnd }), {
        endnote: endnoteLines(20),
      })
    );
    expect(layout.pages.map((page) => page.noteStream ?? 'body')).toEqual([
      'body',
      'endnote-overflow',
      'body',
    ]);
    expect(layout.pages.map((page) => page.pageFieldSource?.pageNumber)).toEqual([1, 2, 3]);
  });

  test.each([
    ['<w:evenAndOddHeaders/>', true],
    ['<w:evenAndOddHeaders w:val="on"/>', true],
    ['<w:evenAndOddHeaders w:val="true"/>', true],
    ['<w:evenAndOddHeaders w:val="off"/>', false],
    ['<w:evenAndOddHeaders w:val="false"/>', false],
    ['<w:evenAndOddHeaders w:val="0"/>', false],
    ['', false],
  ] as const)(
    'the settings value %p turns the restart parity sheet on: %p',
    async (setting, on) => {
      const layout = await layoutOf(
        docx(
          ending('First', sectPr({ start: 1 })) + p('Second') + sectPr({ start: 1 }),
          {},
          setting
        )
      );
      expect(layout.pages.map((page) => page.parityBlank === true)).toEqual(
        on ? [false, true, false] : [false, false]
      );
      // Every section starts on an odd sheet, so no section start shows the even header.
      expect(layout.pages.some((page) => text(page.header?.fragments ?? []) === 'EVEN')).toBe(
        false
      );
    }
  );

  test('NUMPAGES and the automation page count include the blank sheet', async () => {
    const layout = await layoutOf(
      docx(ending('First', sectPr()) + p('Second') + sectPr({ type: 'oddPage' }))
    );
    expect(layout.pages.map((page) => page.parityBlank === true)).toEqual([false, true, false]);
    expect(paginationSnapshotOf(layout).pageCount).toBe(3);
    expect(layout.pages[2]!.pageFieldSource?.pageNumber).toBe(3);
  });
});

describe('one running page number across continuous sections and note sheets', () => {
  const sectEnd = '<w:endnotePr><w:pos w:val="sectEnd"/></w:endnotePr>';
  const noteText = Array.from({ length: 40 }, (_, index) => p(`Note ${index}`)).join('');
  const bLines = (count: number) =>
    Array.from({ length: count }, (_, index) => p(`B${index}`)).join('');
  const reference = '<w:r><w:endnoteReference w:id="1"/></w:r>';

  type Notes = 'none' | 'before' | 'after';
  const cases: [number | undefined, boolean, boolean, Notes][] = [];
  for (const restart of [undefined, 4])
    for (const overflow of [false, true])
      for (const second of [false, true])
        for (const notes of ['none', 'before', 'after'] as const)
          cases.push([restart, overflow, second, notes]);

  /** A, continuous B (maybe restarted, maybe overflowing), maybe continuous C, oddPage D. */
  function body(restart: number | undefined, overflow: boolean, second: boolean, notes: Notes) {
    const tail = notes === 'before' ? sectEnd : '';
    const sect = (type: string | undefined, start?: number) =>
      sectPr({ ...(type ? { type } : {}), ...(start !== undefined ? { start } : {}), notes: tail });
    const lastOfB = `<w:p><w:pPr>${sect('continuous', restart)}</w:pPr><w:r><w:t>Bend</w:t></w:r>${
      notes === 'before' && !second ? reference : ''
    }</w:p>`;
    return (
      ending('A', sect(undefined)) +
      bLines(overflow ? 40 : 0) +
      lastOfB +
      (second
        ? `<w:p><w:pPr>${sect('continuous')}</w:pPr><w:r><w:t>C</w:t></w:r>${
            notes === 'before' ? reference : ''
          }</w:p>`
        : '') +
      `<w:p><w:r><w:t>D</w:t></w:r>${notes === 'after' ? reference : ''}</w:p>` +
      sect('oddPage')
    );
  }

  test.each(cases)(
    'B restart %p, B overflow %p, second continuous %p, note sheets %p',
    async (restart, overflow, second, notes) => {
      const layout = await layoutOf(
        docx(body(restart, overflow, second, notes), { endnote: noteText })
      );
      // The endnote mark follows D when the note is referenced there.
      const dAt = layout.pages.findIndex((page) => text(page.fragments).startsWith('D'));
      expect(dAt).toBeGreaterThan(0);
      const before = layout.pages.slice(0, dAt);
      const noteSheetsBefore = before.filter((page) => page.noteStream !== undefined).length;
      const bOverflowSheets = before.filter(
        (page) => page.noteStream === undefined && !page.parityBlank && page.index > 0
      ).length;
      expect(bOverflowSheets).toBe(overflow ? 1 : 0);
      if (notes === 'before') expect(noteSheetsBefore).toBeGreaterThan(0);
      else expect(noteSheetsBefore).toBe(0);
      if (notes === 'after') {
        expect(layout.pages.slice(dAt + 1).some((page) => page.noteStream !== undefined)).toBe(
          true
        );
      }

      // The model: A is page 1. A continuous section's host keeps the running number (or the
      // restart), its overflow sheets count on, and the next new sheet gets the one after.
      let running = 2;
      const hostB = restart ?? running - 1;
      if (overflow) expect(before[1]!.pageFieldSource?.pageNumber).toBe(hostB + 1);
      running = hostB + 1 + (overflow ? 1 : 0);
      if (second) running = running - 1 + 1;
      running += noteSheetsBefore;
      const blank = running % 2 === 0;
      const expected = blank ? running + 1 : running;

      expect(layout.pages[dAt - 1]!.parityBlank === true).toBe(blank);
      expect(layout.pages[dAt]!.pageFieldSource?.pageNumber).toBe(expected);
      expect(expected % 2).toBe(1);
      // Numbers never repeat or step back across the sheets that carry one.
      const numbers = layout.pages.flatMap((page) =>
        page.parityBlank ? [] : [page.pageFieldSource!.pageNumber]
      );
      if (restart === undefined) {
        for (let index = 1; index < numbers.length; index += 1) {
          expect(numbers[index]!).toBeGreaterThan(numbers[index - 1]!);
        }
      }
    }
  );

  test.each([false, true])(
    'a later continuous section counts on from a restart on the shared sheet (note after: %p)',
    async (noteAfter) => {
      const lines = Array.from({ length: 40 }, (_, index) => p(`C${index}`)).join('');
      const layout = await layoutOf(
        docx(
          ending('A', sectPr()) +
            ending('B', sectPr({ type: 'continuous', start: 4 })) +
            lines +
            ending('Cend', sectPr({ type: 'continuous' })) +
            `<w:p><w:r><w:t>D</w:t></w:r>${
              noteAfter ? '<w:r><w:endnoteReference w:id="1"/></w:r>' : ''
            }</w:p>` +
            sectPr(),
          { endnote: noteText }
        )
      );
      const numbers = layout.pages.map((page) =>
        page.noteStream ? `n${page.pageFieldSource?.pageNumber}` : page.pageFieldSource?.pageNumber
      );
      // Sheet 1 is A, B (restarted at 4) and the start of C; C's overflow sheet is 5, D is 6.
      expect(numbers).toEqual(noteAfter ? [1, 5, 6, 'n7'] : [1, 5, 6]);
    }
  );
});
