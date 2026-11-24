// Unsupported groups keep their authored geometry and expose one replaceable placeholder.
// Text wrapping, selection, tracked changes, and save/reopen use the same drawing record.

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
import {
  findDrawingOverlayFrameInLayout,
  hitAnchoredDrawingAtPoint,
} from '../../layout/semantic-hit-test.ts';
import type { PageRecord, SemanticLayout } from '../../layout/semantic-records.ts';
import { resolveSelectedDrawingRecord } from '../docx-editor-images.ts';
import type { PaginatedSurface } from '../paginated-surface.ts';

const WPG = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const V = 'urn:schemas-microsoft-com:vml';
const HDR_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header';
const LINK_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink';
const STYLES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';
// Format defaults, pinned so the fixture does not take the application defaults for omitted docDefaults.
const FORMAT_DOC_DEFAULTS =
  '<w:docDefaults><w:rPrDefault><w:rPr><w:kern w:val="2"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>';

const PICTURE_MEMBER =
  '<pic:pic><pic:nvPicPr><pic:cNvPr id="2" name="Picture"/><pic:cNvPicPr/></pic:nvPicPr>' +
  '<pic:blipFill><a:blip r:embed="rIdImg"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
  '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="762000" cy="762000"/></a:xfrm>' +
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>';

const TEXTBOX_MEMBER =
  '<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="889000" y="0"/>' +
  '<a:ext cx="2540000" cy="762000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
  '<a:effectLst><a:outerShdw dist="38100"/></a:effectLst></wps:spPr><wps:txbx><w:txbxContent><w:p><w:r><w:t>Group label</w:t></w:r></w:p>' +
  '</w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp>';

interface GroupOptions {
  /** Wrap the drawing in `mc:AlternateContent`, as Word does. Defaults to true. */
  readonly alternateContent?: boolean;
  readonly members?: string;
  readonly wrap?: string;
  readonly vertical?: string;
  readonly cy?: number;
  readonly docPrChildren?: string;
  /** Wrap the drawing's run in `w:ins`. */
  readonly tracked?: boolean;
}

/** A group at (0, 24pt) from its column and paragraph, 300pt x 60pt. */
function groupRun(options: GroupOptions = {}): string {
  const cy = options.cy ?? 762000;
  const drawing =
    '<w:drawing><wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" ' +
    'relativeHeight="5" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
    (options.vertical ??
      '<wp:positionV relativeFrom="paragraph"><wp:posOffset>304800</wp:posOffset></wp:positionV>') +
    `<wp:extent cx="3810000" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    (options.wrap ?? '<wp:wrapTopAndBottom/>') +
    `<wp:docPr id="1" name="Group 1">${options.docPrChildren ?? ''}</wp:docPr>` +
    `<a:graphic><a:graphicData uri="${WPG}"><wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr>` +
    `<a:xfrm><a:off x="0" y="0"/><a:ext cx="3810000" cy="${cy}"/>` +
    `<a:chOff x="0" y="0"/><a:chExt cx="3810000" cy="${cy}"/></a:xfrm></wpg:grpSpPr>` +
    `${options.members ?? PICTURE_MEMBER + TEXTBOX_MEMBER}</wpg:wgp></a:graphicData></a:graphic>` +
    '</wp:anchor></w:drawing>';
  const run =
    options.alternateContent === false
      ? `<w:r>${drawing}</w:r>`
      : `<w:r><mc:AlternateContent><mc:Choice Requires="wpg">${drawing}</mc:Choice>` +
        '<mc:Fallback><w:pict><v:group id="Group 1"/></w:pict></mc:Fallback>' +
        '</mc:AlternateContent></w:r>';
  return options.tracked
    ? `<w:ins w:id="7" w:author="Reviewer" w:date="2026-01-01T00:00:00Z">${run}</w:ins>`
    : run;
}

interface DocxOptions {
  readonly group?: GroupOptions;
  /** Put the group in the default header instead of the first body paragraph. */
  readonly inHeader?: boolean;
  readonly bodyLines?: number;
  /** The bytes of `word/media/image1.png`, or null to leave the part out. */
  readonly media?: Uint8Array | null;
  readonly relationships?: string;
}

function docx(options: DocxOptions = {}): Uint8Array {
  const media = options.media === undefined ? PNG_1X1 : options.media;
  const run = groupRun(options.group);
  const namespaces = `${DRAWING_NS} xmlns:wpg="${WPG}" xmlns:mc="${MC}" xmlns:v="${V}"`;
  const relationships =
    `<Relationship Id="rIdImg" Type="${IMG_REL}" Target="media/image1.png"/>` +
    `<Relationship Id="rIdLink" Type="${LINK_REL}" Target="https://example.invalid/" ` +
    'TargetMode="External"/>' +
    (options.relationships ?? '');
  const body =
    `<w:p>${options.inHeader ? '' : run}<w:r><w:t>First line</w:t></w:r></w:p>` +
    Array.from(
      { length: options.bodyLines ?? 3 },
      (_, index) => `<w:p><w:r><w:t>Body line ${index + 1}</w:t></w:r></w:p>`
    ).join('');
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT_NS}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="png" ContentType="image/png"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OD_REL}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL_NS}">${relationships}` +
        `<Relationship Id="rIdHdr" Type="${HDR_REL}" Target="header1.xml"/>` +
        `<Relationship Id="rIdStyles" Type="${STYLES_REL}" Target="styles.xml"/></Relationships>`
    ),
    'word/styles.xml': strToU8(`<w:styles ${namespaces}>${FORMAT_DOC_DEFAULTS}</w:styles>`),
    'word/_rels/header1.xml.rels': strToU8(
      `<Relationships xmlns="${REL_NS}">${relationships}</Relationships>`
    ),
    ...(media ? { 'word/media/image1.png': media } : {}),
    'word/header1.xml': strToU8(
      `<w:hdr ${namespaces}><w:p>${options.inHeader ? run : ''}` +
        '<w:r><w:t>Header</w:t></w:r></w:p></w:hdr>'
    ),
    'word/document.xml': strToU8(
      `<w:document ${namespaces} mc:Ignorable=""><w:body>${body}` +
        '<w:sectPr><w:headerReference w:type="default" r:id="rIdHdr"/>' +
        '<w:pgSz w:w="11906" w:h="16838"/>' +
        '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>' +
        '</w:sectPr></w:body></w:document>'
    ),
  });
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

