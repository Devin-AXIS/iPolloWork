// Block adoption across page records that layout rebuilt around unchanged furniture.
//
// A table edit that changes column widths replaces every page the table crosses. Page-field
// finalize then projects each page's footer again, so a footer showing PAGE is a new record
// with the same content. Adoption must keep those sheets, and must still rebuild one whose
// furniture or content-control chrome really changed.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../../editor/paginated-surface.ts';
import { createLayoutSession } from '../../layout/layout-session.ts';
import { createParagraphLayoutCache } from '../../layout/layout-cache.ts';
import type {
  HeaderFooterStoryRecord,
  ParagraphFragmentRecord,
  SemanticLayout,
} from '../../layout/semantic-records.ts';
import { lay, load } from '../../layout/__tests__/table-row-keep-fixtures.ts';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import type { OoxmlNode, OoxmlPart } from '@docx-editor.dev/core/store';
import { paintSemanticLayout, type PaintOptions } from '../semantic-paint.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
const MAIN = 'application/vnd.openxmlformats-officedocument.wordprocessingml';

const autoCell = (content: string) =>
  `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${content}</w:tc>`;
const runs = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

function autoTable(rows: number, cell: (r: number, c: number) => string): string {
  const body = Array.from(
    { length: rows },
    (_, r) => `<w:tr>${[0, 1, 2].map((c) => autoCell(cell(r, c))).join('')}</w:tr>`
  ).join('');
  return (
    '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid>' +
    `${'<w:gridCol w:w="600"/>'.repeat(3)}</w:tblGrid>${body}</w:tbl>`
  );
}

/** A package whose single section shows `Page N` in its footer. */
function docxWithPageFooter(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="${MAIN}.document.main+xml"/>` +
        `<Override PartName="/word/footer1.xml" ContentType="${MAIN}.footer+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${PKG}"><Relationship Id="rId1" ` +
        `Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${PKG}"><Relationship Id="rIdFtr" Type="${R}/footer" ` +
        'Target="footer1.xml"/></Relationships>'
    ),
    'word/footer1.xml': strToU8(
      `<w:ftr xmlns:w="${W}"><w:p><w:r><w:t xml:space="preserve">Page </w:t></w:r>` +
        '<w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}<w:sectPr>` +
        '<w:footerReference w:type="default" r:id="rIdFtr"/><w:pgSz w:w="11906" w:h="16838"/>' +
        '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" ' +
        'w:footer="720"/></w:sectPr></w:body></w:document>'
    ),
  });
}

const surfaces: { surface: PaginatedSurface; container: HTMLElement }[] = [];
afterEach(() => {
  for (const { surface, container } of surfaces.splice(0)) {
    surface.destroy();
    container.remove();
  }
});

/** Layouts before and after typing into row 40, column 0 of a footer-numbered table. */
function footerEdit(): { before: SemanticLayout; after: SemanticLayout } {
  const container = document.createElement('div');
  document.body.append(container);
  const mounted = mountPaginatedSurface(
    container,
    docxWithPageFooter(runs('Intro') + autoTable(150, (r, c) => runs(`R${r}C${c}`)) + '<w:p/>'),
    { scale: 1 }
  );
  if (!mounted.ok) throw new Error(mounted.reason);
  const surface = mounted.surface;
  surfaces.push({ surface, container });
  const before = surface.layout();
  const paragraphId = surface.session.paragraphIds()[1 + 3 * 40]!;
  surface.setSelection({ anchor: { paragraphId, offset: 0 }, head: { paragraphId, offset: 0 } });
  surface.type('XXXXXXXXXXXX');
  return { before, after: surface.layout() };
}

function coldPaint(layout: SemanticLayout, options: PaintOptions): string {
  const cold = document.createElement('div');
  paintSemanticLayout(cold, layout, options);
  return cold.innerHTML;
}

const cells = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('.docx-table-cell'));

