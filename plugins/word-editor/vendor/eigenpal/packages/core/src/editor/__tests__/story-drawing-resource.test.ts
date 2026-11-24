// A picture in a footnote or a text box has to reach the page like a body picture does.
//
// Both are stories laid out OUTSIDE the body flow, and both were dropping their drawings
// entirely: a note story was flowed with no drawing context at all, so a footnote picture
// contributed no record and painted nothing; a text-box story's inner picture was never even
// projected, so there was nothing to resolve. On top of that, resource resolution is
// asynchronous — the first pass publishes `pending` and a later pass must pick the ready one
// up, which only happens if the key that governs reuse carries the resource identity.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import type { PageRecord } from '../../layout/semantic-records.ts';
import {
  CT_NS,
  DRAWING_NS,
  IMG_REL,
  OD_REL,
  PNG_1X1,
  REL_NS,
  WPS_NS,
  blockDrawingKinds,
  deferredDecodePort,
  inlinePicture,
  mountWithImages,
  settle,
  textboxWithPicture,
} from './image-decode-harness.ts';

const FOOTNOTES = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes';
const ENDNOTES = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes';

/** A drawing that never types, carrying the story element's NAME in a position it cannot open one. */
function strayStoryNameDrawing(): string {
  return (
    '<w:r><w:drawing>' +
    '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" ' +
    'layoutInCell="1" allowOverlap="1" relativeHeight="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="2743200" cy="1828800"/><wp:wrapNone/><wp:docPr id="20" name="stray"/>' +
    `<a:graphic><a:graphicData uri="${WPS_NS}">` +
    '<wps:wsp><wps:cNvSpPr txBox="1"/>' +
    // `w:txbxContent` under the shape properties rather than under `wps:txbx`.
    `<wps:spPr><w:txbxContent><w:p>${inlinePicture(21)}</w:p></w:txbxContent></wps:spPr>` +
    '<wps:bodyPr/></wps:wsp>' +
    '</a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>'
  );
}

function docx(options: {
  readonly bodyRuns: string;
  readonly footnoteRuns: string;
  readonly endnoteRuns?: string;
}): Uint8Array {
  const imageRels = strToU8(
    `<Relationships xmlns="${REL_NS}"><Relationship Id="rIdImg" Type="${IMG_REL}" Target="media/image1.png"/></Relationships>`
  );
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT_NS}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="png" ContentType="image/png"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
        '<Override PartName="/word/endnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OD_REL}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document ${DRAWING_NS}><w:body>` +
        `<w:p><w:r><w:t>body</w:t></w:r>${options.bodyRuns}</w:p>` +
        '<w:sectPr>' +
        '<w:pgSz w:w="11906" w:h="16838"/>' +
        '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>' +
        '</w:sectPr></w:body></w:document>'
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rIdFn" Type="${FOOTNOTES}" Target="footnotes.xml"/>` +
        `<Relationship Id="rIdEn" Type="${ENDNOTES}" Target="endnotes.xml"/>` +
        `<Relationship Id="rIdImg" Type="${IMG_REL}" Target="media/image1.png"/>` +
        '</Relationships>'
    ),
    'word/footnotes.xml': strToU8(
      `<w:footnotes ${DRAWING_NS}>` +
        '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
        '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
        `<w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t>note </w:t></w:r>${options.footnoteRuns}</w:p></w:footnote>` +
        '</w:footnotes>'
    ),
    'word/endnotes.xml': strToU8(
      `<w:endnotes ${DRAWING_NS}>` +
        '<w:endnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:endnote>' +
        '<w:endnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:endnote>' +
        `<w:endnote w:id="1"><w:p><w:r><w:endnoteRef/></w:r><w:r><w:t>note </w:t></w:r>${options.endnoteRuns ?? '<w:r><w:t>plain</w:t></w:r>'}</w:p></w:endnote>` +
        '</w:endnotes>'
    ),
    'word/_rels/footnotes.xml.rels': imageRels,
    'word/_rels/endnotes.xml.rels': imageRels,
    'word/media/image1.png': PNG_1X1,
  });
}

const WPG_NS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';

/** An anchored shape group whose only member is a text box holding a picture. */
function groupTextboxWithPicture(): string {
  return (
    `<w:r><w:drawing xmlns:wpg="${WPG_NS}">` +
    '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" ' +
    'layoutInCell="1" allowOverlap="1" relativeHeight="1"><wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="2743200" cy="1828800"/><wp:wrapNone/><wp:docPr id="30" name="group"/>' +
    `<a:graphic><a:graphicData uri="${WPG_NS}"><wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr>` +
    '<a:xfrm><a:off x="0" y="0"/><a:ext cx="2743200" cy="1828800"/>' +
    '<a:chOff x="0" y="0"/><a:chExt cx="2743200" cy="1828800"/></a:xfrm></wpg:grpSpPr>' +
    '<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/>' +
    '<a:ext cx="2743200" cy="1828800"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
    '</wps:spPr><wps:txbx><w:txbxContent>' +
    `<w:p><w:r><w:t>in the group</w:t></w:r>${inlinePicture(31)}</w:p>` +
    '</w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp>' +
    '</wpg:wgp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>'
  );
}

function groupMemberDrawingKinds(page: PageRecord): string[] {
  const kinds: string[] = [];
  for (const drawing of page.anchoredDrawings ?? []) {
    for (const member of drawing.groupTextboxStories ?? []) {
      for (const kind of blockDrawingKinds(member.story.fragments)) kinds.push(kind);
    }
  }
  return kinds;
}

