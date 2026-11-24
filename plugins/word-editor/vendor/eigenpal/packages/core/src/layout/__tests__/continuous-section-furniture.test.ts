// A continuous section keeps the sheet the previous section ended on.
//
// Header and footer furniture belongs to the sheet. When a continuous section changes its
// header or footer height, or adds `w:titlePg`, the sheet it starts on keeps the previous
// section's furniture and content box, and the new section's text flows below the old text.
// The new section's own furniture starts on the first sheet the section opens itself. Only a
// different page size or orientation starts a new sheet.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutHeaderFooterStory,
  layoutSemanticDocument,
  type LayoutSession,
  type PageFurniture,
  type SemanticLayout,
} from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);

type Page = SemanticLayout['pages'][number];

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const lines = (count: number, label: string) =>
  Array.from({ length: count }, (_unused, index) => p(`${label}${index + 1}`)).join('');

interface SectOptions {
  readonly type?: string;
  readonly titlePage?: boolean;
  /** `w:pgSz` width and height in twips. */
  readonly size?: readonly [number, number];
}

function sectPr(options: SectOptions = {}): string {
  const [width, height] = options.size ?? [12240, 15840];
  return (
    '<w:sectPr>' +
    (options.type ? `<w:type w:val="${options.type}"/>` : '') +
    `<w:pgSz w:w="${width}" w:h="${height}"/>` +
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>' +
    (options.titlePage ? '<w:titlePg/>' : '') +
    '</w:sectPr>'
  );
}

