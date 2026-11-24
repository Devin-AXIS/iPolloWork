// A toolbar reads the cascade from the RIGHT END, and a spacing write survives autospacing.
//
// The layout hands the editor lane a paragraph's properties FLATTENED: one entry per level
// of the cascade — `w:docDefaults`, each style in the `basedOn` chain, then the paragraph's
// own `w:pPr` — in that order, lowest precedence first. Every read here took the FIRST
// matching entry, which is the document's defaults and never what the paragraph is actually
// written in. On Word's own blank template that meant:
//
//   * "Add space before paragraph" wrote 24pt and the menu went on saying "Add", because the
//     read still answered the `w:docDefaults` 8pt beside it (issue #360);
//   * the line-spacing tick never moved off the default row;
//   * the alignment button stayed pressed on the style's alignment after a press changed it;
//   * Increase Indent re-read the style's indent and rewrote the same single step forever.
//
// Separately, `w:beforeAutospacing` REPLACES the measurement beside it, so on a document
// whose defaults carry the flag — what Word writes for HTML-shaped content — a space-before
// write landed in the XML and moved nothing on the page at all.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { createKeyDownHandler } from '../surface-input.ts';
import { mountPaginatedSurface } from '../paginated-surface.ts';
import { docx as surfaceDocx } from './paginated-surface-fixtures.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STYLE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

/** `w:docDefaults` + a style that states its own alignment, indent and spacing. */
const STYLES =
  `<w:styles xmlns:w="${W}">` +
  '<w:docDefaults><w:pPrDefault><w:pPr>' +
  '<w:spacing w:after="160" w:line="259" w:lineRule="auto"/>' +
  '</w:pPr></w:pPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Fancy"><w:name w:val="Fancy"/><w:pPr>' +
  '<w:jc w:val="center"/><w:ind w:left="720"/><w:spacing w:before="240" w:after="240"/>' +
  '</w:pPr></w:style>' +
  '</w:styles>';

/** Word's HTML-shaped defaults: a measurement with the autospacing flag on top of it. */
const AUTOSPACING_STYLES =
  `<w:styles xmlns:w="${W}">` +
  '<w:docDefaults><w:pPrDefault><w:pPr>' +
  '<w:spacing w:before="100" w:beforeAutospacing="1" w:after="100" w:afterAutospacing="1"/>' +
  '</w:pPr></w:pPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>' +
  '</w:styles>';

function docx(body: string, styles: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId9" Type="${STYLE_REL}" Target="styles.xml"/></Relationships>`
    ),
    'word/styles.xml': strToU8(styles),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

function mount(body: string, styles = STYLES): DocxEditorInstance {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: docx(body, styles) });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

const FANCY = '<w:p><w:pPr><w:pStyle w:val="Fancy"/></w:pPr><w:r><w:t>alpha</w:t></w:r></w:p>';

/** The gap the first paragraph is laid out with, in points. */
function paintedSpacing(editor: DocxEditorInstance): { before: number; after: number } {
  const fragment = editor.surface!.layout().pages[0]!.fragments[0];
  if (!fragment || fragment.kind !== 'paragraph') throw new Error('no paragraph fragment');
  return { before: fragment.spacing.before, after: fragment.spacing.after };
}

