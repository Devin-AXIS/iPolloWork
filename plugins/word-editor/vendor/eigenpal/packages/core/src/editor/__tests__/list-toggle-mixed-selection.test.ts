// A list button over a selection that holds list items and plain paragraphs together.
//
// Measured on reference renderings. When the selection starts with a plain paragraph right
// below an item of the pressed kind, the whole selection joins that list, and the items it
// holds move to the level the plain paragraph joins at. Otherwise the selection starts a new
// list of its own: the items keep their levels and the plain paragraphs go to level 0. That
// new list is never the list above, nor one an item in the selection is on. A heading of a
// heading numbering is no plain paragraph, and a heading numbering above takes no items along.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { mountPaginatedSurface } from '../paginated-surface.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const DOC_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const MAIN = 'application/vnd.openxmlformats-officedocument.wordprocessingml';

function abstract(id: number, format: string): string {
  let levels = '';
  for (let level = 0; level < 9; level += 1) {
    levels +=
      `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="${format}"/>` +
      `<w:lvlText w:val="${format === 'bullet' ? 'o' : `%${level + 1}.`}"/><w:lvlJc w:val="left"/>` +
      `<w:pPr><w:ind w:left="${720 + 360 * level}" w:hanging="360"/></w:pPr></w:lvl>`;
  }
  return `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="hybridMultilevel"/>${levels}</w:abstractNum>`;
}

/** A decimal level `level` that numbers paragraph style `style`. */
const linkedLevel = (level: number, style: string) =>
  `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="decimal"/>` +
  `<w:pStyle w:val="${style}"/><w:lvlText w:val="%${level + 1}."/><w:lvlJc w:val="left"/></w:lvl>`;

/** The list number styles, levels 1 to 3 of numId 9. */
const LIST_NUMBER = ['ListNumber', 'ListNumber2', 'ListNumber3'];

/**
 * numId 2: a decimal list. numId 3: a bullet list. numId 4: a numbering of Heading 1 and 2.
 * numId 9: a template list whose levels link the list number styles.
 */
const NUMBERING =
  `<w:numbering xmlns:w="${W}">${abstract(0, 'decimal')}${abstract(1, 'bullet')}` +
  `<w:abstractNum w:abstractNumId="2">${linkedLevel(0, 'Heading1')}${linkedLevel(1, 'Heading2')}` +
  '</w:abstractNum>' +
  `<w:abstractNum w:abstractNumId="3">${LIST_NUMBER.map((style, level) => linkedLevel(level, style)).join('')}` +
  '</w:abstractNum>' +
  '<w:num w:numId="2"><w:abstractNumId w:val="0"/></w:num>' +
  '<w:num w:numId="3"><w:abstractNumId w:val="1"/></w:num>' +
  '<w:num w:numId="4"><w:abstractNumId w:val="2"/></w:num>' +
  '<w:num w:numId="9"><w:abstractNumId w:val="3"/></w:num></w:numbering>';

/** A paragraph style that numbers its paragraphs on `numId` at `level`. */
const numberedStyle = (id: string, name: string, numId: number, level: number, outline: boolean) =>
  `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/>` +
  `<w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:ilvl w:val="${level}"/>` +
  `<w:numId w:val="${numId}"/></w:numPr>${outline ? `<w:outlineLvl w:val="${level}"/>` : ''}` +
  '</w:pPr></w:style>';

const STYLES =
  `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal">` +
  '<w:name w:val="Normal"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/>' +
  '<w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>' +
  numberedStyle('Heading1', 'heading 1', 4, 0, true) +
  numberedStyle('Heading2', 'heading 2', 4, 1, true) +
  LIST_NUMBER.map((id, level) =>
    numberedStyle(id, `List Number${level ? ` ${level + 1}` : ''}`, 9, level, false)
  ).join('') +
  '</w:styles>';

const plain = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const item = (text: string, numId: number, level: number, ind = '') =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${numId}"/></w:numPr>${ind}` +
  `</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const styled = (text: string, style: string) =>
  `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const heading = (text: string) => styled(text, 'Heading1');

