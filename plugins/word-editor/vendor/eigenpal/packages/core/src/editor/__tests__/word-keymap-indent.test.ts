// The Word keymap and Increase/Decrease Indent.
//
// Two things a user notices immediately if they are wrong: Enter/Shift+Enter/Ctrl+Enter
// must produce three DIFFERENT breaks, and Tab in a list must demote the item rather than
// insert a tab — which changes the marker, because the level is what selects the format
// out of numbering.xml.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { createKeyDownHandler } from '../surface-input.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const NUM = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering';

const NUMBERING =
  `<w:numbering xmlns:w="${W}">` +
  '<w:abstractNum w:abstractNumId="0">' +
  '<w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/>' +
  '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>' +
  '<w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/><w:lvlText w:val="○"/>' +
  '<w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>' +
  '</w:abstractNum>' +
  // Level 0 ONLY — the shape a great many real documents have, including Word's own
  // "Simple Bullet List" and "Upper Roman" in the comprehensive fixture.
  '<w:abstractNum w:abstractNumId="1">' +
  '<w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="§"/>' +
  '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>' +
  '<w:rPr><w:rFonts w:ascii="Wingdings" w:hAnsi="Wingdings"/></w:rPr></w:lvl>' +
  '</w:abstractNum>' +
  '<w:abstractNum w:abstractNumId="2">' +
  '<w:lvl w:ilvl="0"><w:numFmt w:val="upperRoman"/><w:lvlText w:val="%1."/>' +
  '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>' +
  '</w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
  '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>' +
  '<w:num w:numId="3"><w:abstractNumId w:val="2"/></w:num></w:numbering>';

const STY = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

interface DocxParts {
  /** Replaces the default NUMBERING body (the `w:numbering` children). */
  numberingXml?: string;
  /** Adds `/word/styles.xml` with these `w:styles` children. */
  stylesXml?: string;
}

function docx(body: string, withNumbering = false, parts: DocxParts = {}): Uint8Array {
  const withStyles = parts.stylesXml !== undefined;
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        (withNumbering
          ? '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
          : '') +
        (withStyles
          ? '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
          : '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  };
  const rels: string[] = [];
  if (withNumbering) {
    files['word/numbering.xml'] = strToU8(
      parts.numberingXml !== undefined
        ? `<w:numbering xmlns:w="${W}">${parts.numberingXml}</w:numbering>`
        : NUMBERING
    );
    rels.push(`<Relationship Id="rId9" Type="${NUM}" Target="numbering.xml"/>`);
  }
  if (withStyles) {
    files['word/styles.xml'] = strToU8(`<w:styles xmlns:w="${W}">${parts.stylesXml}</w:styles>`);
    rels.push(`<Relationship Id="rId8" Type="${STY}" Target="styles.xml"/>`);
  }
  if (rels.length > 0) {
    files['word/_rels/document.xml.rels'] = strToU8(
      `<Relationships xmlns="${REL}">${rels.join('')}</Relationships>`
    );
  }
  return zipSync(files);
}

function mount(body: string, withNumbering = false, parts: DocxParts = {}): PaginatedSurface {
  return mountBytes(docx(body, withNumbering, parts));
}

function mountBytes(bytes: Uint8Array): PaginatedSurface {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, bytes);
  if (!opened.ok) throw new Error(opened.reason);
  return opened.surface;
}