describe('paragraph reads answer the cascade, not its floor', () => {
  test('space before/after report what the paragraph was just given (issue #360)', () => {
    const container = document.createElement('div');
    document.body.append(container);
    // Word's blank template, whose `w:docDefaults` state 8pt after and nothing before.
    const editor = createDocxEditor({ container, document: 'blank' });
    editor.exec({ type: 'insertText', text: 'Hello world' });
    expect(editor.snapshot().formatting?.spaceAfterPt).toBe(8);

    expect(editor.exec({ type: 'setParagraphSpacing', beforePt: 24, afterPt: 24 }).ok).toBe(true);
    expect(editor.snapshot().formatting?.spaceBeforePt).toBe(24);
    expect(editor.snapshot().formatting?.spaceAfterPt).toBe(24);
    expect(paintedSpacing(editor)).toEqual({ before: 24, after: 24 });
  });

  test('the line-spacing read follows the pick, not the document default', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container, document: 'blank' });
    editor.exec({ type: 'insertText', text: 'Hello world' });
    // 259/240 — the blank template's own multiple, which is what the menu ticks first.
    expect(editor.snapshot().formatting?.lineSpacing).toEqual({ rule: 'multiple', value: 1.08 });

    expect(editor.exec({ type: 'setLineSpacing', rule: 'multiple', value: 2 }).ok).toBe(true);
    expect(editor.snapshot().formatting?.lineSpacing).toEqual({ rule: 'multiple', value: 2 });
  });

  test('a cascade that states no line spacing reads as the single spacing it lays out at', () => {
    const editor = mount('<w:p><w:r><w:t>alpha</w:t></w:r></w:p>', AUTOSPACING_STYLES);
    expect(editor.snapshot().formatting?.lineSpacing).toEqual({ rule: 'multiple', value: 1 });
    expect(editor.snapshot().formatting?.disagrees.lineSpacing).toBe(false);
  });

  test('an exact line spacing reads in points', () => {
    const editor = mount(
      '<w:p><w:pPr><w:spacing w:line="250" w:lineRule="exact"/></w:pPr>' +
        '<w:r><w:t>alpha</w:t></w:r></w:p>'
    );
    expect(editor.snapshot().formatting?.lineSpacing).toEqual({ rule: 'exact', value: 12.5 });
  });

  test('a style-supplied value reads through, and a press over it reads back', () => {
    const editor = mount(FANCY);
    expect(editor.snapshot().formatting?.alignment).toBe('center');
    expect(editor.snapshot().formatting?.spaceBeforePt).toBe(12);
    expect(editor.snapshot().formatting?.spaceAfterPt).toBe(12);

    expect(editor.exec({ type: 'setAlignment', align: 'left' }).ok).toBe(true);
    expect(editor.snapshot().formatting?.alignment).toBe('left');

    expect(editor.exec({ type: 'setParagraphSpacing', afterPt: 0 }).ok).toBe(true);
    // Explicit zero, the way Word's "Remove space after paragraph" writes it: it blocks the
    // style's 12pt rather than letting it back in.
    expect(editor.snapshot().formatting?.spaceAfterPt).toBe(0);
    expect(paintedSpacing(editor).after).toBe(0);
  });

  test('Increase Indent keeps stepping past the style indent', () => {
    const editor = mount(FANCY);
    const left = () => editor.snapshot().formatting?.indent?.left;
    expect(left()).toBe(720);
    for (const expected of [1440, 2160, 2880]) {
      expect(editor.exec({ type: 'adjustIndent', direction: 'increase' }).ok).toBe(true);
      expect(left()).toBe(expected);
    }
    expect(editor.exec({ type: 'adjustIndent', direction: 'decrease' }).ok).toBe(true);
    expect(left()).toBe(2160);
  });

  test('Increase Indent steps forward when the two spellings of w:ind meet', () => {
    // `w:left` is the transitional spelling, `w:start` the ISO Strict one, and they are two
    // spellings of ONE setting. Merged per ATTRIBUTE the style's `w:left` outranked the
    // paragraph's own `w:start`, and the press moved the paragraph BACKWARDS.
    const editor = mount(
      '<w:p><w:pPr><w:pStyle w:val="Fancy"/><w:ind w:start="2880"/></w:pPr>' +
        '<w:r><w:t>alpha</w:t></w:r></w:p>'
    );
    const left = () => editor.snapshot().formatting?.indent?.left;
    expect(left()).toBe(2880);
    expect(editor.exec({ type: 'adjustIndent', direction: 'increase' }).ok).toBe(true);
    expect(left()).toBe(3600);
  });
});

