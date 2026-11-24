// Unsupported header/footer placeholders keep their authored wrap when body content fits.
// If a full-height placeholder prevents layout, one retry yields its exclusion only.
// The placeholder and source remain visible and unchanged. Supported drawings still refuse.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import {
  CT_NS,
  DRAWING_NS,
  IMG_REL,
  OD_REL,
  PNG_1X1,
  REL_NS,
  mountWithImages,
} from './image-decode-harness.ts';
import { ExportResourceError, openDocumentForExport } from '../../export/export-session.ts';
import { createFixedMeasurer } from '../../layout/fixed-measurer.ts';
import {
  observeUnsupportedElements,
  type UnsupportedElementHost,
} from '../../output/unsupported-elements.ts';
import type { SemanticLayout } from '../../layout/semantic-records.ts';

const WPG = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const V = 'urn:schemas-microsoft-com:vml';
const HDR_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header';
const FTR_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer';
const EMU = 12_700;

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

interface Group {
  /** Page-relative top edge in points. */
  readonly top: number;
  readonly height: number;
  /** A picture-only group paints; a picture beside a shadowed text box cannot. */
  readonly visible: boolean;
  readonly id: number;
  readonly missingPicture?: boolean;
}

/** A 300pt-wide top-and-bottom MC group, page-relative, at the left of the column. */
function groupRun({ top, height, visible, id, missingPicture }: Group): string {
  const cy = Math.round(height * EMU);
  const picture = missingPicture
    ? PICTURE_MEMBER.replace('r:embed="rIdImg"', 'r:link="rIdMissing"')
    : PICTURE_MEMBER;
  const members = visible ? picture : picture + TEXTBOX_MEMBER;
  return (
    '<w:r><mc:AlternateContent><mc:Choice Requires="wpg"><w:drawing>' +
    '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ' +
    `relativeHeight="${id}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">` +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
    `<wp:positionV relativeFrom="page"><wp:posOffset>${Math.round(top * EMU)}</wp:posOffset>` +
    `</wp:positionV><wp:extent cx="3810000" cy="${cy}"/>` +
    '<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapTopAndBottom/>' +
    `<wp:docPr id="${id}" name="Group ${id}"/>` +
    `<a:graphic><a:graphicData uri="${WPG}"><wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr>` +
    `<a:xfrm><a:off x="0" y="0"/><a:ext cx="3810000" cy="${cy}"/>` +
    `<a:chOff x="0" y="0"/><a:chExt cx="3810000" cy="${cy}"/></a:xfrm></wpg:grpSpPr>` +
    `${members}</wpg:wgp></a:graphicData></a:graphic></wp:anchor></w:drawing>` +
    '</mc:Choice><mc:Fallback><w:pict><v:group/></w:pict></mc:Fallback>' +
    '</mc:AlternateContent></w:r>'
  );
}

/** An A4 page, 1in margins: the body runs from 72pt to 769.9pt. */
function docx(header: readonly Group[], footer: readonly Group[] = []): Uint8Array {
  const namespaces = `${DRAWING_NS} xmlns:wpg="${WPG}" xmlns:mc="${MC}" xmlns:v="${V}"`;
  const story = (tag: 'hdr' | 'ftr', groups: readonly Group[], text: string) =>
    strToU8(
      `<w:${tag} ${namespaces}><w:p>${groups.map(groupRun).join('')}` +
        `<w:r><w:t>${text}</w:t></w:r></w:p></w:${tag}>`
    );
  const image = `<Relationship Id="rIdImg" Type="${IMG_REL}" Target="media/image1.png"/>`;
  const body = Array.from(
    { length: 6 },
    (_, index) => `<w:p><w:r><w:t>Body line ${index + 1}</w:t></w:r></w:p>`
  ).join('');
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
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL_NS}">${image}` +
        `<Relationship Id="rIdHdr" Type="${HDR_REL}" Target="header1.xml"/>` +
        `<Relationship Id="rIdFtr" Type="${FTR_REL}" Target="footer1.xml"/></Relationships>`
    ),
    'word/_rels/header1.xml.rels': strToU8(
      `<Relationships xmlns="${REL_NS}">${image}</Relationships>`
    ),
    'word/_rels/footer1.xml.rels': strToU8(
      `<Relationships xmlns="${REL_NS}">${image}</Relationships>`
    ),
    'word/media/image1.png': PNG_1X1,
    'word/header1.xml': story('hdr', header, 'Header'),
    'word/footer1.xml': story('ftr', footer, 'Footer'),
    'word/document.xml': strToU8(
      `<w:document ${namespaces} mc:Ignorable=""><w:body>${body}` +
        '<w:sectPr><w:headerReference w:type="default" r:id="rIdHdr"/>' +
        '<w:footerReference w:type="default" r:id="rIdFtr"/>' +
        '<w:pgSz w:w="11906" w:h="16838"/>' +
        '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>' +
        '</w:sectPr></w:body></w:document>'
    ),
  });
}

