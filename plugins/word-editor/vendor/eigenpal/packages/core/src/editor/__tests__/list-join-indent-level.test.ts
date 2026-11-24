// The level a paragraph takes when a list button joins it to the list above.
//
// Measured on reference renderings. A list whose levels link paragraph styles (a heading
// numbering) puts the paragraph on the level its first line reaches, one level per default
// tab stop: with the default half inch, 0.6 in becomes a Heading 2 and 1 in a Heading 3. The
// level indents and the level of the item above do not count. A level with no linked style
// numbers the paragraph in List Paragraph. A plain list puts the paragraph on the level of
// the item above, whatever its indent. Both drop the paragraph's own indent.

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

/** Levels 0-2 link `${prefix}1`-`${prefix}3`; levels 3-8 link nothing. All at 720/720. */
function linkedAbstract(id: number, prefix: string): string {
  let levels = '';
  for (let level = 0; level < 9; level += 1) {
    const link = level < 3 ? `<w:pStyle w:val="${prefix}${level + 1}"/>` : '';
    levels +=
      `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="decimal"/>${link}` +
      `<w:lvlText w:val="%${level + 1}."/><w:lvlJc w:val="left"/>` +
      '<w:pPr><w:ind w:left="720" w:hanging="720"/></w:pPr></w:lvl>';
  }
  return `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="multilevel"/>${levels}</w:abstractNum>`;
}

/** A plain list at 720 + 360 per level, linked to no style. */
function plainAbstract(id: number): string {
  let levels = '';
  for (let level = 0; level < 9; level += 1) {
    levels +=
      `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/>` +
      `<w:lvlText w:val="%${level + 1})"/><w:lvlJc w:val="left"/>` +
      `<w:pPr><w:ind w:left="${720 + 360 * level}" w:hanging="360"/></w:pPr></w:lvl>`;
  }
  return `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="hybridMultilevel"/>${levels}</w:abstractNum>`;
}

/** numId 1: headings. numId 2: a plain list. numId 3: levels linked to ListNum styles. */
const NUMBERING =
  `<w:numbering xmlns:w="${W}">${linkedAbstract(0, 'Heading')}${plainAbstract(1)}` +
  `${linkedAbstract(2, 'ListNum')}<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>` +
  '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>' +
  // numId 4: a plain list that numbers level 0 and bullets level 1.
  '<w:abstractNum w:abstractNumId="3"><w:multiLevelType w:val="hybridMultilevel"/>' +
  '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>' +
  '<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>' +
  '<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="-"/>' +
  '<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>' +
  '</w:abstractNum>' +
  '<w:num w:numId="3"><w:abstractNumId w:val="2"/></w:num>' +
  '<w:num w:numId="4"><w:abstractNumId w:val="3"/></w:num></w:numbering>';

const linkedStyle = (id: string, numId: number, level: number, outline: boolean) =>
  `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${id}"/>` +
  `<w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${numId}"/>` +
  `</w:numPr>${outline ? `<w:outlineLvl w:val="${level}"/>` : ''}</w:pPr></w:style>`;

const STYLES =
  `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal">` +
  '<w:name w:val="Normal"/></w:style>' +
  [0, 1, 2].map((level) => linkedStyle(`Heading${level + 1}`, 1, level, true)).join('') +
  [0, 1, 2].map((level) => linkedStyle(`ListNum${level + 1}`, 3, level, false)).join('') +
  '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/>' +
  '<w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Indented"><w:name w:val="Indented"/>' +
  '<w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="864"/></w:pPr></w:style>' +
  '</w:styles>';

const paragraph = (text: string, pPr = '') =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;
const heading1 = paragraph('Introduction', '<w:pStyle w:val="Heading1"/>');
const indented = (ind: string, text = 'Target') => paragraph(text, `<w:ind ${ind}/>`);