describe('a merged paragraph reports an indent for every half', () => {
  test('the ruler keeps its handles with the caret in the absorbed half', () => {
    // `proposed` is what the free engine renders by default, and it lays a deleted
    // paragraph mark out as ONE paragraph under the survivor's name. The indent index
    // recorded only that name, so the caret in the other half read no indent at all and
    // the ruler dropped all four handles over an ordinary body paragraph.
    const container = document.createElement('div');
    document.body.append(container);
    const opened = mountPaginatedSurface(
      container,
      surfaceDocx(
        '<w:p><w:pPr><w:rPr><w:del w:id="1" w:author="A"/></w:rPr></w:pPr>' +
          '<w:r><w:t xml:space="preserve">Hello </w:t></w:r></w:p>' +
          '<w:p><w:pPr><w:ind w:left="720"/></w:pPr><w:r><w:t>world</w:t></w:r></w:p>'
      ),
      { revisionDisplayMode: 'proposed' }
    );
    if (!opened.ok) throw new Error(opened.reason);
    const surface = opened.surface;
    const ids = surface.session.paragraphIds();

    for (const id of ids) {
      surface.setSelection({
        anchor: { paragraphId: id, offset: 1 },
        head: { paragraphId: id, offset: 1 },
      });
      // Both halves are drawn under the survivor's `w:ind`, so both report it.
      expect(surface.formatting().indent?.left).toBe(720);
    }
    surface.destroy();
    container.remove();
  });
});

describe('the line-spacing shortcut keeps the paragraph spacing beside it', () => {
  test('Ctrl+2 double-spaces without deleting space before/after', () => {
    // `w:spacing` carries three independent settings, so the chord has to MERGE the way the
    // toolbar's own `setLineSpacing` does. Replacing the element made Ctrl+2 silently drop
    // the paragraph's space before and after on its way to double-spacing it.
    const editor = mount(
      '<w:p><w:pPr><w:spacing w:before="240" w:after="240"/></w:pPr>' +
        '<w:r><w:t>alpha</w:t></w:r></w:p>'
    );
    expect(paintedSpacing(editor)).toEqual({ before: 12, after: 12 });

    const onKeyDown = createKeyDownHandler(editor.surface!);
    onKeyDown({
      key: '2',
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      preventDefault: () => {},
    } as KeyboardEvent);

    expect(paintedSpacing(editor)).toEqual({ before: 12, after: 12 });
    expect(editor.snapshot().formatting?.lineSpacing).toEqual({ rule: 'multiple', value: 2 });
  });
});

describe('a paragraph can switch its style page break off', () => {
  test('w:pageBreakBefore w:val="0" over a style that sets it keeps one page', () => {
    const styles =
      `<w:styles xmlns:w="${W}">` +
      '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Chapter"><w:name w:val="Chapter"/>' +
      '<w:pPr><w:pageBreakBefore/></w:pPr></w:style>' +
      '</w:styles>';
    const breaking = mount(
      '<w:p><w:r><w:t>alpha</w:t></w:r></w:p>' +
        '<w:p><w:pPr><w:pStyle w:val="Chapter"/></w:pPr><w:r><w:t>beta</w:t></w:r></w:p>',
      styles
    );
    expect(breaking.surface!.layout().pages.length).toBe(2);

    // Word writes this when the author unchecks "Page break before" on one instance. Read
    // any-wins, the style's own entry still matched and the document grew a blank page.
    const cancelled = mount(
      '<w:p><w:r><w:t>alpha</w:t></w:r></w:p>' +
        '<w:p><w:pPr><w:pStyle w:val="Chapter"/><w:pageBreakBefore w:val="0"/></w:pPr>' +
        '<w:r><w:t>beta</w:t></w:r></w:p>',
      styles
    );
    expect(cancelled.surface!.layout().pages.length).toBe(1);
  });

  test('"off" is an off value, like every other ST_OnOff read', () => {
    const editor = mount(
      '<w:p><w:r><w:t>alpha</w:t></w:r></w:p>' +
        '<w:p><w:pPr><w:pageBreakBefore w:val="off"/></w:pPr><w:r><w:t>beta</w:t></w:r></w:p>'
    );
    expect(editor.surface!.layout().pages.length).toBe(1);
  });
});

