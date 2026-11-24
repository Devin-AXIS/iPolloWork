// A selection pinned so it stays visible while a panel holds focus.
//
// A document has ONE selection. The moment the hyperlink panel focuses its URL field, the
// browser moves that selection into the input and the words the user highlighted stop looking
// highlighted — at exactly the moment the panel is asking "what should this text link to?".
// Word and Google Docs both keep the range lit while their dialog is up.
//
// The engine draws it on its own overlay instead, and owns the release rule: the pin drops
// when the caret LEAVES the range. That rule lives here rather than in an adapter so a host
// closing its panel on "the user clicked elsewhere" reads a fact instead of recomputing
// document order, and so React and Vue cannot drift into two different definitions of
// "elsewhere".

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test, afterEach } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import {
  mountPaginatedSurface,
  setPaginatedSurfaceScale,
  type PaginatedSurface,
} from '../paginated-surface.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const P = (index: number) => `/word/document.xml#0.0.${index}`;
const BODY =
  '<w:p><w:r><w:t>Visit example today</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>Second paragraph here</w:t></w:r></w:p>';

afterEach(() => {
  document.getSelection()?.removeAllRanges();
  for (const node of [...document.body.children]) {
    if (node instanceof HTMLElement && node.classList.contains('docx-paginated-surface')) {
      node.remove();
    }
  }
});

interface Mounted {
  readonly surface: PaginatedSurface;
  readonly container: HTMLElement;
}

function mount(): Mounted {
  const container = document.createElement('div');
  container.className = 'docx-paginated-surface';
  document.body.append(container);
  const opened = mountPaginatedSurface(container, docx(BODY));
  if (!opened.ok) throw new Error(opened.reason);
  return { surface: opened.surface, container };
}

/** Select `[start, end)` of paragraph `index`. */
function select(mounted: Mounted, index: number, start: number, end: number): void {
  mounted.surface.setSelection({
    anchor: { paragraphId: P(index), offset: start },
    head: { paragraphId: P(index), offset: end },
  });
}

const caret = (mounted: Mounted, index: number, offset: number) =>
  select(mounted, index, offset, offset);

/** Rectangles the retained-selection overlay is currently drawing. */
const retainedRects = (mounted: Mounted) =>
  mounted.container.querySelectorAll('.docx-retained-selection-rect').length;

