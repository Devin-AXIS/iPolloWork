// A COMPOSITION MUST NOT DESTROY WHAT IT DID NOT TOUCH.
//
// The IME readback diffs the painted text against the paragraph's model text and commits the
// difference. So anything the model holds that the page does not show as editable text is a
// character the diff will explain by deleting it — and anything the page shows that the model
// does not hold is a character the diff will write in.
//
// Both halves cost documents, silently, on a keystroke nobody would connect to the damage:
//
//   - An inline drawing occupies one UTF-16 unit and publishes no span; it is painted BESIDE
//     the text, not as it. A `w:vanish` run advances offsets and paints nothing at all. Each
//     leaves a hole between one span's model end and the next one's start, and a hole read as
//     absent reads as deleted.
//   - A drawing that has not resolved paints a placeholder card whose label says "Loading
//     image". The card is only `aria-hidden` when the drawing has NO alt text, so a `.docx`
//     supplying `wp:docPr/@descr` put a UI string into the paragraph.
//   - A paragraph the page repeats — a shared header, a `w:tblHeader` row, a twice-referenced
//     footnote — was read back once per copy and joined.
//   - A resolved display mode lays a mark-deleted paragraph out on the same line as the
//     survivor that absorbed it, and stamps the line with only ONE of the two ids.
//
// The rule underneath all of them: this readback is the mirror of `paragraphTextFromLayout`,
// which builds the model side of the same diff. Where the browser has not written, the two
// must agree exactly.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { paintedTextOf } from '../surface-input.ts';
import { paragraphTextFromLayout } from '../../layout/semantic-interaction.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const IMG = `${R}/image`;
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const DRAW_NS = `xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"`;

const COMPOSED = '中文';

const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (c) => c.charCodeAt(0)
);

function types(...overrides: string[]): string {
  return (
    `<Types xmlns="${CT}">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="png" ContentType="image/png"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    overrides.join('') +
    '</Types>'
  );
}

const ROOT_RELS = `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`;

/** The surface `withSurface` mounted, so a composition helper can land what it queued. */
let mounted: PaginatedSurface | null = null;

function withSurface(
  bytes: Uint8Array,
  run: (surface: PaginatedSurface, container: HTMLElement) => void,
  options: { revisionDisplayMode?: 'proposed' } = {}
): void {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, bytes, { scale: 1, ...options });
  if (!opened.ok) throw new Error(opened.reason);
  mounted = opened.surface;
  try {
    run(opened.surface, container);
  } finally {
    mounted = null;
    opened.surface.destroy();
    container.remove();
    document.getSelection()?.removeAllRanges();
  }
}

function caretAt(surface: PaginatedSurface, paragraphId: string, offset: number): void {
  surface.setSelection({ anchor: { paragraphId, offset }, head: { paragraphId, offset } });
}

/** Every painted span of one paragraph, in document order. */
function spansOf(root: ParentNode, paragraphId: string): HTMLElement[] {
  return [...root.querySelectorAll('[data-paragraph-id][data-start]')].filter(
    (element) => (element as HTMLElement).dataset.paragraphId === paragraphId
  ) as HTMLElement[];
}

/**
 * Compose into one painted span, leaving the caret in it.
 *
 * The caret is what says WHICH painted copy was written, for a paragraph the page repeats —
 * the IME leaves it in the text it just committed, so the readback asks the same question.
 */
function composeInto(container: HTMLElement, span: HTMLElement, text: string): void {
  const pages = container.querySelector('.docx-pages')!;
  pages.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  span.textContent = text;
  const range = document.createRange();
  range.selectNodeContents(span);
  range.collapse(false);
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  pages.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  // A plain composed insertion commits on a later task, as typed text does; the flush
  // lands it, as any later edit or read would.
  mounted?.flushPendingInput();
}

// ---------------------------------------------------------------- unpainted model offsets

const INLINE_PICTURE =
  '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
  '<wp:extent cx="228600" cy="114300"/><wp:docPr id="1" name="pic1" descr="ALTTEXT"/>' +
  `<a:graphic><a:graphicData uri="${PIC}"><pic:pic>` +
  '<pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
  '<pic:blipFill><a:blip r:embed="rIdImg"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
  '<pic:spPr><a:xfrm><a:ext cx="228600" cy="114300"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>' +
  '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';

function pictureDocx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(types()),
    '_rels/.rels': strToU8(ROOT_RELS),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdImg" Type="${IMG}" Target="media/image1.png"/></Relationships>`
    ),
    'word/media/image1.png': PNG_1X1,
    'word/document.xml': strToU8(
      `<w:document ${DRAW_NS}><w:body>` +
        `<w:p>${INLINE_PICTURE}<w:r><w:t xml:space="preserve">abc</w:t></w:r></w:p>` +
        '</w:body></w:document>'
    ),
  });
}

