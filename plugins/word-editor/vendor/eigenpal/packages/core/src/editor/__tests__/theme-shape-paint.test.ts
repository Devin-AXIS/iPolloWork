// A theme-filled shape has to reach paint through the REAL package path.
//
// Every other colour suite injects a stub `resolveSchemeColor`/`resolveStyleMatrixReference`
// straight into `indexInlineDrawingProjectionsInPart`, so none of them covers the one place
// that builds those resolvers for the editor: `createPartDrawingContextSlot` in
// `layout/inline-drawing-source.ts`. Drop either resolver there and the shapes below stop
// resolving a colour and paint a placeholder card instead, which is exactly the regression
// this file exists to catch. It mounts real bytes and reads the painted SVG.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { CT_NS, DRAWING_NS, OD_REL, REL_NS, mountWithImages } from './image-decode-harness.ts';

const THEME_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme';
const ACCENT1 = '6F55D7';

/** An inline `prstGeom` rectangle whose fill comes from `spPr`, `wps:style`, or neither. */
function themedRectangle(id: number, spPrFill: string, style: string): string {
  return (
    '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
    `<wp:extent cx="457200" cy="457200"/><wp:docPr id="${id}" name="Rect ${id}"/>` +
    '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
    '<wps:wsp><wps:cNvSpPr/><wps:spPr>' +
    '<a:xfrm><a:off x="0" y="0"/><a:ext cx="457200" cy="457200"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
    `${spPrFill}<a:ln><a:noFill/></a:ln>` +
    `</wps:spPr>${style}<wps:bodyPr/></wps:wsp>` +
    '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
  );
}

function theme(): string {
  const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  return (
    `<a:theme xmlns:a="${A}" name="Fixture"><a:themeElements>` +
    '<a:clrScheme name="Fixture">' +
    '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>' +
    '<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
    '<a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>' +
    `<a:accent1><a:srgbClr val="${ACCENT1}"/></a:accent1>` +
    '<a:accent2><a:srgbClr val="ED7D31"/></a:accent2>' +
    '<a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>' +
    '<a:accent4><a:srgbClr val="FFC000"/></a:accent4>' +
    '<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5>' +
    '<a:accent6><a:srgbClr val="70AD47"/></a:accent6>' +
    '<a:hlink><a:srgbClr val="0563C1"/></a:hlink>' +
    '<a:folHlink><a:srgbClr val="954F72"/></a:folHlink>' +
    '</a:clrScheme><a:fontScheme name="Fixture">' +
    '<a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>' +
    '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>' +
    '</a:fontScheme><a:fmtScheme name="Fixture">' +
    // The style matrix a `fillRef idx="2"` selects: `phClr` stands in for the reference's
    // own colour, so a shape with no authored fill still paints the theme colour.
    '<a:fillStyleLst>' +
    '<a:solidFill><a:srgbClr val="123456"/></a:solidFill>' +
    '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
    '</a:fillStyleLst>' +
    '<a:lnStyleLst/><a:effectStyleLst/>' +
    '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>' +
    '</a:fmtScheme></a:themeElements></a:theme>'
  );
}

function docx(options: { readonly mapAccent1To?: string } = {}): Uint8Array {
  const parts: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT_NS}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
        '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OD_REL}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rIdTheme" Type="${THEME_REL}" Target="theme/theme1.xml"/>` +
        '<Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>' +
        '</Relationships>'
    ),
    'word/theme/theme1.xml': strToU8(theme()),
    'word/settings.xml': strToU8(
      `<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${
        options.mapAccent1To ? `<w:clrSchemeMapping w:accent1="${options.mapAccent1To}"/>` : ''
      }</w:settings>`
    ),
    'word/document.xml': strToU8(
      `<w:document ${DRAWING_NS}><w:body>` +
        // 1: `spPr` fill through `a:schemeClr` — needs `resolveSchemeColor`.
        '<w:p>' +
        themedRectangle(
          1,
          '<a:solidFill><a:schemeClr val="accent1"><a:lumMod val="50000"/></a:schemeClr></a:solidFill>',
          ''
        ) +
        '</w:p>' +
        // 2: no authored fill — needs `resolveStyleMatrixReference` AND `resolveSchemeColor`.
        '<w:p>' +
        themedRectangle(
          2,
          '',
          '<wps:style><a:fillRef idx="2"><a:schemeClr val="accent1"/></a:fillRef></wps:style>'
        ) +
        '</w:p>' +
        // 3: `spPr` fill through `a:schemeClr` with `a:shade` — the linear-light blend.
        '<w:p>' +
        themedRectangle(
          3,
          '<a:solidFill><a:schemeClr val="accent1"><a:shade val="50000"/></a:schemeClr></a:solidFill>',
          ''
        ) +
        '</w:p>' +
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
        '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>' +
        '</w:sectPr></w:body></w:document>'
    ),
  };
  return zipSync(parts);
}

function paintedFills(container: HTMLElement): readonly string[] {
  return [...container.querySelectorAll('.docx-drawing-shape svg path')].map(
    (path) => path.getAttribute('fill') ?? ''
  );
}

describe('theme-filled shapes paint through the real package', () => {
  test('an authored, a style-matrix and a shaded theme fill all resolve', async () => {
    const { surface, container } = await mountWithImages(docx());
    try {
      expect(container.querySelectorAll('.docx-drawing-placeholder-card')).toHaveLength(0);
      // accent1 6F55D7 with `lumMod 50000` (HSL), the style matrix's `phClr` (verbatim),
      // and accent1 with `shade 50000`, which follows from the linear-light rule.
      expect(paintedFills(container)).toEqual(['#2F1D79', '#6F55D7', '#503C9E']);
    } finally {
      surface.destroy();
      container.remove();
    }
  });

  test('the settings colour mapping reaches the same shapes', async () => {
    const { surface, container } = await mountWithImages(docx({ mapAccent1To: 'accent3' }));
    try {
      // `w:clrSchemeMapping w:accent1="accent3"` remaps the slot, so every fill above now
      // derives from accent3 (A5A5A5) instead of accent1.
      expect(paintedFills(container)).toEqual(['#535353', '#A5A5A5', '#787878']);
    } finally {
      surface.destroy();
      container.remove();
    }
  });
});
