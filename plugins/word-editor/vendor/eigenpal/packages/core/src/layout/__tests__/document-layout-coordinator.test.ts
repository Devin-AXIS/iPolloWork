import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import {
  readOoxmlPackage,
  readOoxmlPart,
  relationshipTargetIn,
  resolveHeaderFooterPartsBySection,
  resolveHeaderFooterResolutionBySection,
  type DocumentProperties,
  type HeadlessDocumentView,
  type OoxmlElement,
  type OoxmlPackage,
} from '@docx-editor.dev/core/store';
import { createDocumentFurnitureSource } from '../document-furniture-source.ts';
import { layoutDocumentView } from '../document-layout-coordinator.ts';
import { createDocumentLinkProjectors } from '../document-link-projector.ts';
import { createDocumentStyleDependencies } from '../document-style-deps.ts';
import { createStoryProjectionDependencies } from '../text-projection-epoch.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { createLayoutSession } from '../layout-session.ts';
import type { PendingLine } from '../pending-line.ts';
import { revisionAuthorFilter } from '../revision-projection.ts';
import type { BlockFragmentRecord, SemanticLayout, StyleSpanRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const HYPERLINK = `${R}/hyperlink`;

const titleField =
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  '<w:r><w:instrText> TITLE </w:instrText></w:r>' +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';

function story(label: string, relationshipId: string): string {
  return (
    `<w:p><w:hyperlink r:id="${relationshipId}"><w:r><w:t>${label}-link</w:t></w:r></w:hyperlink></w:p>` +
    `<w:p>${titleField}</w:p>` +
    `<w:p><w:r><w:t>x</w:t><w:tab/><w:t>${label}-tab</w:t></w:r></w:p>`
  );
}

function packageWithTargets(suffix: string, bodyPrefix = ''): OoxmlPackage {
  const body =
    bodyPrefix +
    story('body', 'rIdBodyLink') +
    '<w:p><w:r><w:footnoteReference w:id="1"/></w:r></w:p>' +
    '<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/></w:sectPr>';
  const footnotes =
    '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
    '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
    `<w:footnote w:id="1">${story('note', 'rIdNoteLink')}</w:footnote>`;
  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
        '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rIdHeader" Type="${R}/header" Target="header1.xml"/>` +
        `<Relationship Id="rIdFootnotes" Type="${R}/footnotes" Target="footnotes.xml"/>` +
        `<Relationship Id="rIdBodyLink" Type="${HYPERLINK}" Target="https://body.${suffix}.example" TargetMode="External"/>` +
        '</Relationships>'
    ),
    'word/_rels/header1.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdHeaderLink" Type="${HYPERLINK}" Target="https://header.${suffix}.example" TargetMode="External"/></Relationships>`
    ),
    'word/_rels/footnotes.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdNoteLink" Type="${HYPERLINK}" Target="https://note.${suffix}.example" TargetMode="External"/></Relationships>`
    ),
    // This owner is deliberately not a currently supported story. Its relationship proves the
    // projection epoch is future-story-safe rather than tied to today's story allowlist.
    'word/_rels/comments.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdFuture" Type="${HYPERLINK}" Target="https://future.${suffix}.example" TargetMode="External"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`
    ),
    'word/header1.xml': strToU8(
      `<w:hdr xmlns:w="${W}" xmlns:r="${R}">${story('header', 'rIdHeaderLink')}</w:hdr>`
    ),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}" xmlns:r="${R}">${footnotes}</w:footnotes>`
    ),
  };
  const loaded = readOoxmlPackage(zipSync(entries));
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.package;
}

function settings(defaultTabStopTwips: number): OoxmlElement {
  const loaded = readOoxmlPart(
    `<w:settings xmlns:w="${W}"><w:defaultTabStop w:val="${defaultTabStopTwips}"/></w:settings>`,
    { name: '/word/settings.xml', contentType: 'application/xml' }
  );
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.part.root;
}