describe('an offset the page does not paint is not an offset the browser deleted', () => {
  test('an inline drawing survives a composition elsewhere in its paragraph', () => {
    // The drawing occupies model offset 0 and publishes no span of its own, so the readback
    // saw "abc" where the model holds "￼abc" — and the diff deleted the image to explain
    // the difference. One composition, and the picture was gone with no way to connect the
    // two.
    withSurface(pictureDocx(), (surface, container) => {
      const id = surface.session.paragraphIds()[0]!;
      expect(surface.session.bodyText()).toBe('￼abc');
      caretAt(surface, id, 4);
      composeInto(container, spansOf(container, id)[0]!, `abc${COMPOSED}`);
      expect(surface.state().lastRejection).toBeNull();
      expect(surface.session.bodyText()).toBe(`￼abc${COMPOSED}`);
      expect(container.querySelector('[data-drawing-node-id]')).not.toBeNull();
    });
  });

  test("a drawing's placeholder label is never composed into the document", () => {
    // `applyAccessibility` marks a drawing `aria-hidden` only when it has NO alt text; with
    // `descr` it gets `aria-label` instead. The pending/refused card paints a real label
    // ("Loading image") inside the LINE, so a file supplying alt text could put a string of
    // its own choosing into the paragraph on the reader's next composition.
    withSurface(pictureDocx(), (surface, container) => {
      const card = container.querySelector('[data-drawing-node-id]')!;
      expect(card.getAttribute('aria-hidden')).toBeNull();
      expect(card.textContent).not.toBe('');
      expect(card.closest('[data-line-id]')).not.toBeNull();

      const id = surface.session.paragraphIds()[0]!;
      caretAt(surface, id, 4);
      composeInto(container, spansOf(container, id)[0]!, `abc${COMPOSED}`);
      expect(surface.session.bodyText()).not.toContain(card.textContent!);
    });
  });

  test('a w:vanish hidden run survives a composition elsewhere in its paragraph', () => {
    const body =
      '<w:p><w:r><w:t xml:space="preserve">abc</w:t></w:r>' +
      '<w:r><w:rPr><w:vanish/></w:rPr><w:t xml:space="preserve">XYZ</w:t></w:r>' +
      '<w:r><w:t xml:space="preserve">def</w:t></w:r></w:p>';
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(types()),
      '_rels/.rels': strToU8(ROOT_RELS),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
      ),
    });
    withSurface(bytes, (surface, container) => {
      const id = surface.session.paragraphIds()[0]!;
      expect(surface.session.bodyText()).toBe('abcXYZdef');
      // Hidden text is not measured and not painted, so the spans jump 3 -> 6.
      expect(spansOf(container, id).map((span) => span.dataset.start)).toEqual(['0', '6']);
      caretAt(surface, id, 3);
      composeInto(container, spansOf(container, id)[0]!, `abc${COMPOSED}`);
      expect(surface.session.bodyText()).toBe(`abc${COMPOSED}XYZdef`);
    });
  });
});

// ------------------------------------------------------------------ a paragraph painted twice