/** A paragraph that ends a section. */
const ending = (text: string, options: SectOptions = {}) =>
  `<w:p><w:pPr>${sectPr(options)}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

function story(root: 'hdr' | 'ftr', lineTexts: readonly string[], name: string) {
  const part = readOoxmlPart(
    `<w:${root} xmlns:w="${W}">${lineTexts.map((text) => p(text)).join('')}</w:${root}>`,
    {
      name,
      contentType: `application/vnd.openxmlformats-officedocument.wordprocessingml.${
        root === 'hdr' ? 'header' : 'footer'
      }+xml`,
    }
  );
  if (!part.ok) throw new Error(part.reason);
  return layoutHeaderFooterStory(part.part, 400, measurer, name);
}

interface FurnitureSpec {
  readonly titlePage?: boolean;
  readonly header?: readonly string[];
  readonly footer?: readonly string[];
  readonly firstFooter?: readonly string[];
}

let storyCounter = 0;
function furniture(spec: FurnitureSpec): PageFurniture {
  storyCounter += 1;
  const headers = new Map();
  const footers = new Map();
  if (spec.header) headers.set('default', story('hdr', spec.header, `/word/h${storyCounter}.xml`));
  if (spec.footer) footers.set('default', story('ftr', spec.footer, `/word/f${storyCounter}.xml`));
  if (spec.firstFooter) {
    footers.set('first', story('ftr', spec.firstFooter, `/word/ff${storyCounter}.xml`));
  }
  return { titlePage: spec.titlePage === true, evenAndOddHeaders: false, headers, footers };
}

function lay(
  body: string,
  sectionFurniture: readonly (PageFurniture | undefined)[],
  session?: LayoutSession
): SemanticLayout {
  return layoutSemanticDocument(load(body), 1, {
    measurer,
    sectionFurniture,
    ...(session ? { session } : {}),
  });
}

const textOf = (fragments: Page['fragments']): string =>
  fragments
    .flatMap((fragment) =>
      fragment.kind === 'paragraph'
        ? [fragment.lines.flatMap((line) => line.spans.map((span) => span.text)).join('')]
        : []
    )
    .join(' ');

const bodyText = (page: Page): string => textOf(page.fragments);
const storyText = (page: Page, edge: 'header' | 'footer'): string =>
  textOf(page[edge]?.fragments ?? []);

/** Every body fragment stays inside its page's content box. */
function expectInsideContentBox(page: Page): void {
  const used = Math.max(
    0,
    ...page.fragments.map((fragment) => fragment.box.y + fragment.box.height)
  );
  expect(used).toBeLessThanOrEqual(page.contentBox.height + 0.001);
}

/** Page geometry and text, for retained-versus-fresh comparisons. */
const shape = (layout: SemanticLayout) =>
  layout.pages.map((page) => ({
    box: page.box,
    contentBox: page.contentBox,
    footer: storyText(page, 'footer'),
    header: storyText(page, 'header'),
    fragments: page.fragments.map((fragment) => ({ box: fragment.box, text: textOf([fragment]) })),
  }));

const ONE_LINE = furniture({ footer: ['Foot one'] });
// Three lines reach past the 1in bottom margin, so this footer moves the content bottom.
const TALL = furniture({ footer: ['Foot two', 'Foot two again', 'Foot two third'] });

describe('a continuous section with different furniture continues on the host sheet', () => {
  test('a taller footer keeps one sheet and the host footer', () => {
    const layout = lay(
      p('Intro one') + ending('Intro two') + p('After intro') + sectPr({ type: 'continuous' }),
      [ONE_LINE, TALL]
    );
    expect(layout.pages).toHaveLength(1);
    const [page] = layout.pages as readonly [Page];
    expect(bodyText(page)).toBe('Intro one Intro two After intro');
    expect(storyText(page, 'footer')).toBe('Foot one');
    // The host content box: 11in less the 1in top and bottom margins.
    expect(page.contentBox.height).toBe(648);
    expectInsideContentBox(page);
  });

  test('a taller header keeps one sheet and the host header', () => {
    const layout = lay(
      p('One') + ending('Two') + p('Tail') + sectPr({ type: 'continuous', titlePage: true }),
      [furniture({ header: ['Alpha'] }), furniture({ header: ['Beta', 'Beta two', 'Beta three'] })]
    );
    expect(layout.pages).toHaveLength(1);
    expect(bodyText(layout.pages[0]!)).toBe('One Two Tail');
    expect(storyText(layout.pages[0]!, 'header')).toBe('Alpha');
  });

  test('adding w:titlePg keeps one sheet', () => {
    const layout = lay(
      p('Intro one') +
        ending('Intro two') +
        p('After intro') +
        sectPr({ type: 'continuous', titlePage: true }),
      [ONE_LINE, furniture({ titlePage: true, footer: ['Foot one'] })]
    );
    expect(layout.pages).toHaveLength(1);
    expect(bodyText(layout.pages[0]!)).toBe('Intro one Intro two After intro');
    expect(storyText(layout.pages[0]!, 'footer')).toBe('Foot one');
  });

  test('a final continuous section of one empty paragraph adds no sheet', () => {
    const layout = lay(
      p('Body') + ending('Last') + '<w:p/>' + sectPr({ type: 'continuous', titlePage: true }),
      [
        ONE_LINE,
        furniture({
          titlePage: true,
          footer: ['Foot two', 'Foot two again'],
          firstFooter: ['First'],
        }),
      ]
    );
    expect(layout.pages).toHaveLength(1);
    expect(storyText(layout.pages[0]!, 'footer')).toBe('Foot one');
  });

  test('overflow sheets use the continued section furniture and content box', () => {
    const tall = furniture({
      titlePage: true,
      footer: ['Foot two', 'Foot two again', 'Foot two third'],
      firstFooter: ['First footer'],
    });
    const layout = lay(
      lines(20, 'A') +
        ending('A end') +
        lines(80, 'B') +
        sectPr({ type: 'continuous', titlePage: true }),
      [ONE_LINE, tall]
    );
    expect(layout.pages.length).toBeGreaterThan(1);
    const [host, next] = layout.pages as readonly [Page, Page];

    // The host keeps its own footer and box, and holds text of both sections.
    expect(storyText(host, 'footer')).toBe('Foot one');
    expect(bodyText(host)).toContain('A end');
    expect(bodyText(host)).toContain('B1');
    for (const page of layout.pages) expectInsideContentBox(page);
    // The host fills exactly as far as the same text under the host furniture alone does.
    const single = lay(lines(20, 'A') + p('A end') + lines(80, 'B') + sectPr(), [ONE_LINE]);
    expect(host.fragments).toHaveLength(single.pages[0]!.fragments.length);

    // The first sheet the continued section opens is not its first page: that was the host.
    expect(next.footer?.variant).toBe('default');
    expect(storyText(next, 'footer')).toBe('Foot two Foot two again Foot two third');
    const hostBottom = host.box.y + host.box.height - (host.contentBox.y + host.contentBox.height);
    const nextBottom = next.box.y + next.box.height - (next.contentBox.y + next.contentBox.height);
    expect(hostBottom).toBe(72);
    expect(nextBottom).toBeCloseTo(36 + tall.footers.get('default')!.flowHeight, 6);
    expect(nextBottom).toBeGreaterThan(hostBottom);

    // No authored paragraph is lost or duplicated.
    const all = layout.pages.map(bodyText).join(' ').split(' ');
    expect(all.filter((word) => /^B\d+$/.test(word))).toHaveLength(80);
    expect(all.filter((word) => /^A\d+$/.test(word))).toHaveLength(20);
  });
});

describe('page size still decides whether a continuous section starts a new sheet', () => {
  test('a different page size starts a new sheet even with equal furniture', () => {
    const layout = lay(
      ending('Portrait') + p('Landscape') + sectPr({ type: 'continuous', size: [15840, 12240] }),
      [ONE_LINE, ONE_LINE]
    );
    expect(layout.pages).toHaveLength(2);
    expect(storyText(layout.pages[1]!, 'footer')).toBe('Foot one');
  });

  test('a different page size with different furniture uses the new furniture', () => {
    const layout = lay(
      ending('Portrait') + p('Landscape') + sectPr({ type: 'continuous', size: [15840, 12240] }),
      [ONE_LINE, TALL]
    );
    expect(layout.pages).toHaveLength(2);
    expect(storyText(layout.pages[1]!, 'footer')).toBe('Foot two Foot two again Foot two third');
  });

  test('a nextPage section with different furniture still starts a new sheet', () => {
    const layout = lay(ending('First') + p('Second') + sectPr(), [ONE_LINE, TALL]);
    expect(layout.pages).toHaveLength(2);
    expect(storyText(layout.pages[1]!, 'footer')).toBe('Foot two Foot two again Foot two third');
  });
});

describe('incremental layout of a continued section with different furniture', () => {
  const body = (label: string) =>
    lines(20, 'A') + ending('A end') + lines(60, label) + sectPr({ type: 'continuous' });

  test('an edit in the continued section equals a fresh layout', () => {
    const session = createLayoutSession();
    lay(body('B'), [ONE_LINE, TALL], session);
    const retained = lay(body('C'), [ONE_LINE, TALL], session);
    const fresh = lay(body('C'), [ONE_LINE, TALL]);
    expect(shape(retained)).toEqual(shape(fresh));
    expect(storyText(retained.pages[0]!, 'footer')).toBe('Foot one');
  });

  test('changing only the continued section footer height equals a fresh layout', () => {
    const session = createLayoutSession();
    lay(body('B'), [ONE_LINE, ONE_LINE], session);
    const retained = lay(body('B'), [ONE_LINE, TALL], session);
    const fresh = lay(body('B'), [ONE_LINE, TALL]);
    expect(shape(retained)).toEqual(shape(fresh));
    expect(storyText(retained.pages[0]!, 'footer')).toBe('Foot one');
    expect(storyText(retained.pages[1]!, 'footer')).toBe('Foot two Foot two again Foot two third');
  });
});
