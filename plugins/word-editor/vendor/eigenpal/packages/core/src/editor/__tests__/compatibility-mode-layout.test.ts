import { expect, test } from 'bun:test';
import { strToU8, zipSync, unzipSync } from 'fflate';
import {
  readOoxmlPart,
  readOoxmlPackage,
  relationshipTargetIn,
  resolveHeaderFooterPartsBySection,
  type HeadlessDocumentView,
} from '@docx-editor.dev/core/store';
import { createDocumentFurnitureSource } from '../../layout/document-furniture-source.ts';
import { createDocumentLinkProjectors } from '../../layout/document-link-projector.ts';
import { layoutDocumentView } from '../../layout/document-layout-coordinator.ts';
import { createFixedMeasurer } from '../../layout/fixed-measurer.ts';
import { createParagraphLayoutCache } from '../../layout/layout-cache.ts';
import { createLayoutSession } from '../../layout/layout-session.ts';
import { layoutSemanticDocument } from '../../layout/semantic-layout.ts';
import type { PendingLine } from '../../layout/pending-line.ts';
import type { SemanticLayout } from '../../layout/semantic-records.ts';
import { openDocumentForExport } from '../../export/export-session.ts';
import { mountPaginatedSurface } from '../paginated-surface.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const body =
  '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblInd w:w="0" w:type="dxa"/>' +
  '<w:tblLayout w:type="autofit"/><w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="4788"/><w:gridCol w:w="4788"/></w:tblGrid><w:tr>' +
  '<w:tc><w:p><w:r><w:t>one</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>two</w:t></w:r></w:p></w:tc>' +
  '</w:tr></w:tbl><w:p/><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:left="1440" w:right="1440" w:top="1440" w:bottom="1440"/></w:sectPr>';
const documentXml = `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`;
const measurer = createFixedMeasurer(6, 14);

function bytes(mode: number | undefined) {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rDoc" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rSettings" Type="${R}/settings" Target="settings.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(documentXml),
    'word/settings.xml': strToU8(
      `<w:settings xmlns:w="${W}">${mode === undefined ? '' : `<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="${mode}"/></w:compat>`}</w:settings>`
    ),
  });
}
function table(layout: SemanticLayout) {
  const result = layout.pages
    .flatMap((page) => page.fragments)
    .find((fragment) => fragment.kind === 'table');
  if (!result || result.kind !== 'table') throw new Error('missing table');
  return result;
}

test('browser and byte-export hosts share explicitly authored compatibility geometry', async () => {
  for (const mode of [11, 12, 14, 15, undefined, 16]) {
    const input = bytes(mode);
    const container = document.createElement('div');
    document.body.append(container);
    const mounted = mountPaginatedSurface(container, input, { measurer, scale: 1 });
    if (!mounted.ok) throw new Error(mounted.reason);
    const exported = openDocumentForExport(input, { measurer });
    if (!exported.ok) throw new Error(exported.reason);
    try {
      const browser = table(mounted.surface.layout());
      const headless = table(await exported.session.layout());
      // An ABSENT `compatibilityMode` resolves to the legacy content box, not the modern
      // one. A captured control settles it: this same fixture saved with no
      // `w:compatSetting` at all and saved with `w:val="14"` render identically in the
      // reference, both starting the first cell's text at x = 72.000, the text margin.
      // See `.cache/pdf/claude-compatmode/`.
      const expected =
        mode === undefined || mode === 11 || mode === 12 || mode === 14 ? 478.8 : 468;
      expect(browser.box.width).toBeCloseTo(expected, 8);
      expect(headless.box.width).toBeCloseTo(expected, 8);
      expect(headless.columnEdges).toEqual(browser.columnEdges);
      expect(headless.box.x).toBeCloseTo(browser.box.x, 8);
    } finally {
      mounted.surface.destroy();
      exported.session.dispose();
      container.remove();
    }
  }
});