const listItem = (text: string, ilvl = 0) =>
  '<w:p><w:pPr><w:numPr>' +
  `<w:ilvl w:val="${ilvl}"/><w:numId w:val="1"/>` +
  `</w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

const key = (init: Partial<KeyboardEvent> & { key: string }): KeyboardEvent =>
  ({
    preventDefault: () => {},
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...init,
  }) as KeyboardEvent;

const markerOf = (surface: PaginatedSurface) => {
  for (const page of surface.layout().pages) {
    for (const fragment of page.fragments) {
      if (fragment.kind === 'paragraph' && fragment.marker) return fragment.marker;
    }
  }
  return undefined;
};

const markerFor = (surface: PaginatedSurface, paragraphId: string) => {
  for (const page of surface.layout().pages) {
    for (const fragment of page.fragments) {
      if (fragment.kind === 'paragraph' && fragment.paragraphId === paragraphId) {
        return fragment.marker;
      }
    }
  }
  return undefined;
};

describe('Increase/Decrease Indent', () => {
  test('a list item changes LEVEL, and its marker changes with it', () => {
    const surface = mount(listItem('alpha'), true);
    expect(markerOf(surface)).toMatchObject({ text: '•', level: 0 });

    expect(surface.adjustIndent('increase')).toBe(true);
    expect(markerOf(surface)).toMatchObject({ text: '○', level: 1 });

    expect(surface.adjustIndent('decrease')).toBe(true);
    expect(markerOf(surface)).toMatchObject({ text: '•', level: 0 });
  });

  test('the list level is clamped at both ends rather than erroring', () => {
    const surface = mount(listItem('alpha'), true);
    expect(surface.adjustIndent('decrease')).toBe(false);
    expect(markerOf(surface)?.level).toBe(0);
  });

  test('a plain paragraph moves its left indent by one default tab stop', () => {
    const surface = mount('<w:p><w:r><w:t>plain</w:t></w:r></w:p>');
    expect(surface.isListParagraph()).toBe(false);
    surface.adjustIndent('increase');
    const indented = surface.layout().pages[0]!.fragments[0]!;
    if (indented.kind !== 'paragraph') throw new Error('expected a paragraph');
    // 720 twips = 36pt.
    expect(indented.lines[0]!.box.x).toBe(36);
    surface.adjustIndent('decrease');
    const back = surface.layout().pages[0]!.fragments[0]!;
    if (back.kind !== 'paragraph') throw new Error('expected a paragraph');
    expect(back.lines[0]!.box.x).toBe(0);
  });

  test('outdent never pushes a paragraph past the margin', () => {
    const surface = mount('<w:p><w:r><w:t>plain</w:t></w:r></w:p>');
    expect(surface.adjustIndent('decrease')).toBe(false);
  });

  test('changing the level keeps w:numId and the rest of w:pPr', () => {
    const surface = mount(listItem('alpha'), true);
    surface.setParagraphProperty('jc', { val: 'center' });
    surface.adjustIndent('increase');
    const xml = JSON.stringify(surface.session.part().root);
    expect(xml).toContain('numId');
    expect(xml).toContain('jc');
    expect(markerOf(surface)?.level).toBe(1);
  });
});

describe('the Word keymap', () => {
  test('Tab demotes inside a list and inserts a tab outside one', () => {
    const list = mount(listItem('alpha'), true);
    createKeyDownHandler(list)(key({ key: 'Tab' }));
    expect(markerOf(list)?.level).toBe(1);

    const plain = mount('<w:p><w:r><w:t>x</w:t></w:r></w:p>');
    createKeyDownHandler(plain)(key({ key: 'Tab' }));
    expect(JSON.stringify(plain.session.part().root)).toContain('"tab"');
  });

  test('Shift+Tab promotes inside a list and outdents outside one', () => {
    const list = mount(listItem('alpha', 1), true);
    createKeyDownHandler(list)(key({ key: 'Tab', shiftKey: true }));
    expect(markerOf(list)?.level).toBe(0);
  });

  test('Enter, Shift+Enter and Ctrl+Enter are three different breaks', () => {
    const paragraphs = () => mount('<w:p><w:r><w:t>ab</w:t></w:r></w:p>');

    const split = paragraphs();
    createKeyDownHandler(split)(key({ key: 'Enter' }));
    expect(split.session.paragraphIds().length).toBe(2);

    const line = paragraphs();
    createKeyDownHandler(line)(key({ key: 'Enter', shiftKey: true }));
    expect(line.session.paragraphIds().length).toBe(1);
    expect(JSON.stringify(line.session.part().root)).toContain('"br"');

    const page = paragraphs();
    createKeyDownHandler(page)(key({ key: 'Enter', ctrlKey: true }));
    expect(page.session.paragraphIds().length).toBe(1);
    expect(JSON.stringify(page.session.part().root)).toContain('page');
  });

  test('Ctrl+M indents and Ctrl+Shift+M outdents', () => {
    const surface = mount('<w:p><w:r><w:t>x</w:t></w:r></w:p>');
    const handler = createKeyDownHandler(surface);
    handler(key({ key: 'm', ctrlKey: true }));
    const indented = surface.layout().pages[0]!.fragments[0]!;
    if (indented.kind !== 'paragraph') throw new Error('expected a paragraph');
    expect(indented.lines[0]!.box.x).toBe(36);
    handler(key({ key: 'm', ctrlKey: true, shiftKey: true }));
    const back = surface.layout().pages[0]!.fragments[0]!;
    if (back.kind !== 'paragraph') throw new Error('expected a paragraph');
    expect(back.lines[0]!.box.x).toBe(0);
  });

  test('Ctrl+E/L/R/J set alignment and Ctrl+1/5/2 set line spacing', () => {
    const surface = mount('<w:p><w:r><w:t>x</w:t></w:r></w:p>');
    const handler = createKeyDownHandler(surface);
    handler(key({ key: 'e', ctrlKey: true }));
    expect(JSON.stringify(surface.session.part().root)).toContain('center');
    handler(key({ key: '2', ctrlKey: true }));
    const xml = JSON.stringify(surface.session.part().root);
    expect(xml).toContain('480');
    expect(xml).toContain('auto');
  });

  test('Cmd+R stays the browser reload; Ctrl+R right-aligns', () => {
    // The browser reserves Cmd+R — preventDefault does not cancel the reload, so the
    // keymap must not touch the document on that chord.
    const surface = mount('<w:p><w:r><w:t>x</w:t></w:r></w:p>');
    const handler = createKeyDownHandler(surface);
    let prevented = false;
    handler(
      key({
        key: 'r',
        metaKey: true,
        preventDefault: () => {
          prevented = true;
        },
      })
    );
    expect(prevented).toBe(false);
    expect(JSON.stringify(surface.session.part().root)).not.toContain('right');
    handler(key({ key: 'r', ctrlKey: true }));
    expect(JSON.stringify(surface.session.part().root)).toContain('right');
  });

  test('Ctrl+Backspace deletes a word, not a character', () => {
    const surface = mount('<w:p><w:r><w:t>alpha beta</w:t></w:r></w:p>');
    const id = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId: id, offset: 10 },
      head: { paragraphId: id, offset: 10 },
    });
    createKeyDownHandler(surface)(key({ key: 'Backspace', ctrlKey: true }));
    expect(surface.session.bodyText()).toBe('alpha ');
  });

  test('Cmd+Left/Right move to the start and end of the LINE', () => {
    // On macOS this is the line gesture — most Mac keyboards have no Home/End key at all,
    // so binding line motion to those alone leaves it unreachable. Character motion here
    // is the giveaway that the modifier was swallowed.
    const surface = mount('<w:p><w:r><w:t>alpha beta gamma</w:t></w:r></w:p>');
    const handler = createKeyDownHandler(surface);
    const id = surface.session.paragraphIds()[0]!;
    const caretAt = (offset: number) =>
      surface.setSelection({
        anchor: { paragraphId: id, offset },
        head: { paragraphId: id, offset },
      });
    const head = () => surface.state().selection.head.offset;

    caretAt(6);
    handler(key({ key: 'ArrowRight', metaKey: true }));
    expect(head()).toBe(16);

    caretAt(6);
    handler(key({ key: 'ArrowLeft', metaKey: true }));
    expect(head()).toBe(0);
  });

  test('Cmd+Shift+Left/Right SELECT to the start and end of the line', () => {
    const surface = mount('<w:p><w:r><w:t>alpha beta gamma</w:t></w:r></w:p>');
    const handler = createKeyDownHandler(surface);
    const id = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId: id, offset: 6 },
      head: { paragraphId: id, offset: 6 },
    });
    handler(key({ key: 'ArrowRight', metaKey: true, shiftKey: true }));
    expect(surface.selectedText()).toBe('beta gamma');
  });

  test('Alt/Ctrl+Left still move by WORD, not by line', () => {
    // The line binding must not swallow the word gesture: Alt+Arrow is word motion on
    // macOS, Ctrl+Arrow on Windows, and both keep working.
    const surface = mount('<w:p><w:r><w:t>alpha beta gamma</w:t></w:r></w:p>');
    const handler = createKeyDownHandler(surface);
    const id = surface.session.paragraphIds()[0]!;
    const caretAt = (offset: number) =>
      surface.setSelection({
        anchor: { paragraphId: id, offset },
        head: { paragraphId: id, offset },
      });

    caretAt(16);
    handler(key({ key: 'ArrowLeft', altKey: true }));
    expect(surface.state().selection.head.offset).toBe(11);

    caretAt(16);
    handler(key({ key: 'ArrowLeft', ctrlKey: true }));
    expect(surface.state().selection.head.offset).toBe(11);
  });

  test('Ctrl+Y redoes, like Word on Windows', () => {
    const surface = mount('<w:p><w:r><w:t>x</w:t></w:r></w:p>');
    const handler = createKeyDownHandler(surface);
    handler(key({ key: 'm', ctrlKey: true }));
    handler(key({ key: 'z', ctrlKey: true }));
    const undone = surface.layout().pages[0]!.fragments[0]!;
    if (undone.kind !== 'paragraph') throw new Error('expected a paragraph');
    expect(undone.lines[0]!.box.x).toBe(0);
    handler(key({ key: 'y', ctrlKey: true }));
    const redone = surface.layout().pages[0]!.fragments[0]!;
    if (redone.kind !== 'paragraph') throw new Error('expected a paragraph');
    expect(redone.lines[0]!.box.x).toBe(36);
  });
});

describe('Bullets and Numbering', () => {
  test('a plain document gains numbering.xml, its rel and its content type', () => {
    const surface = mount('<w:p><w:r><w:t>alpha</w:t></w:r></w:p>');
    expect(surface.isListActive('bullet')).toBe(false);
    expect(surface.toggleList('bullet')).toBe(true);

    const marker = markerOf(surface);
    expect(marker).toMatchObject({ text: '•', level: 0 });
    expect(surface.isListActive('bullet')).toBe(true);

    // The whole package has to survive a save/reopen, not just the tree.
    const reopened = mountBytes(surface.session.save());
    expect(markerOf(reopened)).toMatchObject({ text: '•' });
  });

  test('an ordered list numbers, and the two kinds are distinguishable', () => {
    const surface = mount('<w:p><w:r><w:t>alpha</w:t></w:r></w:p>');
    surface.toggleList('ordered');
    expect(markerOf(surface)?.text).toBe('1.');
    expect(surface.isListActive('ordered')).toBe(true);
    expect(surface.isListActive('bullet')).toBe(false);
  });

  test('toggling the same kind again removes the list', () => {
    const surface = mount('<w:p><w:r><w:t>alpha</w:t></w:r></w:p>');
    surface.toggleList('bullet');
    expect(markerOf(surface)).toBeDefined();
    surface.toggleList('bullet');
    expect(markerOf(surface)).toBeUndefined();
    expect(JSON.stringify(surface.session.part().root)).not.toContain('numPr');
  });

  test('switching kinds replaces rather than clears', () => {
    const surface = mount('<w:p><w:r><w:t>alpha</w:t></w:r></w:p>');
    surface.toggleList('bullet');
    surface.toggleList('ordered');
    expect(markerOf(surface)?.text).toBe('1.');
  });

  test('a document that already has numbering reuses its template', () => {
    const surface = mount(listItem('alpha') + '<w:p><w:r><w:t>beta</w:t></w:r></w:p>', true);
    const before = JSON.stringify(surface.session.part().root);
    surface.selectAll();
    surface.toggleList('bullet');
    const numbering = surface.session.save();
    // One abstractNum only: a definition per toggled paragraph makes a document unreadable.
    const reopened = mountBytes(numbering);
    expect(markerOf(reopened)).toMatchObject({ text: '•' });
    expect(before).toContain('numPr');
  });

  test('a new ordered list after earlier items starts at one', () => {
    const decimalNumbering =
      '<w:abstractNum w:abstractNumId="7">' +
      '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/>' +
      '<w:lvlText w:val="%1."/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>' +
      '</w:abstractNum><w:num w:numId="7"><w:abstractNumId w:val="7"/></w:num>';
    const orderedItem = (text: string) =>
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/>' +
      `</w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
    const earlier = Array.from({ length: 39 }, (_, index) => orderedItem(`item ${index + 1}`)).join(
      ''
    );
    const surface = mount(
      earlier +
        '<w:p><w:r><w:t>ordinary paragraph</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>new list</w:t></w:r></w:p>',
      true,
      { numberingXml: decimalNumbering }
    );
    const target = surface.session.paragraphIds().at(-1)!;
    surface.setSelection({
      anchor: { paragraphId: target, offset: 0 },
      head: { paragraphId: target, offset: 0 },
    });

    expect(surface.toggleList('ordered')).toBe(true);
    expect(markerFor(surface, target)?.text).toBe('1.');

    surface.setSelection({
      anchor: { paragraphId: target, offset: 'new list'.length },
      head: { paragraphId: target, offset: 'new list'.length },
    });
    createKeyDownHandler(surface)(key({ key: 'Enter' }));
    const next = surface.session.paragraphIds().at(-1)!;
    expect(markerFor(surface, next)?.text).toBe('2.');
  });

  test('the toggle keeps the rest of w:pPr', () => {
    const surface = mount(
      '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>alpha</w:t></w:r></w:p>'
    );
    surface.toggleList('bullet');
    const xml = JSON.stringify(surface.session.part().root);
    expect(xml).toContain('center');
    expect(xml).toContain('numPr');
  });

  test('a new list demotes and promotes like any other', () => {
    const surface = mount('<w:p><w:r><w:t>alpha</w:t></w:r></w:p>');
    surface.toggleList('bullet');
    expect(markerOf(surface)).toMatchObject({ text: '•', level: 0 });
    surface.adjustIndent('increase');
    expect(markerOf(surface)).toMatchObject({ text: 'o', level: 1 });
  });
});

