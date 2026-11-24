// A full-height unsupported header placeholder cannot prevent body content from opening.
// The bounded retry yields its exclusion while retaining smaller bands and supported drawings.
// These cases cover table-first flows, header variants, floating tables, and continued sections.

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
import { openDocumentForExport } from '../../export/export-session.ts';
import type { SemanticLayout } from '../../layout/semantic-records.ts';

const WPG = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const V = 'urn:schemas-microsoft-com:vml';
const HDR_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header';
const SETTINGS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings';
const EMU = 12_700;
const NS = `${DRAWING_NS} xmlns:wpg="${WPG}" xmlns:mc="${MC}" xmlns:v="${V}"`;

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
  readonly top: number;
  readonly height: number;
  /** A picture-only group paints; a picture beside a shadowed text box cannot. */
  readonly visible: boolean;
}

/** A 300pt-wide page-relative top-and-bottom MC group at the left of the column. */
function groupRun({ top, height, visible }: Group, id: number): string {
  const cy = Math.round(height * EMU);
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
    `${visible ? PICTURE_MEMBER : PICTURE_MEMBER + TEXTBOX_MEMBER}</wpg:wgp></a:graphicData>` +
    '</a:graphic></wp:anchor></w:drawing></mc:Choice>' +
    '<mc:Fallback><w:pict><v:group/></w:pict></mc:Fallback></mc:AlternateContent></w:r>'
  );
}

/** Covers the whole A4 body (72pt to 769.9pt): 60pt to 840pt on the page. */
const UNSUPPORTED_FULL: Group = { top: 60, height: 780, visible: false };
const SUPPORTED_FULL: Group = { ...UNSUPPORTED_FULL, visible: true };
/** 90pt to 150pt: leaves room for body text above and below. */
const UNSUPPORTED_BAND: Group = { top: 90, height: 60, visible: false };

const header = (...groups: Group[]) =>
  `<w:p>${groups.map((group, index) => groupRun(group, 10 + index)).join('')}` +
  '<w:r><w:t>Header</w:t></w:r></w:p>';

const para = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const lines = (count: number, prefix: string) =>
  Array.from({ length: count }, (_, index) => para(`${prefix} ${index + 1}`)).join('');

function table(rows: number): string {
  const cell = (text: string) =>
    `<w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/></w:tcPr>${para(text)}</w:tc>`;
  const body = Array.from(
    { length: rows },
    (_, index) => `<w:tr>${cell(`Row ${index + 1}`)}${cell('Value')}</w:tr>`
  ).join('');
  return (
    '<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/></w:tblPr>' +
    `<w:tblGrid><w:gridCol w:w="4500"/><w:gridCol w:w="4500"/></w:tblGrid>${body}</w:tbl>`
  );
}

const FLOATING_TABLE =
  '<w:tbl><w:tblPr><w:tblpPr w:leftFromText="180" w:rightFromText="180" w:vertAnchor="text" ' +
  'w:horzAnchor="margin" w:tblpY="200"/><w:tblW w:w="3000" w:type="dxa"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc><w:tcPr>' +
  `<w:tcW w:w="3000" w:type="dxa"/></w:tcPr>${para('Cell')}</w:tc></w:tr></w:tbl>`;

const PAGE =
  '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" ' +
  'w:left="1440" w:header="720" w:footer="720"/>';

/** A section break: `refs` maps a header type (default, first, even) to a header part id. */
function sectPr(refs: Readonly<Record<string, string>>, extra = ''): string {
  const references = Object.entries(refs)
    .map(([type, id]) => `<w:headerReference w:type="${type}" r:id="${id}"/>`)
    .join('');
  return `<w:sectPr>${references}${extra}${PAGE}</w:sectPr>`;
}

