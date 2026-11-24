import { strToU8, zipSync } from 'fflate';
import type { TextMeasurer } from '../semantic-records.ts';

export const floatSpaceText = 'aa bb cc dd ee ff gg hh ii jj kk';

// Exact advances isolate passage admission. These are not Arial font metrics.
export const floatSpaceMeasurer: TextMeasurer = {
  measure(text, style) {
    return [...text].reduce(
      (sum, character) => sum + (character === ' ' ? 4 + (style.shaping?.wordSpacingPt ?? 0) : 10),
      0
    );
  },
  lineMetrics: () => ({ height: 14, baseline: 11 }),
};

/** Public synthetic package. The picture is 1.5 inches wide, 2.25 inches from the column left. */
export function floatSpacePackage(alignment = 'both'): Uint8Array {
  const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const relationships = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const document =
    `<w:document xmlns:w="${w}" xmlns:r="${r}" ` +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    `<w:body><w:p><w:pPr><w:jc w:val="${alignment}"/></w:pPr>` +
    '<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" ' +
    'simplePos="0" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="column"><wp:posOffset>2057400</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="1371600" cy="914400"/><wp:wrapSquare wrapText="bothSides"/>' +
    '<wp:docPr id="1" name="Synthetic picture"/><a:graphic>' +
    '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="Synthetic picture"/>' +
    '<pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdPicture"/>' +
    '<a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm>' +
    '<a:off x="0" y="0"/><a:ext cx="1371600" cy="914400"/></a:xfrm>' +
    '<a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic>' +
    '</wp:anchor></w:drawing></w:r><w:r><w:rPr>' +
    '<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/></w:rPr>' +
    `<w:t>${floatSpaceText}</w:t></w:r></w:p>` +
    '<w:sectPr><w:pgSz w:w="7120" w:h="6000"/>' +
    '<w:pgMar w:top="200" w:right="200" w:bottom="200" w:left="200"/>' +
    '</w:sectPr></w:body></w:document>';
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="png" ContentType="image/png"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${relationships}"><Relationship Id="rId1" Type="${r}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(document),
    'word/settings.xml': strToU8(
      `<w:settings xmlns:w="${w}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${relationships}"><Relationship Id="rIdPicture" Type="${r}/image" Target="media/image1.png"/>` +
        `<Relationship Id="rIdSettings" Type="${r}/settings" Target="settings.xml"/></Relationships>`
    ),
    'word/media/image1.png': Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII='
      ),
      (character) => character.charCodeAt(0)
    ),
  });
}