describe('adopting pages whose furniture layout rebuilt', () => {
  test('a re-projected page-number footer keeps every sheet and cell', () => {
    const { before, after: edited } = footerEdit();
    // Fast table layout can retain furniture by identity. Also exercise equal rebuilt records.
    const after: SemanticLayout = {
      ...edited,
      pages: edited.pages.map((page) => ({
        ...page,
        ...(page.footer
          ? {
              footer: {
                ...page.footer,
                fragments: page.footer.fragments.map((fragment) =>
                  fragment.kind === 'paragraph'
                    ? {
                        ...fragment,
                        lines: fragment.lines.map((line) => ({ ...line, spans: [...line.spans] })),
                      }
                    : fragment
                ),
              },
            }
          : {}),
      })),
    };
    expect(after.pages.length).toBeGreaterThan(2);
    // The precondition this test exists for: new footer records with the same content.
    expect(after.pages[1]!.footer).toBeDefined();
    expect(after.pages[1]!.footer).not.toBe(before.pages[1]!.footer);
    const container = document.createElement('div');
    paintSemanticLayout(container, before, { scale: 1 });
    const sheets = Array.from(container.children);
    const painted = cells(container);
    paintSemanticLayout(container, after, { scale: 1 });
    expect(container.innerHTML).toBe(coldPaint(after, { scale: 1 }));
    expect(Array.from(container.children).every((sheet, i) => sheet === sheets[i])).toBe(true);
    expect(cells(container).every((cell, i) => cell === painted[i])).toBe(true);
  });

  test('a footer whose text changed rebuilds only its footer layer', () => {
    const { before, after } = footerEdit();
    const footer = after.pages[0]!.footer as HeaderFooterStoryRecord;
    const paragraph = footer.fragments[0] as ParagraphFragmentRecord;
    const line = paragraph.lines[0]!;
    const span = line.spans[0]!;
    const renamed: HeaderFooterStoryRecord = {
      ...footer,
      fragments: [
        {
          ...paragraph,
          lines: [{ ...line, spans: [{ ...span, text: 'Sheet ' }, ...line.spans.slice(1)] }],
        },
      ],
    };
    const edited: SemanticLayout = {
      ...after,
      pages: [{ ...after.pages[0]!, footer: renamed }, ...after.pages.slice(1)],
    };
    const container = document.createElement('div');
    paintSemanticLayout(container, before, { scale: 1 });
    const sheets = Array.from(container.children);
    const body = sheets[0]!.querySelector('.docx-page-content');
    const footerBand = sheets[0]!.querySelector('[data-docx-hf="footer"]');
    paintSemanticLayout(container, edited, { scale: 1 });
    expect(container.innerHTML).toBe(coldPaint(edited, { scale: 1 }));
    // The sheet and its body stay; the footer band is painted again.
    expect(container.children[0]).toBe(sheets[0]);
    expect(container.children[0]!.querySelector('.docx-page-content')).toBe(body);
    expect(container.children[0]!.querySelector('[data-docx-hf="footer"]')).not.toBe(footerBand);
    expect(container.children[1]).toBe(sheets[1]);
    expect(container.querySelector('[data-docx-hf="footer"]')!.textContent).toContain('Sheet');
  });
});

describe('content-control chrome over a moved cell', () => {
  const childrenOf = (node: OoxmlNode, kind: string): OoxmlNode[] =>
    'children' in node ? (node.children as OoxmlNode[]).filter((n) => n.kind === kind) : [];

  function cellParagraphId(part: OoxmlPart, r: number, c: number): string {
    const body = childrenOf(part.root, 'body')[0]!;
    const row = childrenOf(childrenOf(body, 'table')[0]!, 'tableRow')[r]!;
    return childrenOf(childrenOf(row, 'tableCell')[c]!, 'paragraph')[0]!.id;
  }

  for (const kind of ['inline', 'block'] as const) {
    test(`an ${kind} control in a moved column matches a cold paint`, () => {
      const control = (text: string) =>
        kind === 'inline'
          ? `<w:p><w:sdt><w:sdtPr><w:alias w:val="Field"/></w:sdtPr><w:sdtContent>` +
            `<w:r><w:t>${text}</w:t></w:r></w:sdtContent></w:sdt></w:p>`
          : `<w:sdt><w:sdtPr><w:alias w:val="Field"/></w:sdtPr><w:sdtContent>` +
            `${runs(text)}</w:sdtContent></w:sdt>`;
      const part = load(
        autoTable(8, (r, c) => (c === 2 && r === 4 ? control(`R${r}C${c}`) : runs(`R${r}C${c}`)))
      );
      const session = createLayoutSession();
      const cache = createParagraphLayoutCache();
      const before = lay(part, 15, { session, cache });
      const options: PaintOptions = { scale: 1, contentControlChrome: { showAll: true } };
      const container = document.createElement('div');
      paintSemanticLayout(container, before, options);
      const boundary = () =>
        container.querySelector<HTMLElement>('.docx-content-control-boundary')!.style.left;
      const left = boundary();
      const op = applyTreeOp(part, {
        op: 'insertText',
        paragraphId: cellParagraphId(part, 1, 0),
        offset: 0,
        text: 'XXXXXXXXXX',
      });
      if (!op.ok) throw new Error(op.reason);
      const after = lay(op.part, 15, { session, cache });
      expect(after.pages[0]!.contentControls).toHaveLength(1);
      paintSemanticLayout(container, after, options);
      expect(container.innerHTML).toBe(coldPaint(after, options));
      expect(boundary()).not.toBe(left);
    });
  }
});
