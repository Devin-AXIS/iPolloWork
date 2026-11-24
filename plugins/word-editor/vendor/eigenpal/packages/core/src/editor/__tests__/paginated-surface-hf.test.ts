// Headers and footers on the paginated surface (phase 2, read-only).
//
// The furniture renders inside every sheet, sized to its FLOW height (#856), pushes the
// content area down when taller than the margin, honours titlePg/evenAndOddHeaders
// variants, and refuses to map browser positions inside it back to the model.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { positionFromDomPoint } from '../dom-selection.ts';
import {
  mountPaginatedSurface,
  setPaginatedSurfaceScale,
  type PaginatedSurface,
} from '../paginated-surface.ts';

const COMPREHENSIVE_FIXTURE = resolve(
  import.meta.dir,
  '../../../../../e2e/fixtures/comprehensive-word-element-test.docx'
);

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

interface HfDocOptions {
  readonly body?: string;
  readonly header?: string;
  readonly firstHeader?: string;
  readonly footer?: string;
  readonly titlePg?: boolean;
}

function docx(options: HfDocOptions): Uint8Array {
  const references: string[] = [];
  const rels: string[] = [];
  const overrides: string[] = [];
  const entries: Record<string, Uint8Array> = {};
  const addPart = (
    kind: 'header' | 'footer',
    type: string,
    relId: string,
    name: string,
    content: string
  ): void => {
    references.push(`<w:${kind}Reference w:type="${type}" r:id="${relId}"/>`);
    rels.push(`<Relationship Id="${relId}" Type="${R}/${kind}" Target="${name}"/>`);
    overrides.push(
      `<Override PartName="/word/${name}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml"/>`
    );
    const root = kind === 'header' ? 'hdr' : 'ftr';
    entries[`word/${name}`] = strToU8(`<w:${root} xmlns:w="${W}">${content}</w:${root}>`);
  };
  if (options.header) addPart('header', 'default', 'rId10', 'header1.xml', options.header);
  if (options.firstHeader) addPart('header', 'first', 'rId11', 'header2.xml', options.firstHeader);
  if (options.footer) addPart('footer', 'default', 'rId12', 'footer1.xml', options.footer);

  entries['[Content_Types].xml'] = strToU8(
    `<Types xmlns="${CT}">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      overrides.join('') +
      '</Types>'
  );
  entries['_rels/.rels'] = strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
  );
  if (rels.length > 0) {
    entries['word/_rels/document.xml.rels'] = strToU8(
      `<Relationships xmlns="${REL}">${rels.join('')}</Relationships>`
    );
  }
  entries['word/document.xml'] = strToU8(
    `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
      (options.body ?? p('body text')) +
      `<w:sectPr>${references.join('')}${options.titlePg ? '<w:titlePg/>' : ''}</w:sectPr>` +
      '</w:body></w:document>'
  );
  return zipSync(entries);
}

function mount(bytes: Uint8Array): { surface: PaginatedSurface; container: HTMLElement } {
  const container = document.createElement('div');
  const result = mountPaginatedSurface(container, bytes, { scale: 1 });
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  return { surface: result.surface, container };
}

