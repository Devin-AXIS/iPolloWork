// An edit that moves many pages lays out the pages after the screen in the background.
//
// The commit publishes the pages the reader can see with the previous layout's pages after
// them, then finishes the same pass in short tasks. The oracle is a cold mount of the saved
// document: once the background pass ends, every page must match it. A second edit while the
// pass is still running drops the outdated pass and must also end on the cold layout, as must
// undo and a save in between.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import type { BlockFragmentRecord } from '../../layout/semantic-records.ts';
import { createDocxEditor } from '../docx-editor.ts';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { createDeferredLayout, setDeferredLayoutForTest } from '../surface-deferred-layout.ts';
import type { SemanticLayout } from '../../layout/semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(): Uint8Array {
  const paragraphs: string[] = [];
  for (let index = 0; index < 900; index += 1) {
    paragraphs.push(`<w:p><w:r><w:t>Paragraph ${index}</w:t></w:r></w:p>`);
  }
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${paragraphs.join('')}<w:sectPr/></w:body></w:document>`
    ),
  });
}

const FN_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes';

/** Several sections, with a footnote every 40 paragraphs. */
function sectionsAndNotesDocx(sections = true): Uint8Array {
  const paragraphs: string[] = [];
  const notes: string[] = [
    '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>',
    '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>',
  ];
  for (let index = 0; index < 900; index += 1) {
    const note = index % 40 === 5 ? notes.length - 1 : 0;
    if (note > 0) {
      notes.push(
        `<w:footnote w:id="${note}"><w:p><w:r><w:t>Note ${note} for paragraph ${index}</w:t></w:r></w:p></w:footnote>`
      );
    }
    const reference =
      note > 0
        ? `<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="${note}"/></w:r>`
        : '';
    const sectionEnd =
      sections && index % 300 === 299 && index < 899 ? '<w:pPr><w:sectPr/></w:pPr>' : '';
    paragraphs.push(`<w:p>${sectionEnd}<w:r><w:t>Paragraph ${index}</w:t></w:r>${reference}</w:p>`);
  }
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId2" Type="${FN_REL}" Target="footnotes.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${paragraphs.join('')}<w:sectPr/></w:body></w:document>`
    ),
    'word/footnotes.xml': strToU8(`<w:footnotes xmlns:w="${W}">${notes.join('')}</w:footnotes>`),
  });
}

/** Each page's lines as `page|text|y`, in reading order. */
function linesOf(surface: PaginatedSurface): string[] {
  const out: string[] = [];
  const visit = (blocks: readonly BlockFragmentRecord[], page: number): void => {
    for (const block of blocks) {
      if (block.kind === 'table') continue;
      for (const line of block.lines) {
        out.push(`${page}|${line.spans.map((span) => span.text).join('')}|${line.box.y}`);
      }
    }
  };
  surface.layout().pages.forEach((page, index) => {
    visit(page.fragments, index);
    const notes = page.footnotes?.notes ?? [];
    if (notes.length > 0) out.push(`${index}|notes|${notes.length}`);
  });
  return out;
}

function mount(bytes: Uint8Array): {
  surface: PaginatedSurface;
  container: HTMLElement;
  dispose(): void;
} {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, bytes);
  if (!opened.ok) throw new Error(opened.reason);
  return {
    surface: opened.surface,
    container,
    dispose() {
      opened.surface.destroy();
      container.remove();
    },
  };
}

function coldLines(surface: PaginatedSurface): string[] {
  const cold = mount(surface.session.save());
  try {
    return linesOf(cold.surface);
  } finally {
    cold.dispose();
  }
}

function splitFirst(surface: PaginatedSurface, offset = 4): void {
  const first = surface.session.paragraphIds()[0]!;
  surface.setSelection({
    anchor: { paragraphId: first, offset },
    head: { paragraphId: first, offset },
  });
  surface.splitParagraph();
}

