import { strToU8, zipSync } from 'fflate';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const OD_REL = `${R}/officeDocument`;
const IMG_REL = `${R}/image`;
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const DRAWING_NS = `xmlns:w="${W}" xmlns:r="${R}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:wp="${WP}"`;
const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (c) => c.charCodeAt(0)
);
const picture = (id: number) =>
  `<a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="Picture"/><pic:cNvPicPr/></pic:nvPicPr>` +
  '<pic:blipFill><a:blip r:embed="rIdImg"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
  '<pic:spPr><a:xfrm><a:ext cx="1270000" cy="1270000"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic>';

export function documentWithPicture(
  relativeFrom: 'paragraph' | 'line',
  before: number,
  anchorOnly = false
): Uint8Array {
  const anchor =
    '<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" ' +
    'simplePos="0" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1" relativeHeight="1">' +
    '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column">' +
    '<wp:posOffset>0</wp:posOffset></wp:positionH>' +
    `<wp:positionV relativeFrom="${relativeFrom}"><wp:posOffset>177800</wp:posOffset></wp:positionV>` +
    '<wp:extent cx="1270000" cy="1270000"/><wp:wrapSquare wrapText="bothSides"/>' +
    '<wp:docPr id="1" name="Picture"/>' +
    picture(1) +
    '</wp:anchor></w:drawing></w:r>';
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT_NS}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OD_REL}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL_NS}"><Relationship Id="rIdImg" Type="${IMG_REL}" Target="media/image.png"/>` +
        '<Relationship Id="rIdSet" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>'
    ),
    'word/settings.xml': strToU8(
      `<w:settings ${DRAWING_NS}><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`
    ),
    'word/media/image.png': PNG_1X1,
    'word/document.xml': strToU8(
      `<w:document ${DRAWING_NS}><w:body>` +
        '<w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="exact"/></w:pPr><w:r><w:t>Lead</w:t></w:r></w:p>' +
        `<w:p><w:pPr><w:spacing w:before="${before}" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr>` +
        anchor +
        (anchorOnly
          ? '</w:p><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="exact"/></w:pPr>'
          : '') +
        '<w:r><w:t>First line beside the picture. More text follows beside the picture.</w:t></w:r></w:p>' +
        '<w:sectPr><w:pgSz w:w="8000" w:h="8000"/><w:pgMar w:top="0" w:left="0" w:right="0" w:bottom="0"/></w:sectPr></w:body></w:document>'
    ),
  });
}
