// EVERY WRITE LANE OBEYS THE SAME RULES.
//
// The surface has more than one way into the tree — typing, paste, the IME readback, the
// structural ops — and each one that grew its own path to the store drifted from the rules
// the others enforce. This file pins the shared ones per lane: a paragraph breaks at the
// caret whatever wraps it, a story that is not the body can still lose a block, composed
// text is attributed and refused like typed text, and a paste proposes its breaks as well as
// its words.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { serializeOoxmlPart, type OoxmlNode } from '@docx-editor.dev/core/store';

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
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

function withSurface(
  body: string,
  run: (surface: PaginatedSurface, container: HTMLElement) => void,
  opts: { author?: string; mode?: 'edit' | 'suggest' } = {}
): void {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, docx(body), {
    scale: 1,
    ...(opts.author ? { author: opts.author } : {}),
  });
  if (!opened.ok) throw new Error(opened.reason);
  try {
    if (opts.mode === 'suggest') opened.surface.setEditingMode('suggest');
    run(opened.surface, container);
  } finally {
    opened.surface.destroy();
    container.remove();
    document.getSelection()?.removeAllRanges();
  }
}

function paragraphTexts(surface: PaginatedSurface): string[] {
  const out: string[] = [];
  const collect = (n: OoxmlNode, into: string[]): void => {
    if (n.kind === 'textValue') {
      into.push(n.value);
      return;
    }
    for (const c of n.children) collect(c, into);
  };
  const walk = (n: OoxmlNode): void => {
    if (n.kind === 'textValue') return;
    if (n.kind === 'paragraph') {
      const parts: string[] = [];
      collect(n, parts);
      out.push(parts.join(''));
      return;
    }
    for (const c of n.children) walk(c);
  };
  walk(surface.session.part().root);
  return out;
}

function caretTo(s: PaginatedSurface, i: number, offset: number): void {
  const paragraphId = s.session.paragraphIds()[i]!;
  s.setSelection({ anchor: { paragraphId, offset }, head: { paragraphId, offset } });
}

const TRACKED_PARAGRAPH =
  '<w:p><w:r><w:t xml:space="preserve">Hello</w:t></w:r>' +
  '<w:ins w:id="1" w:author="Grace Hopper" w:date="2026-01-01T00:00:00Z">' +
  '<w:r><w:t xml:space="preserve">onetwo</w:t></w:r></w:ins>' +
  '<w:r><w:t xml:space="preserve"> World</w:t></w:r></w:p>';

describe('#348 Enter inside a tracked insertion', () => {
  test('breaks at the caret, and both halves keep the attribution', () => {
    withSurface(TRACKED_PARAGRAPH, (surface) => {
      caretTo(surface, 0, 8);
      surface.splitParagraph();
      expect(surface.state().lastRejection).toBeNull();
      expect(paragraphTexts(surface)).toEqual(['Helloone', 'two World']);
      const xml = serializeOoxmlPart(surface.session.part());
      expect(xml).toMatch(/<w:ins[^>]*w:author="Grace Hopper"[^>]*><w:r><w:t[^>]*>one</);
      expect(xml).toMatch(/<w:ins[^>]*w:author="Grace Hopper"[^>]*><w:r><w:t[^>]*>two</);
    });
  });

  test('and the same in suggesting mode over your own words', () => {
    withSurface(
      p('Hello World'),
      (surface) => {
        caretTo(surface, 0, 5);
        surface.type('onetwo');
        caretTo(surface, 0, 8);
        surface.splitParagraph();
        expect(paragraphTexts(surface)).toEqual(['Helloone', 'two World']);
      },
      { author: 'Ada Lovelace', mode: 'suggest' }
    );
  });

  test('control: an untracked paragraph still breaks at the caret', () => {
    withSurface(p('Helloonetwo World'), (surface) => {
      caretTo(surface, 0, 8);
      surface.splitParagraph();
      expect(paragraphTexts(surface)).toEqual(['Helloone', 'two World']);
    });
  });
});