/** Every body line as [page, content-relative top, x, width], rounded to 0.01pt. */
function bodyLines(layout: SemanticLayout): readonly (readonly number[])[] {
  const round = (value: number) => Math.round(value * 100) / 100;
  const lines: (readonly number[])[] = [];
  for (const page of layout.pages) {
    for (const fragment of page.fragments) {
      if (fragment.kind !== 'paragraph') continue;
      for (const line of fragment.lines) {
        lines.push([page.index, round(line.box.y), round(line.box.x), round(line.box.width)]);
      }
    }
  }
  return lines;
}

function anchored(page: PageRecord, inHeader = false): readonly AnchoredDrawingRecord[] {
  return (inHeader ? page.header?.anchoredDrawings : page.anchoredDrawings) ?? [];
}

async function linesOf(options: DocxOptions): Promise<readonly (readonly number[])[]> {
  let lines: readonly (readonly number[])[] = [];
  await withMounted(docx(options), (surface) => {
    lines = bodyLines(surface.layout());
  });
  return lines;
}

describe('an MC group that cannot paint', () => {
  test('keeps its top-and-bottom band and paints one placeholder', async () => {
    await withMounted(docx(), (surface, container) => {
      const layout = surface.layout();
      const [record, ...rest] = anchored(layout.pages[0]!);
      expect(rest).toHaveLength(0);
      expect(record!.accessibility.hidden).toBe(false);
      expect(record!.wrap).toBe('topAndBottom');
      const lines = bodyLines(layout);
      // The anchor's own first line stays at the top; the next line starts under the band,
      // 24pt + 60pt below the paragraph.
      expect(lines[0]![1]).toBeCloseTo(0, 1);
      expect(lines[1]![1]).toBeGreaterThanOrEqual(84);
      expect(container.querySelectorAll('.docx-drawing-placeholder')).toHaveLength(1);
      expect(container.querySelector('img')).toBeNull();
      expect(container.textContent).not.toContain('Group label');
    });
  });

  test('moves text the way the same group drawn as a placeholder does', async () => {
    const wraps = [
      '<wp:wrapTopAndBottom/>',
      '<wp:wrapSquare wrapText="bothSides"/>',
      '<wp:wrapSquare wrapText="right"/>',
    ];
    for (const wrap of wraps) {
      const hidden = await linesOf({ group: { wrap } });
      const drawn = await linesOf({ group: { wrap, alternateContent: false } });
      expect(hidden).toEqual(drawn);
    }
  });

  test('wrapNone still reserves nothing', async () => {
    const options = { group: { wrap: '<wp:wrapNone/>' } };
    await withMounted(docx(options), (surface) => {
      expect(anchored(surface.layout().pages[0]!)).toHaveLength(1);
      const lines = bodyLines(surface.layout());
      expect(lines[1]![1]).toBeLessThan(30);
    });
  });

  test('keeps the page count of the drawn group', async () => {
    const hidden = await linesOf({ bodyLines: 52 });
    const drawn = await linesOf({ bodyLines: 52, group: { alternateContent: false } });
    expect(hidden.at(-1)![0]).toBe(1);
    expect(hidden).toEqual(drawn);
  });

  test('an extent taller than a page ends the layout as a drawn MC group does', async () => {
    // MC reads the out-of-range extent at its clamp; the painted picture-only group lays out
    // from the same bound, so the band pushes the rest to one more page and stops.
    const cy = 99_999_999_999_999;
    const hidden = await linesOf({ group: { cy } });
    const drawn = await linesOf({ group: { cy, members: PICTURE_MEMBER } });
    expect(hidden).toEqual(drawn);
    expect(hidden.at(-1)![0]).toBe(1);
  });

  test('keeps selection and sanitized links on the visible placeholder', async () => {
    const docPrChildren = '<a:hlinkClick r:id="rIdLink"/>';
    await withMounted(docx({ group: { docPrChildren } }), (surface) => {
      const page = surface.layout().pages[0]!;
      const record = anchored(page)[0]!;
      expect(record.hyperlinkHref).toBe('https://example.invalid/');
      const box = record.hitBounds;
      const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      expect(hitAnchoredDrawingAtPoint([record], center, page.index)).not.toBeNull();
      expect(
        findDrawingOverlayFrameInLayout(surface.layout(), record.drawingNodeId)
      ).not.toBeNull();
      expect(surface.selectDrawing(record.drawingNodeId, record.paragraphId)).toBe(true);
      expect(resolveSelectedDrawingRecord(surface)?.drawingNodeId).toBe(record.drawingNodeId);
    });
  });

  test('a tracked insertion retains its change bar on the visible group', async () => {
    await withMounted(docx({ group: { tracked: true } }), (surface, container) => {
      const page = surface.layout().pages[0]!;
      expect(anchored(page)[0]!.accessibility.hidden).toBe(false);
      const first = page.fragments[0]!;
      expect(first.kind === 'paragraph' && first.lines[0]!.anchorRevisions).toBeTruthy();
      expect(container.querySelectorAll('.docx-drawing-placeholder')).toHaveLength(1);
    });
  });

  test('an edit beside it keeps the authored group, and reopening lays it out again', async () => {
    let saved: Uint8Array | null = null;
    let before: readonly (readonly number[])[] = [];
    await withMounted(docx(), async (surface) => {
      before = bodyLines(surface.layout());
      const record = anchored(surface.layout().pages[0]!)[0]!;
      // One offset for the group atom, then the ten characters of "First line".
      const end = { paragraphId: record.anchorParagraphId, offset: 11 };
      surface.setSelection({ anchor: end, head: end });
      surface.type('!');
      expect(surface.state().lastRejection).toBeFalsy();
      saved = await surface.save();
    });
    const xml = strFromU8(unzipSync(saved!)['word/document.xml']!);
    expect(xml).toContain('First line!');
    expect(xml).toMatch(/<wpg:wgp>.*<pic:pic>.*<wps:txbx>.*Group label.*<\/wpg:wgp>/s);
    expect(xml).toContain('<mc:Fallback><w:pict><v:group id="Group 1"/></w:pict></mc:Fallback>');
    await withMounted(saved!, (surface) => {
      expect(anchored(surface.layout().pages[0]!)[0]!.accessibility.hidden).toBe(false);
      expect(bodyLines(surface.layout()).slice(1)).toEqual(before.slice(1));
    });
  });

  test('in a header, moves body text the way the drawn group does', async () => {
    const group = {
      vertical:
        '<wp:positionV relativeFrom="page"><wp:posOffset>1143000</wp:posOffset></wp:positionV>',
    };
    const hidden = await linesOf({ inHeader: true, group });
    const drawn = await linesOf({ inHeader: true, group: { ...group, alternateContent: false } });
    expect(hidden).toEqual(drawn);
    // The band runs from 90pt to 150pt on the page. The first body line ends above it; the
    // second starts under it, 150pt - 72pt into the content box.
    expect(hidden[0]![1]).toBeCloseTo(0, 1);
    expect(hidden[1]![1]).toBeCloseTo(150 - 72, 1);
    await withMounted(docx({ inHeader: true, group }), (surface, container) => {
      expect(anchored(surface.layout().pages[0]!, true)[0]!.accessibility.hidden).toBe(false);
      expect(container.querySelectorAll('.docx-drawing-placeholder')).toHaveLength(1);
    });
  });
});