const FOOTNOTE_REFERENCE = '<w:r><w:footnoteReference w:id="1"/></w:r>';
const ENDNOTE_REFERENCE = '<w:r><w:endnoteReference w:id="1"/></w:r>';

function footnoteDrawingKinds(page: PageRecord): string[] {
  const kinds: string[] = [];
  for (const note of page.footnotes?.notes ?? []) {
    for (const kind of blockDrawingKinds(note.fragments)) kinds.push(kind);
  }
  return kinds;
}

function endnoteDrawingKinds(page: PageRecord): string[] {
  const kinds: string[] = [];
  for (const note of page.endnotes?.notes ?? []) {
    for (const kind of blockDrawingKinds(note.fragments)) kinds.push(kind);
  }
  return kinds;
}

function textboxDrawingKinds(page: PageRecord): string[] {
  const kinds: string[] = [];
  for (const drawing of page.anchoredDrawings ?? []) {
    const story = drawing.textboxStory;
    if (!story) continue;
    for (const kind of blockDrawingKinds(story.fragments)) kinds.push(kind);
  }
  return kinds;
}

/** `<img>` elements painted inside a page's note areas. */
function paintedNoteImages(container: HTMLElement): HTMLImageElement[] {
  return [...container.querySelectorAll('.docx-notes img')];
}

describe('pictures in stories outside the body flow', () => {
  test('a footnote picture lays out, resolves, and paints', async () => {
    const { surface, container } = await mountWithImages(
      docx({ bodyRuns: FOOTNOTE_REFERENCE, footnoteRuns: inlinePicture(2) })
    );
    const page = surface.layout().pages[0]!;
    expect(footnoteDrawingKinds(page)).toEqual(['ready']);
    expect(container.querySelectorAll('.docx-drawing-placeholder')).toHaveLength(0);
    expect(paintedNoteImages(container)).toHaveLength(1);
    surface.destroy();
    container.remove();
  });

  test('an endnote picture does too', async () => {
    const { surface, container } = await mountWithImages(
      docx({
        bodyRuns: ENDNOTE_REFERENCE,
        footnoteRuns: '<w:r><w:t>plain</w:t></w:r>',
        endnoteRuns: inlinePicture(3),
      })
    );
    const page = surface.layout().pages[0]!;
    expect(endnoteDrawingKinds(page)).toEqual(['ready']);
    expect(paintedNoteImages(container)).toHaveLength(1);
    surface.destroy();
    container.remove();
  });

  // The invalidation half: the first pass MUST publish `pending`, and a later pass MUST
  // replace it. Reading only after the decode settles would pass with the resource identity
  // stripped out of the break key entirely.
  test('a footnote picture pending at first paint reaches the page when it decodes', async () => {
    const { port, release } = deferredDecodePort();
    const { surface, container } = await mountWithImages(
      docx({ bodyRuns: FOOTNOTE_REFERENCE, footnoteRuns: inlinePicture(2) }),
      port
    );
    expect(footnoteDrawingKinds(surface.layout().pages[0]!)).toEqual(['pending']);
    release();
    await settle();
    expect(footnoteDrawingKinds(surface.layout().pages[0]!)).toEqual(['ready']);
    expect(paintedNoteImages(container)).toHaveLength(1);
    surface.destroy();
    container.remove();
  });

  test('a text-box picture pending at first paint reaches the page when it decodes', async () => {
    const { port, release } = deferredDecodePort();
    const { surface, container } = await mountWithImages(
      docx({ bodyRuns: textboxWithPicture(), footnoteRuns: '<w:r><w:t>plain</w:t></w:r>' }),
      port
    );
    expect(textboxDrawingKinds(surface.layout().pages[0]!)).toEqual(['pending']);
    release();
    await settle();
    expect(textboxDrawingKinds(surface.layout().pages[0]!)).toEqual(['ready']);
    surface.destroy();
    container.remove();
  });

  test('a picture in a group text box member pending at first paint reaches the page', async () => {
    const { port, release } = deferredDecodePort();
    const { surface, container } = await mountWithImages(
      docx({ bodyRuns: groupTextboxWithPicture(), footnoteRuns: '<w:r><w:t>plain</w:t></w:r>' }),
      port
    );
    expect(groupMemberDrawingKinds(surface.layout().pages[0]!)).toEqual(['pending']);
    release();
    await settle();
    expect(groupMemberDrawingKinds(surface.layout().pages[0]!)).toEqual(['ready']);
    surface.destroy();
    container.remove();
  });

  test('a picture inside a text box lays out and resolves', async () => {
    const { surface, container } = await mountWithImages(
      docx({ bodyRuns: textboxWithPicture(), footnoteRuns: '<w:r><w:t>plain</w:t></w:r>' })
    );
    const page = surface.layout().pages[0]!;
    expect(textboxDrawingKinds(page)).toEqual(['ready']);
    surface.destroy();
    container.remove();
  });

  // The story carve-out in the drawing-kind demotion is positional: only a `w:txbxContent`
  // directly under a `wps:txbx` opens one. A file that plants the name elsewhere inside a
  // failed drawing subtree must not get typed drawings preserved there.
  test('a stray txbxContent outside a text box opens no story', async () => {
    const { surface, container } = await mountWithImages(
      docx({ bodyRuns: strayStoryNameDrawing(), footnoteRuns: '<w:r><w:t>plain</w:t></w:r>' })
    );
    const page = surface.layout().pages[0]!;
    expect(textboxDrawingKinds(page)).toEqual([]);
    surface.destroy();
    container.remove();
  });
});
