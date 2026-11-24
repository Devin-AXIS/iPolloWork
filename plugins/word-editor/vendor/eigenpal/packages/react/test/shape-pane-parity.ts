// Shared by the React and Vue Format shape pane tests: the document, the selection, the cases,
// and the normalizer. Both adapters must render the same normalized markup, which is kept in
// `shape-pane-markup.json`. Regenerate it from the React test with
// `UPDATE_SHAPE_PANE_MARKUP=1 bun test packages/react/test/shape-pane.test.tsx`.

import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { strToU8, zipSync } from 'fflate';
import { normalizeChartPaneMarkup } from './chart-pane-parity.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS =
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"';

/** A rectangle with `fill` (DrawingML fill markup) and a 1pt black outline. */
const shape = (fill: string) =>
  `<w:drawing ${NS}><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ` +
  'relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
  '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0' +
  '</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0' +
  '</wp:posOffset></wp:positionV><wp:extent cx="1828800" cy="457200"/>' +
  '<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="1" name="Box"/>' +
  '<wp:cNvGraphicFramePr/><a:graphic><a:graphicData ' +
  'uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:cNvSpPr/>' +
  '<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1828800" cy="457200"/></a:xfrm>' +
  `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill}` +
  '<a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln></wps:spPr>' +
  '<wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing>';

/** The same 144 x 36pt rectangle, turned 30 degrees clockwise. */
export const TURNED_DRAWING = shape('<a:solidFill><a:srgbClr val="4472C4"/></a:solidFill>').replace(
  '<a:xfrm>',
  '<a:xfrm rot="1800000">'
);

/** One rectangle of a group: `x` in EMU, filled with `hex`. */
const member = (x: number, hex: string) =>
  '<wps:wsp><wps:cNvSpPr/><wps:spPr>' +
  `<a:xfrm><a:off x="${x}" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm>` +
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
  `<a:solidFill><a:srgbClr val="${hex}"/></a:solidFill>` +
  '<a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln></wps:spPr>' +
  '<wps:bodyPr/></wps:wsp>';

/** A group of two rectangles side by side, the drawing that a background often is. */
export const GROUP_DRAWING = shape('')
  .replace(
    'xmlns:wps=',
    'xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" xmlns:wps='
  )
  .replace(
    /<a:graphicData uri="[^"]+">.*<\/a:graphicData>/,
    '<a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup">' +
      '<wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr><a:xfrm><a:off x="0" y="0"/>' +
      '<a:ext cx="1828800" cy="457200"/><a:chOff x="0" y="0"/>' +
      '<a:chExt cx="1828800" cy="457200"/></a:xfrm></wpg:grpSpPr>' +
      member(0, '9DC3E6') +
      member(914400, 'A9D18E') +
      '</wpg:wgp></a:graphicData>'
  );

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const slot = (name: string, hex: string) => `<a:${name}><a:srgbClr val="${hex}"/></a:${name}>`;
/** The default theme colours, so a theme reference resolves as it does in a real document. */
const THEME =
  `<a:theme xmlns:a="${A}" name="Office Theme"><a:themeElements><a:clrScheme name="Office">` +
  slot('dk1', '000000') +
  slot('lt1', 'FFFFFF') +
  slot('dk2', '44546A') +
  slot('lt2', 'E7E6E6') +
  slot('accent1', '4472C4') +
  slot('accent2', 'ED7D31') +
  slot('accent3', 'A5A5A5') +
  slot('accent4', 'FFC000') +
  slot('accent5', '5B9BD5') +
  slot('accent6', '70AD47') +
  slot('hlink', '0563C1') +
  slot('folHlink', '954F72') +
  '</a:clrScheme></a:themeElements></a:theme>';

/**
 * A one-shape document with the default theme; `fill` is the shape's DrawingML fill. `drawing`
 * replaces the shape, as `GROUP_DRAWING` does.
 */
export function shapePaneDocx(fill: string, drawing = shape(fill)): Uint8Array {
  const document =
    `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
    '<w:p><w:r><w:t>Alpha paragraph</w:t></w:r></w:p>' +
    `<w:p><w:r>${drawing}<w:t>after</w:t></w:r></w:p>` +
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" ' +
    'w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>';
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(document),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdT" Type="${R}/theme" Target="theme/theme1.xml"/></Relationships>`
    ),
    'word/theme/theme1.xml': strToU8(THEME),
  });
}

/**
 * The pane cases: a theme fill, which the pane names; an RGB fill of the same colour, which it
 * does not; and a gradient that the pane shows by name.
 */
export const SHAPE_PANE_CASES = {
  theme:
    '<a:solidFill><a:schemeClr val="accent1"><a:alpha val="75000"/></a:schemeClr></a:solidFill>',
  solid: '<a:solidFill><a:srgbClr val="4472C4"><a:alpha val="75000"/></a:srgbClr></a:solidFill>',
  gradient:
    '<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FFFFFF"/></a:gs>' +
    '<a:gs pos="100000"><a:srgbClr val="4472C4"/></a:gs></a:gsLst><a:lin ang="0"/></a:gradFill>',
} as const;

export const SHAPE_PANE_MARKUP_PATH = new URL('./shape-pane-markup.json', import.meta.url);

/** Select the document's one shape, as a press on it does. */
export function selectParityShape(editor: DocxEditorInstance): void {
  const surface = editor.surface!;
  const host = surface.session.paragraphIds()[1]!;
  const find = (node: unknown): string | null => {
    const element = node as { kind?: string; localName?: string; id: string; children?: unknown[] };
    if (element.kind === 'textValue') return null;
    if (element.localName === 'drawing') return element.id;
    for (const child of element.children ?? []) {
      const found = find(child);
      if (found) return found;
    }
    return null;
  };
  const id = find(surface.session.part().root);
  if (!id || !surface.selectDrawing(id, host)) throw new Error('no shape to select');
}

/** The pane markup without generated ids and the attributes that point at them. */
export const normalizeShapePaneMarkup = (html: string): string =>
  normalizeChartPaneMarkup(html)
    .replace(/\s(aria-labelledby|data-shape)="[^"]*"/g, '')
    .replace(/\shidden=""/g, ' hidden');
