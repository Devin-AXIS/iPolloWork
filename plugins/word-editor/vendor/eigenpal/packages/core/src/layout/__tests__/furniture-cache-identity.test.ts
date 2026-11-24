// Furniture incremental cache identity: equal-height A→B must not reuse stale stories.
//
// Session context used to key furniture on flags + flowHeight only. Changing header/footer
// text at the same height then returned previous pages by identity with the old fragments.
// These tests lock bounded contentKey invalidation, unchanged reuse, PAGE/NUMPAGES caching,
// and section-local invalidation without resetting unrelated sections.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import {
  createFixedMeasurer,
  createLayoutSession,
  enumerateDocumentSections,
  layoutSemanticDocument,
  type PageFurniture,
  type SemanticLayout,
} from '../index.ts';
import { headerFooterContentKey, layoutHeaderFooterStory } from '../hf-layout.ts';
import { furnitureFingerprint, multiSectionStructureKey } from '../multi-section-layout.ts';
import { readOoxmlPackage, readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const measurer = createFixedMeasurer(6, 14);
const CONTENT_WIDTH = 560;

function loadBody(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function loadHfPart(kind: 'header' | 'footer', inner: string): OoxmlPart {
  const tag = kind === 'header' ? 'hdr' : 'ftr';
  const name = kind === 'header' ? '/word/header1.xml' : '/word/footer1.xml';
  const result = readOoxmlPart(`<w:${tag} xmlns:w="${W}">${inner}</w:${tag}>`, {
    name,
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function storyText(story: {
  readonly fragments: readonly {
    readonly kind: string;
    readonly lines?: readonly { readonly spans: readonly { readonly text: string }[] }[];
  }[];
}): string {
  return story.fragments
    .flatMap((fragment) =>
      fragment.kind === 'paragraph' && fragment.lines
        ? fragment.lines.flatMap((line) => line.spans.map((span) => span.text))
        : []
    )
    .join('');
}

function furnitureText(
  layout: SemanticLayout,
  pageIndex: number,
  kind: 'header' | 'footer'
): string {
  const page = layout.pages[pageIndex]!;
  const story = kind === 'header' ? page.header : page.footer;
  if (!story) return '';
  return story.fragments
    .flatMap((fragment) =>
      fragment.kind === 'paragraph'
        ? fragment.lines.flatMap((line) => line.spans.map((span) => span.text))
        : []
    )
    .join('');
}

function furnitureFromText(opts: {
  readonly header?: string;
  readonly footer?: string;
}): PageFurniture {
  const headers = new Map();
  const footers = new Map();
  if (opts.header !== undefined) {
    headers.set(
      'default',
      layoutHeaderFooterStory(
        loadHfPart(
          'header',
          `<w:p><w:r><w:t xml:space="preserve">${opts.header}</w:t></w:r></w:p>`
        ),
        CONTENT_WIDTH,
        measurer,
        'test'
      )
    );
  }
  if (opts.footer !== undefined) {
    footers.set(
      'default',
      layoutHeaderFooterStory(
        loadHfPart(
          'footer',
          `<w:p><w:r><w:t xml:space="preserve">${opts.footer}</w:t></w:r></w:p>`
        ),
        CONTENT_WIDTH,
        measurer,
        'test'
      )
    );
  }
  return {
    titlePage: false,
    evenAndOddHeaders: false,
    headers,
    footers,
  };
}

function furnitureWithFieldFooter(pageResult = ''): PageFurniture {
  const part = loadHfPart(
    'footer',
    `<w:p><w:r><w:t xml:space="preserve">Page </w:t></w:r>` +
      `<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText>` +
      `<w:fldChar w:fldCharType="separate"/><w:t xml:space="preserve">${pageResult}</w:t>` +
      `<w:fldChar w:fldCharType="end"/></w:r></w:p>`
  );
  return {
    titlePage: false,
    evenAndOddHeaders: false,
    headers: new Map(),
    footers: new Map([['default', layoutHeaderFooterStory(part, CONTENT_WIDTH, measurer, 'test')]]),
  };
}

const simpleBody =
  `<w:p><w:r><w:t xml:space="preserve">${'body word '.repeat(40)}</w:t></w:r></w:p>` +
  `<w:sectPr><w:pgSz w:w="6120" w:h="4000"/><w:pgMar w:top="400" w:right="400" w:bottom="400" w:left="400" w:header="200" w:footer="200"/></w:sectPr>`;

function twoSectionBody(): string {
  const sect = (extra = '') =>
    `<w:pPr><w:sectPr>${extra}<w:pgSz w:w="6120" w:h="3200"/><w:pgMar w:top="400" w:right="400" w:bottom="400" w:left="400" w:header="200" w:footer="200"/></w:sectPr></w:pPr>`;
  const section0 = Array.from(
    { length: 6 },
    (_, index) =>
      `<w:p>${index === 5 ? sect() : ''}<w:r><w:t>s0p${index} ${'word '.repeat(10)}</w:t></w:r></w:p>`
  ).join('');
  const section1 = Array.from(
    { length: 6 },
    (_, index) => `<w:p><w:r><w:t>s1p${index} ${'word '.repeat(10)}</w:t></w:r></w:p>`
  ).join('');
  return (
    section0 +
    section1 +
    `<w:sectPr><w:pgSz w:w="6120" w:h="3200"/><w:pgMar w:top="400" w:right="400" w:bottom="400" w:left="400" w:header="200" w:footer="200"/></w:sectPr>`
  );
}

describe('header/footer contentKey', () => {
  test('equal-height A→B stories get distinct bounded content keys', () => {
    const a = loadHfPart('header', '<w:p><w:r><w:t>Alpha</w:t></w:r></w:p>');
    const b = loadHfPart('header', '<w:p><w:r><w:t>Bravo</w:t></w:r></w:p>');
    const storyA = layoutHeaderFooterStory(a, CONTENT_WIDTH, measurer, 'test');
    const storyB = layoutHeaderFooterStory(b, CONTENT_WIDTH, measurer, 'test');
    expect(storyA.flowHeight).toBe(storyB.flowHeight);
    expect(storyA.contentKey).toMatch(/^[0-9a-f]{16}$/);
    expect(storyB.contentKey).toMatch(/^[0-9a-f]{16}$/);
    expect(storyA.contentKey).not.toBe(storyB.contentKey);
    expect(storyA.contentKey).toBe(headerFooterContentKey(a));
    expect(
      furnitureFingerprint({
        titlePage: false,
        evenAndOddHeaders: false,
        headers: new Map([['default', storyA]]),
        footers: new Map(),
      })
    ).not.toBe(
      furnitureFingerprint({
        titlePage: false,
        evenAndOddHeaders: false,
        headers: new Map([['default', storyB]]),
        footers: new Map(),
      })
    );
  });

  test('PAGE projection reuses the authored contentKey', () => {
    const part = loadHfPart(
      'footer',
      `<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r></w:p>`
    );
    const baseline = layoutHeaderFooterStory(part, CONTENT_WIDTH, measurer, 'test');
    const projected = baseline.withPageContext({ pageNumber: 3, pageCount: 9 });
    expect(projected.contentKey).toBe(baseline.contentKey);
    expect(projected).not.toBe(baseline);
    expect(storyText(projected)).toBe('3');
  });
});

describe('incremental furniture invalidation', () => {
  test('equal-height header A→B with the same session refreshes furniture text', () => {
    const session = createLayoutSession();
    const part = loadBody(simpleBody);
    const first = layoutSemanticDocument(part, 1, {
      measurer,
      session,
      furniture: furnitureFromText({ header: 'Alpha' }),
    });
    expect(furnitureText(first, 0, 'header')).toBe('Alpha');
    const second = layoutSemanticDocument(part, 2, {
      measurer,
      session,
      furniture: furnitureFromText({ header: 'Bravo' }),
    });
    expect(furnitureText(second, 0, 'header')).toBe('Bravo');
    expect(second.pages[0]).not.toBe(first.pages[0]);
  });

  test('equal-height footer A→B with the same session refreshes furniture text', () => {
    const session = createLayoutSession();
    const part = loadBody(simpleBody);
    const first = layoutSemanticDocument(part, 1, {
      measurer,
      session,
      furniture: furnitureFromText({ footer: 'FootA' }),
    });
    expect(furnitureText(first, 0, 'footer')).toBe('FootA');
    const second = layoutSemanticDocument(part, 2, {
      measurer,
      session,
      furniture: furnitureFromText({ footer: 'FootB' }),
    });
    expect(furnitureText(second, 0, 'footer')).toBe('FootB');
    expect(second.pages[0]).not.toBe(first.pages[0]);
  });

  test('unchanged furniture content reuses page identity across revisions', () => {
    const session = createLayoutSession();
    const part = loadBody(simpleBody);
    const furniture = furnitureFromText({ header: 'Same', footer: 'SameF' });
    const first = layoutSemanticDocument(part, 1, { measurer, session, furniture });
    const second = layoutSemanticDocument(part, 2, { measurer, session, furniture });
    expect(second.pages[0]).toBe(first.pages[0]);
    expect(session.stats.placed).toBe(0);
    expect(session.stats.reusedPages).toBe(first.pages.length);
    expect(furnitureText(second, 0, 'header')).toBe('Same');
  });

  test('field-bearing furniture still projects PAGE under document finalize', () => {
    const session = createLayoutSession();
    const part = loadBody(simpleBody);
    const furniture = furnitureWithFieldFooter('1');
    const first = layoutSemanticDocument(part, 1, { measurer, session, furniture });
    expect(furnitureText(first, 0, 'footer')).toBe('Page 1');
    // Same furniture object: PAGE context cache + session reuse must keep projected text.
    const second = layoutSemanticDocument(part, 2, { measurer, session, furniture });
    expect(second.pages[0]).toBe(first.pages[0]);
    expect(furnitureText(second, 0, 'footer')).toBe('Page 1');

    // Authored field result text A→B at equal height still invalidates (contentKey).
    const changed = furnitureWithFieldFooter('9');
    expect(changed.footers.get('default')!.flowHeight).toBe(
      furniture.footers.get('default')!.flowHeight
    );
    const third = layoutSemanticDocument(part, 3, { measurer, session, furniture: changed });
    expect(furnitureText(third, 0, 'footer')).toBe('Page 1');
    expect(third.pages[0]).not.toBe(second.pages[0]);
  });
});

describe('section-local furniture invalidation', () => {
  test('equal-height furniture edit in one section keeps unrelated section page identity', () => {
    const session = createLayoutSession();
    const part = loadBody(twoSectionBody());
    const sections = enumerateDocumentSections(part);
    expect(sections.length).toBe(2);

    const furnitureA: (PageFurniture | undefined)[] = [
      furnitureFromText({ header: 'Sec0-A' }),
      furnitureFromText({ header: 'Sec1-A' }),
    ];
    const before = layoutSemanticDocument(part, 1, {
      measurer,
      session,
      sectionFurniture: furnitureA,
    });
    expect(before.pages.length).toBeGreaterThan(1);
    expect(furnitureText(before, 0, 'header')).toBe('Sec0-A');

    // Structure key ignores story text: content-only change must not reset all child sessions.
    const furnitureB: (PageFurniture | undefined)[] = [
      furnitureFromText({ header: 'Sec0-A' }),
      furnitureFromText({ header: 'Sec1-B' }),
    ];
    expect(multiSectionStructureKey(sections, { measurer, sectionFurniture: furnitureA })).toBe(
      multiSectionStructureKey(sections, { measurer, sectionFurniture: furnitureB })
    );
    expect(furnitureFingerprint(furnitureA[1]!)).not.toBe(furnitureFingerprint(furnitureB[1]!));

    const after = layoutSemanticDocument(part, 2, {
      measurer,
      session,
      sectionFurniture: furnitureB,
    });

    // Section 0 sheets keep identity; section 1 furniture text updates.
    expect(after.pages[0]).toBe(before.pages[0]);
    expect(furnitureText(after, 0, 'header')).toBe('Sec0-A');
    const s1Page = after.pages.find((page) =>
      page.fragments.some(
        (fragment) =>
          fragment.kind === 'paragraph' &&
          fragment.lines.some((line) => line.spans.some((span) => span.text.includes('s1p')))
      )
    );
    expect(s1Page).toBeDefined();
    expect(furnitureText(after, s1Page!.index, 'header')).toBe('Sec1-B');
    expect(after.pages[s1Page!.index]).not.toBe(before.pages[s1Page!.index]);
  });
});

describe('package-backed equal-height header swap', () => {
  test('rebuilt package furniture A→B invalidates session pages', () => {
    const makePackage = (headerText: string): Uint8Array =>
      zipSync({
        '[Content_Types].xml': strToU8(
          `<Types xmlns="${CT}">` +
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
            '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
            '</Types>'
        ),
        '_rels/.rels': strToU8(
          `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
        ),
        'word/_rels/document.xml.rels': strToU8(
          `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/header" Target="header1.xml"/></Relationships>`
        ),
        'word/header1.xml': strToU8(
          `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t xml:space="preserve">${headerText}</w:t></w:r></w:p></w:hdr>`
        ),
        'word/document.xml': strToU8(
          `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
            `<w:p><w:r><w:t xml:space="preserve">${'body '.repeat(30)}</w:t></w:r></w:p>` +
            `<w:sectPr><w:headerReference w:type="default" r:id="rId1"/>` +
            `<w:pgSz w:w="6120" w:h="4000"/><w:pgMar w:top="400" w:right="400" w:bottom="400" w:left="400" w:header="200" w:footer="200"/>` +
            `</w:sectPr></w:body></w:document>`
        ),
      });

    const session = createLayoutSession();
    const loadFurniture = (bytes: Uint8Array): { part: OoxmlPart; furniture: PageFurniture } => {
      const loaded = readOoxmlPackage(bytes);
      if (!loaded.ok) throw new Error('load failed');
      const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
      const header = loaded.package.parts.get('/word/header1.xml')!;
      const story = layoutHeaderFooterStory(header, CONTENT_WIDTH, measurer, 'test');
      return {
        part,
        furniture: {
          titlePage: false,
          evenAndOddHeaders: false,
          headers: new Map([['default', story]]),
          footers: new Map(),
        },
      };
    };

    const first = loadFurniture(makePackage('TitleA'));
    const layoutA = layoutSemanticDocument(first.part, 1, {
      measurer,
      session,
      furniture: first.furniture,
    });
    expect(furnitureText(layoutA, 0, 'header')).toBe('TitleA');

    const second = loadFurniture(makePackage('TitleB'));
    expect(second.furniture.headers.get('default')!.flowHeight).toBe(
      first.furniture.headers.get('default')!.flowHeight
    );
    const layoutB = layoutSemanticDocument(second.part, 2, {
      measurer,
      session,
      furniture: second.furniture,
    });
    expect(furnitureText(layoutB, 0, 'header')).toBe('TitleB');
    expect(layoutB.pages[0]).not.toBe(layoutA.pages[0]);
  });
});
