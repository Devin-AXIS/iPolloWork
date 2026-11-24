import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createInlineDrawingLayoutBundle } from '../inline-drawing-source.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const V = 'urn:schemas-microsoft-com:vml';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const metadata = {
  name: '/word/document.xml',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
};
const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
  ),
  (char) => char.charCodeAt(0)
);

/** A VML picture beside a VML text box, as one paragraph, with `text` in the box. */
function documentXml(text: string): string {
  return (
    `<w:document xmlns:w="${W}" xmlns:v="${V}" xmlns:r="${R}"><w:body><w:p>` +
    '<w:r><w:pict><v:shape id="picture" type="#_x0000_t75" style="width:40pt;height:30pt">' +
    '<v:imagedata r:id="rPicture"/></v:shape></w:pict></w:r>' +
    '<w:r><w:pict><v:shape id="box" type="#_x0000_t202" style="position:absolute;' +
    'margin-left:100pt;margin-top:10pt;width:120pt;height:20pt;z-index:1">' +
    `<v:textbox><w:txbxContent><w:p><w:r><w:t>${text}</w:t></w:r></w:p>` +
    '</w:txbxContent></v:textbox></v:shape></w:pict></w:r>' +
    '</w:p></w:body></w:document>'
  );
}

function setup() {
  const loaded = readOoxmlPackage(
    zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="png" ContentType="image/png"/>' +
          `<Override PartName="${metadata.name}" ContentType="${metadata.contentType}"/></Types>`
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rPicture" Type="${R}/image" Target="media/image1.png"/></Relationships>`
      ),
      'word/media/image1.png': PNG_1X1,
      'word/document.xml': strToU8(documentXml('Old')),
    })
  );
  if (!loaded.ok) throw new Error(loaded.reason);
  let pkg = loaded.package;
  let revision = 0;
  let decodes = 0;
  const reader = {
    currentPackage: () => pkg,
    packageRevision: () => revision,
    part: () => pkg.parts.get(pkg.mainDocumentPart)!,
  };
  const bundle = createInlineDrawingLayoutBundle({
    session: reader,
    decodePort: {
      async decode() {
        decodes += 1;
        return { pixelWidth: 1, pixelHeight: 1, dpiX: 96, dpiY: 96 };
      },
    },
    onResourcesChanged: () => {},
  });
  return {
    bundle,
    decodes: () => decodes,
    picture() {
      const layout = layoutSemanticDocument(reader.part(), revision, {
        measurer: createFixedMeasurer(6, 14),
        inlineDrawingLayout: bundle.bodyContext,
      });
      const drawing = linesOf(layout)
        .flatMap((line) => line.drawings ?? [])
        .find((record) => record.resource.kind !== 'unrenderable');
      if (!drawing) throw new Error('missing picture');
      return drawing.resource;
    },
    /** Replace the text in the box, keeping every image byte and relationship as-is. */
    typeInBox(text: string) {
      const parsed = readOoxmlPart(documentXml(text), metadata);
      if (!parsed.ok) throw new Error(parsed.reason);
      pkg = Object.freeze({
        ...pkg,
        parts: new Map(pkg.parts).set(pkg.mainDocumentPart, parsed.part),
      });
      revision += 1;
      bundle.sync(reader);
    },
  };
}

async function settle(bundle: { pendingResourceCount(): number }): Promise<void> {
  for (let turn = 0; turn < 50 && bundle.pendingResourceCount() > 0; turn++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect(bundle.pendingResourceCount()).toBe(0);
}

// Typing in a text box replaces the part's drawing slot, because the box's projection
// changed. A picture beside it must not go pending and decode again: paint would mint it a
// new URL, and the picture would blink on every keystroke.
test('text typed in a text box keeps the decoded picture beside it ready', async () => {
  const { bundle, decodes, picture, typeInBox } = setup();
  try {
    expect(picture().kind).toBe('pending');
    await settle(bundle);
    const before = picture();
    if (before.kind !== 'ready') throw new Error(`picture is ${before.kind}`);
    expect(decodes()).toBe(1);

    for (const texts of [['Olde'], ['Older'], ['Olde', 'Old']]) {
      // Two edits before one layout: the first carry must survive the second sync.
      for (const text of texts) typeInBox(text);
      const after = picture();
      expect(after.kind).toBe('ready');
      if (after.kind !== 'ready') continue;
      expect(after.validatedHandle).toBe(before.validatedHandle);
      expect(bundle.mintValidatedBytes(after.validatedHandle, after.contentId)).not.toBeNull();
    }
    expect(decodes()).toBe(1);
    expect(bundle.pendingResourceCount()).toBe(0);
  } finally {
    bundle.dispose();
  }
});