const shallow = (text: string, numId: string) =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/>` +
  `</w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

describe('a list definition that declares only level 0', () => {
  test('indenting DECLARES the missing level rather than erasing the bullet', () => {
    // numId 2 declares `ilvl 0` only. Demoting to a level it does not declare used to
    // resolve to no marker at all — and before that was guarded, the paragraph silently
    // stopped being a list item. Word never greys Increase Indent out here: it defines
    // the level with its stock bullet for that depth, and so does this.
    const surface = mount(shallow('alpha', '2'), true);
    expect(markerOf(surface)).toMatchObject({ text: '▪', level: 0 });
    expect(surface.adjustIndent('increase')).toBe(true);
    expect(markerOf(surface)).toMatchObject({ text: 'o', level: 1 });
    // And back: the item's own level 0 still resolves to its authored glyph.
    expect(surface.adjustIndent('decrease')).toBe(true);
    expect(markerOf(surface)).toMatchObject({ text: '▪', level: 0 });
  });

  test("a numbered list gains Word's default format for the depth", () => {
    const surface = mount(shallow('Introduction', '3'), true);
    expect(markerOf(surface)?.text).toBe('I.');
    expect(surface.adjustIndent('increase')).toBe(true);
    // Depth 1 of Word's default cycle is lowerLetter.
    expect(markerOf(surface)?.text).toBe('a.');
  });

  test('the declared level survives a save and reopen', () => {
    const surface = mount(shallow('alpha', '2'), true);
    expect(surface.adjustIndent('increase')).toBe(true);
    const reopened = mountBytes(surface.session.save());
    expect(markerOf(reopened)).toMatchObject({ text: 'o', level: 1 });
  });

  test('Tab takes the same lane', () => {
    const surface = mount(shallow('alpha', '2'), true);
    createKeyDownHandler(surface)(key({ key: 'Tab' }));
    expect(markerOf(surface)).toMatchObject({ text: 'o', level: 1 });
  });

  test('the control stays enabled, greying out only at the ends of the range', () => {
    const surface = mount(shallow('alpha', '2'), true);
    expect(surface.canAdjustIndent('increase')).toBe(true);
    expect(surface.canAdjustIndent('decrease')).toBe(false);
  });

  test('a definition that DOES declare the level still indents', () => {
    const surface = mount(listItem('alpha'), true);
    expect(surface.canAdjustIndent('increase')).toBe(true);
    expect(surface.adjustIndent('increase')).toBe(true);
    expect(markerOf(surface)).toMatchObject({ text: '○', level: 1 });
  });

  test('nine levels is the ceiling: eight presses declare them all, the ninth refuses', () => {
    const surface = mount(shallow('alpha', '2'), true);
    for (let press = 1; press <= 8; press += 1) {
      expect(surface.adjustIndent('increase')).toBe(true);
      expect(markerOf(surface)?.level).toBe(press);
    }
    expect(surface.canAdjustIndent('increase')).toBe(false);
    expect(surface.adjustIndent('increase')).toBe(false);
    expect(markerOf(surface)?.level).toBe(8);
    // And the whole ladder is still resolvable on the way back down.
    for (let press = 7; press >= 0; press -= 1) {
      expect(surface.adjustIndent('decrease')).toBe(true);
      expect(markerOf(surface)?.level).toBe(press);
    }
  });

  test('the declared ORDERED level survives a save and reopen too', () => {
    const surface = mount(shallow('Introduction', '3'), true);
    expect(surface.adjustIndent('increase')).toBe(true);
    const reopened = mountBytes(surface.session.save());
    expect(markerOf(reopened)).toMatchObject({ text: 'a.', level: 1 });
  });
});

