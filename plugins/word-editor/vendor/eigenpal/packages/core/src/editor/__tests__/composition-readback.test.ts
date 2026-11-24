// WHAT AN IME WROTE INTO THE PAINTED DOM, READ BACK IN THE MODEL'S OFFSET SPACE.
//
// `beforeinput` for `insertCompositionText` is not cancelable, so composed text unavoidably
// lands in the painted DOM and the readback at `compositionend` is the ONLY route by which it
// reaches the tree. Everything that route cannot see is an edit the user made and the document
// never got.
//
// Three ways it could not see one:
//
//   - The text is not inside a `[data-start]` span. An empty paragraph paints a line holding
//     nothing but a `<br>`, so the browser is handed the LINE as the selection node and
//     composes a bare text node into it. Chinese could not be typed at the start of an empty
//     paragraph at all (#190).
//   - The paragraph is painted MORE THAN ONCE. A shared header or footer repaints the same
//     paragraph ids on every page, so a document-wide scan read a three-page header back as
//     three concatenated copies of itself and then wrote the extra two into the part.
//   - The composition began over a range spanning TWO paragraphs, which the browser replaces
//     with a join. One paragraph's diff cannot express that, so half the edit committed and
//     half did not (#383). Those compositions do not read the painted DOM at all: the
//     finished string arrives on `compositionend` itself, and replacing the still-untouched
//     selection with it is the same call typing over a selection makes.
//
// The other half of the contract is what must NEVER reach the model: a list marker's bullet,
// a tab leader's dots, the revision pilcrow, and a field's painted result are all painted
// inside the paragraph and are not characters the document has.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NUMREL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering';

/** Two Chinese characters, the input the report was written against. */
const COMPOSED = '中文';

const NUMBERING =
  `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0">` +
  '<w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>' +
  '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';

const LIST_ITEM =
  '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr></w:p>';

const CELL =
  '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="dxa"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid>' +
  '<w:tr><w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr><w:p/></w:tc></w:tr></w:tbl>';

const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const PAGE_BREAK = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

