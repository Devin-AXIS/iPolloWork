// A picture that keeps an embedded copy beside a link to its source shows the embedded copy
// and never loads the link.

import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { projectDrawingsInPackage } from '../package/drawing-projection.ts';
import { createImageResourceCache } from '../package/image-resources.ts';
import { readOoxmlPackage } from '../package/ooxml-package.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const MAIN = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (c) => c.charCodeAt(0)
);

function packageWith(blip: string) {
  const drawing =
    `<w:drawing><wp:inline><wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="Picture 1"/>` +
    `<a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="p"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill>${blip}<a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;
  const read = readOoxmlPackage(
    zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="${MAIN}"/></Types>`
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}"><w:body><w:p><w:r>${drawing}</w:r></w:p></w:body></w:document>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rImage" Type="${R}/image" Target="media/image.png"/><Relationship Id="rLink" Type="${R}/image" Target="cid:image001.png" TargetMode="External"/></Relationships>`
      ),
      'word/media/image.png': PNG,
    })
  );
  if (!read.ok) throw new Error(read.reason);
  return read.package;
}

test('a picture with an embedded copy and a link shows the embedded copy', async () => {
  const pkg = packageWith('<a:blip r:embed="rImage" r:link="rLink"/>');
  const [projection] = projectDrawingsInPackage(pkg);
  expect(projection!.picture).toMatchObject({
    embeddedRelationshipId: 'rImage',
    linkedRelationshipId: 'rLink',
  });
  const lookup = createImageResourceCache(pkg, {
    decodePort: {
      async decode() {
        return { pixelWidth: 1, pixelHeight: 1, dpiX: 96, dpiY: 96 };
      },
    },
  });
  try {
    expect((await lookup.resolveForProjection(projection!)).kind).toBe('ready');
  } finally {
    lookup.dispose();
  }
});
