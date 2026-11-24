// Shared fixtures for the paginated-surface suites.
//
// The suites split by concern — editing and interaction in `paginated-surface.test.ts`,
// layout, materialization and measurement in `paginated-surface-layout.test.ts` — but they
// open the same documents through the same door. The package builder and the mount helper
// live here so both read a `.docx` the one way the surface is actually given one, and so a
// fixture change cannot drift between them.
//
// Nothing here touches the DOM at module scope: each suite registers happy-dom itself, and
// these helpers only reach for `document` once a test calls them.

import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '@docx-editor.dev/core/layout';
import { readOoxmlPackage } from '@docx-editor.dev/core/store';
import { cellSelectionBetween } from '../../layout/semantic-cell-selection.ts';
import type { TableCellAddress } from '../../layout/semantic-hit-test.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

export function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

// Format defaults, pinned so a fixture does not take the application defaults for omitted docDefaults.
export const FORMAT_DOC_DEFAULTS =
  '<w:docDefaults><w:rPrDefault><w:rPr><w:kern w:val="2"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>';

/** {@link docx} with a styles part holding only {@link FORMAT_DOC_DEFAULTS}. */
export function formatDefaultsDocx(body: string): Uint8Array {
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdStyles" Type="${R}/styles" Target="styles.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
    'word/styles.xml': strToU8(`<w:styles xmlns:w="${W}">${FORMAT_DOC_DEFAULTS}</w:styles>`),
  });
}

/** A one-paragraph document whose settings part asks for tracked changes. */
export function trackedDocx(settings = '<w:trackRevisions/>'): Uint8Array {
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdSettings" Type="${R}/settings" Target="settings.xml"/></Relationships>`
    ),
    'word/settings.xml': strToU8(`<w:settings xmlns:w="${W}">${settings}</w:settings>`),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>tracked</w:t></w:r></w:p></w:body></w:document>`
    ),
  });
}

export const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

/**
 * Put the caret at a model position in the first paragraph.
 *
 * Addresses the MODEL, not the screen. Positioning by coordinates went through the surface's
 * own hit test, which no production path uses any more — the browser resolves pointer
 * positions over the painted text. `hitTestSemantic` keeps its own tests in `engine-layout`,
 * where the page-relative contract that makes it tricky actually lives.
 */
export function putCaret(surface: PaginatedSurface, offset: number, paragraphIndex = 0): void {
  const paragraphId = surface.session.paragraphIds()[paragraphIndex]!;
  surface.setSelection({
    anchor: { paragraphId, offset },
    head: { paragraphId, offset },
  });
}

/**
 * Select a rectangle of cells on the FIRST table in the layout, by row ordinal and grid
 * column.
 *
 * Every rectangle suite hand-rolled the same fragment lookup, `TableCellAddress`
 * construction and `cellSelectionBetween` call; a contract change in any of those had to
 * be fixed once per file. This is the one copy.
 */
export function selectCellRectangle(
  surface: PaginatedSurface,
  from: { row: number; column: number },
  to: { row: number; column: number }
): void {
  const table = surface
    .layout()
    .pages.flatMap((page) => page.fragments)
    .find((fragment) => fragment.kind === 'table');
  if (!table || table.kind !== 'table') throw new Error('no table in layout');
  const address = (row: number, column: number): TableCellAddress => {
    const rowRecord = table.rows[row]!;
    const cell = rowRecord.cells.find((candidate) => candidate.gridColumn === column);
    if (!cell) throw new Error(`no cell at row ${row}, grid column ${column}`);
    return {
      tableId: table.tableId,
      rowId: rowRecord.id,
      cellId: cell.id,
      rowIndex: row,
      gridColumn: cell.gridColumn,
      gridSpan: cell.gridSpan,
    };
  };
  const rectangle = cellSelectionBetween(
    surface.layout(),
    address(from.row, from.column),
    address(to.row, to.column)
  );
  if (!rectangle) throw new Error('cell rectangle failed');
  surface.setCellSelection(rectangle);
}

export function mount(body: string): { surface: PaginatedSurface; container: HTMLElement } {
  const container = document.createElement('div');
  const result = mountPaginatedSurface(container, docx(body), { scale: 1 });
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  return { surface: result.surface, container };
}

export function openLayout(bytes: Uint8Array): {
  readonly layout: ReturnType<typeof layoutSemanticDocument>;
} {
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.reason);
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  return {
    layout: layoutSemanticDocument(part, 0, { measurer: createFixedMeasurer() }),
  };
}
