import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import {
  normalizeParagraphIdentity,
  readOoxmlPackage,
  relationshipTargetIn,
  resolveHeaderFooterPartsBySection,
  resolveHeaderFooterResolutionBySection,
  TreePackageStore,
  type HeadlessDocumentView,
  type OoxmlPackage,
} from '@docx-editor.dev/core/store';
import { forEachSemanticSpan } from '../../layout/export-traversal.ts';
import { createFixedMeasurer } from '../../layout/fixed-measurer.ts';
import type { SemanticLayout } from '../../layout/semantic-records.ts';
import { openDocumentForExport } from '../export-session.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';

function pkg(
  body: string,
  linkTarget?: string,
  extra: {
    readonly relationships?: string;
    readonly contentTypes?: string;
    readonly entries?: Readonly<Record<string, Uint8Array>>;
  } = {}
): OoxmlPackage {
  const relationship = linkTarget
    ? `<Relationship Id="rLink" Type="${R}/hyperlink" Target="${linkTarget}" TargetMode="External"/>`
    : '';
  const loaded = readOoxmlPackage(
    zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          (extra.contentTypes ?? '') +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rDoc" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}">${relationship}${extra.relationships ?? ''}</Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`
      ),
      ...(extra.entries ?? {}),
    })
  );
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.package;
}

function liveView(store: TreePackageStore): HeadlessDocumentView {
  return {
    part: () => store.bodyStore().part,
    currentPackage: () => store.currentPackage(),
    packageRevision: () => store.packageRevision,
    stylesRoot: () => null,
    numberingRoot: () => null,
    settingsRoot: () => null,
    documentThemeFonts: () => ({ major: null, minor: null }),
    documentProperties: () => ({}),
    headerFooterPartsBySection: () => resolveHeaderFooterPartsBySection(store.currentPackage()),
    headerFooterResolutionBySection: () =>
      resolveHeaderFooterResolutionBySection(store.currentPackage()),
    relationshipTarget: (relationshipId) =>
      relationshipTargetIn(
        store.currentPackage(),
        store.currentPackage().mainDocumentPart,
        relationshipId
      ),
  };
}

function textboxDrawing(content: string, id = 9): string {
  return (
    `<w:drawing xmlns:wp="${WP}" xmlns:a="${A}" xmlns:wps="${WPS}">` +
    '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ' +
    'relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="page"><wp:posOffset>914400</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="page"><wp:posOffset>914400</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="914400" cy="457200"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    `<wp:wrapNone/><wp:docPr id="${id}" name="Review box"/>` +
    `<a:graphic><a:graphicData uri="${WPS}"><wps:wsp>` +
    '<wps:spPr><a:xfrm><a:ext cx="914400" cy="457200"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>' +
    `<wps:txbx><w:txbxContent>${content}</w:txbxContent></wps:txbx>` +
    '<wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing>'
  );
}

test('export default keeps all tracked markup visible', async () => {
  const source = pkg(
    '<w:p><w:del w:id="1" w:author="A"><w:r><w:delText>Old</w:delText></w:r></w:del>' +
      '<w:ins w:id="2" w:author="A"><w:r><w:t>New</w:t></w:r></w:ins></w:p>'
  );
  const main = source.parts.get(source.mainDocumentPart)!;
  const store = new TreePackageStore(source, normalizeParagraphIdentity(main));
  const opened = openDocumentForExport(liveView(store));
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  try {
    const layout = await opened.session.layout();
    const text: string[] = [];
    forEachSemanticSpan(layout, ({ span }) => text.push(span.text));
    expect(layout.displayMode).toBe('all-markup');
    expect(text.join('')).toBe('OldNew');
    const proposedText: string[] = [];
    forEachSemanticSpan(await opened.session.layoutFor('proposed'), ({ span }) =>
      proposedText.push(span.text)
    );
    expect(proposedText.join('')).toBe('New');
    const originalText: string[] = [];
    forEachSemanticSpan(await opened.session.layoutFor('original'), ({ span }) =>
      originalText.push(span.text)
    );
    expect(originalText.join('')).toBe('Old');
  } finally {
    opened.session.dispose();
  }
});
test('live ExportSession observes a real shell-only relationship write', async () => {
  const body = '<w:p><w:hyperlink r:id="rLink"><w:r><w:t>linked</w:t></w:r></w:hyperlink></w:p>';
  const first = pkg(body, 'https://one.example');
  const second = pkg(body, 'https://two.example');
  const main = first.parts.get(first.mainDocumentPart)!;
  const store = new TreePackageStore(first, normalizeParagraphIdentity(main));
  const opened = openDocumentForExport(liveView(store));
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  const linksOf = async (): Promise<string[]> => {
    const links: string[] = [];
    forEachSemanticSpan(await opened.session.layout(), ({ span }) => {
      if (span.link?.href) links.push(span.link.href);
    });
    return links;
  };
  try {
    expect(await linksOf()).toEqual(['https://one.example']);
    const revision = store.packageRevision;
    store.replacePackageShell(
      Object.freeze({
        ...store.currentPackage(),
        relationships: second.relationships,
        externalTargets: second.externalTargets,
      })
    );
    expect(store.packageRevision).toBe(revision);
    expect(await linksOf()).toEqual(['https://two.example']);
  } finally {
    opened.session.dispose();
  }
});

test('live ExportSession refreshes furniture rIds after a shell-only relationship rewrite', async () => {
  const body =
    '<w:p><w:r><w:t>body</w:t></w:r></w:p>' +
    '<w:sectPr><w:headerReference w:type="default" r:id="rHeader"/></w:sectPr>';
  const source = pkg(body, undefined, {
    relationships: `<Relationship Id="rHeader" Type="${R}/header" Target="header1.xml"/>`,
    contentTypes:
      '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>',
    entries: {
      'word/header1.xml': strToU8(
        `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>header</w:t></w:r></w:p></w:hdr>`
      ),
    },
  });
  const stableBody = normalizeParagraphIdentity(source.parts.get(source.mainDocumentPart)!);
  const stableHeader = source.parts.get('/word/header1.xml')!;
  let activePackage = Object.freeze({
    ...source,
    parts: new Map(source.parts).set(stableBody.name, stableBody),
  });
  const sectionParts = Object.freeze([
    Object.freeze({
      titlePage: false,
      evenAndOddHeaders: false,
      headers: new Map([['default' as const, stableHeader]]),
      footers: new Map(),
    }),
  ]);
  const view: HeadlessDocumentView = {
    part: () => stableBody,
    currentPackage: () => activePackage,
    packageRevision: () => 0,
    stylesRoot: () => null,
    numberingRoot: () => null,
    settingsRoot: () => null,
    documentThemeFonts: () => ({ major: null, minor: null }),
    documentProperties: () => ({}),
    headerFooterPartsBySection: () => sectionParts,
    relationshipTarget: (relationshipId) =>
      relationshipTargetIn(activePackage, activePackage.mainDocumentPart, relationshipId),
  };
  const opened = openDocumentForExport(view);
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  try {
    expect((await opened.session.layout()).pages[0]?.header?.rId).toBe('rHeader');
    const relationships = new Map(activePackage.relationships);
    relationships.set(
      activePackage.mainDocumentPart,
      Object.freeze(
        (relationships.get(activePackage.mainDocumentPart) ?? []).map((record) =>
          record.id === 'rHeader' ? Object.freeze({ ...record, id: 'rHeaderNext' }) : record
        )
      )
    );
    activePackage = Object.freeze({ ...activePackage, relationships });
    expect((await opened.session.layout()).pages[0]?.header?.rId).toBe('rHeaderNext');
  } finally {
    opened.session.dispose();
  }
});

test('ExportSession publishes exact occurrence rIds for shared header and footer parts', async () => {
  const body =
    '<w:p><w:pPr><w:sectPr><w:type w:val="nextPage"/>' +
    '<w:headerReference w:type="default" r:id="rHeaderOne"/>' +
    '<w:footerReference w:type="default" r:id="rFooterOne"/>' +
    '</w:sectPr></w:pPr><w:r><w:t>one</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>two</w:t></w:r></w:p>' +
    '<w:sectPr>' +
    '<w:headerReference w:type="default" r:id="rHeaderTwo"/>' +
    '<w:footerReference w:type="default" r:id="rFooterTwo"/>' +
    '</w:sectPr>';
  const source = pkg(body, undefined, {
    relationships:
      `<Relationship Id="rHeaderOne" Type="${R}/header" Target="header1.xml"/>` +
      `<Relationship Id="rHeaderTwo" Type="${R}/header" Target="header1.xml"/>` +
      `<Relationship Id="rFooterOne" Type="${R}/footer" Target="footer1.xml"/>` +
      `<Relationship Id="rFooterTwo" Type="${R}/footer" Target="footer1.xml"/>`,
    contentTypes:
      '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
      '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>',
    entries: {
      'word/header1.xml': strToU8(
        `<w:hdr xmlns:w="${W}"><w:p><w:ins w:id="header-change" w:author="Ada"><w:r><w:t>shared header</w:t></w:r></w:ins></w:p></w:hdr>`
      ),
      'word/footer1.xml': strToU8(
        `<w:ftr xmlns:w="${W}"><w:p><w:r><w:t>shared footer</w:t></w:r></w:p></w:ftr>`
      ),
    },
  });
  const stableBody = normalizeParagraphIdentity(source.parts.get(source.mainDocumentPart)!);
  const activePackage = Object.freeze({
    ...source,
    parts: new Map(source.parts).set(stableBody.name, stableBody),
  });
  const view: HeadlessDocumentView = {
    part: () => stableBody,
    currentPackage: () => activePackage,
    packageRevision: () => 0,
    stylesRoot: () => null,
    numberingRoot: () => null,
    settingsRoot: () => null,
    documentThemeFonts: () => ({ major: null, minor: null }),
    documentProperties: () => ({}),
    headerFooterPartsBySection: () => resolveHeaderFooterPartsBySection(activePackage),
    headerFooterResolutionBySection: () => resolveHeaderFooterResolutionBySection(activePackage),
    relationshipTarget: (relationshipId) =>
      relationshipTargetIn(activePackage, activePackage.mainDocumentPart, relationshipId),
  };
  const opened = openDocumentForExport(view);
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  try {
    const layout = await opened.session.layout();
    expect(layout.pages.length).toBeGreaterThanOrEqual(2);
    expect([layout.pages[0]?.header?.rId, layout.pages.at(-1)?.header?.rId]).toEqual([
      'rHeaderOne',
      'rHeaderTwo',
    ]);
    expect([layout.pages[0]?.footer?.rId, layout.pages.at(-1)?.footer?.rId]).toEqual([
      'rFooterOne',
      'rFooterTwo',
    ]);
  } finally {
    opened.session.dispose();
  }
});

test('a shell-only write wakes a pending resource wait and restarts on the new package', async () => {
  const drawing =
    '<w:p><w:r><w:drawing>' +
    '<wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">' +
    '<wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="pic"/>' +
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
    '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:nvPicPr><pic:cNvPr id="1" name="pic"/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rImage"/></pic:blipFill><pic:spPr/>' +
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
  const imagePackage = pkg(drawing, undefined, {
    contentTypes: '<Default Extension="png" ContentType="image/png"/>',
    relationships: `<Relationship Id="rImage" Type="${R}/image" Target="media/image.png"/>`,
    entries: {
      'word/media/image.png': Uint8Array.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0,
        0, 2, 0, 0, 0, 3, 8, 6, 0, 0, 0, 0, 0, 0, 0,
      ]),
    },
  });
  const imageFreeShell = pkg(drawing);
  const main = imagePackage.parts.get(imagePackage.mainDocumentPart)!;
  const stablePart = normalizeParagraphIdentity(main);
  let activePackage = Object.freeze({
    ...imagePackage,
    parts: new Map(imagePackage.parts).set(stablePart.name, stablePart),
  });
  const view: HeadlessDocumentView = {
    part: () => stablePart,
    currentPackage: () => activePackage,
    packageRevision: () => 0,
    stylesRoot: () => null,
    numberingRoot: () => null,
    settingsRoot: () => null,
    documentThemeFonts: () => ({ major: null, minor: null }),
    documentProperties: () => ({}),
    headerFooterPartsBySection: () => [],
    relationshipTarget: (relationshipId) =>
      relationshipTargetIn(activePackage, activePackage.mainDocumentPart, relationshipId),
  };
  let decodeStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    decodeStarted = resolve;
  });
  const opened = openDocumentForExport(view, {
    resourceTimeoutMs: 500,
    imageDecodePort: {
      decode: () => {
        decodeStarted();
        return new Promise(() => {});
      },
    },
  });
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  try {
    const pending = opened.session.layout();
    await started;
    activePackage = Object.freeze({
      ...activePackage,
      relationships: imageFreeShell.relationships,
      externalTargets: imageFreeShell.externalTargets,
      partBytes: imageFreeShell.partBytes,
      contentTypes: imageFreeShell.contentTypes,
    });
    await expect(pending).resolves.toMatchObject({ revision: 0 });
  } finally {
    opened.session.dispose();
  }
});

test('a resource that settles at once is not timed out by a slow layout pass', async () => {
  const fixed = createFixedMeasurer();
  let slowed = false;
  // The first measurement outlasts the whole resource deadline. The deadline keeps a margin
  // above one millisecond: `Date.now()` ticks in whole milliseconds, so a 1 ms deadline can
  // expire between two statements on a busy machine, before any layout work starts.
  const resourceTimeoutMs = 20;
  const measurer = new Proxy(fixed, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        if (!slowed) {
          slowed = true;
          const until = Date.now() + resourceTimeoutMs * 4;
          while (Date.now() < until);
        }
        return Reflect.apply(value, target, args);
      };
    },
  });
  const source = pkg(
    `<w:p><w:r>${textboxDrawing('<w:p><w:r><w:t>Boxed</w:t></w:r></w:p>')}</w:r></w:p>`
  );
  const main = source.parts.get(source.mainDocumentPart)!;
  const store = new TreePackageStore(source, normalizeParagraphIdentity(main));
  const opened = openDocumentForExport(liveView(store), { measurer, resourceTimeoutMs });
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  try {
    await expect(opened.session.layout()).resolves.toBeDefined();
    expect(slowed).toBe(true);
  } finally {
    opened.session.dispose();
  }
});
