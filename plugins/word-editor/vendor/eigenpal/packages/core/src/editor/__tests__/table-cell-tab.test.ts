// Tab in a table cell moves between cells and selects the content of the cell it reaches; Tab
// in the last cell adds a row; Option+Tab or Ctrl+Tab types a tab character. Measured in the
// reference word processor: a caret, text selected in the cell, and a list item all move.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { paragraphTextOf, serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { createKeyDownHandler } from '../surface-input.ts';
import { mount as mountFixture, selectCellRectangle } from './paginated-surface-fixtures.ts';

const mounted: PaginatedSurface[] = [];
afterEach(() => {
  for (const surface of mounted.splice(0)) surface.destroy();
});

const paragraph = (text: string, pPr = '') =>
  `<w:p>${pPr}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const cell = (text: string, tcPr = '', pPr = '') =>
  `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/>${tcPr}</w:tcPr>${paragraph(text, pPr)}</w:tc>`;
const grid = '<w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>';
/** `Top`, a 2x2 table A1 B1 / A2 B2, `End`. */
const TABLE =
  paragraph('Top') +
  `<w:tbl>${grid}<w:tr>${cell('A1')}${cell('B1')}</w:tr><w:tr>${cell('A2')}${cell('B2')}</w:tr></w:tbl>` +
  paragraph('End');

function mount(body = TABLE): PaginatedSurface {
  const { surface } = mountFixture(body);
  mounted.push(surface);
  return surface;
}

/** Paragraph ids in document order: Top, A1, B1, A2, B2, End for `TABLE`. */
const ids = (surface: PaginatedSurface) => [...surface.session.paragraphIds()];
const textAt = (surface: PaginatedSurface, paragraphId: string) =>
  paragraphTextOf(surface.session.part(), paragraphId);
const textOf = (surface: PaginatedSurface) => ids(surface).map((id) => textAt(surface, id));

function caretAt(surface: PaginatedSurface, index: number, offset: number): void {
  const paragraphId = ids(surface)[index]!;
  surface.setSelection({ anchor: { paragraphId, offset }, head: { paragraphId, offset } });
}

function tab(
  surface: PaginatedSurface,
  keys: { shift?: boolean; alt?: boolean; ctrl?: boolean } = {}
) {
  let prevented = false;
  createKeyDownHandler(surface)({
    key: 'Tab',
    preventDefault: () => (prevented = true),
    shiftKey: keys.shift ?? false,
    ctrlKey: keys.ctrl ?? false,
    metaKey: false,
    altKey: keys.alt ?? false,
  } as KeyboardEvent);
  return prevented;
}

const selectionOf = (surface: PaginatedSurface) => {
  const { anchor, head } = surface.state().selection;
  const at = (point: { paragraphId: string; offset: number }) =>
    `${textAt(surface, point.paragraphId)}@${point.offset}`;
  return `${at(anchor)}..${at(head)}`;
};

describe('Tab in a table cell', () => {
  test('moves to the next cell and selects its content', () => {
    const surface = mount();
    caretAt(surface, 1, 2);
    expect(tab(surface)).toBe(true);
    expect(selectionOf(surface)).toBe('B1@0..B1@2');
    surface.type('X');
    expect(textOf(surface)).toEqual(['Top', 'A1', 'X', 'A2', 'B2', 'End']);
  });

  test('moves on from the end of a row to the first cell of the next', () => {
    const surface = mount();
    caretAt(surface, 2, 2);
    tab(surface);
    expect(selectionOf(surface)).toBe('A2@0..A2@2');
  });

  test('moves from text selected in the cell too', () => {
    const surface = mount();
    const a1 = ids(surface)[1]!;
    surface.setSelection({
      anchor: { paragraphId: a1, offset: 0 },
      head: { paragraphId: a1, offset: 2 },
    });
    tab(surface);
    expect(selectionOf(surface)).toBe('B1@0..B1@2');
  });

  test('moves from a list item and keeps its level', () => {
    const numbered = '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>';
    const surface = mount(
      `<w:tbl>${grid}<w:tr>${cell('A1', '', numbered)}${cell('B1')}</w:tr></w:tbl>` +
        paragraph('End')
    );
    caretAt(surface, 0, 0);
    tab(surface);
    expect(selectionOf(surface)).toBe('B1@0..B1@2');
    expect(serializeOoxmlPart(surface.session.part())).toContain('<w:ilvl w:val="0"/>');
  });

  test('skips the cells a vertical merge continues', () => {
    const surface = mount(
      `<w:tbl>${grid}<w:tr>${cell('A1', '<w:vMerge w:val="restart"/>')}${cell('B1')}</w:tr>` +
        `<w:tr>${cell('', '<w:vMerge/>')}${cell('B2')}</w:tr></w:tbl>` +
        paragraph('End')
    );
    caretAt(surface, 1, 2);
    tab(surface);
    expect(selectionOf(surface)).toBe('B2@0..B2@2');
  });

  test('in the last cell adds a row and puts the caret in its first cell; one undo removes it', () => {
    const surface = mount();
    caretAt(surface, 4, 2);
    tab(surface);
    const rows = () => serializeOoxmlPart(surface.session.part()).match(/<w:tr[ >]/g)?.length;
    expect(rows()).toBe(3);
    expect(textOf(surface)).toEqual(['Top', 'A1', 'B1', 'A2', 'B2', '', '', 'End']);
    expect(selectionOf(surface)).toBe('@0..@0');
    expect(surface.state().selection.head.paragraphId).toBe(ids(surface)[5]!);
    surface.undo();
    expect(rows()).toBe(2);
  });

  test('with several cells selected selects the content of the first of them', () => {
    for (const shift of [false, true]) {
      const surface = mount();
      selectCellRectangle(surface, { row: 0, column: 0 }, { row: 0, column: 1 });
      tab(surface, { shift });
      expect(selectionOf(surface)).toBe('A1@0..A1@2');
      expect(serializeOoxmlPart(surface.session.part())).not.toContain('w:ind');
    }
  });
});

describe('Shift+Tab in a table cell', () => {
  test('moves to the previous cell and selects its content', () => {
    const surface = mount();
    caretAt(surface, 4, 2);
    tab(surface, { shift: true });
    expect(selectionOf(surface)).toBe('A2@0..A2@2');
  });

  test('in the first cell keeps the caret where it is', () => {
    const surface = mount();
    caretAt(surface, 1, 1);
    expect(tab(surface, { shift: true })).toBe(true);
    expect(selectionOf(surface)).toBe('A1@1..A1@1');
    expect(textOf(surface)).toEqual(['Top', 'A1', 'B1', 'A2', 'B2', 'End']);
  });
});

describe('Option+Tab and Ctrl+Tab in a table cell', () => {
  test('type a tab character and stay in the cell', () => {
    for (const keys of [{ alt: true }, { ctrl: true }]) {
      const surface = mount();
      caretAt(surface, 1, 2);
      tab(surface, keys);
      expect(serializeOoxmlPart(surface.session.part())).toContain('<w:tab/>');
      expect(surface.state().selection.head.paragraphId).toBe(ids(surface)[1]!);
    }
  });
});

test('Tab outside a table still types a tab character', () => {
  const surface = mount();
  caretAt(surface, 0, 3);
  tab(surface);
  expect(serializeOoxmlPart(surface.session.part())).toContain('<w:tab/>');
});

describe('Tab through table shapes', () => {
  test('passes a vertical merge that crosses a page and reaches the last cell', () => {
    // A short page splits the table; column B is merged down twelve rows, so the merge
    // continues at the top of every later page with an empty stand-in cell.
    const sect =
      '<w:sectPr><w:pgSz w:w="12240" w:h="3000"/><w:pgMar w:top="400" w:bottom="400" ' +
      'w:left="1000" w:right="1000" w:header="0" w:footer="0"/></w:sectPr>';
    let rows = `<w:tr>${cell('A0')}${cell('B0', '<w:vMerge w:val="restart"/>')}</w:tr>`;
    for (let i = 1; i < 12; i++) rows += `<w:tr>${cell(`A${i}`)}${cell('', '<w:vMerge/>')}</w:tr>`;
    rows += `<w:tr>${cell('Alast')}${cell('Blast')}</w:tr>`;
    const surface = mount(`<w:tbl>${grid}${rows}</w:tbl>${paragraph('End')}${sect}`);
    expect(surface.layout().pages.length).toBeGreaterThan(1);
    caretAt(surface, 0, 2);
    const visited: string[] = [];
    for (let press = 0; press < 15; press++) {
      tab(surface);
      visited.push(textAt(surface, surface.state().selection.head.paragraphId));
    }
    expect(visited).toEqual([
      'B0',
      'A1',
      'A2',
      'A3',
      'A4',
      'A5',
      'A6',
      'A7',
      'A8',
      'A9',
      'A10',
      'A11',
      'Alast',
      'Blast',
      '',
    ]);
  });

  test('moves within a nested table, and from its last cell adds a row to it', () => {
    const inner = `<w:tbl>${grid}<w:tr>${cell('N1')}${cell('N2')}</w:tr></w:tbl>`;
    const surface = mount(
      `<w:tbl>${grid}<w:tr><w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${inner}` +
        `${paragraph('')}</w:tc>${cell('O2')}</w:tr></w:tbl>` +
        paragraph('End')
    );
    const n1 = ids(surface).findIndex((id) => textAt(surface, id) === 'N1');
    caretAt(surface, n1, 2);
    tab(surface);
    expect(selectionOf(surface)).toBe('N2@0..N2@2');
    tab(surface);
    const xml = serializeOoxmlPart(surface.session.part());
    expect(xml.match(/<w:tr[ >]/g)).toHaveLength(3);
  });

  test('follows the cells in document order in a right-to-left table', () => {
    const surface = mount(
      `<w:tbl><w:tblPr><w:bidiVisual/></w:tblPr>${grid}<w:tr>${cell('A1')}${cell('B1')}</w:tr>` +
        `</w:tbl>${paragraph('End')}`
    );
    caretAt(surface, 0, 2);
    tab(surface);
    expect(selectionOf(surface)).toBe('B1@0..B1@2');
  });

  test('in suggesting mode adds the row as a tracked insertion', () => {
    const surface = mount();
    surface.setAuthor('Ada');
    surface.setEditingMode('suggest');
    caretAt(surface, 4, 2);
    tab(surface);
    const xml = serializeOoxmlPart(surface.session.part());
    expect(xml.match(/<w:tr[ >]/g)).toHaveLength(3);
    expect(xml).toContain('<w:ins ');
  });

  test('in suggesting mode with no author adds no row and keeps the caret', () => {
    const surface = mount();
    surface.setEditingMode('suggest');
    caretAt(surface, 4, 2);
    expect(tab(surface)).toBe(true);
    expect(serializeOoxmlPart(surface.session.part()).match(/<w:tr[ >]/g)).toHaveLength(2);
    expect(selectionOf(surface)).toBe('B2@2..B2@2');
  });
});

describe('tab characters and other stories', () => {
  test('Option+Tab over several selected cells keeps every cell', () => {
    for (const keys of [{ alt: true }, { ctrl: true }]) {
      const surface = mount();
      selectCellRectangle(surface, { row: 0, column: 0 }, { row: 1, column: 1 });
      expect(tab(surface, keys)).toBe(true);
      expect(textOf(surface)).toEqual(['Top', 'A1', 'B1', 'A2', 'B2', 'End']);
      expect(serializeOoxmlPart(surface.session.part())).not.toContain('<w:tab/>');
    }
  });

  test('Shift+Option+Tab types a tab character too', () => {
    const surface = mount();
    caretAt(surface, 1, 2);
    tab(surface, { alt: true, shift: true });
    expect(serializeOoxmlPart(surface.session.part())).toContain('<w:tab/>');
  });

  test('a table in a header moves between cells and adds its row in the header', () => {
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
    const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
    const header = `<w:tbl>${grid}<w:tr>${cell('H1')}${cell('H2')}</w:tr></w:tbl>${paragraph('')}`;
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          `<Override PartName="/word/document.xml" ContentType="${CT}.document.main+xml"/>` +
          `<Override PartName="/word/header1.xml" ContentType="${CT}.header+xml"/></Types>`
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" ` +
          'Target="word/document.xml"/></Relationships>'
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rHdr" Type="${R}/header" ` +
          'Target="header1.xml"/></Relationships>'
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${paragraph('Body')}` +
          '<w:sectPr><w:headerReference w:type="default" r:id="rHdr"/></w:sectPr></w:body></w:document>'
      ),
      'word/header1.xml': strToU8(`<w:hdr xmlns:w="${W}">${header}</w:hdr>`),
    });
    const container = document.createElement('div');
    document.body.append(container);
    const result = mountPaginatedSurface(container, bytes, { scale: 1 });
    if (!result.ok) throw new Error(result.reason);
    const surface = result.surface;
    mounted.push(surface);
    expect(surface.enterHeaderFooter({ rId: 'rHdr' })).toBe(true);
    const [h1, h2] = surface.session.paragraphIdsIn({ kind: 'headerFooter', rId: 'rHdr' });
    surface.setSelection({
      anchor: { paragraphId: h1!, offset: 2 },
      head: { paragraphId: h1!, offset: 2 },
    });
    tab(surface);
    expect(surface.state().selection).toEqual({
      anchor: { paragraphId: h2!, offset: 0 },
      head: { paragraphId: h2!, offset: 2 },
    });
    tab(surface);
    const headerXml = serializeOoxmlPart(
      surface.session.currentPackage().parts.get('/word/header1.xml')!
    );
    expect(headerXml.match(/<w:tr[ >]/g)).toHaveLength(2);
  });
});
