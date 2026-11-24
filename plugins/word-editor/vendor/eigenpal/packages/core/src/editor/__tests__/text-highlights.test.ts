import { afterEach, describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { HighlightRange } from '../../contracts/editor-highlights.ts';
import { docx } from './paginated-surface-fixtures.ts';
import { createDocxEditor } from '../docx-editor.ts';
import { mountAnchorEditor } from './scroll-to-anchor-fixture.ts';
import { storyParityDocx } from './story-parity-fixture.ts';
import {
  createTextHighlights,
  HIGHLIGHT_RANGE_LIMIT,
  HIGHLIGHT_SET_LIMIT,
} from '../text-highlights.ts';
import type { SurfaceOverlayPainter } from '../surface-overlay-sheet.ts';
import { createDocumentRefresh } from '../document-refresh.ts';
import { refreshFixture, refreshMetadata } from './document-refresh-fixture.ts';

function textbox(text: string): string {
  return (
    '<w:r><w:drawing xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
    '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="1" ' +
    'behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="914400" cy="457200"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    '<wp:wrapNone/><wp:docPr id="7" name="Box"/>' +
    '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp>' +
    '<wps:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>' +
    `<wps:txbx><w:txbxContent><w:p><w:r><w:t>${text}</w:t></w:r></w:p>` +
    '</w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic>' +
    '</wp:anchor></w:drawing></w:r>'
  );
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

function mount(bytes = docx(p('Supplier pays Supplier.') + p('The Supplier signs.'))) {
  const mounted = mountAnchorEditor(bytes);
  cleanups.push(mounted.destroy);
  const marks = (name?: string) => [
    ...mounted.host.querySelectorAll<HTMLElement>(
      name ? `[data-highlight-set="${name}"] .docx-text-highlight` : '.docx-text-highlight'
    ),
  ];
  return { ...mounted, marks };
}

const indexes = (elements: readonly HTMLElement[]) =>
  [...new Set(elements.map((element) => Number(element.dataset.highlightIndex)))].sort(
    (a, b) => a - b
  );

describe('setHighlights', () => {
  test('scans uncached pages together and caches pages without rectangles', () => {
    const { editor, host } = mount();
    const actualSurface = editor.surface!;
    const published = actualSurface.publishedLayout();
    const pageCount = 32;
    let indexReads = 0;
    const pages = Array.from({ length: pageCount }, (_, index) => ({
      ...published.pages[0]!,
      fragments: index === 0 ? published.pages[0]!.fragments : [],
      get index() {
        indexReads += 1;
        return index;
      },
    }));
    const layout = { ...published, pages };
    let painter: SurfaceOverlayPainter | null = null;
    const surface = {
      ...actualSurface,
      publishedLayout: () => layout,
      repaintHighlights: () => {},
      setHighlightPainter(value: SurfaceOverlayPainter | null) {
        painter = value;
      },
    };
    const controller = createTextHighlights({
      surface: () => surface,
      container: () => host,
      flushOpen: () => {},
    });
    controller.attach(surface);
    controller.members.setHighlights('glossary', editor.findMatches('Supplier').slice(0, 1));
    const layer = document.createElement('div');
    const frame = { layer, layout, revision: layout.revision, scale: 1 };

    indexReads = 0;
    painter!(frame);
    expect(indexReads).toBeLessThanOrEqual(pageCount * 4);
    expect(layer.querySelectorAll('.docx-text-highlight')).toHaveLength(1);

    indexReads = 0;
    painter!({ ...frame, pages: new Set([0, 1]) });
    expect(indexReads).toBeLessThanOrEqual(pageCount * 2);
    expect(layer.querySelectorAll('.docx-text-highlight')).toHaveLength(1);
  });

  test('marks every match and styles the active one, as view state only', () => {
    const { editor, marks, host } = mount();
    const matches = editor.findMatches('Supplier');
    expect(matches).toHaveLength(3);
    const selection = editor.surface!.state().selection;
    const canUndo = editor.snapshot().canUndo;
    let events = 0;
    editor.on('change', () => events++);
    editor.on('selectionChange', () => events++);

    expect(editor.setHighlights('search', matches, { activeIndex: 1 })).toEqual({
      applied: 3,
      unavailable: 0,
    });

    expect(indexes(marks('search'))).toEqual([0, 1, 2]);
    const active = marks('search').filter((mark) =>
      mark.classList.contains('docx-text-highlight--active')
    );
    expect(indexes(active)).toEqual([1]);
    const layer = host.querySelector('.docx-text-highlight-overlay')!;
    expect(layer.getAttribute('aria-hidden')).toBe('true');
    expect(layer.getAttribute('contenteditable')).toBe('false');
    expect(editor.surface!.state().selection).toEqual(selection);
    expect(editor.snapshot().canUndo).toBe(canUndo);
    expect(events).toBe(0);
  });

  test('a mark covers its own text, not the paragraph', () => {
    const { editor, marks } = mount();
    const [first, second] = editor.findMatches('Supplier');
    editor.setHighlights('search', [first!, second!]);
    const [a, b] = marks();
    expect(Number.parseFloat(a!.style.width)).toBeGreaterThan(0);
    expect(a!.style.top).toBe(b!.style.top);
    expect(Number.parseFloat(b!.style.left)).toBeGreaterThan(
      Number.parseFloat(a!.style.left) + Number.parseFloat(a!.style.width)
    );
  });

  test('applies color, active color, and classes', () => {
    const { editor, marks, host } = mount();
    editor.setHighlights('glossary', editor.findMatches('Supplier'), {
      color: 'rgb(1, 2, 3)',
      activeColor: 'rgb(4, 5, 6)',
      activeIndex: 0,
      className: 'term  term--legal',
    });
    const sheet = host.querySelector<HTMLElement>('[data-highlight-set="glossary"]')!;
    expect(sheet.style.getPropertyValue('--doc-text-highlight-set-color')).toBe('rgb(1, 2, 3)');
    expect(sheet.style.getPropertyValue('--doc-text-highlight-set-active-color')).toBe(
      'rgb(4, 5, 6)'
    );
    for (const mark of marks()) {
      expect(mark.classList.contains('term')).toBe(true);
      expect(mark.classList.contains('term--legal')).toBe(true);
    }
  });

  test('counts ranges that do not resolve', () => {
    const { editor, marks } = mount();
    const [match] = editor.findMatches('Supplier');
    const ranges: HighlightRange[] = [
      match!,
      { blockId: 'missing#1', start: 0, length: 3 },
      { blockId: match!.blockId, start: 500, length: 2 },
      { blockId: match!.blockId, start: 2, length: 0 },
    ];
    expect(editor.setHighlights('mixed', ranges)).toEqual({ applied: 1, unavailable: 3 });
    expect(indexes(marks())).toEqual([0]);
  });

  test('covers headers, footers, notes, and tables', () => {
    const { editor, marks } = mount(storyParityDocx());
    const matches = editor.findMatches('Beta');
    const scopes = new Set(matches.map((match) => match.scope?.kind ?? 'body'));
    expect(scopes).toEqual(new Set(['body', 'headerFooter', 'note']));
    const result = editor.setHighlights('search', matches);
    expect(result).toEqual({ applied: matches.length, unavailable: 0 });
    expect(indexes(marks()).length).toBe(matches.length);
  });

  test('covers anchored text boxes', () => {
    const { editor, marks } = mount(
      docx(`<w:p>${textbox('boxed needle')}<w:r><w:t>body</w:t></w:r></w:p>`)
    );
    const matches = editor.findMatches('needle');
    expect(matches[0]?.scope?.kind).toBe('frame');
    expect(editor.setHighlights('search', matches)).toEqual({ applied: 1, unavailable: 0 });
    expect(marks()).toHaveLength(1);
  });

  test('a match in a header text box paints with the header', () => {
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
    const parts = unzipSync(docx('<w:p><w:r><w:t>body</w:t></w:r></w:p>'));
    const ct = strFromU8(parts['[Content_Types].xml']!);
    parts['[Content_Types].xml'] = strToU8(
      ct.replace(
        '</Types>',
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>'
      )
    );
    parts['word/_rels/document.xml.rels'] = strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rHeader" Type="${R}/header" Target="header1.xml"/></Relationships>`
    );
    parts['word/header1.xml'] = strToU8(
      `<w:hdr xmlns:w="${W}"><w:p>${textbox('header needle')}</w:p></w:hdr>`
    );
    const documentXml = strFromU8(parts['word/document.xml']!);
    parts['word/document.xml'] = strToU8(
      documentXml
        .replace('<w:document ', `<w:document xmlns:r="${R}" `)
        .replace(
          '</w:body>',
          '<w:sectPr><w:headerReference w:type="default" r:id="rHeader"/></w:sectPr></w:body>'
        )
    );
    const { editor, marks } = mount(zipSync(parts));
    const matches = editor.findMatches('needle');
    expect(matches).toHaveLength(1);
    expect(editor.setHighlights('search', matches)).toEqual({ applied: 1, unavailable: 0 });
    expect(marks().length).toBeGreaterThan(0);
    // A header edit moves the package revision but not the body revision. The count must
    // still read the laid-out stories, not treat the layout as lagging from then on.
    expect(editor.focus({ kind: 'headerFooter', rId: 'rHeader' }).ok).toBe(true);
    expect(editor.exec({ type: 'insertText', text: 'Z' }).ok).toBe(true);
    const session = editor.surface!.session;
    expect(session.packageRevision()).not.toBe(session.revision());
    expect(editor.setHighlights('search', editor.findMatches('needle'))).toEqual({
      applied: 1,
      unavailable: 0,
    });
  });

  test('replaces a set, clears it with an empty array, and keeps other sets', () => {
    const { editor, marks } = mount();
    const matches = editor.findMatches('Supplier');
    editor.setHighlights('search', matches);
    editor.setHighlights('glossary', matches.slice(0, 1));
    editor.setHighlights('search', matches.slice(2));
    expect(indexes(marks('search'))).toEqual([0]);
    expect(editor.setHighlights('search', [])).toEqual({ applied: 0, unavailable: 0 });
    expect(marks('search')).toHaveLength(0);
    expect(marks('glossary')).toHaveLength(1);
  });

  test('stacks sets by priority, then by first use', () => {
    const { editor, host } = mount();
    const matches = editor.findMatches('Supplier');
    editor.setHighlights('b', matches);
    editor.setHighlights('a', matches);
    editor.setHighlights('top', matches, { priority: 10 });
    editor.setHighlights('bottom', matches, { priority: -1 });
    // Updating a set keeps its place among equals.
    editor.setHighlights('b', matches, { activeIndex: 0 });
    const order = [...host.querySelectorAll<HTMLElement>('[data-highlight-set]')].map(
      (sheet) => sheet.dataset.highlightSet
    );
    expect(order).toEqual(['bottom', 'b', 'a', 'top']);
  });

  test('clearHighlights removes one set or all of them', () => {
    const { editor, marks } = mount();
    const matches = editor.findMatches('Supplier');
    editor.setHighlights('search', matches);
    editor.setHighlights('glossary', matches);
    editor.clearHighlights('search');
    expect(marks('search')).toHaveLength(0);
    expect(marks('glossary').length).toBeGreaterThan(0);
    editor.clearHighlights('unknown');
    editor.clearHighlights();
    expect(marks()).toHaveLength(0);
  });

  test('validates the whole request and leaves highlights unchanged on error', () => {
    const { editor, marks } = mount();
    const matches = editor.findMatches('Supplier');
    editor.setHighlights('search', matches);
    const before = marks().length;
    expect(() => editor.setHighlights('', matches)).toThrow(TypeError);
    expect(() => editor.setHighlights('1st', matches)).toThrow(TypeError);
    expect(() => editor.setHighlights('a b', matches)).toThrow(TypeError);
    expect(() => editor.setHighlights('search', 'x' as never)).toThrow(TypeError);
    expect(() =>
      editor.setHighlights('search', [{ blockId: '', start: 0, length: 1 }] as never)
    ).toThrow(TypeError);
    expect(() =>
      editor.setHighlights('search', [{ blockId: 'a#1', start: -1, length: 1 }] as never)
    ).toThrow(TypeError);
    expect(() =>
      editor.setHighlights('search', [{ blockId: 'a#1', start: 0.5, length: 1 }] as never)
    ).toThrow(TypeError);
    expect(() => editor.setHighlights('search', matches, { activeIndex: -2 })).toThrow(RangeError);
    expect(() => editor.setHighlights('search', matches, { priority: 1.5 })).toThrow(RangeError);
    expect(() => editor.setHighlights('search', matches, { priority: 1001 })).toThrow(RangeError);
    expect(() => editor.setHighlights('search', matches, { className: 'a "b' })).toThrow(TypeError);
    expect(() => editor.setHighlights('search', matches, { color: '' })).toThrow(TypeError);
    expect(() => editor.setHighlights('search', matches, null as never)).toThrow(TypeError);
    expect(() => editor.clearHighlights('bad name')).toThrow(TypeError);
    expect(marks()).toHaveLength(before);
  });

  test('enforces the range and set limits', () => {
    const { editor } = mount();
    const [match] = editor.findMatches('Supplier');
    // Past the cap, the first ranges paint and the rest count as unavailable; never a throw.
    const many = Array.from({ length: HIGHLIGHT_RANGE_LIMIT + 2 }, () => match!);
    expect(editor.setHighlights('many', many)).toEqual({
      applied: HIGHLIGHT_RANGE_LIMIT,
      unavailable: 2,
    });
    editor.clearHighlights('many');
    for (let index = 0; index < HIGHLIGHT_SET_LIMIT; index += 1) {
      editor.setHighlights(`set${index}`, [match!]);
    }
    expect(() => editor.setHighlights('oneMore', [match!])).toThrow(RangeError);
    // Replacing or clearing an existing set stays allowed at the limit.
    expect(editor.setHighlights('set0', [match!]).applied).toBe(1);
    expect(editor.setHighlights('oneMore', [])).toEqual({ applied: 0, unavailable: 0 });
  });

  test('copies the ranges array', () => {
    const { editor, marks } = mount();
    const ranges = [...editor.findMatches('Supplier')];
    editor.setHighlights('search', ranges);
    ranges.length = 0;
    editor.surface!.repaintHighlights();
    expect(indexes(marks())).toEqual([0, 1, 2]);
  });

  test('a mark follows its text when an edit shifts it, and hides when its text changes', () => {
    const { editor, marks, host } = mount();
    const matches = editor.findMatches('Supplier');
    editor.setHighlights('search', matches);
    const last = matches[2]!;
    const before = host.querySelector<HTMLElement>('[data-highlight-index="2"]')!.style.left;
    // Type before the match in its paragraph: the mark moves with the word.
    const start = { paragraphId: last.blockId, offset: 0 };
    editor.exec({ type: 'setSelection', range: { anchor: start, head: start } });
    expect(editor.exec({ type: 'insertText', text: 'XX ' }).ok).toBe(true);
    expect(indexes(marks())).toEqual([0, 1, 2]);
    const after = host.querySelector<HTMLElement>('[data-highlight-index="2"]')!.style.left;
    expect(Number.parseFloat(after)).toBeGreaterThan(Number.parseFloat(before));
    // Type inside the word: the text is gone, so the mark hides rather than cover other text.
    const inside = { paragraphId: last.blockId, offset: last.start + 3 + 3 };
    editor.exec({ type: 'setSelection', range: { anchor: inside, head: inside } });
    expect(editor.exec({ type: 'insertText', text: 'Q' }).ok).toBe(true);
    expect(indexes(marks())).toEqual([0, 1]);
  });

  test('a mark follows the nearest occurrence of its text', () => {
    const { editor, marks } = mount();
    const matches = editor.findMatches('Supplier');
    editor.setHighlights('search', matches.slice(0, 2));
    // Both marks share a paragraph. A shift keeps each on its own occurrence.
    const start = { paragraphId: matches[0]!.blockId, offset: 0 };
    editor.exec({ type: 'setSelection', range: { anchor: start, head: start } });
    expect(editor.exec({ type: 'insertText', text: 'X' }).ok).toBe(true);
    expect(indexes(marks())).toEqual([0, 1]);
    const lefts = marks().map((mark) => Number.parseFloat(mark.style.left));
    expect(new Set(lefts).size).toBe(2);
  });

  test('a mark never jumps to a longer word or to another occurrence', () => {
    const { editor, marks } = mount(docx(p('The Act applies.') + p('Act and Act.')));
    const [first, second] = editor.findMatches('Act', { wholeWord: true, matchCase: true });
    editor.setHighlights('glossary', [first!, second!]);
    // Paste text with "Actor" before the first "Act": the mark stays on "Act", not "Actor".
    const start = { paragraphId: first!.blockId, offset: 0 };
    editor.exec({ type: 'setSelection', range: { anchor: start, head: start } });
    expect(editor.exec({ type: 'insertText', text: 'The Actor said hello. ' }).ok).toBe(true);
    expect(indexes(marks())).toEqual([0, 1]);
    // Type inside the second paragraph's first "Act": that mark hides. It never stacks on
    // the paragraph's other "Act".
    const inside = { paragraphId: second!.blockId, offset: 1 };
    editor.exec({ type: 'setSelection', range: { anchor: inside, head: inside } });
    expect(editor.exec({ type: 'insertText', text: 'x' }).ok).toBe(true);
    expect(indexes(marks())).toEqual([0]);
  });

  test('undo restores a mark that an edit inside it hid', () => {
    const { editor, marks } = mount();
    const matches = editor.findMatches('Supplier');
    editor.setHighlights('search', matches);
    const last = matches[2]!;
    const inside = { paragraphId: last.blockId, offset: last.start + 3 };
    editor.exec({ type: 'setSelection', range: { anchor: inside, head: inside } });
    expect(editor.exec({ type: 'insertText', text: 'X' }).ok).toBe(true);
    expect(indexes(marks())).toEqual([0, 1]);
    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    expect(indexes(marks())).toEqual([0, 1, 2]);
  });

  test('a hit reports where its text is now', () => {
    const { editor, host } = mount();
    const matches = editor.findMatches('Supplier');
    editor.setHighlights('search', matches);
    const last = matches[2]!;
    const start = { paragraphId: last.blockId, offset: 0 };
    editor.exec({ type: 'setSelection', range: { anchor: start, head: start } });
    editor.exec({ type: 'insertText', text: 'XX ' });
    host.querySelector<HTMLElement>('.docx-text-highlight-overlay')!.getBoundingClientRect = () =>
      ({ left: 0, top: 0 }) as DOMRect;
    const mark = host.querySelector<HTMLElement>('[data-highlight-index="2"]')!;
    const [hit] = editor.getHighlightsAt(
      Number.parseFloat(mark.style.left) + 1,
      Number.parseFloat(mark.style.top) + 1
    );
    expect(hit!.range).toBe(last);
    expect(hit!.start).toBe(last.start + 3);
    expect(hit!.length).toBe(last.length);
  });

  test('checks a stale match array against the text it was found in', () => {
    const { editor, marks } = mount();
    const stale = editor.findMatches('Supplier');
    const last = stale[2]!;
    // Edit inside the last match before the stale array is set.
    const inside = { paragraphId: last.blockId, offset: last.start + 3 };
    editor.exec({ type: 'setSelection', range: { anchor: inside, head: inside } });
    expect(editor.exec({ type: 'insertText', text: 'X' }).ok).toBe(true);
    expect(editor.setHighlights('search', stale)).toEqual({ applied: 2, unavailable: 1 });
    expect(indexes(marks())).toEqual([0, 1]);
  });

  test('setting stale plain ranges again never adopts the text that moved under them', () => {
    const { editor, marks } = mount();
    const match = editor.findMatches('Supplier')[2]!;
    // A plain object, not a search result: its text is captured when it is first set.
    const plain: HighlightRange = { blockId: match.blockId, start: match.start, length: 8 };
    expect(editor.setHighlights('glossary', [plain]).applied).toBe(1);
    const inside = { paragraphId: match.blockId, offset: match.start + 3 };
    editor.exec({ type: 'setSelection', range: { anchor: inside, head: inside } });
    expect(editor.exec({ type: 'insertText', text: 'XY' }).ok).toBe(true);
    expect(marks()).toHaveLength(0);
    expect(editor.setHighlights('glossary', [plain], { activeIndex: 0 })).toEqual({
      applied: 0,
      unavailable: 1,
    });
    expect(marks()).toHaveLength(0);
  });

  test('a range with expectedText paints only while the document holds that text', () => {
    const { editor, marks } = mount();
    const match = editor.findMatches('Supplier')[2]!;
    const at = { blockId: match.blockId, start: match.start, length: 8 };
    expect(editor.setHighlights('server', [{ ...at, expectedText: 'Supplier' }]).applied).toBe(1);
    expect(editor.setHighlights('server', [{ ...at, expectedText: 'Customer' }])).toEqual({
      applied: 0,
      unavailable: 1,
    });
    expect(marks()).toHaveLength(0);
    expect(() =>
      editor.setHighlights('server', [{ ...at, expectedText: 5 as unknown as string }])
    ).toThrow(TypeError);
  });

  test('an active index past the last range means no active range', () => {
    const { editor, marks } = mount();
    const matches = editor.findMatches('Supplier');
    expect(editor.setHighlights('search', matches, { activeIndex: 7 }).applied).toBe(3);
    expect(marks().some((mark) => mark.classList.contains('docx-text-highlight--active'))).toBe(
      false
    );
    expect(editor.setHighlights('search', [], { activeIndex: 0 })).toEqual({
      applied: 0,
      unavailable: 0,
    });
  });

  test('a refresh removes every set', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container, document: refreshFixture() });
    cleanups.push(() => {
      editor.destroy();
      container.remove();
    });
    const refresh = createDocumentRefresh(editor);
    const submission = await refresh.capture();
    const [first] = editor.findMatches('Project schedule');
    expect(first).toBeTruthy();
    editor.setHighlights('search', [first!]);
    expect(container.querySelectorAll('.docx-text-highlight').length).toBeGreaterThan(0);
    await refresh.applyUpdate({
      submission,
      sequence: 1,
      bytes: refreshFixture(2),
      changes: refreshMetadata(2),
    });
    expect(container.querySelectorAll('.docx-text-highlight')).toHaveLength(0);
    expect(
      editor.setHighlights('search', editor.findMatches('Project schedule').slice(0, 1)).applied
    ).toBe(1);
  });

  test('loading another document removes every set', () => {
    const { editor, marks } = mount();
    editor.setHighlights('search', editor.findMatches('Supplier'));
    editor.load(docx(p('Supplier pays Supplier.') + p('The Supplier signs.')));
    expect(marks()).toHaveLength(0);
    expect(editor.getHighlightsAt(1, 1)).toEqual([]);
  });

  test('marks survive the editor moving to another container', () => {
    const { editor, marks, host } = mount();
    editor.setHighlights('search', editor.findMatches('Supplier'));
    const next = document.createElement('div');
    host.parentElement!.append(next);
    editor.attach(next);
    expect(indexes(marks())).toEqual([]);
    expect(indexes([...next.querySelectorAll<HTMLElement>('.docx-text-highlight')])).toEqual([
      0, 1, 2,
    ]);
  });

  test('getHighlightsAt reports the marks under a point, topmost first', () => {
    const { editor, marks, host } = mount();
    const matches = editor.findMatches('Supplier');
    editor.setHighlights('glossary', matches);
    editor.setHighlights('search', matches, { activeIndex: 1, priority: 5 });
    const layer = host.querySelector<HTMLElement>('.docx-text-highlight-overlay')!;
    layer.getBoundingClientRect = () => ({ left: 100, top: 50 }) as DOMRect;
    const target = marks('search').find((mark) => mark.dataset.highlightIndex === '1')!;
    const left = Number.parseFloat(target.style.left);
    const top = Number.parseFloat(target.style.top);
    const width = Number.parseFloat(target.style.width);
    const height = Number.parseFloat(target.style.height);

    const hits = editor.getHighlightsAt(100 + left + 1, 50 + top + 1);
    expect(hits.map((hit) => [hit.name, hit.index, hit.active])).toEqual([
      ['search', 1, true],
      ['glossary', 1, false],
    ]);
    expect(hits[0]!.range).toBe(matches[1]!);
    const rect = hits[0]!.rect;
    const expected = { left: 100 + left, top: 50 + top, width, height };
    for (const [key, value] of Object.entries({
      ...expected,
      x: expected.left,
      y: expected.top,
      right: expected.left + width,
      bottom: expected.top + height,
    })) {
      expect(rect[key as keyof typeof rect]).toBeCloseTo(value, 3);
    }
    expect(editor.getHighlightsAt(0, 0)).toEqual([]);
    expect(editor.getHighlightsAt(Number.NaN, 1)).toEqual([]);
    editor.clearHighlights('search');
    expect(editor.getHighlightsAt(100 + left + 1, 50 + top + 1).map((hit) => hit.name)).toEqual([
      'glossary',
    ]);
  });
});
