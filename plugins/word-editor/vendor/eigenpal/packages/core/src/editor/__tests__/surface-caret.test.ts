// The engine's painted insertion point.
//
// Two things it has to be at once: a two-pixel cursor drawn at the geometry LAYOUT
// published, and something the selection machinery cannot see. The second is the part that
// breaks quietly — an element a DOM endpoint can resolve through puts every offset after it
// out by the length of a run.
//
// It also has to appear where the native caret does not. An empty paragraph paints no text
// span, so the browser has no inline box to size an insertion point against; `caretAt`
// resolves against the LINE record, which layout publishes either way, which is why
// pressing Enter now leaves a visible cursor instead of nothing.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { caretAt } from '@docx-editor.dev/core/layout';
import {
  mountPaginatedSurface,
  setPaginatedSurfaceScale,
  type PaginatedSurface,
} from '../paginated-surface.ts';
import { positionFromDomPoint } from '../dom-selection.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const NUM = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering';
const STYLES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';
// Format defaults, pinned so the fixture does not take the application defaults for omitted docDefaults.
const FORMAT_DOC_DEFAULTS =
  '<w:docDefaults><w:rPrDefault><w:rPr><w:kern w:val="2"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>';

const NUMBERING =
  `<w:numbering xmlns:w="${W}">` +
  '<w:abstractNum w:abstractNumId="0">' +
  '<w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/>' +
  '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>' +
  '</w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';

function docx(body: string, withNumbering = false): Uint8Array {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        (withNumbering
          ? '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
          : '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
    'word/styles.xml': strToU8(`<w:styles xmlns:w="${W}">${FORMAT_DOC_DEFAULTS}</w:styles>`),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdStyles" Type="${STYLES_REL}" Target="styles.xml"/>` +
        (withNumbering ? `<Relationship Id="rId9" Type="${NUM}" Target="numbering.xml"/>` : '') +
        '</Relationships>'
    ),
  };
  if (withNumbering) files['word/numbering.xml'] = strToU8(NUMBERING);
  return zipSync(files);
}

// The measurer's 6pt/14pt base describes an 11pt run, so these fixtures author `w:sz="22"`
// instead of resolving to the 10pt terminal fallback (see `DEFAULT_RUN_STYLE`). The size is
// on the paragraph MARK as well as the run: `splitParagraph` gives the new empty paragraph
// its own mark, and that mark alone decides the caret height there.
const SZ = '<w:rPr><w:sz w:val="22"/></w:rPr>';
const paragraph = (text: string) =>
  `<w:p><w:pPr>${SZ}</w:pPr><w:r>${SZ}<w:t>${text}</w:t></w:r></w:p>`;
