// Renumbering reuses layout, and every number still matches a cold layout.
//
// Inserting a list item renumbers every later item. When each new number is as wide as the
// old one, the editor reuses the later pages and only relabels their markers. The oracle is a
// cold mount of the saved document: every marker, ordinal, and box must agree with it, in body
// paragraphs and in table cells, after Enter, undo, and redo. A number whose width changes must
// be laid out again, and must also agree.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { documentOrder } from '../../layout/document-order.ts';
import { paragraphLinesFor } from '../../layout/paragraph-lines.ts';
import type { BlockFragmentRecord, SemanticLayout } from '../../layout/semantic-records.ts';
import { paragraphFragmentsOf } from '../../layout/semantic-records.ts';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const NUMREL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering';
const STYLES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

function numbering(start: number): string {
  return (
    `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0">` +
    `<w:start w:val="${start}"/><w:numFmt w:val="decimal"/><w:lvlText w:val="[%1]"/>` +
    '<w:pPr><w:ind w:left="1440" w:hanging="1080"/></w:pPr></w:lvl></w:abstractNum>' +
    '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>'
  );
}

// The cell paragraphs number through their STYLE, the way the slow document did.
const STYLES =
  `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr/></w:rPrDefault><w:pPrDefault/></w:docDefaults>` +
  '<w:style w:type="paragraph" w:styleId="Numbered"><w:name w:val="Numbered"/>' +
  '<w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style></w:styles>';

let bidi = '';
const item = (text: string) =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>${bidi}</w:pPr>` +
  `<w:r><w:t>${text}</w:t></w:r></w:p>`;
const styledItem = (text: string) =>
  `<w:p><w:pPr><w:pStyle w:val="Numbered"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const cell = (content: string) =>
  `<w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>${content}</w:tc>`;

/** A list long enough to fill many pages, continued inside a table, then more items. */
function body(): string {
  const items: string[] = [];
  for (let index = 0; index < 200; index += 1) {
    // A hard page break lets the flow line up again after the inserted item, as in a real
    // document; uniform one-line items alone would shift every later page by one line.
    if (index === 20) items.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
    items.push(item(`Item text ${index}`));
  }
  const rows: string[] = [];
  for (let index = 0; index < 6; index += 1) {
    rows.push(`<w:tr>${cell(styledItem(`Cell item ${index}`))}${cell('<w:p/>')}</w:tr>`);
  }
  const table =
    '<w:tbl><w:tblPr><w:tblW w:w="8000" w:type="dxa"/></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid>' +
    rows.join('') +
    '</w:tbl>';
  const after: string[] = [];
  for (let index = 0; index < 30; index += 1) after.push(item(`Later item ${index}`));
  return items.join('') + table + after.join('') + '<w:sectPr/>';
}

