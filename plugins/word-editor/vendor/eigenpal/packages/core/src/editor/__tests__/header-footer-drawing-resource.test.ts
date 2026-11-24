// A picture in a header or footer has to survive its own decode.
//
// Image resources resolve ASYNCHRONOUSLY: layout publishes a `pending` record, the decode
// settles, and the next pass is supposed to pick up the ready one. For the body that works
// because a drawing's resource rides its paragraph's flow key. A header/footer story reaches
// the session context only through its flow height and content key — both of which describe
// the AUTHORED part and are identical before and after a decode, since the extent is
// authored. The unchanged-pass early exit then found every key equal and returned the
// previous pages by identity, furniture included, so the picture stayed a "loading"
// placeholder for the rest of the session with nothing left to invalidate it.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import type { HeaderFooterStoryRecord } from '../../layout/semantic-records.ts';
import { framedTokenJoin } from '../../layout/layout-cache.ts';
import {
  CT_NS,
  DRAWING_NS,
  IMG_REL,
  OD_REL,
  PNG_1X1,
  REL_NS,
  blockDrawingKinds,
  deferredDecodePort,
  inlinePicture,
  mountWithImages,
  picture,
  settle,
  textboxWithClippedPicture,
  textboxWithPicture,
} from './image-decode-harness.ts';

const HDR = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header';
const FTR = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer';

/** Anchored the way a letterhead is: `wrapNone`, offset out past the text column. */
function anchoredDrawing(): string {
  return (
    '<w:r><w:drawing>' +
    '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" ' +
    'layoutInCell="1" allowOverlap="1" relativeHeight="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="column"><wp:posOffset>5000000</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="457200" cy="457200"/><wp:wrapNone/><wp:docPr id="1" name="pic"/>' +
    `${picture(1)}</wp:anchor></w:drawing></w:r>`
  );
}

function docx(options: { readonly headerBody: string; readonly footerBody: string }): Uint8Array {
  const rels = (target: string) =>
    strToU8(
      `<Relationships xmlns="${REL_NS}"><Relationship Id="rIdImg" Type="${IMG_REL}" Target="${target}"/></Relationships>`
    );
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT_NS}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="png" ContentType="image/png"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
        '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OD_REL}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document ${DRAWING_NS}><w:body>` +
        '<w:p><w:r><w:t>body</w:t></w:r></w:p>' +
        '<w:sectPr>' +
        '<w:headerReference r:id="rIdHdr" w:type="default"/>' +
        '<w:footerReference r:id="rIdFtr" w:type="default"/>' +
        '<w:pgSz w:w="11906" w:h="16838"/>' +
        '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>' +
        '</w:sectPr></w:body></w:document>'
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rIdHdr" Type="${HDR}" Target="header1.xml"/>` +
        `<Relationship Id="rIdFtr" Type="${FTR}" Target="footer1.xml"/>` +
        '</Relationships>'
    ),
    'word/header1.xml': strToU8(`<w:hdr ${DRAWING_NS}><w:p>${options.headerBody}</w:p></w:hdr>`),
    'word/footer1.xml': strToU8(`<w:ftr ${DRAWING_NS}><w:p>${options.footerBody}</w:p></w:ftr>`),
    'word/_rels/header1.xml.rels': rels('media/image1.png'),
    'word/_rels/footer1.xml.rels': rels('media/image1.png'),
    'word/media/image1.png': PNG_1X1,
  });
}

function storyDrawingKinds(story: HeaderFooterStoryRecord | undefined): string[] {
  if (!story) return [];
  const kinds = (story.anchoredDrawings ?? []).map((drawing) => drawing.resource.kind);
  for (const kind of blockDrawingKinds(story.fragments)) kinds.push(kind);
  return kinds;
}

/** Resource kinds of the pictures inside the story's anchored text-box stories. */
function textboxStoryDrawingKinds(story: HeaderFooterStoryRecord | undefined): string[] {
  if (!story) return [];
  const kinds: string[] = [];
  for (const drawing of story.anchoredDrawings ?? []) {
    const inner = drawing.textboxStory;
    if (!inner) continue;
    for (const kind of blockDrawingKinds(inner.fragments)) kinds.push(kind);
  }
  return kinds;
}

