import { noticeFixture } from '../../layout/__tests__/note-continuation-fixture.ts';
import { layoutSemanticDocument } from '../../layout/semantic-layout.ts';
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
import { caretAt } from '../../layout/semantic-interaction.ts';
import { openDocumentForExport } from '../export-session.ts';
import {
  attachReviewArtifactGeometry,
  MAX_REVIEW_GEOMETRY_PARAGRAPH_BINDINGS,
  reviewGeometryIndexRecorder,
} from '../review-artifact-geometry.ts';
import { projectReviewArtifacts } from '../review-artifact-projection.ts';
import type { SemanticLayout } from '../../layout/semantic-records.ts';
import type { SemanticReviewArtifactRecord } from '../../layout/review-artifact-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';

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

function pkg(
  body: string,
  extra: {
    readonly relationships?: string;
    readonly contentTypes?: string;
    readonly entries?: Readonly<Record<string, Uint8Array>>;
  } = {}
): OoxmlPackage {
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
        `<Relationships xmlns="${REL}">${extra.relationships ?? ''}</Relationships>`
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

function commentsExtra(commentsXml: string): {
  readonly relationships: string;
  readonly contentTypes: string;
  readonly entries: Readonly<Record<string, Uint8Array>>;
} {
  return {
    relationships: `<Relationship Id="rComments" Type="${R}/comments" Target="comments.xml"/>`,
    contentTypes:
      '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>',
    entries: {
      'word/comments.xml': strToU8(commentsXml),
    },
  };
}

function pageStackY(layout: SemanticLayout, pageIndex: number, pageContentY: number): number {
  return layout.pages[pageIndex]!.contentBox.y + pageContentY;
}

test('anchored comments publish frozen page-content and page-stack geometry', async () => {
  const source = pkg(
    '<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>Annotated text</w:t></w:r>' +
      '<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>',
    commentsExtra(
      `<w:comments xmlns:w="${W}"><w:comment w:id="0" w:author="Ada">` +
        '<w:p><w:r><w:t>Check this</w:t></w:r></w:p></w:comment></w:comments>'
    )
  );
  const main = source.parts.get(source.mainDocumentPart)!;
  const opened = openDocumentForExport(
    liveView(new TreePackageStore(source, normalizeParagraphIdentity(main)))
  );
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  try {
    const layout = await opened.session.layout();
    const comment = layout.reviewArtifacts?.find(
      (artifact) => artifact.kind === 'comment' && artifact.text === 'Check this'
    );
    expect(comment?.occurrences).toHaveLength(1);
    const occurrence = comment?.occurrences[0];
    expect(occurrence?.geometry).toBeDefined();
    expect(occurrence!.geometry!.pageContent.length).toBeGreaterThan(0);
    expect(occurrence!.geometry!.pageStack.length).toBe(occurrence!.geometry!.pageContent.length);
    for (const rect of occurrence!.geometry!.pageContent) {
      expect(rect.width).toBeGreaterThan(0);
      expect(rect.height).toBeGreaterThan(0);
      expect(Object.isFrozen(rect)).toBe(true);
    }
    for (const [index, rect] of occurrence!.geometry!.pageStack.entries()) {
      const content = occurrence!.geometry!.pageContent[index]!;
      expect(rect.y).toBeCloseTo(pageStackY(layout, occurrence!.pageIndex, content.y), 4);
      expect(Object.isFrozen(rect)).toBe(true);
    }
    expect(Object.isFrozen(occurrence!.geometry)).toBe(true);
    expect(Object.isFrozen(occurrence!.geometry!.pageContent)).toBe(true);
    expect(Object.isFrozen(occurrence!.geometry!.pageStack)).toBe(true);
  } finally {
    opened.session.dispose();
  }
});

test('tracked changes publish geometry for visible markup ranges', async () => {
  const source = pkg(
    '<w:p><w:ins w:id="0" w:author="Ada"><w:r><w:t>inserted</w:t></w:r></w:ins></w:p>'
  );
  const main = source.parts.get(source.mainDocumentPart)!;
  const opened = openDocumentForExport(
    liveView(new TreePackageStore(source, normalizeParagraphIdentity(main)))
  );
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  try {
    const change = (await opened.session.layout()).reviewArtifacts?.find(
      (artifact) => artifact.kind === 'tracked-change' && artifact.change === 'insert'
    );
    expect(change?.occurrences).toHaveLength(1);
    expect(change?.occurrences[0]?.geometry?.pageContent.length).toBeGreaterThan(0);
    expect(change?.occurrences[0]?.geometry?.pageStack.length).toBeGreaterThan(0);
  } finally {
    opened.session.dispose();
  }
});

test('multi-page comment occurrences each carry geometry on their own page', async () => {
  const firstText = `START ${'alpha '.repeat(90)}`;
  const lastText = `${'omega '.repeat(90)}END`;
  const source = pkg(
    `<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>${firstText}</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t>${lastText}</w:t></w:r><w:commentRangeEnd w:id="0"/>` +
      '<w:r><w:commentReference w:id="0"/></w:r></w:p>' +
      '<w:sectPr><w:pgSz w:w="2880" w:h="1440"/><w:pgMar w:top="72" w:right="72" w:bottom="72" w:left="72"/></w:sectPr>',
    commentsExtra(
      `<w:comments xmlns:w="${W}"><w:comment w:id="0" w:author="Ada">` +
        '<w:p><w:r><w:t>Spans pages</w:t></w:r></w:p></w:comment></w:comments>'
    )
  );
  const main = source.parts.get(source.mainDocumentPart)!;
  const opened = openDocumentForExport(
    liveView(new TreePackageStore(source, normalizeParagraphIdentity(main)))
  );
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  try {
    const layout = await opened.session.layout();
    const comment = layout.reviewArtifacts?.find(
      (artifact) => artifact.kind === 'comment' && artifact.text === 'Spans pages'
    );
    expect(layout.pages.length).toBeGreaterThan(2);
    expect(comment?.occurrences.length).toBeGreaterThan(1);
    expect(
      comment?.occurrences.every(
        ({ source }) => source.start.paragraphId === source.end.paragraphId
      )
    ).toBe(true);
    for (const occurrence of comment?.occurrences ?? []) {
      expect(occurrence.geometry).toBeDefined();
      expect(occurrence.geometry!.pageContent.length).toBeGreaterThan(0);
      expect(occurrence.geometry!.pageContent.every((rect) => rect.width >= 0)).toBe(true);
      expect(
        occurrence.geometry!.pageContent.every(
          (_, index) =>
            occurrence.geometry!.pageStack[index]!.y ===
            pageStackY(layout, occurrence.pageIndex, occurrence.geometry!.pageContent[index]!.y)
        )
      ).toBe(true);
    }
    expect(comment?.occurrences.length).toBeGreaterThan(1);
  } finally {
    opened.session.dispose();
  }
});

test('unavailable geometry stays absent for orphan comments and hidden revisions', async () => {
  const orphanSource = pkg('<w:p><w:r><w:t>body</w:t></w:r></w:p>', {
    ...commentsExtra(
      `<w:comments xmlns:w="${W}"><w:comment w:id="0" w:author="Ada">` +
        '<w:p><w:r><w:t>Orphan only</w:t></w:r></w:p></w:comment></w:comments>'
    ),
  });
  const orphanMain = orphanSource.parts.get(orphanSource.mainDocumentPart)!;
  const orphanOpened = openDocumentForExport(
    liveView(new TreePackageStore(orphanSource, normalizeParagraphIdentity(orphanMain)))
  );
  expect(orphanOpened.ok).toBe(true);
  if (!orphanOpened.ok) return;
  try {
    const orphan = (await orphanOpened.session.layout()).reviewArtifacts?.find(
      (artifact) => artifact.kind === 'comment'
    );
    expect(orphan?.occurrences).toEqual([]);
  } finally {
    orphanOpened.session.dispose();
  }

  const hiddenSource = pkg(
    '<w:p><w:ins w:id="insert/private" w:author="Ada"><w:r><w:t>inserted</w:t></w:r></w:ins></w:p>' +
      '<w:p><w:del w:id="delete/private" w:author="Grace"><w:r><w:delText>deleted</w:delText></w:r></w:del></w:p>'
  );
  const hiddenMain = hiddenSource.parts.get(hiddenSource.mainDocumentPart)!;
  const hiddenOpened = openDocumentForExport(
    liveView(new TreePackageStore(hiddenSource, normalizeParagraphIdentity(hiddenMain)))
  );
  expect(hiddenOpened.ok).toBe(true);
  if (!hiddenOpened.ok) return;
  try {
    const originalInsertion = (
      await hiddenOpened.session.layoutFor('original')
    ).reviewArtifacts.find(
      (artifact) => artifact.kind === 'tracked-change' && artifact.change === 'insert'
    );
    const proposedDeletion = (
      await hiddenOpened.session.layoutFor('proposed')
    ).reviewArtifacts.find(
      (artifact) => artifact.kind === 'tracked-change' && artifact.change === 'delete'
    );
    expect(originalInsertion?.occurrences).toEqual([]);
    expect(proposedDeletion?.occurrences).toEqual([]);
  } finally {
    hiddenOpened.session.dispose();
  }
});

test('attachReviewArtifactGeometry skips layout walks for orphan-only artifacts', () => {
  const source = pkg('<w:p><w:r><w:t>body</w:t></w:r></w:p>', {
    ...commentsExtra(
      `<w:comments xmlns:w="${W}"><w:comment w:id="0" w:author="Ada">` +
        '<w:p><w:r><w:t>Orphan only</w:t></w:r></w:p></w:comment></w:comments>'
    ),
  });
  const layout = Object.defineProperty({ revision: 0, pages: [] }, 'pages', {
    get: () => {
      throw new Error('layout walk must not run for orphan-only geometry');
    },
  }) as Parameters<typeof projectReviewArtifacts>[0];

  const projected = projectReviewArtifacts(layout, source);
  const enriched = attachReviewArtifactGeometry(layout, projected);
  expect(enriched[0]?.occurrences).toEqual([]);
  expect(enriched[0]?.occurrences[0]?.geometry).toBeUndefined();
});

test('header and footnote review geometry uses story origins in page-content space', async () => {
  const source = pkg(
    '<w:p><w:r><w:t>Body</w:t><w:footnoteReference w:id="1"/></w:r></w:p>' +
      '<w:sectPr><w:headerReference w:type="default" r:id="rHeader"/>' +
      '<w:pgSz w:w="12240" w:h="15840"/>' +
      '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>' +
      '</w:sectPr>',
    {
      relationships:
        `<Relationship Id="rHeader" Type="${R}/header" Target="header1.xml"/>` +
        `<Relationship Id="rFootnotes" Type="${R}/footnotes" Target="footnotes.xml"/>` +
        `<Relationship Id="rComments" Type="${R}/comments" Target="comments.xml"/>`,
      contentTypes:
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
        '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
        '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>',
      entries: {
        'word/header1.xml': strToU8(
          `<w:hdr xmlns:w="${W}">` +
            '<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>Header note</w:t></w:r>' +
            '<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>' +
            '<w:p><w:commentRangeStart w:id="1"/><w:commentRangeEnd w:id="1"/>' +
            '<w:r><w:commentReference w:id="1"/></w:r><w:r><w:t>After point</w:t></w:r></w:p></w:hdr>'
        ),
        'word/footnotes.xml': strToU8(
          `<w:footnotes xmlns:w="${W}">` +
            '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
            '<w:footnote w:type="continuationSeparator" w:id="0">' +
            '<w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
            '<w:footnote w:id="1"><w:p><w:commentRangeStart w:id="2"/>' +
            '<w:r><w:t>reviewed note</w:t></w:r><w:commentRangeEnd w:id="2"/>' +
            '<w:r><w:commentReference w:id="2"/></w:r></w:p></w:footnote></w:footnotes>'
        ),
        'word/comments.xml': strToU8(
          `<w:comments xmlns:w="${W}">` +
            '<w:comment w:id="0" w:author="Ada"><w:p><w:r><w:t>Header range</w:t></w:r></w:p></w:comment>' +
            '<w:comment w:id="1" w:author="Ada"><w:p><w:r><w:t>Header point</w:t></w:r></w:p></w:comment>' +
            '<w:comment w:id="2" w:author="Ada"><w:p><w:r><w:t>Footnote review</w:t></w:r></w:p></w:comment>' +
            '</w:comments>'
        ),
      },
    }
  );
  const main = source.parts.get(source.mainDocumentPart)!;
  const opened = openDocumentForExport(
    liveView(new TreePackageStore(source, normalizeParagraphIdentity(main)))
  );
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  try {
    const layout = await opened.session.layout();
    const page = layout.pages[0]!;
    const header = page.header;
    const note = page.footnotes?.notes[0];
    expect(header).toBeDefined();
    expect(note).toBeDefined();
    const headerOriginY = header!.box.y - page.contentBox.y;
    const noteOriginY = note!.box.y - page.contentBox.y;
    expect(Math.abs(headerOriginY)).toBeGreaterThan(1);
    expect(Math.abs(noteOriginY)).toBeGreaterThan(1);

    const headerRange = layout.reviewArtifacts?.find(
      (artifact) => artifact.kind === 'comment' && artifact.text === 'Header range'
    );
    const headerPoint = layout.reviewArtifacts?.find(
      (artifact) => artifact.kind === 'comment' && artifact.text === 'Header point'
    );
    const footnote = layout.reviewArtifacts?.find(
      (artifact) => artifact.kind === 'comment' && artifact.text === 'Footnote review'
    );
    expect(headerRange?.occurrences[0]?.geometry?.pageContent[0]).toBeDefined();
    expect(headerPoint?.occurrences[0]?.geometry?.pageContent[0]).toBeDefined();
    expect(footnote?.occurrences[0]?.geometry?.pageContent[0]).toBeDefined();

    const headerRangeY = headerRange!.occurrences[0]!.geometry!.pageContent[0]!.y;
    expect(headerRangeY).toBeGreaterThanOrEqual(headerOriginY - 0.5);
    expect(headerRangeY).toBeLessThan(headerOriginY + header!.box.height);
    expect(Math.abs(headerRangeY - headerOriginY)).toBeLessThan(header!.box.height);

    const pointOccurrence = headerPoint!.occurrences[0]!;
    const pointCaret = caretAt(layout, {
      paragraphId: pointOccurrence.source.start.paragraphId,
      offset: pointOccurrence.source.start.offset,
    });
    expect(pointCaret).not.toBeNull();
    expect(pointOccurrence.geometry!.pageContent[0]!.y).toBeCloseTo(
      pointCaret!.y + headerOriginY,
      4
    );
    expect(pointOccurrence.geometry!.pageContent[0]!.width).toBe(0);
    expect(pointOccurrence.geometry!.pageStack[0]!.width).toBe(0);

    const footnoteY = footnote!.occurrences[0]!.geometry!.pageContent[0]!.y;
    expect(footnoteY).toBeGreaterThanOrEqual(noteOriginY - 0.5);
    expect(footnoteY).toBeLessThan(noteOriginY + note!.box.height);
  } finally {
    opened.session.dispose();
  }
});

test('review geometry walks only pages that carry occurrences', () => {
  const box = { x: 0, y: 0, width: 200, height: 200 };
  const line = {
    id: 'line-0',
    range: { paragraphId: 'p0', start: 0, end: 4 },
    spans: [
      {
        range: { paragraphId: 'p0', start: 0, end: 4 },
        text: 'word',
        style: {},
        box: { x: 0, y: 0, width: 40, height: 12 },
      },
    ],
    box: { x: 0, y: 0, width: 40, height: 12 },
    contentX: 0,
    baseline: 10,
    leading: 0,
  };
  const paragraph = { kind: 'paragraph' as const, paragraphId: 'p0', lines: [line] };
  let hostileReads = 0;
  const hostilePage = {
    index: 1,
    box,
    contentBox: box,
    get fragments() {
      hostileReads += 1;
      throw new Error('unrelated page must not be walked');
    },
  };
  const layout = {
    revision: 0,
    pages: [{ index: 0, box, contentBox: box, fragments: [paragraph] }, hostilePage],
  } as unknown as SemanticLayout;
  const artifacts: readonly SemanticReviewArtifactRecord[] = [
    {
      kind: 'comment',
      id: 'c0',
      author: 'Ada',
      initials: 'A',
      text: 'Indexed',
      resolved: false,
      replyIds: [],
      orphaned: false,
      occurrences: [
        {
          pageIndex: 0,
          physicalPageNumber: 1,
          story: 'body',
          rootStory: 'body',
          textboxPath: [],
          noteScopeId: null,
          noteAreaKind: null,
          source: {
            partName: '/word/document.xml',
            start: { paragraphId: 'p0', offset: 0 },
            end: { paragraphId: 'p0', offset: 4 },
          },
        },
      ],
    },
  ];
  const enriched = attachReviewArtifactGeometry(layout, artifacts);
  expect(hostileReads).toBe(0);
  expect(enriched[0]?.occurrences[0]?.geometry?.pageContent.length).toBeGreaterThan(0);
  expect(Object.isFrozen(enriched[0]?.occurrences[0]?.geometry)).toBe(true);
});

function bodyOccurrence(
  paragraphId: string,
  start: number,
  end: number
): SemanticReviewArtifactRecord['occurrences'][number] {
  return {
    pageIndex: 0,
    physicalPageNumber: 1,
    story: 'body',
    rootStory: 'body',
    textboxPath: [],
    noteScopeId: null,
    noteAreaKind: null,
    source: {
      partName: '/word/document.xml',
      start: { paragraphId, offset: start },
      end: { paragraphId, offset: end },
    },
  };
}

test('hostile same-paragraph review ranges stop at the binding cap', () => {
  const occurrenceCount = MAX_REVIEW_GEOMETRY_PARAGRAPH_BINDINGS + 2;
  const box = { x: 0, y: 0, width: 200, height: 12 };
  const layout = {
    revision: 0,
    pages: [
      {
        index: 0,
        box: { x: 0, y: 0, width: 200, height: 200 },
        contentBox: { x: 0, y: 0, width: 200, height: 200 },
        fragments: [
          {
            kind: 'paragraph' as const,
            paragraphId: 'p0',
            lines: [
              {
                id: 'line-p0',
                range: { paragraphId: 'p0', start: 0, end: 4 },
                spans: [
                  {
                    range: { paragraphId: 'p0', start: 0, end: 4 },
                    text: 'word',
                    style: {},
                    box,
                  },
                ],
                box,
                contentX: 0,
                baseline: 10,
                leading: 0,
              },
            ],
          },
        ],
      },
    ],
  } as unknown as SemanticLayout;
  const artifacts: readonly SemanticReviewArtifactRecord[] = [
    {
      kind: 'comment',
      id: 'hostile',
      author: 'Ada',
      initials: 'A',
      text: 'Cap',
      resolved: false,
      replyIds: [],
      orphaned: false,
      occurrences: Array.from({ length: occurrenceCount }, () => bodyOccurrence('p0', 0, 4)),
    },
  ];
  const recorder = reviewGeometryIndexRecorder();
  recorder.reset();
  const enriched = attachReviewArtifactGeometry(layout, artifacts);

  expect(recorder.bindings).toBe(MAX_REVIEW_GEOMETRY_PARAGRAPH_BINDINGS);
  expect(enriched[0]?.occurrences[0]?.geometry?.pageContent.length).toBeGreaterThan(0);
  expect(
    enriched[0]?.occurrences[MAX_REVIEW_GEOMETRY_PARAGRAPH_BINDINGS - 1]?.geometry
  ).toBeDefined();
  expect(
    enriched[0]?.occurrences[MAX_REVIEW_GEOMETRY_PARAGRAPH_BINDINGS]?.geometry
  ).toBeUndefined();
  expect(enriched[0]?.occurrences[occurrenceCount - 1]?.geometry).toBeUndefined();
});

test('note-separator review ranges publish geometry in page-content space', async () => {
  const source = pkg(
    '<w:p><w:r><w:t>Body</w:t><w:footnoteReference w:id="1"/></w:r></w:p>' +
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
      '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>' +
      '</w:sectPr>',
    {
      relationships:
        `<Relationship Id="rFootnotes" Type="${R}/footnotes" Target="footnotes.xml"/>` +
        `<Relationship Id="rComments" Type="${R}/comments" Target="comments.xml"/>`,
      contentTypes:
        '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
        '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>',
      entries: {
        'word/footnotes.xml': strToU8(
          `<w:footnotes xmlns:w="${W}">` +
            '<w:footnote w:type="separator" w:id="-1"><w:p>' +
            '<w:commentRangeStart w:id="0"/><w:r><w:t>SEP</w:t></w:r>' +
            '<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r>' +
            '</w:p></w:footnote>' +
            '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
            '<w:footnote w:id="1"><w:p><w:r><w:t>first note</w:t></w:r></w:p></w:footnote>' +
            '</w:footnotes>'
        ),
        'word/comments.xml': strToU8(
          `<w:comments xmlns:w="${W}"><w:comment w:id="0" w:author="Ada">` +
            '<w:p><w:r><w:t>Separator review</w:t></w:r></w:p></w:comment></w:comments>'
        ),
      },
    }
  );
  const main = source.parts.get(source.mainDocumentPart)!;
  const opened = openDocumentForExport(
    liveView(new TreePackageStore(source, normalizeParagraphIdentity(main)))
  );
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  try {
    const layout = await opened.session.layout();
    const comment = layout.reviewArtifacts?.find(
      (artifact) => artifact.kind === 'comment' && artifact.text === 'Separator review'
    );
    expect(comment?.occurrences.length).toBeGreaterThan(0);
    const occurrence = comment?.occurrences[0];
    expect(occurrence?.story).toBe('note-separator');
    expect(occurrence?.geometry?.pageContent.length).toBeGreaterThan(0);
    expect(occurrence?.geometry?.pageStack.length).toBe(occurrence?.geometry?.pageContent.length);

    const page = layout.pages[occurrence!.pageIndex]!;
    const separator = page.footnotes?.separator;
    expect(separator).toBeDefined();
    const separatorOriginY = separator!.box.y - page.contentBox.y;
    const rangeY = occurrence!.geometry!.pageContent[0]!.y;
    expect(rangeY).toBeGreaterThanOrEqual(separatorOriginY - 0.5);
    expect(rangeY).toBeLessThan(separatorOriginY + separator!.box.height);
    expect(occurrence!.geometry!.pageContent[0]!.width).toBeGreaterThan(0);
    for (const [index, rect] of occurrence!.geometry!.pageStack.entries()) {
      const content = occurrence!.geometry!.pageContent[index]!;
      expect(rect.y).toBeCloseTo(pageStackY(layout, occurrence!.pageIndex, content.y), 4);
    }
  } finally {
    opened.session.dispose();
  }
});

test('textbox review ranges publish geometry in page-content space', async () => {
  const textbox = textboxDrawing(
    '<w:p><w:commentRangeStart w:id="0"/>' +
      '<w:r><w:t>boxed review</w:t></w:r><w:commentRangeEnd w:id="0"/>' +
      '<w:r><w:commentReference w:id="0"/></w:r></w:p>'
  );
  const source = pkg(`<w:p><w:r>${textbox}</w:r></w:p>`, {
    ...commentsExtra(
      `<w:comments xmlns:w="${W}"><w:comment w:id="0" w:author="Ada">` +
        '<w:p><w:r><w:t>Inside a textbox</w:t></w:r></w:p></w:comment></w:comments>'
    ),
  });
  const main = source.parts.get(source.mainDocumentPart)!;
  const opened = openDocumentForExport(
    liveView(new TreePackageStore(source, normalizeParagraphIdentity(main)))
  );
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  try {
    const layout = await opened.session.layout();
    const comment = layout.reviewArtifacts?.find(
      (artifact) => artifact.kind === 'comment' && artifact.text === 'Inside a textbox'
    );
    expect(comment?.occurrences).toHaveLength(1);
    const occurrence = comment?.occurrences[0];
    expect(occurrence?.story).toBe('textbox');
    expect(occurrence?.textboxPath).toHaveLength(1);
    expect(occurrence?.geometry?.pageContent.length).toBeGreaterThan(0);
    expect(occurrence?.geometry?.pageStack.length).toBe(occurrence?.geometry?.pageContent.length);
    expect(occurrence!.geometry!.pageContent[0]!.width).toBeGreaterThan(0);
    expect(occurrence!.geometry!.pageContent[0]!.height).toBeGreaterThan(0);
    for (const [index, rect] of occurrence!.geometry!.pageStack.entries()) {
      const content = occurrence!.geometry!.pageContent[index]!;
      expect(rect.y).toBeCloseTo(pageStackY(layout, occurrence!.pageIndex, content.y), 4);
      expect(Object.isFrozen(rect)).toBe(true);
    }
  } finally {
    opened.session.dispose();
  }
});

test('cross-paragraph review occurrences do not register geometry bindings', () => {
  const box = { x: 0, y: 0, width: 200, height: 12 };
  const layout = {
    revision: 0,
    pages: [
      {
        index: 0,
        box: { x: 0, y: 0, width: 200, height: 200 },
        contentBox: { x: 0, y: 0, width: 200, height: 200 },
        fragments: [
          {
            kind: 'paragraph' as const,
            paragraphId: 'p0',
            lines: [
              {
                id: 'line-p0',
                range: { paragraphId: 'p0', start: 0, end: 4 },
                spans: [
                  {
                    range: { paragraphId: 'p0', start: 0, end: 4 },
                    text: 'word',
                    style: {},
                    box,
                  },
                ],
                box,
                contentX: 0,
                baseline: 10,
                leading: 0,
              },
            ],
          },
        ],
      },
    ],
  } as unknown as SemanticLayout;
  const artifacts: readonly SemanticReviewArtifactRecord[] = [
    {
      kind: 'comment',
      id: 'span',
      author: 'Ada',
      initials: 'A',
      text: 'Cross paragraph',
      resolved: false,
      replyIds: [],
      orphaned: false,
      occurrences: [
        {
          ...bodyOccurrence('p0', 0, 4),
          source: {
            partName: '/word/document.xml',
            start: { paragraphId: 'p0', offset: 0 },
            end: { paragraphId: 'p1', offset: 4 },
          },
        },
      ],
    },
  ];
  const recorder = reviewGeometryIndexRecorder();
  recorder.reset();
  const enriched = attachReviewArtifactGeometry(layout, artifacts);
  expect(recorder.bindings).toBe(0);
  expect(enriched[0]?.occurrences[0]?.geometry).toBeUndefined();
});

test('continuation-notice review geometry uses its own story origin', () => {
  const source = noticeFixture('Continued');
  const layout = layoutSemanticDocument(source.document, 0, source.options);
  const notice = layout.pages[0]!.footnotes!.continuationNotice!;
  const paragraph = notice.fragments.find((fragment) => fragment.kind === 'paragraph')!;
  const artifacts: readonly SemanticReviewArtifactRecord[] = [
    {
      kind: 'comment',
      id: 'notice-review',
      author: 'Reviewer',
      initials: 'R',
      text: 'Notice review',
      resolved: false,
      replyIds: [],
      orphaned: false,
      occurrences: [
        {
          pageIndex: 0,
          physicalPageNumber: 1,
          story: 'note-separator',
          rootStory: 'note-separator',
          textboxPath: [],
          noteScopeId: null,
          noteAreaKind: 'footnotes',
          source: {
            partName: '/word/footnotes.xml',
            start: { paragraphId: paragraph.paragraphId, offset: 0 },
            end: { paragraphId: paragraph.paragraphId, offset: 9 },
          },
        },
      ],
    },
  ];
  const rects = attachReviewArtifactGeometry(layout, artifacts)[0]!.occurrences[0]!.geometry!
    .pageContent;
  expect(rects.length).toBeGreaterThan(0);
  expect(rects[0]!.y).toBeGreaterThanOrEqual(notice.box.y - layout.pages[0]!.contentBox.y);
  expect(rects[0]!.y).toBeLessThan(
    notice.box.y + notice.box.height - layout.pages[0]!.contentBox.y
  );
});