const listItem = (text: string) =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>${SZ}</w:pPr>` +
  `<w:r>${SZ}<w:t>${text}</w:t></w:r></w:p>`;

interface Mounted {
  readonly surface: PaginatedSurface;
  readonly container: HTMLElement;
  readonly pages: HTMLElement;
}

/**
 * Mount ATTACHED and FOCUSED: the caret is only painted while the surface holds focus, and
 * a detached element cannot become `document.activeElement`.
 */
function mount(body: string, withNumbering = false): Mounted {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, docx(body, withNumbering), { scale: 1 });
  if (!opened.ok) throw new Error(opened.reason);
  const pages = container.querySelector<HTMLElement>('.docx-pages')!;
  opened.surface.focus();
  return { surface: opened.surface, container, pages };
}

function putCaret(surface: PaginatedSurface, offset: number, paragraphIndex = 0): void {
  const paragraphId = surface.session.paragraphIds()[paragraphIndex]!;
  surface.setSelection({
    anchor: { paragraphId, offset },
    head: { paragraphId, offset },
  });
}

const caretElement = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('.docx-editor-one-surface__caret');

/** The caret's inline geometry, which is the only geometry it has. */
const geometryOf = (element: HTMLElement) => ({
  left: element.style.left,
  top: element.style.top,
  height: element.style.height,
});

describe('the painted caret', () => {
  test('Enter sizes an empty paragraph caret to the format typing will inherit', () => {
    const { surface, container } = mount(
      '<w:p><w:r><w:rPr><w:sz w:val="72"/><w:b/></w:rPr><w:t>Title</w:t></w:r></w:p>'
    );
    try {
      putCaret(surface, 5);
      const originalHeight = caretElement(container)!.style.height;
      surface.splitParagraph();
      expect(caretElement(container)!.style.height).toBe(originalHeight);
      const emptyPosition = surface.state().selection.head;
      expect(caretAt(surface.layout(), emptyPosition)!.height).toBeCloseTo(
        parseFloat(originalHeight)
      );
      putCaret(surface, 2, 0);
      surface.setSelection({ anchor: emptyPosition, head: emptyPosition });
      expect(surface.formatting().fontSizeHalfPoints).toBe(72);
      expect(surface.formatting().bold).toBe(true);
      expect(caretElement(container)!.style.height).toBe(originalHeight);
      surface.splitParagraph();
      expect(caretElement(container)!.style.height).toBe(originalHeight);
      surface.type('More');
      expect(caretElement(container)!.style.height).toBe(originalHeight);
      surface.splitParagraph();
      surface.setRunProperty('sz', { val: '48' });
      const resizedHeight = caretElement(container)!.style.height;
      expect(parseFloat(resizedHeight)).toBeLessThan(parseFloat(originalHeight));
      surface.type('Smaller');
      expect(caretElement(container)!.style.height).toBe(resizedHeight);
    } finally {
      surface.destroy();
      container.remove();
    }
  });

  test('a pending font size immediately resizes a nonempty caret on the text baseline', () => {
    const { surface, container } = mount(
      '<w:p><w:r><w:rPr><w:sz w:val="72"/></w:rPr><w:t>Large</w:t></w:r></w:p>'
    );
    try {
      putCaret(surface, 5);
      const originalHeight = parseFloat(caretElement(container)!.style.height);
      surface.setRunProperty('sz', { val: '36' });
      const pending = geometryOf(caretElement(container)!);
      expect(parseFloat(pending.height)).toBeCloseTo(originalHeight / 2);
      surface.type('x');
      const typed = geometryOf(caretElement(container)!);
      expect(typed.height).toBe(pending.height);
      expect(typed.top).toBe(pending.top);
    } finally {
      surface.destroy();
      container.remove();
    }
  });

  test('it paints at the geometry layout published, not at a measured one', () => {
    const { surface, container } = mount(paragraph('hello world'));
    putCaret(surface, 6);

    const painted = caretElement(container);
    expect(painted).not.toBeNull();

    const expected = caretAt(surface.layout(), surface.state().selection.head)!;
    expect(expected).not.toBeNull();
    // Scale 1, so points and pixels coincide and the assertion stays about the SOURCE of
    // the numbers rather than about a conversion.
    expect(geometryOf(painted!)).toEqual({
      left: `${expected.x}px`,
      top: `${expected.y}px`,
      height: `${expected.height}px`,
    });
    // Painted into the page CONTENT box, which is the element whose coordinate space
    // `caretAt` answers in.
    expect(painted!.parentElement?.className).toBe('docx-page-content');
    expect(painted!.closest('[data-page-index]')?.getAttribute('data-page-index')).toBe(
      String(expected.pageIndex)
    );
  });

  test('it rescales with the surface without moving the semantic caret', () => {
    const { surface, container } = mount(paragraph('hello world'));
    putCaret(surface, 6);

    expect(setPaginatedSurfaceScale(surface, 2)).toBe(true);

    const expected = caretAt(surface.layout(), surface.state().selection.head)!;
    const painted = caretElement(container)!;
    expect(parseFloat(painted.style.left)).toBeCloseTo(expected.x * 2);
    expect(parseFloat(painted.style.height)).toBeCloseTo(expected.height * 2);
    surface.destroy();
  });

  test('it survives the dark page inversion it is painted inside', () => {
    const { surface, container } = mount(paragraph('hello world'));
    putCaret(surface, 6);
    // `.docx-page-content` is inverted wholesale in dark mode, so a caret painted inside it
    // has to opt out of the inversion the same way images and highlights do. The stylesheet's
    // contrast ring rides through the same inversion as the core, keeping the pair
    // complementary — which is what keeps the caret visible on a dark image, where a solid
    // bar drawn on the picture's leading edge vanished.
    expect(caretElement(container)!.hasAttribute('data-no-color-invert')).toBe(true);
  });

  test('it is the last child of the page content box, so page content cannot paint over it', () => {
    const { surface, container } = mount(paragraph('hello world'));
    putCaret(surface, 6);
    const painted = caretElement(container)!;
    const host = painted.parentElement!;
    expect(host.className).toBe('docx-page-content');
    expect(host.lastElementChild).toBe(painted);
  });

  test('it suppresses the native caret only while it is up', () => {
    const { surface, container, pages } = mount(paragraph('hello world'));
    putCaret(surface, 3);
    expect(pages.style.caretColor).toBe('transparent');

    surface.setSelection({
      anchor: { paragraphId: surface.session.paragraphIds()[0]!, offset: 1 },
      head: { paragraphId: surface.session.paragraphIds()[0]!, offset: 4 },
    });
    expect(caretElement(container)).toBeNull();
    expect(pages.style.caretColor).toBe('');
  });

  test('a geometry read inside a commit paints once, with the post-edit caret', () => {
    const { surface, container, pages } = mount(paragraph('hello') + paragraph('world'));
    // What the review module's snapshot does from its document-change handler: read layout
    // while the commit is still applying, before the surface has installed the new caret.
    const unsubscribe = surface.session.subscribe(() => void surface.layout());
    const removed: string[] = [];
    const removeProperty = pages.style.removeProperty;
    pages.style.removeProperty = (name: string) => {
      removed.push(name);
      return removeProperty.call(pages.style, name);
    };
    try {
      putCaret(surface, 0, 1);
      surface.deleteBackward();
      // Painting from inside the commit mirrored the PRE-edit caret, which named the paragraph
      // the join had just removed: the caret came down, the native one came back, and the
      // commit's own paint put both back up — a full-document style recalculation each way.
      expect(removed).not.toContain('caret-color');
      expect(caretElement(container)).not.toBeNull();
      expect(pages.style.caretColor).toBe('transparent');
      expect(surface.session.paragraphIds()).toHaveLength(1);
    } finally {
      unsubscribe();
      pages.style.removeProperty = removeProperty;
      surface.destroy();
      container.remove();
    }
  });

  test('a commit whose listener throws still paints what a reader inside it published', () => {
    const { surface, container, pages } = mount(paragraph('hello') + paragraph('world'));
    putCaret(surface, 0, 1);
    const unsubscribeReader = surface.session.subscribe(() => void surface.layout());
    const unsubscribeThrower = surface.session.subscribe(() => {
      throw new Error('host handler failed');
    });
    try {
      expect(() => surface.deleteBackward()).toThrow('host handler failed');
      // The reader published the joined paragraph and the commit never reached its own
      // paint; the pages must not keep showing the two paragraphs the model no longer has.
      expect(surface.session.paragraphIds()).toHaveLength(1);
      expect(pages.querySelectorAll('.docx-paragraph-fragment')).toHaveLength(1);
      expect(pages.textContent).toContain('helloworld');
    } finally {
      unsubscribeReader();
      unsubscribeThrower();
      surface.destroy();
      container.remove();
    }
  });

  test('a range selection draws the browser highlight, never an insertion point', () => {
    const { surface, container } = mount(paragraph('hello world'));
    const paragraphId = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 5 },
    });
    expect(caretElement(container)).toBeNull();
  });

  test('it is FURNITURE: a selection endpoint cannot resolve through it', () => {
    const { surface, container, pages } = mount(paragraph('hello world'));
    putCaret(surface, 6);
    const painted = caretElement(container)!;

    // The refusal that matters. Without it a DOM endpoint landing on the caret would map
    // into the adjacent run and every offset after it would come back wrong.
    expect(positionFromDomPoint(painted, 0, pages)).toBeNull();
    expect(painted.getAttribute('contenteditable')).toBe('false');
    expect(painted.getAttribute('aria-hidden')).toBe('true');
    expect(painted.style.pointerEvents).toBe('none');
    expect(painted.style.userSelect).toBe('none');
    // It carries no span identity, so nothing that reads painted text can see it either.
    expect(painted.hasAttribute('data-paragraph-id')).toBe(false);
    expect(painted.hasAttribute('data-start')).toBe(false);
  });

  test('an IME composition gets the native caret back for its duration', () => {
    const { surface, container, pages } = mount(paragraph('hello world'));
    putCaret(surface, 5);
    expect(caretElement(container)).not.toBeNull();

    // `beforeinput` for composed text is not cancelable, so the browser owns the caret
    // while an input method is holding text; a painted one would sit beside the real
    // insertion point and the IME's own candidate window would anchor to nothing.
    pages.dispatchEvent(new Event('compositionstart'));
    expect(caretElement(container)).toBeNull();
    expect(pages.style.caretColor).toBe('');

    pages.dispatchEvent(new Event('compositionend'));
    expect(caretElement(container)).not.toBeNull();
    expect(pages.style.caretColor).toBe('transparent');
  });

  test('it holds steady while it is moving, then lets the blink resume', async () => {
    const { surface, container } = mount(paragraph('hello world'));
    putCaret(surface, 2);
    const painted = caretElement(container)!;
    // The stylesheet owns width, colour and the blink; the element only has to claim them.
    expect(painted.classList.contains('docx-editor-one-surface__caret')).toBe(true);
    // A caret that keeps blinking under an arrow key or a drag disappears mid-gesture.
    expect(painted.classList.contains('docx-editor-one-surface__caret--steady')).toBe(true);

    await Bun.sleep(700);
    expect(painted.classList.contains('docx-editor-one-surface__caret--steady')).toBe(false);
    putCaret(surface, 7);
    expect(painted.classList.contains('docx-editor-one-surface__caret--steady')).toBe(true);
  });

  test('an unfocused surface keeps the native caret and paints nothing', () => {
    const { surface, container, pages } = mount(paragraph('hello world'));
    putCaret(surface, 4);
    expect(caretElement(container)).not.toBeNull();

    const elsewhere = document.createElement('input');
    document.body.append(elsewhere);
    pages.dispatchEvent(new FocusEvent('focusout', { relatedTarget: elsewhere }));
    expect(caretElement(container)).toBeNull();
    expect(pages.style.caretColor).toBe('');
  });

  test('destroying the surface takes the caret and the suppression with it', () => {
    const { surface, container, pages } = mount(paragraph('hello world'));
    putCaret(surface, 2);
    surface.destroy();
    expect(caretElement(container)).toBeNull();
    expect(pages.style.caretColor).toBe('');
  });
});

describe('the caret on an empty paragraph', () => {
  test('a paragraph created by Enter is where the native caret cannot go', () => {
    const { surface, container } = mount(paragraph('hello'));
    putCaret(surface, 5);
    surface.splitParagraph();

    const head = surface.state().selection.head;
    // The point of the whole exercise: the new paragraph has no painted text span, so the
    // browser has no inline box to size an insertion point against and drew none at all.
    const spans = [...container.querySelectorAll('[data-paragraph-id][data-start]')].filter(
      (span) => (span as HTMLElement).dataset.paragraphId === head.paragraphId
    );
    expect(spans).toHaveLength(0);

    // Layout still places the line, so the engine's caret resolves and paints.
    const expected = caretAt(surface.layout(), head);
    expect(expected).not.toBeNull();
    const painted = caretElement(container);
    expect(painted).not.toBeNull();
    expect(geometryOf(painted!)).toEqual({
      left: `${expected!.x}px`,
      top: `${expected!.y}px`,
      height: `${expected!.height}px`,
    });
    // A real cursor, not a zero-height sliver: an empty paragraph's caret is the height of
    // the line its own font would have produced.
    expect(expected!.height).toBeGreaterThan(0);
  });

  test('a new EMPTY LIST ITEM gets one too, and it sits after the marker', () => {
    const { surface, container } = mount(listItem('alpha'), true);
    putCaret(surface, 5);
    surface.splitParagraph();

    const head = surface.state().selection.head;
    const expected = caretAt(surface.layout(), head);
    expect(expected).not.toBeNull();
    const painted = caretElement(container);
    expect(painted).not.toBeNull();
    expect(geometryOf(painted!)).toEqual({
      left: `${expected!.x}px`,
      top: `${expected!.y}px`,
      height: `${expected!.height}px`,
    });
    // The marker is furniture in the hanging indent and contributes no offsets, so the
    // caret belongs at the item's text origin — not at the paragraph box's left edge.
    expect(expected!.x).toBeGreaterThan(0);
  });

  test('a document that opens on an empty paragraph paints a caret at offset zero', () => {
    const { surface, container } = mount('<w:p/>');
    putCaret(surface, 0);
    const expected = caretAt(surface.layout(), surface.state().selection.head);
    expect(expected).not.toBeNull();
    expect(caretElement(container)).not.toBeNull();
  });
});

for (const alignment of ['top', 'center', 'bottom']) {
  test(`Enter and typing keep the caret inside a ${alignment}-aligned cell with hideMark`, () => {
    const { surface, container } = mount(
      '<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr>' +
        '<w:tblGrid><w:gridCol w:w="1200"/></w:tblGrid>' +
        '<w:tr><w:trPr><w:trHeight w:val="20"/></w:trPr>' +
        `<w:tc><w:tcPr><w:vAlign w:val="${alignment}"/><w:hideMark/></w:tcPr>` +
        paragraph('Example') +
        '</w:tc></w:tr><w:tr><w:tc>' +
        paragraph('Next row') +
        '</w:tc></w:tr></w:tbl>'
    );
    try {
      putCaret(surface, 7);
      const check = () => {
        const layout = surface.layout();
        const caret = caretAt(layout, surface.state().selection.head)!;
        const table = layout.pages[caret.pageIndex]!.fragments.find((f) => f.kind === 'table')!;
        if (table.kind !== 'table') throw new Error('Expected table');
        const cell = table.rows[0]!.cells[0]!;
        expect(caret.height).toBeGreaterThan(0);
        expect(caret.y).toBeGreaterThanOrEqual(cell.box.y);
        expect(caret.y + caret.height).toBeLessThanOrEqual(cell.box.y + cell.box.height + 0.001);
        const painted = caretElement(container)!;
        expect(painted).not.toBeNull();
        expect(
          parseFloat(painted.style.top) + parseFloat(painted.style.height)
        ).toBeLessThanOrEqual(cell.box.y + cell.box.height + 0.001);
      };
      for (let index = 0; index < 3; index += 1) {
        surface.splitParagraph();
        check();
      }
      for (const character of 'More text that wraps onto several lines') {
        surface.type(character);
        check();
      }
    } finally {
      surface.destroy();
      container.remove();
    }
  });
}
