// The INSERT LANES in suggesting mode: page fields, hyperlinks, and note citations.
//
// Split from suggesting-keystrokes.test.ts, which pins the plain keystroke sequences; what
// is pinned here is that every insert lane writes a reviewable tracked change — the page
// field as one `w:ins` atom, the link as a strike plus a tracked wrapped copy, the note as
// a tracked citation whose rejection sweeps the body — and that the link reads (offsets,
// live display text) stay on the shared offset model while it happens.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { serializeOoxmlPart, type OoxmlNode } from '@docx-editor.dev/core/store';
import { selectCellRectangle } from './paginated-surface-fixtures.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const NUM = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering';

const NUMBERING =
  `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0">` +
  '<w:start w:val="1"/><w:numFmt w:val="upperRoman"/><w:lvlText w:val="%1."/>' +
  '<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>' +
  '</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';

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
      `<Relationships xmlns="${REL}"><Relationship Id="rId9" Type="${NUM}" Target="numbering.xml"/></Relationships>`
    ),
    'word/numbering.xml': strToU8(NUMBERING),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const listItem = (text: string) =>
  '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

const styledParagraph = (text: string) =>
  `<w:p><w:pPr><w:ind w:left="720"/></w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

const plainParagraph = (text: string) =>
  `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

function withSurface(body: string, run: (surface: PaginatedSurface) => void): void {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, docx(body), { author: 'Ada Lovelace' });
  if (!opened.ok) throw new Error(opened.reason);
  try {
    opened.surface.setEditingMode('suggest');
    run(opened.surface);
  } finally {
    opened.surface.destroy();
    container.remove();
  }
}

/** Every paragraph's text, in document order. */
function paragraphTexts(surface: PaginatedSurface): string[] {
  const out: string[] = [];
  const collect = (node: OoxmlNode, into: string[]): void => {
    if (node.kind === 'textValue') {
      into.push(node.value);
      return;
    }
    for (const child of node.children) collect(child, into);
  };
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'paragraph') {
      const parts: string[] = [];
      collect(node, parts);
      out.push(parts.join(''));
      return;
    }
    for (const child of node.children) walk(child);
  };
  walk(surface.session.part().root);
  return out;
}

function caretTo(surface: PaginatedSurface, index: number, offset: number): void {
  const paragraphId = surface.session.paragraphIds()[index]!;
  surface.setSelection({
    anchor: { paragraphId, offset },
    head: { paragraphId, offset },
  });
}

function selectIn(surface: PaginatedSurface, index: number, start: number, end: number): void {
  const paragraphId = surface.session.paragraphIds()[index]!;
  surface.setSelection({
    anchor: { paragraphId, offset: start },
    head: { paragraphId, offset: end },
  });
}

function selectAcross(
  surface: PaginatedSurface,
  fromIndex: number,
  fromOffset: number,
  toIndex: number,
  toOffset: number
): void {
  const ids = surface.session.paragraphIds();
  surface.setSelection({
    anchor: { paragraphId: ids[fromIndex]!, offset: fromOffset },
    head: { paragraphId: ids[toIndex]!, offset: toOffset },
  });
}

/** Type `text` one character at a time, the way a keyboard delivers it. */
function typeEach(surface: PaginatedSurface, text: string): void {
  for (const character of text) surface.type(character);
}