/** Wait until the background pass publishes, then return the lines. */
async function settled(surface: PaginatedSurface, expected: string[]): Promise<string[]> {
  const until = Date.now() + 10_000;
  while (Date.now() < until) {
    const lines = linesOf(surface);
    if (lines.length === expected.length && lines.join('\n') === expected.join('\n')) return lines;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return linesOf(surface);
}

describe('pages after the screen finish in the background', () => {
  let restore: () => void = () => undefined;
  beforeEach(() => {
    restore = setDeferredLayoutForTest(1, 0);
  });
  afterEach(() => restore());

  test('an edit that moves every later page ends on the cold layout', async () => {
    const { surface, dispose } = mount(docx());
    try {
      expect(surface.layout().pages.length).toBeGreaterThan(12);
      splitFirst(surface);
      const interim = linesOf(surface);
      const cold = coldLines(surface);
      // The commit left the later pages to the background: they still show the old flow.
      expect(interim).not.toEqual(cold);
      expect(interim.slice(0, 10)).toEqual(cold.slice(0, 10));
      expect(await settled(surface, cold)).toEqual(cold);
    } finally {
      dispose();
    }
  });

  test('a host hears the page total the background pass moves', async () => {
    // The commit reports its own layout. The later pages the pass adds move no revision and
    // no caret, so without their own signal a page counter kept the earlier total.
    const editor = createDocxEditor({ document: docx() });
    const container = document.createElement('div');
    document.body.append(container);
    editor.attach(container);
    const surface = editor.surface!;
    const before = surface.layout().pages.length;
    const totals: number[] = [];
    const record = () => totals.push(editor.snapshot().page.total);
    const offs = [editor.on('change', record), editor.on('selectionChange', record)];
    try {
      // Enough new paragraphs at the top to push the last page over.
      for (let i = 0; i < 60; i += 1) splitFirst(surface, 1);
      await settled(surface, coldLines(surface));
      await new Promise((resolve) => setTimeout(resolve, 20));
      const after = surface.layout().pages.length;
      expect(after).not.toBe(before);
      expect(totals.at(-1)).toBe(after);
    } finally {
      for (const off of offs) off();
      editor.destroy();
      container.remove();
    }
  });

  test('the container is marked while later pages still show the previous layout', async () => {
    const { surface, container, dispose } = mount(docx());
    try {
      expect(container.hasAttribute('data-docx-layout-pending')).toBe(false);
      splitFirst(surface);
      expect(container.hasAttribute('data-docx-layout-pending')).toBe(true);
      await settled(surface, coldLines(surface));
      expect(container.hasAttribute('data-docx-layout-pending')).toBe(false);
    } finally {
      dispose();
    }
  });

  test('a second edit during the pass drops it and still ends on the cold layout', async () => {
    const { surface, dispose } = mount(docx());
    try {
      splitFirst(surface);
      splitFirst(surface, 2);
      const cold = coldLines(surface);
      expect(await settled(surface, cold)).toEqual(cold);

      surface.undo();
      surface.undo();
      const reverted = coldLines(surface);
      expect(await settled(surface, reverted)).toEqual(reverted);
    } finally {
      dispose();
    }
  });

  for (const sections of [true, false])
    test(`with ${sections ? 'sections and ' : ''}footnotes, a second edit drops the pass and still ends cold`, async () => {
      const { surface, container, dispose } = mount(sectionsAndNotesDocx(sections));
      try {
        const opened = linesOf(surface);
        expect(opened.some((line) => line.includes('|notes|'))).toBe(true);
        splitFirst(surface);
        // Deferred: the second edit below drops this pass instead of finishing it.
        expect(container.hasAttribute('data-docx-layout-pending')).toBe(true);
        splitFirst(surface, 2);
        const cold = coldLines(surface);
        expect(await settled(surface, cold)).toEqual(cold);

        splitFirst(surface, 3);
        surface.undo();
        surface.undo();
        surface.undo();
        expect(await settled(surface, opened)).toEqual(opened);
      } finally {
        dispose();
      }
    });

  test('a pass reports its layout time once, background slices included, when it ends', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const layouts: number[] = [];
    const opened = mountPaginatedSurface(container, docx(), {
      onTiming: (phase, ms) => void (phase === 'layout' && layouts.push(ms)),
    });
    if (!opened.ok) throw new Error(opened.reason);
    const { surface } = opened;
    try {
      // The opening layout is the open's own duration, not an edit's.
      expect(layouts).toEqual([]);
      splitFirst(surface);
      expect(layouts).toEqual([]);
      await settled(surface, coldLines(surface));
      expect(layouts).toHaveLength(1);
      expect(layouts[0]).toBeGreaterThan(0);

      // A second edit replaces a running pass: the replaced work joins the pass that ends, so
      // two edits report one pass.
      splitFirst(surface);
      splitFirst(surface, 2);
      await settled(surface, coldLines(surface));
      expect(layouts).toHaveLength(2);
    } finally {
      surface.destroy();
      container.remove();
    }
  });

  test('a save during the pass writes the edited document', () => {
    const { surface, dispose } = mount(docx());
    try {
      splitFirst(surface);
      const saved = mount(surface.session.save());
      try {
        expect(saved.surface.session.paragraphIds().length).toBe(901);
      } finally {
        saved.dispose();
      }
    } finally {
      dispose();
    }
  });
});

