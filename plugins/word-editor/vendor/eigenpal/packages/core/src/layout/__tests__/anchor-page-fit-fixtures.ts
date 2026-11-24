// Documents and readers for the page-fit and anchor-frame tests: one object near the page
// bottom, on a Letter page with 1in margins (a 648pt content box), and a fixed measurer.

import { WML_NAMESPACE_URI } from '../../store/package/ooxml-tree.ts';
import type { createLayoutSession } from '../layout-session.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { paragraphFragmentsOf } from '../semantic-records.ts';
import { layoutContext, load } from './anchored-drawing-test-fixtures.ts';

const emu = (pt: number) => String(Math.round(pt * 12_700));
let nextId = 1;

export interface Box {
  readonly y: number;
  readonly height: number;
  readonly x?: number;
  readonly wrap?: 'square' | 'topAndBottom' | 'none' | 'behind';
  readonly frame?: 'paragraph' | 'line';
  readonly hidden?: boolean;
}

export function anchor({
  y,
  height,
  x = 0,
  wrap = 'square',
  frame = 'paragraph',
  hidden,
}: Box): string {
  const id = nextId++;
  const wrapXml =
    wrap === 'square'
      ? '<wp:wrapSquare wrapText="bothSides"/>'
      : wrap === 'topAndBottom'
        ? '<wp:wrapTopAndBottom/>'
        : '<wp:wrapNone/>';
  return (
    '<w:r><w:drawing>' +
    `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${id}" ` +
    `behindDoc="${wrap === 'behind' ? 1 : 0}" locked="0" layoutInCell="1" allowOverlap="1">` +
    '<wp:simplePos x="0" y="0"/>' +
    `<wp:positionH relativeFrom="column"><wp:posOffset>${emu(x)}</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="${frame}"><wp:posOffset>${emu(y)}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${emu(100)}" cy="${emu(height)}"/>${wrapXml}` +
    `<wp:docPr id="${id}" name="Box ${id}"${hidden ? ' hidden="1"' : ''}/>` +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    `<pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name=""/><pic:cNvPicPr/></pic:nvPicPr>` +
    '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    `<pic:spPr><a:xfrm><a:ext cx="${emu(100)}" cy="${emu(height)}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic>' +
    '</wp:anchor></w:drawing></w:r>'
  );
}

export const text = (value: string) => `<w:p><w:r><w:t>${value}</w:t></w:r></w:p>`;
export const exactLine = (pt: number) =>
  `<w:pPr><w:spacing w:before="0" w:after="0" w:line="${pt * 20}" w:lineRule="exact"/></w:pPr>`;
/** One line of exact `height` points. */
export const filler = (height = 560) =>
  `<w:p>${exactLine(height)}<w:r><w:t>Filler</w:t></w:r></w:p>`;
/** One paragraph of `count` lines split by manual breaks, with `content` before line `at`. */
export function linesParagraph(content: string, at: number, count: number): string {
  const runs: string[] = [];
  for (let line = 1; line <= count; line += 1) {
    if (line === at) runs.push(content);
    runs.push(`<w:r><w:t>Line ${line}</w:t></w:r>`);
    if (line < count) runs.push('<w:r><w:br/></w:r>');
  }
  return `<w:p>${exactLine(14)}${runs.join('')}</w:p>`;
}

/** `compatibilityMode` null lays the document out with no mode, as a file without one. */
export function render(
  body: string,
  compatibilityMode: number | null = 15,
  session?: ReturnType<typeof createLayoutSession>,
  revision = 1
) {
  const part = load(
    `<w:document xmlns:w="${WML_NAMESPACE_URI}"` +
      ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"' +
      ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' +
      ' xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"' +
      ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      `<w:body>${body}</w:body></w:document>`
  );
  return layoutSemanticDocument(part, revision, {
    compatibilityMode: compatibilityMode ?? undefined,
    measurer: createFixedMeasurer(6, 14),
    inlineDrawingLayout: layoutContext(part),
    session,
  });
}

export type Layout = ReturnType<typeof render>;
/** Page index and y of every drawing, in page order. */
export const drawings = (layout: Layout) =>
  layout.pages.flatMap((page, index) =>
    (page.anchoredDrawings ?? []).map((d) => ({ page: index, y: Math.round(d.y * 100) / 100 }))
  );
/** Page index and y of the first line whose text is `value`. */
export function lineAt(layout: Layout, value: string) {
  for (const [index, page] of layout.pages.entries())
    for (const fragment of paragraphFragmentsOf(page))
      for (const line of fragment.lines)
        if (
          line.spans
            .map((span) => span.text)
            .join('')
            .trimEnd() === value
        )
          return { page: index, y: line.box.y };
  return null;
}
export const after = text('After');
/** Section properties: page size and 1in margins, in points, and optional columns. */
export const section = (width: number, height: number, columns = 1) =>
  `<w:sectPr><w:pgSz w:w="${width * 20}" w:h="${height * 20}"/>` +
  '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720"' +
  ` w:footer="720" w:gutter="0"/><w:cols w:num="${columns}" w:space="720"/></w:sectPr>`;