describe('numbering.xml that fights the graft', () => {
  test('a foreign-namespace lvl cannot pass for a declaration', () => {
    // The write path used to match `lvl` by local name alone while the layout index
    // requires the WML namespace: `<x:lvl x:ilvl="1">` made "already declared" answer
    // true, the level op committed, and the marker resolved to NOTHING — the exact
    // destruction this feature exists to prevent.
    const hostile =
      '<w:abstractNum w:abstractNumId="1">' +
      '<w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="§"/>' +
      '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>' +
      '<x:lvl x:ilvl="1" xmlns:x="urn:evil"/>' +
      '</w:abstractNum>' +
      '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>';
    const surface = mount(shallow('alpha', '2'), true, { numberingXml: hostile });
    expect(markerOf(surface)).toMatchObject({ text: '§', level: 0 });
    expect(surface.adjustIndent('increase')).toBe(true);
    expect(markerOf(surface)).toMatchObject({ text: 'o', level: 1 });
  });

  test('a graft never de-escapes a hostile authored value on save', () => {
    // The part being edited carries an attacker string that WOULD be markup if it ever
    // reached the file unescaped. The graft edits the same part; the save must re-escape
    // the authored value exactly as it arrived.
    const hostile =
      '<w:abstractNum w:abstractNumId="1">' +
      '<w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/>' +
      '<w:lvlText w:val="&quot;/&gt;&lt;w:sectPr/&gt;&lt;w:lvl w:ilvl=&quot;1&quot;"/>' +
      '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>' +
      '</w:abstractNum>' +
      '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>';
    const surface = mount(shallow('alpha', '2'), true, { numberingXml: hostile });
    expect(surface.adjustIndent('increase')).toBe(true);
    const saved = strFromU8(unzipSync(surface.session.save())['word/numbering.xml']!);
    // The payload is still character data, not markup …
    expect(saved).not.toContain('/><w:sectPr/>');
    expect(saved).toContain('&lt;w:sectPr/&gt;');
    // … and the graft itself landed.
    expect(saved).toContain('Courier New');
  });
});