describe('a retained selection stays lit while focus is elsewhere', () => {
  test('nothing is retained until a host asks', () => {
    const mounted = mount();
    select(mounted, 0, 6, 13);
    expect(mounted.surface.retainedSelection()).toBeNull();
    expect(retainedRects(mounted)).toBe(0);
  });

  test('an active paragraph-mark selection paints the part the browser cannot show', () => {
    const mounted = mount();
    mounted.surface.setSelection({
      anchor: { paragraphId: P(0), offset: 'Visit example today'.length },
      head: { paragraphId: P(1), offset: 0 },
    });
    const marks = mounted.container.querySelectorAll<HTMLElement>('.docx-selection-mark-rect');
    expect(marks).toHaveLength(1);
    expect(parseFloat(marks[0]!.style.width)).toBeGreaterThan(0);
    expect(retainedRects(mounted)).toBe(0);
  });

  test('retaining pins the range and paints it', () => {
    const mounted = mount();
    select(mounted, 0, 6, 13);
    mounted.surface.retainSelection();
    const pinned = mounted.surface.retainedSelection();
    expect(pinned?.anchor.offset).toBe(6);
    expect(pinned?.head.offset).toBe(13);
    // Drawn on the engine's overlay, which is what survives the browser moving its one
    // selection into a panel's input.
    expect(retainedRects(mounted)).toBeGreaterThan(0);
  });

  test('a rescale redraws the pinned range at the new scale', () => {
    // The overlay is a sibling of the pages, painted from the same layout geometry at the same
    // scale. A zoom that moved the sheets and left the highlight behind would light up the
    // wrong words while the panel is asking about them.
    const mounted = mount();
    select(mounted, 0, 6, 13);
    mounted.surface.retainSelection();
    const geometry = () =>
      [...mounted.container.querySelectorAll<HTMLElement>('.docx-retained-selection-rect')].map(
        (rect) => [
          parseFloat(rect.style.left),
          parseFloat(rect.style.top),
          parseFloat(rect.style.width),
          parseFloat(rect.style.height),
        ]
      );
    const before = geometry();
    expect(before.length).toBeGreaterThan(0);

    // The surface mounted at the default 96/72; twice that is a 200% zoom.
    expect(setPaginatedSurfaceScale(mounted.surface, (96 / 72) * 2)).toBe(true);

    const after = geometry();
    expect(after.length).toBe(before.length);
    after.forEach((rect, index) => {
      rect.forEach((value, axis) => {
        expect(value).toBeCloseTo(before[index]![axis]! * 2, 5);
      });
    });
    expect(mounted.surface.retainedSelection()).not.toBeNull();
  });

  test('the MODEL selection is untouched, so the op still addresses the same text', () => {
    const mounted = mount();
    select(mounted, 0, 6, 13);
    mounted.surface.retainSelection();
    // The pin is a sibling of the selection, not a replacement for it.
    expect(mounted.surface.state().selection.anchor.offset).toBe(6);
    expect(mounted.surface.state().selection.head.offset).toBe(13);
    expect(mounted.surface.selectedText()).toBe('example');
  });

  test('a caret INSIDE the range keeps the pin — clicking your own selection is not leaving', () => {
    const mounted = mount();
    select(mounted, 0, 6, 13);
    mounted.surface.retainSelection();
    caret(mounted, 0, 9);
    expect(mounted.surface.retainedSelection()).not.toBeNull();
    expect(retainedRects(mounted)).toBeGreaterThan(0);
  });

  test('either EDGE counts as inside', () => {
    const mounted = mount();
    select(mounted, 0, 6, 13);
    mounted.surface.retainSelection();
    caret(mounted, 0, 6);
    expect(mounted.surface.retainedSelection()).not.toBeNull();
    caret(mounted, 0, 13);
    expect(mounted.surface.retainedSelection()).not.toBeNull();
  });

  test('a caret OUTSIDE the range releases the pin and clears the paint', () => {
    const mounted = mount();
    select(mounted, 0, 6, 13);
    mounted.surface.retainSelection();
    caret(mounted, 0, 2);
    expect(mounted.surface.retainedSelection()).toBeNull();
    expect(retainedRects(mounted)).toBe(0);
  });

  test('a caret in ANOTHER paragraph releases the pin', () => {
    const mounted = mount();
    select(mounted, 0, 6, 13);
    mounted.surface.retainSelection();
    caret(mounted, 1, 3);
    expect(mounted.surface.retainedSelection()).toBeNull();
  });

  test('a backwards selection retains the same range', () => {
    const mounted = mount();
    // head before anchor — the pin must order the range, not trust the field names.
    select(mounted, 0, 13, 6);
    mounted.surface.retainSelection();
    caret(mounted, 0, 9);
    expect(mounted.surface.retainedSelection()).not.toBeNull();
    caret(mounted, 0, 2);
    expect(mounted.surface.retainedSelection()).toBeNull();
  });

  test('a COLLAPSED pin (Ctrl+K with nothing selected) releases on any move', () => {
    const mounted = mount();
    caret(mounted, 0, 4);
    mounted.surface.retainSelection();
    expect(mounted.surface.retainedSelection()).not.toBeNull();
    // Zero-width range: staying put is inside, moving at all is out.
    caret(mounted, 0, 4);
    expect(mounted.surface.retainedSelection()).not.toBeNull();
    caret(mounted, 0, 5);
    expect(mounted.surface.retainedSelection()).toBeNull();
  });

  test('releasing explicitly drops the pin whether or not the caret ever left', () => {
    const mounted = mount();
    select(mounted, 0, 6, 13);
    const pin = mounted.surface.retainSelection();
    mounted.surface.releaseSelection(pin);
    expect(mounted.surface.retainedSelection()).toBeNull();
    expect(retainedRects(mounted)).toBe(0);
  });

  test('releasing one owner keeps another owner pinned', () => {
    const mounted = mount();
    select(mounted, 0, 6, 13);
    const commentPin = mounted.surface.retainSelection();
    const hyperlinkPin = mounted.surface.retainSelection();

    mounted.surface.releaseSelection(hyperlinkPin);
    expect(mounted.surface.retainedSelection()).not.toBeNull();
    expect(retainedRects(mounted)).toBeGreaterThan(0);

    mounted.surface.releaseSelection(commentPin);
    expect(mounted.surface.retainedSelection()).toBeNull();
    expect(retainedRects(mounted)).toBe(0);
  });

  test('a cell rectangle still paints as cells, not as a retained range', () => {
    // The two share one overlay layer and must not share one appearance: "these cells are
    // chosen" and "your selection is still here" are different statements.
    const mounted = mount();
    select(mounted, 0, 6, 13);
    mounted.surface.retainSelection();
    expect(mounted.container.querySelectorAll('.docx-cell-selection-rect').length).toBe(0);
  });
});
