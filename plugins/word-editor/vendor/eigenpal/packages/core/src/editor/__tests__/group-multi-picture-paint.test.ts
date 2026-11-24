// A drawing group with two picture members, a text box member, and a vector member. The
// group used to paint nothing, its text box text included, because the group picture read
// accepted one picture only. This mounts real bytes and checks the laid-out record, the
// painted DOM, the paint order, the crop of the second picture, the text box text, and that
// the group survives save and reopen.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import {
  CT_NS,
  DRAWING_NS,
  IMG_REL,
  OD_REL,
  PNG_1X1,
  REL_NS,
  mountWithImages,
} from './image-decode-harness.ts';
import type { AnchoredDrawingRecord } from '../../layout/drawing-layout.ts';
import type { PaginatedSurface } from '../paginated-surface.ts';

const WPG = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const V = 'urn:schemas-microsoft-com:vml';

/** A 100pt square picture at (x, y) in group child space, which is offset by (0, -635000). */
function pictureMember(id: string, x: number, y: number, srcRect = ''): string {
  return (
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="2" name="Picture"/><pic:cNvPicPr/></pic:nvPicPr>' +
    `<pic:blipFill><a:blip r:embed="${id}"/>${srcRect}<a:stretch><a:fillRect/></a:stretch>` +
    `</pic:blipFill><pic:spPr><a:xfrm><a:off x="${x}" y="${y}"/>` +
    '<a:ext cx="1270000" cy="1270000"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>'
  );
}

/** An unfilled, unoutlined text box at the right of the group, first in document order. */
const TEXTBOX_MEMBER =
  '<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr>' +
  '<a:xfrm><a:off x="3810000" y="-635000"/><a:ext cx="2540000" cy="1270000"/></a:xfrm>' +
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln>' +
  '</wps:spPr><wps:txbx><w:txbxContent><w:p><w:r><w:t>Heading</w:t></w:r></w:p>' +
  '</w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp>';

const BAR_MEMBER =
  '<wps:wsp><wps:cNvSpPr/><wps:spPr>' +
  '<a:xfrm><a:off x="0" y="1270000"/><a:ext cx="2540000" cy="12700"/></a:xfrm>' +
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
  '<a:solidFill><a:srgbClr val="000000"/></a:solidFill></wps:spPr><wps:bodyPr/></wps:wsp>';

const CROP = '<a:srcRect t="20000" b="5000"/>';

const MEMBERS =
  TEXTBOX_MEMBER +
  pictureMember('rIdImg', 0, -635000) +
  pictureMember('rIdImg2', 1905000, 0, CROP) +
  BAR_MEMBER;

/**
 * A page-anchored group at (36pt, 18pt), 500pt x 200pt. Its child space starts at a negative
 * y offset, so every member's frame moves down by 635000 EMU.
 */
function groupRun(members: string): string {
  const drawing =
    '<w:drawing>' +
    '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="10" ' +
    'behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="page"><wp:posOffset>457200</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="page"><wp:posOffset>228600</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="6350000" cy="2540000"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    '<wp:wrapNone/><wp:docPr id="1" name="Group 1"/>' +
    `<a:graphic><a:graphicData uri="${WPG}"><wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr>` +
    '<a:xfrm><a:off x="0" y="0"/><a:ext cx="6350000" cy="2540000"/>' +
    '<a:chOff x="0" y="-635000"/><a:chExt cx="6350000" cy="2540000"/></a:xfrm>' +
    `</wpg:grpSpPr>${members}</wpg:wgp></a:graphicData></a:graphic></wp:anchor></w:drawing>`;
  return (
    `<w:r><mc:AlternateContent><mc:Choice Requires="wpg">${drawing}</mc:Choice>` +
    '<mc:Fallback><w:pict><v:group id="Group 1"/></w:pict></mc:Fallback></mc:AlternateContent></w:r>'
  );
}

function docx(members: string, secondMedia: Uint8Array | null = PNG_1X1): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT_NS}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="png" ContentType="image/png"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OD_REL}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rIdImg" Type="${IMG_REL}" Target="media/image1.png"/>` +
        `<Relationship Id="rIdImg2" Type="${IMG_REL}" Target="media/image2.png"/>` +
        '</Relationships>'
    ),
    'word/media/image1.png': PNG_1X1,
    ...(secondMedia ? { 'word/media/image2.png': secondMedia } : {}),
    'word/document.xml': strToU8(
      `<w:document ${DRAWING_NS} xmlns:wpg="${WPG}" xmlns:mc="${MC}" xmlns:v="${V}" ` +
        'mc:Ignorable=""><w:body>' +
        `<w:p>${groupRun(members)}<w:r><w:t>Title</w:t></w:r></w:p>` +
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
        '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>' +
        '</w:sectPr></w:body></w:document>'
    ),
  });
}

