// The Paragraph dialog as one command.
//
// The dialog changes alignment, indents, spacing, line spacing and five flags at once, so
// it writes ONE transaction: pressing OK is one undo step and the page repaints once. A
// command per field would leave the user pressing Ctrl+Z five times to take back one OK.
//
// Every bound the single-purpose commands apply is applied here too — this is a convenience
// over the same writes, not a way around their validation.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const p = (text: string, pPr = '') =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;

function mount(body: string): DocxEditorInstance {
  const container = document.createElement('div');
  document.body.append(container);
  const bytes = zipSync({
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
  const editor = createDocxEditor({ container, document: bytes });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

/** A document whose `Tabbed` style carries a centre stop at 1.5 inches. */
function mountStyled(body: string): DocxEditorInstance {
  const container = document.createElement('div');
  document.body.append(container);
  const styles =
    `<w:styles xmlns:w="${W}">` +
    '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Tabbed"><w:name w:val="Tabbed"/>' +
    '<w:pPr><w:tabs><w:tab w:val="center" w:pos="2160"/></w:tabs></w:pPr></w:style>' +
    // Keeps with the next paragraph, and turns Word's ON-by-default widow control OFF.
    '<w:style w:type="paragraph" w:styleId="Kept"><w:name w:val="Kept"/>' +
    '<w:pPr><w:keepNext/><w:widowControl w:val="0"/></w:pPr></w:style>' +
    '</w:styles>';
  const bytes = zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId9" Type="${OD.replace('officeDocument', 'styles')}" Target="styles.xml"/></Relationships>`
    ),
    'word/styles.xml': strToU8(styles),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
  const editor = createDocxEditor({ container, document: bytes });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

/**
 * A document whose HEADER carries a paragraph on the `Tabbed` style.
 *
 * Header, footer and note fragments hang off their own page roots rather than
 * `page.fragments`, so a write that asks a body-only walk what is in force sees nothing
 * there — and clearing a style-supplied stop in a header silently did nothing while
 * reporting success.
 */
function mountWithHeader(): DocxEditorInstance {
  const container = document.createElement('div');
  document.body.append(container);
  const styles =
    `<w:styles xmlns:w="${W}">` +
    '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Tabbed"><w:name w:val="Tabbed"/>' +
    '<w:pPr><w:tabs><w:tab w:val="center" w:pos="2160"/></w:tabs></w:pPr></w:style>' +
    '</w:styles>';
  const header =
    `<w:hdr xmlns:w="${W}">` +
    '<w:p><w:pPr><w:pStyle w:val="Tabbed"/></w:pPr><w:r><w:t>heading</w:t></w:r></w:p>' +
    '</w:hdr>';
  const body =
    '<w:p><w:r><w:t>alpha</w:t></w:r></w:p>' +
    '<w:sectPr><w:headerReference w:type="default" r:id="rIdHdr"/>' +
    '<w:pgSz w:w="12240" w:h="15840"/>' +
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>' +
    '</w:sectPr>';
  const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const bytes = zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId9" Type="${REL_NS}/styles" Target="styles.xml"/>` +
        `<Relationship Id="rIdHdr" Type="${REL_NS}/header" Target="header1.xml"/>` +
        '</Relationships>'
    ),
    'word/styles.xml': strToU8(styles),
    'word/header1.xml': strToU8(header),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${REL_NS}"><w:body>${body}</w:body></w:document>`
    ),
  });
  const editor = createDocxEditor({ container, document: bytes });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

const xmlOf = (editor: DocxEditorInstance) => serializeOoxmlPart(editor.surface!.session.part());

