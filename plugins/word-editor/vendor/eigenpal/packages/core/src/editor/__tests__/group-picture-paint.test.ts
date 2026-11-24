// A drawing group whose picture member sits behind the text on page 1, as a scanned
// letterhead does, with vector bars drawn over it. The group used to paint nothing, so the
// letterhead vanished from the page. This mounts real bytes, reads the laid-out record and
// the painted DOM, edits the anchor paragraph, and checks the group survives save and reopen.

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
const EMU_PER_POINT = 12_700;

function pictureMember(y: number, blip = '<a:blip r:embed="rIdImg"/>'): string {
  return (
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="2" name="Picture"/><pic:cNvPicPr/></pic:nvPicPr>' +
    `<pic:blipFill>${blip}<a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="${y}"/><a:ext cx="6350000" cy="1270000"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>'
  );
}

const BAR_MEMBER =
  '<wps:wsp><wps:cNvSpPr/><wps:spPr>' +
  '<a:xfrm><a:off x="1270000" y="3810000"/><a:ext cx="2540000" cy="12700"/></a:xfrm>' +
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
  '<a:solidFill><a:srgbClr val="000000"/></a:solidFill></wps:spPr><wps:bodyPr/></wps:wsp>';

/** A line along the top edge with a 10pt stroke: half the stroke lies above the extent. */
const TOP_EDGE_LINE_MEMBER =
  '<wps:wsp><wps:cNvSpPr/><wps:spPr>' +
  '<a:xfrm><a:off x="0" y="0"/><a:ext cx="6350000" cy="12700"/></a:xfrm>' +
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/>' +
  '<a:ln w="127000"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:ln>' +
  '</wps:spPr><wps:bodyPr/></wps:wsp>';

const LINKED_RELATIONSHIP =
  `<Relationship Id="rIdLink" Type="${IMG_REL}" ` +
  'Target="https://example.invalid/letterhead.png" TargetMode="External"/>';

interface GroupOptions {
  /** Wrap the drawing in `mc:AlternateContent`, as Word does. Defaults to true. */
  readonly alternateContent?: boolean;
  readonly effectExtent?: string;
  readonly relationships?: string;
  /** The bytes of `word/media/image1.png`, or null to leave the part out. */
  readonly media?: Uint8Array | null;
}

/** A page-anchored, behind-text group at (36pt, 18pt), 500pt x 600pt, in EMU child space. */
function groupRun(members: string, options: GroupOptions = {}): string {
  const drawing =
    '<w:drawing>' +
    '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="10" ' +
    'behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="page"><wp:posOffset>457200</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="page"><wp:posOffset>228600</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="6350000" cy="7620000"/>' +
    `<wp:effectExtent ${options.effectExtent ?? 'l="0" t="0" r="0" b="0"'}/>` +
    '<wp:wrapNone/><wp:docPr id="1" name="Group 1"/>' +
    `<a:graphic><a:graphicData uri="${WPG}"><wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr>` +
    '<a:xfrm><a:off x="0" y="0"/><a:ext cx="6350000" cy="7620000"/>' +
    '<a:chOff x="0" y="0"/><a:chExt cx="6350000" cy="7620000"/></a:xfrm></wpg:grpSpPr>' +
    `${members}</wpg:wgp></a:graphicData></a:graphic></wp:anchor></w:drawing>`;
  if (options.alternateContent === false) return `<w:r>${drawing}</w:r>`;
  return (
    `<w:r><mc:AlternateContent><mc:Choice Requires="wpg">${drawing}</mc:Choice>` +
    '<mc:Fallback><w:pict><v:group id="Group 1"/></w:pict></mc:Fallback></mc:AlternateContent></w:r>'
  );
}

function docx(members: string, options: GroupOptions = {}): Uint8Array {
  const media = options.media === undefined ? PNG_1X1 : options.media;
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
      `<Relationships xmlns="${REL_NS}">${
        options.relationships ??
        `<Relationship Id="rIdImg" Type="${IMG_REL}" Target="media/image1.png"/>`
      }</Relationships>`
    ),
    ...(media ? { 'word/media/image1.png': media } : {}),
    'word/document.xml': strToU8(
      `<w:document ${DRAWING_NS} xmlns:wpg="${WPG}" xmlns:mc="${MC}" xmlns:v="${V}" ` +
        'mc:Ignorable=""><w:body>' +
        `<w:p>${groupRun(members, options)}<w:r><w:t>Title</w:t></w:r></w:p>` +
        '<w:p><w:r><w:t>Body</w:t></w:r></w:p>' +
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
        '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>' +
        '</w:sectPr></w:body></w:document>'
    ),
  });
}

function groupRecord(surface: PaginatedSurface): AnchoredDrawingRecord | undefined {
  return surface.layout().pages[0]!.anchoredDrawings?.[0];
}

function boundsOf(points: readonly { readonly x: number; readonly y: number }[]) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
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

describe('a drawing group with a picture member', () => {
  test('lays out the picture in its member frame and paints it under the vector members', async () => {
    await withMounted(docx(pictureMember(0) + BAR_MEMBER), (surface, container) => {
      const record = groupRecord(surface)!;
      expect(record.groupPicture).toEqual({ alternateContent: true });
      expect(record.resource.kind).toBe('ready');
      // Still a non-picture graphic, as a vector shape is: image commands must not offer it.
      expect(record.placeholderGraphicKind).toBe('graphic');
      expect(record.vectorShape?.components).toHaveLength(1);
      // The drawing frame is the whole group; the image fills only the picture member.
      const content = record.geometry.contentBounds;
      expect(content.width).toBeCloseTo(500);
      expect(content.height).toBeCloseTo(600);
      const image = boundsOf(record.geometry.imageTransformCorners!);
      expect(image.x).toBeCloseTo(content.x);
      expect(image.y).toBeCloseTo(content.y);
      expect(image.width).toBeCloseTo(6_350_000 / EMU_PER_POINT);
      expect(image.height).toBeCloseTo(1_270_000 / EMU_PER_POINT);

      const painted = container.querySelector<HTMLElement>('.docx-drawing-ready')!;
      expect(painted).not.toBeNull();
      expect(container.querySelectorAll('.docx-drawing-placeholder')).toHaveLength(0);
      const frames = painted.querySelectorAll<HTMLElement>('.docx-drawing-image-frame');
      expect(frames).toHaveLength(2);
      // Image first, then the SVG of the vector members over it.
      expect(frames[0]!.querySelector('img')).not.toBeNull();
      expect(frames[0]!.style.height).toBe(`${100}px`);
      expect(frames[1]!.querySelector('svg path')?.getAttribute('fill')).toBe('#000000');
      expect(frames[1]!.style.height).toBe(`${600}px`);
    });
  });

  test('keeps the picture offset inside the group', async () => {
    await withMounted(docx(pictureMember(2_540_000)), (surface, container) => {
      const record = groupRecord(surface)!;
      expect(record.vectorShape).toBeNull();
      const image = boundsOf(record.geometry.imageTransformCorners!);
      expect(image.y - record.geometry.contentBounds.y).toBeCloseTo(200);
      const frame = container.querySelector<HTMLElement>(
        '.docx-drawing-ready .docx-drawing-image-frame'
      )!;
      expect(Number.parseFloat(frame.style.top)).toBeCloseTo(200);
    });
  });

  test('an edit beside the group keeps its source, and the saved file paints it again', async () => {
    let saved: Uint8Array | null = null;
    await withMounted(docx(pictureMember(0) + BAR_MEMBER), async (surface) => {
      const paragraphId = groupRecord(surface)!.anchorParagraphId;
      // One offset for the group atom, then the five characters of "Title".
      const end = { paragraphId, offset: 6 };
      surface.setSelection({ anchor: end, head: end });
      surface.type('!');
      expect(surface.state().lastRejection).toBeFalsy();
      saved = await surface.save();
    });
    const xml = strFromU8(unzipSync(saved!)['word/document.xml']!);
    expect(xml).toContain('Title!');
    expect(xml).toMatch(/<wpg:wgp>.*<pic:pic>.*r:embed="rIdImg".*<\/pic:pic><wps:wsp>/s);
    expect(xml).toContain('<mc:Fallback>');
    await withMounted(saved!, (surface, container) => {
      expect(groupRecord(surface)?.groupPicture).toEqual({ alternateContent: true });
      expect(container.querySelector('.docx-drawing-ready img')).not.toBeNull();
    });
  });
});

describe('a drawing group whose picture cannot render', () => {
  const failures: readonly (readonly [string, string, GroupOptions])[] = [
    [
      'linked',
      pictureMember(0, '<a:blip r:link="rIdLink"/>'),
      { relationships: LINKED_RELATIONSHIP, media: null },
    ],
    ['missing', pictureMember(0), { media: null }],
    ['corrupt', pictureMember(0), { media: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]) }],
  ];

  for (const [name, picture, options] of failures) {
    for (const [shape, members] of [
      ['picture-only', picture],
      ['picture and vector', picture + BAR_MEMBER],
    ] as const) {
      test(`an MC-wrapped ${shape} group with a ${name} picture shows one placeholder`, async () => {
        await withMounted(docx(members, options), (surface, container) => {
          expect(groupRecord(surface)).toBeDefined();
          expect(container.querySelectorAll('.docx-drawing-placeholder')).toHaveLength(1);
          expect(container.querySelectorAll('[data-docx-unsupported]')).toHaveLength(1);
          expect(container.textContent).toContain('Title');
        });
      });
    }
  }

  test('a bare group shows the refusal card, not its vector members alone', async () => {
    const options = { alternateContent: false, media: null } as const;
    await withMounted(docx(pictureMember(0) + BAR_MEMBER, options), (surface, container) => {
      const record = groupRecord(surface)!;
      expect(record.groupPicture).toEqual({ alternateContent: false });
      expect(record.resource.kind).toBe('missing');
      const painted = container.querySelectorAll<HTMLElement>('.docx-drawing');
      expect(painted).toHaveLength(1);
      expect(painted[0]!.classList.contains('docx-drawing-placeholder')).toBe(true);
      expect(painted[0]!.querySelector('svg')).toBeNull();
    });
  });
});

describe('a drawing group stroke in the effect extent', () => {
  test('clips the picture at the extent and leaves the stroke overhang visible', async () => {
    const options = { effectExtent: 'l="0" t="63500" r="0" b="0"' };
    const overhangs: string[] = [];
    for (const members of [TOP_EDGE_LINE_MEMBER, pictureMember(0) + TOP_EDGE_LINE_MEMBER]) {
      await withMounted(docx(members, options), (surface, container) => {
        const record = groupRecord(surface)!;
        expect(record.paintBounds.height).toBeCloseTo(605);
        const painted = container.querySelector<HTMLElement>('.docx-drawing')!;
        // The outer box ends at the paint bounds, which include the 5pt effect extent. The
        // 10pt outline keeps its full width, so the clip reaches 5pt past each side edge.
        expect(painted.style.clipPath).toBe('inset(0px -5px 0px -5px)');
        expect(painted.style.height).toBe('605px');
        const frames = painted.querySelectorAll<HTMLElement>('.docx-drawing-image-frame');
        const vector = frames[frames.length - 1]!;
        expect(vector.querySelector('svg')).not.toBeNull();
        overhangs.push(vector.style.top);
        if (frames.length === 2) {
          // Only the image frame is clipped, to the extent: 5pt of 105pt from its top edge.
          const image = frames[0]!;
          expect(image.querySelector('img')).not.toBeNull();
          expect(image.style.top).toBe('5px');
          expect(image.style.clipPath).toBe('polygon(0% 0%, 100% 0%, 100% 600%, 0% 600%)');
        }
      });
    }
    // The vector frame sits at the same place with or without the picture.
    expect(overhangs).toEqual(['5px', '5px']);
  });
});
