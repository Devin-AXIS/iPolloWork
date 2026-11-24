// A large open lays its body out in slices: a growing prefix per task, each pass resuming
// from the last, then the normal full layout. The result must be exactly the layout an
// unsliced mount produces. The pages take input from the mount on: an edit lays out the
// prefix so far, and a reveal of a page still to come waits for it without blocking.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import type { BlockFragmentRecord, SemanticLayout } from '../../layout/semantic-records.ts';
import { createDocxEditor } from '../docx-editor.ts';
import { mountPaginatedSurface } from '../paginated-surface.ts';
import { layoutNodeTokenVisitTestRecorder } from '../../layout/layout-cache.ts';
import { setDeferredLayoutForTest } from '../surface-deferred-layout.ts';
import {
  completeProgressiveOpen,
  continueProgressiveOpen,
  progressiveOpenPending,
  progressiveOpenStepCount,
} from '../surface-progressive-open.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const NUMREL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering';

const NUMBERING =
  `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0">` +
  '<w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>' +
  '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';

const paragraph = (text: string, extra = '') =>
  `<w:p><w:pPr>${extra}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const item = (text: string) =>
  paragraph(text, '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>');

function table(rows: number, label: string): string {
  const cells: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    cells.push(
      `<w:tr><w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>${paragraph(`${label} ${row}`)}</w:tc>` +
        `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>${item(`${label} cell ${row}`)}</w:tc></w:tr>`
    );
  }
  return (
    '<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>' +
    cells.join('') +
    '</w:tbl>'
  );
}

/** Several hundred blocks: lists, tables, keep-with-next, page and section breaks. */
function body(): string {
  const parts: string[] = [];
  for (let index = 0; index < 360; index += 1) {
    if (index % 40 === 0) parts.push(paragraph(`Heading ${index}`, '<w:keepNext/>'));
    if (index % 90 === 45) parts.push(table(25, `Table ${index}`));
    if (index === 150) parts.push(paragraph('Break', '<w:pageBreakBefore/>'));
    if (index === 240) {
      parts.push(
        paragraph(
          'Section end',
          '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1800" w:right="1800"/></w:sectPr>'
        )
      );
    }
    parts.push(index % 3 === 0 ? item(`Item ${index}`) : paragraph(`Body paragraph ${index}`));
  }
  return parts.join('') + '<w:sectPr/>';
}

/** Past the open-yield threshold through a filler part, so the open is deferred. */
function docx(): Uint8Array {
  const lines: string[] = [];
  for (let line = 1, total = 0; total < 700 * 1024; line += 1) {
    const text = `<l>filler line ${line} carrying a little ordinary sentence text.</l>`;
    lines.push(text);
    total += text.length;
  }
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId9" Type="${NUMREL}" Target="numbering.xml"/></Relationships>`
    ),
    'word/numbering.xml': strToU8(NUMBERING),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body()}</w:body></w:document>`
    ),
    'customXml/item1.xml': strToU8(`<filler>${lines.join('')}</filler>`),
  });
}

/** Every fragment's identity, text, marker and position, in page order. */
function signature(layout: SemanticLayout): string[] {
  const rows: string[] = [];
  const visit = (blocks: readonly BlockFragmentRecord[], page: number): void => {
    for (const block of blocks) {
      if (block.kind === 'table') {
        rows.push(`${page}|table|${block.tableId}|${block.rows.length}|${block.box.y}`);
        for (const row of block.rows) for (const cell of row.cells) visit(cell.blocks, page);
        continue;
      }
      const text = block.lines.flatMap((line) => line.spans.map((span) => span.text)).join('');
      rows.push(
        `${page}|${block.paragraphId}|${text}|${block.marker?.text ?? ''}|${block.box.y}|${block.lines.length}`
      );
    }
  };
  layout.pages.forEach((page, index) => visit(page.fragments, index));
  return rows;
}

async function until(check: () => boolean, timeoutMs = 20000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition not reached in time');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function unslicedSignature(bytes: Uint8Array): string[] {
  const container = document.createElement('div');
  const mounted = mountPaginatedSurface(container, bytes);
  if (!mounted.ok) throw new Error(mounted.reason);
  try {
    return signature(mounted.surface.layout());
  } finally {
    mounted.surface.destroy();
  }
}

describe('a large open laid out in slices', () => {
  test('finishes with exactly the layout of an unsliced mount', async () => {
    const bytes = docx();
    const stepsBefore = progressiveOpenStepCount();
    const editor = createDocxEditor({ document: bytes });
    const container = document.createElement('div');
    editor.attach(container);
    const marked = () =>
      container.hasAttribute('data-docx-opening-preview') ||
      container.querySelector('[data-docx-opening-preview]') !== null;
    // Before the mount the overlay must stay opaque, so nothing is marked yet.
    expect(marked()).toBe(false);
    // The mounted document is marked for the preview while its slices run. Recorded at the
    // call: the slices are queued tasks that can run before any polling timer.
    let sawPreview = false;
    const setAttribute = container.setAttribute.bind(container);
    container.setAttribute = (name: string, value: string) => {
      if (name === 'data-docx-opening-preview') sawPreview = true;
      setAttribute(name, value);
    };
    // The surface is handed out at the mount, and the open ends there, while the slices still
    // run behind pages that take input. Recorded, not asserted, inside the listener: an emit
    // swallows a throw from its listener.
    let readyWhilePending = false;
    const record = () => {
      const surface = editor.surface;
      if (!surface || !progressiveOpenPending(surface)) return;
      if (!editor.snapshot().isOpening && container.hasAttribute('data-docx-layout-pending'))
        readyWhilePending = true;
    };
    const offs = [editor.on('change', record), editor.on('selectionChange', record)];
    await until(() => editor.surface !== null && !progressiveOpenPending(editor.surface));
    for (const off of offs) off();
    expect(readyWhilePending).toBe(true);
    expect(container.hasAttribute('data-docx-layout-pending')).toBe(false);
    expect(sawPreview).toBe(true);
    expect(marked()).toBe(false);
    // The open continued in a task after the mount. How many depends on machine speed and
    // on what earlier files left in the shared digest caches; the preview above proves a
    // partial layout was shown between tasks.
    expect(progressiveOpenStepCount() - stepsBefore).toBeGreaterThanOrEqual(1);
    const sliced = signature(editor.surface!.layout());
    expect(sliced.length).toBeGreaterThan(400);
    expect(sliced).toEqual(unslicedSignature(bytes));
    editor.destroy();
  }, 60_000);

  /** The page totals a host hears, read at each emit, as a page counter does. */
  function heardTotals(editor: ReturnType<typeof createDocxEditor>): {
    totals: number[];
    stop(): void;
  } {
    const totals: number[] = [];
    const record = () => totals.push(editor.snapshot().page.total);
    const offs = [editor.on('change', record), editor.on('selectionChange', record)];
    return { totals, stop: () => offs.forEach((off) => off()) };
  }

  test('a host hears the final page total once the last page is laid out', async () => {
    // The open ends at the mount, so a page counter first reads the partial total. The pages
    // the slices add move no revision and no caret; without their own signal the counter kept
    // the partial total until something unrelated moved.
    const editor = createDocxEditor({ document: docx() });
    const heard = heardTotals(editor);
    editor.attach(document.createElement('div'));
    await until(() => editor.surface !== null && !progressiveOpenPending(editor.surface));
    await new Promise((resolve) => setTimeout(resolve, 20));
    heard.stop();
    const final = editor.surface!.layout().pages.length;
    // The first total heard with a document mounted is the partial one.
    expect(heard.totals.find((total) => total > 0)).toBeLessThan(final);
    expect(heard.totals.at(-1)).toBe(final);
    editor.destroy();
  }, 60_000);

  test('a host hears the final page total when a reader finishes the open early', async () => {
    // A reader of the whole pagination (a field update, Ctrl+End, an export) finishes the
    // slices at once. That reader emits nothing itself, so the page signal must.
    const editor = createDocxEditor({ document: docx() });
    const heard = heardTotals(editor);
    let forced = false;
    let heardDuringFinish = -1;
    const off = editor.on('change', () => {
      const surface = editor.surface;
      if (forced || !surface || !progressiveOpenPending(surface)) return;
      forced = true;
      const before = heard.totals.length;
      completeProgressiveOpen(surface);
      // Not from inside the finishing render: a host reading the snapshot there could
      // commit buffered typing in the middle of it.
      heardDuringFinish = heard.totals.length - before;
    });
    editor.attach(document.createElement('div'));
    await until(() => forced);
    // The finish is synchronous; the notice follows in a microtask.
    expect(progressiveOpenPending(editor.surface!)).toBe(false);
    expect(heardDuringFinish).toBe(0);
    await Promise.resolve();
    off();
    heard.stop();
    expect(heard.totals.at(-1)).toBe(editor.surface!.layout().pages.length);
    editor.destroy();
  }, 60_000);

  test('a save during the slices finishes the layout at once', async () => {
    const bytes = docx();
    const editor = createDocxEditor({ document: bytes });
    editor.attach(document.createElement('div'));
    await until(() => editor.snapshot().isOpening);
    const saved = await editor.save();
    expect(saved.byteLength).toBeGreaterThan(0);
    expect(editor.snapshot().isOpening).toBe(false);
    expect(editor.surface).not.toBeNull();
    expect(signature(editor.surface!.layout())).toEqual(unslicedSignature(bytes));
    editor.destroy();
  }, 60_000);

  /** A body whose long table is one block, after enough text to fill a few pages. */
  function longTableDocx(): Uint8Array {
    const parts: string[] = [];
    for (let index = 0; index < 80; index += 1) parts.push(paragraph(`Lead paragraph ${index}`));
    parts.push(table(600, 'Long'));
    for (let index = 0; index < 40; index += 1) parts.push(paragraph(`Tail paragraph ${index}`));
    return zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId9" Type="${NUMREL}" Target="numbering.xml"/></Relationships>`
      ),
      'word/numbering.xml': strToU8(NUMBERING),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body>${parts.join('')}<w:sectPr/></w:body></w:document>`
      ),
    });
  }

  /** A container inside a host scroller, which a reveal needs. */
  function scrolledContainer(): HTMLElement {
    const scroller = document.createElement('div');
    scroller.className = 'docx-editor__scroll-container';
    const container = document.createElement('div');
    scroller.append(container);
    return container;
  }

  function slicedMount(bytes: Uint8Array) {
    const container = scrolledContainer();
    const mounted = mountPaginatedSurface(container, bytes, {
      progressiveOpen: true,
    } as Parameters<typeof mountPaginatedSurface>[2]);
    if (!mounted.ok) throw new Error(mounted.reason);
    return mounted.surface;
  }

  /** Sections whose text ends in a page break before an empty section mark. */
  function breakSectionsDocx(): Uint8Array {
    const parts: string[] = [];
    for (let section = 0; section < 4; section += 1) {
      for (let index = 0; index < 150; index += 1) {
        parts.push(paragraph(`Section ${section} paragraph ${index}`));
      }
      parts.push(`<w:p><w:r><w:t>Section ${section} end</w:t><w:br w:type="page"/></w:r></w:p>`);
      if (section < 3) parts.push('<w:p><w:pPr><w:sectPr/></w:pPr></w:p>');
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
        `<w:document xmlns:w="${W}"><w:body>${parts.join('')}<w:sectPr/></w:body></w:document>`
      ),
    });
  }

  /** Sections whose footer shows `Page N of M` through PAGE and NUMPAGES fields. */
  function pageFooterDocx(sectionCount: number): Uint8Array {
    const FOOTER_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer';
    const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const sectPr = `<w:sectPr><w:footerReference w:type="default" r:id="rIdF"/></w:sectPr>`;
    const parts: string[] = [];
    for (let section = 0; section < sectionCount; section += 1) {
      for (let index = 0; index < 120; index += 1) {
        parts.push(paragraph(`Section ${section} paragraph ${index}`));
      }
      if (section < sectionCount - 1) parts.push(`<w:p><w:pPr>${sectPr}</w:pPr></w:p>`);
    }
    const field = (instr: string) =>
      `<w:fldSimple w:instr=" ${instr} "><w:r><w:t>1</w:t></w:r></w:fldSimple>`;
    return zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rIdF" Type="${FOOTER_REL}" Target="footer1.xml"/></Relationships>`
      ),
      'word/footer1.xml': strToU8(
        `<w:ftr xmlns:w="${W}"><w:p><w:r><w:t xml:space="preserve">Page </w:t></w:r>${field('PAGE')}` +
          `<w:r><w:t xml:space="preserve"> of </w:t></w:r>${field('NUMPAGES')}</w:p></w:ftr>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${parts.join('')}${sectPr}</w:body></w:document>`
      ),
    });
  }

  function footerTexts(layout: SemanticLayout): string[] {
    return layout.pages.map((page) =>
      (page.footer?.fragments ?? [])
        .flatMap((fragment) =>
          fragment.kind === 'paragraph'
            ? fragment.lines.flatMap((line) => line.spans.map((span) => span.text))
            : []
        )
        .join('')
    );
  }

  for (const sectionCount of [1, 3]) {
    test(`page fields show the final page count after the slices (${sectionCount} sections)`, () => {
      const bytes = pageFooterDocx(sectionCount);
      const surface = slicedMount(bytes);
      try {
        let slices = 0;
        while (!continueProgressiveOpen(surface, 0)) slices += 1;
        expect(slices).toBeGreaterThanOrEqual(1);
        const texts = footerTexts(surface.layout());
        const total = texts.length;
        expect(total).toBeGreaterThan(4);
        expect(texts).toEqual(texts.map((_, index) => `Page ${index + 1} of ${total}`));
        const container = document.createElement('div');
        const unsliced = mountPaginatedSurface(container, bytes);
        if (!unsliced.ok) throw new Error(unsliced.reason);
        try {
          expect(footerTexts(unsliced.surface.layout())).toEqual(texts);
        } finally {
          unsliced.surface.destroy();
        }
      } finally {
        surface.destroy();
      }
    }, 60_000);
  }

  test('a section the slices completed is not laid out again when the next one starts', () => {
    const bytes = breakSectionsDocx();
    const surface = slicedMount(bytes);
    try {
      while (!continueProgressiveOpen(surface, 0)) {
        // One prefix pass per step.
      }
      // The first slice is the open's one full pass. Once the next section exists, the first
      // section's closing break keeps its empty mark on the break's sheet; that used to lay
      // the whole section out again from its first block, a second full pass.
      expect(surface.state().perf.fullPasses).toBe(1);
      expect(signature(surface.layout())).toEqual(unslicedSignature(bytes));
    } finally {
      surface.destroy();
    }
  }, 60_000);

  test('a long table is laid out across many slices, pausing between its rows', () => {
    const bytes = longTableDocx();
    const surface = slicedMount(bytes);
    try {
      // A zero budget runs one step per slice: one pause point at a time.
      let slices = 0;
      while (!continueProgressiveOpen(surface, 0)) slices += 1;
      // 600 rows pause every few rows, so the table alone took far more slices than the
      // block prefixes around it.
      expect(slices).toBeGreaterThan(50);
      expect(progressiveOpenPending(surface)).toBe(false);
      expect(signature(surface.layout())).toEqual(unslicedSignature(bytes));
    } finally {
      surface.destroy();
    }
  }, 60_000);

  test('a paragraph a collaborator adds before the last slice is laid out at the end', () => {
    const bytes = docx();
    // The slices an untouched open takes; the copy below stops one short of the last.
    const counting = slicedMount(bytes);
    let slices = 1;
    while (!continueProgressiveOpen(counting, 0)) slices += 1;
    counting.destroy();
    const surface = slicedMount(bytes);
    try {
      for (let slice = 1; slice < slices; slice += 1) continueProgressiveOpen(surface, 0);
      expect(progressiveOpenPending(surface)).toBe(true);
      // Committed on the session, as a collaborator's edit arrives: the surface lays it out
      // later, so the block count the slices read is still the one before it.
      const ids = surface.session.paragraphIds();
      surface.session.applyTreeOps([
        { op: 'splitParagraph', paragraphId: ids[ids.length - 1]!, offset: 1 },
      ]);
      while (!continueProgressiveOpen(surface, 0)) {
        // The rest of the opening.
      }
      const laidOut = new Set(signature(surface.layout()).map((row) => row.split('|')[1]!));
      for (const id of surface.session.paragraphIds()) expect(laidOut.has(id)).toBe(true);
    } finally {
      surface.destroy();
    }
  }, 60_000);

  /** One page per paragraph: enough later pages for a final flush to defer them. */
  function pagePerParagraphDocx(count: number): Uint8Array {
    const parts: string[] = [];
    for (let index = 0; index < count; index += 1)
      parts.push(paragraph(`Paragraph ${index}`, '<w:pageBreakBefore/>'));
    return zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body>${parts.join('')}<w:sectPr/></w:body></w:document>`
      ),
    });
  }

  test('a forced finish after an edit leaves nothing pending and shows the edited document', () => {
    const bytes = pagePerParagraphDocx(300);
    const container = scrolledContainer();
    const mounted = mountPaginatedSurface(container, bytes, {
      progressiveOpen: true,
    } as Parameters<typeof mountPaginatedSurface>[2]);
    if (!mounted.ok) throw new Error(mounted.reason);
    const surface = mounted.surface;
    const reference = mountPaginatedSurface(document.createElement('div'), bytes);
    if (!reference.ok) throw new Error(reference.reason);
    const restore = setDeferredLayoutForTest(0, 0);
    try {
      // Right after the mount: the pages on screen are the first slice's few, so the final
      // flush has many later pages to leave to a background pass.
      const split = (target: typeof surface) => {
        const ids = target.session.paragraphIds();
        target.session.applyTreeOps([
          { op: 'splitParagraph', paragraphId: ids[ids.length - 1]!, offset: 1 },
        ]);
      };
      split(surface);
      split(reference.surface);
      expect(completeProgressiveOpen(surface)).toBe(true);
      // Nothing is left to a background pass.
      expect(container.hasAttribute('data-docx-layout-pending')).toBe(false);
      restore();
      reference.surface.flushPendingInput();
      expect(signature(surface.layout())).toEqual(signature(reference.surface.layout()));
    } finally {
      restore();
      surface.destroy();
      reference.surface.destroy();
    }
  }, 60_000);

  test('a surface destroyed while a deferred pass runs leaves no pending marker', () => {
    const container = scrolledContainer();
    const mounted = mountPaginatedSurface(container, docx(), {
      progressiveOpen: true,
    } as Parameters<typeof mountPaginatedSurface>[2]);
    if (!mounted.ok) throw new Error(mounted.reason);
    const restore = setDeferredLayoutForTest(0, 0);
    try {
      const surface = mounted.surface;
      const first = { paragraphId: surface.session.paragraphIds()[0]!, offset: 1 };
      surface.setSelection({ anchor: first, head: first });
      surface.splitParagraph();
      expect(container.hasAttribute('data-docx-layout-pending')).toBe(true);
      surface.destroy();
      expect(container.hasAttribute('data-docx-layout-pending')).toBe(false);
    } finally {
      restore();
    }
  });

  test('Select All during the slices selects the whole body', () => {
    const bytes = pagePerParagraphDocx(300);
    const surface = slicedMount(bytes);
    try {
      expect(progressiveOpenPending(surface)).toBe(true);
      surface.selectAll();
      const ids = surface.session.paragraphIds();
      expect(surface.state().selection.anchor.paragraphId).toBe(ids[0]);
      expect(surface.state().selection.head.paragraphId).toBe(ids[ids.length - 1]);
    } finally {
      surface.destroy();
    }
  }, 60_000);

  test('a bookmark past the laid-out pages moves the caret at once, and the view follows', () => {
    const parts: string[] = [];
    for (let index = 0; index < 299; index += 1)
      parts.push(paragraph(`Paragraph ${index}`, '<w:pageBreakBefore/>'));
    parts.push(
      '<w:p><w:pPr><w:pageBreakBefore/></w:pPr><w:bookmarkStart w:id="1" w:name="Far"/>' +
        '<w:r><w:t>Far target</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>'
    );
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body>${parts.join('')}<w:sectPr/></w:body></w:document>`
      ),
    });
    const surface = slicedMount(bytes);
    try {
      expect(progressiveOpenPending(surface)).toBe(true);
      expect(surface.bookmarkEditing.goTo('Far')).toBe(true);
      // Not laid out yet, and the jump did not lay the document out to answer.
      expect(progressiveOpenPending(surface)).toBe(true);
      const ids = surface.session.paragraphIds();
      expect(surface.state().selection.head.paragraphId).toBe(ids[ids.length - 1]);
    } finally {
      surface.destroy();
    }
  }, 60_000);

  test('Delete at the end of the last laid-out paragraph joins the next one', () => {
    const bytes = pagePerParagraphDocx(300);
    const surface = slicedMount(bytes);
    try {
      const laidOut = signature(surface.layout()).map((row) => row.split('|')[1]!);
      const last = laidOut[laidOut.length - 1]!;
      const text = surface.session.storyText({ kind: 'body' })!.split('\n');
      const index = surface.session.paragraphIds().indexOf(last);
      const end = { paragraphId: last, offset: text[index]!.length };
      surface.setSelection({ anchor: end, head: end });
      surface.deleteForward();
      expect(surface.session.paragraphIds()).toHaveLength(299);
    } finally {
      surface.destroy();
    }
  }, 60_000);

  test('Enter at the end of the laid-out pages, then Backspace, joins the paragraphs again', () => {
    const bytes = pagePerParagraphDocx(300);
    const surface = slicedMount(bytes);
    try {
      const laidOut = signature(surface.layout()).map((row) => row.split('|')[1]!);
      const last = laidOut[laidOut.length - 1]!;
      const text = surface.session.storyText({ kind: 'body' })!.split('\n');
      const end = {
        paragraphId: last,
        offset: text[surface.session.paragraphIds().indexOf(last)]!.length,
      };
      surface.setSelection({ anchor: end, head: end });
      surface.splitParagraph();
      expect(surface.session.paragraphIds()).toHaveLength(301);
      // The new paragraph is laid out, so the caret in it has a place to stand.
      surface.deleteBackward();
      expect(surface.session.paragraphIds()).toHaveLength(300);
    } finally {
      surface.destroy();
    }
  }, 60_000);

  test('paragraphs typed at the end of the laid-out pages stay laid out edit after edit', () => {
    const bytes = pagePerParagraphDocx(300);
    const surface = slicedMount(bytes);
    try {
      const laidOut = signature(surface.layout()).map((row) => row.split('|')[1]!);
      const last = laidOut[laidOut.length - 1]!;
      const text = surface.session.storyText({ kind: 'body' })!.split('\n');
      const end = {
        paragraphId: last,
        offset: text[surface.session.paragraphIds().indexOf(last)]!.length,
      };
      surface.setSelection({ anchor: end, head: end });
      surface.splitParagraph();
      surface.type('x');
      surface.splitParagraph();
      surface.type('y');
      expect(progressiveOpenPending(surface)).toBe(true);
      const rows = signature(surface.layout());
      expect(rows.some((row) => row.split('|')[2] === 'x')).toBe(true);
      expect(rows.some((row) => row.split('|')[2] === 'y')).toBe(true);
    } finally {
      surface.destroy();
    }
  }, 60_000);

  test('a collaborator deleting paragraphs past the cut leaves the laid-out pages in place', () => {
    const bytes = pagePerParagraphDocx(300);
    const surface = slicedMount(bytes);
    try {
      const laidOut = new Set(signature(surface.layout()).map((row) => row.split('|')[1]!));
      // Forty joins near the end of the body, far past the pages laid out so far.
      for (let join = 0; join < 40; join += 1) {
        const ids = surface.session.paragraphIds();
        surface.session.applyTreeOps([
          { op: 'joinParagraphs', firstId: ids[250]!, secondId: ids[251]! },
        ]);
      }
      surface.flushPendingInput();
      const after = new Set(signature(surface.layout()).map((row) => row.split('|')[1]!));
      for (const id of laidOut) expect(after.has(id)).toBe(true);
    } finally {
      surface.destroy();
    }
  }, 60_000);

  test('a jump to a near bookmark replaces one still waiting for a far page', () => {
    const parts: string[] = [
      '<w:p><w:bookmarkStart w:id="1" w:name="Near"/><w:r><w:t>Near target</w:t></w:r>' +
        '<w:bookmarkEnd w:id="1"/></w:p>',
    ];
    for (let index = 0; index < 299; index += 1)
      parts.push(paragraph(`Paragraph ${index}`, '<w:pageBreakBefore/>'));
    parts.push(
      '<w:p><w:pPr><w:pageBreakBefore/></w:pPr><w:bookmarkStart w:id="2" w:name="Far"/>' +
        '<w:r><w:t>Far target</w:t></w:r><w:bookmarkEnd w:id="2"/></w:p>'
    );
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body>${parts.join('')}<w:sectPr/></w:body></w:document>`
      ),
    });
    const surface = slicedMount(bytes);
    try {
      expect(surface.bookmarkEditing.goTo('Far')).toBe(true);
      expect(surface.bookmarkEditing.goTo('Near')).toBe(true);
      while (!continueProgressiveOpen(surface, 0)) {
        // The far page is laid out; nobody waits for it any more.
      }
      expect(surface.state().selection.head.paragraphId).toBe(surface.session.paragraphIds()[0]);
    } finally {
      surface.destroy();
    }
  }, 60_000);

  test('a long table after the first slice is hashed a row at a time', () => {
    const bytes = longTableDocx();
    const surface = slicedMount(bytes);
    const recorder = layoutNodeTokenVisitTestRecorder();
    try {
      let most = 0;
      do recorder.reset();
      while (
        !continueProgressiveOpen(surface, 0) &&
        ((most = Math.max(most, recorder.nodeVisits)), true)
      );
      // The table has 600 rows of about a dozen nodes each. Hashed whole, one slice visited
      // all of them; a row at a time, no slice visits more than a few rows' worth.
      expect(most).toBeGreaterThan(0);
      expect(most).toBeLessThan(600);
      expect(signature(surface.layout())).toEqual(unslicedSignature(bytes));
    } finally {
      recorder.dispose();
      surface.destroy();
    }
  }, 60_000);

  test('a layout while a slice is paused in a table still ends in the right layout', () => {
    const bytes = longTableDocx();
    const surface = slicedMount(bytes);
    try {
      // Run until a slice is paused inside the long table.
      for (let slice = 0; slice < 30; slice += 1) continueProgressiveOpen(surface, 0);
      expect(progressiveOpenPending(surface)).toBe(true);
      // A zoom lays the document out at once, on the same session.
      surface.setScale(surface.state().scale * 1.25);
      while (!continueProgressiveOpen(surface, 0)) {
        // Drain whatever the zoom left.
      }
      const reference = slicedMount(bytes);
      try {
        while (!continueProgressiveOpen(reference, Infinity)) {
          // An unpaused open at the same scale.
        }
        reference.setScale(surface.state().scale);
        expect(signature(surface.layout())).toEqual(signature(reference.layout()));
      } finally {
        reference.destroy();
      }
    } finally {
      surface.destroy();
    }
  }, 60_000);

  /** The first body paragraph the layout shows. */
  function firstParagraphId(layout: SemanticLayout): string {
    for (const page of layout.pages)
      for (const block of page.fragments) if (block.kind === 'paragraph') return block.paragraphId;
    throw new Error('no paragraph');
  }

  test('an edit during the slices lands at once, and the open ends in the edited layout', () => {
    const bytes = docx();
    const surface = slicedMount(bytes);
    const reference = mountPaginatedSurface(document.createElement('div'), bytes);
    if (!reference.ok) throw new Error(reference.reason);
    try {
      continueProgressiveOpen(surface, 0);
      expect(progressiveOpenPending(surface)).toBe(true);
      const at = { paragraphId: firstParagraphId(surface.layout()), offset: 0 };
      surface.setSelection({ anchor: at, head: at });
      surface.type('Edited ');
      // The edit is on the page, and the opening goes on after it.
      expect(signature(surface.layout())[0]).toContain('Edited ');
      expect(progressiveOpenPending(surface)).toBe(true);
      while (!continueProgressiveOpen(surface, 0)) {
        // The rest of the opening.
      }
      reference.surface.setSelection({ anchor: at, head: at });
      reference.surface.type('Edited ');
      expect(signature(surface.layout())).toEqual(signature(reference.surface.layout()));
    } finally {
      surface.destroy();
      reference.surface.destroy();
    }
  }, 60_000);

  test('a reveal of a page still to come waits for it instead of blocking', () => {
    const bytes = docx();
    const surface = slicedMount(bytes);
    try {
      const last = signature(unslicedLayoutOf(bytes)).at(-1)!.split('|')[1]!;
      const reveals: string[] = [];
      const revealParagraph = surface.revealParagraph.bind(surface);
      surface.revealParagraph = (paragraphId, options) => {
        reveals.push(paragraphId);
        return revealParagraph(paragraphId, options);
      };
      expect(surface.revealParagraph(last)).toBe(true);
      // Accepted, with the opening still to run: nothing was laid out to answer it.
      expect(progressiveOpenPending(surface)).toBe(true);
      expect(reveals).toEqual([last]);
      while (!continueProgressiveOpen(surface, 0)) {
        // The slices reach the paragraph and reveal it.
      }
      expect(reveals).toEqual([last, last]);
    } finally {
      surface.destroy();
    }
  }, 60_000);

  test('a newer reveal that goes at once replaces one still waiting', () => {
    const bytes = docx();
    const surface = slicedMount(bytes);
    try {
      const last = signature(unslicedLayoutOf(bytes)).at(-1)!.split('|')[1]!;
      const first = firstParagraphId(surface.layout());
      const reveals: string[] = [];
      const revealParagraph = surface.revealParagraph.bind(surface);
      surface.revealParagraph = (paragraphId, options) => {
        reveals.push(paragraphId);
        return revealParagraph(paragraphId, options);
      };
      expect(surface.revealParagraph(last)).toBe(true);
      surface.revealParagraph(first);
      while (!continueProgressiveOpen(surface, 0)) {
        // The opening reaches the first target, which nobody waits for any more.
      }
      expect(reveals).toEqual([last, first]);
    } finally {
      surface.destroy();
    }
  }, 60_000);

  test('the slices wait while an IME composition is open', () => {
    const bytes = docx();
    const container = document.createElement('div');
    document.body.append(container);
    const mounted = mountPaginatedSurface(container, bytes, {
      progressiveOpen: true,
    } as Parameters<typeof mountPaginatedSurface>[2]);
    if (!mounted.ok) throw new Error(mounted.reason);
    const surface = mounted.surface;
    try {
      const pages = container.querySelector('.docx-pages')!;
      const before = surface.layout();
      pages.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      // A shown prefix would repaint the text the composition writes into.
      for (let slice = 0; slice < 5; slice += 1)
        expect(continueProgressiveOpen(surface, 0)).toBe(false);
      expect(surface.layout()).toBe(before);
      pages.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }));
      while (!continueProgressiveOpen(surface, 0)) {
        // The opening goes on once the composition ends.
      }
      expect(signature(surface.layout())).toEqual(unslicedSignature(bytes));
    } finally {
      surface.destroy();
      container.remove();
    }
  }, 60_000);

  test('a detach and attach during the slices keep the live document and its edits', async () => {
    const bytes = docx();
    const editor = createDocxEditor({ document: bytes });
    const second = document.createElement('div');
    let surface: NonNullable<typeof editor.surface> | null = null;
    let pendingAtMove = false;
    // Right after the mount task, before any background slice runs.
    const off = editor.on('change', () => {
      if (surface || !editor.surface) return;
      surface = editor.surface;
      queueMicrotask(() => {
        const live = surface!;
        pendingAtMove = progressiveOpenPending(live);
        const at = { paragraphId: firstParagraphId(live.layout()), offset: 0 };
        live.setSelection({ anchor: at, head: at });
        live.type('Kept ');
        editor.detach();
        editor.attach(second);
      });
    });
    editor.attach(document.createElement('div'));
    await until(
      () => surface !== null && !progressiveOpenPending(surface) && editor.surface !== null
    );
    off();
    expect(pendingAtMove).toBe(true);
    // The same surface moved; the open did not start again from the original bytes.
    expect(editor.surface).toBe(surface!);
    expect(signature(surface!.layout())[0]).toContain('Kept ');
    expect(second.hasAttribute('data-docx-layout-pending')).toBe(false);
    editor.destroy();
  }, 60_000);

  test('a destroyed surface drops its opening state', () => {
    const bytes = docx();
    const container = scrolledContainer();
    const mounted = mountPaginatedSurface(container, bytes, {
      progressiveOpen: true,
    } as Parameters<typeof mountPaginatedSurface>[2]);
    if (!mounted.ok) throw new Error(mounted.reason);
    expect(container.querySelector('.docx-opening-indicator')).not.toBeNull();
    mounted.surface.destroy();
    expect(progressiveOpenPending(mounted.surface)).toBe(false);
    expect(container.querySelector('.docx-opening-indicator')).toBeNull();
    expect(container.hasAttribute('data-docx-layout-pending')).toBe(false);
    expect(container.hasAttribute('data-docx-opening-preview')).toBe(false);
  });

  test('a reader of the whole pagination finishes the opening, even during a composition', () => {
    const bytes = docx();
    const container = scrolledContainer();
    const mounted = mountPaginatedSurface(container, bytes, {
      progressiveOpen: true,
    } as Parameters<typeof mountPaginatedSurface>[2]);
    if (!mounted.ok) throw new Error(mounted.reason);
    try {
      container
        .querySelector('.docx-pages')!
        .dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      expect(completeProgressiveOpen(mounted.surface)).toBe(true);
      expect(progressiveOpenPending(mounted.surface)).toBe(false);
      expect(signature(mounted.surface.layout())).toEqual(unslicedSignature(bytes));
    } finally {
      mounted.surface.destroy();
    }
  }, 60_000);

  test('a reveal that still waits is dropped once the reader scrolls away', () => {
    const bytes = docx();
    const container = scrolledContainer();
    const mounted = mountPaginatedSurface(container, bytes, {
      progressiveOpen: true,
    } as Parameters<typeof mountPaginatedSurface>[2]);
    if (!mounted.ok) throw new Error(mounted.reason);
    const surface = mounted.surface;
    try {
      const last = signature(unslicedLayoutOf(bytes)).at(-1)!.split('|')[1]!;
      let reveals = 0;
      const revealParagraph = surface.revealParagraph.bind(surface);
      surface.revealParagraph = (paragraphId, options) => {
        reveals += 1;
        return revealParagraph(paragraphId, options);
      };
      expect(surface.revealParagraph(last)).toBe(true);
      // The scrollbar, not the pages: no input event reaches the pages layer.
      container.parentElement!.scrollTop = 400;
      while (!continueProgressiveOpen(surface, 0)) {
        // The opening reaches the paragraph; the reader is elsewhere now.
      }
      expect(reveals).toBe(1);
    } finally {
      surface.destroy();
    }
  }, 60_000);

  test('input in the pages cancels a reveal that still waits', () => {
    const bytes = docx();
    const container = scrolledContainer();
    const mounted = mountPaginatedSurface(container, bytes, {
      progressiveOpen: true,
    } as Parameters<typeof mountPaginatedSurface>[2]);
    if (!mounted.ok) throw new Error(mounted.reason);
    const surface = mounted.surface;
    try {
      const last = signature(unslicedLayoutOf(bytes)).at(-1)!.split('|')[1]!;
      let reveals = 0;
      const revealParagraph = surface.revealParagraph.bind(surface);
      surface.revealParagraph = (paragraphId, options) => {
        reveals += 1;
        return revealParagraph(paragraphId, options);
      };
      // A paragraph that is not in the document is still refused at once.
      expect(surface.revealParagraph('no-such-paragraph')).toBe(false);
      expect(surface.revealParagraph(last)).toBe(true);
      container
        .querySelector('.docx-pages')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
      while (!continueProgressiveOpen(surface, 0)) {
        // The reader moved on, so reaching the paragraph reveals nothing.
      }
      expect(reveals).toBe(2);
    } finally {
      surface.destroy();
    }
  }, 60_000);
});

function unslicedLayoutOf(bytes: Uint8Array): SemanticLayout {
  const mounted = mountPaginatedSurface(document.createElement('div'), bytes);
  if (!mounted.ok) throw new Error(mounted.reason);
  try {
    return mounted.surface.layout();
  } finally {
    mounted.surface.destroy();
  }
}