function groupRecord(surface: PaginatedSurface): AnchoredDrawingRecord | undefined {
  return surface.layout().pages[0]!.anchoredDrawings?.[0];
}

async function withMounted(
  bytes: Uint8Array,
  run: (surface: PaginatedSurface, container: HTMLElement) => Promise<void> | void
): Promise<void> {
  const { surface, container } = await mountWithImages(bytes);
  try {
    await run(surface, container);
  } finally {
    surface.destroy();
    container.remove();
  }
}

function expectGroupPainted(container: HTMLElement): void {
  const painted = container.querySelector<HTMLElement>('.docx-drawing-ready')!;
  expect(painted).not.toBeNull();
  expect(container.querySelectorAll('.docx-drawing-placeholder')).toHaveLength(0);
  const frames = painted.querySelectorAll<HTMLElement>('.docx-drawing-image-frame');
  // Both pictures in document order, then the SVG of the vector member over them.
  expect(frames).toHaveLength(3);
  expect(frames[0]!.querySelector('img')).not.toBeNull();
  expect(frames[1]!.querySelector('img')).not.toBeNull();
  expect(frames[2]!.querySelector('svg path')?.getAttribute('fill')).toBe('#000000');
  // The first picture sits at the top left; the negative child offset moves it down 50pt.
  expect(Number.parseFloat(frames[0]!.style.left)).toBeCloseTo(0);
  expect(Number.parseFloat(frames[0]!.style.top)).toBeCloseTo(0);
  // The second picture keeps its own frame and its own crop.
  expect(Number.parseFloat(frames[1]!.style.left)).toBeCloseTo(150);
  expect(Number.parseFloat(frames[1]!.style.top)).toBeCloseTo(50);
  expect(Number.parseFloat(frames[1]!.style.width)).toBeCloseTo(100);
  const second = frames[1]!.querySelector<HTMLElement>('img')!;
  expect(Number.parseFloat(second.style.height)).toBeCloseTo(100 / 0.75);
  expect(Number.parseFloat(second.style.top)).toBeCloseTo((-0.2 / 0.75) * 100);
  expect(container.querySelector('.docx-drawing-group-text')?.textContent).toContain('Heading');
}

describe('a drawing group with two picture members', () => {
  test('lays out both pictures and paints them in document order under the vector member', async () => {
    await withMounted(docx(MEMBERS), (surface, container) => {
      const record = groupRecord(surface)!;
      expect(record.groupPicture).toEqual({ alternateContent: true });
      expect(record.resource.kind).toBe('ready');
      expect(record.crop).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
      expect(record.groupPictureLayers).toHaveLength(1);
      const layer = record.groupPictureLayers![0]!;
      expect(layer.resource.kind).toBe('ready');
      expect(layer.crop).toEqual({ left: 0, top: 0.2, right: 0, bottom: 0.05 });
      expect(layer.frameUnit.x).toBeCloseTo(0.3);
      expect(layer.frameUnit.y).toBeCloseTo(0.25);
      expect(layer.frameUnit.width).toBeCloseTo(0.2);
      expect(layer.frameUnit.height).toBeCloseTo(0.5);
      expect(record.vectorShape?.components).toHaveLength(1);
      expect(record.groupTextboxStories).toHaveLength(1);
      expectGroupPainted(container);
    });
  });

  test('an edit beside the group keeps both pictures, and the saved file paints them again', async () => {
    let saved: Uint8Array | null = null;
    await withMounted(docx(MEMBERS), async (surface) => {
      const paragraphId = groupRecord(surface)!.anchorParagraphId;
      const end = { paragraphId, offset: 6 };
      surface.setSelection({ anchor: end, head: end });
      surface.type('!');
      expect(surface.state().lastRejection).toBeFalsy();
      saved = await surface.save();
    });
    const xml = strFromU8(unzipSync(saved!)['word/document.xml']!);
    expect(xml).toContain('Title!');
    expect(xml).toMatch(/r:embed="rIdImg".*r:embed="rIdImg2".*<a:srcRect b="5000" t="20000"\/>/s);
    await withMounted(saved!, (surface, container) => {
      expect(groupRecord(surface)?.groupPictureLayers).toHaveLength(1);
      expectGroupPainted(container);
    });
  });

  test('an MC-wrapped group whose second picture is missing shows one placeholder', async () => {
    await withMounted(docx(MEMBERS, null), (surface, container) => {
      expect(groupRecord(surface)).toBeDefined();
      expect(container.querySelectorAll('.docx-drawing-placeholder')).toHaveLength(1);
      expect(container.textContent).toContain('Title');
    });
  });
});