/** `headers` maps a header part id to its paragraphs; `body` holds its own final sectPr. */
function docx(
  headers: Readonly<Record<string, string>>,
  body: string,
  evenAndOdd = false
): Uint8Array {
  const image = `<Relationship Id="rIdImg" Type="${IMG_REL}" Target="media/image1.png"/>`;
  const files: Record<string, Uint8Array> = {};
  let overrides = '';
  let relationships =
    image + `<Relationship Id="rIdSet" Type="${SETTINGS_REL}" Target="settings.xml"/>`;
  for (const [id, inner] of Object.entries(headers)) {
    files[`word/${id}.xml`] = strToU8(`<w:hdr ${NS}>${inner}</w:hdr>`);
    files[`word/_rels/${id}.xml.rels`] = strToU8(
      `<Relationships xmlns="${REL_NS}">${image}</Relationships>`
    );
    overrides +=
      `<Override PartName="/word/${id}.xml" ` +
      'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>';
    relationships += `<Relationship Id="${id}" Type="${HDR_REL}" Target="${id}.xml"/>`;
  }
  return zipSync({
    ...files,
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT_NS}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="png" ContentType="image/png"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
        `${overrides}</Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OD_REL}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL_NS}">${relationships}</Relationships>`
    ),
    'word/media/image1.png': PNG_1X1,
    'word/settings.xml': strToU8(
      `<w:settings ${NS}>${evenAndOdd ? '<w:evenAndOddHeaders/>' : ''}</w:settings>`
    ),
    'word/document.xml': strToU8(
      `<w:document ${NS} mc:Ignorable=""><w:body>${body}</w:body></w:document>`
    ),
  });
}

/** Every body fragment as `page:kind@x,y,height`, plus each body paragraph line top. */
function flow(layout: SemanticLayout): readonly string[] {
  const round = (value: number) => Math.round(value * 100) / 100;
  const out: string[] = [];
  for (const page of layout.pages) {
    for (const fragment of page.fragments) {
      const { x, y, height } = fragment.box;
      out.push(`${page.index}:${fragment.kind}@${round(x)},${round(y)},${round(height)}`);
      if (fragment.kind === 'paragraph')
        for (const line of fragment.lines) out.push(`  line ${round(line.box.y)}`);
    }
  }
  return out;
}

async function mounted(bytes: Uint8Array): Promise<readonly string[]> {
  const { surface, container } = await mountWithImages(bytes);
  try {
    return flow(surface.layout());
  } finally {
    surface.destroy();
    container.remove();
  }
}

async function exported(bytes: Uint8Array): Promise<readonly string[]> {
  const opened = openDocumentForExport(bytes);
  if (!opened.ok) throw new Error(String(opened.reason));
  try {
    return flow(await opened.session.layout());
  } finally {
    opened.session.dispose();
  }
}

/** One document shape, built with the given header paragraphs and with an empty header. */
interface Case {
  readonly name: string;
  readonly build: (blocked: string) => Uint8Array;
  readonly blocked: string;
}

const cases: readonly Case[] = [
  {
    name: 'a table first under an unsupported default header',
    blocked: header(UNSUPPORTED_FULL),
    build: (h) => docx({ rIdH: h }, table(3) + lines(2, 'After') + sectPr({ default: 'rIdH' })),
  },
  {
    name: 'a table first under an unsupported first-page header only',
    blocked: header(UNSUPPORTED_FULL),
    build: (h) =>
      docx(
        { rIdF: h, rIdH: header() },
        table(3) + lines(2, 'After') + sectPr({ default: 'rIdH', first: 'rIdF' }, '<w:titlePg/>')
      ),
  },
  {
    name: 'a table on an even page under an unsupported even-page header',
    blocked: header(UNSUPPORTED_FULL),
    build: (h) =>
      docx(
        { rIdE: h, rIdH: header() },
        lines(2, 'Odd') +
          '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' +
          table(3) +
          sectPr({ default: 'rIdH', even: 'rIdE' }),
        true
      ),
  },
  {
    name: 'a second section that opens with a table under its unsupported header',
    blocked: header(UNSUPPORTED_FULL),
    build: (h) =>
      docx(
        { rIdA: header(), rIdB: h },
        lines(2, 'First') +
          `<w:p><w:pPr>${sectPr({ default: 'rIdA' })}</w:pPr></w:p>` +
          table(3) +
          sectPr({ default: 'rIdB' }, '<w:type w:val="nextPage"/>')
      ),
  },
  {
    name: 'a floating table under an unsupported default header',
    blocked: header(UNSUPPORTED_FULL),
    build: (h) =>
      docx(
        { rIdH: h },
        para('Before') + FLOATING_TABLE + lines(6, 'After') + sectPr({ default: 'rIdH' })
      ),
  },
];

