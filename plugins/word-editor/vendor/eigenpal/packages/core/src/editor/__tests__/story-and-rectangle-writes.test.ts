// Paragraph formatting answers for the story the caret is in, and acts on the cells the
// user actually selected.
//
// Two holes in the same read, both of which made a control disagree with the page:
//
//   * the paragraph indexes walked `layout.pages[].fragments`, which is the BODY. With a
//     header, footer or note open the toolbar read defaults over a centred paragraph, and
//     Increase Indent — which steps from what it reads — moved header text BACKWARDS;
//   * a cell RECTANGLE was honoured by `setParagraphProperty` and by nothing else, so
//     bulleting one selected column also bulleted the cells between its corners in document
//     order, and the read swept that same range so the button never lit.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { docx as bodyDocx, selectCellRectangle } from './paginated-surface-fixtures.ts';
import { paragraphIndentOf } from '../surface-formatting.ts';
import { paragraphTextOf } from '../../store/store/tree-op-apply.ts';
import { findNode } from '@docx-editor.dev/core/store';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

/** A body with one default header, whose paragraphs are the ones under test. */
function headerDocx(headerParagraph: string, extra?: Record<string, Uint8Array>): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
        (extra
          ? '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
          : '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId10" Type="${R}/header" Target="header1.xml"/>` +
        (extra ? `<Relationship Id="rId8" Type="${R}/numbering" Target="numbering.xml"/>` : '') +
        '</Relationships>'
    ),
    ...extra,
    'word/header1.xml': strToU8(`<w:hdr xmlns:w="${W}">${headerParagraph}</w:hdr>`),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${p('body')}` +
        `<w:sectPr><w:headerReference w:type="default" r:id="rId10"/></w:sectPr>` +
        '</w:body></w:document>'
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

/** Open the header and put the caret in its first paragraph. */
function openHeader(surface: PaginatedSurface): string {
  expect(surface.enterHeaderFooter({ rId: 'rId10' })).toBe(true);
  // `paragraphIds()` is the BODY's; the header story has its own.
  const id = surface.session.paragraphIdsIn({ kind: 'headerFooter', rId: 'rId10' })[0]!;
  surface.setSelection({
    anchor: { paragraphId: id, offset: 0 },
    head: { paragraphId: id, offset: 0 },
  });
  return id;
}

describe('formatting reads answer the open story', () => {
  const HEADER = `<w:p><w:pPr><w:jc w:val="center"/><w:ind w:left="1440"/>${''}
      <w:spacing w:before="240" w:after="120" w:line="480" w:lineRule="auto"/>
    </w:pPr><w:r><w:t>header text</w:t></w:r></w:p>`.replace(/\n\s*/g, '');

  test('a header paragraph reports its own alignment, indent and spacing', () => {
    const surface = mount(headerDocx(HEADER));
    openHeader(surface);
    const formatting = surface.formatting();
    expect(formatting.alignment).toBe('center');
    expect(formatting.indent?.left).toBe(1440);
    expect(formatting.spaceBeforePt).toBe(12);
    expect(formatting.spaceAfterPt).toBe(6);
    expect(formatting.lineSpacing).toEqual({ rule: 'multiple', value: 2 });
  });

  test('Increase Indent steps forward from the header indent, not from zero', () => {
    const surface = mount(headerDocx(HEADER));
    openHeader(surface);
    // Read as zero, the step wrote 720 and the paragraph moved LEFT from 1440.
    expect(surface.canAdjustIndent('decrease')).toBe(true);
    expect(surface.adjustIndent('increase')).toBe(true);
    expect(surface.formatting().indent?.left).toBe(2160);
  });

  test('a ruler drag inside a header lands instead of silently doing nothing', () => {
    const surface = mount(headerDocx(HEADER));
    openHeader(surface);
    // `setIndent` alone read the BODY order and the BODY part, so the header paragraph was
    // never in the order and the call returned false without writing.
    expect(surface.setIndent({ left: 2880 })).toBe(true);
    expect(surface.formatting().indent?.left).toBe(2880);
  });
});

describe('the read sweeps the story the write does', () => {
  test('a two-paragraph header selection reports disagreement, not the head', () => {
    const surface = mount(
      headerDocx(
        '<w:p><w:pPr><w:jc w:val="center"/><w:ind w:left="1440"/></w:pPr>' +
          '<w:r><w:t>one</w:t></w:r></w:p>' +
          '<w:p><w:r><w:t>two</w:t></w:r></w:p>'
      )
    );
    expect(surface.enterHeaderFooter({ rId: 'rId10' })).toBe(true);
    const ids = surface.session.paragraphIdsIn({ kind: 'headerFooter', rId: 'rId10' });
    surface.setSelection({
      anchor: { paragraphId: ids[0]!, offset: 0 },
      head: { paragraphId: ids[1]!, offset: 3 },
    });
    // Falling back to the BODY order left the header ids at -1, so the read answered for the
    // head paragraph alone while the write acted on both.
    expect(surface.formatting().alignment).toBeNull();
    expect(surface.formatting().indent?.mixed.left).toBe(true);
  });
});

describe('a cell rectangle is not the range it stands in for', () => {
  const tc = (c: string) => `<w:tc>${c}</w:tc>`;
  const tr = (c: string) => `<w:tr>${c}</w:tr>`;
  const GRID2 =
    '<w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>';
  const centred = (t: string) =>
    `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`;

  /** A 2x2 table with column A centred, plus the rectangle over that column. */
  function mountColumnA(cellBody: (label: string) => string): PaginatedSurface {
    const table =
      `<w:tbl>${GRID2}` +
      tr(tc(cellBody('A1')) + tc(p('B1'))) +
      tr(tc(cellBody('A2')) + tc(p('B2'))) +
      '</w:tbl>';
    const surface = mount(bodyDocx(table + p('after')));
    selectColumn(surface, 0);
    return surface;
  }

  function selectColumn(surface: PaginatedSurface, column: number): void {
    selectCellRectangle(surface, { row: 0, column }, { row: 1, column });
  }

  const textOf = (surface: PaginatedSurface, id: string) =>
    paragraphTextOf(surface.session.part(), id);
  const idFor = (surface: PaginatedSurface, text: string) =>
    surface.session.paragraphIds().find((id) => textOf(surface, id) === text)!;

  /** Whether a paragraph authors `w:numPr` — the mark `toggleList` leaves. */
  function isNumbered(surface: PaginatedSurface, text: string): boolean {
    const node = findNode(surface.session.part(), idFor(surface, text));
    if (!node || node.kind === 'textValue') return false;
    const pPr = node.children.find(
      (child) => child.kind !== 'textValue' && child.localName === 'pPr'
    );
    if (!pPr || pPr.kind === 'textValue') return false;
    return pPr.children.some((child) => child.kind !== 'textValue' && child.localName === 'numPr');
  }

  test('bulleting a selected column leaves the column beside it alone', () => {
    const surface = mountColumnA((label) => p(label));
    expect(surface.toggleList('bullet')).toBe(true);
    expect(isNumbered(surface, 'A1')).toBe(true);
    expect(isNumbered(surface, 'A2')).toBe(true);
    // B1 sits between A1 and A2 in document order, and the user never selected it.
    expect(isNumbered(surface, 'B1')).toBe(false);
    expect(isNumbered(surface, 'B2')).toBe(false);
  });

  test('indenting a selected column leaves the column beside it alone', () => {
    const surface = mountColumnA((label) => p(label));
    expect(surface.adjustIndent('increase')).toBe(true);
    const indentOf = (text: string) =>
      paragraphIndentOf(surface.layout(), idFor(surface, text))?.indent.left;
    expect(indentOf('A1')).toBeGreaterThan(0);
    expect(indentOf('B1')).toBe(0);
  });

  test('the read answers the rectangle, so the button lights over a centred column', () => {
    const surface = mountColumnA(centred);
    // Read as a range, B1 joined the sweep and the alignment came back mixed — the Centre
    // button never lit over a column that was uniformly centred.
    expect(surface.formatting().alignment).toBe('center');
  });
});