const headerCell = (text: string, repeats: boolean) =>
  '<w:tr>' +
  (repeats ? '<w:trPr><w:tblHeader/></w:trPr>' : '') +
  '<w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr>' +
  `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p></w:tc></w:tr>`;

function repeatingHeaderDocx(): Uint8Array {
  const rows = [headerCell('HEAD', true)];
  for (let index = 0; index < 90; index += 1) rows.push(headerCell(`row ${index}`, false));
  const table =
    '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="dxa"/></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid>' +
    rows.join('') +
    '</w:tbl>';
  return zipSync({
    '[Content_Types].xml': strToU8(types()),
    '_rels/.rels': strToU8(ROOT_RELS),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${table}</w:body></w:document>`
    ),
  });
}

const noteReference =
  '<w:p><w:r><w:t xml:space="preserve">see </w:t></w:r>' +
  '<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr>' +
  '<w:footnoteReference w:id="1"/></w:r></w:p>';

function twiceReferencedNoteDocx(): Uint8Array {
  const separators =
    '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
    '<w:footnote w:type="continuationSeparator" w:id="0">' +
    '<w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>';
  return zipSync({
    '[Content_Types].xml': strToU8(
      types(
        '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>'
      )
    ),
    '_rels/.rels': strToU8(ROOT_RELS),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId20" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${noteReference}${noteReference}</w:body></w:document>`
    ),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}">${separators}` +
        '<w:footnote w:id="1"><w:p><w:r><w:t xml:space="preserve">Note text</w:t></w:r></w:p></w:footnote>' +
        '</w:footnotes>'
    ),
  });
}

describe('a paragraph the page repeats is read back ONCE, from the copy the caret is in', () => {
  test('a repeating w:tblHeader row', () => {
    // The row repeats on every page the table crosses, and no active-scope attribute tells the
    // copies apart — each is ordinary body content on a different sheet. Joining them stored
    // "HEAD中文HEADHEAD" in a cell the user typed two characters into.
    withSurface(repeatingHeaderDocx(), (surface, container) => {
      const id = surface.session.paragraphIds()[0]!;
      const copies = spansOf(container, id);
      expect(container.querySelectorAll('.docx-page').length).toBeGreaterThan(1);
      expect(copies.length).toBeGreaterThan(1);
      caretAt(surface, id, 4);
      // The IME writes into the copy the caret is in, which is not the first one on the page.
      composeInto(container, copies[copies.length - 1]!, `HEAD${COMPOSED}`);
      expect(surface.state().lastRejection).toBeNull();
      expect(surface.session.bodyText().startsWith(`HEAD${COMPOSED}\n`)).toBe(true);
    });
  });

  test('a footnote referenced twice, whose copies share ONE sheet', () => {
    // Both copies are on the same page, so the sheet cannot tell them apart and the container
    // holding the caret has to be asked directly. Getting that wrong does not duplicate the
    // text — it drops the composition, which is just as lost.
    withSurface(twiceReferencedNoteDocx(), (surface, container) => {
      const scope = { kind: 'notesPart', noteKind: 'footnote' } as const;
      expect(surface.enterNote('footnote:1')).toBe(true);
      const id = surface.session.paragraphIdsIn(scope)[0]!;
      const copies = spansOf(container, id);
      expect(copies.length).toBeGreaterThan(2);
      caretAt(surface, id, 9);
      composeInto(container, copies[copies.length - 1]!, `text${COMPOSED}`);
      expect(surface.state().lastRejection).toBeNull();
      expect(surface.session.storyText(scope)).toBe(`Note text${COMPOSED}`);
    });
  });
});

// --------------------------------------------------------------- resolved-display join lines

const LONG = `${'The quick brown fox jumps over the lazy dog. '.repeat(8)}END`;

/** A paragraph whose MARK is deleted folds into the one after it in a resolved view. */
const absorbed = (text: string) =>
  '<w:p><w:pPr><w:rPr><w:del w:id="1" w:author="A" w:date="2026-01-01T00:00:00Z"/></w:rPr></w:pPr>' +
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