function docx(body: string): Uint8Array {
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
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

function headerDocx(header: string, body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId10" Type="${R}/header" Target="header1.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}` +
        '<w:sectPr><w:headerReference w:type="default" r:id="rId10"/></w:sectPr></w:body></w:document>'
    ),
    'word/header1.xml': strToU8(`<w:hdr xmlns:w="${W}">${header}</w:hdr>`),
  });
}

/** The surface `withSurface` mounted, so a composition helper can land what it queued. */
let mounted: PaginatedSurface | null = null;

function withSurface(
  bytes: Uint8Array,
  run: (surface: PaginatedSurface, container: HTMLElement) => void
): void {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, bytes, { scale: 1 });
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
  surface.setSelection({
    anchor: { paragraphId, offset },
    head: { paragraphId, offset },
  });
}

/**
 * A `compositionend` carrying the finished composed string, which is where a browser puts it.
 *
 * Assigned rather than passed to the constructor: happy-dom accepts `data` in the init dict
 * and then reports `undefined`, so a test built the ordinary way would assert nothing.
 */
function compositionEnd(data: string): CompositionEvent {
  const event = new CompositionEvent('compositionend', { bubbles: true });
  Object.defineProperty(event, 'data', { value: data, configurable: true });
  return event;
}

/**
 * What the browser does for a composition the surface could not intercept: it writes the
 * painted DOM itself, and only then says it is finished.
 *
 * `write` receives the painted copy the caret is in — the ACTIVE header/footer when one is
 * open, which is the one copy an IME can reach.
 */
function compose(container: HTMLElement, write: (scope: Element) => void): void {
  const pages = container.querySelector('.docx-pages')!;
  pages.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  write(container.querySelector('[data-docx-hf-active]') ?? pages);
  pages.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  // A plain composed insertion commits on a later task, as typed text does; the flush
  // lands it, as any later edit or read would.
  mounted?.flushPendingInput();
}

/** The painted line of a paragraph — the node an empty paragraph hands the browser. */
function lineOf(scope: Element, paragraphId: string): HTMLElement {
  for (const element of scope.querySelectorAll('[data-paragraph-id][data-line-id]')) {
    if ((element as HTMLElement).dataset.paragraphId === paragraphId) return element as HTMLElement;
  }
  throw new Error(`no painted line for ${paragraphId}`);
}

/** The IME composes a bare text node at the head of the line, which is where the caret was. */
function composeIntoLine(scope: Element, paragraphId: string, text: string): void {
  const line = lineOf(scope, paragraphId);
  line.insertBefore(document.createTextNode(text), line.firstChild);
}

/**
 * Rewrite what a paragraph paints, the way a browser rewrites it during a composition.
 *
 * A paragraph is more than one span whenever it holds more than one run or breaks over more
 * than one line, so the whole text goes into the first and the rest are emptied.
 */
function repaintParagraphAs(scope: Element, paragraphId: string, text: string): void {
  const spans = [...scope.querySelectorAll('[data-paragraph-id][data-start]')].filter(
    (element) => (element as HTMLElement).dataset.paragraphId === paragraphId
  ) as HTMLElement[];
  if (spans.length === 0) throw new Error(`no painted span for ${paragraphId}`);
  spans[0]!.textContent = text;
  for (const extra of spans.slice(1)) extra.textContent = '';
}

describe('#190 composition at offset 0 of an empty paragraph', () => {
  test('the composed text is committed', () => {
    withSurface(docx('<w:p/>'), (surface, container) => {
      const id = surface.session.paragraphIds()[0]!;
      caretAt(surface, id, 0);
      compose(container, (scope) => composeIntoLine(scope, id, COMPOSED));
      expect(surface.state().lastRejection).toBeNull();
      expect(surface.session.bodyText()).toBe(COMPOSED);
      // The caret lands after the composed text, not back at the paragraph start.
      expect(surface.state().selection.head).toEqual({ paragraphId: id, offset: COMPOSED.length });
    });
  });

  test('an empty paragraph AFTER one with text still composes into itself', () => {
    // The readback addresses one paragraph, but a document-wide scan for its spans found the
    // neighbours' too. The empty one has none, which is exactly the case that used to fall
    // through to "nothing painted, nothing to commit".
    withSurface(docx(`${p('alpha')}<w:p/>${p('beta')}`), (surface, container) => {
      const id = surface.session.paragraphIds()[1]!;
      caretAt(surface, id, 0);
      compose(container, (scope) => composeIntoLine(scope, id, COMPOSED));
      expect(surface.session.bodyText()).toBe(`alpha\n${COMPOSED}\nbeta`);
    });
  });

  test('an empty paragraph in a TABLE CELL composes like any other', () => {
    withSurface(docx(CELL), (surface, container) => {
      const id = surface.session.paragraphIds()[0]!;
      caretAt(surface, id, 0);
      compose(container, (scope) => composeIntoLine(scope, id, COMPOSED));
      expect(surface.state().lastRejection).toBeNull();
      // The body ends with a table, so it reads an empty paragraph after it.
      expect(surface.session.bodyText()).toBe(`${COMPOSED}\n`);
    });
  });

  test('a composition that writes nothing commits nothing', () => {
    withSurface(docx('<w:p/>'), (surface) => {
      const id = surface.session.paragraphIds()[0]!;
      caretAt(surface, id, 0);
      const container = document.querySelector('.docx-pages')!;
      container.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      container.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
      expect(surface.session.bodyText()).toBe('');
    });
  });
});

describe('painted furniture is never composed into the document', () => {
  test('an empty LIST item commits the composed text without its marker', () => {
    // The marker is painted inside the paragraph fragment and carries the numbering glyph.
    // Reading the fragment's text content wholesale would have written "1." into the list
    // item as real characters — and the next repaint would number it "2." beside them.
    withSurface(docx(LIST_ITEM), (surface, container) => {
      const id = surface.session.paragraphIds()[0]!;
      caretAt(surface, id, 0);
      const marker = container.querySelector('.docx-list-marker');
      expect(marker?.textContent).toBe('1.');
      compose(container, (scope) => composeIntoLine(scope, id, COMPOSED));
      expect(surface.session.bodyText()).toBe(COMPOSED);
    });
  });
});

describe('a paragraph painted on more than one page', () => {
  test('a shared header reads back ONE copy, not one per page', () => {
    withSurface(
      headerDocx(p('HDR'), p('one') + PAGE_BREAK + p('two') + PAGE_BREAK + p('three')),
      (surface, container) => {
        expect(container.querySelectorAll('.docx-page').length).toBe(3);
        expect(surface.enterHeaderFooter({ rId: 'rId10' })).toBe(true);
        const scope = { kind: 'headerFooter', rId: 'rId10' } as const;
        const id = surface.session.paragraphIdsIn(scope)[0]!;
        caretAt(surface, id, 3);
        compose(container, (active) => {
          const span = [...active.querySelectorAll('[data-paragraph-id][data-start]')].find(
            (element) => (element as HTMLElement).dataset.paragraphId === id
          ) as HTMLElement;
          span.textContent = `HDR${COMPOSED}`;
        });
        expect(surface.state().lastRejection).toBeNull();
        expect(surface.session.storyText(scope)).toBe(`HDR${COMPOSED}`);
      }
    );
  });

  test('an EMPTY shared header paragraph composes into itself once', () => {
    withSurface(headerDocx('<w:p/>', p('one') + PAGE_BREAK + p('two')), (surface, container) => {
      expect(surface.enterHeaderFooter({ rId: 'rId10' })).toBe(true);
      const scope = { kind: 'headerFooter', rId: 'rId10' } as const;
      const id = surface.session.paragraphIdsIn(scope)[0]!;
      caretAt(surface, id, 0);
      compose(container, (active) => composeIntoLine(active, id, COMPOSED));
      expect(surface.state().lastRejection).toBeNull();
      expect(surface.session.storyText(scope)).toBe(COMPOSED);
    });
  });
});

describe('the ordinary case still holds', () => {
  test('composing inside an existing run commits the difference', () => {
    withSurface(docx(p('abc')), (surface, container) => {
      const id = surface.session.paragraphIds()[0]!;
      caretAt(surface, id, 3);
      compose(container, (scope) => {
        const span = [...scope.querySelectorAll('[data-paragraph-id][data-start]')].find(
          (element) => (element as HTMLElement).dataset.paragraphId === id
        ) as HTMLElement;
        span.textContent = `abc${COMPOSED}`;
      });
      expect(surface.session.bodyText()).toBe(`abc${COMPOSED}`);
    });
  });
});

describe('#383 a composition begun over a range spanning two paragraphs', () => {
  /** Drive a composition whose text the browser reports on the event, as browsers do. */
  function composeOverRange(container: HTMLElement, data: string): void {
    const pages = container.querySelector('.docx-pages')!;
    pages.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    pages.dispatchEvent(compositionEnd(data));
  }

  /** Select from offset 2 of the first paragraph through offset 2 of the second. */
  function selectAcross(surface: PaginatedSurface): void {
    const [first, second] = surface.session.paragraphIds();
    surface.setSelection({
      anchor: { paragraphId: first!, offset: 2 },
      head: { paragraphId: second!, offset: 2 },
    });
  }

  const TWO = `${p('alpha')}${p('beta')}`;

  test('replaces the whole range, in one transaction', () => {
    // Reconciling the head paragraph alone committed `beta` -> `ta` and left `alpha`
    // untouched, so the document matched neither what the user had nor what the screen
    // showed, and the composed characters went with the next repaint.
    withSurface(docx(TWO), (surface, container) => {
      selectAcross(surface);
      composeOverRange(container, COMPOSED);
      expect(surface.state().lastRejection).toBeNull();
      expect(surface.session.bodyText()).toBe(`al${COMPOSED}ta`);
    });
  });

  test('and it is ONE undo, like typing over the same range', () => {
    // Deleting the range at compositionstart put it OUTSIDE the composition's own history
    // entry, so the first undo landed on `alta` — a document the user never asked for.
    withSurface(docx(TWO), (surface, container) => {
      selectAcross(surface);
      composeOverRange(container, COMPOSED);
      surface.undo();
      expect(surface.session.bodyText()).toBe('alpha\nbeta');
    });
  });

  test('nothing is touched at compositionstart', () => {
    // The tempting fix deletes the range there. `commit` may DEFER its paint, so the browser
    // would still hold the two-paragraph selection on return, and the paint would then land
    // mid-composition on the very nodes the IME is composing into.
    withSurface(docx(TWO), (surface, container) => {
      selectAcross(surface);
      const pages = container.querySelector('.docx-pages')!;
      pages.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      expect(surface.session.bodyText()).toBe('alpha\nbeta');
      pages.dispatchEvent(compositionEnd(COMPOSED));
    });
  });

  test('an abandoned composition leaves the range alone', () => {
    // Escape, a click away, an app switch: `compositionend` arrives with no text. Deleting
    // the range up front destroyed the selection for every one of those.
    withSurface(docx(TWO), (surface, container) => {
      selectAcross(surface);
      composeOverRange(container, '');
      expect(surface.session.bodyText()).toBe('alpha\nbeta');
    });
  });

  test('a composition that changes nothing does not leave its text on the page', () => {
    // An unchanged layout repaints nothing by design, so the browser's characters would stay
    // on screen — and in a document nobody can edit, no later pass would ever remove them.
    withSurface(docx(TWO), (surface, container) => {
      surface.setEditingMode('view');
      const [first] = surface.session.paragraphIds();
      selectAcross(surface);
      const pages = container.querySelector('.docx-pages')!;
      pages.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      // The browser writes into the page whatever the model does.
      repaintParagraphAs(container, first!, `al${COMPOSED}`);
      pages.dispatchEvent(compositionEnd(COMPOSED));
      expect(surface.session.bodyText()).toBe('alpha\nbeta');
      expect(container.textContent).not.toContain(COMPOSED);
    });
  });

  test('a same-paragraph range is still left to the readback', () => {
    // That lane keeps suggesting mode's rule that a deletion holds on to the characters it
    // strikes and the replacement lands after them.
    withSurface(docx(p('alpha beta')), (surface, container) => {
      const id = surface.session.paragraphIds()[0]!;
      surface.setSelection({
        anchor: { paragraphId: id, offset: 0 },
        head: { paragraphId: id, offset: 5 },
      });
      const pages = container.querySelector('.docx-pages')!;
      pages.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      expect(surface.session.bodyText()).toBe('alpha beta');
      repaintParagraphAs(container, id, `${COMPOSED} beta`);
      pages.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
      expect(surface.session.bodyText()).toBe(`${COMPOSED} beta`);
    });
  });
});

// AN ARMED FORMAT SURVIVES A COMPOSED REPLACEMENT (#463).
//
// The IME readback lands a replacement at `replacementOffset(from, to)`, which relocates
// past struck words and subtracts this author's own retracted insertion. The armed caret
// format used to relocate by `positionPastDeletion` alone, so whenever the composition
// REPLACED anything — which is how reconversion and kana-to-kanji commits arrive — the two
// positions disagreed by construction and the armed format silently dropped.
describe('#463 an armed format rides a composed replacement', () => {
  function withAuthoredSurface(
    bytes: Uint8Array,
    mode: 'edit' | 'suggest',
    run: (surface: PaginatedSurface, container: HTMLElement) => void
  ): void {
    const container = document.createElement('div');
    document.body.append(container);
    const opened = mountPaginatedSurface(container, bytes, { scale: 1, author: 'Ada Lovelace' });
    if (!opened.ok) throw new Error(opened.reason);
    try {
      opened.surface.setEditingMode(mode);
      run(opened.surface, container);
    } finally {
      opened.surface.destroy();
      container.remove();
      document.getSelection()?.removeAllRanges();
    }
  }

  test('in edit mode, bold armed at the caret styles the composed replacement', () => {
    withAuthoredSurface(docx(p('abc')), 'edit', (surface, container) => {
      const id = surface.session.paragraphIds()[0]!;
      caretAt(surface, id, 3);
      surface.toggleRunProperty('b');
      compose(container, (scope) => repaintParagraphAs(scope, id, 'X'));
      expect(surface.state().lastRejection).toBeNull();
      expect(surface.session.bodyText()).toBe('X');
      const xml = serializeOoxmlPart(surface.session.part());
      expect(xml).toMatch(/<w:r><w:rPr><w:b\/><\/w:rPr><w:t[^>]*>X<\/w:t><\/w:r>/);
    });
  });

  test('in suggesting mode, replacing your OWN pending text keeps the armed format', () => {
    withAuthoredSurface(docx('<w:p/>'), 'suggest', (surface, container) => {
      const id = surface.session.paragraphIds()[0]!;
      caretAt(surface, id, 0);
      surface.type('abc');
      // Land the buffered burst so the composition diffs against the committed model.
      surface.layout();
      surface.toggleRunProperty('b');
      compose(container, (scope) => repaintParagraphAs(scope, id, 'X'));
      expect(surface.state().lastRejection).toBeNull();
      // The author's own pending insertion retracted; the composed text replaced it.
      expect(surface.session.bodyText()).toBe('X');
      const xml = serializeOoxmlPart(surface.session.part());
      expect(xml).toMatch(
        /<w:ins[^>]*><w:r><w:rPr><w:b\/><\/w:rPr><w:t[^>]*>X<\/w:t><\/w:r><\/w:ins>/
      );
      expect(xml).not.toContain('abc');
    });
  });
});
