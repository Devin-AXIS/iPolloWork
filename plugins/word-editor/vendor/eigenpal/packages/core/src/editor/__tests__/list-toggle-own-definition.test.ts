// The list buttons start a list on a definition of their own. A heading numbering ("01",
// "01.1", large and colored, linked to Heading 1 and Heading 2) is decimal too, but a plain
// paragraph never borrows it, nor any other definition the document authored. Reference
// renderings create a new "1." / "a." / "i." definition even when an unused plain one exists.
// A paragraph next to the heading numbering joins that list the way the reference does: it
// takes the heading style the level is linked to.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const DOC_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const MAIN = 'application/vnd.openxmlformats-officedocument.wordprocessingml';

/** numId 1: the heading numbering. numId 2: a plain decimal list no paragraph uses. */
const NUMBERING =
  `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0">` +
  '<w:multiLevelType w:val="multilevel"/>' +
  '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:pStyle w:val="Heading1"/>' +
  '<w:lvlText w:val="0%1"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="720"/></w:pPr>' +
  '<w:rPr><w:color w:val="5078FF"/><w:sz w:val="40"/></w:rPr></w:lvl>' +
  '<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:pStyle w:val="Heading2"/>' +
  '<w:lvlText w:val="0%1.%2"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="720"/></w:pPr>' +
  '</w:lvl></w:abstractNum>' +
  '<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>' +
  '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>' +
  '<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="720"/></w:pPr></w:lvl></w:abstractNum>' +
  '<w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="hybridMultilevel"/>' +
  '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="-"/>' +
  '<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
  '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>' +
  '<w:num w:numId="3"><w:abstractNumId w:val="2"/></w:num></w:numbering>';

const heading = (id: string, level: number) =>
  `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="heading ${level + 1}"/>` +
  `<w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="1"/>` +
  `</w:numPr><w:outlineLvl w:val="${level}"/></w:pPr></w:style>`;

const STYLES =
  `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal">` +
  `<w:name w:val="Normal"/></w:style>${heading('Heading1', 0)}${heading('Heading2', 1)}` +
  '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/>' +
  '<w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>' +
  '</w:styles>';

const paragraph = (text: string, style?: string) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;

/** Heading 1, an intro paragraph, a gap, two plain paragraphs, Heading 2, and a closing one. */
const BODY =
  paragraph('Introduction', 'Heading1') +
  paragraph('Intro') +
  paragraph('Gap') +
  paragraph('First') +
  paragraph('Second') +
  paragraph('Scope', 'Heading2') +
  paragraph('After');