describe('header/footer picture resources reach the page', () => {
  test('an anchored header picture stops being pending once it decodes', async () => {
    const { surface, container } = await mountWithImages(
      docx({ headerBody: anchoredDrawing(), footerBody: '<w:r><w:t>f</w:t></w:r>' })
    );
    const page = surface.layout().pages[0]!;
    expect(storyDrawingKinds(page.header)).toEqual(['ready']);
    // And the painter shows the picture rather than the loading placeholder.
    expect(container.querySelectorAll('.docx-drawing-placeholder')).toHaveLength(0);
    expect(container.querySelectorAll('.docx-drawing-ready').length).toBeGreaterThan(0);
    surface.destroy();
    container.remove();
  });

  test('an inline footer picture does too', async () => {
    const { surface, container } = await mountWithImages(
      docx({ headerBody: '<w:r><w:t>h</w:t></w:r>', footerBody: inlinePicture(2) })
    );
    const page = surface.layout().pages[0]!;
    expect(storyDrawingKinds(page.footer)).toEqual(['ready']);
    expect(container.querySelectorAll('.docx-drawing-placeholder')).toHaveLength(0);
    surface.destroy();
    container.remove();
  });

  // The regression for a picture nested one story deeper: `storyDrawingResourceToken` has to
  // descend into each anchored drawing's text-box story, or the furniture context is identical
  // before and after the decode and the unchanged-pass early exit returns the previous pages
  // by identity — the picture stays a placeholder with nothing left to invalidate it.
  test('a picture inside a header text box stops being pending once it decodes', async () => {
    const { port, release } = deferredDecodePort();
    const { surface, container } = await mountWithImages(
      docx({ headerBody: textboxWithPicture(), footerBody: '<w:r><w:t>f</w:t></w:r>' }),
      port
    );
    expect(textboxStoryDrawingKinds(surface.layout().pages[0]!.header)).toEqual(['pending']);
    release();
    await settle();
    expect(textboxStoryDrawingKinds(surface.layout().pages[0]!.header)).toEqual(['ready']);
    expect(container.querySelectorAll('.docx-drawing-placeholder')).toHaveLength(0);
    surface.destroy();
    container.remove();
  });

  // The regression for #467: the furniture context tokenizes the BASELINE story, and the
  // text-box height clip drops the picture's fragment from it — while a `withPageContext`
  // projection can wrap differently and keep the picture. The token must name clipped
  // resources too, or the settle moves nothing and the unchanged-pass early exit returns
  // the previous pages by identity.
  test('a picture the baseline text-box clip drops still invalidates the reused pages', async () => {
    const { port, release } = deferredDecodePort();
    const { surface, container } = await mountWithImages(
      docx({ headerBody: textboxWithClippedPicture(), footerBody: '<w:r><w:t>f</w:t></w:r>' }),
      port
    );
    const clippedTokenOf = (): string => {
      const header = surface.layout().pages[0]!.header;
      const box = (header?.anchoredDrawings ?? []).find((drawing) => drawing.textboxStory);
      return box?.textboxStory?.clippedResourceToken ?? '';
    };
    // The clip drops the picture's fragment, so no laid-out record carries it...
    expect(textboxStoryDrawingKinds(surface.layout().pages[0]!.header)).toEqual([]);
    // ...but the clipped-resource token still names its pending resource. Tokens are
    // length-framed, so the assertion targets the framed (kind, resource key) pair — a
    // bare substring like 'pending' could also match a key that contains the word.
    const resourceKey = 'embed:/word/header1.xml:rIdImg';
    expect(clippedTokenOf()).toContain(framedTokenJoin(['pending', resourceKey]));
    const before = surface.layout().pages[0]!;
    release();
    await settle();
    // The settle rebuilt the pages: the clipped token moved the furniture context, so the
    // unchanged-pass early exit could not return `before` by identity.
    expect(surface.layout().pages[0]!).not.toBe(before);
    // The ready resource re-keys under its content identity, so only the framed kind
    // marker is stable to assert on.
    expect(clippedTokenOf()).toContain(framedTokenJoin(['ready']));
    expect(clippedTokenOf()).not.toContain(framedTokenJoin(['pending', resourceKey]));
    surface.destroy();
    container.remove();
  });

  test('every page carries the resolved picture, not just the first', async () => {
    const { surface, container } = await mountWithImages(
      docx({ headerBody: anchoredDrawing(), footerBody: inlinePicture(2) })
    );
    for (const page of surface.layout().pages) {
      expect(storyDrawingKinds(page.header)).toEqual(['ready']);
      expect(storyDrawingKinds(page.footer)).toEqual(['ready']);
    }
    surface.destroy();
    container.remove();
  });
});
