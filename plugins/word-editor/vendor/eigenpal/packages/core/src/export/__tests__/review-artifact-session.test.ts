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
import type { SemanticLayout } from '../../layout/semantic-records.ts';
import { openDocumentForExport } from '../export-session.ts';
import { projectReviewArtifacts } from '../review-artifact-projection.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';

// Format defaults, pinned so the fixture does not take the application defaults for omitted docDefaults.
const FORMAT_DOC_DEFAULTS =
  '<w:docDefaults><w:rPrDefault><w:rPr><w:kern w:val="2"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>';

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
          '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
          (extra.contentTypes ?? '') +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rDoc" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rStyles" Type="${R}/styles" Target="styles.xml"/>${relationship}${extra.relationships ?? ''}</Relationships>`
      ),
      'word/styles.xml': strToU8(`<w:styles xmlns:w="${W}">${FORMAT_DOC_DEFAULTS}</w:styles>`),
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
    stylesRoot: () => store.currentPackage().parts.get('/word/styles.xml')?.root ?? null,
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

test('review occurrences intersect exact split-paragraph page intervals', async () => {
  const filler = Array.from(
    { length: 120 },
    (_, index) => `<w:r><w:t> filler-${index}</w:t></w:r>`
  ).join('');
  const source = pkg(
    '<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>START</w:t></w:r>' +
      '<w:commentRangeEnd w:id="0"/>' +
      filler +
      '<w:commentRangeStart w:id="1"/><w:r><w:t> END</w:t></w:r>' +
      '<w:commentRangeEnd w:id="1"/></w:p>' +
      '<w:sectPr><w:pgSz w:w="2880" w:h="1440"/><w:pgMar w:top="72" w:right="72" w:bottom="72" w:left="72"/></w:sectPr>',
    undefined,
    {
      relationships: `<Relationship Id="rComments" Type="${R}/comments" Target="comments.xml"/>`,
      contentTypes:
        '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>',
      entries: {
        'word/comments.xml': strToU8(
          `<w:comments xmlns:w="${W}">` +
            '<w:comment w:id="0" w:author="Ada"><w:p><w:r><w:t>First page only</w:t></w:r></w:p></w:comment>' +
            '<w:comment w:id="1" w:author="Grace"><w:p><w:r><w:t>Last page only</w:t></w:r></w:p></w:comment>' +
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
    expect(layout.pages.length).toBeGreaterThan(2);
    const comments = layout.reviewArtifacts?.filter((artifact) => artifact.kind === 'comment');
    const first = comments?.find((comment) => comment.text === 'First page only');
    const last = comments?.find((comment) => comment.text === 'Last page only');
    expect(first?.occurrences.map((occurrence) => occurrence.pageIndex)).toEqual([0]);
    expect(last?.occurrences.map((occurrence) => occurrence.pageIndex)).toEqual([
      layout.pages.at(-1)!.index,
    ]);
    expect(first?.occurrences[0]?.source.start.offset).toBe(0);
    expect(first?.occurrences[0]?.source.end.offset).toBe(5);
  } finally {
    opened.session.dispose();
  }
});

test('one cross-paragraph comment is sliced across every physical page it occupies', async () => {
  const firstText = `START ${'alpha '.repeat(90)}`;
  const lastText = `${'omega '.repeat(90)}END`;
  const source = pkg(
    `<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>${firstText}</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t>${lastText}</w:t></w:r><w:commentRangeEnd w:id="0"/>` +
      '<w:r><w:commentReference w:id="0"/></w:r></w:p>' +
      '<w:sectPr><w:pgSz w:w="2880" w:h="1440"/><w:pgMar w:top="72" w:right="72" w:bottom="72" w:left="72"/></w:sectPr>',
    undefined,
    {
      relationships: `<Relationship Id="rComments" Type="${R}/comments" Target="comments.xml"/>`,
      contentTypes:
        '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>',
      entries: {
        'word/comments.xml': strToU8(
          `<w:comments xmlns:w="${W}"><w:comment w:id="0" w:author="Ada">` +
            '<w:p><w:r><w:t>Spans paragraphs and pages</w:t></w:r></w:p>' +
            '</w:comment></w:comments>'
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
      (artifact) => artifact.kind === 'comment' && artifact.text === 'Spans paragraphs and pages'
    );
    const occurrences = comment?.occurrences ?? [];
    expect(layout.pages.length).toBeGreaterThan(2);
    expect(new Set(occurrences.map(({ pageIndex }) => pageIndex))).toEqual(
      new Set(layout.pages.map(({ index }) => index))
    );
    expect(new Set(occurrences.map(({ source }) => source.start.paragraphId)).size).toBe(2);
    expect(occurrences[0]?.source.start.offset).toBe(0);
    expect(occurrences.at(-1)?.source.end.offset).toBe(lastText.length);
    expect(
      occurrences.every(
        ({ source }) =>
          source.start.paragraphId === source.end.paragraphId &&
          source.start.offset <= source.end.offset
      )
    ).toBe(true);
  } finally {
    opened.session.dispose();
  }
});

test('textbox review provenance retains the root story and drawing path', async () => {
  const textbox = textboxDrawing(
    '<w:p><w:commentRangeStart w:id="0"/>' +
      '<w:r><w:t>boxed review</w:t></w:r><w:commentRangeEnd w:id="0"/>' +
      '<w:r><w:commentReference w:id="0"/></w:r></w:p>'
  );
  const source = pkg(`<w:p><w:r>${textbox}</w:r></w:p>`, undefined, {
    relationships: `<Relationship Id="rComments" Type="${R}/comments" Target="comments.xml"/>`,
    contentTypes:
      '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>',
    entries: {
      'word/comments.xml': strToU8(
        `<w:comments xmlns:w="${W}"><w:comment w:id="0" w:author="Ada">` +
          '<w:p><w:r><w:t>Inside a textbox</w:t></w:r></w:p></w:comment></w:comments>'
      ),
    },
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
    expect(comment?.occurrences[0]).toMatchObject({
      pageIndex: 0,
      story: 'textbox',
      rootStory: 'body',
    });
    expect(comment?.occurrences[0]?.textboxPath).toHaveLength(1);
  } finally {
    opened.session.dispose();
  }
});

test('a body range does not absorb an unrelated nested textbox lane', async () => {
  const textbox = textboxDrawing('<w:p><w:r><w:t>unrelated box</w:t></w:r></w:p>');
  const source = pkg(
    '<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>body start</w:t></w:r></w:p>' +
      `<w:p><w:r>${textbox}</w:r></w:p>` +
      '<w:p><w:r><w:t>body end</w:t></w:r><w:commentRangeEnd w:id="0"/>' +
      '<w:r><w:commentReference w:id="0"/></w:r></w:p>',
    undefined,
    {
      relationships: `<Relationship Id="rComments" Type="${R}/comments" Target="comments.xml"/>`,
      contentTypes:
        '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>',
      entries: {
        'word/comments.xml': strToU8(
          `<w:comments xmlns:w="${W}"><w:comment w:id="0" w:author="Ada">` +
            '<w:p><w:r><w:t>Body only</w:t></w:r></w:p></w:comment></w:comments>'
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
    const comment = (await opened.session.layout()).reviewArtifacts.find(
      (artifact) => artifact.kind === 'comment'
    );
    expect(comment?.occurrences.length).toBeGreaterThan(1);
    expect(
      comment?.occurrences.every(
        ({ story, textboxPath }) => story === 'body' && textboxPath.length === 0
      )
    ).toBe(true);
  } finally {
    opened.session.dispose();
  }
});

test('a multi-paragraph textbox range stays in one exact drawing path', async () => {
  const textbox = textboxDrawing(
    '<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>box start</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>box end</w:t></w:r><w:commentRangeEnd w:id="0"/>' +
      '<w:r><w:commentReference w:id="0"/></w:r></w:p>'
  );
  const source = pkg(`<w:p><w:r>${textbox}</w:r></w:p>`, undefined, {
    relationships: `<Relationship Id="rComments" Type="${R}/comments" Target="comments.xml"/>`,
    contentTypes:
      '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>',
    entries: {
      'word/comments.xml': strToU8(
        `<w:comments xmlns:w="${W}"><w:comment w:id="0" w:author="Ada">` +
          '<w:p><w:r><w:t>Textbox range</w:t></w:r></w:p></w:comment></w:comments>'
      ),
    },
  });
  const main = source.parts.get(source.mainDocumentPart)!;
  const opened = openDocumentForExport(
    liveView(new TreePackageStore(source, normalizeParagraphIdentity(main)))
  );
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  try {
    const comment = (await opened.session.layout()).reviewArtifacts.find(
      (artifact) => artifact.kind === 'comment'
    );
    const paths = comment?.occurrences.map(({ textboxPath }) => textboxPath.join('/')) ?? [];
    expect(paths.length).toBeGreaterThan(1);
    expect(new Set(paths).size).toBe(1);
    expect(comment?.occurrences.every(({ story }) => story === 'textbox')).toBe(true);
  } finally {
    opened.session.dispose();
  }
});

test('a comment around a floating drawing is placed by canonical drawing traversal', async () => {
  const drawing = textboxDrawing('<w:p><w:r><w:t>shape text</w:t></w:r></w:p>');
  const source = pkg(
    `<w:p><w:commentRangeStart w:id="0"/><w:r>${drawing}</w:r>` +
      '<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>',
    undefined,
    {
      relationships: `<Relationship Id="rComments" Type="${R}/comments" Target="comments.xml"/>`,
      contentTypes:
        '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>',
      entries: {
        'word/comments.xml': strToU8(
          `<w:comments xmlns:w="${W}"><w:comment w:id="0" w:author="Ada">` +
            '<w:p><w:r><w:t>Floating shape</w:t></w:r></w:p></w:comment></w:comments>'
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
    const comment = (await opened.session.layout()).reviewArtifacts.find(
      (artifact) => artifact.kind === 'comment'
    );
    expect(comment?.occurrences).toHaveLength(1);
    expect(comment?.occurrences[0]).toMatchObject({ story: 'body', pageIndex: 0 });
    expect(comment?.occurrences[0]?.source.end.offset).toBeGreaterThan(
      comment?.occurrences[0]?.source.start.offset ?? 0
    );
  } finally {
    opened.session.dispose();
  }
});

test('fully hidden revision-only paragraphs do not acquire zero-width page occurrences', async () => {
  const source = pkg(
    '<w:p><w:ins w:id="insert/private" w:author="Ada"><w:r><w:t>inserted</w:t></w:r></w:ins></w:p>' +
      '<w:p><w:del w:id="delete/private" w:author="Grace"><w:r><w:delText>deleted</w:delText></w:r></w:del></w:p>'
  );
  const main = source.parts.get(source.mainDocumentPart)!;
  const opened = openDocumentForExport(
    liveView(new TreePackageStore(source, normalizeParagraphIdentity(main)))
  );
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  try {
    const allMarkup = (await opened.session.layout()).reviewArtifacts.filter(
      (artifact) => artifact.kind === 'tracked-change'
    );
    expect(allMarkup.every(({ id }) => /^[a-z0-9_-]+$/.test(id))).toBe(true);
    expect(allMarkup.every(({ id }) => !id.includes('private') && !id.includes('\0'))).toBe(true);
    expect(allMarkup.every(({ occurrences }) => occurrences.length > 0)).toBe(true);

    const originalInsertion = (await opened.session.layoutFor('original')).reviewArtifacts.find(
      (artifact) => artifact.kind === 'tracked-change' && artifact.change === 'insert'
    );
    const proposedDeletion = (await opened.session.layoutFor('proposed')).reviewArtifacts.find(
      (artifact) => artifact.kind === 'tracked-change' && artifact.change === 'delete'
    );
    expect(originalInsertion?.occurrences).toEqual([]);
    expect(proposedDeletion?.occurrences).toEqual([]);
  } finally {
    opened.session.dispose();
  }
});

test('a repeated table-header comment retains an occurrence on every continuation page', async () => {
  const rows = Array.from(
    { length: 36 },
    (_, index) =>
      `<w:tr><w:tc><w:p><w:r><w:t>row ${index} ${'body '.repeat(8)}</w:t></w:r></w:p></w:tc></w:tr>`
  ).join('');
  const source = pkg(
    '<w:tbl><w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:p>' +
      '<w:commentRangeStart w:id="0"/><w:r><w:t>REPEATED HEAD</w:t></w:r>' +
      '<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r>' +
      `</w:p></w:tc></w:tr>${rows}</w:tbl>` +
      '<w:sectPr><w:pgSz w:w="4320" w:h="2160"/><w:pgMar w:top="72" w:right="72" w:bottom="72" w:left="72"/></w:sectPr>',
    undefined,
    {
      relationships: `<Relationship Id="rComments" Type="${R}/comments" Target="comments.xml"/>`,
      contentTypes:
        '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>',
      entries: {
        'word/comments.xml': strToU8(
          `<w:comments xmlns:w="${W}"><w:comment w:id="0" w:author="Ada">` +
            '<w:p><w:r><w:t>Repeat with the header</w:t></w:r></w:p>' +
            '</w:comment></w:comments>'
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
      (artifact) => artifact.kind === 'comment' && artifact.text === 'Repeat with the header'
    );
    expect(layout.pages.length).toBeGreaterThan(2);
    // Every page the table reaches; the empty paragraph after it may start a page of its own.
    expect(comment?.occurrences.map(({ pageIndex }) => pageIndex)).toEqual(
      layout.pages
        .filter(({ fragments }) => fragments.some((fragment) => fragment.kind === 'table'))
        .map(({ index }) => index)
    );
    expect(comment?.occurrences.every(({ story }) => story === 'body')).toBe(true);
  } finally {
    opened.session.dispose();
  }
});

test('a comment in a footnote is placed in its page-local note story', async () => {
  const source = pkg(
    '<w:p><w:r><w:t>Body citation</w:t><w:footnoteReference w:id="1"/></w:r></w:p>',
    undefined,
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
            '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
            '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
            '<w:footnote w:id="1"><w:p><w:commentRangeStart w:id="0"/>' +
            '<w:r><w:t>reviewed note</w:t></w:r><w:commentRangeEnd w:id="0"/>' +
            '<w:r><w:commentReference w:id="0"/></w:r></w:p></w:footnote></w:footnotes>'
        ),
        'word/comments.xml': strToU8(
          `<w:comments xmlns:w="${W}"><w:comment w:id="0" w:author="Ada">` +
            '<w:p><w:r><w:t>Footnote review</w:t></w:r></w:p>' +
            '</w:comment></w:comments>'
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
    const comment = (await opened.session.layout()).reviewArtifacts?.find(
      (artifact) => artifact.kind === 'comment' && artifact.text === 'Footnote review'
    );
    expect(comment?.occurrences).toHaveLength(1);
    expect(comment?.occurrences[0]).toMatchObject({
      pageIndex: 0,
      physicalPageNumber: 1,
      story: 'footnote',
      rootStory: 'footnote',
      noteScopeId: 'footnote:1',
      noteAreaKind: 'footnotes',
      source: { partName: '/word/footnotes.xml' },
    });
  } finally {
    opened.session.dispose();
  }
});

test('a separator comment is placed on every page where the note rule repeats', async () => {
  const source = pkg(
    '<w:p><w:r><w:t>First citation</w:t><w:footnoteReference w:id="1"/></w:r></w:p>' +
      '<w:p><w:r><w:br w:type="page"/><w:t>Second citation</w:t>' +
      '<w:footnoteReference w:id="2"/></w:r></w:p>',
    undefined,
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
            '<w:footnote w:id="2"><w:p><w:r><w:t>second note</w:t></w:r></w:p></w:footnote>' +
            '</w:footnotes>'
        ),
        'word/comments.xml': strToU8(
          `<w:comments xmlns:w="${W}"><w:comment w:id="0" w:author="Ada">` +
            '<w:p><w:r><w:t>Separator review</w:t></w:r></w:p>' +
            '</w:comment></w:comments>'
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
    const notePages = layout.pages
      .filter((page) => page.footnotes !== undefined)
      .map(({ index }) => index);
    expect(notePages.length).toBeGreaterThan(1);
    expect(comment?.kind).toBe('comment');
    if (comment?.kind !== 'comment') return;
    expect(comment.orphaned).toBe(false);
    expect(comment.occurrences.map(({ pageIndex }) => pageIndex)).toEqual(notePages);
    expect(
      comment.occurrences.every(
        ({ story, rootStory, noteScopeId, noteAreaKind, source }) =>
          story === 'note-separator' &&
          rootStory === 'note-separator' &&
          noteScopeId === null &&
          noteAreaKind === 'footnotes' &&
          source.partName === '/word/footnotes.xml'
      )
    ).toBe(true);
  } finally {
    opened.session.dispose();
  }
});

test('a reusable export session refreshes review artifacts with the live package revision', async () => {
  const revisionPackage = (commentText: string): OoxmlPackage => {
    const source = pkg(
      '<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>reviewed</w:t></w:r>' +
        '<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>',
      undefined,
      {
        relationships: `<Relationship Id="rComments" Type="${R}/comments" Target="comments.xml"/>`,
        contentTypes:
          '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>',
        entries: {
          'word/comments.xml': strToU8(
            `<w:comments xmlns:w="${W}"><w:comment w:id="0" w:author="Ada">` +
              `<w:p><w:r><w:t>${commentText}</w:t></w:r></w:p>` +
              '</w:comment></w:comments>'
          ),
        },
      }
    );
    const normalizedMain = normalizeParagraphIdentity(source.parts.get(source.mainDocumentPart)!);
    return Object.freeze({
      ...source,
      parts: new Map(source.parts).set(normalizedMain.name, normalizedMain),
    });
  };
  let activePackage = revisionPackage('First review text');
  let revision = 0;
  const view: HeadlessDocumentView = {
    part: () => activePackage.parts.get(activePackage.mainDocumentPart)!,
    currentPackage: () => activePackage,
    packageRevision: () => revision,
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
  const commentText = async (): Promise<string | undefined> =>
    (await opened.session.layout()).reviewArtifacts?.find((artifact) => artifact.kind === 'comment')
      ?.text;
  try {
    expect(await commentText()).toBe('First review text');
    activePackage = revisionPackage('Refreshed review text');
    revision += 1;
    expect(await commentText()).toBe('Refreshed review text');
  } finally {
    opened.session.dispose();
  }
});

test('structural cell-only revisions pass the canonical review preflight', async () => {
  const source = pkg(
    '<w:tbl><w:tr><w:tc><w:tcPr><w:cellIns w:id="7" w:author="Ada"/></w:tcPr>' +
      '<w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
  );
  const main = source.parts.get(source.mainDocumentPart)!;
  const opened = openDocumentForExport(
    liveView(new TreePackageStore(source, normalizeParagraphIdentity(main)))
  );
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  try {
    const changes = (await opened.session.layout()).reviewArtifacts?.filter(
      (artifact) => artifact.kind === 'tracked-change'
    );
    expect(changes).toHaveLength(1);
    expect(changes?.[0]).toMatchObject({ change: 'structural', author: 'Ada' });
  } finally {
    opened.session.dispose();
  }
});

test('export publishes normalized comments with page provenance and retains orphaned comments', async () => {
  const source = pkg(
    '<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>anchored</w:t></w:r>' +
      '<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>',
    undefined,
    {
      relationships: `<Relationship Id="rComments" Type="${R}/comments" Target="comments.xml"/>`,
      contentTypes:
        '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>',
      entries: {
        'word/comments.xml': strToU8(
          `<w:comments xmlns:w="${W}">` +
            '<w:comment w:id="0" w:author="Ada" w:initials="AL"><w:p><w:r><w:t>Check this</w:t></w:r></w:p></w:comment>' +
            '<w:comment w:id="1" w:author="Grace"><w:p><w:r><w:t>Unanchored</w:t></w:r></w:p></w:comment>' +
            '</w:comments>'
        ),
      },
    }
  );
  const main = source.parts.get(source.mainDocumentPart)!;
  const store = new TreePackageStore(source, normalizeParagraphIdentity(main));
  const opened = openDocumentForExport(liveView(store));
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  try {
    const layout = await opened.session.layout();
    const comments = layout.reviewArtifacts?.filter((artifact) => artifact.kind === 'comment');
    expect(comments).toHaveLength(2);
    expect(comments?.every(({ id }) => /^[a-z0-9_-]+$/.test(id))).toBe(true);
    expect(new Set(comments?.map(({ id }) => id)).size).toBe(2);
    expect(comments?.find((comment) => comment.text === 'Check this')).toMatchObject({
      author: 'Ada',
      initials: 'AL',
      referenceOrder: 0,
      text: 'Check this',
      orphaned: false,
      occurrences: [{ pageIndex: 0, physicalPageNumber: 1, story: 'body' }],
    });
    expect(comments?.find((comment) => comment.text === 'Unanchored')).toMatchObject({
      orphaned: true,
      occurrences: [],
    });
    expect(comments?.find((comment) => comment.text === 'Unanchored')?.referenceOrder).toBe(
      undefined
    );
    expect(Object.isFrozen(comments?.[0])).toBe(true);
    expect(Object.isFrozen(comments?.[0]?.occurrences)).toBe(true);
    expect(Object.isFrozen(comments?.[0]?.occurrences[0]?.source)).toBe(true);
    expect(Object.isFrozen(comments?.[0]?.replyIds)).toBe(true);
  } finally {
    opened.session.dispose();
  }
});

test('orphan-only review metadata does not walk the semantic page graph', () => {
  const source = pkg('<w:p><w:r><w:t>body</w:t></w:r></w:p>', undefined, {
    relationships: `<Relationship Id="rComments" Type="${R}/comments" Target="comments.xml"/>`,
    contentTypes:
      '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>',
    entries: {
      'word/comments.xml': strToU8(
        `<w:comments xmlns:w="${W}"><w:comment w:id="0" w:author="Ada">` +
          '<w:p><w:r><w:t>Orphan only</w:t></w:r></w:p></w:comment></w:comments>'
      ),
    },
  });
  const layout = Object.defineProperty({ revision: 0 }, 'pages', {
    get: () => {
      throw new Error('page graph must not be read');
    },
  }) as SemanticLayout;

  expect(projectReviewArtifacts(layout, source)).toMatchObject([
    { kind: 'comment', text: 'Orphan only', orphaned: true, occurrences: [] },
  ]);
});

test('a property change that leaves the formatting unchanged has no artifact and no markup', async () => {
  const change = (value: string, text: string) =>
    `<w:p><w:pPr><w:jc w:val="${value}"/><w:pPrChange w:id="${text.length}" w:author="Ada" w:date="2026-03-01T10:00:00Z"><w:pPr/></w:pPrChange></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
  const source = pkg(change('left', 'Unlisted') + change('center', 'Listed'));
  const main = source.parts.get(source.mainDocumentPart)!;
  const opened = openDocumentForExport(
    liveView(new TreePackageStore(source, normalizeParagraphIdentity(main)))
  );
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  try {
    const layout = await opened.session.layout();
    const revisions = layout.reviewArtifacts?.filter(
      (artifact) => artifact.kind === 'tracked-change'
    );
    expect(revisions).toHaveLength(1);
    // Paragraph ids whose laid-out properties still carry the paragraph-property change.
    const marked = new Set<string>();
    const seen = new Set<object>();
    const visit = (value: unknown, paragraphId: string | undefined, depth: number): void => {
      if (depth > 40 || value === null || typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      const record = value as Record<string, unknown>;
      const here = typeof record.paragraphId === 'string' ? record.paragraphId : paragraphId;
      const props = record.props;
      if (
        here &&
        Array.isArray(props) &&
        props.some((property) => (property as { localName?: string }).localName === 'pPrChange')
      ) {
        marked.add(here);
      }
      for (const entry of Object.values(record)) visit(entry, here, depth + 1);
    };
    visit(layout.pages, undefined, 0);
    expect(marked.size).toBe(1);
  } finally {
    opened.session.dispose();
  }
});