test('switching compatibility mode invalidates prepared tables and retained layout sessions', () => {
  const parsed = readOoxmlPart(documentXml, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache<readonly PendingLine[]>();
  const layout = (mode: number | undefined) =>
    layoutSemanticDocument(parsed.part, 0, {
      measurer,
      session,
      cache,
      producer: 'compatibility-cache-test',
      compatibilityMode: mode,
      drawingLayoutEpoch: 'stable',
      projectionEpoch: 'stable',
    });
  expect(table(layout(14)).box.width).toBeCloseTo(478.8, 8);
  const initialKeys = [...session.keys];
  const initialPrepass = session.prepass;
  layout(14);
  expect(session.stats.placed).toBe(0);
  expect(session.prepass).toBe(initialPrepass);
  expect(table(layout(15)).box.width).toBeCloseTo(468, 8);
  expect(session.keys).not.toEqual(initialKeys);
  expect(session.prepass).not.toBe(initialPrepass);
  expect(session.stats.placed).toBeGreaterThan(0);
  expect(table(layout(14)).box.width).toBeCloseTo(478.8, 8);
  expect(session.keys).toEqual(initialKeys);
  // Absent resolves to the legacy box, as above.
  expect(table(layout(undefined)).box.width).toBeCloseTo(478.8, 8);
});

function storyBytes(mode: number) {
  const entries = unzipSync(bytes(mode));
  const tableXml = body.slice(0, body.indexOf('</w:tbl>') + '</w:tbl>'.length);
  const stories = [
    ['header1.xml', 'header', `<w:hdr xmlns:w="${W}">${tableXml}</w:hdr>`],
    ['footer1.xml', 'footer', `<w:ftr xmlns:w="${W}">${tableXml}</w:ftr>`],
    [
      'footnotes.xml',
      'footnotes',
      `<w:footnotes xmlns:w="${W}"><w:footnote w:id="1">${tableXml}<w:p/></w:footnote></w:footnotes>`,
    ],
  ];
  const decode = (name: string) => new TextDecoder().decode(entries[name]);
  let types = decode('[Content_Types].xml');
  let rels = decode('word/_rels/document.xml.rels');
  for (const [name, kind, xml] of stories) {
    entries[`word/${name}`] = strToU8(xml!);
    types = types.replace(
      '</Types>',
      `<Override PartName="/word/${name}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml"/></Types>`
    );
    rels = rels.replace(
      '</Relationships>',
      `<Relationship Id="r${kind}" Type="${R}/${kind}" Target="${name}"/></Relationships>`
    );
  }
  entries['[Content_Types].xml'] = strToU8(types);
  entries['word/_rels/document.xml.rels'] = strToU8(rels);
  entries['word/document.xml'] = strToU8(
    documentXml
      .replace('<w:document ', `<w:document xmlns:r="${R}" `)
      .replace(
        '<w:p/>',
        '<w:p><w:r><w:t>Reference</w:t><w:footnoteReference w:id="1"/></w:r></w:p>'
      )
      .replace(
        '<w:sectPr>',
        '<w:sectPr><w:headerReference w:type="default" r:id="rheader"/><w:footerReference w:type="default" r:id="rfooter"/>'
      )
  );
  return zipSync(entries);
}

test('browser and headless hosts apply the same mode to header, footer, and footnote tables', async () => {
  for (const mode of [14, 15]) {
    const input = storyBytes(mode);
    const container = document.createElement('div');
    const mounted = mountPaginatedSurface(container, input, { measurer, scale: 1 });
    if (!mounted.ok) throw new Error(mounted.reason);
    const exported = openDocumentForExport(input, { measurer });
    if (!exported.ok) throw new Error(exported.reason);
    try {
      for (const layout of [mounted.surface.layout(), await exported.session.layout()]) {
        const page = layout.pages[0]!;
        const fragments = [
          page.header?.fragments,
          page.footer?.fragments,
          page.footnotes?.notes[0]?.fragments,
        ];
        for (const [storyIndex, story] of fragments.entries()) {
          const found = story?.find((fragment) => fragment.kind === 'table');
          expect(found?.box.width, `mode ${mode}, story ${storyIndex}`).toBeCloseTo(
            mode === 14 ? 478.8 : 468,
            7
          );
          expect(found?.box.x).toBeCloseTo(mode === 14 ? -5.4 : 0, 7);
        }
      }
    } finally {
      mounted.surface.destroy();
      exported.session.dispose();
    }
  }
});

test('mode-only changes refresh retained body, furniture, and note geometry', () => {
  const loaded = readOoxmlPackage(storyBytes(14));
  if (!loaded.ok) throw new Error(loaded.reason);
  const pkg = loaded.package;
  const view: HeadlessDocumentView = {
    part: () => pkg.parts.get(pkg.mainDocumentPart)!,
    currentPackage: () => pkg,
    packageRevision: () => 0,
    stylesRoot: () => null,
    numberingRoot: () => null,
    settingsRoot: () => null,
    documentThemeFonts: () => ({ major: null, minor: null }),
    documentProperties: () => ({}),
    headerFooterPartsBySection: () => resolveHeaderFooterPartsBySection(pkg),
    relationshipTarget: (id) => relationshipTargetIn(pkg, pkg.mainDocumentPart, id),
  };
  let mode = 14;
  const cache = createParagraphLayoutCache<readonly PendingLine[]>();
  const session = createLayoutSession();
  const links = createDocumentLinkProjectors(view);
  const furniture = createDocumentFurnitureSource({
    view,
    measurer,
    producer: 'compat-cache',
    cache,
    linkProjectors: links,
    compatibilityMode: () => mode,
  });
  for (const next of [14, 15, 14]) {
    mode = next;
    const result = layoutDocumentView({
      view,
      measurer,
      revision: 0,
      producer: 'compat-cache',
      cache,
      session,
      linkProjectors: links,
      furniture,
      compatibilityMode: () => mode,
    });
    const page = result.pages[0]!;
    for (const fragments of [
      page.fragments,
      page.header?.fragments,
      page.footer?.fragments,
      page.footnotes?.notes[0]?.fragments,
    ]) {
      const found = fragments?.find((fragment) => fragment.kind === 'table');
      expect(found?.box.width).toBeCloseTo(mode === 14 ? 478.8 : 468, 7);
    }
  }
});