function docx(body: string): Uint8Array {
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
    'word/styles.xml': strToU8(STYLES),
    'word/numbering.xml': strToU8(NUMBERING),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}${plain('After')}</w:body></w:document>`
    ),
  });
}

/**
 * Press a list button over paragraphs `from`..`to` and return each paragraph's list as
 * `numId/level`, with the authored lists by number and a new one as `new`, or as the style
 * that numbers it, or `-`.
 */
function pressed(body: string, from: number, to: number, kind: 'ordered' | 'bullet'): string[] {
  return listsOf(pressedXml(body, from, to, kind));
}

/** Each paragraph of `xml` but the last, as {@link pressed} reports it. */
function listsOf(xml: string): string[] {
  return paragraphsOf(xml).map((paragraph) => {
    const numId = /<w:numId w:val="(\d+)"\/>/.exec(paragraph)?.[1];
    if (!numId) return /<w:pStyle w:val="([^"]+)"\/>/.exec(paragraph)?.[1] ?? '-';
    const level = /<w:ilvl w:val="(\d+)"\/>/.exec(paragraph)?.[1] ?? '0';
    return `${['2', '3', '4'].includes(numId) ? numId : 'new'}/${level}`;
  });
}

const paragraphsOf = (xml: string): string[] =>
  (xml.match(/<w:p[ >].*?<\/w:p>/g) ?? []).slice(0, -1);

/** The saved `word/document.xml` after the press {@link pressed} makes. */
function pressedXml(body: string, from: number, to: number, kind: 'ordered' | 'bullet'): string {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, docx(body));
  if (!opened.ok) throw new Error(opened.reason);
  let saved: Uint8Array;
  try {
    const surface = opened.surface;
    const ids = surface.session.paragraphIds();
    surface.setSelection({
      anchor: { paragraphId: ids[from]!, offset: 0 },
      head: { paragraphId: ids[to]!, offset: 1 },
    });
    expect(surface.toggleList(kind)).toBe(true);
    saved = surface.save();
  } finally {
    opened.surface.destroy();
    container.remove();
  }
  return strFromU8(unzipSync(saved)['word/document.xml']!);
}

describe('a selection that starts with a plain paragraph below an item of the list', () => {
  test('joins that list, and its items move to the level the paragraph joins at', () => {
    const body = item('Above', 2, 0) + plain('Plain') + item('Item', 2, 2);
    expect(pressed(body, 1, 2, 'ordered')).toEqual(['2/0', '2/0', '2/0']);
  });

  test('holding two plain paragraphs and an item, all join', () => {
    const body = item('Above', 2, 0) + plain('One') + plain('Two') + item('Item', 2, 1);
    expect(pressed(body, 1, 3, 'ordered')).toEqual(['2/0', '2/0', '2/0', '2/0']);
  });

  test('an item of another list joins too', () => {
    const body = item('Above', 2, 0) + plain('Plain') + item('Item', 3, 1);
    expect(pressed(body, 1, 2, 'ordered')).toEqual(['2/0', '2/0', '2/0']);
  });

  test('a moved item drops its own start indent and keeps its end indent', () => {
    const own = '<w:ind w:left="1440" w:right="200" w:hanging="360"/>';
    const body = item('Above', 2, 0) + plain('Plain') + item('Item', 2, 2, own);
    const moved = paragraphsOf(pressedXml(body, 1, 2, 'ordered'))[2]!;
    expect(moved).toContain('<w:ilvl w:val="0"/>');
    expect(moved).toContain('w:right="200"');
    expect(moved).not.toContain('w:left=');
    expect(moved).not.toContain('w:hanging=');
  });

  test('a numbered heading in the selection keeps its style and level', () => {
    const body =
      item('Above', 2, 0) + plain('Plain') + item('Item', 2, 2) + styled('Sub', 'Heading2');
    const xml = pressedXml(body, 1, 3, 'ordered');
    expect(listsOf(xml)).toEqual(['2/0', '2/0', '2/0', '2/1']);
    expect(paragraphsOf(xml)[3]).toContain('<w:pStyle w:val="Heading2"/>');
  });

  test('an item on a level linked to a style moves by taking the style of the new level', () => {
    const body = styled('Above', 'ListNumber') + plain('Plain') + styled('Item', 'ListNumber3');
    expect(pressed(body, 1, 2, 'ordered')).toEqual(['ListNumber', 'ListNumber', 'ListNumber']);
  });

  test('an item that moves by its style keeps its end indent, as a level change does', () => {
    const own =
      '<w:p><w:pPr><w:pStyle w:val="ListNumber3"/><w:ind w:left="1440" w:right="200"/>' +
      '</w:pPr><w:r><w:t>Item</w:t></w:r></w:p>';
    const body = styled('Above', 'ListNumber') + plain('Plain') + own;
    const moved = paragraphsOf(pressedXml(body, 1, 2, 'ordered'))[2]!;
    expect(moved).toContain('<w:pStyle w:val="ListNumber"/>');
    expect(moved).toContain('w:right="200"');
    expect(moved).not.toContain('w:left=');
  });

  test('a list above that draws another kind at the join level starts a new list', () => {
    const body = item('Above', 3, 0) + plain('Plain') + item('Item', 2, 1);
    expect(pressed(body, 1, 2, 'ordered')).toEqual(['3/0', 'new/0', 'new/1']);
  });
});

describe('any other selection of items and plain paragraphs', () => {
  test('an item first starts a new list, even right below an item of its list', () => {
    const body = item('Above', 2, 0) + item('Item', 2, 2) + plain('Plain');
    expect(pressed(body, 1, 2, 'ordered')).toEqual(['2/0', 'new/2', 'new/0']);
  });

  test('a plain paragraph first, with no list above, starts a new list', () => {
    const body = plain('Before') + plain('Plain') + item('Item', 2, 1);
    expect(pressed(body, 1, 2, 'ordered')).toEqual(['-', 'new/0', 'new/1']);
  });

  test('a new list, not the one an item of the selection is on', () => {
    const body = plain('Before') + item('Item', 2, 0) + plain('Plain');
    expect(pressed(body, 1, 2, 'ordered')).toEqual(['-', 'new/0', 'new/0']);
  });

  test('items keep their levels', () => {
    const body = plain('Before') + item('One', 2, 1) + item('Two', 2, 1) + plain('Plain');
    expect(pressed(body, 1, 3, 'ordered')).toEqual(['-', 'new/1', 'new/1', 'new/0']);
  });

  test('a heading first is no plain paragraph, so the mix starts a new list', () => {
    const body = item('Above', 2, 0) + heading('Title') + plain('Plain') + item('Item', 2, 2);
    const lists = pressed(body, 1, 3, 'ordered');
    expect(lists.slice(2)).toEqual(['new/0', 'new/2']);
  });

  test('below a heading numbering, the items stay items on a new list', () => {
    const body = heading('Title') + plain('Plain') + item('Item', 3, 1);
    expect(pressed(body, 1, 2, 'ordered')).toEqual(['Heading1', 'new/0', 'new/1']);
  });

  test('a bullet item and a plain paragraph start new numbers or new bullets', () => {
    const body = plain('Before') + item('Item', 3, 0) + plain('Plain');
    expect(pressed(body, 1, 2, 'ordered')).toEqual(['-', 'new/0', 'new/0']);
    expect(pressed(body, 1, 2, 'bullet')).toEqual(['-', 'new/0', 'new/0']);
  });
});

describe('in suggesting mode', () => {
  test('a join that moves an item is a revision, and reject puts the item back', () => {
    const own = '<w:ind w:left="1440" w:hanging="360"/>';
    const body = item('Above', 2, 0) + plain('Plain') + item('Item', 2, 2, own);
    const container = document.createElement('div');
    document.body.append(container);
    const opened = mountPaginatedSurface(container, docx(body));
    if (!opened.ok) throw new Error(opened.reason);
    const surface = opened.surface;
    const saved = () => strFromU8(unzipSync(surface.save())['word/document.xml']!);
    try {
      const before = paragraphsOf(saved());
      surface.setAuthor('Reviewer');
      surface.setEditingMode('suggest');
      const ids = surface.session.paragraphIds();
      surface.setSelection({
        anchor: { paragraphId: ids[1]!, offset: 0 },
        head: { paragraphId: ids[2]!, offset: 1 },
      });
      expect(surface.toggleList('ordered')).toBe(true);
      expect(listsOf(saved())).toEqual(['2/0', '2/0', '2/0']);
      expect(paragraphsOf(saved())[2]).toContain('<w:pPrChange');
      const rejected = surface.applyAutomationOps(() => [{ op: 'rejectAllRevisions' }]);
      expect(rejected.rejected).toBe(false);
      // A reject can leave an empty `w:pPr` behind, which states nothing.
      expect(paragraphsOf(saved()).map((p) => p.replace('<w:pPr/>', ''))).toEqual(before);
    } finally {
      surface.destroy();
      container.remove();
    }
  });
});