describe('layout timing never changes when a pass defers', () => {
  test('a pass after a replaced one keeps its full foreground budget', () => {
    const restore = setDeferredLayoutForTest(1, 40);
    let time = 0;
    const page = {} as SemanticLayout['pages'][number];
    const previous = { pages: Array.from({ length: 100 }, () => page) } as SemanticLayout;
    const reported: number[] = [];
    const deferred = createDeferredLayout({
      now: () => time,
      pageAfterView: () => 1,
      current: () => previous,
      revision: () => 1,
      publish: () => {},
      snapshot: () => () => {},
      passTimed: (ms) => void reported.push(ms),
    });
    /** One page per 10 ms; the pass defers once its budget is spent. */
    function* steps(): Generator<
      { pages: readonly unknown[]; finalize: () => SemanticLayout },
      SemanticLayout,
      void
    > {
      for (let pages = 1; pages <= 50; pages += 1) {
        time += 10;
        yield {
          pages: new Array(pages).fill(page),
          finalize: () => ({ pages: [] }) as unknown as SemanticLayout,
        };
      }
      return previous;
    }
    try {
      const deferredAt: number[] = [];
      for (let pass = 0; pass < 2; pass += 1) {
        const began = time;
        deferred.abandon();
        deferred.run(steps() as never, 1);
        deferredAt.push(time - began);
      }
      // Both passes ran their whole 40 ms budget before handing pages to the background.
      expect(deferredAt).toEqual([40, 40]);
      deferred.finish();
      // One report: the replaced pass's 40 ms joined the pass that ended.
      expect(reported).toEqual([40 + 40 + 460]);
    } finally {
      deferred.cancel();
      restore();
    }
  });
});

describe('a pass that cannot be put back', () => {
  test('a newer edit wraps it up, then finishes it instead of restoring the session', () => {
    const restore = setDeferredLayoutForTest(1, 40);
    let time = 0;
    const page = {} as SemanticLayout['pages'][number];
    const previous = { pages: Array.from({ length: 100 }, () => page) } as SemanticLayout;
    const published: SemanticLayout[] = [];
    let restored = 0;
    let wrappedUp = false;
    let stepsAfterWrapUp = 0;
    const deferred = createDeferredLayout({
      now: () => time,
      pageAfterView: () => 1,
      current: () => previous,
      revision: () => 1,
      publish: (layout) => void published.push(layout),
      snapshot: () => () => void (restored += 1),
    });
    const finished = { pages: [] } as unknown as SemanticLayout;
    /** Reports a page per 10 ms until wrapped up, then ends. */
    function* steps(): Generator<
      {
        pages: readonly unknown[];
        finalize: () => SemanticLayout;
        restorable: false;
        wrapUp: () => void;
      },
      SemanticLayout,
      void
    > {
      for (let pages = 1; pages <= 50; pages += 1) {
        if (wrappedUp) {
          stepsAfterWrapUp += 1;
          break;
        }
        time += 10;
        yield {
          pages: new Array(pages).fill(page),
          finalize: () => ({ pages: [] }) as unknown as SemanticLayout,
          restorable: false,
          wrapUp: () => void (wrappedUp = true),
        };
      }
      return finished;
    }
    try {
      deferred.run(steps() as never, 1);
      expect(deferred.pending()).toBe(true);
      deferred.abandon();
      expect(wrappedUp).toBe(true);
      expect(stepsAfterWrapUp).toBe(1);
      expect(restored).toBe(0);
      expect(published).toEqual([finished]);
      expect(deferred.pending()).toBe(false);
    } finally {
      deferred.cancel();
      restore();
    }
  });
});

describe('a pass with only its answer left', () => {
  test('shows every page it has, and a newer edit drops it without putting anything back', () => {
    const restore = setDeferredLayoutForTest(1, 40);
    let time = 0;
    const page = {} as SemanticLayout['pages'][number];
    const previous = { pages: Array.from({ length: 10 }, () => page) } as SemanticLayout;
    const interim = { pages: Array.from({ length: 10 }, () => page) } as SemanticLayout;
    const published: SemanticLayout[] = [];
    let restored = 0;
    const deferred = createDeferredLayout({
      now: () => time,
      pageAfterView: () => 1,
      current: () => previous,
      revision: () => 1,
      publish: (layout) => void published.push(layout),
      snapshot: () => () => void (restored += 1),
    });
    function* steps(): Generator<
      { pages: readonly unknown[]; finalize: () => SemanticLayout; settled: true },
      SemanticLayout,
      void
    > {
      time += 50;
      yield { pages: interim.pages, finalize: () => interim, settled: true };
      return { pages: [] } as unknown as SemanticLayout;
    }
    try {
      // As many pages as the previous layout: a settled pass defers all the same.
      expect(deferred.run(steps() as never, 1)).toBe(interim);
      expect(deferred.pending()).toBe(true);
      deferred.abandon();
      expect(restored).toBe(0);
      expect(published).toEqual([]);
      expect(deferred.pending()).toBe(false);
    } finally {
      deferred.cancel();
      restore();
    }
  });
});
