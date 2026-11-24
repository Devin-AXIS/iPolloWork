import { strToU8, zipSync } from 'fflate';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const DOC_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

function textbox(text: string, id = 7, topOffsetEmu = 0): string {
  return (
    `<w:r><w:drawing xmlns:wp="${WP}" xmlns:a="${A}" xmlns:wps="${WPS}">` +
    '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="1" ' +
    'behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
    `<wp:positionV relativeFrom="page"><wp:posOffset>${topOffsetEmu}</wp:posOffset></wp:positionV>` +
    '<wp:extent cx="914400" cy="457200"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    `<wp:wrapNone/><wp:docPr id="${id}" name="Find text box ${id}"/>` +
    `<a:graphic><a:graphicData uri="${WPS}"><wps:wsp>` +
    '<wps:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>' +
    `<wps:txbx><w:txbxContent><w:p><w:r><w:t>${text}</w:t></w:r></w:p>` +
    '</w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic>' +
    '</wp:anchor></w:drawing></w:r>'
  );
}

function wrappedTextbox(text: string): string {
  const run = textbox(text);
  const drawing = run.slice('<w:r>'.length, -'</w:r>'.length);
  return (
    `<w:r><mc:AlternateContent xmlns:mc="${MC}" xmlns:wps="${WPS}">` +
    `<mc:Choice Requires="wps">${drawing}</mc:Choice>` +
    '<mc:Fallback><w:pict/></mc:Fallback></mc:AlternateContent></w:r>'
  );
}

export function textboxDocx(
  inHeader = false,
  includeBodyFrame = !inHeader,
  headerTopOffsetEmu = 0,
  bodyFrameCount = 1
): Uint8Array {
  const headerReference = inHeader
    ? '<w:sectPr><w:headerReference w:type="default" r:id="rHeader"/></w:sectPr>'
    : '';
  const body =
    '<w:p><w:r><w:t>body</w:t></w:r></w:p>' +
    (includeBodyFrame
      ? `<w:p>${Array.from({ length: bodyFrameCount }, () => wrappedTextbox('boxed needle')).join('')}</w:p>`
      : '') +
    headerReference;
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        (inHeader
          ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>'
          : '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${DOC_REL}"><w:body>${body}</w:body></w:document>`
    ),
  };
  if (inHeader) {
    files['word/_rels/document.xml.rels'] = strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rHeader" Type="${DOC_REL}/header" Target="header1.xml"/></Relationships>`
    );
    files['word/header1.xml'] = strToU8(
      `<w:hdr xmlns:w="${W}"><w:p>${textbox('boxed needle', 7, headerTopOffsetEmu)}</w:p></w:hdr>`
    );
  }
  return zipSync(files);
}
