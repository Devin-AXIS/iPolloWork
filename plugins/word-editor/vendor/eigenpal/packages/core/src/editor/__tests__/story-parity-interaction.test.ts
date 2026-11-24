// Interaction indexes reach every story the page draws.
//
// These are the lanes that answer "what is under the pointer". Each walked `page.fragments`
// alone, so a table or a link painted in a header was there, visible, and inert: the table
// offered no row or column handles on hover, and clicking the link opened no popover.
//
// Geometry is the trap in widening them. A story's fragments are laid out relative to its OWN
// box, not to the page content box, so an index that records them against the body's origin
// puts every handle at the wrong point on the page rather than fixing anything. The table
// occurrence carries its origin for exactly that reason.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import {
  findTableInteractionAt,
  tableInteractionIndex,
} from '../../layout/semantic-table-interaction.ts';
import { paragraphTextFromLayout } from '@docx-editor.dev/core/layout';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import type { OoxmlNode } from '../../store/package/ooxml-tree.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';

const HEADER_R_ID = 'rId10';
const FOOTER_R_ID = 'rId11';
const LINK_R_ID = 'rId30';
const LINK_URL = 'https://example.test/from-a-header';

/** A one-row, two-column table. */
const TABLE =
  '<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>' +
  '<w:tr><w:tc><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc>' +
  '<w:tc><w:p><w:r><w:t>b</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';

/** An external hyperlink run. */
const LINK =
  `<w:p><w:hyperlink r:id="${LINK_R_ID}"><w:r><w:t>Sample document</w:t></w:r>` +
  '</w:hyperlink></w:p>';

/** A block content control in the body, to prove its geometry did not move. */
const BODY_CONTROL =
  '<w:sdt><w:sdtPr><w:tag w:val="bodyControl"/><w:id w:val="8"/></w:sdtPr>' +
  '<w:sdtContent><w:p><w:r><w:t>BodyControlled</w:t></w:r></w:p></w:sdtContent></w:sdt>';

/** A block content control in the FOOTER: it sits BELOW the content box, so the shift flips sign. */
const FOOTER_CONTROL =
  '<w:sdt><w:sdtPr><w:tag w:val="ftrControl"/><w:id w:val="9"/></w:sdtPr>' +
  '<w:sdtContent><w:p><w:r><w:t>Footed</w:t></w:r></w:p></w:sdtContent></w:sdt>';

/** A block content control, so the header carries one too. */
const CONTROL =
  '<w:sdt><w:sdtPr><w:tag w:val="hdrControl"/><w:id w:val="7"/></w:sdtPr>' +
  '<w:sdtContent><w:p><w:r><w:t>Controlled</w:t></w:r></w:p></w:sdtContent></w:sdt>';

function docx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.' +
        'relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-' +
        'officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-' +
        'officedocument.wordprocessingml.header+xml"/>' +
        '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-' +
        'officedocument.wordprocessingml.footer+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/>` +
        '</Relationships>'
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="${HEADER_R_ID}" Type="${R}/header" Target="header1.xml"/>` +
        `<Relationship Id="${FOOTER_R_ID}" Type="${R}/footer" Target="footer1.xml"/>` +
        '</Relationships>'
    ),
    // The header carries BOTH a table and an external link.
    'word/_rels/header1.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="${LINK_R_ID}" Type="${R}/hyperlink" Target="${LINK_URL}"` +
        ' TargetMode="External"/></Relationships>'
    ),
    'word/header1.xml': strToU8(
      `<w:hdr xmlns:w="${W}" xmlns:r="${R}">${LINK}${TABLE}${CONTROL}</w:hdr>`
    ),
    'word/footer1.xml': strToU8(`<w:ftr xmlns:w="${W}">${FOOTER_CONTROL}</w:ftr>`),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
        `<w:p><w:r><w:t>Body</w:t></w:r></w:p>${TABLE}${BODY_CONTROL}` +
        `<w:sectPr><w:headerReference w:type="default" r:id="${HEADER_R_ID}"/>` +
        `<w:footerReference w:type="default" r:id="${FOOTER_R_ID}"/></w:sectPr>` +
        '</w:body></w:document>'
    ),
  });
}

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

function mount(): DocxEditorInstance {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createDocxEditor({ document: docx(), author: 'Parity' });
  cleanup = () => {
    editor.destroy();
    host.remove();
    document.getSelection()?.removeAllRanges();
  };
  editor.attach(host);
  return editor;
}

describe('the table hover index covers every story', () => {
  test('a table in a header is indexed, against its own origin', () => {
    const editor = mount();
    const layout = editor.surface!.layout();
    const page = layout.pages[0]!;
    const header = page.header;
    expect(header, 'the fixture painted no header').toBeDefined();

    const occurrences = tableInteractionIndex(layout).occurrences;
    // Both tables: the body's and the header's. Only the body's used to be here, so hovering
    // the header's offered no row or column handles at all.
    expect(occurrences.length, 'the header table was not indexed').toBeGreaterThan(1);

    const origins = new Set(occurrences.map((occ) => occ.pageContentBox));
    expect(origins.has(page.contentBox), 'the body table lost its origin').toBe(true);
    // The header's occurrence carries the HEADER's box. Recording it against the body's
    // content box would place every handle at the wrong point on the page.
    expect(origins.has(header!.box), 'the header table was indexed at the body origin').toBe(true);
  });
});

