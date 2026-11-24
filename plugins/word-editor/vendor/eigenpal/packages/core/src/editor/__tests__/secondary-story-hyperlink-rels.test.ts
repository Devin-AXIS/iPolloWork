// Hyperlink relationship scope for headers, footers, and hosted text-box stories.
//
// Every OOXML part owns its own relationship namespace. Reusing the same r:id in the body,
// header, and footer is legal, so both direct text and text hosted by a drawing must retain the
// projector of the part that owns them all the way through layout and paint.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import type {
  AnchoredDrawingRecord,
  BlockFragmentRecord,
  HeaderFooterStoryLayout,
  InlineDrawingLayoutContext,
  PendingLine,
  StyleSpanRecord,
} from '../../layout/index.ts';
import {
  createDocumentFurnitureSource,
  createDocumentLinkProjectors,
  createFixedMeasurer,
  createLayoutSession,
  createParagraphLayoutCache,
} from '../../layout/index.ts';
import { layoutDocumentView } from '../../layout/document-layout-coordinator.ts';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import {
  readOoxmlPackage,
  relationshipTargetIn,
  resolveHeaderFooterPartsBySection,
  type HeadlessDocumentView,
  type OoxmlPackage,
  type OoxmlPart,
} from '../../store/package/index.ts';
import { createDocxEditor } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';

function linkedParagraph(label: string): string {
  return `<w:p><w:hyperlink r:id="rId7"><w:r><w:t>${label}</w:t></w:r></w:hyperlink></w:p>`;
}

function linkedTextbox(
  label: string,
  drawingId: number,
  yEmu: number,
  withTableContent = false
): string {
  const content = withTableContent
    ? '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>' +
      '<w:tr><w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>' +
      linkedParagraph(label) +
      '</w:tc></w:tr></w:tbl>'
    : linkedParagraph(label);
  return (
    '<w:p><w:r><w:drawing>' +
    '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0"' +
    ' relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="page"><wp:posOffset>1800000</wp:posOffset></wp:positionH>' +
    `<wp:positionV relativeFrom="page"><wp:posOffset>${yEmu}</wp:posOffset></wp:positionV>` +
    '<wp:extent cx="1800000" cy="500000"/>' +
    '<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>' +
    `<wp:docPr id="${drawingId}" name="Linked textbox ${drawingId}"/>` +
    `<a:graphic><a:graphicData uri="${WPS}"><wps:wsp>` +
    '<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1800000" cy="500000"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>' +
    `<wps:txbx><w:txbxContent>${content}</w:txbxContent></wps:txbx>` +
    '<wps:bodyPr lIns="0" tIns="0" rIns="0" bIns="0"/>' +
    '</wps:wsp></a:graphicData></a:graphic></wp:anchor>' +
    '</w:drawing></w:r></w:p>'
  );
}

function textboxInTableCell(label: string, drawingId: number, yEmu: number): string {
  return (
    '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>' +
    '<w:tr><w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>' +
    linkedTextbox(label, drawingId, yEmu) +
    '</w:tc></w:tr></w:tbl>'
  );
}

function targetFor(owner: 'body' | 'header' | 'footer', suffix = ''): string {
  return `https://${owner}${suffix ? `.${suffix}` : ''}.example/`;
}

/** One rId, three owners: each occurrence must resolve in the part that contains it. */
function conflictingSecondaryStoryRelsDoc(suffix = ''): Uint8Array {
  const namespaces = `xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:wps="${WPS}"`;
  const relationships = (target: string) =>
    `<Relationships xmlns="${REL}">` +
    `<Relationship Id="rId7" Type="${R}/hyperlink" Target="${target}" TargetMode="External"/>` +
    '</Relationships>';

  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
        '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rDoc" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rHeader" Type="${R}/header" Target="header1.xml"/>` +
        `<Relationship Id="rFooter" Type="${R}/footer" Target="footer1.xml"/>` +
        `<Relationship Id="rId7" Type="${R}/hyperlink" Target="${targetFor('body', suffix)}" TargetMode="External"/>` +
        '</Relationships>'
    ),
    'word/_rels/header1.xml.rels': strToU8(relationships(targetFor('header', suffix))),
    'word/_rels/footer1.xml.rels': strToU8(relationships(targetFor('footer', suffix))),
    'word/document.xml': strToU8(
      `<w:document ${namespaces}><w:body>` +
        linkedParagraph('BodyLink') +
        linkedTextbox('BodyTextboxLink', 1, 3_000_000) +
        '<w:sectPr>' +
        '<w:headerReference w:type="default" r:id="rHeader"/>' +
        '<w:footerReference w:type="default" r:id="rFooter"/>' +
        '<w:pgSz w:w="11906" w:h="16838"/>' +
        '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>' +
        '</w:sectPr></w:body></w:document>'
    ),
    'word/header1.xml': strToU8(
      `<w:hdr ${namespaces}>` +
        linkedParagraph('HeaderLink') +
        linkedTextbox('HeaderTextboxLink', 2, 500_000, true) +
        textboxInTableCell('CellHostedTextboxLink', 4, 1_000_000) +
        '</w:hdr>'
    ),
    'word/footer1.xml': strToU8(
      `<w:ftr ${namespaces}>` +
        linkedParagraph('FooterLink') +
        linkedTextbox('FooterTextboxLink', 3, 9_500_000) +
        '</w:ftr>'
    ),
  });
}