describe('an unsupported header footprint that leaves no room', () => {
  for (const { name, build, blocked } of cases) {
    test(`${name} lays out as the file without it`, async () => {
      const plain = build(header());
      const bytes = build(blocked);
      expect(await mounted(bytes)).toEqual(await mounted(plain));
      expect(await exported(bytes)).toEqual(await exported(plain));
    });
  }

  test('a smaller unsupported header band keeps its wrap during the retry', async () => {
    const build = (h: string) =>
      docx({ rIdH: h }, table(3) + lines(2, 'After') + sectPr({ default: 'rIdH' }));
    const withBoth = await mounted(build(header(UNSUPPORTED_FULL, UNSUPPORTED_BAND)));
    // Only the full-height placeholder yields; the smaller band retains its wrap.
    expect(withBoth).toEqual(await mounted(build(header(UNSUPPORTED_BAND))));
  });

  test('edits keep laying out after the table-first flow yields', async () => {
    const typed = async (bytes: Uint8Array) => {
      const { surface, container } = await mountWithImages(bytes);
      try {
        const after = surface
          .layout()
          .pages.flatMap((page) => page.fragments)
          .find((fragment) => fragment.kind === 'paragraph');
        if (after?.kind !== 'paragraph') throw new Error('expected a paragraph after the table');
        const end = { paragraphId: after.paragraphId, offset: 'After 1'.length };
        surface.setSelection({ anchor: end, head: end });
        for (const text of ['!', ' and more']) surface.type(text);
        expect(surface.state().lastRejection).toBeFalsy();
        return flow(surface.layout());
      } finally {
        surface.destroy();
        container.remove();
      }
    };
    const build = (h: string) =>
      docx({ rIdH: h }, table(3) + lines(2, 'After') + sectPr({ default: 'rIdH' }));
    expect(await typed(build(header(UNSUPPORTED_FULL)))).toEqual(await typed(build(header())));
  });
});

// Known difference: the yield is decided per section. Section 1 yields on its sheet, but a
// continuous section 2 on that sheet still sees the host header's hidden zone, advances once,
// and starts on the next sheet. Nothing refuses and no content is lost.
test('a continuous section on a host sheet whose unsupported header yields keeps all content', async () => {
  const build = (h: string) =>
    docx(
      { rIdA: h, rIdB: header() },
      lines(3, 'First') +
        `<w:p><w:pPr>${sectPr({ default: 'rIdA' })}</w:pPr></w:p>` +
        lines(3, 'Second') +
        sectPr({ default: 'rIdB' }, '<w:type w:val="continuous"/>')
    );
  const count = (out: readonly string[]) =>
    out.filter((entry) => entry.startsWith('  line')).length;
  const plain = await mounted(build(header()));
  expect(count(await mounted(build(header(UNSUPPORTED_FULL))))).toBe(count(plain));
  expect(count(await exported(build(header(UNSUPPORTED_FULL))))).toBe(count(plain));
});

describe('a supported header drawing that leaves no room', () => {
  const build = (h: string) =>
    docx({ rIdH: h }, table(3) + lines(2, 'After') + sectPr({ default: 'rIdH' }));

  test('still refuses a table-first body', async () => {
    await expect(mountWithImages(build(header(SUPPORTED_FULL)))).rejects.toThrow(/cannot fit/);
    await expect(exported(build(header(SUPPORTED_FULL)))).rejects.toThrow();
  });

  test('still refuses when an unsupported group is also present', async () => {
    const bytes = build(header(SUPPORTED_FULL, UNSUPPORTED_BAND));
    await expect(mountWithImages(bytes)).rejects.toThrow(/cannot fit/);
    await expect(exported(bytes)).rejects.toThrow();
  });
});