function spansOfFragments(fragments: readonly BlockFragmentRecord[]): StyleSpanRecord[] {
  return fragments.flatMap((fragment) =>
    fragment.kind === 'paragraph' ? fragment.lines.flatMap((line) => line.spans) : []
  );
}

type StoryLane = 'body' | 'header' | 'note';

function spansOf(layout: SemanticLayout, lane: StoryLane): StyleSpanRecord[] {
  if (lane === 'body') return layout.pages.flatMap((page) => spansOfFragments(page.fragments));
  if (lane === 'header') {
    return layout.pages.flatMap((page) => spansOfFragments(page.header?.fragments ?? []));
  }
  return layout.pages.flatMap((page) =>
    (page.footnotes?.notes ?? []).flatMap((note) => spansOfFragments(note.fragments))
  );
}

function hrefOf(layout: SemanticLayout, lane: StoryLane): string | null | undefined {
  return spansOf(layout, lane).find((span) => span.link)?.link?.href;
}

function projectedTextOf(layout: SemanticLayout, lane: StoryLane): string {
  return spansOf(layout, lane)
    .filter((span) => span.projected && !span.noteNav)
    .map((span) => span.text)
    .join('');
}

function tabbedTextX(layout: SemanticLayout, lane: StoryLane): number {
  const span = spansOf(layout, lane).find(
    (candidate) => candidate.text === `${lane}-` && !candidate.link
  );
  if (!span) throw new Error(`missing ${lane} tabbed span`);
  return span.box.x;
}

function firstParagraphOf(part: OoxmlElement): OoxmlElement {
  const stack: OoxmlElement[] = [part];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.kind === 'paragraph') return node;
    for (const child of node.children) if (child.kind !== 'textValue') stack.push(child);
  }
  throw new Error('missing paragraph');
}