describe('an MC group whose picture cannot render', () => {
  const linked =
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="2" name="Picture"/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:link="rIdRemote"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="762000" cy="762000"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>';
  const failures: readonly (readonly [string, DocxOptions])[] = [
    ['missing', { media: null }],
    ['corrupt', { media: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]) }],
    [
      'linked',
      {
        media: null,
        group: { members: linked },
        relationships:
          `<Relationship Id="rIdRemote" Type="${IMG_REL}" ` +
          'Target="https://example.invalid/picture.png" TargetMode="External"/>',
      },
    ],
  ];

  for (const [name, options] of failures) {
    test(`keeps the band of the ready group when the picture is ${name}`, async () => {
      const ready = await linesOf({ group: { members: PICTURE_MEMBER } });
      const group = { members: PICTURE_MEMBER, ...options.group };
      await withMounted(docx({ ...options, group }), (surface, container) => {
        const record = anchored(surface.layout().pages[0]!)[0]!;
        expect(record.accessibility.hidden).toBe(false);
        expect(record.groupPicture).toBeDefined();
        expect(record.resource.kind).not.toBe('ready');
        expect(bodyLines(surface.layout())).toEqual(ready);
        expect(container.querySelectorAll('.docx-drawing-placeholder')).toHaveLength(1);
        expect(container.querySelector('img')).toBeNull();
      });
    });
  }
});