function openPackage(bytes: Uint8Array): OoxmlPackage {
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.package;
}

function drawingLayoutFor(part: OoxmlPart): InlineDrawingLayoutContext {
  const projections = indexInlineDrawingProjectionsInPart(part);
  return {
    ownerPartName: part.name,
    projectionForAtom: (atomId) => projections.get(atomId) ?? null,
    project: (node) =>
      projections.get(node.id) ??
      projectDrawing(node, {
        ownerPartName: part.name,
        limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
      }),
    resourceOf: () => ({ kind: 'missing', relationshipId: 'none' }),
  };
}

function spansIn(fragments: readonly BlockFragmentRecord[]): StyleSpanRecord[] {
  const spans: StyleSpanRecord[] = [];
  for (const fragment of fragments) {
    if (fragment.kind === 'paragraph') {
      for (const line of fragment.lines) spans.push(...line.spans);
      continue;
    }
    for (const row of fragment.rows) {
      for (const cell of row.cells) spans.push(...spansIn(cell.blocks));
    }
  }
  return spans;
}

function textboxHrefs(drawings: readonly AnchoredDrawingRecord[] | undefined): string[] {
  return (drawings ?? []).flatMap((drawing) =>
    spansIn(drawing.textboxStory?.fragments ?? []).flatMap((span) =>
      span.link ? [span.link.href] : []
    )
  );
}

function textboxHref(drawings: readonly AnchoredDrawingRecord[] | undefined): string | null {
  return textboxHrefs(drawings)[0] ?? null;
}

function directHref(story: HeaderFooterStoryLayout | undefined): string | null {
  return spansIn(story?.fragments ?? []).find((span) => span.link)?.link?.href ?? null;
}

