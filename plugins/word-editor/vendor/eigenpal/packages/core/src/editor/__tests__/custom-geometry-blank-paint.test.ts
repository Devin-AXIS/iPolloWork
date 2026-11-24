// A custom geometry whose path has a command with no current point (ECMA-376 Part 1, 20.1.9)
// paints nothing: no fill, no outline, and no placeholder card. Its text box text still lays
// out. This file mounts real bytes and reads the painted page.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { CT_NS, DRAWING_NS, OD_REL, REL_NS, mountWithImages } from './image-decode-harness.ts';

const pt = (x: number, y: number) => `<a:pt x="${x}" y="${y}"/>`;
const TRIANGLE =
  `<a:moveTo>${pt(10, 10)}</a:moveTo><a:lnTo>${pt(90, 10)}</a:lnTo>` +
  `<a:lnTo>${pt(90, 90)}</a:lnTo><a:close/>`;
const LINE_AFTER_CLOSE = `${TRIANGLE}<a:lnTo>${pt(10, 90)}</a:lnTo>`;

const FILL = '<a:solidFill><a:srgbClr val="FFC0C0"/></a:solidFill>';
const LINE = '<a:ln w="25400"><a:solidFill><a:srgbClr val="0000FF"/></a:solidFill></a:ln>';

/** An inline custom-geometry shape with a fill and an outline, and optional text. */
function customShape(id: number, path: string, text?: string): string {
  const textbox = text
    ? `<wps:txbx><w:txbxContent><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:txbxContent></wps:txbx>`
    : '';
  return (
    '<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
    `<wp:extent cx="914400" cy="914400"/><wp:docPr id="${id}" name="Shape ${id}"/>` +
    '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
    `<wps:wsp><wps:cNvSpPr${text ? ' txBox="1"' : ''}/><wps:spPr>` +
    '<a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>' +
    '<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="l" t="t" r="r" b="b"/>' +
    `<a:pathLst><a:path w="100" h="100">${path}</a:path></a:pathLst></a:custGeom>` +
    FILL +
    LINE +
    `</wps:spPr>${textbox}<wps:bodyPr/></wps:wsp>` +
    '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'
  );
}

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT_NS}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OD_REL}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document ${DRAWING_NS}><w:body>${body}` +
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
        '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>' +
        '</w:sectPr></w:body></w:document>'
    ),
  });
}

describe('custom geometry with no current point', () => {
  test('paints no shape and no placeholder card, and keeps its text', async () => {
    const { surface, container } = await mountWithImages(
      docx(
        customShape(1, TRIANGLE) +
          customShape(2, LINE_AFTER_CLOSE) +
          customShape(3, `<a:lnTo>${pt(100, 0)}</a:lnTo>${TRIANGLE}`) +
          customShape(4, LINE_AFTER_CLOSE, 'Kept text')
      )
    );
    try {
      expect(container.querySelectorAll('.docx-drawing-placeholder-card')).toHaveLength(0);
      // Only the valid triangle paints.
      expect(container.querySelectorAll('.docx-drawing-shape svg path')).toHaveLength(1);
      expect(container.textContent).toContain('Kept text');
      // Each blanked shape without text keeps an empty, selectable frame.
      expect(container.querySelectorAll('.docx-drawing-empty-frame')).toHaveLength(2);
    } finally {
      surface.destroy();
      container.remove();
    }
  });
});
