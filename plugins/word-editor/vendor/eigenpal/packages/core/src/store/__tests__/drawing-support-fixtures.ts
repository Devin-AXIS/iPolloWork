import { zipSync, strToU8 } from 'fflate';
export const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
export const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
export const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
export const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
export function previewShape(effect = ''): string {
  return `<w:drawing><wp:inline><wp:extent cx="1270000" cy="635000"/><wp:docPr id="1" name="Sample" descr="Sample shape"/><a:graphic><a:graphicData uri="${WPS}"><wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1270000" cy="635000"/></a:xfrm><a:prstGeom prst="rect"/><a:solidFill><a:srgbClr val="008080"/></a:solidFill>${effect}</wps:spPr><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing>`;
}
export function previewDocument(content: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:a="${A}" xmlns:wp="${WP}" xmlns:wps="${WPS}" xmlns:mc="${MC}" xmlns:v="urn:schemas-microsoft-com:vml"><w:body><w:p><w:r><w:t>Before</w:t>${content}<w:t>After</w:t></w:r></w:p></w:body></w:document>`
    ),
  });
}
export function previewPicture(effects = ''): string {
  const pic = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  return `<w:drawing><wp:inline><wp:extent cx="1270000" cy="635000"/><wp:docPr id="1" name="Picture"/><a:graphic><a:graphicData uri="${pic}"><pic:pic xmlns:pic="${pic}"><pic:nvPicPr><pic:cNvPr id="1" name="Picture"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip xmlns:r="${rel}" r:embed="rIdPicture">${effects}</a:blip><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1270000" cy="635000"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;
}