function docx(body: string, defaultTabStop?: number): Uint8Array {
  const settings =
    defaultTabStop === undefined
      ? `<w:settings xmlns:w="${W}"/>`
      : `<w:settings xmlns:w="${W}"><w:defaultTabStop w:val="${defaultTabStop}"/></w:settings>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="${MAIN}.document.main+xml"/>` +
        `<Override PartName="/word/styles.xml" ContentType="${MAIN}.styles+xml"/>` +
        `<Override PartName="/word/settings.xml" ContentType="${MAIN}.settings+xml"/>` +
        `<Override PartName="/word/numbering.xml" ContentType="${MAIN}.numbering+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId1" Type="${DOC_REL}/styles" Target="styles.xml"/>` +
        `<Relationship Id="rId2" Type="${DOC_REL}/numbering" Target="numbering.xml"/>` +
        `<Relationship Id="rId3" Type="${DOC_REL}/settings" Target="settings.xml"/></Relationships>`
    ),
    'word/styles.xml': strToU8(STYLES),
    'word/settings.xml': strToU8(settings),
    'word/numbering.xml': strToU8(NUMBERING),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}${paragraph('Closing')}</w:body></w:document>`
    ),
  });
}

/** Press a list button over paragraphs `from`..`to`, then return the saved paragraphs. */
function numbered(
  bytes: Uint8Array,
  from: number,
  to = from,
  options: {
    readonly kind?: 'ordered' | 'bullet';
    /** Runs after the press, in suggesting mode, before the save. */
    readonly suggest?: (surface: PaginatedSurface) => void;
  } = {}
): string[] {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, bytes);
  if (!opened.ok) throw new Error(opened.reason);
  let saved: Uint8Array;
  try {
    const surface: PaginatedSurface = opened.surface;
    const ids = surface.session.paragraphIds();
    surface.setSelection({
      anchor: { paragraphId: ids[from]!, offset: 0 },
      head: { paragraphId: ids[to]!, offset: 1 },
    });
    if (options.suggest) {
      surface.setAuthor('Reviewer');
      surface.setEditingMode('suggest');
    }
    expect(surface.toggleList(options.kind ?? 'ordered')).toBe(true);
    options.suggest?.(surface);
    saved = surface.save();
  } finally {
    opened.surface.destroy();
    container.remove();
  }
  const xml = strFromU8(unzipSync(saved)['word/document.xml']!);
  return xml.match(/<w:p[ >].*?<\/w:p>/g) ?? [];
}

/** A saved paragraph as its style, its numbering, and whether it keeps its own indent. */
function shape(xml: string): string {
  const style = /<w:pStyle w:val="([^"]+)"\/>/.exec(xml)?.[1] ?? '-';
  const numPr = /<w:numPr>.*?<\/w:numPr>/.exec(xml)?.[0];
  const level = numPr ? /<w:ilvl w:val="(\d+)"\/>/.exec(numPr)?.[1] : undefined;
  const numId = numPr ? /<w:numId w:val="(\d+)"\/>/.exec(numPr)?.[1] : undefined;
  const numbering = numPr ? ` ${numId}/${level ?? '-'}` : '';
  return `${style}${numbering}${xml.includes('<w:ind ') ? ' ind' : ''}`;
}

describe('a paragraph joining a list whose levels link styles', () => {
  test.each([
    ['w:left="0"', 'Heading1'],
    ['w:left="719"', 'Heading1'],
    ['w:left="720"', 'Heading2'],
    ['w:left="864"', 'Heading2'],
    ['w:left="1439"', 'Heading2'],
    ['w:left="1440"', 'Heading3'],
    ['w:left="2160"', 'ListParagraph 1/3'],
    ['w:left="5760"', 'ListParagraph 1/8'],
    ['w:left="864" w:hanging="360"', 'Heading1'],
    ['w:left="1440" w:hanging="720"', 'Heading2'],
    ['w:left="0" w:firstLine="720"', 'Heading2'],
    ['w:right="1440"', 'Heading1'],
  ])('a first line at %s takes %s', (ind, expected) => {
    expect(shape(numbered(docx(heading1 + indented(ind)), 1)[1]!)).toBe(expected);
  });

  test('an indent its style states counts like its own', () => {
    const body = heading1 + paragraph('Target', '<w:pStyle w:val="Indented"/>');
    expect(shape(numbered(docx(body), 1)[1]!)).toBe('Heading2');
  });

  test('one level per default tab stop', () => {
    expect(shape(numbered(docx(heading1 + indented('w:left="360"'), 360), 1)[1]!)).toBe('Heading2');
    expect(shape(numbered(docx(heading1 + indented('w:left="864"'), 1440), 1)[1]!)).toBe(
      'Heading1'
    );
  });

  test('the level of the item above does not count', () => {
    const above = paragraph('Above', '<w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr>');
    expect(shape(numbered(docx(heading1 + above + indented('w:left="0"')), 2)[2]!)).toBe(
      'Heading1'
    );
  });

  test('each selected paragraph takes the level of its own indent', () => {
    const body =
      heading1 +
      indented('w:left="0"', 'Zero') +
      indented('w:left="1440"', 'Inch') +
      indented('w:left="864"', 'Part');
    expect(numbered(docx(body), 1, 3).slice(1, 4).map(shape)).toEqual([
      'Heading1',
      'Heading3',
      'Heading2',
    ]);
  });

  test('levels linked to styles that are no headings follow the same rule', () => {
    const body = paragraph('Start', '<w:pStyle w:val="ListNum1"/>') + indented('w:left="864"');
    expect(shape(numbered(docx(body), 1)[1]!)).toBe('ListNum2');
  });
});

describe('a paragraph joining a plain list', () => {
  test.each(['w:left="0"', 'w:left="2160"'])(
    'at %s it takes the level of the item above',
    (ind) => {
      const above = paragraph(
        'Above',
        '<w:numPr><w:ilvl w:val="1"/><w:numId w:val="2"/></w:numPr>'
      );
      expect(shape(numbered(docx(above + indented(ind)), 1)[1]!)).toBe('ListParagraph 2/1');
    }
  );
});

test('a plain list joins at the level of the item above, where that level draws bullets', () => {
  const above = paragraph('Above', '<w:numPr><w:ilvl w:val="1"/><w:numId w:val="4"/></w:numPr>');
  const saved = numbered(docx(above + indented('w:left="0"')), 1, 1, { kind: 'bullet' });
  expect(shape(saved[1]!)).toBe('ListParagraph 4/1');
});

test('a joined paragraph keeps a style of its own and loses only its own indent', () => {
  const above = paragraph('Above', '<w:numPr><w:ilvl w:val="1"/><w:numId w:val="2"/></w:numPr>');
  const target = paragraph('Target', '<w:pStyle w:val="Indented"/><w:ind w:left="2160"/>');
  expect(shape(numbered(docx(above + target), 1)[1]!)).toBe('Indented 2/1');
});

describe('a suggested join', () => {
  test('records the indent it drops, and reject brings it back', () => {
    const decide = (surface: PaginatedSurface, op: 'rejectAllRevisions') =>
      expect(surface.applyAutomationOps(() => [{ op }]).rejected).toBe(false);
    const suggested = numbered(docx(heading1 + indented('w:left="864"')), 1, 1, {
      suggest: () => {},
    })[1]!;
    expect(suggested).toContain('<w:pStyle w:val="Heading2"/>');
    expect(suggested).toContain('<w:pPrChange');
    const rejected = numbered(docx(heading1 + indented('w:left="864"')), 1, 1, {
      suggest: (surface) => decide(surface, 'rejectAllRevisions'),
    })[1]!;
    expect(shape(rejected)).toBe('- ind');
    expect(rejected).toContain('w:left="864"');
  });
});