/** Every body line as [page, content-relative top], rounded to 0.01pt. */
function bodyLines(layout: SemanticLayout): readonly (readonly number[])[] {
  const lines: (readonly number[])[] = [];
  for (const page of layout.pages) {
    for (const fragment of page.fragments) {
      if (fragment.kind !== 'paragraph') continue;
      for (const line of fragment.lines) {
        lines.push([page.index, Math.round(line.box.y * 100) / 100]);
      }
    }
  }
  return lines;
}

async function mountedLines(bytes: Uint8Array): Promise<readonly (readonly number[])[]> {
  const { surface, container } = await mountWithImages(bytes);
  try {
    return bodyLines(surface.layout());
  } finally {
    surface.destroy();
    container.remove();
  }
}

async function exportedLines(bytes: Uint8Array): Promise<readonly (readonly number[])[]> {
  const opened = openDocumentForExport(bytes);
  if (!opened.ok) throw new Error(String(opened.reason));
  try {
    return bodyLines(await opened.session.layout());
  } finally {
    opened.session.dispose();
  }
}

/** Covers the whole body, 72pt to 769.9pt: 60pt to 840pt on the page. */
const UNSUPPORTED_FULL: Group = { top: 60, height: 780, visible: false, id: 11 };
const SUPPORTED_FULL: Group = { ...UNSUPPORTED_FULL, visible: true, id: 12 };
/** A 60pt band at 90pt to 150pt: the first body line fits above it. */
const UNSUPPORTED_BAND: Group = { top: 90, height: 60, visible: false, id: 13 };
const SUPPORTED_BAND: Group = { ...UNSUPPORTED_BAND, visible: true, id: 14 };
/** The same area, anchored in the footer. */
const UNSUPPORTED_FOOTER_FULL: Group = { ...UNSUPPORTED_FULL, id: 15 };