describe('setParagraphFormat writes the whole dialog at once', () => {
  test('every field lands, in one undoable step', () => {
    const editor = mount(p('alpha'));
    editor.surface!.selectAll();

    expect(
      editor.exec({
        type: 'setParagraphFormat',
        alignment: 'justify',
        spaceBeforePt: 12,
        spaceAfterPt: 6,
        lineSpacing: { rule: 'multiple', value: 1.5 },
        indentLeftTwips: 720,
        indentRightTwips: 360,
        indentFirstLineTwips: -360,
        contextualSpacing: true,
        keepNext: true,
        keepLines: false,
        widowControl: true,
        pageBreakBefore: false,
      }).ok
    ).toBe(true);

    const xml = xmlOf(editor);
    expect(xml).toContain('w:jc w:val="both"');
    expect(xml).toContain('w:before="240"');
    expect(xml).toContain('w:after="120"');
    expect(xml).toContain('w:line="360"');
    expect(xml).toContain('w:lineRule="auto"');
    expect(xml).toContain('w:left="720"');
    expect(xml).toContain('w:right="360"');
    // A negative first line is a HANGING indent, and the unused spelling is an explicit 0.
    expect(xml).toContain('w:hanging="360"');
    expect(xml).toContain('w:firstLine="0"');
    expect(xml).toContain('w:contextualSpacing w:val="1"');
    expect(xml).toContain('w:keepNext w:val="1"');
    // Off is an explicit zero, never a dropped element: the flag may come from the style.
    expect(xml).toContain('w:keepLines w:val="0"');
    expect(xml).toContain('w:widowControl w:val="1"');
    expect(xml).toContain('w:pageBreakBefore w:val="0"');

    // ONE undo step for the whole dialog: a single undo takes back every field above.
    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    const undone = xmlOf(editor);
    expect(undone).not.toContain('w:jc');
    expect(undone).not.toContain('w:spacing');
    expect(undone).not.toContain('w:ind');
  });

  test('an omitted field is left as authored', () => {
    const editor = mount(
      p('alpha', '<w:jc w:val="center"/><w:spacing w:before="240" w:after="240"/>')
    );
    editor.surface!.selectAll();
    // Only the line spacing is named.
    expect(
      editor.exec({ type: 'setParagraphFormat', lineSpacing: { rule: 'exact', value: 18 } }).ok
    ).toBe(true);
    const xml = xmlOf(editor);
    expect(xml).toContain('w:jc w:val="center"');
    expect(xml).toContain('w:before="240"');
    expect(xml).toContain('w:after="240"');
    expect(xml).toContain('w:lineRule="exact"');
    expect(xml).toContain('w:line="360"');
  });

  test('null removes a setting so the style supplies it again', () => {
    const editor = mount(p('alpha', '<w:spacing w:before="240"/><w:ind w:left="720"/>'));
    editor.surface!.selectAll();
    expect(
      editor.exec({
        type: 'setParagraphFormat',
        spaceBeforePt: null,
        indentLeftTwips: null,
      }).ok
    ).toBe(true);
    const xml = xmlOf(editor);
    expect(xml).not.toContain('w:before=');
    expect(xml).not.toContain('w:left=');
  });

  test('it writes every paragraph the selection touches', () => {
    const editor = mount(p('one') + p('two') + p('three'));
    editor.surface!.selectAll();
    editor.exec({ type: 'setParagraphFormat', alignment: 'right' });
    expect([...xmlOf(editor).matchAll(/w:jc w:val="right"/g)]).toHaveLength(3);
  });

  test('out-of-range values are refused rather than clamped', () => {
    const editor = mount(p('alpha'));
    editor.surface!.selectAll();
    const refused = editor.exec({ type: 'setParagraphFormat', indentLeftTwips: 99_999_999 });
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.code).toBe('invalidArgs');
    // Nothing was written, so a refused dialog leaves the document alone.
    expect(xmlOf(editor)).not.toContain('w:ind');

    const badSpacing = editor.exec({ type: 'setParagraphFormat', spaceBeforePt: -5 });
    expect(badSpacing.ok).toBe(false);
    const badLine = editor.exec({
      type: 'setParagraphFormat',
      lineSpacing: { rule: 'multiple', value: 0 },
    });
    expect(badLine.ok).toBe(false);
  });
});