describe('insert lanes in suggesting mode', () => {
  test('retargeting a link with new display text keeps the copy INSIDE the link', () => {
    withSurface(plainParagraph('Alpha Docs Beta'), (surface) => {
      surface.setEditingMode('edit');
      selectIn(surface, 0, 'Alpha '.length, 'Alpha Docs'.length);
      expect(surface.hyperlinks.applyHyperlink({ url: 'https://example.com' })).toBe(true);
      surface.setEditingMode('suggest');
      caretTo(surface, 0, 'Alpha Do'.length);
      expect(surface.hyperlinks.applyHyperlink({ url: 'https://example.org', text: 'Guide' })).toBe(
        true
      );
      expect(surface.state().lastRejection).toBeNull();
      const xml = serializeOoxmlPart(surface.session.part());
      // Struck old text, then the tracked copy — BOTH inside the w:hyperlink. The copy
      // placed beside the link meant accepting the pair emptied and swept it, silently
      // unlinking the accepted text.
      expect(xml).toMatch(
        /<w:hyperlink[^>]*><w:del[^>]*><w:r>(?:<w:rPr><w:rStyle w:val="Hyperlink"\/><\/w:rPr>)?<w:delText[^>]*>Docs<\/w:delText><\/w:r><\/w:del><w:ins[^>]*><w:r>(?:<w:rPr><w:rStyle w:val="Hyperlink"\/><\/w:rPr>)?<w:t[^>]*>Guide<\/w:t><\/w:r><\/w:ins><\/w:hyperlink>/
      );
      const accepted = surface.session.applyTreeOps([{ op: 'acceptAllRevisions' }]);
      expect(accepted.committed).toBe(true);
      const after = serializeOoxmlPart(surface.session.part());
      expect(after).toMatch(
        /<w:hyperlink[^>]*><w:r>(?:<w:rPr><w:rStyle w:val="Hyperlink"\/><\/w:rPr>)?<w:t[^>]*>Guide<\/w:t><\/w:r><\/w:hyperlink>/
      );
    });
  });

  test('a link made at a caret resting in struck words lands past the deletion, whole', () => {
    withSurface(plainParagraph('Alpha Beta Gamma'), (surface) => {
      selectIn(surface, 0, 'Alpha '.length, 'Alpha Beta'.length);
      surface.deleteBackward();
      caretTo(surface, 0, 'Alpha Be'.length);
      expect(surface.hyperlinks.applyHyperlink({ url: 'https://example.com', text: 'docs' })).toBe(
        true
      );
      expect(surface.state().lastRejection).toBeNull();
      const xml = serializeOoxmlPart(surface.session.part());
      // The tracked display text relocates past the deletion; the wrap must cover the SAME
      // landing, or the committed link slices the deletion and the fresh insertion.
      expect(xml).toMatch(
        /<w:delText[^>]*>Beta<\/w:delText><\/w:r><\/w:del><w:hyperlink[^>]*><w:ins[^>]*><w:r>(?:<w:rPr><w:rStyle w:val="Hyperlink"\/><\/w:rPr>)?<w:t[^>]*>docs<\/w:t><\/w:r><\/w:ins><\/w:hyperlink>/
      );
    });
  });

  test('link offsets stay on the shared model after a complex field', () => {
    withSurface(
      '<w:p><w:r><w:t xml:space="preserve">A</w:t></w:r>' +
        '<w:r><w:fldChar w:fldCharType="begin"/><w:instrText xml:space="preserve"> PAGE </w:instrText>' +
        '<w:fldChar w:fldCharType="separate"/><w:t>7</w:t><w:fldChar w:fldCharType="end"/></w:r>' +
        '<w:hyperlink w:anchor="top"><w:r><w:t xml:space="preserve">link</w:t></w:r></w:hyperlink></w:p>',
      (surface) => {
        caretTo(surface, 0, 3);
        // The field is ONE model unit. A private length walk counted its instruction
        // characters, so the link after it read back five positions to the right.
        const link = surface.hyperlinks.linksInCaretParagraph()[0]!;
        expect(link.start).toBe(2);
        expect(link.end).toBe(6);
        expect(link.text).toBe('link');
      }
    );
  });

  test('a footnote lands where the caret is, after this author’s own pending text', () => {
    withSurface(plainParagraph('Alpha one'), (surface) => {
      caretTo(surface, 0, 'Alpha'.length);
      typeEach(surface, 'abc');
      expect(surface.insertNote('footnote')).toBe(true);
      expect(surface.state().lastRejection).toBeNull();
      const xml = serializeOoxmlPart(surface.session.part());
      // The citation goes AFTER the pending insertion, where the caret was — INSIDE the
      // author's own `w:ins`, one continuous proposal. The lifecycle lane's private offset
      // walk counted wrapped runs as nothing, so the reference validated against a shorter
      // paragraph and landed three characters to the left.
      expect(xml).toMatch(
        /<w:ins[^>]*w:author="Ada Lovelace"[^>]*><w:r><w:t[^>]*>abc<\/w:t><\/w:r><w:r><w:rPr><w:rStyle w:val="FootnoteReference"\/><\/w:rPr><w:footnoteReference/
      );
      expect(xml.match(/<w:ins /g)).toHaveLength(1);
    });
  });

  test('renaming a link whose text is your OWN pending insertion keeps a link', () => {
    withSurface(plainParagraph('Alpha Beta'), (surface) => {
      caretTo(surface, 0, 'Alpha'.length);
      expect(surface.hyperlinks.applyHyperlink({ url: 'https://example.com', text: 'docs' })).toBe(
        true
      );
      caretTo(surface, 0, 'Alpha do'.length);
      expect(surface.hyperlinks.applyHyperlink({ url: 'https://example.org', text: 'guide' })).toBe(
        true
      );
      expect(surface.state().lastRejection).toBeNull();
      const xml = serializeOoxmlPart(surface.session.part());
      // The strike retracts the pending 'docs' physically and sweeps the emptied link, so
      // a plain retarget had nothing left to hold the new text — the renamed link came out
      // silently unlinked. A fresh proposal wraps the copy instead.
      expect(xml).toMatch(
        /<w:hyperlink[^>]*><w:ins[^>]*><w:r>(?:<w:rPr><w:rStyle w:val="Hyperlink"\/><\/w:rPr>)?<w:t[^>]*>guide<\/w:t><\/w:r><\/w:ins><\/w:hyperlink>/
      );
      expect(xml).not.toContain('docs');
    });
  });

  test('renaming a link reports the LIVE display text, not the struck slice', () => {
    withSurface(plainParagraph('Alpha Docs Beta'), (surface) => {
      surface.setEditingMode('edit');
      selectIn(surface, 0, 'Alpha '.length, 'Alpha Docs'.length);
      expect(surface.hyperlinks.applyHyperlink({ url: 'https://example.com' })).toBe(true);
      surface.setEditingMode('suggest');
      caretTo(surface, 0, 'Alpha Do'.length);
      expect(surface.hyperlinks.applyHyperlink({ url: 'https://example.org', text: 'Guide' })).toBe(
        true
      );
      // The popover seeds its text input from `.text`: the raw offset slice spans the
      // struck 'Docs' too, and prefilled the field with 'DocsGuide'.
      const link = surface.hyperlinks.linksInCaretParagraph()[0]!;
      expect(link.text).toBe('Guide');
    });
  });

  test('a link holding only a simple field still reads back', () => {
    withSurface(
      '<w:p><w:r><w:t xml:space="preserve">Go </w:t></w:r>' +
        '<w:hyperlink w:anchor="x"><w:fldSimple w:instr=" REF bm ">' +
        '<w:r><w:t>Chapter 1</w:t></w:r></w:fldSimple></w:hyperlink></w:p>',
      (surface) => {
        caretTo(surface, 0, 3);
        // A `w:fldSimple` atom's segment carries no run id, so a run-id-only match
        // reported this link as owning no offsets at all — clicking it did nothing.
        const link = surface.hyperlinks.linksInCaretParagraph()[0]!;
        expect(link.start).toBe(3);
        expect(link.end).toBe(4);
        expect(link.text).toBe('Chapter 1');
      }
    );
  });

  test('a footnote inserted MID your own pending text joins the proposal', () => {
    withSurface(plainParagraph('Alpha'), (surface) => {
      caretTo(surface, 0, 'Alpha'.length);
      typeEach(surface, 'ab');
      caretTo(surface, 0, 'Alphaa'.length);
      expect(surface.insertNote('footnote')).toBe(true);
      expect(surface.state().lastRejection).toBeNull();
      const xml = serializeOoxmlPart(surface.session.part());
      // The reference is a sibling RUN between the split halves, inside the same `w:ins` —
      // keeping its own reference style rather than the formatting at the caret. This
      // ordinary gesture (type, arrow left, insert footnote) used to dead-end in a refusal.
      expect(xml).toMatch(
        /<w:ins[^>]*><w:r><w:t[^>]*>a<\/w:t><\/w:r><w:r><w:rPr><w:rStyle w:val="FootnoteReference"\/><\/w:rPr><w:footnoteReference[^>]*\/><\/w:r><w:r><w:t[^>]*>b<\/w:t><\/w:r><\/w:ins>/
      );
    });
  });

  test('renaming a link wrapped in a content control strikes and lands INSIDE it', () => {
    withSurface(
      '<w:p><w:r><w:t xml:space="preserve">See </w:t></w:r>' +
        '<w:sdt><w:sdtPr><w:tag w:val="t1"/></w:sdtPr><w:sdtContent>' +
        '<w:hyperlink w:anchor="x"><w:r><w:t>Docs</w:t></w:r></w:hyperlink>' +
        '</w:sdtContent></w:sdt></w:p>',
      (surface) => {
        caretTo(surface, 0, 'See Do'.length);
        expect(
          surface.hyperlinks.applyHyperlink({ url: 'https://example.org', text: 'Guide' })
        ).toBe(true);
        expect(surface.state().lastRejection).toBeNull();
        const xml = serializeOoxmlPart(surface.session.part());
        // The strike reaches through the control, and the tracked copy follows its
        // deletion into the link inside it. The lane used to no-op the strike silently
        // and drop the copy beside the control.
        expect(xml).toMatch(
          /<w:hyperlink[^>]*><w:del[^>]*><w:r>(?:<w:rPr><w:rStyle w:val="Hyperlink"\/><\/w:rPr>)?<w:delText[^>]*>Docs<\/w:delText><\/w:r><\/w:del><w:ins[^>]*><w:r>(?:<w:rPr><w:rStyle w:val="Hyperlink"\/><\/w:rPr>)?<w:t[^>]*>Guide<\/w:t><\/w:r><\/w:ins><\/w:hyperlink>/
        );
      }
    );
  });

  test('suggesting refuses to delete a note outright', () => {
    withSurface(plainParagraph('Alpha one'), (surface) => {
      caretTo(surface, 0, 'Alpha'.length);
      expect(surface.insertNote('footnote')).toBe(true);
      const before = serializeOoxmlPart(surface.session.part());
      const noteId = Number(/footnoteReference w:id="(\d+)"/.exec(before)![1]);
      // Outright removal has no tracked form: the reference and body would go with no
      // `w:del` and no card. Striking the reference is the proposal lane.
      expect(surface.deleteNote('footnote', noteId)).toBe(false);
      expect(serializeOoxmlPart(surface.session.part())).toMatch(/footnoteReference/);
    });
  });

  test('in EDIT mode a footnote lands between two runs INSIDE a link', () => {
    withSurface(
      '<w:p><w:r><w:t xml:space="preserve">See </w:t></w:r>' +
        '<w:hyperlink w:anchor="x"><w:r><w:t>Gu</w:t></w:r><w:r><w:t>ide</w:t></w:r></w:hyperlink></w:p>',
      (surface) => {
        surface.setEditingMode('edit');
        caretTo(surface, 0, 'See Gu'.length);
        expect(surface.insertNote('footnote')).toBe(true);
        expect(surface.state().lastRejection).toBeNull();
        const xml = serializeOoxmlPart(surface.session.part());
        // The citation joins the link's own content at the caret, not before the whole
        // link and not at the paragraph's end.
        expect(xml).toMatch(
          /Gu<\/w:t><\/w:r><w:r><w:rPr><w:rStyle w:val="FootnoteReference"\/><\/w:rPr><w:footnoteReference[^>]*\/><\/w:r><w:r><w:t[^>]*>ide/
        );
      }
    );
  });

  test('in EDIT mode a link made at a caret in struck words lands past the deletion too', () => {
    withSurface(
      '<w:p><w:r><w:t xml:space="preserve">Alpha </w:t></w:r>' +
        '<w:del w:id="5" w:author="Grace Hopper" w:date="2026-01-01T00:00:00Z">' +
        '<w:r><w:delText>Beta</w:delText></w:r></w:del>' +
        '<w:r><w:t xml:space="preserve"> Gamma</w:t></w:r></w:p>',
      (surface) => {
        surface.setEditingMode('edit');
        caretTo(surface, 0, 'Alpha Be'.length);
        expect(
          surface.hyperlinks.applyHyperlink({ url: 'https://example.com', text: 'docs' })
        ).toBe(true);
        expect(surface.state().lastRejection).toBeNull();
        const xml = serializeOoxmlPart(surface.session.part());
        // The untracked insert relocates beside the deletion exactly as the tracked one
        // does; a wrap built on the raw caret offset sliced the w:del instead.
        expect(xml).toMatch(
          /<\/w:del><w:hyperlink[^>]*><w:r>(?:<w:rPr><w:rStyle w:val="Hyperlink"\/><\/w:rPr>)?<w:t[^>]*>docs<\/w:t><\/w:r><\/w:hyperlink>/
        );
      }
    );
  });

  test('renaming a link with a strike abutting its end still accepts as a LINK', () => {
    withSurface(plainParagraph('Alpha Docs tail'), (surface) => {
      surface.setEditingMode('edit');
      selectIn(surface, 0, 'Alpha '.length, 'Alpha Docs'.length);
      expect(surface.hyperlinks.applyHyperlink({ url: 'https://example.com' })).toBe(true);
      surface.setEditingMode('suggest');
      // Strike the character right after the link, so the deletion abuts its closing edge.
      selectIn(surface, 0, 'Alpha Docs'.length, 'Alpha Docs '.length);
      surface.deleteBackward();
      caretTo(surface, 0, 'Alpha Do'.length);
      expect(surface.hyperlinks.applyHyperlink({ url: 'https://example.org', text: 'Guide' })).toBe(
        true
      );
      expect(surface.state().lastRejection).toBeNull();
      const accepted = surface.session.applyTreeOps([{ op: 'acceptAllRevisions' }]);
      expect(accepted.committed).toBe(true);
      // Whichever branch placed the copy, the accepted rename must stay LINKED: the copy
      // relocating past the abutting deletion used to land it beside the link, and
      // accepting swept the emptied link and left plain text.
      const xml = serializeOoxmlPart(surface.session.part());
      expect(xml).toMatch(/<w:hyperlink[^>]*>(?:(?!<\/w:hyperlink>).)*Guide/);
    });
  });

  test('an authored EMPTY link is still reachable and removable', () => {
    withSurface(
      '<w:p><w:r><w:t xml:space="preserve">Go </w:t></w:r>' +
        '<w:hyperlink w:anchor="x"/><w:r><w:t>on</w:t></w:r></w:p>',
      (surface) => {
        caretTo(surface, 0, 3);
        const link = surface.hyperlinks.linksInCaretParagraph()[0]!;
        expect(link.start).toBe(3);
        expect(link.end).toBe(3);
        expect(surface.hyperlinks.removeHyperlink(link.id)).toBe(true);
        expect(serializeOoxmlPart(surface.session.part())).not.toMatch(/<w:hyperlink/);
      }
    );
  });

  test('in EDIT mode a footnote lands between runs nested TWO containers deep', () => {
    withSurface(
      '<w:p><w:r><w:t xml:space="preserve">See </w:t></w:r>' +
        '<w:sdt><w:sdtPr><w:tag w:val="t1"/></w:sdtPr><w:sdtContent>' +
        '<w:r><w:t>Gu</w:t></w:r><w:r><w:t>ide</w:t></w:r>' +
        '</w:sdtContent></w:sdt></w:p>',
      (surface) => {
        surface.setEditingMode('edit');
        caretTo(surface, 0, 'See Gu'.length);
        expect(surface.insertNote('footnote')).toBe(true);
        expect(surface.state().lastRejection).toBeNull();
        const xml = serializeOoxmlPart(surface.session.part());
        expect(xml).toMatch(
          /Gu<\/w:t><\/w:r><w:r><w:rPr><w:rStyle w:val="FootnoteReference"\/><\/w:rPr><w:footnoteReference[^>]*\/><\/w:r><w:r><w:t[^>]*>ide/
        );
      }
    );
  });

  test('a hyperlink over a selection proposes a tracked replacement, wrapped', () => {
    withSurface(plainParagraph('Alpha Beta Gamma'), (surface) => {
      selectIn(surface, 0, 'Alpha '.length, 'Alpha Beta'.length);
      expect(surface.hyperlinks.applyHyperlink({ url: 'https://example.com' })).toBe(true);
      expect(surface.state().lastRejection).toBeNull();
      const xml = serializeOoxmlPart(surface.session.part());
      // Struck original first, then the linked copy as this author's proposal — the same
      // reading order every replacement writes. The link wraps ONLY the copy.
      expect(xml).toMatch(
        /<w:del[^>]*><w:r>(?:<w:rPr><w:rStyle w:val="Hyperlink"\/><\/w:rPr>)?<w:delText[^>]*>Beta<\/w:delText><\/w:r><\/w:del><w:hyperlink[^>]*r:id="[^"]+"[^>]*><w:ins[^>]*w:author="Ada Lovelace"[^>]*><w:r>(?:<w:rPr><w:rStyle w:val="Hyperlink"\/><\/w:rPr>)?<w:t[^>]*>Beta<\/w:t><\/w:r><\/w:ins><\/w:hyperlink>/
      );
      // The caret lands after the linked copy, where the next keystroke belongs.
      expect(surface.state().selection.head.offset).toBe('Alpha BetaBeta'.length);
      // The link reads back at the copy's own offsets: the offset walk counts the runs the
      // tracked edit wraps, or the popover would open on a zero-length link.
      const link = surface.hyperlinks.linksInCaretParagraph()[0]!;
      expect(link.text).toBe('Beta');
      expect(link.start).toBe('Alpha Beta'.length);
      expect(link.end).toBe('Alpha BetaBeta'.length);
    });
  });

  test('rejecting the link proposal restores the original words and sweeps the link', () => {
    withSurface(plainParagraph('Alpha Beta Gamma'), (surface) => {
      selectIn(surface, 0, 'Alpha '.length, 'Alpha Beta'.length);
      expect(surface.hyperlinks.applyHyperlink({ url: 'https://example.com' })).toBe(true);
      const rejected = surface.session.applyTreeOps([{ op: 'rejectAllRevisions' }]);
      expect(rejected.committed).toBe(true);
      expect(paragraphTexts(surface)).toEqual(['Alpha Beta Gamma']);
      const xml = serializeOoxmlPart(surface.session.part());
      expect(xml).not.toMatch(/<w:hyperlink/);
      expect(xml).not.toMatch(/<w:ins /);
      expect(xml).not.toMatch(/<w:del /);
    });
  });

  test('accepting the link proposal keeps the link and removes the struck words', () => {
    withSurface(plainParagraph('Alpha Beta Gamma'), (surface) => {
      selectIn(surface, 0, 'Alpha '.length, 'Alpha Beta'.length);
      expect(surface.hyperlinks.applyHyperlink({ url: 'https://example.com' })).toBe(true);
      const accepted = surface.session.applyTreeOps([{ op: 'acceptAllRevisions' }]);
      expect(accepted.committed).toBe(true);
      expect(paragraphTexts(surface)).toEqual(['Alpha Beta Gamma']);
      const xml = serializeOoxmlPart(surface.session.part());
      expect(xml).toMatch(
        /<w:hyperlink[^>]*><w:r>(?:<w:rPr><w:rStyle w:val="Hyperlink"\/><\/w:rPr>)?<w:t[^>]*>Beta<\/w:t><\/w:r><\/w:hyperlink>/
      );
      expect(xml).not.toMatch(/<w:del /);
    });
  });

  test('a link at a collapsed caret wraps its own tracked display text', () => {
    withSurface(plainParagraph('Alpha Beta'), (surface) => {
      caretTo(surface, 0, 'Alpha'.length);
      expect(surface.hyperlinks.applyHyperlink({ url: 'https://example.com', text: 'docs' })).toBe(
        true
      );
      const xml = serializeOoxmlPart(surface.session.part());
      expect(xml).toMatch(
        /<w:hyperlink[^>]*><w:ins[^>]*w:author="Ada Lovelace"[^>]*><w:r>(?:<w:rPr><w:rStyle w:val="Hyperlink"\/><\/w:rPr>)?<w:t[^>]*>docs<\/w:t><\/w:r><\/w:ins><\/w:hyperlink>/
      );
    });
  });

  test('a page field is ONE tracked proposal, atom and all', () => {
    withSurface(plainParagraph('Page '), (surface) => {
      const paragraphId = surface.session.paragraphIds()[0]!;
      const result = surface.applyAutomationOps(() => [
        { op: 'insertPageField', paragraphId, offset: 'Page '.length, field: 'PAGE' },
      ]);
      expect(result.committed).toBe(true);
      const xml = serializeOoxmlPart(surface.session.part());
      expect(xml).toMatch(/<w:ins[^>]*w:author="Ada Lovelace"[^>]*><w:r><w:fldChar/);
      const rejected = surface.session.applyTreeOps([{ op: 'rejectAllRevisions' }]);
      expect(rejected.committed).toBe(true);
      expect(serializeOoxmlPart(surface.session.part())).not.toMatch(/fldChar/);
    });
  });

  test('a footnote citation is proposed, and rejecting it sweeps the note body', () => {
    withSurface(plainParagraph('Alpha one'), (surface) => {
      caretTo(surface, 0, 'Alpha'.length);
      expect(surface.insertNote('footnote')).toBe(true);
      expect(surface.state().lastRejection).toBeNull();
      const xml = serializeOoxmlPart(surface.session.part());
      // The citing reference is the proposal; the note body stays plain.
      expect(xml).toMatch(
        /<w:ins[^>]*w:author="Ada Lovelace"[^>]*><w:r><w:rPr><w:rStyle w:val="FootnoteReference"\/><\/w:rPr><w:footnoteReference w:id="\d+"\/><\/w:r><\/w:ins>/
      );
      const notesPartName = [...surface.session.currentPackage().parts.keys()].find((name) =>
        name.includes('footnotes')
      )!;
      expect(
        serializeOoxmlPart(surface.session.currentPackage().parts.get(notesPartName)!)
      ).toMatch(/<w:footnote w:id="\d+"/);

      const rejected = surface.session.applyTreeOps([{ op: 'rejectAllRevisions' }]);
      expect(rejected.committed).toBe(true);
      const after = serializeOoxmlPart(surface.session.part());
      expect(after).not.toMatch(/footnoteReference/);
      expect(after).not.toMatch(/<w:ins /);
      // The orphaned body goes with the rejected citation — the same cascade an untracked
      // reference deletion takes.
      const notesAfter = serializeOoxmlPart(
        surface.session.currentPackage().parts.get(notesPartName)!
      );
      expect(notesAfter).not.toMatch(/<w:footnote w:id="[1-9]/);
    });
  });
});