describe('headers and footers, read-only', () => {
  test('the default header and footer render on the sheet, inert to editing', () => {
    const { container } = mount(docx({ header: p('HEADER'), footer: p('FOOTER') }));
    const header = container.querySelector('[data-docx-hf="header"]') as HTMLElement;
    const footer = container.querySelector('[data-docx-hf="footer"]') as HTMLElement;
    expect(header?.textContent).toContain('HEADER');
    expect(footer?.textContent).toContain('FOOTER');
    expect(header.getAttribute('contenteditable')).toBe('false');
    // Furniture sits OUTSIDE the content box, on the sheet itself.
    expect(header.closest('.docx-page')).not.toBeNull();
    expect(header.closest('.docx-page-content')).toBeNull();
  });

  test('the furniture rescales with the sheet it is painted on', () => {
    // Header and footer stories are laid out once per variant and attached per page, so a zoom
    // that scaled only body content would leave the furniture at the old size on every sheet.
    const { surface, container } = mount(docx({ header: p('HEADER'), footer: p('FOOTER') }));
    const geometry = (kind: 'header' | 'footer') => {
      const box = container.querySelector<HTMLElement>(`[data-docx-hf="${kind}"]`)!;
      return [
        parseFloat(box.style.left),
        parseFloat(box.style.top),
        parseFloat(box.style.width),
        parseFloat(box.style.height),
      ];
    };
    const before = { header: geometry('header'), footer: geometry('footer') };

    expect(setPaginatedSurfaceScale(surface, 2)).toBe(true);

    for (const kind of ['header', 'footer'] as const) {
      geometry(kind).forEach((value, axis) => {
        expect(value).toBeCloseTo(before[kind][axis]! * 2, 5);
      });
      expect(
        container.querySelector<HTMLElement>(`[data-docx-hf="${kind}"]`)!.textContent
      ).toContain(kind.toUpperCase());
    }
    // Still furniture, not editable content, after the repaint.
    expect(
      container
        .querySelector<HTMLElement>('[data-docx-hf="header"]')!
        .getAttribute('contenteditable')
    ).toBe('false');
  });

  test('the header box is sized to flow height, not to an anchored extent (#856)', () => {
    // One line of text plus a generic drawing whose extent claims to be enormous. The tree
    // lane lays out no anchored shapes, so the box must size to the TEXT flow alone.
    const drawing =
      '<w:p><w:r><w:drawing><wp:anchor xmlns:wp="urn:test:wp"><wp:extent cx="9144000" cy="9144000"/></wp:anchor></w:drawing></w:r></w:p>';
    const { container } = mount(docx({ header: p('short') + drawing }));
    const header = container.querySelector('[data-docx-hf="header"]') as HTMLElement;
    const height = Number.parseFloat(header.style.height);
    // Two default lines (14pt each with the fixed measurer) — nowhere near a 9144000-EMU extent.
    expect(height).toBeGreaterThan(0);
    expect(height).toBeLessThan(60);
    // The band's GEOMETRY stops at flow height, but its INK must not: Word paints header
    // overflow (negative indents, anchored shapes past the box) into the margins.
    expect(header.style.overflow).toBe('visible');
  });

  test('a header taller than the margin pushes the content area down', () => {
    const tall = Array.from({ length: 12 }, (_, i) => p(`header line ${i}`)).join('');
    const short = mount(docx({ header: p('one line') }));
    const pushed = mount(docx({ header: tall }));
    const contentTopOf = (container: HTMLElement): number => {
      const content = container.querySelector('.docx-page-content') as HTMLElement;
      return Number.parseFloat(content.style.top);
    };
    expect(contentTopOf(short.container)).toBe(72); // margin.top wins over 36 + 14
    expect(contentTopOf(pushed.container)).toBeGreaterThan(72);
  });

  test('titlePg shows the first-page header on page one and default afterwards', () => {
    const longBody = Array.from({ length: 120 }, (_, i) => p(`body ${i}`)).join('');
    const { container } = mount(
      docx({
        body: longBody,
        header: p('DEFAULT-HEADER'),
        firstHeader: p('FIRST-HEADER'),
        titlePg: true,
      })
    );
    const pages = [...container.querySelectorAll('.docx-page')];
    expect(pages.length).toBeGreaterThan(1);
    const headerTextOf = (page: Element): string | null =>
      page.querySelector('[data-docx-hf="header"]')?.textContent ?? null;
    expect(headerTextOf(pages[0]!)).toContain('FIRST-HEADER');
    expect(headerTextOf(pages[1]!)).toContain('DEFAULT-HEADER');
  });

  test('a point inside the furniture refuses to map to a model position', () => {
    const { container } = mount(docx({ header: p('HEADER') }));
    const headerSpan = container.querySelector(
      '[data-docx-hf] [data-paragraph-id][data-start]'
    ) as HTMLElement;
    expect(headerSpan).not.toBeNull();
    const textNode = headerSpan.firstChild!;
    expect(positionFromDomPoint(textNode, 1, container)).toBeNull();
    // The same call on body text still maps.
    const bodySpan = container.querySelector(
      '.docx-page-content [data-paragraph-id][data-start]'
    ) as HTMLElement;
    expect(positionFromDomPoint(bodySpan.firstChild!, 1, container)).not.toBeNull();
  });

  test('block-level SDT content joins the body flow', () => {
    const sdtBody =
      p('before') +
      `<w:sdt><w:sdtPr/><w:sdtContent>${p('inside control')}</w:sdtContent></w:sdt>` +
      p('after');
    const { surface, container } = mount(docx({ body: sdtBody }));
    expect(container.textContent).toContain('inside control');
    // The SDT paragraph is editable like any other.
    expect(surface.session.paragraphIds()).toHaveLength(3);
  });

  test('a document without furniture renders no story, only the blank-band affordance', () => {
    const { container } = mount(docx({}));
    // No STORY furniture — nothing carries a relationship id and nothing has content.
    expect(container.querySelector('[data-docx-hf][data-docx-r-id]')).toBeNull();
    // The empty margin bands are painted so hover can invite and double-click can create.
    const placeholders = [...container.querySelectorAll('.docx-hf--placeholder')];
    expect(placeholders.map((band) => band.getAttribute('data-docx-hf')).sort()).toEqual([
      'footer',
      'header',
    ]);
    for (const band of placeholders) {
      expect(band.getAttribute('contenteditable')).toBe('false');
      expect(band.textContent).toBe('');
    }
  });

  test('viewing mode marks the surface so the blank-band affordance stays hidden', () => {
    // The hover invitation is CSS keyed on this class, and a mode change repaints nothing —
    // without the write here a reader who switched to Viewing kept being invited to add a
    // header until some unrelated edit repainted the pages.
    const { surface, container } = mount(docx({}));
    expect(container.classList.contains('docx-paginated-surface--viewing')).toBe(false);

    surface.setEditingMode('view');
    expect(container.classList.contains('docx-paginated-surface--viewing')).toBe(true);

    surface.setEditingMode('edit');
    expect(container.classList.contains('docx-paginated-surface--viewing')).toBe(false);

    surface.setEditingMode('suggest');
    expect(container.classList.contains('docx-paginated-surface--viewing')).toBe(false);
  });

  // Already true before the class moved into a shared helper; pinned so the OPENING path
  // cannot be lost when the mode-change path is the one being edited.
  test('viewing mode opens with the affordance already hidden', () => {
    const container = document.createElement('div');
    const result = mountPaginatedSurface(container, docx({}), { scale: 1, editingMode: 'view' });
    if (!result.ok) throw new Error(result.reason);
    expect(container.classList.contains('docx-paginated-surface--viewing')).toBe(true);
    // The pages layer is created `contenteditable` unconditionally, so OPENING in viewing —
    // as opposed to switching into it — came up writable: a caret, an IME, and a screen
    // reader told the document takes input.
    const pages = container.querySelector<HTMLElement>('.docx-pages')!;
    expect(pages.contentEditable).toBe('false');
    expect(pages.getAttribute('aria-readonly')).toBe('true');
  });

  test('comprehensive fixture: HF right tabs reach the authored stop on the surface', () => {
    // Live-equivalent path: package → session → furniture layout → paint. Layout already
    // resolved the 9026-twip right stop; paint must reserve that advance or CONFIDENTIAL /
    // the page field trail sit next to a native ~1ch tab (~13 CSS px at 96dpi).
    const scale = 96 / 72;
    const container = document.createElement('div');
    const result = mountPaginatedSurface(
      container,
      new Uint8Array(readFileSync(COMPREHENSIVE_FIXTURE)),
      { scale }
    );
    if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
    const { surface } = result;

    const page = surface.layout().pages[1];
    expect(page?.header).toBeDefined();
    expect(page?.footer).toBeDefined();
    const stopPt = 9026 / 20;
    const stopCss = stopPt * scale;

    const assertStory = (
      story: NonNullable<typeof page>['header'],
      paintedRoot: Element | null,
      rightText: RegExp
    ): void => {
      expect(story).toBeDefined();
      expect(paintedRoot).not.toBeNull();
      expect(story!.box.width * scale).toBeCloseTo(624, 5); // 468pt content at 96dpi

      const spans = story!.fragments.flatMap((fragment) =>
        fragment.kind === 'paragraph' ? fragment.lines.flatMap((line) => line.spans) : []
      );
      const tabIndex = spans.findIndex((span) => span.text === '\t');
      expect(tabIndex).toBeGreaterThanOrEqual(0);
      const tab = spans[tabIndex]!;
      expect(tab.box.width).toBeGreaterThan(50);

      let endX = tab.box.x + tab.box.width;
      for (let index = tabIndex + 1; index < spans.length; index += 1) {
        const span = spans[index]!;
        if (span.text === '\t') break;
        endX = span.box.x + span.box.width;
      }
      expect(endX).toBeCloseTo(stopPt, 5);
      expect(endX / story!.box.width).toBeGreaterThan(0.9);

      const tabEl = [...paintedRoot!.querySelectorAll<HTMLElement>('.layout-run-text')].find(
        (el) => el.textContent === '\t'
      )!;
      expect(Number.parseFloat(tabEl.style.width)).toBeCloseTo(tab.box.width * scale, 4);
      expect(Number.parseFloat(tabEl.style.width)).toBeGreaterThan(50 * scale);
      expect(paintedRoot!.textContent ?? '').toMatch(rightText);
      // Right-aligned trail ends at the stop in CSS px (live: ~602px inside a 624px header).
      expect(endX * scale).toBeCloseTo(stopCss, 5);
    };

    const pages = [...container.querySelectorAll('.docx-page')];
    // Page index 1 is the first body sheet with header1/footer1 (cover is index 0).
    const cover = pages[0]!;
    const sheet = pages[1]!;
    expect(cover.querySelector('[data-docx-hf][data-docx-r-id]')).toBeNull();
    expect(sheet.querySelector('[data-docx-hf="header"]')).not.toBeNull();
    expect(sheet.querySelector('[data-docx-hf="footer"]')).not.toBeNull();
    // Cover must not visually host body furniture: relative story Y is authored distance,
    // never a negative full-page offset from failed multi-section remap + PAGE finalize.
    const headerRel = page!.header!.box.y - page!.box.y;
    const footerRel = page!.footer!.box.y - page!.box.y;
    expect(headerRel).toBeGreaterThanOrEqual(0);
    expect(headerRel).toBeCloseTo(35.4, 1);
    expect(footerRel).toBeGreaterThan(0);
    expect(page!.footer!.box.y + page!.footer!.box.height).toBeLessThanOrEqual(
      page!.box.y + page!.box.height + 1e-6
    );
    const paintedHeader = sheet.querySelector('[data-docx-hf="header"]') as HTMLElement;
    const paintedFooter = sheet.querySelector('[data-docx-hf="footer"]') as HTMLElement;
    expect(Number.parseFloat(paintedHeader.style.top)).toBeCloseTo(headerRel * scale, 1);
    expect(Number.parseFloat(paintedFooter.style.top)).toBeCloseTo(footerRel * scale, 1);
    expect(Number.parseFloat(paintedHeader.style.top)).toBeGreaterThanOrEqual(0);
    assertStory(page!.header, paintedHeader, /CONFIDENTIAL/i);
    const pageCount = surface.layout().pages.length;
    assertStory(page!.footer, paintedFooter, new RegExp(`Page 2 of ${pageCount}`));
  });
});