describe('auto paragraph spacing yields to an explicit write', () => {
  test('a space-before write moves the page even under an inherited flag', () => {
    const editor = mount('<w:p><w:r><w:t>alpha</w:t></w:r></w:p>', AUTOSPACING_STYLES);
    // The flag REPLACES the 5pt beside it. Its space before drops at the top of the document.
    expect(paintedSpacing(editor)).toEqual({ before: 0, after: 14 });

    expect(editor.exec({ type: 'setParagraphSpacing', beforePt: 36, afterPt: 36 }).ok).toBe(true);
    expect(paintedSpacing(editor)).toEqual({ before: 36, after: 36 });
    expect(editor.snapshot().formatting?.spaceBeforePt).toBe(36);
  });

  test('the flag is cleared explicitly, so a save/reopen keeps the value', () => {
    const editor = mount('<w:p><w:r><w:t>alpha</w:t></w:r></w:p>', AUTOSPACING_STYLES);
    editor.exec({ type: 'setParagraphSpacing', beforePt: 36 });
    const xml = serializeOoxmlPart(editor.surface!.session.part());
    // Written as "0" rather than dropped: dropping it lets the inherited flag win again.
    expect(xml).toContain('w:beforeAutospacing="0"');
    expect(xml).toContain('w:before="720"');
  });

  test('removing the space removes the flag with it', () => {
    const editor = mount('<w:p><w:r><w:t>alpha</w:t></w:r></w:p>', AUTOSPACING_STYLES);
    editor.exec({ type: 'setParagraphSpacing', beforePt: 36 });
    editor.exec({ type: 'setParagraphSpacing', beforePt: null });
    // Both gone, so the paragraph inherits the pair the document defaults state. The
    // inherited flag drops space before at the top of the document; without it, 5pt shows.
    expect(paintedSpacing(editor)).toEqual({ before: 0, after: 14 });
  });

  test('list boundary auto spacing does not change the authored spacing read', () => {
    const numbering =
      `<w:numbering xmlns:w="${W}">` +
      '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/>' +
      '<w:lvlText w:val="&#8226;"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>' +
      '</w:lvl></w:abstractNum>' +
      '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
      '</w:numbering>';
    const container = document.createElement('div');
    document.body.append(container);
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
          '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId9" Type="${STYLE_REL}" Target="styles.xml"/>` +
          '<Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>'
      ),
      'word/styles.xml': strToU8(AUTOSPACING_STYLES),
      'word/numbering.xml': strToU8(numbering),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body>` +
          '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
          '<w:r><w:t>item</w:t></w:r></w:p>' +
          `</w:body></w:document>`
      ),
    });
    const editor = createDocxEditor({ container, document: bytes });
    // A list at section start has no leading auto margin, but keeps its trailing one.
    expect(paintedSpacing(editor)).toEqual({ before: 0, after: 14 });
    // The read answers the MEASUREMENT the cascade states (100 twips), not that resolved
    // gap: resolving it needs list and cell membership, which this lane cannot see without
    // guessing. Documented on `spaceBeforePt`.
    expect(editor.snapshot().formatting?.spaceBeforePt).toBe(5);

    // The write still has to land, which is the half that matters: an explicit space beats
    // the flag even here.
    expect(editor.exec({ type: 'setParagraphSpacing', beforePt: 18 }).ok).toBe(true);
    expect(paintedSpacing(editor).before).toBe(18);
  });
});
