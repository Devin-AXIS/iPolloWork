// The header picture watermark document: an authored VML picture frame shape whose template
// omits its formulas, centered on the margin box behind the text on three A4 pages.

import { strToU8, zipSync } from 'fflate';
import type { SemanticLayout } from '../../layout/semantic-records.ts';
import { openDocumentForExport } from '../export-session.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
const NS =
  `xmlns:w="${W}" xmlns:r="${R}" xmlns:v="urn:schemas-microsoft-com:vml" ` +
  'xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w10="urn:schemas-microsoft-com:office:word"';
export const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (c) => c.charCodeAt(0)
);

// A4 with 72 pt margins: the margin box is 72..523.3 across and 72..769.9 down.
const PAGE = { width: 595.3, height: 841.9 };
const MARGIN = 72;
export const MARGIN_BOX = {
  x: MARGIN,
  y: MARGIN,
  width: PAGE.width - 2 * MARGIN,
  height: PAGE.height - 2 * MARGIN,
};

/** The picture frame template as some writers store it: without its formulas. */
const TEMPLATE =
  '<v:shapetype id="_x0000_t75" coordsize="21600,21600" o:spt="75" o:preferrelative="t" ' +
  'path="m@4@5l@4@11@9@11@9@5xe" filled="f" stroked="f"><v:stroke joinstyle="miter"/>' +
  '<v:path o:extrusionok="f" gradientshapeok="t" o:connecttype="rect"/>' +
  '<o:lock v:ext="edit" aspectratio="t"/></v:shapetype>';

function header(width: number, height: number, imageData = ''): string {
  return (
    `<w:hdr ${NS}><w:p><w:r><w:pict>${TEMPLATE}` +
    '<v:shape id="WordPictureWatermark1" type="#_x0000_t75" ' +
    `style="position:absolute;margin-left:0;margin-top:0;width:${width}pt;height:${height}pt;` +
    'z-index:-251658240;mso-position-horizontal:center;mso-position-horizontal-relative:margin;' +
    'mso-position-vertical:center;mso-position-vertical-relative:margin" o:allowincell="f">' +
    `<v:imagedata r:id="rImg" o:title="wm"${imageData}/>` +
    '<w10:wrap anchorx="margin" anchory="margin"/></v:shape></w:pict></w:r></w:p></w:hdr>'
  );
}

export interface WatermarkDocxOptions {
  readonly width?: number;
  readonly height?: number;
  readonly imageData?: string;
  readonly external?: boolean;
}

export function docx(options: WatermarkDocxOptions = {}): Uint8Array {
  const page = '<w:p><w:r><w:t>Body text</w:t></w:r><w:r><w:br w:type="page"/></w:r></w:p>';
  const body =
    page.repeat(2) +
    '<w:p><w:r><w:t>Body text</w:t></w:r></w:p>' +
    '<w:sectPr><w:headerReference w:type="default" r:id="rHdr"/>' +
    '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" ' +
    'w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>';
  const image = options.external
    ? `<Relationship Id="rImg" Type="${R}/image" Target="https://example.invalid/wm.png" TargetMode="External"/>`
    : `<Relationship Id="rImg" Type="${R}/image" Target="media/wm.png"/>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Default Extension="png" ContentType="image/png"/>' +
        `<Override PartName="/word/document.xml" ContentType="${WML}.document.main+xml"/>` +
        `<Override PartName="/word/header1.xml" ContentType="${WML}.header+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rDoc" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rHdr" Type="${R}/header" Target="header1.xml"/></Relationships>`
    ),
    'word/_rels/header1.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">${image}</Relationships>`
    ),
    'word/document.xml': strToU8(`<w:document ${NS}><w:body>${body}</w:body></w:document>`),
    'word/header1.xml': strToU8(
      header(options.width ?? 200, options.height ?? 100, options.imageData)
    ),
    ...(options.external ? {} : { 'word/media/wm.png': PNG }),
  });
}

export async function layoutOf(
  bytes: Uint8Array
): Promise<SemanticLayout & { contentWarnings?: readonly unknown[] }> {
  const opened = openDocumentForExport(bytes);
  if (!opened.ok) throw new Error(opened.reason);
  try {
    return await opened.session.layout();
  } finally {
    opened.session.dispose();
  }
}