describe('the pointer resolves a header table where it actually is', () => {
  test('a hit at the header table lands, and the body point below it does not', () => {
    const editor = mount();
    const layout = editor.surface!.layout();
    const page = layout.pages[0]!;
    const header = page.header!;

    const occ = tableInteractionIndex(layout).occurrences.find(
      (entry) => entry.pageContentBox === header.box
    );
    expect(occ, 'the header table was not indexed').toBeDefined();
    const table = occ!.table;

    // The table's REAL sheet position: its story-local box plus the header's own origin.
    const atTable = {
      x: header.box.x + table.box.x + table.columnEdges[1]!,
      y: header.box.y + table.box.y + table.box.height / 2,
    };
    const index = tableInteractionIndex(layout);
    const hit = findTableInteractionAt(index, atTable.x, atTable.y, layout);
    expect(hit, 'hovering the header table resolved nothing').not.toBeNull();
    expect(hit?.tableId).toBe(table.tableId);

    // And the BODY point at the same story-local offset must NOT resolve it. Converting every
    // occurrence through the page's content box did both wrongs at once: it missed the table
    // above and matched a point down in the body, so a column handle for the header appeared
    // over body text and dragging it resized the header.
    const inBody = {
      x: page.contentBox.x + table.box.x + table.columnEdges[1]!,
      y: page.contentBox.y + table.box.y + table.box.height / 2,
    };
    const phantom = findTableInteractionAt(index, inBody.x, inBody.y, layout);
    expect(phantom?.tableId, 'a header table answered a point in the body').not.toBe(table.tableId);
  });
});

describe('a link resolves from the story it is in', () => {
  test('a header link is found while the caret is in the body', () => {
    const editor = mount();
    const surface = editor.surface!;
    expect(surface.activeScope()).toEqual({ kind: 'body' });

    // The id the painted header link carries. Reading it from the layout rather than guessing.
    const linkId = headerLinkId(editor);
    expect(linkId, 'the header link was never projected').toBeDefined();

    // `linkById` used to scan the paragraphs of whatever story was OPEN, so a reader in the
    // body who clicked a header link got null and no popover ever opened.
    const link = surface.hyperlinks.linkById(linkId!);
    expect(link, 'the header link did not resolve from the body').not.toBeNull();
    expect(link?.href).toBe(LINK_URL);
  });
});