describe('unsupported header and footer footprints that leave no room', () => {
  const plain = docx([]);

  for (const [name, header, footer] of [
    ['an unsupported header group', [UNSUPPORTED_FULL], []],
    ['an unsupported footer group', [], [UNSUPPORTED_FOOTER_FULL]],
    [
      'two overlapping unsupported groups',
      [UNSUPPORTED_FULL, { ...UNSUPPORTED_BAND, top: 300 }],
      [],
    ],
  ] as const) {
    test(`${name} yields, so the document opens and exports`, async () => {
      const expected = await mountedLines(plain);
      const bytes = docx(header, footer);
      expect(await mountedLines(bytes)).toEqual(expected);
      expect(await exportedLines(bytes)).toEqual(await exportedLines(plain));
    });
  }

  test('the yielded placeholder retains its geometry, source, and saved content', async () => {
    const { surface, container } = await mountWithImages(docx([UNSUPPORTED_FULL]));
    let disconnect = () => {};
    let saved: Uint8Array;
    const expected = bodyLines(surface.layout());
    try {
      let hosts: readonly UnsupportedElementHost[] = [];
      disconnect = observeUnsupportedElements(container, (next) => {
        hosts = next;
      });
      expect(hosts).toHaveLength(1);
      const drawing = hosts[0]!.unsupported.drawing!;
      expect(drawing.accessibility.hidden).toBe(false);
      expect(drawing.width).toBe(300);
      expect(drawing.height).toBe(780);
      expect(hosts[0]!.unsupported.source?.localName).toBe('AlternateContent');
      expect(
        hosts[0]!.unsupported.source?.children.map((node) =>
          node.kind === 'textValue' ? '' : node.localName
        )
      ).toEqual(['Choice', 'Fallback']);
      saved = surface.save();
    } finally {
      disconnect();
      surface.destroy();
      container.remove();
    }
    expect(await mountedLines(saved!)).toEqual(expected);
  });

  test('a full-height group with a settled missing picture yields its placeholder wrap', async () => {
    const bytes = docx([{ ...SUPPORTED_FULL, missingPicture: true }]);
    expect(await mountedLines(bytes)).toEqual(await mountedLines(plain));
    expect(await exportedLines(bytes)).toEqual(await exportedLines(plain));
  });

  test('edits keep laying out after the unsupported group yields', async () => {
    const typed = async (bytes: Uint8Array) => {
      const { surface, container } = await mountWithImages(bytes);
      try {
        const first = surface.layout().pages[0]!.fragments[0]!;
        if (first.kind !== 'paragraph') throw new Error('expected a body paragraph');
        const end = { paragraphId: first.paragraphId, offset: 'Body line 1'.length };
        surface.setSelection({ anchor: end, head: end });
        for (const text of ['!', ' more text']) surface.type(text);
        expect(surface.state().lastRejection).toBeFalsy();
        return bodyLines(surface.layout());
      } finally {
        surface.destroy();
        container.remove();
      }
    };
    expect(await typed(docx([UNSUPPORTED_FULL]))).toEqual(await typed(plain));
  });

  test('a supported band still wraps when an unsupported group beside it yields', async () => {
    const withVisible = docx([UNSUPPORTED_FULL, SUPPORTED_BAND]);
    const visibleOnly = docx([SUPPORTED_BAND]);
    const lines = await mountedLines(withVisible);
    expect(lines).toEqual(await mountedLines(visibleOnly));
    // The first body line ends above the band; the second starts under it, 150pt - 72pt down.
    expect(lines[1]![1]).toBeGreaterThanOrEqual(150 - 72);
    expect(await exportedLines(withVisible)).toEqual(await exportedLines(visibleOnly));
  });

  test('an unsupported band that leaves room still wraps', async () => {
    const lines = await mountedLines(docx([UNSUPPORTED_BAND]));
    expect(lines).toEqual(await mountedLines(docx([SUPPORTED_BAND])));
    expect(lines).not.toEqual(await mountedLines(plain));
  });
});

test('hidden furniture does not retry or replace a hostile host failure', async () => {
  const hostile = new Proxy(new Error('host failure'), {
    get() {
      throw new Error('property trap escaped');
    },
    getPrototypeOf() {
      throw new Error('prototype trap escaped');
    },
  });
  let failures = 0;
  const fallback = createFixedMeasurer();
  const opened = openDocumentForExport(docx([UNSUPPORTED_BAND]), {
    measurer: {
      measure(text, style) {
        if (text.includes('Body')) {
          failures++;
          throw hostile;
        }
        return fallback.measure(text, style);
      },
      lineMetrics: (style) => fallback.lineMetrics(style),
    },
  });
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  try {
    const error = await opened.session.layout().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ExportResourceError);
    expect(error).toMatchObject({ code: 'layoutFailed', message: 'Export layout failed' });
    expect((error as Error).cause).toBe(hostile);
    expect(failures).toBe(1);
  } finally {
    opened.session.dispose();
  }
});

describe('supported header drawings that leave no room', () => {
  test('still refuse to lay out', async () => {
    await expect(mountWithImages(docx([SUPPORTED_FULL]))).rejects.toThrow(/no room/);
    await expect(exportedLines(docx([SUPPORTED_FULL]))).rejects.toThrow();
  });

  test('still refuse when an unsupported group is also present', async () => {
    const bytes = docx([SUPPORTED_FULL, UNSUPPORTED_BAND]);
    await expect(mountWithImages(bytes)).rejects.toThrow(/no room for body content/);
    await expect(exportedLines(bytes)).rejects.toThrow();
  });
});
