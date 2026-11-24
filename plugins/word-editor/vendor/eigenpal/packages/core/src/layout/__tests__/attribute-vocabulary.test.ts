// Two spellings of one setting, and the whole of `ST_OnOff`.
//
// ISO 29500 Strict renamed the direction-relative sides: `CT_TcBorders`, `CT_TblBorders`,
// `CT_TcMar` and `CT_TblCellMar` declare `w:start`/`w:end` and NOT `w:left`/`w:right`.
// Reading only the transitional names lost every vertical rule and every horizontal cell
// inset in a Strict-authored document.
//
// `ST_OnOff`'s off vocabulary is `0`, `false` AND `off` (§17.17.4). Readers that listed only
// the first two read `w:val="off"` as ON.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../../editor/paginated-surface.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

function docx(body: string, styles?: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        (styles
          ? '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
          : '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    ...(styles
      ? {
          'word/_rels/document.xml.rels': strToU8(
            `<Relationships xmlns="${REL}"><Relationship Id="rId9" Type="${OD.replace('officeDocument', 'styles')}" Target="styles.xml"/></Relationships>`
          ),
          'word/styles.xml': strToU8(styles),
        }
      : {}),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

function mount(bytes: Uint8Array): PaginatedSurface {
  const container = document.createElement('div');
  document.body.append(container);
  const result = mountPaginatedSurface(container, bytes, { scale: 1 });
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  return result.surface;
}

/** The first table fragment on the first page. */
function firstTable(surface: PaginatedSurface) {
  for (const page of surface.layout().pages) {
    for (const fragment of page.fragments) if (fragment.kind === 'table') return fragment;
  }
  throw new Error('no table in layout');
}

const GRID = '<w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>';

describe('the Strict spellings of the vertical table sides', () => {
  const table = (tcPr: string) =>
    `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>${GRID}` +
    `<w:tr><w:tc>${tcPr}${p('cell')}</w:tc></w:tr></w:tbl>`;

  test('w:tcBorders/w:start paints the same rule as w:left', () => {
    const left = mount(
      docx(
        table(
          '<w:tcPr><w:tcBorders><w:left w:val="single" w:sz="24" w:color="FF0000"/></w:tcBorders></w:tcPr>'
        )
      )
    );
    const start = mount(
      docx(
        table(
          '<w:tcPr><w:tcBorders><w:start w:val="single" w:sz="24" w:color="FF0000"/></w:tcBorders></w:tcPr>'
        )
      )
    );
    const leftBorder = firstTable(left).rows[0]!.cells[0]!.borders.left;
    expect(leftBorder).toBeDefined();
    // Read only as `w:left`, the Strict spelling drew nothing at all.
    expect(firstTable(start).rows[0]!.cells[0]!.borders.left).toEqual(leftBorder!);
  });

  test('w:tcMar/w:start insets the cell the same as w:left', () => {
    const left = mount(
      docx(table('<w:tcPr><w:tcMar><w:left w:w="1440" w:type="dxa"/></w:tcMar></w:tcPr>'))
    );
    const start = mount(
      docx(table('<w:tcPr><w:tcMar><w:start w:w="1440" w:type="dxa"/></w:tcMar></w:tcPr>'))
    );
    const textLeft = (surface: PaginatedSurface) =>
      firstTable(surface).rows[0]!.cells[0]!.blocks[0]!.box.x;
    // 1440 twips = 72pt of inset; read only as `w:left`, the Strict cell fell back to the
    // 3pt default pad.
    expect(textLeft(start)).toBe(textLeft(left));
  });
});

describe('ST_OnOff accepts "off" everywhere it accepts "0"', () => {
  test('w:tblHeader w:val="off" does not repeat the row', () => {
    const rows = Array.from(
      { length: 60 },
      (_, index) => `<w:tr><w:tc>${p(`r${index}`)}</w:tc></w:tr>`
    );
    const header = `<w:tr><w:trPr><w:tblHeader w:val="off"/></w:trPr><w:tc>${p('HEAD')}</w:tc></w:tr>`;
    const surface = mount(
      docx(
        `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>${GRID}${header}${rows.join('')}</w:tbl>`
      )
    );
    const repeats = surface
      .layout()
      .pages.flatMap((page) =>
        page.fragments.flatMap((fragment) =>
          fragment.kind === 'table' ? fragment.rows.filter((row) => row.isHeaderRepeat) : []
        )
      );
    expect(surface.layout().pages.length).toBeGreaterThan(1);
    expect(repeats).toHaveLength(0);
  });

  test('w:style w:default="on" still names the default paragraph style', () => {
    const styles =
      `<w:styles xmlns:w="${W}">` +
      '<w:style w:type="paragraph" w:styleId="Normal" w:default="on"><w:name w:val="Normal"/>' +
      '<w:rPr><w:sz w:val="48"/></w:rPr></w:style>' +
      '</w:styles>';
    const surface = mount(docx(p('text'), styles));
    const id = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId: id, offset: 0 },
      head: { paragraphId: id, offset: 1 },
    });
    // Read as "not the default", the style applied to nothing: 24pt text painted at 10pt
    // and the style box went blank.
    expect(surface.formatting().styleId).toBe('Normal');
    expect(surface.formatting().fontSizeHalfPoints).toBe(48);
  });
});