describe('tab stops, which a flat property write could never author', () => {
  // `w:tabs` carries its meaning in `w:tab` CHILDREN, and `OoxmlProperty` is flat, so
  // `propertyElement` can PRESERVE stops but never create one. Hence a dedicated op — the
  // same reason `setListNumbering` is one for `w:numPr`.
  test('stops are written, sorted, and read back through the cascade', () => {
    const editor = mount(p('alpha'));
    editor.surface!.selectAll();
    expect(
      editor.exec({
        type: 'setParagraphFormat',
        tabStops: [
          { positionTwips: 2880, alignment: 'right', leader: 'dot' },
          { positionTwips: 1440, alignment: 'left' },
        ],
      }).ok
    ).toBe(true);

    const xml = xmlOf(editor);
    // Ascending position, which is the order a reader placing them expects.
    expect(xml.indexOf('w:pos="1440"')).toBeLessThan(xml.indexOf('w:pos="2880"'));
    expect(xml).toContain('w:val="left"');
    expect(xml).toContain('w:val="right"');
    expect(xml).toContain('w:leader="dot"');
    // `w:leader` defaults to none, so the plain stop carries no redundant attribute.
    expect([...xml.matchAll(/w:leader=/g)]).toHaveLength(1);

    expect(editor.surface!.formatting().tabStops).toEqual([
      { positionTwips: 1440, alignment: 'left' },
      { positionTwips: 2880, alignment: 'right', leader: 'dot' },
    ]);
  });

  test('w:tabs lands in its CT_PPrBase slot, not in front of what outranks it', () => {
    // `CT_PPrBase` is a strict `xsd:sequence`. This is the whole reason the dialog needs a
    // schema-ranked insert: it always sends the pagination flags, so nearly every OK that
    // carries a tab stop writes into a `w:pPr` that already holds `w:keepNext`.
    const editor = mount(p('alpha', '<w:keepNext w:val="1"/>'));
    editor.surface!.selectAll();
    editor.exec({
      type: 'setParagraphFormat',
      keepLines: true,
      tabStops: [{ positionTwips: 1440, alignment: 'left' }],
    });

    const xml = xmlOf(editor);
    const order = [...xml.matchAll(/<w:(keepNext|keepLines|tabs|spacing|ind|jc)[ />]/g)].map(
      (match) => match[1]
    );
    // Sequence slots: keepNext 2, keepLines 3, tabs 11.
    expect(order.indexOf('tabs')).toBeGreaterThan(order.indexOf('keepNext'));
    expect(order.indexOf('tabs')).toBeGreaterThan(order.indexOf('keepLines'));
  });

  test('and stays ahead of the properties IT outranks', () => {
    const editor = mount(p('alpha', '<w:jc w:val="center"/>'));
    editor.surface!.selectAll();
    editor.exec({
      type: 'setParagraphFormat',
      spaceBeforePt: 12,
      tabStops: [{ positionTwips: 1440, alignment: 'left' }],
    });

    const xml = xmlOf(editor);
    const order = [...xml.matchAll(/<w:(tabs|spacing|jc)[ />]/g)].map((match) => match[1]);
    // Sequence slots: tabs 11, spacing 22, jc 27.
    expect(order).toEqual(['tabs', 'spacing', 'jc']);
  });

  test('an empty list clears them, and omitting the field leaves them alone', () => {
    const editor = mount(p('alpha', '<w:tabs><w:tab w:val="left" w:pos="1440"/></w:tabs>'));
    editor.surface!.selectAll();
    expect(editor.surface!.formatting().tabStops).toHaveLength(1);

    // Another field, tab stops unnamed: the stops survive.
    editor.exec({ type: 'setParagraphFormat', alignment: 'center' });
    expect(editor.surface!.formatting().tabStops).toHaveLength(1);
    expect(xmlOf(editor)).toContain('w:pos="1440"');

    // "Clear all". The stop was in force, so it is suppressed with an explicit `clear`
    // rather than merely dropped — see the op's note on the paragraph/style overlap.
    editor.exec({ type: 'setParagraphFormat', tabStops: [] });
    expect(xmlOf(editor)).toContain('w:val="clear"');
    expect(editor.surface!.formatting().tabStops).toEqual([]);
  });

  test('clearing a STYLE stop suppresses it, rather than reporting a success that did nothing', () => {
    // Stops are read through the cascade and written at the paragraph, so a plain replace
    // cannot remove one a style supplies: the user clears the row, the style puts it back,
    // and the command still says ok. `w:val="clear"` is what OOXML has for this.
    const editor = mountStyled(
      '<w:p><w:pPr><w:pStyle w:val="Tabbed"/></w:pPr><w:r><w:t>alpha</w:t></w:r></w:p>'
    );
    editor.surface!.selectAll();
    expect(editor.surface!.formatting().tabStops).toEqual([
      { positionTwips: 2160, alignment: 'center' },
    ]);

    expect(editor.exec({ type: 'setParagraphFormat', tabStops: [] }).ok).toBe(true);
    expect(xmlOf(editor)).toContain('w:val="clear"');
    expect(editor.surface!.formatting().tabStops).toEqual([]);
  });

  test('a deleted row does not come back from the style on the next read', () => {
    const editor = mountStyled(
      '<w:p><w:pPr><w:pStyle w:val="Tabbed"/>' +
        '<w:tabs><w:tab w:val="left" w:pos="1440"/></w:tabs></w:pPr>' +
        '<w:r><w:t>alpha</w:t></w:r></w:p>'
    );
    editor.surface!.selectAll();
    expect(editor.surface!.formatting().tabStops).toHaveLength(2);

    // Delete the style's 2160 row, keep the paragraph's own 1440.
    editor.exec({
      type: 'setParagraphFormat',
      tabStops: [{ positionTwips: 1440, alignment: 'left' }],
    });
    expect(editor.surface!.formatting().tabStops).toEqual([
      { positionTwips: 1440, alignment: 'left' },
    ]);
  });

  test('a paragraph-authored stop is cleared explicitly, not merely dropped', () => {
    // Dropping it is enough ONLY when the position is exclusively direct, and the write
    // cannot tell: where the paragraph and its style both set 2160, dropping the direct one
    // let the style's take its place and "Clear All" silently did nothing. Every unwanted
    // in-force position gets a `clear`; a redundant one is inert.
    const editor = mount(p('alpha', '<w:tabs><w:tab w:val="left" w:pos="1440"/></w:tabs>'));
    editor.surface!.selectAll();
    editor.exec({ type: 'setParagraphFormat', tabStops: [] });
    expect(xmlOf(editor)).toContain('w:val="clear"');
    expect(editor.surface!.formatting().tabStops).toEqual([]);
  });

  test('a stop the paragraph AND its style both set is really removed', () => {
    // The case the "no redundant clear" rule got wrong.
    const editor = mountStyled(
      '<w:p><w:pPr><w:pStyle w:val="Tabbed"/>' +
        '<w:tabs><w:tab w:val="right" w:pos="2160"/></w:tabs></w:pPr>' +
        '<w:r><w:t>alpha</w:t></w:r></w:p>'
    );
    editor.surface!.selectAll();
    expect(editor.surface!.formatting().tabStops).toEqual([
      { positionTwips: 2160, alignment: 'right' },
    ]);
    editor.exec({ type: 'setParagraphFormat', tabStops: [] });
    // Not back as the style's centre stop, which is what used to happen.
    expect(editor.surface!.formatting().tabStops).toEqual([]);
  });

  test('repeated identical OKs converge, rather than flipping the document between two states', () => {
    // A `clear` is STATE, not something to re-derive: a cleared stop is by definition absent
    // from what is in force, so nothing downstream can tell the next write to keep clearing
    // it. Dropping it made pass N and pass N+1 produce different documents, forever.
    const editor = mountStyled(
      '<w:p><w:pPr><w:pStyle w:val="Tabbed"/>' +
        '<w:tabs><w:tab w:val="left" w:pos="1440"/></w:tabs></w:pPr>' +
        '<w:r><w:t>alpha</w:t></w:r></w:p>'
    );
    editor.surface!.selectAll();
    // The dialog seeds from the read and sends it straight back, which is what pressing OK
    // without touching a tab row does.
    const pressOk = () => {
      const stops = editor.surface!.formatting().tabStops ?? [];
      editor.exec({ type: 'setParagraphFormat', tabStops: stops });
      return xmlOf(editor);
    };

    editor.exec({
      type: 'setParagraphFormat',
      tabStops: [{ positionTwips: 1440, alignment: 'left' }],
    });
    const settled = xmlOf(editor);
    expect(settled).toContain('w:val="clear"');
    for (let pass = 0; pass < 4; pass += 1) expect(pressOk()).toBe(settled);
    // And the reading stays put too, not just the bytes.
    expect(editor.surface!.formatting().tabStops).toEqual([
      { positionTwips: 1440, alignment: 'left' },
    ]);
  });

  test('a cleared style stop stays cleared through a LATER, unrelated tab edit', () => {
    const editor = mountStyled(
      '<w:p><w:pPr><w:pStyle w:val="Tabbed"/></w:pPr><w:r><w:t>alpha</w:t></w:r></w:p>'
    );
    editor.surface!.selectAll();
    editor.exec({ type: 'setParagraphFormat', tabStops: [] });
    expect(editor.surface!.formatting().tabStops).toEqual([]);

    // A separate session: the user comes back and adds a stop somewhere else entirely.
    editor.exec({
      type: 'setParagraphFormat',
      tabStops: [{ positionTwips: 1440, alignment: 'left' }],
    });
    // The deletion from the first session is NOT undone by the second.
    expect(editor.surface!.formatting().tabStops).toEqual([
      { positionTwips: 1440, alignment: 'left' },
    ]);
  });

  test('clearing everything twice is idempotent', () => {
    const editor = mountStyled(
      '<w:p><w:pPr><w:pStyle w:val="Tabbed"/></w:pPr><w:r><w:t>alpha</w:t></w:r></w:p>'
    );
    editor.surface!.selectAll();
    editor.exec({ type: 'setParagraphFormat', tabStops: [] });
    const once = xmlOf(editor);
    editor.exec({ type: 'setParagraphFormat', tabStops: [] });
    expect(xmlOf(editor)).toBe(once);
    expect(editor.surface!.formatting().tabStops).toEqual([]);
  });

  test('can() agrees with exec() about every tab payload, and never throws', () => {
    // A host calls `can()` to decide whether to enable a control. A false yes there is a
    // button that fails when pressed; an exception is worse still. These three used to be
    // accepted (or thrown out of) by `can()` and refused by `exec()`.
    const editor = mount(p('alpha'));
    editor.surface!.selectAll();
    const payloads: readonly unknown[][] = [
      [{ positionTwips: 720, alignment: 'left', leader: 'nope' }],
      [
        { positionTwips: 720, alignment: 'left' },
        { positionTwips: 720, alignment: 'right' },
      ],
      [null],
      ['not an object'],
      [{ positionTwips: -720, alignment: 'left' }],
      [{ positionTwips: 720, alignment: 'bar' }],
    ];
    for (const tabStops of payloads) {
      const command = { type: 'setParagraphFormat', tabStops } as never;
      // Never throws — that is half the contract.
      const can = editor.can(command);
      expect(can.ok).toBe(false);
      expect(editor.exec(command).ok).toBe(false);
    }
    // And the control case, so this is not just refusing everything.
    const good = {
      type: 'setParagraphFormat' as const,
      tabStops: [{ positionTwips: 720, alignment: 'left' as const }],
    };
    expect(editor.can(good).ok).toBe(true);
    expect(editor.exec(good).ok).toBe(true);
  });

  test('values the reader would silently discard are refused, not written', () => {
    // Both used to return ok, write markup, and then read back as no stop at all — the
    // "reports success and does nothing" class this dialog exists to avoid.
    const editor = mount(p('alpha'));
    editor.surface!.selectAll();

    // A negative position: `clampPositionTwips` drops anything below zero.
    expect(
      editor.exec({
        type: 'setParagraphFormat',
        tabStops: [{ positionTwips: -720, alignment: 'left' }],
      }).ok
    ).toBe(false);
    // `bar` draws a vertical rule; the tab reader does not model it.
    expect(
      editor.exec({
        type: 'setParagraphFormat',
        tabStops: [{ positionTwips: 720, alignment: 'bar' }],
      }).ok
    ).toBe(false);
    expect(xmlOf(editor)).not.toContain('w:tabs');
  });

  test('the clear pile is bounded, so the engine can always see the stops it wrote', () => {
    // A clear can never be retired — nothing downstream can say whether a suppressed
    // position would come back without it — so left unbounded the element grew by one inert
    // child per position ever deleted. The reader walks a fixed number of children, so past
    // that the real stops sorted off the end and the paragraph went dead: the stop in the
    // file, and layout, paint and the dialog all reporting none.
    const editor = mount(p('alpha'));
    editor.surface!.selectAll();

    // 140 rounds of "add a stop at a fresh position, then remove it".
    for (let round = 0; round < 140; round += 1) {
      const positionTwips = 100 + round * 100;
      editor.exec({ type: 'setParagraphFormat', tabStops: [{ positionTwips, alignment: 'left' }] });
      editor.exec({ type: 'setParagraphFormat', tabStops: [] });
    }
    expect([...xmlOf(editor).matchAll(/<w:tab /g)].length).toBeLessThanOrEqual(64);

    // The paragraph is still editable, which is the whole point.
    editor.exec({
      type: 'setParagraphFormat',
      tabStops: [{ positionTwips: 30_000, alignment: 'right' }],
    });
    expect(editor.surface!.formatting().tabStops).toEqual([
      { positionTwips: 30_000, alignment: 'right' },
    ]);
  });

  test('a file full of markup the reader cannot model cannot bury the stop we just wrote', () => {
    // `w:tabs` children come from the file, so their count is attacker-controlled. Two
    // hundred bar tabs is legal markup; carried through unbudgeted they sorted ahead of the
    // real stop and pushed it past the reader's walk, leaving the paragraph reporting no
    // stops at all — the state the budget exists to prevent, reachable from a document
    // rather than from a long editing session.
    const bars = Array.from(
      { length: 200 },
      (_unused, index) => `<w:tab w:val="bar" w:pos="${index + 1}"/>`
    ).join('');
    const editor = mount(p('alpha', `<w:tabs>${bars}</w:tabs>`));
    editor.surface!.selectAll();
    editor.exec({
      type: 'setParagraphFormat',
      tabStops: [{ positionTwips: 1440, alignment: 'left' }],
    });

    expect([...xmlOf(editor).matchAll(/<w:tab /g)].length).toBeLessThanOrEqual(64);
    // The stop the user just set is readable, which is the whole point.
    expect(editor.surface!.formatting().tabStops).toEqual([
      { positionTwips: 1440, alignment: 'left' },
    ]);
  });

  test('a real stop is never dropped to make room for a clear', () => {
    const editor = mount(p('alpha'));
    editor.surface!.selectAll();
    for (let round = 0; round < 80; round += 1) {
      editor.exec({
        type: 'setParagraphFormat',
        tabStops: [{ positionTwips: 200 + round * 200, alignment: 'left' }],
      });
      editor.exec({ type: 'setParagraphFormat', tabStops: [] });
    }
    // Ten stops at once, well inside what Word allows, all of them readable back.
    const wanted = Array.from({ length: 10 }, (_unused, index) => ({
      positionTwips: 1000 + index * 500,
      alignment: 'left' as const,
    }));
    editor.exec({ type: 'setParagraphFormat', tabStops: wanted });
    expect(editor.surface!.formatting().tabStops).toEqual(wanted);
  });

  test('a fractional clear does not spawn a second one at its truncated position', () => {
    const editor = mount(p('alpha', '<w:tabs><w:tab w:val="clear" w:pos="1440.5"/></w:tabs>'));
    editor.surface!.selectAll();
    editor.exec({
      type: 'setParagraphFormat',
      tabStops: [{ positionTwips: 2880, alignment: 'right' }],
    });
    const xml = xmlOf(editor);
    // ONE clear, not two. It lands at the truncated position, which is the only one the
    // reader can see anyway — `1440.5` and `1440` resolve to the same stop for it.
    expect([...xml.matchAll(/w:val="clear"/g)]).toHaveLength(1);
    expect(xml).toContain('w:val="right"');
  });

  test('a fractional w:pos is an ordinary stop at its truncated position', () => {
    const editor = mount(p('alpha', '<w:tabs><w:tab w:val="left" w:pos="1440.5"/></w:tabs>'));
    editor.surface!.selectAll();
    expect(editor.surface!.formatting().tabStops).toEqual([
      { positionTwips: 1440, alignment: 'left' },
    ]);
    editor.exec({
      type: 'setParagraphFormat',
      tabStops: [
        { positionTwips: 1440, alignment: 'center' },
        { positionTwips: 2880, alignment: 'right' },
      ],
    });
    const xml = xmlOf(editor);
    expect(xml).not.toContain('w:pos="1440.5"');
    expect(xml).toContain('<w:tab w:pos="1440" w:val="center"/>');
    expect(editor.surface!.formatting().tabStops).toEqual([
      { positionTwips: 1440, alignment: 'center' },
      { positionTwips: 2880, alignment: 'right' },
    ]);
  });

  test('a w:pos that is not a measurement is preserved, like bar and num', () => {
    const editor = mount(p('alpha', '<w:tabs><w:tab w:val="left" w:pos="1e3"/></w:tabs>'));
    editor.surface!.selectAll();
    editor.exec({
      type: 'setParagraphFormat',
      tabStops: [{ positionTwips: 2880, alignment: 'right' }],
    });
    expect(xmlOf(editor)).toContain('w:pos="1e3"');
  });

  test('a bar tab the reader cannot model survives an unrelated tab edit', () => {
    // `w:bar` draws a vertical rule; it is not a caret stop, so the reader that feeds this
    // write never reports it and no editor can name it. A wholesale replace would delete
    // markup the user never saw.
    const editor = mount(
      p(
        'alpha',
        '<w:tabs><w:tab w:val="bar" w:pos="720"/><w:tab w:val="left" w:pos="1440"/></w:tabs>'
      )
    );
    editor.surface!.selectAll();
    // The reader shows only the real stop, which is what the layout lane means by one.
    expect(editor.surface!.formatting().tabStops).toEqual([
      { positionTwips: 1440, alignment: 'left' },
    ]);

    editor.exec({
      type: 'setParagraphFormat',
      tabStops: [{ positionTwips: 2880, alignment: 'right' }],
    });
    const xml = xmlOf(editor);
    expect(xml).toContain('w:val="bar"');
    expect(xml).toContain('w:pos="720"');
    expect(xml).toContain('w:val="right"');
    // The stop the editor replaced no longer applies; the one it could not see still does.
    expect(editor.surface!.formatting().tabStops).toEqual([
      { positionTwips: 2880, alignment: 'right' },
    ]);
  });

  test('and is dropped when the editor writes a real stop at its position', () => {
    const editor = mount(p('alpha', '<w:tabs><w:tab w:val="bar" w:pos="720"/></w:tabs>'));
    editor.surface!.selectAll();
    editor.exec({
      type: 'setParagraphFormat',
      tabStops: [{ positionTwips: 720, alignment: 'center' }],
    });
    const xml = xmlOf(editor);
    expect(xml).not.toContain('w:val="bar"');
    expect(xml).toContain('w:val="center"');
  });

  test('clearing a style stop inside a HEADER really removes it', () => {
    // The write asks what is in force through the same story-aware reader the dialog reads
    // through. A body-only walk saw nothing in a header, emitted no `w:val="clear"`, and
    // the style put its stop straight back — with the command still reporting success.
    const editor = mountWithHeader();
    const entered = editor.surface!.enterHeaderFooter({ rId: 'rIdHdr', kind: 'header' });
    expect(entered).toBe(true);
    editor.surface!.selectAll();
    expect(editor.surface!.formatting().tabStops).toEqual([
      { positionTwips: 2160, alignment: 'center' },
    ]);

    expect(editor.exec({ type: 'setParagraphFormat', tabStops: [] }).ok).toBe(true);
    expect(editor.surface!.formatting().tabStops).toEqual([]);
  });

  test('a tab-stops-only edit leaves every other property alone', () => {
    // `setParagraphProperties` REPLACES the paragraph's authorable `w:pPr` children with
    // what it is handed, so an edit that names no property must not push it.
    //
    // Honest about its reach: this asserts the INVARIANT, not the guard. With the property
    // base read correctly the unconditional push preserved everything too, so deleting the
    // guard does not fail here — what fails is the header test, which is where a wrong base
    // becomes observable. This is the belt to that pair of braces.
    const editor = mount(
      p('alpha', '<w:pStyle w:val="Quote"/><w:jc w:val="center"/><w:keepNext/>')
    );
    editor.surface!.selectAll();
    editor.exec({
      type: 'setParagraphFormat',
      tabStops: [{ positionTwips: 1440, alignment: 'left' }],
    });

    const xml = xmlOf(editor);
    expect(xml).toContain('w:val="Quote"');
    expect(xml).toContain('w:val="center"');
    expect(xml).toContain('<w:keepNext/>');
    expect(xml).toContain('w:pos="1440"');
  });

  test('a HEADER write merges against the header part, not the body', () => {
    // The previous header test sent only `tabStops`, so it passed even when the write read
    // its property base from the WRONG part: an empty base strips `w:pStyle`, which removed
    // the very style stop the test was asserting about. Sending a property as well is what
    // makes the part identity observable.
    const editor = mountWithHeader();
    expect(editor.surface!.enterHeaderFooter({ rId: 'rIdHdr', kind: 'header' })).toBe(true);
    editor.surface!.selectAll();

    editor.exec({ type: 'setParagraphFormat', alignment: 'center' });

    // The HEADER part, not the body: `session.part()` is always document.xml.
    const headerPart = editor.surface!.session.partFor({ kind: 'headerFooter', rId: 'rIdHdr' });
    if (!headerPart) throw new Error('the header part is not in the session');
    const header = serializeOoxmlPart(headerPart);
    expect(header).toContain('w:val="center"');
    // The style survives, so the paragraph still resolves its stop through the cascade.
    expect(header).toContain('w:val="Tabbed"');
    expect(editor.surface!.formatting().tabStops).toEqual([
      { positionTwips: 2160, alignment: 'center' },
    ]);
  });

  test('a stop the STYLE sets reads through, so an editor shows what is in force', () => {
    // Read from the flat cascade this would be invisible: the projection carries the
    // `w:tabs` element and none of its children.
    const editor = mountStyled(
      '<w:p><w:pPr><w:pStyle w:val="Tabbed"/></w:pPr><w:r><w:t>alpha</w:t></w:r></w:p>'
    );
    editor.surface!.selectAll();
    expect(editor.surface!.formatting().tabStops).toEqual([
      { positionTwips: 2160, alignment: 'center' },
    ]);
  });

  test('the whole dialog including tab stops is still ONE undo step', () => {
    const editor = mount(p('alpha'));
    editor.surface!.selectAll();
    editor.exec({
      type: 'setParagraphFormat',
      alignment: 'center',
      spaceBeforePt: 12,
      tabStops: [{ positionTwips: 1440, alignment: 'left' }],
    });
    expect(xmlOf(editor)).toContain('w:pos="1440"');
    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    const undone = xmlOf(editor);
    expect(undone).not.toContain('w:tabs');
    expect(undone).not.toContain('w:jc');
    expect(undone).not.toContain('w:spacing');
  });

  test('out-of-range stops are refused rather than clamped', () => {
    const editor = mount(p('alpha'));
    editor.surface!.selectAll();
    const refused = editor.exec({
      type: 'setParagraphFormat',
      tabStops: [{ positionTwips: 99_999_999, alignment: 'left' }],
    });
    expect(refused.ok).toBe(false);
    expect(xmlOf(editor)).not.toContain('w:tabs');
  });
});