function docx(body = BODY, styles = STYLES, numbering = NUMBERING): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="${MAIN}.document.main+xml"/>` +
        `<Override PartName="/word/styles.xml" ContentType="${MAIN}.styles+xml"/>` +
        `<Override PartName="/word/numbering.xml" ContentType="${MAIN}.numbering+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId1" Type="${DOC_REL}/styles" Target="styles.xml"/>` +
        `<Relationship Id="rId2" Type="${DOC_REL}/numbering" Target="numbering.xml"/></Relationships>`
    ),
    'word/styles.xml': strToU8(styles),
    'word/numbering.xml': strToU8(numbering),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

function withSurface(bytes: Uint8Array, run: (surface: PaginatedSurface) => void): void {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, bytes);
  if (!opened.ok) throw new Error(opened.reason);
  try {
    run(opened.surface);
  } finally {
    opened.surface.destroy();
    container.remove();
  }
}

function caretIn(surface: PaginatedSurface, index: number, to = index): void {
  const ids = surface.session.paragraphIds();
  surface.setSelection({
    anchor: { paragraphId: ids[index]!, offset: 0 },
    head: { paragraphId: ids[to]!, offset: 1 },
  });
}

/** The painted markers, with their size and color, in reading order. */
function markers(surface: PaginatedSurface) {
  return surface
    .layout()
    .pages.flatMap((page) => page.fragments)
    .flatMap((fragment) =>
      fragment.kind === 'paragraph'
        ? [
            fragment.marker
              ? {
                  text: fragment.marker.text,
                  size: fragment.marker.style.fontSizePt,
                  color: fragment.marker.style.color,
                }
              : null,
          ]
        : []
    );
}

const part = (bytes: Uint8Array, name: string) => strFromU8(unzipSync(bytes)[name]!);
const paragraphsOf = (bytes: Uint8Array) =>
  part(bytes, 'word/document.xml').match(/<w:p[ >].*?<\/w:p>/g) ?? [];

describe('a list button away from any list', () => {
  test('numbers a plain paragraph 1., not with the heading numbering', () => {
    let saved: Uint8Array | null = null;
    withSurface(docx(), (surface) => {
      caretIn(surface, 3, 4);
      expect(surface.toggleList('ordered')).toBe(true);
      const [first, second] = markers(surface).slice(3, 5);
      expect(first).toMatchObject({ text: '1.', size: 12 });
      expect(first?.color).not.toBe('5078FF');
      expect(second?.text).toBe('2.');
      // The headings keep counting on their own: Scope is still 01.1.
      expect(markers(surface)[5]?.text).toBe('01.1');
      saved = surface.save();
    });
    const numbering = part(saved!, 'word/numbering.xml');
    const numId = /<w:numId w:val="(\d+)"\/>/.exec(paragraphsOf(saved!)[3]!)?.[1];
    // A definition of its own: neither the heading numbering nor the unused plain list.
    expect(numId).not.toBe('1');
    expect(numId).not.toBe('2');
    expect(numbering.match(/<w:abstractNum /g)).toHaveLength(4);
    withSurface(saved!, (reopened) => {
      expect(
        markers(reopened)
          .slice(3, 6)
          .map((marker) => marker?.text)
      ).toEqual(['1.', '2.', '01.1']);
    });
  });

  test('a deeper level numbers a. on its own definition', () => {
    withSurface(docx(), (surface) => {
      caretIn(surface, 3);
      expect(surface.toggleList('ordered')).toBe(true);
      expect(surface.adjustIndent('increase')).toBe(true);
      expect(markers(surface)[3]?.text).toBe('a.');
    });
  });

  test('bullets a plain paragraph on a definition of their own as well', () => {
    let saved: Uint8Array | null = null;
    withSurface(docx(), (surface) => {
      caretIn(surface, 3);
      expect(surface.toggleList('bullet')).toBe(true);
      saved = surface.save();
    });
    // A new bullet definition, not the document's own unused one.
    expect(part(saved!, 'word/numbering.xml').match(/<w:abstractNum /g)).toHaveLength(4);
  });

  test('pressing the button again reuses the definition it made', () => {
    let saved: Uint8Array | null = null;
    withSurface(docx(), (surface) => {
      caretIn(surface, 3);
      expect(surface.toggleList('ordered')).toBe(true);
      expect(surface.toggleList('ordered')).toBe(true);
      // Second is a fresh list: First is no list item any more.
      caretIn(surface, 4);
      expect(surface.toggleList('ordered')).toBe(true);
      expect(markers(surface)[4]?.text).toBe('1.');
      saved = surface.save();
    });
    // One definition of its own, used twice, besides the three the document authored.
    expect(part(saved!, 'word/numbering.xml').match(/<w:abstractNum /g)).toHaveLength(4);
  });
});

describe('a template list linked to its own style', () => {
  test('switching List Bullet items to numbers keeps them in place', () => {
    // List Bullet links its level to its style, as a heading numbering does, but it is no
    // heading: its items keep the list they leave and its indents.
    const numbering = NUMBERING.replace(
      '<w:num w:numId="1">',
      '<w:abstractNum w:abstractNumId="3"><w:lvl w:ilvl="0"><w:start w:val="1"/>' +
        '<w:numFmt w:val="bullet"/><w:pStyle w:val="ListBullet"/><w:lvlText w:val="-"/>' +
        '<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>' +
        '</w:abstractNum><w:num w:numId="1">'
    ).replace(
      '</w:numbering>',
      '<w:num w:numId="5"><w:abstractNumId w:val="3"/></w:num></w:numbering>'
    );
    const styles = STYLES.replace(
      '</w:styles>',
      '<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/>' +
        '<w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:numId w:val="5"/></w:numPr></w:pPr>' +
        '</w:style></w:styles>'
    );
    const body = paragraph('One', 'ListBullet') + paragraph('Two', 'ListBullet');
    const textX = (surface: PaginatedSurface) =>
      surface
        .layout()
        .pages.flatMap((page) => page.fragments)
        .flatMap((fragment) => (fragment.kind === 'paragraph' ? [fragment.lines[0]!.box.x] : []));
    withSurface(docx(body, styles, numbering), (surface) => {
      const before = textX(surface);
      caretIn(surface, 0, 1);
      expect(surface.toggleList('ordered')).toBe(true);
      expect(markers(surface).map((marker) => marker?.text)).toEqual(['1.', '2.']);
      expect(textX(surface)).toEqual(before);
    });
  });
});

describe('a list button next to the heading numbering', () => {
  test('a paragraph just above a heading starts its own list', () => {
    withSurface(docx(), (surface) => {
      // Second sits right before the Heading 2 paragraph; only the list above would count.
      caretIn(surface, 4);
      expect(surface.toggleList('ordered')).toBe(true);
      expect(markers(surface)[4]).toMatchObject({ text: '1.', size: 12 });
      expect(markers(surface)[5]?.text).toBe('01.1');
    });
  });

  test('puts the paragraph in the heading style its level is linked to', () => {
    let saved: Uint8Array | null = null;
    withSurface(docx(), (surface) => {
      caretIn(surface, 1);
      expect(surface.toggleList('ordered')).toBe(true);
      // Intro becomes the second heading: 02, and Scope follows it as 02.1.
      expect(
        markers(surface)
          .slice(0, 2)
          .map((marker) => marker?.text)
      ).toEqual(['01', '02']);
      expect(markers(surface)[5]?.text).toBe('02.1');
      saved = surface.save();
    });
    const intro = paragraphsOf(saved!)[1]!;
    expect(intro).toContain('<w:pStyle w:val="Heading1"/>');
    expect(intro).not.toContain('<w:numPr>');
    // No definition was made for it.
    expect(part(saved!, 'word/numbering.xml').match(/<w:abstractNum /g)).toHaveLength(3);
    withSurface(saved!, (reopened) => {
      expect(markers(reopened)[1]?.text).toBe('02');
    });
  });

  test('below a Heading 2 the paragraph joins at level 0 and becomes a Heading 1', () => {
    let saved: Uint8Array | null = null;
    withSurface(docx(), (surface) => {
      caretIn(surface, 6);
      expect(surface.toggleList('ordered')).toBe(true);
      expect(markers(surface)[6]?.text).toBe('02');
      saved = surface.save();
    });
    expect(paragraphsOf(saved!)[6]).toContain('<w:pStyle w:val="Heading1"/>');
  });

  test('a paragraph in a style of its own takes the heading style too', () => {
    const styles = STYLES.replace(
      '</w:styles>',
      '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/>' +
        '<w:basedOn w:val="Normal"/></w:style></w:styles>'
    );
    const body = BODY.replace(paragraph('Intro'), paragraph('Intro', 'Quote'));
    let saved: Uint8Array | null = null;
    withSurface(docx(body, styles), (surface) => {
      caretIn(surface, 1);
      expect(surface.toggleList('ordered')).toBe(true);
      saved = surface.save();
    });
    const intro = paragraphsOf(saved!)[1]!;
    expect(intro).toContain('<w:pStyle w:val="Heading1"/>');
    expect(intro).not.toContain('Quote');
  });

  test('a style that does not number on the linked level keeps the paragraph numbered', () => {
    // The level names Heading1, but the style carries no numbering: the heading above is
    // numbered by its own w:numPr. Taking the style would leave the paragraph with no number.
    const styles = STYLES.replace(
      /<w:numPr><w:ilvl w:val="0"\/><w:numId w:val="1"\/><\/w:numPr>/,
      ''
    );
    const heading =
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:numPr><w:ilvl w:val="0"/>' +
      '<w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Introduction</w:t></w:r></w:p>';
    const body = BODY.replace(paragraph('Introduction', 'Heading1'), heading);
    let saved: Uint8Array | null = null;
    withSurface(docx(body, styles), (surface) => {
      caretIn(surface, 1);
      expect(surface.toggleList('ordered')).toBe(true);
      expect(markers(surface)[1]?.text).toBe('02');
      saved = surface.save();
    });
    expect(paragraphsOf(saved!)[1]).toContain('<w:numId w:val="1"/>');
  });

  test('a plain paragraph and a heading below it start a new list together', () => {
    let saved: Uint8Array | null = null;
    withSurface(docx(), (surface) => {
      // Second and the Heading 2 below it. The heading numbering does not hold the selection:
      // both go on a new plain list, the heading at its own level and in its own style.
      caretIn(surface, 4, 5);
      expect(surface.toggleList('ordered')).toBe(true);
      expect(
        markers(surface)
          .slice(4, 6)
          .map((marker) => marker?.text)
      ).toEqual(['1.', 'a.']);
      saved = surface.save();
    });
    const [second, scope] = paragraphsOf(saved!).slice(4, 6);
    const numId = /<w:numId w:val="(\d+)"\/>/.exec(second!)?.[1];
    expect(second).toContain('<w:pStyle w:val="ListParagraph"/>');
    expect(numId).not.toBe('1');
    expect(scope).toContain('<w:pStyle w:val="Heading2"/>');
    expect(scope).toContain(`<w:ilvl w:val="1"/><w:numId w:val="${numId}"/>`);
  });

  test('a heading on its own instance of the heading numbering still lends its style', () => {
    // Introduction names numId 4 itself, over the same definition its style numbers on.
    const numbering = NUMBERING.replace(
      '</w:numbering>',
      '<w:num w:numId="4"><w:abstractNumId w:val="0"/></w:num></w:numbering>'
    );
    const heading =
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:numPr><w:ilvl w:val="0"/>' +
      '<w:numId w:val="4"/></w:numPr></w:pPr><w:r><w:t>Introduction</w:t></w:r></w:p>';
    const body = BODY.replace(paragraph('Introduction', 'Heading1'), heading);
    let saved: Uint8Array | null = null;
    withSurface(docx(body, STYLES, numbering), (surface) => {
      caretIn(surface, 1);
      expect(surface.toggleList('ordered')).toBe(true);
      saved = surface.save();
    });
    const intro = paragraphsOf(saved!)[1]!;
    expect(intro).toContain('<w:pStyle w:val="Heading1"/>');
    expect(intro).not.toContain('<w:numPr>');
  });

  test('in suggesting mode the joined heading is a reviewable property change', () => {
    let saved: Uint8Array | null = null;
    withSurface(docx(), (surface) => {
      surface.setAuthor('Reviewer');
      surface.setEditingMode('suggest');
      caretIn(surface, 1);
      expect(surface.toggleList('ordered')).toBe(true);
      saved = surface.save();
    });
    const intro = paragraphsOf(saved!)[1]!;
    expect(intro).toContain('<w:pStyle w:val="Heading1"/>');
    expect(intro).toContain('<w:pPrChange');
  });

  for (const [decision, marker] of [
    ['rejectAllRevisions', null],
    ['acceptAllRevisions', '02'],
  ] as const) {
    test(`a suggested join resolves on ${decision}`, () => {
      withSurface(docx(), (surface) => {
        surface.setAuthor('Reviewer');
        surface.setEditingMode('suggest');
        caretIn(surface, 1);
        expect(surface.toggleList('ordered')).toBe(true);
        surface.setEditingMode('edit');
        expect(surface.applyAutomationOps(() => [{ op: decision }]).rejected).toBe(false);
        expect(markers(surface)[1]?.text ?? null).toBe(marker);
        const intro = paragraphsOf(surface.save())[1]!;
        expect(intro.includes('Heading1')).toBe(marker !== null);
        expect(intro).not.toContain('<w:pPrChange');
      });
    });
  }

  test('undo restores the plain paragraph', () => {
    withSurface(docx(), (surface) => {
      caretIn(surface, 1);
      expect(surface.toggleList('ordered')).toBe(true);
      surface.undo();
      expect(markers(surface)[1]).toBeNull();
      expect(markers(surface)[5]?.text).toBe('01.1');
    });
  });
});