describe('shared document-layout coordinator invalidation', () => {
  test('projected sections retain their canonical header and footer source index', () => {
    const section = (rId: string, text: string, markRevision = '') =>
      `<w:p><w:pPr><w:sectPr><w:headerReference w:type="default" r:id="${rId}"/>` +
      `<w:pgSz w:w="${rId === 'rHeaderOne' ? 10000 : 12000}" w:h="15840"/>` +
      `</w:sectPr>${markRevision}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
    const body =
      section('rHeaderOne', 'absorbed', '<w:rPr><w:del w:id="9" w:author="Ada"/></w:rPr>') +
      section('rHeaderTwo', 'survivor') +
      '<w:p><w:r><w:t>final</w:t></w:r></w:p>' +
      '<w:sectPr><w:headerReference w:type="default" r:id="rHeaderThree"/></w:sectPr>';
    const loaded = readOoxmlPackage(
      zipSync({
        '[Content_Types].xml': strToU8(
          `<Types xmlns="${CT}">` +
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
            [1, 2, 3]
              .map(
                (index) =>
                  `<Override PartName="/word/header${index}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>`
              )
              .join('') +
            '</Types>'
        ),
        '_rels/.rels': strToU8(
          `<Relationships xmlns="${REL}"><Relationship Id="rDoc" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
        ),
        'word/_rels/document.xml.rels': strToU8(
          `<Relationships xmlns="${REL}">` +
            [1, 2, 3]
              .map(
                (index) =>
                  `<Relationship Id="rHeader${['One', 'Two', 'Three'][index - 1]}" Type="${R}/header" Target="header${index}.xml"/>`
              )
              .join('') +
            '</Relationships>'
        ),
        'word/document.xml': strToU8(
          `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`
        ),
        ...Object.fromEntries(
          [1, 2, 3].map((index) => [
            `word/header${index}.xml`,
            strToU8(
              `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>header ${index}</w:t></w:r></w:p></w:hdr>`
            ),
          ])
        ),
      })
    );
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
      headerFooterResolutionBySection: () => resolveHeaderFooterResolutionBySection(pkg),
      relationshipTarget: (relationshipId) =>
        relationshipTargetIn(pkg, pkg.mainDocumentPart, relationshipId),
    };
    const furniture = createDocumentFurnitureSource({
      view,
      measurer: createFixedMeasurer(6, 14),
      producer: 'projected-section-furniture-source',
      cache: createParagraphLayoutCache<readonly PendingLine[]>(),
      revisionAuthorFilter: revisionAuthorFilter(['Ada']),
      linkProjectors: createDocumentLinkProjectors(view),
    }).sectionFurniture();

    expect(furniture).toHaveLength(2);
    expect(furniture.map((entry) => entry?.headers.get('default')?.rId)).toEqual([
      'rHeaderTwo',
      'rHeaderThree',
    ]);
  });

  test('keeps occurrence rIds when distinct header and footer relationships share parts', () => {
    const body =
      '<w:p><w:pPr><w:sectPr>' +
      '<w:headerReference w:type="default" r:id="rHeaderOne"/>' +
      '<w:footerReference w:type="default" r:id="rFooterOne"/>' +
      '</w:sectPr></w:pPr><w:r><w:t>one</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>two</w:t></w:r></w:p>' +
      '<w:sectPr>' +
      '<w:headerReference w:type="default" r:id="rHeaderTwo"/>' +
      '<w:footerReference w:type="default" r:id="rFooterTwo"/>' +
      '</w:sectPr>';
    const loaded = readOoxmlPackage(
      zipSync({
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
            `<Relationship Id="rHeaderOne" Type="${R}/header" Target="header1.xml"/>` +
            `<Relationship Id="rHeaderTwo" Type="${R}/header" Target="header1.xml"/>` +
            `<Relationship Id="rFooterOne" Type="${R}/footer" Target="footer1.xml"/>` +
            `<Relationship Id="rFooterTwo" Type="${R}/footer" Target="footer1.xml"/>` +
            '</Relationships>'
        ),
        'word/document.xml': strToU8(
          `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`
        ),
        'word/header1.xml': strToU8(
          `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>shared header</w:t></w:r></w:p></w:hdr>`
        ),
        'word/footer1.xml': strToU8(
          `<w:ftr xmlns:w="${W}"><w:p><w:r><w:t>shared footer</w:t></w:r></w:p></w:ftr>`
        ),
      })
    );
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
      headerFooterResolutionBySection: () => resolveHeaderFooterResolutionBySection(pkg),
      relationshipTarget: (relationshipId) =>
        relationshipTargetIn(pkg, pkg.mainDocumentPart, relationshipId),
    };
    const source = createDocumentFurnitureSource({
      view,
      measurer: createFixedMeasurer(6, 14),
      producer: 'shared-part-occurrence-rids',
      cache: createParagraphLayoutCache<readonly PendingLine[]>(),
      linkProjectors: createDocumentLinkProjectors(view),
    });
    const furniture = source.sectionFurniture();

    const firstHeader = furniture[0]?.headers.get('default');
    const secondHeader = furniture[1]?.headers.get('default');
    const firstFooter = furniture[0]?.footers.get('default');
    const secondFooter = furniture[1]?.footers.get('default');
    expect([firstHeader?.rId, secondHeader?.rId]).toEqual(['rHeaderOne', 'rHeaderTwo']);
    expect([firstFooter?.rId, secondFooter?.rId]).toEqual(['rFooterOne', 'rFooterTwo']);
    // The wrappers carry occurrence identity; shared semantic work remains part-memoized.
    expect(secondHeader?.fragments).toBe(firstHeader?.fragments);
    expect(secondFooter?.fragments).toBe(firstFooter?.fragments);
    expect(secondHeader).not.toBe(firstHeader);
    expect(secondFooter).not.toBe(firstFooter);

    // Repeating a layout pass reuses each occurrence wrapper, preserving the identity-keyed
    // header/footer marker and drawing-resource token caches on the editor keystroke path.
    const repeated = source.sectionFurniture();
    expect(repeated[0]?.headers.get('default')).toBe(firstHeader);
    expect(repeated[1]?.headers.get('default')).toBe(secondHeader);
    expect(repeated[0]?.footers.get('default')).toBe(firstFooter);
    expect(repeated[1]?.footers.get('default')).toBe(secondFooter);
  });

  test('keeps a shared story per page geometry when sections alternate orientation', () => {
    // Portrait, landscape, portrait: one header and one footer part serve all three.
    const portrait = '<w:pgSz w:w="12240" w:h="15840"/>';
    const landscape = '<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>';
    const references =
      '<w:headerReference w:type="default" r:id="rHeader"/>' +
      '<w:footerReference w:type="default" r:id="rFooter"/>';
    const sectionBreak = (size: string) =>
      `<w:p><w:pPr><w:sectPr>${references}${size}</w:sectPr></w:pPr></w:p>`;
    const loaded = readOoxmlPackage(
      zipSync({
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
            '</Relationships>'
        ),
        'word/document.xml': strToU8(
          `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
            sectionBreak(portrait) +
            sectionBreak(landscape) +
            `<w:sectPr>${references}${portrait}</w:sectPr>` +
            '</w:body></w:document>'
        ),
        'word/header1.xml': strToU8(
          `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>shared header</w:t></w:r></w:p></w:hdr>`
        ),
        'word/footer1.xml': strToU8(
          `<w:ftr xmlns:w="${W}"><w:p><w:r><w:t>shared footer</w:t></w:r></w:p></w:ftr>`
        ),
      })
    );
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
      headerFooterResolutionBySection: () => resolveHeaderFooterResolutionBySection(pkg),
      relationshipTarget: (relationshipId) =>
        relationshipTargetIn(pkg, pkg.mainDocumentPart, relationshipId),
    };
    const source = createDocumentFurnitureSource({
      view,
      measurer: createFixedMeasurer(6, 14),
      producer: 'alternating-geometry',
      cache: createParagraphLayoutCache<readonly PendingLine[]>(),
      linkProjectors: createDocumentLinkProjectors(view),
    });
    const fragmentsOf = (all: ReturnType<typeof source.sectionFurniture>) =>
      all.flatMap((entry) => [
        entry?.headers.get('default')?.fragments,
        entry?.footers.get('default')?.fragments,
      ]);
    const first = fragmentsOf(source.sectionFurniture());
    expect(first).toHaveLength(6);
    // The landscape section lays the shared parts out at its own width.
    expect(first[2]).not.toBe(first[0]);
    // The portrait sections share one layout, and a second pass re-lays nothing. With one
    // memo slot per part, each section evicted the other geometry's layout, so every pass
    // re-laid the shared header and footer once per section.
    expect(first[4]).toBe(first[0]);
    const repeated = fragmentsOf(source.sectionFurniture());
    repeated.forEach((fragments, index) => expect(fragments).toBe(first[index]));
  });

  test('refreshes a memoized furniture story when only its main-owner rId changes', () => {
    const firstPackage = packageWithTargets('one');
    const headerPart = firstPackage.parts.get('/word/header1.xml')!;
    let pkg = firstPackage;
    const sectionParts = Object.freeze([
      Object.freeze({
        titlePage: false,
        evenAndOddHeaders: false,
        headers: new Map([['default' as const, headerPart]]),
        footers: new Map(),
      }),
    ]);
    const view: HeadlessDocumentView = {
      part: () => firstPackage.parts.get(firstPackage.mainDocumentPart)!,
      currentPackage: () => pkg,
      packageRevision: () => 1,
      stylesRoot: () => null,
      numberingRoot: () => null,
      settingsRoot: () => null,
      documentThemeFonts: () => ({ major: null, minor: null }),
      documentProperties: () => ({}),
      headerFooterPartsBySection: () => sectionParts,
      relationshipTarget: (relationshipId) =>
        relationshipTargetIn(pkg, pkg.mainDocumentPart, relationshipId),
    };
    const furniture = createDocumentFurnitureSource({
      view,
      measurer: createFixedMeasurer(6, 14),
      producer: 'furniture-rid-shell-refresh',
      cache: createParagraphLayoutCache<readonly PendingLine[]>(),
      linkProjectors: createDocumentLinkProjectors(view),
    });

    const firstStory = furniture.furniture()?.headers.get('default');
    expect(firstStory?.rId).toBe('rIdHeader');

    const relationships = new Map(firstPackage.relationships);
    relationships.set(
      firstPackage.mainDocumentPart,
      Object.freeze(
        (relationships.get(firstPackage.mainDocumentPart) ?? []).map((record) =>
          record.id === 'rIdHeader' ? Object.freeze({ ...record, id: 'rIdHeaderNext' }) : record
        )
      )
    );
    // Same revision and exact same body/header part identities: only the package shell's main-owner
    // relationship id changes, so every other furniture memo input remains stable.
    pkg = Object.freeze({ ...firstPackage, relationships });

    const refreshedStory = furniture.furniture()?.headers.get('default');
    expect(refreshedStory?.rId).toBe('rIdHeaderNext');
    expect(refreshedStory).not.toBe(firstStory);

    // A body-only package shell preserves the immutable main-relationship owner, so ordinary
    // keystrokes reuse the occurrence wrapper and its identity-keyed marker/resource tokens.
    pkg = Object.freeze({ ...firstPackage });
    const sameIdNewShellStory = furniture.furniture()?.headers.get('default');
    expect(sameIdNewShellStory?.rId).toBe('rIdHeader');
    expect(sameIdNewShellStory).toBe(firstStory);

    // Replacing that exact owner invalidates the wrapper even when its current rId is textually
    // equal. Old relationship snapshots own their maps weakly and can leave bounded history.
    const sameRecords = new Map(firstPackage.relationships);
    sameRecords.set(
      firstPackage.mainDocumentPart,
      Object.freeze([...(sameRecords.get(firstPackage.mainDocumentPart) ?? [])])
    );
    pkg = Object.freeze({ ...firstPackage, relationships: sameRecords });
    expect(furniture.furniture()?.headers.get('default')).not.toBe(firstStory);

    // A still-live relationship snapshot retains stable identity if the host returns to it.
    pkg = firstPackage;
    expect(furniture.furniture()?.headers.get('default')).toBe(firstStory);
  });

  test('one cache, session, and furniture source stay live across projection and settings revisions', () => {
    const firstPackage = packageWithTargets('one');
    const secondPackage = packageWithTargets('two');
    let pkg = firstPackage;
    let revision = 1;
    let properties: DocumentProperties = { title: 'Title One' };
    let settingsRoot = settings(720);
    const view: HeadlessDocumentView = {
      part: () => firstPackage.parts.get(firstPackage.mainDocumentPart)!,
      currentPackage: () => pkg,
      packageRevision: () => revision,
      stylesRoot: () => null,
      numberingRoot: () => null,
      settingsRoot: () => settingsRoot,
      documentThemeFonts: () => ({ major: null, minor: null }),
      documentProperties: () => properties,
      headerFooterPartsBySection: () => resolveHeaderFooterPartsBySection(pkg),
      relationshipTarget: (relationshipId) =>
        relationshipTargetIn(pkg, pkg.mainDocumentPart, relationshipId),
    };
    const measurer = createFixedMeasurer(6, 14);
    const cache = createParagraphLayoutCache<readonly PendingLine[]>();
    const session = createLayoutSession();
    const styles = createDocumentStyleDependencies(view);
    const links = createDocumentLinkProjectors(view);
    const furniture = createDocumentFurnitureSource({
      view,
      measurer,
      producer: 'shared-coordinator-regression',
      cache,
      styleCascade: styles.styleCascade,
      numberingIndex: styles.numberingIndex,
      defaultTabStopPt: styles.defaultTabStopPt,
      linkProjectors: links,
    });
    const layout = (): SemanticLayout =>
      layoutDocumentView({
        view,
        revision,
        measurer,
        cache,
        session,
        producer: 'shared-coordinator-regression',
        styleCascade: styles.styleCascade,
        numberingIndex: styles.numberingIndex,
        defaultTabStopPt: styles.defaultTabStopPt,
        furniture,
        linkProjectors: links,
      });
    const lanes: readonly StoryLane[] = ['body', 'header', 'note'];

    const initial = layout();
    for (const lane of lanes) {
      expect(hrefOf(initial, lane)).toBe(`https://${lane}.one.example`);
      expect(projectedTextOf(initial, lane)).toBe('Title One');
    }
    const initialTabX = new Map(lanes.map((lane) => [lane, tabbedTextX(initial, lane)]));
    const missesAfterInitial = cache.stats.misses;

    // Relationship-only revision. Keep every story-tree identity from firstPackage: only the
    // package relationship projections change, while cache/session/furniture objects stay live.
    pkg = Object.freeze({
      ...firstPackage,
      relationships: secondPackage.relationships,
      externalTargets: secondPackage.externalTargets,
    });
    revision += 1;
    const relChanged = layout();
    for (const lane of lanes) {
      expect(hrefOf(relChanged, lane)).toBe(`https://${lane}.two.example`);
      expect(projectedTextOf(relChanged, lane)).toBe('Title One');
    }
    expect(cache.stats.misses - missesAfterInitial).toBeLessThanOrEqual(3);

    // Property-only revision, again retaining all story and derived-state owners.
    properties = { title: 'Title Two' };
    revision += 1;
    const missesBeforePropertyChange = cache.stats.misses;
    const propertyChanged = layout();
    for (const lane of lanes) expect(projectedTextOf(propertyChanged, lane)).toBe('Title Two');
    expect(cache.stats.misses - missesBeforePropertyChange).toBeLessThanOrEqual(3);

    // Settings-root-only revision. The callback is intentionally captured once by both the
    // coordinator and furniture source; its live read must still update every story's tabs.
    settingsRoot = settings(1440);
    revision += 1;
    const settingsChanged = layout();
    for (const lane of lanes) {
      expect(tabbedTextX(settingsChanged, lane)).toBeGreaterThan(initialTabX.get(lane)! + 30);
    }
  });

  test('an unreferenced same-owner relationship preserves every body break and checkpoint', () => {
    const filler = Array.from(
      { length: 180 },
      (_, index) => `<w:p><w:r><w:t>filler ${index} ${'word '.repeat(14)}</w:t></w:r></w:p>`
    ).join('');
    const firstPackage = packageWithTargets('one', filler);
    const secondPackage = packageWithTargets('two', filler);
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
      documentProperties: () => ({ title: 'Stable' }),
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
      producer: 'projection-locality',
      cache,
      linkProjectors: links,
    });
    const lay = () =>
      layoutDocumentView({
        view,
        revision,
        measurer: createFixedMeasurer(6, 14),
        cache,
        session,
        producer: 'projection-locality',
        furniture,
        linkProjectors: links,
      });
    const first = lay();
    const misses = cache.stats.misses;
    const fullPasses = session.stats.fullPasses;
    pkg = Object.freeze({
      ...firstPackage,
      externalTargets: Object.freeze([
        ...firstPackage.externalTargets,
        ...Array.from({ length: 1_024 }, (_, index) => ({
          ownerPart: firstPackage.mainDocumentPart,
          id: `rIdUnused${index}`,
          type: HYPERLINK,
          rawTarget: `https://unused-${index}.example`,
          sinkSafe: true,
        })),
      ]),
    });
    revision += 1;
    const second = lay();
    expect(cache.stats.misses).toBe(misses);
    expect(session.stats.placed).toBe(0);
    expect(session.stats.fullPasses).toBe(fullPasses);
    expect(hrefOf(second, 'body')).toBe(hrefOf(first, 'body'));

    const missesBeforeReferencedChange = cache.stats.misses;
    const fullPassesBeforeReferencedChange = session.stats.fullPasses;
    const bodyPartName = firstPackage.mainDocumentPart;
    const relationships = new Map(firstPackage.relationships);
    relationships.set(bodyPartName, secondPackage.relationships.get(bodyPartName) ?? []);
    pkg = Object.freeze({
      ...firstPackage,
      relationships,
      externalTargets: Object.freeze([
        ...firstPackage.externalTargets.filter(
          (target) => !(target.ownerPart === bodyPartName && target.id === 'rIdBodyLink')
        ),
        ...secondPackage.externalTargets.filter(
          (target) => target.ownerPart === bodyPartName && target.id === 'rIdBodyLink'
        ),
      ]),
    });
    revision += 1;
    const referenced = lay();
    expect(hrefOf(referenced, 'body')).toBe('https://body.two.example');
    expect(hrefOf(referenced, 'header')).toBe('https://header.one.example');
    expect(hrefOf(referenced, 'note')).toBe('https://note.one.example');
    expect(cache.stats.misses - missesBeforeReferencedChange).toBeLessThanOrEqual(3);
    expect(session.stats.placed).toBeLessThan(session.stats.total);
    expect(session.stats.reusedPages).toBeGreaterThan(0);
    expect(session.stats.fullPasses).toBe(fullPassesBeforeReferencedChange);
  });

  test('future relationship owners are scoped without invalidating current stories', () => {
    const firstPackage = packageWithTargets('one');
    const secondPackage = packageWithTargets('two');
    let revision = 1;
    let pkg = firstPackage;
    const view = {
      packageRevision: () => revision,
      currentPackage: () => pkg,
      documentProperties: () => ({}),
    } as unknown as HeadlessDocumentView;
    const links = createDocumentLinkProjectors(view);
    const firstBody = links.epochForPart(firstPackage.mainDocumentPart);
    const firstFuture = links.epochForPart('/word/comments.xml');
    const futurePart = readOoxmlPart(
      `<w:comments xmlns:w="${W}" xmlns:r="${R}"><w:p><w:r><w:drawing><w:txbxContent><w:p><w:hyperlink r:id="rIdFuture"><w:r><w:t>future</w:t></w:r></w:hyperlink></w:p></w:txbxContent></w:drawing></w:r></w:p></w:comments>`,
      { name: '/word/comments.xml', contentType: 'application/xml' }
    );
    if (!futurePart.ok) throw new Error(futurePart.reason);
    const futureParagraph = firstParagraphOf(futurePart.part.root);
    const firstFutureParagraph = links.tokenForParagraphForPart(
      futurePart.part.name,
      futureParagraph
    );
    pkg = Object.freeze({
      ...firstPackage,
      relationships: new Map([
        ...firstPackage.relationships,
        [
          '/word/comments.xml',
          secondPackage.relationships.get('/word/comments.xml') ?? [],
        ] as const,
      ]),
      externalTargets: Object.freeze([
        ...firstPackage.externalTargets.filter(
          (target) => target.ownerPart !== '/word/comments.xml'
        ),
        ...secondPackage.externalTargets.filter(
          (target) => target.ownerPart === '/word/comments.xml'
        ),
      ]),
    });
    revision += 1;
    expect(links.epochForPart(firstPackage.mainDocumentPart)).toBe(firstBody);
    expect(links.epochForPart('/word/comments.xml')).not.toBe(firstFuture);
    expect(links.tokenForParagraphForPart(futurePart.part.name, futureParagraph)).not.toBe(
      firstFutureParagraph
    );
  });

  test('memoizes table projection walks by projector and package-derived epoch', () => {
    const firstPackage = packageWithTargets('one');
    const secondPackage = packageWithTargets('two');
    const parsed = readOoxmlPart(
      `<w:tbl xmlns:w="${W}" xmlns:r="${R}"><w:tr><w:tc>` +
        Array.from(
          { length: 64 },
          (_, index) =>
            `<w:p><w:hyperlink r:id="rIdBodyLink"><w:r><w:t>${index}</w:t></w:r></w:hyperlink></w:p>`
        ).join('') +
        '</w:tc></w:tr></w:tbl>',
      { name: '/word/table-test.xml', contentType: 'application/xml' }
    );
    if (!parsed.ok) throw new Error(parsed.reason);
    let pkg = firstPackage;
    let packageReads = 0;
    const view = {
      packageRevision: () => 7,
      currentPackage: () => {
        packageReads += 1;
        return pkg;
      },
      documentProperties: () => ({}),
    } as unknown as HeadlessDocumentView;
    const links = createDocumentLinkProjectors(view);

    const first = links.tokenForTableForPart(firstPackage.mainDocumentPart, parsed.part.root);
    expect(packageReads).toBeGreaterThan(64);
    packageReads = 0;
    expect(links.tokenForTableForPart(firstPackage.mainDocumentPart, parsed.part.root)).toBe(first);
    expect(packageReads).toBe(1);

    // A shell-only relationship write keeps the numeric revision and table/projector identities,
    // but changes the epoch and therefore must perform one new walk and publish a fresh token.
    pkg = Object.freeze({
      ...firstPackage,
      relationships: secondPackage.relationships,
      externalTargets: secondPackage.externalTargets,
    });
    packageReads = 0;
    expect(links.tokenForTableForPart(firstPackage.mainDocumentPart, parsed.part.root)).not.toBe(
      first
    );
    expect(packageReads).toBeGreaterThan(64);
  });

  test('memoizes linked paragraph projection work across equivalent part epochs', () => {
    const firstPackage = packageWithTargets('one');
    const secondPackage = packageWithTargets('two');
    const parsed = readOoxmlPart(
      `<w:p xmlns:w="${W}" xmlns:r="${R}"><w:hyperlink r:id="rIdBodyLink"><w:r><w:t>linked</w:t></w:r></w:hyperlink></w:p>`,
      { name: '/word/paragraph-test.xml', contentType: 'application/xml' }
    );
    if (!parsed.ok) throw new Error(parsed.reason);
    let pkg = firstPackage;
    let revision = 1;
    let projections = 0;
    let projectedHref = 'https://body.one.example';
    const view = {
      packageRevision: () => revision,
      currentPackage: () => pkg,
      documentProperties: () => ({}),
    } as unknown as HeadlessDocumentView;
    const project = () => {
      projections += 1;
      return { id: 'stable-link', kind: 'external' as const, href: projectedHref };
    };
    const dependencies = createStoryProjectionDependencies(view, () => project);

    const first = dependencies.tokenForParagraphForPart(
      firstPackage.mainDocumentPart,
      parsed.part.root
    );
    expect(projections).toBe(1);
    expect(
      dependencies.tokenForParagraphForPart(firstPackage.mainDocumentPart, parsed.part.root)
    ).toBe(first);
    expect(projections).toBe(1);

    revision += 1;
    expect(
      dependencies.tokenForParagraphForPart(firstPackage.mainDocumentPart, parsed.part.root)
    ).toBe(first);
    expect(projections).toBe(1);

    pkg = secondPackage;
    revision += 1;
    projectedHref = 'https://body.two.example';
    expect(
      dependencies.tokenForParagraphForPart(firstPackage.mainDocumentPart, parsed.part.root)
    ).not.toBe(first);
    expect(projections).toBe(2);
  });
});
