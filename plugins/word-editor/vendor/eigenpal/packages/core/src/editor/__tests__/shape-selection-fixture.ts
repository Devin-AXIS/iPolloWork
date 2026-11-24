// Shared fixtures for the shape selection tests: a shape behind the text, a line, a group,
// and presses at page-content points.

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import type { AnchoredDrawingRecord } from '../../layout/drawing-layout.ts';

export const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
export const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
export const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
export const WPG = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';
export const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
export const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
export const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
export const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const HDR = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header';
export const OD =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
export const SHAPE_URI = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
export const GROUP_URI = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';

export const spPr = (cx: number, cy: number, geometry: string, fill: string) =>
  `<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
  `<a:prstGeom prst="${geometry}"><a:avLst/></a:prstGeom>${fill}` +
  '<a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln></wps:spPr>';
export const wsp = (cx: number, cy: number, geometry: string, fill: string) =>
  `<wps:wsp><wps:cNvSpPr/>${spPr(cx, cy, geometry, fill)}<wps:bodyPr/></wps:wsp>`;
export const SOLID = (hex: string) => `<a:solidFill><a:srgbClr val="${hex}"/></a:solidFill>`;

export function anchor(options: {
  id: number;
  name: string;
  x: number;
  y: number;
  cx: number;
  cy: number;
  graphic: string;
  uri: string;
  behind?: boolean;
  locked?: boolean;
  /** What the offsets count from: the margins by default. */
  relativeFrom?: 'margin' | 'page';
}): string {
  const { id, name, x, y, cx, cy } = options;
  const from = options.relativeFrom ?? 'margin';
  return (
    `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ` +
    `relativeHeight="${id}" behindDoc="${options.behind ? 1 : 0}" ` +
    `locked="${options.locked ? 1 : 0}" layoutInCell="1" allowOverlap="1">` +
    '<wp:simplePos x="0" y="0"/>' +
    `<wp:positionH relativeFrom="${from}"><wp:posOffset>${x}</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="${from}"><wp:posOffset>${y}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>` +
    `<wp:docPr id="${id}" name="${name}"/><wp:cNvGraphicFramePr/>` +
    `<a:graphic><a:graphicData uri="${options.uri}">${options.graphic}</a:graphicData></a:graphic>` +
    '</wp:anchor></w:drawing></w:r>'
  );
}

export const EMU = 12_700;
/** A pale rectangle behind the first lines, locked to its anchor paragraph. */
export const BEHIND = anchor({
  id: 1,
  name: 'Background',
  x: 0,
  y: 0,
  cx: 400 * EMU,
  cy: 60 * EMU,
  graphic: wsp(400 * EMU, 60 * EMU, 'rect', SOLID('FFE699')),
  uri: SHAPE_URI,
  behind: true,
  locked: true,
});
/** A line in front of the text, well below the first lines. */
export const LINE = anchor({
  id: 2,
  name: 'Rule',
  x: 0,
  y: 200 * EMU,
  cx: 200 * EMU,
  cy: 0,
  graphic: wsp(200 * EMU, 0, 'line', ''),
  uri: SHAPE_URI,
});
/** A group of two rectangles in front of the text, further down. */
export const GROUP = anchor({
  id: 3,
  name: 'Group',
  x: 0,
  y: 300 * EMU,
  cx: 200 * EMU,
  cy: 40 * EMU,
  graphic:
    '<wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr><a:xfrm><a:off x="0" y="0"/>' +
    `<a:ext cx="${200 * EMU}" cy="${40 * EMU}"/><a:chOff x="0" y="0"/>` +
    `<a:chExt cx="${200 * EMU}" cy="${40 * EMU}"/></a:xfrm></wpg:grpSpPr>` +
    wsp(100 * EMU, 40 * EMU, 'rect', SOLID('9DC3E6')) +
    wsp(100 * EMU, 40 * EMU, 'rect', SOLID('A9D18E')).replace(
      '<a:off x="0" y="0"/>',
      `<a:off x="${100 * EMU}" y="0"/>`
    ) +
    '</wpg:wgp>',
  uri: GROUP_URI,
});

/** The section that references the header part, and the footer part when there is one. */
const headerSection = (footer: boolean) =>
  `<w:sectPr xmlns:r="${R}"><w:headerReference w:type="default" r:id="rIdH"/>` +
  (footer ? '<w:footerReference w:type="default" r:id="rIdF"/>' : '') +
  '<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" ' +
  'w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>';

export const HEADER_SECTION = headerSection(false);

/** A header or footer part: plain text is its one paragraph, markup is its body as given. */
const storyPart = (root: 'hdr' | 'ftr', content: string) =>
  strToU8(
    `<w:${root} xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:wps="${WPS}">` +
      (content.startsWith('<') ? content : `<w:p><w:r><w:t>${content}</w:t></w:r></w:p>`) +
      `</w:${root}>`
  );

/** A theme part whose colour scheme has accent1 `4472C4`, for theme colour tests. */
export const THEME_XML =
  `<a:theme xmlns:a="${A}" name="Test"><a:themeElements><a:clrScheme name="Test">` +
  '<a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>' +
  '<a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>' +
  '<a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2>' +
  '<a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>' +
  '<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6>' +
  '<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink>' +
  '</a:clrScheme></a:themeElements></a:theme>';

export function documentBytes(
  body: string,
  header?: string,
  footer?: string,
  theme?: string
): Uint8Array {
  const THEME_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme';
  const themeType = 'application/vnd.openxmlformats-officedocument.theme+xml';
  const headerType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml';
  const footerType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml';
  const FTR = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer';
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
        (header ? `<Override PartName="/word/header1.xml" ContentType="${headerType}"/>` : '') +
        (footer ? `<Override PartName="/word/footer1.xml" ContentType="${footerType}"/>` : '') +
        (theme ? `<Override PartName="/word/theme/theme1.xml" ContentType="${themeType}"/>` : '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:wps="${WPS}" ` +
        `xmlns:wpg="${WPG}" xmlns:mc="${MC}"><w:body>${body}` +
        `${header ? headerSection(footer != null) : ''}</w:body></w:document>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        (header ? `<Relationship Id="rIdH" Type="${HDR}" Target="header1.xml"/>` : '') +
        (footer ? `<Relationship Id="rIdF" Type="${FTR}" Target="footer1.xml"/>` : '') +
        (theme ? `<Relationship Id="rIdT" Type="${THEME_REL}" Target="theme/theme1.xml"/>` : '') +
        '</Relationships>'
    ),
    ...(header ? { 'word/header1.xml': storyPart('hdr', header) } : {}),
    ...(footer ? { 'word/footer1.xml': storyPart('ftr', footer) } : {}),
    ...(theme ? { 'word/theme/theme1.xml': strToU8(theme) } : {}),
  });
}

export const p = (content: string) => `<w:p>${content}</w:p>`;
export const text = (value: string) => `<w:r><w:t>${value}</w:t></w:r>`;
/** 30pt after the first paragraph: a gap with no line in it, over the shape behind. */
export const SPACED = '<w:pPr><w:spacing w:after="600"/></w:pPr>';
export const BODY =
  p(SPACED + BEHIND + text('Short')) +
  p(text('Second')) +
  p(LINE + GROUP + text('Third')) +
  Array.from({ length: 30 }, (_, i) => p(text(`Filler ${i}`))).join('');

export async function mount(
  body = BODY,
  header?: string,
  footer?: string,
  theme?: string
): Promise<{ editor: DocxEditorInstance; container: HTMLElement }> {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: documentBytes(body, header, footer, theme),
  });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    editor.surface?.layout();
  }
  return { editor, container };
}

/** The first line's box, in page-content points. */
export function firstLineBox(editor: DocxEditorInstance) {
  const fragment = editor.surface!.layout().pages[0]!.fragments[0]! as {
    readonly lines: readonly { readonly box: { y: number; height: number } }[];
  };
  return fragment.lines[0]!.box;
}

/** A y in the space after the first paragraph: below its line, above the next paragraph. */
export function gapY(editor: DocxEditorInstance): number {
  const line = firstLineBox(editor);
  return line.y + line.height + 8;
}

/** The drawing whose `relativeHeight` is `id`: each fixture drawing has its own. */
export function drawingNamed(editor: DocxEditorInstance, id: number): AnchoredDrawingRecord {
  for (const page of editor.surface!.layout().pages)
    for (const drawing of page.anchoredDrawings ?? [])
      if (drawing.relativeHeight === id) return drawing;
  throw new Error(`no drawing ${id}`);
}

/** The sheet paints points at CSS pixels: 96 per inch over 72. */
export const SCALE = 96 / 72;

/** A primary press at a point in the first page's content box, in its own points. */
export function pressAt(
  container: HTMLElement,
  editor: DocxEditorInstance,
  x: number,
  y: number,
  target = container.querySelector<HTMLElement>('.docx-page-content')!
) {
  const page = editor.surface!.layout().pages[0]!;
  const event = new PointerEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    button: 0,
    pointerId: 1,
    clientX: (page.contentBox.x + x) * SCALE,
    clientY: (page.contentBox.y + y) * SCALE,
  });
  target.dispatchEvent(event);
  return event;
}

/** A press at the middle of a drawing in front of the text, on its painted element. */
export function pressOn(
  container: HTMLElement,
  editor: DocxEditorInstance,
  drawing: AnchoredDrawingRecord
) {
  const painted = container.querySelector<HTMLElement>(
    `[data-drawing-node-id="${CSS.escape(drawing.drawingNodeId)}"]`
  )!;
  const { x, y, width, height } = drawing;
  return pressAt(container, editor, x + width / 2, y + height / 2, painted);
}

export async function saved(editor: DocxEditorInstance): Promise<string> {
  return strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
}