describe('the dialog can read back what it wrote', () => {
  test('the paragraph flags report on, off and mixed', () => {
    const editor = mount(p('alpha') + p('beta'));
    editor.surface!.selectAll();
    editor.exec({ type: 'setParagraphFormat', keepNext: true, widowControl: false });
    let flags = editor.surface!.formatting().paragraphFlags;
    expect(flags.keepNext).toBe(true);
    expect(flags.widowControl).toBe(false);
    expect(flags.contextualSpacing).toBe(false);

    // One paragraph only, so the selection now disagrees.
    const ids = editor.surface!.session.paragraphIds();
    editor.surface!.setSelection({
      anchor: { paragraphId: ids[0]!, offset: 0 },
      head: { paragraphId: ids[0]!, offset: 1 },
    });
    editor.exec({ type: 'setParagraphFormat', keepNext: false });
    editor.surface!.selectAll();
    flags = editor.surface!.formatting().paragraphFlags;
    expect(flags.keepNext).toBeNull();
  });

  test('a flag a STYLE sets reads as on, so the checkbox shows it', () => {
    // Through the CASCADE, with the flag only in `styles.xml`: a box that saw direct
    // formatting alone would show unchecked over a paragraph the page is visibly keeping
    // with the next.
    const editor = mountStyled(
      '<w:p><w:pPr><w:pStyle w:val="Kept"/></w:pPr><w:r><w:t>alpha</w:t></w:r></w:p>'
    );
    editor.surface!.selectAll();
    const flags = editor.surface!.formatting().paragraphFlags;
    expect(flags.keepNext).toBe(true);
    // And a style turning OFF what the spec defaults ON is read as off, not as the default.
    expect(flags.widowControl).toBe(false);
  });

  test('a toggle the paragraph RESTATES beats the style that turned it off', () => {
    // A toggle is stated by the PRESENCE of its element, so a level carrying `<w:keepNext/>`
    // with no attributes has to override a lower level's `w:val="0"`. An attribute-wise
    // merge of the cascade cannot see that: a level with no attributes contributes nothing.
    const editor = mountStyled(
      '<w:p><w:pPr><w:pStyle w:val="Kept"/><w:widowControl/></w:pPr>' +
        '<w:r><w:t>alpha</w:t></w:r></w:p>'
    );
    editor.surface!.selectAll();
    expect(editor.surface!.formatting().paragraphFlags.widowControl).toBe(true);
  });

  test('w:widowControl with nothing anywhere reads ON, which is the spec default', () => {
    const editor = mount(p('alpha'));
    editor.surface!.selectAll();
    expect(editor.surface!.formatting().paragraphFlags.widowControl).toBe(true);
    expect(editor.surface!.formatting().paragraphFlags.keepNext).toBe(false);
  });
});