/** The `w:hyperlink` node id inside the header part, which is what a link id is. */
function headerLinkId(editor: DocxEditorInstance): string | undefined {
  const part = editor.surface!.session.currentPackage().parts.get('/word/header1.xml');
  if (!part) return undefined;
  const walk = (node: OoxmlNode): string | undefined => {
    if (node.kind === 'textValue') return undefined;
    if (node.localName === 'hyperlink') return node.id;
    for (const child of node.children) {
      const found = walk(child);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return walk(part.root);
}

describe('content-control geometry covers every story', () => {
  test('a control in a header gets a box, in the shared space', () => {
    const editor = mount();
    const layout = editor.surface!.layout();
    const page = layout.pages[0]!;
    const header = page.header!;

    const control = (layout.contentControls ?? []).find((entry) => entry.tag === 'hdrControl');
    expect(control, 'the header control was not published').toBeDefined();
    // Without geometry the outline cannot draw or hit-test, which is what a control in a
    // header had: it was in the document and its boundary was nowhere.
    expect(control!.fragments.length, 'the header control got no geometry').toBeGreaterThan(0);

    // Boxes live in the BODY's content-box space, which is what the painter and the hit test
    // read. A header sits ABOVE that origin, so a correctly shifted box is negative in y; the
    // raw story-local box would be positive and would draw the outline down in the body.
    expect(header.box.y - page.contentBox.y, 'the fixture header is not above').toBeLessThan(0);
    for (const fragment of control!.fragments) {
      expect(fragment.box.y, 'the header control was placed at the body origin').toBeLessThan(0);
    }
  });

  test('a control in a footer shifts the other way', () => {
    const editor = mount();
    const layout = editor.surface!.layout();
    const page = layout.pages[0]!;
    const footer = page.footer!;

    const control = (layout.contentControls ?? []).find((entry) => entry.tag === 'ftrControl');
    expect(control, 'the footer control was not published').toBeDefined();
    expect(control!.fragments.length, 'the footer control got no geometry').toBeGreaterThan(0);

    // A footer sits BELOW the content box, so its shift is POSITIVE and lands past the content
    // height. The header case alone would pass with a sign error; this is what pins it.
    expect(footer.box.y - page.contentBox.y, 'the fixture footer is not below').toBeGreaterThan(
      page.contentBox.height
    );
    for (const fragment of control!.fragments) {
      expect(fragment.box.y, 'the footer control was placed inside the body').toBeGreaterThan(
        page.contentBox.height
      );
    }
  });

  test('the body control still gets its own box', () => {
    const editor = mount();
    const layout = editor.surface!.layout();
    const body = (layout.contentControls ?? []).find((entry) => entry.tag === 'bodyControl');
    expect(body, 'the body control was lost').toBeDefined();
    // GUARDED, unlike the loop alone: with no fragments the loop runs zero times and this
    // passes while asserting nothing — which is the exact regression the header and footer
    // halves exist to catch, sailing through on the body.
    expect(body!.fragments.length, 'the body control got no geometry').toBeGreaterThan(0);
    for (const fragment of body!.fragments) {
      expect(fragment.box.y, 'the body control moved').toBeGreaterThanOrEqual(0);
    }
  });

  test('the caret still reaches a header control', () => {
    const editor = mount();
    const surface = editor.surface!;
    expect(surface.enterHeaderFooter({ rId: HEADER_R_ID })).toBe(true);
    const inControl = surface.session
      .paragraphIdsIn({ kind: 'headerFooter', rId: HEADER_R_ID })
      .find((id) => paragraphTextFromLayout(surface.layout(), id) === 'Controlled');
    expect(inControl, 'the header control holds no paragraph').toBeDefined();
    surface.setSelection({
      anchor: { paragraphId: inControl!, offset: 0 },
      head: { paragraphId: inControl!, offset: 0 },
    });
    expect(editor.query({ type: 'contentControlAt' })?.tag).toBe('hdrControl');
  });
});

/** The surface's default: CSS pixels per point. Painted chrome is scaled by it. */
const SCALE = 96 / 72;

/** Hovers a sheet point, in the client coordinates the surface converts back from. */
function hoverSheet(x: number, y: number): void {
  const pages = document.querySelector('.docx-pages');
  expect(pages, 'the surface painted no pages layer').not.toBeNull();
  pages!.dispatchEvent(
    new window.PointerEvent('pointermove', {
      bubbles: true,
      clientX: x * SCALE,
      clientY: y * SCALE,
      pointerId: 1,
    })
  );
}

/** The header table on page 0, with the origin its coordinates are relative to. */
function headerTableOf(editor: DocxEditorInstance) {
  const layout = editor.surface!.layout();
  const page = layout.pages[0]!;
  const header = page.header!;
  expect(header, 'the fixture painted no header').toBeDefined();
  // The two origins must actually differ, or the comparisons below prove nothing.
  expect(header.box.y).not.toBe(page.contentBox.y);
  const occ = tableInteractionIndex(layout).occurrences.find(
    (each) => each.pageContentBox === header.box
  );
  expect(occ, 'the header table is not in the index').toBeDefined();
  return { page, header, table: occ!.table };
}

// Where the chrome is PAINTED, and WHETHER it is painted at all.
//
// The index and the paint are two separate coordinate conversions, and fixing the first left
// the second wrong: `cssPoint` grew an `origin` argument that no call site ever passed, so
// every handle was still drawn from `page.contentBox`. A header's box sits above it and a
// footer's below it, which put a header's col-resize strip down over the first body line —
// `pointer-events: auto`, over text it does not resize.
//
// Asserting the painted pixel against the story's own box is the only thing that catches it.
// An index assertion cannot: by then the index was already right.
describe('table chrome paints against the story it belongs to', () => {
  test("a header divider handle is drawn at the header's box, not the body's", () => {
    const editor = mount();
    expect(editor.surface!.enterHeaderFooter({ rId: HEADER_R_ID })).toBe(true);
    const { page, header, table } = headerTableOf(editor);

    hoverSheet(
      header.box.x + table.box.x + table.box.width / 2,
      header.box.y + table.box.y + table.box.height / 2
    );

    const handle = document.querySelector<HTMLElement>(
      '.docx-table-furniture .docx-table-divider-handle'
    );
    expect(handle, 'hovering the header divider painted no handle').not.toBeNull();
    // The col-resize strip: `pointer-events: auto`, so a wrong position is not cosmetic.
    expect(handle!.style.cursor).toBe('col-resize');

    const top = Number.parseFloat(handle!.style.top);
    expect(top).toBeCloseTo((header.box.y + table.box.y) * SCALE, 1);
    // Named explicitly: this is where it used to land, and that is body text.
    expect(top).not.toBeCloseTo((page.contentBox.y + table.box.y) * SCALE, 1);
  });

  // The other half. A write commits under the OPEN scope, so chrome for a story the reader is
  // not in can only ever plan against one part and commit against another. Word makes you
  // enter the header first, and so does this.
  test('the same handle is not offered while the caret is in the body', () => {
    const editor = mount();
    const { header, table } = headerTableOf(editor);

    hoverSheet(
      header.box.x + table.box.x + table.box.width / 2,
      header.box.y + table.box.y + table.box.height / 2
    );

    expect(
      document.querySelector('.docx-table-furniture .docx-table-divider-handle'),
      'a header handle was offered to a reader standing in the body'
    ).toBeNull();
  });
});