describe('secondary-story hyperlink relationship scope', () => {
  test('direct and text-box links resolve against their owning body, header, or footer part', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container, document: conflictingSecondaryStoryRelsDoc() });
    try {
      expect(editor.surface).not.toBeNull();

      const anchors = [...container.querySelectorAll<HTMLElement>('a.docx-hyperlink')];
      const anchorFor = (text: string): HTMLElement | undefined =>
        anchors.find((anchor) => anchor.textContent === text);
      const hrefFor = (text: string): string | null | undefined =>
        anchorFor(text)?.getAttribute('href');
      const page = editor.surface!.layout().pages[0]!;

      expect(hrefFor('BodyLink')).toBe('https://body.example/');
      expect(textboxHref(page.anchoredDrawings)).toBe('https://body.example/');
      expect(textboxHrefs(page.header?.anchoredDrawings)).toEqual([
        'https://header.example/',
        'https://header.example/',
      ]);
      expect(textboxHref(page.footer?.anchoredDrawings)).toBe('https://footer.example/');

      // Page furniture and text-box paint intentionally omit href while retaining an anchor +
      // link id. The semantic record above remains the target authority for export and future
      // interaction paths.
      for (const label of [
        'BodyTextboxLink',
        'HeaderLink',
        'HeaderTextboxLink',
        'FooterLink',
        'FooterTextboxLink',
      ]) {
        expect(anchorFor(label)?.dataset.docxLink).toBeTruthy();
        expect(hrefFor(label)).toBeNull();
      }
    } finally {
      editor.destroy();
      container.remove();
    }
  });

  test('a rels-only header retarget invalidates direct and hosted story records', () => {
    const firstPackage = openPackage(conflictingSecondaryStoryRelsDoc('one'));
    const secondPackage = openPackage(conflictingSecondaryStoryRelsDoc('two'));
    let pkg = firstPackage;
    const view: HeadlessDocumentView = {
      part: () => firstPackage.parts.get(firstPackage.mainDocumentPart)!,
      currentPackage: () => pkg,
      packageRevision: () => 1,
      stylesRoot: () => null,
      numberingRoot: () => null,
      settingsRoot: () => null,
      documentThemeFonts: () => ({ major: null, minor: null }),
      documentProperties: () => ({}),
      headerFooterPartsBySection: () => resolveHeaderFooterPartsBySection(pkg),
      relationshipTarget: (relationshipId) =>
        relationshipTargetIn(pkg, pkg.mainDocumentPart, relationshipId),
    };
    const links = createDocumentLinkProjectors(view);
    const cache = createParagraphLayoutCache<readonly PendingLine[]>();
    const furniture = createDocumentFurnitureSource({
      view,
      measurer: createFixedMeasurer(6, 14),
      producer: 'secondary-story-link-rels-only',
      cache,
      inlineDrawingLayoutForPart: (partName) => drawingLayoutFor(pkg.parts.get(partName)!),
      linkProjectors: links,
    });

    const first = furniture.furniture()!;
    const firstHeader = first.headers.get('default');
    const firstFooter = first.footers.get('default');
    expect(directHref(firstHeader)).toBe(targetFor('header', 'one'));
    expect(textboxHrefs(firstHeader?.anchoredDrawings)).toEqual([
      targetFor('header', 'one'),
      targetFor('header', 'one'),
    ]);
    const missesAfterFirst = cache.stats.misses;

    const relationships = new Map(firstPackage.relationships);
    relationships.set(
      '/word/header1.xml',
      secondPackage.relationships.get('/word/header1.xml') ?? []
    );
    pkg = Object.freeze({
      ...firstPackage,
      relationships,
      externalTargets: Object.freeze([
        ...firstPackage.externalTargets.filter(
          (target) => target.ownerPart !== '/word/header1.xml'
        ),
        ...secondPackage.externalTargets.filter(
          (target) => target.ownerPart === '/word/header1.xml'
        ),
      ]),
    });

    const updated = furniture.furniture()!;
    const updatedHeader = updated.headers.get('default');
    const updatedFooter = updated.footers.get('default');
    expect(updatedHeader).not.toBe(firstHeader);
    expect(directHref(updatedHeader)).toBe(targetFor('header', 'two'));
    expect(textboxHrefs(updatedHeader?.anchoredDrawings)).toEqual([
      targetFor('header', 'two'),
      targetFor('header', 'two'),
    ]);
    expect(updatedFooter).toBe(firstFooter);
    expect(directHref(updatedFooter)).toBe(targetFor('footer', 'one'));
    expect(textboxHref(updatedFooter?.anchoredDrawings)).toBe(targetFor('footer', 'one'));
    expect(cache.stats.misses - missesAfterFirst).toBeLessThanOrEqual(5);
  });

  test('a rels-only body retarget invalidates its hosted story with one cache and session', () => {
    const firstPackage = openPackage(conflictingSecondaryStoryRelsDoc('one'));
    const secondPackage = openPackage(conflictingSecondaryStoryRelsDoc('two'));
    let pkg = firstPackage;
    let revision = 1;
    const view: HeadlessDocumentView = {
      part: () => firstPackage.parts.get(firstPackage.mainDocumentPart)!,
      currentPackage: () => pkg,
      packageRevision: () => revision,
      stylesRoot: () => null,
      numberingRoot: () => null,
      settingsRoot: () => null,
      documentThemeFonts: () => ({ major: null, minor: null }),
      documentProperties: () => ({}),
      headerFooterPartsBySection: () => resolveHeaderFooterPartsBySection(pkg),
      relationshipTarget: (relationshipId) =>
        relationshipTargetIn(pkg, pkg.mainDocumentPart, relationshipId),
    };
    const links = createDocumentLinkProjectors(view);
    const cache = createParagraphLayoutCache<readonly PendingLine[]>();
    const session = createLayoutSession();
    const furniture = createDocumentFurnitureSource({
      view,
      measurer: createFixedMeasurer(6, 14),
      producer: 'body-textbox-link-rels-only',
      cache,
      inlineDrawingLayoutForPart: (partName) => drawingLayoutFor(pkg.parts.get(partName)!),
      linkProjectors: links,
    });
    const layout = () =>
      layoutDocumentView({
        view,
        revision,
        measurer: createFixedMeasurer(6, 14),
        cache,
        session,
        producer: 'body-textbox-link-rels-only',
        furniture,
        linkProjectors: links,
        inlineDrawingLayout: drawingLayoutFor(
          firstPackage.parts.get(firstPackage.mainDocumentPart)!
        ),
      });

    const first = layout();
    expect(textboxHref(first.pages[0]!.anchoredDrawings)).toBe(targetFor('body', 'one'));
    const missesAfterFirst = cache.stats.misses;

    const relationships = new Map(firstPackage.relationships);
    relationships.set(
      firstPackage.mainDocumentPart,
      secondPackage.relationships.get(secondPackage.mainDocumentPart) ?? []
    );
    pkg = Object.freeze({
      ...firstPackage,
      relationships,
      externalTargets: Object.freeze([
        ...firstPackage.externalTargets.filter(
          (target) => target.ownerPart !== firstPackage.mainDocumentPart
        ),
        ...secondPackage.externalTargets.filter(
          (target) => target.ownerPart === secondPackage.mainDocumentPart
        ),
      ]),
    });
    revision += 1;

    const updated = layout();
    expect(textboxHref(updated.pages[0]!.anchoredDrawings)).toBe(targetFor('body', 'two'));
    expect(directHref(updated.pages[0]!.header)).toBe(targetFor('header', 'one'));
    expect(textboxHrefs(updated.pages[0]!.header?.anchoredDrawings)).toEqual([
      targetFor('header', 'one'),
      targetFor('header', 'one'),
    ]);
    expect(directHref(updated.pages[0]!.footer)).toBe(targetFor('footer', 'one'));
    expect(textboxHref(updated.pages[0]!.footer?.anchoredDrawings)).toBe(
      targetFor('footer', 'one')
    );
    expect(cache.stats.misses - missesAfterFirst).toBeLessThanOrEqual(3);
  });
});