function docx(start: number): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId9" Type="${NUMREL}" Target="numbering.xml"/>` +
        `<Relationship Id="rIdStyles" Type="${STYLES_REL}" Target="styles.xml"/></Relationships>`
    ),
    'word/numbering.xml': strToU8(numbering(start)),
    'word/styles.xml': strToU8(STYLES),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body()}</w:body></w:document>`
    ),
  });
}

/** Every paragraph fragment's text, marker, and geometry, in reading order, tables included. */
function markersOf(surface: PaginatedSurface): string[] {
  const out: string[] = [];
  const visit = (blocks: readonly BlockFragmentRecord[], page: number): void => {
    for (const block of blocks) {
      if (block.kind === 'table') {
        for (const row of block.rows) for (const c of row.cells) visit(c.blocks, page);
        continue;
      }
      const text = block.lines.flatMap((line) => line.spans.map((span) => span.text)).join('');
      const marker = block.marker;
      const box = marker ? `${marker.box.x},${marker.box.y},${marker.box.width}` : '';
      const pieces = marker?.pieces?.map((piece) => `${piece.text}@${piece.box.x}`).join(';');
      const first = block.lines[0];
      out.push(
        `${page}|${text}|${marker?.text ?? ''}|${marker?.ordinal ?? ''}|${box}|${pieces ?? ''}|${first?.box.y ?? ''}|${first?.contentX ?? ''}`
      );
    }
  };
  surface.layout().pages.forEach((page, index) => visit(page.fragments, index));
  return out;
}

function mount(bytes: Uint8Array): { surface: PaginatedSurface; dispose(): void } {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, bytes);
  if (!opened.ok) throw new Error(opened.reason);
  return {
    surface: opened.surface,
    dispose() {
      opened.surface.destroy();
      container.remove();
    },
  };
}

/** The cold layout of what `surface` holds now. */
function coldMarkers(surface: PaginatedSurface): string[] {
  const cold = mount(surface.session.save());
  try {
    return markersOf(cold.surface);
  } finally {
    cold.dispose();
  }
}

function enterInFirstItem(surface: PaginatedSurface): void {
  const first = surface.session.paragraphIds()[0]!;
  surface.setSelection({
    anchor: { paragraphId: first, offset: 4 },
    head: { paragraphId: first, offset: 4 },
  });
  surface.splitParagraph();
}

/** Each body paragraph's lines and the body order, read from the records with no memo. */
function coldLineIndex(layout: SemanticLayout) {
  const lines = new Map<string, unknown[]>();
  const order: string[] = [];
  for (const page of layout.pages) {
    for (const fragment of paragraphFragmentsOf(page)) {
      for (const line of fragment.lines) {
        const id = line.range.paragraphId;
        if (!lines.has(id)) {
          lines.set(id, []);
          order.push(id);
        }
        lines.get(id)!.push(line);
      }
    }
  }
  return { lines, order };
}

describe('renumbering a long list', () => {
  test('equal-width numbers reuse later pages and still match a cold layout', () => {
    // [100] .. [335]: every number has three digits before and after the insert.
    const { surface, dispose } = mount(docx(100));
    try {
      expect(surface.layout().pages.length).toBeGreaterThan(3);
      const lastBefore = markersOf(surface).at(-1)!;
      expect(lastBefore).toContain('|[335]|335|');
      enterInFirstItem(surface);
      const after = markersOf(surface);
      expect(after.at(-1)).toContain('|[336]|336|');
      expect(after).toEqual(coldMarkers(surface));
      // The renumbered tail was reused, not laid out again.
      const perf = surface.state().perf!;
      expect(perf.reusedPages).toBeGreaterThan(0);
      expect(perf.placed).toBeLessThan(perf.total / 2);

      surface.undo();
      expect(markersOf(surface)).toEqual(coldMarkers(surface));
      surface.redo();
      expect(markersOf(surface)).toEqual(after);
      expect(markersOf(surface)).toEqual(coldMarkers(surface));
    } finally {
      dispose();
    }
  });

  test('relabelled pages answer caret and order reads like a cold walk', () => {
    const { surface, dispose } = mount(docx(100));
    try {
      // Fill the per-page memos the relabelled pages inherit.
      const before = surface.layout();
      for (const id of coldLineIndex(before).order) paragraphLinesFor(before, id);
      documentOrder(before);
      enterInFirstItem(surface);
      const after = surface.layout();
      expect(surface.state().perf!.reusedPages).toBeGreaterThan(0);
      const cold = coldLineIndex(after);
      expect(documentOrder(after)).toEqual(cold.order);
      for (const id of cold.order) {
        expect(paragraphLinesFor(after, id).map((placed) => placed.line)).toEqual(
          cold.lines.get(id)!
        );
      }
      expect(paragraphLinesFor(after, 'no-such-paragraph')).toEqual([]);
    } finally {
      dispose();
    }
  });

  test('numbers that change width are laid out again and match a cold layout', () => {
    // [99] becomes [100]: the marker gets wider, so its first line must move.
    const { surface, dispose } = mount(docx(90));
    try {
      enterInFirstItem(surface);
      expect(markersOf(surface)).toEqual(coldMarkers(surface));
      surface.undo();
      expect(markersOf(surface)).toEqual(coldMarkers(surface));
    } finally {
      dispose();
    }
  });

  test('right-to-left markers are relabelled piece by piece', () => {
    bidi = '<w:bidi/>';
    const { surface, dispose } = mount(docx(100));
    try {
      expect(markersOf(surface).some((row) => row.split('|')[5] !== '')).toBe(true);
      enterInFirstItem(surface);
      expect(markersOf(surface)).toEqual(coldMarkers(surface));
      expect(surface.state().perf!.reusedPages).toBeGreaterThan(0);
    } finally {
      bidi = '';
      dispose();
    }
  });
});