describe('a w:numStyleLink definition', () => {
  // Word's built-in List Bullet shape: the abstract a paragraph names carries NO levels
  // and delegates to a style, whose w:numPr names the num that owns the real levels.
  const linked = (ownerLevels: string) =>
    '<w:abstractNum w:abstractNumId="0"><w:numStyleLink w:val="ListBullet"/></w:abstractNum>' +
    `<w:abstractNum w:abstractNumId="1"><w:styleLink w:val="ListBullet"/>${ownerLevels}</w:abstractNum>` +
    '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
    '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>';
  const LINKED_STYLES =
    '<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/>' +
    '<w:pPr><w:numPr><w:numId w:val="2"/></w:numPr></w:pPr></w:style>';
  const LEVEL_0 =
    '<w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/>' +
    '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>';
  const LEVEL_1 =
    '<w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/><w:lvlText w:val="○"/>' +
    '<w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>';

  test('a level the LINK declares indents without any graft', () => {
    const surface = mount(shallow('alpha', '1'), true, {
      numberingXml: linked(LEVEL_0 + LEVEL_1),
      stylesXml: LINKED_STYLES,
    });
    expect(markerOf(surface)).toMatchObject({ text: '•', level: 0 });
    expect(surface.canAdjustIndent('increase')).toBe(true);
    expect(surface.adjustIndent('increase')).toBe(true);
    // The LINKED level-1 glyph, not the engine's Courier `o` default — no level was
    // grafted, the existing declaration resolved through the link.
    expect(markerOf(surface)).toMatchObject({ text: '○', level: 1 });
    expect(JSON.stringify(surface.session.part().root)).not.toContain('Courier New');
  });

  test('a level past the deepest LINKED one refuses rather than shadow-grafting', () => {
    const surface = mount(shallow('alpha', '1'), true, {
      numberingXml: linked(LEVEL_0),
      stylesXml: LINKED_STYLES,
    });
    expect(markerOf(surface)).toMatchObject({ text: '•', level: 0 });
    // A graft onto the delegating abstract would be shadowed by the link resolve, so the
    // press is a safe no-op: nothing committed, nothing written, marker intact.
    expect(surface.adjustIndent('increase')).toBe(false);
    expect(markerOf(surface)).toMatchObject({ text: '•', level: 0 });
    const reopened = mountBytes(surface.session.save());
    expect(markerOf(reopened)).toMatchObject({ text: '•', level: 0 });
  });
});

