// Decrease Indent's enabled state over a long selection.
//
// The state asks, per selected paragraph, for the fragment that holds it. That lookup walked
// the pages from the start on every call, so a select-all over a long document cost one walk
// per paragraph. The lookup now loads each page once per layout and keeps the same answers.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import { fragmentHolding, fragmentParagraphs } from '../../layout/line-segments.ts';
import type { ParagraphFragmentRecord, SemanticLayout } from '../../layout/semantic-records.ts';
import { paragraphFragmentsOnPage } from '../../layout/story-fragments.ts';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`
    ),
  });
}

const FIXTURE = new Uint8Array(
  readFileSync(
    new URL('../../../../../e2e/fixtures/comprehensive-word-element-test.docx', import.meta.url)
  )
);

function withSurface(bytes: Uint8Array, run: (surface: PaginatedSurface) => void): void {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, bytes);
  if (!opened.ok) throw new Error(opened.reason);
  try {
    run(opened.surface);
  } finally {
    opened.surface.destroy();
    container.remove();
  }
}

/** The lookup as a plain scan: the first fragment by name, then the first that draws it. */
function scanned(layout: SemanticLayout, paragraphId: string): ParagraphFragmentRecord | null {
  for (const page of layout.pages) {
    for (const fragment of paragraphFragmentsOnPage(page)) {
      if (fragment.paragraphId === paragraphId) return fragment;
    }
  }
  for (const page of layout.pages) {
    for (const fragment of paragraphFragmentsOnPage(page)) {
      if (fragmentParagraphs(fragment).includes(paragraphId)) return fragment;
    }
  }
  return null;
}

/** Every paragraph id the layout draws, in page order. */
function drawnIds(layout: SemanticLayout): string[] {
  const ids = new Set<string>();
  for (const page of layout.pages) {
    for (const fragment of paragraphFragmentsOnPage(page)) {
      for (const id of fragmentParagraphs(fragment)) ids.add(id);
    }
  }
  return [...ids];
}

/** The same layout, counting each read of a page from `pages`. */
function countingPageReads(layout: SemanticLayout): { layout: SemanticLayout; reads(): number } {
  let reads = 0;
  const pages = new Proxy(layout.pages, {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
      return Reflect.get(target, key, receiver);
    },
  });
  return { layout: { ...layout, pages }, reads: () => reads };
}

const plain = (i: number) =>
  `<w:p><w:r><w:t>Paragraph ${i} with some words in it.</w:t></w:r></w:p>`;

describe('the fragment that holds a paragraph', () => {
  test('answers the same fragment as a scan of the pages, for every paragraph', () => {
    withSurface(FIXTURE, (surface) => {
      const layout = surface.layout();
      const ids = drawnIds(layout);
      expect(ids.length).toBeGreaterThan(20);
      // Reverse order too: a late read loads pages that an early read then answers from.
      for (const id of [...ids].reverse())
        expect(fragmentHolding(layout, id)).toBe(scanned(layout, id));
      expect(fragmentHolding(layout, 'no-such-paragraph')).toBeNull();
    });
  });

  test('loads each page once per layout over a long selection', () => {
    const body = Array.from({ length: 400 }, (_, i) => plain(i)).join('');
    withSurface(docx(body), (surface) => {
      const real = surface.layout();
      expect(real.pages.length).toBeGreaterThan(4);
      const ids = drawnIds(real);
      const counted = countingPageReads(real);
      for (const id of ids) fragmentHolding(counted.layout, id);
      // One read per page to load it. A scan per paragraph reads about ids x pages / 2.
      expect(counted.reads()).toBeLessThanOrEqual(real.pages.length);
    });
  });
});

describe('Decrease Indent over a select-all', () => {
  test('is disabled when no paragraph is indented and enabled by the last one', () => {
    const flat = Array.from({ length: 400 }, (_, i) => plain(i)).join('');
    withSurface(docx(flat), (surface) => {
      surface.selectAll();
      expect(surface.canAdjustIndent('decrease')).toBe(false);
      expect(surface.canAdjustIndent('increase')).toBe(true);
    });
    const lastIndented =
      Array.from({ length: 399 }, (_, i) => plain(i)).join('') +
      `<w:p><w:pPr><w:ind w:left="720"/></w:pPr><w:r><w:t>last</w:t></w:r></w:p>`;
    withSurface(docx(lastIndented), (surface) => {
      surface.selectAll();
      expect(surface.canAdjustIndent('decrease')).toBe(true);
    });
  });
});
