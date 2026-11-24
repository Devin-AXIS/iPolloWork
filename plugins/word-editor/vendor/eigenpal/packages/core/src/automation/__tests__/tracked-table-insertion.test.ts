// A table inserted as a suggestion. Rejecting it must give back the document as it was, so the
// only markup is the table's own: an inserted marker on each row, on each cell's paragraph
// mark, and around the cell text. A table placed after a paragraph that has a next paragraph
// goes in front of that one and changes no paragraph mark around it.

import { describe, expect, test } from 'bun:test';
import type { AutomationHandle, AutomationHost } from '../protocol.ts';
import {
  docx,
  handleAt,
  handlesAt,
  open,
  p,
  reopen,
  roots,
  savedMainXml,
  textAt,
} from './support/protocol.ts';

const STYLES =
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>' +
  '<w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>';
const heading = (text: string) =>
  `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const TEXTS = ['Alpha heading', 'Alpha body one.', 'Alpha body two.', 'Beta body last.'];
const SOURCE = docx(
  heading(TEXTS[0]!) + p(TEXTS[1]!) + p(TEXTS[2]!) + p(TEXTS[3]!) + '<w:sectPr/>',
  STYLES
);

function paragraphTexts(host: AutomationHost, body: AutomationHandle): string[] {
  const paragraphs = handlesAt(host.execute({ operations: [{ op: 'getParagraphs', body }] }), 0);
  const response = host.execute({
    operations: paragraphs.map((target) => ({ op: 'getText', target }) as const),
  });
  return paragraphs.map((_, index) => textAt(response, index));
}

function insertTable(index: number, tracked: boolean): AutomationHost {
  const host = open(SOURCE);
  const { body } = roots(host);
  const paragraphs = handlesAt(host.execute({ operations: [{ op: 'getParagraphs', body }] }), 0);
  const response = host.execute({
    operations: [
      ...(tracked
        ? [{ op: 'setChangeTrackingMode', mode: 'TrackMineOnly', author: 'Reviewer' } as const]
        : []),
      {
        op: 'insertTable',
        span: { paragraph: paragraphs[index]! },
        location: 'After',
        rowCount: 2,
        columnCount: 2,
        values: [
          ['A', 'B'],
          ['C', 'D'],
        ],
      },
    ],
  });
  expect(response.ok).toBe(true);
  handleAt(response, tracked ? 1 : 0);
  return host;
}

describe('a table inserted as a suggestion after a paragraph', () => {
  for (const [label, index] of [
    ['a heading', 0],
    ['a body paragraph', 1],
  ] as const) {
    test(`after ${label}, marks only the table`, () => {
      const xml = savedMainXml(insertTable(index, true));
      const table = xml.slice(xml.indexOf('<w:tbl>'), xml.indexOf('</w:tbl>'));
      const outside = xml.replace(table, '');
      // No paragraph mark outside the table changed, and no empty paragraph was added.
      expect(outside).not.toContain('<w:ins ');
      expect(xml.match(/<w:p[ >]/g)).toHaveLength(TEXTS.length + 4);
      expect(table).not.toContain('<w:cellIns');
      expect(table.match(/<w:trPr><w:ins /g)).toHaveLength(2);
      expect(table.match(/<w:pPr><w:rPr><w:ins /g)).toHaveLength(4);
      expect(table.match(/<w:ins [^>]*><w:r><w:t>[ABCD]<\/w:t><\/w:r><\/w:ins>/g)).toHaveLength(4);
    });
  }

  test('after the last paragraph, adds the paragraph that has to follow a table', () => {
    const xml = savedMainXml(insertTable(3, true));
    // The text keeps the inserted mark and the original mark moves to the paragraph after the
    // table, so rejecting the table joins the text with that empty paragraph.
    expect(xml).toMatch(/<w:pPr><w:rPr><w:ins [^>]*\/><\/w:rPr><\/w:pPr><w:r><w:t>Beta body last/);
    expect(xml).toMatch(/<\/w:tbl><w:p [^>]*\/><w:sectPr/);
    expect(xml).not.toContain('<w:cellIns');
  });

  for (const index of [0, 1, 3]) {
    test(`rejecting all changes gives back the document, anchor ${index}`, () => {
      const { host, body } = reopen(insertTable(index, true));
      expect(
        handlesAt(host.execute({ operations: [{ op: 'getRevisions', body }] }), 0).length
      ).toBeGreaterThan(0);
      expect(host.execute({ operations: [{ op: 'rejectAllRevisions', body }] }).ok).toBe(true);
      const after = reopen(host);
      expect(paragraphTexts(after.host, after.body)).toEqual(TEXTS);
      expect(savedMainXml(after.host)).not.toContain('<w:tbl>');
    });

    test(`accepting all changes keeps the table, anchor ${index}`, () => {
      const { host, body } = reopen(insertTable(index, true));
      expect(host.execute({ operations: [{ op: 'acceptAllRevisions', body }] }).ok).toBe(true);
      const after = reopen(host);
      const xml = savedMainXml(after.host);
      expect(xml).toContain('<w:tbl>');
      expect(xml).not.toMatch(/<w:(ins|del|cellIns) /);
      const texts = paragraphTexts(after.host, after.body);
      for (const text of [...TEXTS, 'A', 'B', 'C', 'D']) expect(texts).toContain(text);
    });
  }
});

describe('a table inserted after a paragraph without tracking', () => {
  test('adds no empty paragraph when a paragraph follows', () => {
    const xml = savedMainXml(insertTable(1, false));
    expect(xml).toMatch(/Alpha body one\.<\/w:t><\/w:r><\/w:p><w:tbl>/);
    expect(xml).toMatch(/<\/w:tbl><w:p[^>]*><w:r><w:t>Alpha body two/);
  });
});

describe('where a table goes beside paragraph edges', () => {
  /** Inserts a 1x1 table at `location` of the paragraph at `index`, tracked, and saves. */
  function placed(body: string, index: number, location: 'Before' | 'After'): string {
    const host = open(docx(body + '<w:sectPr/>'));
    const story = roots(host).body;
    const paragraphs = handlesAt(
      host.execute({ operations: [{ op: 'getParagraphs', body: story }] }),
      0
    );
    const response = host.execute({
      operations: [
        { op: 'setChangeTrackingMode', mode: 'TrackMineOnly', author: 'Reviewer' },
        {
          op: 'insertTable',
          span: { paragraph: paragraphs[index]! },
          location,
          rowCount: 1,
          columnCount: 1,
        },
      ],
    });
    expect(response.ok).toBe(true);
    return savedMainXml(host);
  }

  test('Before an empty paragraph stays before it', () => {
    const xml = placed(p('One') + '<w:p/>' + p('Three'), 1, 'Before');
    expect(xml).toMatch(
      /One<\/w:t><\/w:r><\/w:p><w:tbl>[\s\S]*<\/w:tbl><w:p[^>]*\/><w:p[^>]*><w:r><w:t>Three/
    );
  });

  test('After a paragraph that ends a section keeps the table in that section', () => {
    const sectioned =
      '<w:p><w:pPr><w:sectPr><w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/></w:sectPr>' +
      '</w:pPr><w:r><w:t>One</w:t></w:r></w:p>';
    const xml = placed(sectioned + p('Two'), 0, 'After');
    // The table sits before the paragraph mark that carries the landscape section.
    expect(xml.indexOf('<w:tbl>')).toBeLessThan(xml.indexOf('w:orient="landscape"'));
  });

  test('After a paragraph followed by a bookmark end changes no paragraph mark', () => {
    const xml = placed(
      '<w:bookmarkStart w:id="1" w:name="mark"/>' +
        p('One') +
        '<w:bookmarkEnd w:id="1"/>' +
        p('Two'),
      0,
      'After'
    );
    expect(xml.replace(/<w:tbl>[\s\S]*<\/w:tbl>/, '')).not.toContain('<w:ins ');
    expect(xml).toMatch(/<w:bookmarkEnd [^>]*\/><w:tbl>/);
  });

  test('After the last paragraph of a permission range keeps the table inside it', () => {
    const xml = placed(
      '<w:permStart w:id="1" w:edGrp="everyone"/>' + p('One') + '<w:permEnd w:id="1"/>' + p('Two'),
      0,
      'After'
    );
    expect(xml.indexOf('<w:tbl>')).toBeLessThan(xml.indexOf('<w:permEnd'));
  });

  test("After a paragraph whose mark is another author's pending deletion keeps the text out of the table", () => {
    const marked =
      '<w:p><w:pPr><w:rPr><w:del w:id="5" w:author="Other" w:date="2026-01-01T00:00:00Z"/>' +
      '</w:rPr></w:pPr><w:r><w:t>One</w:t></w:r></w:p>';
    const host = open(docx(marked + p('Two') + '<w:sectPr/>'));
    const { body } = roots(host);
    const paragraphs = handlesAt(host.execute({ operations: [{ op: 'getParagraphs', body }] }), 0);
    expect(
      host.execute({
        operations: [
          { op: 'setChangeTrackingMode', mode: 'TrackMineOnly', author: 'Reviewer' },
          {
            op: 'insertTable',
            span: { paragraph: paragraphs[0]! },
            location: 'After',
            rowCount: 1,
            columnCount: 1,
          },
        ],
      }).ok
    ).toBe(true);
    for (const accept of [true, false]) {
      const { host: copy, body: copyBody } = reopen(host);
      const decision = accept
        ? ({ op: 'acceptAllRevisions', body: copyBody } as const)
        : ({ op: 'rejectAllRevisions', body: copyBody } as const);
      expect(copy.execute({ operations: [decision] }).ok).toBe(true);
      const xml = savedMainXml(copy);
      const table = xml.match(/<w:tbl>[\s\S]*<\/w:tbl>/)?.[0] ?? '';
      expect(table).not.toContain('One');
      expect(xml).toContain('One');
    }
  });

  test('After a paragraph followed by a bookmark start keeps the table out of the bookmark', () => {
    const xml = placed(
      p('One') +
        '<w:bookmarkStart w:id="1" w:name="mark"/>' +
        p('Two') +
        '<w:bookmarkEnd w:id="1"/>',
      0,
      'After'
    );
    expect(xml.indexOf('<w:tbl>')).toBeLessThan(xml.indexOf('<w:bookmarkStart'));
  });
});