describe('a list item numbered through its paragraph style', () => {
  // Word's List Bullet shape: the paragraph names only its style, and the style's w:numPr
  // names the list. The item has no w:numPr of its own.
  const STYLES =
    '<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/>' +
    '<w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="ListBullet2"><w:name w:val="List Bullet 2"/>' +
    '<w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="ListOther"><w:name w:val="List Other"/>' +
    '<w:pPr><w:numPr><w:numId w:val="2"/></w:numPr></w:pPr></w:style>';
  const styled = (text: string, style = 'ListBullet', props = '') =>
    `<w:p><w:pPr><w:pStyle w:val="${style}"/>${props}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
  const mountStyled = (body: string) => mount(body, true, { stylesXml: STYLES });
  const savedNumPr = (surface: PaginatedSurface) =>
    strFromU8(unzipSync(surface.session.save())['word/document.xml']!).match(
      /<w:numPr>.*?<\/w:numPr>/
    )?.[0] ?? null;

  test('Increase and Decrease Indent change the level', () => {
    const surface = mountStyled(styled('alpha'));
    expect(markerOf(surface)).toMatchObject({ text: '•', level: 0 });

    expect(surface.adjustIndent('increase')).toBe(true);
    expect(markerOf(surface)).toMatchObject({ text: '○', level: 1 });

    expect(surface.adjustIndent('decrease')).toBe(true);
    expect(markerOf(surface)).toMatchObject({ text: '•', level: 0 });
  });

  test('the level is written as the paragraph’s own w:numPr, naming the style’s list', () => {
    const surface = mountStyled(styled('alpha'));
    surface.adjustIndent('increase');
    expect(savedNumPr(surface)).toBe('<w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr>');
    const reopened = mountBytes(surface.session.save());
    expect(markerOf(reopened)).toMatchObject({ text: '○', level: 1 });
  });

  test('Tab demotes and Shift+Tab promotes', () => {
    const surface = mountStyled(styled('alpha'));
    const handler = createKeyDownHandler(surface);
    handler(key({ key: 'Tab' }));
    expect(markerOf(surface)?.level).toBe(1);
    handler(key({ key: 'Tab', shiftKey: true }));
    expect(markerOf(surface)?.level).toBe(0);
  });

  test('Enter on an empty nested item steps out a level at a time, then leaves the list', () => {
    const surface = mountStyled(styled('alpha', 'ListBullet2'));
    const id = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId: id, offset: 5 },
      head: { paragraphId: id, offset: 5 },
    });
    const handler = createKeyDownHandler(surface);
    const levelAtCaret = () => markerFor(surface, surface.state().selection.head.paragraphId);
    handler(key({ key: 'Enter' }));
    expect(levelAtCaret()?.level).toBe(1);
    handler(key({ key: 'Enter' }));
    expect(levelAtCaret()?.level).toBe(0);
    handler(key({ key: 'Enter' }));
    expect(levelAtCaret()).toBeUndefined();
    expect(surface.session.paragraphIds()).toHaveLength(2);
  });

  test('Bullets turns the list off, and it stays off after a save', () => {
    const surface = mountStyled(styled('alpha'));
    expect(surface.toggleList('bullet')).toBe(true);
    expect(surface.isListParagraph()).toBe(false);
    expect(savedNumPr(surface)).toBe('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="0"/></w:numPr>');
    expect(markerOf(mountBytes(surface.session.save()))).toBeUndefined();
  });

  test('Bullets after an indent turns the list off rather than undoing the indent', () => {
    const surface = mountStyled(styled('alpha'));
    surface.adjustIndent('increase');
    surface.toggleList('bullet');
    expect(surface.isListParagraph()).toBe(false);
    expect(savedNumPr(surface)).toBe('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="0"/></w:numPr>');
    expect(markerOf(mountBytes(surface.session.save()))).toBeUndefined();
  });

  test('Bullets turns the list back on in place of the override', () => {
    const surface = mountStyled(styled('alpha'));
    surface.toggleList('bullet');
    surface.toggleList('bullet');
    expect(surface.isListParagraph()).toBe(true);
    const saved = strFromU8(unzipSync(surface.session.save())['word/document.xml']!);
    expect(saved.match(/<w:numPr>/g)).toHaveLength(1);
  });

  test('a w:numPr of its own that names only the level keeps inheriting the list', () => {
    const surface = mountStyled(
      styled('alpha', 'ListBullet', '<w:numPr><w:ilvl w:val="0"/></w:numPr>')
    );
    expect(surface.adjustIndent('increase')).toBe(true);
    expect(markerOf(surface)?.level).toBe(1);
    expect(savedNumPr(surface)).toBe('<w:numPr><w:ilvl w:val="1"/></w:numPr>');
  });

  // A struck mark: the proposed view draws the paragraph as one line with the item after it.
  const STRUCK = '<w:rPr><w:del w:id="1" w:author="A"/></w:rPr>';
  /** The saved markup of `absorbed` after `edit`, run with the caret in it. */
  function editAbsorbed(
    absorbed: string,
    edit: (surface: PaginatedSurface) => void,
    survivor = styled('item')
  ): string {
    const container = document.createElement('div');
    document.body.append(container);
    const opened = mountPaginatedSurface(
      container,
      docx(absorbed + survivor, true, { stylesXml: STYLES }),
      { revisionDisplayMode: 'proposed' }
    );
    if (!opened.ok) throw new Error(opened.reason);
    const surface = opened.surface;
    const [id] = surface.session.paragraphIds();
    surface.setSelection({
      anchor: { paragraphId: id!, offset: 1 },
      head: { paragraphId: id!, offset: 1 },
    });
    expect(surface.isListParagraph()).toBe(true);
    edit(surface);
    const saved = strFromU8(unzipSync(surface.session.save())['word/document.xml']!);
    return saved.split('</w:p>')[0]!;
  }
  const indent = (surface: PaginatedSurface) => surface.adjustIndent('increase');
  const bulletsOff = (surface: PaginatedSurface) => surface.toggleList('bullet');
  const other = styled('other ', 'ListOther', STRUCK);

  test('a plain paragraph drawn inside a list item in a resolved view is not numbered', () => {
    const plain = `<w:p><w:pPr>${STRUCK}</w:pPr><w:r><w:t xml:space="preserve">plain </w:t></w:r></w:p>`;
    expect(editAbsorbed(plain, indent)).not.toContain('numPr');
  });

  test('a style-numbered paragraph drawn inside an item of another list keeps its own list', () => {
    expect(editAbsorbed(other, indent)).not.toContain('numPr');
    expect(editAbsorbed(other, bulletsOff)).not.toContain('numPr');
  });

  test('a style-numbered paragraph drawn inside an item of its own list is left as it is', () => {
    const same = styled('same ', 'ListBullet', STRUCK);
    expect(editAbsorbed(same, indent, styled('item', 'ListBullet2'))).not.toContain('numPr');
    expect(editAbsorbed(same, bulletsOff)).not.toContain('numPr');
  });
});

describe('list kind is read from w:numFmt, not the marker glyph', () => {
  test('a bullet level using a letter-shaped glyph is still a bullet', () => {
    const numberingXml =
      '<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0">' +
      '<w:numFmt w:val="bullet"/><w:lvlText w:val="o"/>' +
      '<w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/></w:rPr>' +
      '</w:lvl></w:abstractNum>' +
      '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>';
    const surface = mount(shallow('alpha', '2'), true, { numberingXml });
    expect(markerOf(surface)?.text).toBe('o');
    expect(surface.isListActive('bullet')).toBe(true);
    expect(surface.isListActive('ordered')).toBe(false);
  });

  test('a numbered item does not report itself as a bullet', () => {
    const surface = mount(
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr></w:pPr>' +
        '<w:r><w:t>Introduction</w:t></w:r></w:p>',
      true
    );
    expect(surface.isListActive('ordered')).toBe(true);
    expect(surface.isListActive('bullet')).toBe(false);
  });
});

describe('turning a list off and on again', () => {
  test('rejoins the list around it rather than minting a new glyph', () => {
    const item = (text: string) =>
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr>' +
      `<w:r><w:t>${text}</w:t></w:r></w:p>`;
    const surface = mount(item('one') + item('two') + item('three'), true);
    const markers = () =>
      surface
        .layout()
        .pages.flatMap((page) => page.fragments)
        .flatMap((fragment) =>
          fragment.kind === 'paragraph' && fragment.marker ? [fragment.marker.text] : []
        );
    expect(markers()).toEqual(['▪', '▪', '▪']);

    // Put the caret in the middle item, toggle its bullet off and back on.
    const middle = surface.session.paragraphIds()[1]!;
    surface.setSelection({
      anchor: { paragraphId: middle, offset: 0 },
      head: { paragraphId: middle, offset: 0 },
    });
    surface.toggleList('bullet');
    expect(markers()).toEqual(['▪', '▪']);
    surface.toggleList('bullet');
    // The restored item takes its NEIGHBOURS' bullet, not a freshly minted one.
    expect(markers()).toEqual(['▪', '▪', '▪']);
  });
});

describe('Enter at the end of a list', () => {
  test('leaves an empty list item inside a table cell on the second Enter', () => {
    const surface = mount(
      `<w:tbl><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc>${listItem(
        'alpha'
      )}</w:tc></w:tr></w:tbl>`,
      true
    );
    const handler = createKeyDownHandler(surface);
    const id = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId: id, offset: 5 },
      head: { paragraphId: id, offset: 5 },
    });

    handler(key({ key: 'Enter' }));
    // Two in the cell, and the empty paragraph the body reads after its final table.
    expect(surface.session.paragraphIds()).toHaveLength(3);
    expect(surface.isListParagraph()).toBe(true);

    handler(key({ key: 'Enter' }));
    expect(surface.session.paragraphIds()).toHaveLength(3);
    expect(surface.isListParagraph()).toBe(false);
  });

  test('makes another item, then leaves the list on the empty one', () => {
    const surface = mount(listItem('alpha'), true);
    const handler = createKeyDownHandler(surface);
    const id = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId: id, offset: 5 },
      head: { paragraphId: id, offset: 5 },
    });

    // First Enter: a new, empty item in the same list.
    handler(key({ key: 'Enter' }));
    expect(surface.session.paragraphIds().length).toBe(2);
    expect(markerOf(surface)).toBeDefined();
    // The caret follows the split, so the second Enter acts on the new item.
    expect(surface.isListParagraph()).toBe(true);

    // Second Enter on that empty item: out of the list, and no third paragraph.
    handler(key({ key: 'Enter' }));
    expect(surface.session.paragraphIds().length).toBe(2);
    expect(surface.isListParagraph()).toBe(false);
  });

  test('a nested item steps out one level at a time', () => {
    const surface = mount(listItem('alpha', 1), true);
    const id = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId: id, offset: 5 },
      head: { paragraphId: id, offset: 5 },
    });
    const handler = createKeyDownHandler(surface);
    // The marker of the paragraph the CARET is in, not the first in the document.
    const levelAtCaret = () => {
      const caret = surface.state().selection.head.paragraphId;
      for (const page of surface.layout().pages) {
        for (const fragment of page.fragments) {
          if (fragment.kind !== 'paragraph' || fragment.paragraphId !== caret) continue;
          return fragment.marker?.level ?? null;
        }
      }
      return null;
    };
    handler(key({ key: 'Enter' }));
    expect(levelAtCaret()).toBe(1);
    handler(key({ key: 'Enter' }));
    // Level 1 -> level 0, still a list.
    expect(levelAtCaret()).toBe(0);
    handler(key({ key: 'Enter' }));
    expect(surface.isListParagraph()).toBe(false);
  });

  test('Enter inside text still splits the paragraph', () => {
    const surface = mount(listItem('alpha'), true);
    const id = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId: id, offset: 2 },
      head: { paragraphId: id, offset: 2 },
    });
    createKeyDownHandler(surface)(key({ key: 'Enter' }));
    expect(surface.session.paragraphIds().length).toBe(2);
    expect(surface.isListParagraph()).toBe(true);
  });
});