const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const TABLE =
  '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="dxa"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid>' +
  '<w:tr><w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr>' +
  '<w:p><w:r><w:t>CELL</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';

function headerDocx(headerContent: string): Uint8Array {
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
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${p('body text')}` +
        '<w:sectPr><w:headerReference w:type="default" r:id="rId10"/></w:sectPr></w:body></w:document>'
    ),
    'word/header1.xml': strToU8(`<w:hdr xmlns:w="${W}">${headerContent}</w:hdr>`),
  });
}

describe('#344 deleteBlock inside a header story', () => {
  test('a table in the header can be removed', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const opened = mountPaginatedSurface(container, headerDocx(`${TABLE}${p('AFTER')}`), {
      scale: 1,
    });
    if (!opened.ok) throw new Error(opened.reason);
    const surface = opened.surface;
    try {
      expect(surface.enterHeaderFooter({ rId: 'rId10' })).toBe(true);
      const scope = { kind: 'headerFooter', rId: 'rId10' } as const;
      expect(surface.session.storyText(scope)).toBe('CELL\nAFTER');
      const ids = surface.session.paragraphIdsIn(scope);
      surface.setSelection({
        anchor: { paragraphId: ids[0]!, offset: 0 },
        head: { paragraphId: ids[1]!, offset: 5 },
      });
      surface.deleteSelection();
      expect(surface.state().lastRejection).toBeNull();
      expect(surface.session.storyText(scope)).toBe('');
    } finally {
      surface.destroy();
      container.remove();
    }
  });
});

/** What the browser does during a composition: it writes the painted spans itself. */
function compose(container: HTMLElement, paragraphId: string, paintedAfter: string): void {
  const pages = container.querySelector('.docx-pages')!;
  pages.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  const spans = [...container.querySelectorAll('[data-paragraph-id][data-start]')].filter(
    (span) => (span as HTMLElement).dataset.paragraphId === paragraphId
  ) as HTMLElement[];
  if (spans.length === 0) throw new Error(`no painted span for ${paragraphId}`);
  spans[0]!.textContent = paintedAfter;
  for (const extra of spans.slice(1)) extra.textContent = '';
  pages.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
}

describe('#349 IME input in suggesting mode', () => {
  test('composed text is a proposal, like typed text', () => {
    withSurface(
      p('abc'),
      (surface, container) => {
        const id = surface.session.paragraphIds()[0]!;
        caretTo(surface, 0, 3);
        compose(container, id, 'abc\u4e2d\u6587');
        surface.flushPendingInput();
        expect(surface.session.bodyText()).toBe('abc\u4e2d\u6587');
        expect(serializeOoxmlPart(surface.session.part())).toContain('<w:ins');
      },
      { author: 'Ada Lovelace', mode: 'suggest' }
    );
  });

  test('composed text replacing a word lands after the words it strikes', () => {
    withSurface(
      p('alpha beta'),
      (surface, container) => {
        const id = surface.session.paragraphIds()[0]!;
        surface.setSelection({
          anchor: { paragraphId: id, offset: 0 },
          head: { paragraphId: id, offset: 5 },
        });
        // The browser composes over the selected word: the painted text loses "alpha".
        compose(container, id, '\u4e2d\u6587 beta');
        expect(surface.state().lastRejection).toBeNull();
        // Suggesting keeps the struck word, and the proposal goes after it — not in front.
        expect(surface.session.bodyText()).toBe('alpha\u4e2d\u6587 beta');
      },
      { author: 'Ada Lovelace', mode: 'suggest' }
    );
  });

  test('and viewing mode refuses it, like every other lane', () => {
    withSurface(
      p('abc'),
      (surface, container) => {
        const id = surface.session.paragraphIds()[0]!;
        caretTo(surface, 0, 3);
        surface.setEditingMode('view');
        compose(container, id, 'abc\u4e2d\u6587');
        expect(surface.session.bodyText()).toBe('abc');
      },
      { author: 'Ada Lovelace' }
    );
  });
});

describe('#353 paste in suggesting mode', () => {
  test('the paragraph break it makes is a proposal too', () => {
    withSurface(
      p('Hello'),
      (surface) => {
        caretTo(surface, 0, 5);
        surface.insertPlainText('\nGamma');
        expect(surface.state().lastRejection).toBeNull();
        expect(paragraphTexts(surface)).toEqual(['Hello', 'Gamma']);
        expect(serializeOoxmlPart(surface.session.part())).toMatch(
          /<w:rPr><w:ins[^>]*w:author="Ada Lovelace"/
        );
      },
      { author: 'Ada Lovelace', mode: 'suggest' }
    );
  });

  test('and the caret lands after the pasted text, not inside it', () => {
    withSurface(
      p('Hello World'),
      (surface) => {
        surface.setSelection({
          anchor: { paragraphId: surface.session.paragraphIds()[0]!, offset: 0 },
          head: { paragraphId: surface.session.paragraphIds()[0]!, offset: 5 },
        });
        surface.insertPlainText('Goodbye');
        surface.type('!');
        expect(paragraphTexts(surface)).toEqual(['HelloGoodbye! World']);
      },
      { author: 'Ada Lovelace', mode: 'suggest' }
    );
  });

  test('control: in edit mode the break stays untracked', () => {
    withSurface(p('Hello'), (surface) => {
      caretTo(surface, 0, 5);
      surface.insertPlainText('\nGamma');
      expect(serializeOoxmlPart(surface.session.part())).not.toMatch(/<w:ins/);
    });
  });
});

describe('#343 inserting a footnote', () => {
  test('replaces the selection and leaves the caret after the reference', () => {
    withSurface(p('Hello world'), (surface) => {
      const id = surface.session.paragraphIds()[0]!;
      surface.setSelection({
        anchor: { paragraphId: id, offset: 0 },
        head: { paragraphId: id, offset: 5 },
      });
      expect(surface.insertNote('footnote')).toBe(true);
      // "Hello" is gone, the reference stands in its place.
      expect(surface.session.bodyText()).toBe('\uFFFC world');
      surface.exitNote();
      // After the reference, which is where the next character belongs.
      expect(surface.state().selection.head.offset).toBe(1);
      surface.type('X');
      expect(surface.session.bodyText()).toBe('\uFFFCX world');
    });
  });

  test('at a caret, the reference keeps the text it was inserted into', () => {
    withSurface(p('Hello world'), (surface) => {
      caretTo(surface, 0, 5);
      expect(surface.insertNote('footnote')).toBe(true);
      expect(surface.session.bodyText()).toBe('Hello\uFFFC world');
      surface.exitNote();
      surface.type('X');
      expect(surface.session.bodyText()).toBe('Hello\uFFFCX world');
    });
  });
});

describe('#354 redo puts the caret where the redone edit ends', () => {
  test('backspace', () => {
    withSurface(p('abcdef'), (surface) => {
      caretTo(surface, 0, 3);
      surface.deleteBackward();
      surface.undo();
      surface.redo();
      expect(paragraphTexts(surface)).toEqual(['abdef']);
      expect(surface.state().selection.head.offset).toBe(2);
      surface.type('Q');
      expect(paragraphTexts(surface)).toEqual(['abQdef']);
    });
  });

  test('a single-line paste', () => {
    withSurface(p('abcdef'), (surface) => {
      caretTo(surface, 0, 3);
      surface.insertPlainText('XY');
      surface.undo();
      surface.redo();
      surface.type('Q');
      expect(paragraphTexts(surface)).toEqual(['abcXYQdef']);
    });
  });

  test('deleting a selection', () => {
    withSurface(p('abcdef'), (surface) => {
      surface.setSelection({
        anchor: { paragraphId: surface.session.paragraphIds()[0]!, offset: 1 },
        head: { paragraphId: surface.session.paragraphIds()[0]!, offset: 4 },
      });
      surface.deleteSelection();
      surface.undo();
      surface.redo();
      surface.type('Q');
      expect(paragraphTexts(surface)).toEqual(['aQef']);
    });
  });
});