function mergedDocx(): Uint8Array {
  const body =
    absorbed('AA ') +
    absorbed(LONG) +
    '<w:p><w:r><w:t xml:space="preserve">SURVIVOR</w:t></w:r></w:p>';
  return zipSync({
    '[Content_Types].xml': strToU8(types()),
    '_rels/.rels': strToU8(ROOT_RELS),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

describe('a paragraph absorbed into another in a resolved view', () => {
  test('reads back whole, though it owns no container for the line it starts in', () => {
    // The line is stamped with its FIRST span's paragraph and the fragment with the
    // survivor's id, so a member whose text begins mid-line has spans inside a container
    // belonging to someone else. Reading containers alone lost 81 of its 363 characters, and
    // the diff then took the composition as licence to delete them.
    withSurface(
      mergedDocx(),
      (surface, container) => {
        const id = surface.session.paragraphIds()[1]!;
        const model = paragraphTextFromLayout(surface.layout(), id);
        expect(model.length).toBe(LONG.length);
        expect(paintedTextOf(container.querySelector('.docx-pages')!, id, model, null)).toBe(model);
      },
      { revisionDisplayMode: 'proposed' }
    );
  });

  test('and a composition inside it adds text rather than truncating it', () => {
    withSurface(
      mergedDocx(),
      (surface, container) => {
        const id = surface.session.paragraphIds()[1]!;
        const before = surface.session.bodyText();
        caretAt(surface, id, 0);
        const first = spansOf(container, id).find((span) => span.dataset.start === '0')!;
        composeInto(container, first, `${COMPOSED}${first.textContent}`);
        expect(surface.state().lastRejection).toBeNull();
        expect(surface.session.bodyText().length).toBe(before.length + COMPOSED.length);
      },
      { revisionDisplayMode: 'proposed' }
    );
  });
});

/** A minimal painted paragraph: one fragment, one line, one span over "alpha beta". */
function paintedParagraph(paragraphId: string): HTMLElement {
  const root = document.createElement('div');
  const fragment = document.createElement('div');
  fragment.className = 'docx-paragraph-fragment';
  fragment.dataset.paragraphId = paragraphId;
  fragment.dataset.fragmentIndex = '0';
  const line = document.createElement('div');
  line.className = 'docx-line';
  line.dataset.lineId = 'line-1';
  line.dataset.paragraphId = paragraphId;
  const run = document.createElement('span');
  run.dataset.paragraphId = paragraphId;
  run.dataset.start = '0';
  run.dataset.end = '10';
  run.textContent = 'alpha beta';
  line.append(run);
  fragment.append(line);
  root.append(fragment);
  return root;
}

describe('a story painted inside another paragraph is not that paragraph', () => {
  test('an inline TEXT BOX inside the line contributes nothing to the paragraph', () => {
    // A text box's story is painted INSIDE the line, so another part's words sit in the
    // middle of this paragraph's subtree. The readback walks that subtree in DOM order to
    // find text an IME wrote outside any span — and would otherwise have taken the whole
    // box with it, inserting it into the paragraph on the next composition.
    const root = paintedParagraph('p1');
    const line = root.querySelector('[data-line-id="line-1"]')!;

    const drawing = document.createElement('div');
    drawing.className = 'docx-drawing docx-drawing-textbox';
    drawing.dataset.drawingNodeId = 'd1';
    // `paintTextboxStory` marks the box inert and strips `data-paragraph-id` off the story's
    // own fragments, so its spans publish a range that belongs to no paragraph on this page.
    drawing.setAttribute('contenteditable', 'false');
    const content = document.createElement('div');
    content.className = 'docx-drawing-textbox-content';
    const storyRun = document.createElement('span');
    storyRun.dataset.start = '0';
    storyRun.dataset.end = '9';
    storyRun.textContent = 'BOXED ...';
    const stray = document.createTextNode('loose');
    content.append(storyRun, stray);
    drawing.append(content);
    line.append(drawing);

    expect(paintedTextOf(root, 'p1', 'alpha beta')).toBe('alpha beta');
  });
});
