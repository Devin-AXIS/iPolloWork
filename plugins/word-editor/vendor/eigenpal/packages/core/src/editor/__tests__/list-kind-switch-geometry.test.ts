// Switching a list item between bullets and numbers changes its marker, never its place.
// The new definition takes each level's indent, suffix and marker alignment from the list
// the item leaves, and switching back and forth reuses one definition per kind.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const NUMREL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering';

const STYREL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

const shiftedIndent = (ilvl: number): string =>
  `<w:pPr><w:ind w:left="${360 + 720 * ilvl}" w:hanging="360"/></w:pPr>`;

/** Levels at 0.25" + 0.5" per level with a 0.25" hang: not the stock 0.5" per level. */
function levels(
  format: 'decimal' | 'bullet' | ((ilvl: number) => 'decimal' | 'bullet'),
  extra = '',
  pPr: (ilvl: number) => string = shiftedIndent
): string {
  return Array.from({ length: 9 }, (_, ilvl) => {
    const numFmt = typeof format === 'function' ? format(ilvl) : format;
    const text = numFmt === 'bullet' ? '–' : `%${ilvl + 1})`;
    return (
      `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/><w:numFmt w:val="${numFmt}"/>${extra}` +
      `<w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/>${pPr(ilvl)}</w:lvl>`
    );
  }).join('');
}

function docx(body: string, numbering: string, styles?: string): Uint8Array {
  return zipSync({
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
      `<Relationships xmlns="${REL}"><Relationship Id="rId9" Type="${NUMREL}" Target="numbering.xml"/>` +
        (styles ? `<Relationship Id="rId8" Type="${STYREL}" Target="styles.xml"/>` : '') +
        '</Relationships>'
    ),
    'word/numbering.xml': strToU8(`<w:numbering xmlns:w="${W}">${numbering}</w:numbering>`),
    ...(styles
      ? { 'word/styles.xml': strToU8(`<w:styles xmlns:w="${W}">${styles}</w:styles>`) }
      : {}),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const numbered = (extra = ''): string =>
  `<w:abstractNum w:abstractNumId="0">${levels('decimal', extra)}</w:abstractNum>` +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>';

const item = (text: string, ilvl?: number, numId = '1'): string =>
  `<w:p>${
    ilvl === undefined
      ? ''
      : `<w:pPr><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>`
  }<w:r><w:t>${text}</w:t></w:r></w:p>`;

/** The stock level-0 bullet: Symbol U+F0B7, painted as its Unicode lookalike. */
const BULLET = '•';

const LIST = item('alpha', 0) + item('bravo', 0) + item('charlie', 3) + item('delta', 0);

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

interface Placement {
  readonly marker: string | undefined;
  readonly markerX: number | undefined;
  readonly textX: number | undefined;
}

function placements(surface: PaginatedSurface): Placement[] {
  return surface
    .layout()
    .pages.flatMap((page) => page.fragments)
    .flatMap((fragment) =>
      fragment.kind === 'paragraph'
        ? [
            {
              marker: fragment.marker?.text,
              markerX: fragment.marker?.box.x,
              textX: fragment.lines[0]?.box.x,
            },
          ]
        : []
    );
}

const positions = (surface: PaginatedSurface) =>
  placements(surface).map(({ markerX, textX }) => ({ markerX, textX }));

function caretIn(surface: PaginatedSurface, index: number): void {
  const paragraphId = surface.session.paragraphIds()[index]!;
  surface.setSelection({
    anchor: { paragraphId, offset: 1 },
    head: { paragraphId, offset: 1 },
  });
}

function selectParagraphs(surface: PaginatedSurface, first: number, last: number): void {
  const ids = surface.session.paragraphIds();
  surface.setSelection({
    anchor: { paragraphId: ids[first]!, offset: 0 },
    head: { paragraphId: ids[last]!, offset: 1 },
  });
}

const numberingXml = (bytes: Uint8Array): string =>
  strFromU8(unzipSync(bytes)['word/numbering.xml']!);

const count = (xml: string, element: string): number =>
  xml.match(new RegExp(`<w:${element}[ >]`, 'g'))?.length ?? 0;

describe('switching a list item between bullets and numbers', () => {
  test('a level-0 item keeps its marker and text position, both ways', () => {
    withSurface(docx(LIST, numbered()), (surface) => {
      const before = positions(surface);
      caretIn(surface, 1);
      expect(surface.toggleList('bullet')).toBe(true);
      expect(placements(surface)[1]!.marker).toBe(BULLET);
      expect(positions(surface)).toEqual(before);

      expect(surface.toggleList('ordered')).toBe(true);
      expect(positions(surface)).toEqual(before);
      // Switching back rejoins the list around it, so the counters run on.
      expect(placements(surface).map((entry) => entry.marker)).toEqual(['1)', '2)', '1)', '3)']);
    });
  });

  test('a deep item keeps its level geometry', () => {
    withSurface(docx(LIST, numbered()), (surface) => {
      const before = positions(surface);
      caretIn(surface, 2);
      expect(surface.toggleList('bullet')).toBe(true);
      expect(placements(surface)[2]!.marker).toBe(BULLET);
      expect(positions(surface)).toEqual(before);
    });
  });

  test('a selection across levels keeps every item in place, and so does Tab afterwards', () => {
    withSurface(docx(LIST, numbered()), (surface) => {
      const before = positions(surface);
      selectParagraphs(surface, 0, 3);
      expect(surface.toggleList('bullet')).toBe(true);
      expect(placements(surface).every((entry) => entry.marker !== undefined)).toBe(true);
      expect(placements(surface).map((entry) => entry.marker)).not.toContain('1)');
      expect(positions(surface)).toEqual(before);

      // Demoting a converted item lands on the old list's level-1 indent, 0.5" further in.
      caretIn(surface, 1);
      expect(surface.adjustIndent('increase')).toBe(true);
      expect(placements(surface)[1]!.marker).toBe('o');
      expect(positions(surface)[1]!.textX).toBe(before[1]!.textX! + 36);
    });
  });

  test('a bullet item becomes numbered where it stood', () => {
    const bullets =
      `<w:abstractNum w:abstractNumId="0">${levels('bullet')}</w:abstractNum>` +
      '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>';
    withSurface(docx(LIST, bullets), (surface) => {
      const before = positions(surface);
      caretIn(surface, 2);
      expect(surface.toggleList('ordered')).toBe(true);
      expect(placements(surface)[2]!.marker).toBe('1.');
      expect(positions(surface)).toEqual(before);
    });
  });

  test('a mixed selection joins the list of the wanted kind it already holds', () => {
    const numbering =
      numbered() +
      `<w:abstractNum w:abstractNumId="7">${levels('bullet')}</w:abstractNum>` +
      '<w:num w:numId="2"><w:abstractNumId w:val="7"/></w:num>';
    const body = item('dash', 0, '2') + item('number', 0) + item('plain');
    withSurface(docx(body, numbering), (surface) => {
      const before = positions(surface);
      selectParagraphs(surface, 0, 1);
      expect(surface.toggleList('bullet')).toBe(true);
      expect(placements(surface).map((entry) => entry.marker)).toEqual(['–', '–', undefined]);
      expect(positions(surface)).toEqual(before);
      expect(count(numberingXml(surface.save()), 'abstractNum')).toBe(2);
    });
  });

  test('a list that numbers one level and bullets another switches every item', () => {
    const numbering =
      `<w:abstractNum w:abstractNumId="0">${levels((ilvl) => (ilvl % 2 === 1 ? 'bullet' : 'decimal'))}</w:abstractNum>` +
      '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>';
    const body = item('one', 0) + item('sub', 1) + item('two', 0);
    withSurface(docx(body, numbering), (surface) => {
      const before = positions(surface);
      selectParagraphs(surface, 0, 2);
      expect(surface.toggleList('bullet')).toBe(true);
      expect(placements(surface).map((entry) => entry.marker)).toEqual([BULLET, 'o', BULLET]);
      expect(positions(surface)).toEqual(before);
      expect(surface.isListActive('bullet')).toBe(true);
    });
    withSurface(docx(body, numbering), (surface) => {
      selectParagraphs(surface, 0, 2);
      expect(surface.toggleList('ordered')).toBe(true);
      expect(placements(surface).map((entry) => entry.marker)).toEqual(['1.', 'a.', '2.']);
    });
  });

  test('a right-to-left level keeps its direction and its side of the page', () => {
    const rtlLevel = (ilvl: number): string =>
      `<w:pPr><w:bidi/><w:ind w:right="${360 + 720 * ilvl}" w:hanging="360"/></w:pPr>`;
    const numbering =
      `<w:abstractNum w:abstractNumId="0">${levels('decimal', '', rtlLevel)}</w:abstractNum>` +
      '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>';
    const edges = (surface: PaginatedSurface) =>
      surface
        .layout()
        .pages.flatMap((page) => page.fragments)
        .flatMap((fragment) =>
          fragment.kind === 'paragraph' && fragment.marker
            ? [
                {
                  textX: fragment.lines[0]?.box.x,
                  textWidth: fragment.lines[0]?.box.width,
                  markerEnd: fragment.marker.box.x + fragment.marker.box.width,
                },
              ]
            : []
        );
    withSurface(docx(item('alpha', 0) + item('bravo', 0), numbering), (surface) => {
      const before = edges(surface);
      caretIn(surface, 1);
      expect(surface.toggleList('bullet')).toBe(true);
      expect(placements(surface)[1]!.marker).toBe(BULLET);
      expect(edges(surface)[1]!.textX).toBe(before[1]!.textX);
      expect(edges(surface)[1]!.textWidth).toBe(before[1]!.textWidth);
      expect(edges(surface)[1]!.markerEnd).toBeCloseTo(before[1]!.markerEnd, 3);
      expect(numberingXml(surface.save())).toContain('<w:bidi/><w:ind');
    });
  });

  test('level tab stops and spacing carry over, in schema order', () => {
    const tabbed = (ilvl: number): string =>
      `<w:pPr><w:tabs><w:tab w:val="num" w:pos="${1080 + 720 * ilvl}"/></w:tabs>` +
      `<w:spacing w:after="120"/><w:ind w:left="${1440 + 720 * ilvl}" w:hanging="720"/>` +
      '<w:jc w:val="both"/></w:pPr>';
    const numbering =
      `<w:abstractNum w:abstractNumId="0">${levels('decimal', '', tabbed)}</w:abstractNum>` +
      '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>';
    withSurface(docx(item('alpha', 0) + item('bravo', 0), numbering), (surface) => {
      const before = positions(surface);
      caretIn(surface, 1);
      expect(surface.toggleList('bullet')).toBe(true);
      expect(positions(surface)).toEqual(before);
      expect(numberingXml(surface.save())).toMatch(
        /<w:numFmt w:val="bullet"\/>.*?<w:pPr><w:tabs><w:tab w:pos="1080" w:val="num"\/><\/w:tabs><w:spacing w:after="120"\/><w:ind [^>]*\/><w:jc w:val="both"\/><\/w:pPr>/
      );
    });
  });

  test('an item its style numbers stays at the indent the style gives it', () => {
    const styles =
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="ListNumber"><w:name w:val="List Number"/>' +
      '<w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr>' +
      '<w:ind w:left="1800" w:hanging="360"/></w:pPr></w:style>';
    const styled = (text: string): string =>
      `<w:p><w:pPr><w:pStyle w:val="ListNumber"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
    withSurface(docx(styled('a') + styled('b') + styled('c'), numbered(), styles), (surface) => {
      const before = positions(surface);
      caretIn(surface, 1);
      expect(surface.toggleList('bullet')).toBe(true);
      expect(placements(surface)[1]!.marker).toBe(BULLET);
      expect(positions(surface)).toEqual(before);
    });
  });

  test("one item's own indent stays its own, and moves no other item", () => {
    const indented =
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' +
      '<w:ind w:left="2000" w:firstLine="0"/></w:pPr><w:r><w:t>own</w:t></w:r></w:p>';
    withSurface(docx(indented + item('bravo', 0) + item('charlie', 0), numbered()), (surface) => {
      const before = positions(surface);
      selectParagraphs(surface, 0, 2);
      expect(surface.toggleList('bullet')).toBe(true);
      expect(positions(surface)).toEqual(before);
      // The level keeps the list's indent; the direct one stays on its paragraph.
      expect(numberingXml(surface.save())).toContain('<w:ind w:hanging="360" w:left="360"');
    });
  });

  test.each([0, 1, 2])(
    'a style-numbered item at %i keeps its indent without moving its neighbours',
    (styledIndex) => {
      const styles =
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
        '<w:style w:type="paragraph" w:styleId="ListNumber"><w:name w:val="List Number"/>' +
        '<w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr>' +
        '<w:ind w:left="1800" w:hanging="360"/></w:pPr></w:style>';
      const styled = `<w:p><w:pPr><w:pStyle w:val="ListNumber"/></w:pPr><w:r><w:t>a</w:t></w:r></w:p>`;
      const items = [item('b', 0), item('c', 0)];
      items.splice(styledIndex, 0, styled);
      withSurface(docx(items.join(''), numbered(), styles), (surface) => {
        const before = positions(surface);
        selectParagraphs(surface, 0, 2);
        expect(surface.toggleList('bullet')).toBe(true);
        expect(positions(surface)).toEqual(before);
        // The styled item gets its own definition; the shared level keeps the list's indent,
        // and no paragraph gains a direct indent that would pin it.
        const saved = surface.save();
        expect(numberingXml(saved)).toContain('<w:ind w:hanging="360" w:left="360"');
        expect(numberingXml(saved)).toContain('<w:ind w:hanging="360" w:left="1800"');
        expect(strFromU8(unzipSync(saved)['word/document.xml']!)).not.toContain('<w:ind');
      });
    }
  );

  test('switching to numbers keeps one count, and the shared indent is the majority one', () => {
    const styles =
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="ListNumber"><w:name w:val="List Number"/>' +
      '<w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr>' +
      '<w:ind w:left="1800" w:hanging="360"/></w:pPr></w:style>';
    const styled = `<w:p><w:pPr><w:pStyle w:val="ListNumber"/></w:pPr><w:r><w:t>a</w:t></w:r></w:p>`;
    withSurface(docx(styled + item('b', 0) + item('c', 0), numbered(), styles), (surface) => {
      const before = positions(surface);
      selectParagraphs(surface, 0, 2);
      expect(surface.toggleList('bullet')).toBe(true);
      expect(positions(surface)).toEqual(before);
      selectParagraphs(surface, 0, 2);
      expect(surface.toggleList('ordered')).toBe(true);
      // One counted list has one indent per level: the two plain items keep theirs, and
      // the styled item, alone at 1800, joins them rather than taking them along.
      expect(placements(surface).map((entry) => entry.marker)).toEqual(['1.', '2.', '3.']);
      expect(positions(surface)).toEqual([before[1], before[1], before[2]]);
    });
  });

  test('a whole list its style numbers keeps the style indent when switched to numbers', () => {
    const bullets =
      `<w:abstractNum w:abstractNumId="0">${levels('bullet')}</w:abstractNum>` +
      '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>';
    const styles =
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/>' +
      '<w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr>' +
      '<w:ind w:left="1800" w:hanging="360"/></w:pPr></w:style>';
    const styled = (text: string): string =>
      `<w:p><w:pPr><w:pStyle w:val="ListBullet"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
    withSurface(docx(styled('a') + styled('b') + styled('c'), bullets, styles), (surface) => {
      const before = positions(surface);
      selectParagraphs(surface, 0, 2);
      expect(surface.toggleList('ordered')).toBe(true);
      expect(placements(surface).map((entry) => entry.marker)).toEqual(['1.', '2.', '3.']);
      expect(positions(surface)).toEqual(before);
    });
  });

  test('Tab still moves a switched item that its style numbers', () => {
    const styles =
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="ListNumber"><w:name w:val="List Number"/>' +
      '<w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr>' +
      '<w:ind w:left="1800" w:hanging="360"/></w:pPr></w:style>';
    const styled = `<w:p><w:pPr><w:pStyle w:val="ListNumber"/></w:pPr><w:r><w:t>a</w:t></w:r></w:p>`;
    withSurface(docx(styled + item('b', 0), numbered(), styles), (surface) => {
      const before = positions(surface);
      caretIn(surface, 0);
      expect(surface.toggleList('bullet')).toBe(true);
      expect(positions(surface)[0]).toEqual(before[0]);
      expect(surface.adjustIndent('increase')).toBe(true);
      expect(placements(surface)[0]!.marker).toBe('o');
      // Level 1 of the list: the marker at 0.5", the text 0.25" further in.
      expect(positions(surface)[0]).toEqual({ markerX: 36, textX: 54 });
      expect(surface.adjustIndent('decrease')).toBe(true);
      expect(positions(surface)[0]).toEqual(before[0]);
    });
  });

  test("a style's right indent on one item stays off the other items", () => {
    const styles =
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Narrow"><w:name w:val="Narrow"/>' +
      '<w:basedOn w:val="Normal"/><w:pPr><w:ind w:right="4000"/></w:pPr></w:style>';
    const long = 'word '.repeat(60);
    const narrow =
      '<w:p><w:pPr><w:pStyle w:val="Narrow"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/>' +
      `</w:numPr></w:pPr><w:r><w:t>${long}</w:t></w:r></w:p>`;
    const lineCounts = (surface: PaginatedSurface) =>
      surface
        .layout()
        .pages.flatMap((page) => page.fragments)
        .flatMap((fragment) => (fragment.kind === 'paragraph' ? [fragment.lines.length] : []));
    withSurface(docx(narrow + item(long, 0), numbered(), styles), (surface) => {
      const before = lineCounts(surface);
      selectParagraphs(surface, 0, 1);
      expect(surface.toggleList('bullet')).toBe(true);
      expect(lineCounts(surface)).toEqual(before);
    });
  });

  test('a level override and a space suffix carry over', () => {
    const numbering =
      `<w:abstractNum w:abstractNumId="0">${levels('decimal', '<w:suff w:val="space"/>')}</w:abstractNum>` +
      '<w:num w:numId="1"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0">' +
      '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:suff w:val="space"/>' +
      '<w:lvlText w:val="%1."/><w:lvlJc w:val="left"/>' +
      '<w:pPr><w:ind w:left="1000" w:hanging="500"/></w:pPr></w:lvl></w:lvlOverride></w:num>';
    withSurface(docx(LIST, numbering), (surface) => {
      const before = positions(surface);
      caretIn(surface, 1);
      expect(surface.toggleList('bullet')).toBe(true);
      expect(positions(surface)).toEqual(before);
      const xml = numberingXml(surface.save());
      expect(xml).toContain('<w:ind w:hanging="500" w:left="1000"/>');
      expect(xml).toContain('<w:suff w:val="space"/><w:lvlText w:val=""/>');
    });
  });

  test('switching back and forth reuses one definition per kind', () => {
    withSurface(docx(item('only', 0) + item('plain'), numbered()), (surface) => {
      caretIn(surface, 0);
      surface.toggleList('bullet');
      surface.toggleList('ordered');
      const settled = numberingXml(surface.save());
      for (let round = 0; round < 3; round += 1) {
        surface.toggleList('bullet');
        surface.toggleList('ordered');
      }
      const xml = numberingXml(surface.save());
      expect(count(xml, 'abstractNum')).toBe(count(settled, 'abstractNum'));
      expect(count(xml, 'abstractNum')).toBe(3);
    });
  });

  test('the switch survives save and reopen, and undo restores the number', () => {
    let saved: Uint8Array | null = null;
    let before: ReturnType<typeof positions> = [];
    withSurface(docx(LIST, numbered()), (surface) => {
      before = positions(surface);
      caretIn(surface, 2);
      surface.toggleList('bullet');
      saved = surface.save();
      surface.undo();
      expect(placements(surface)[2]!.marker).toBe('1)');
      expect(positions(surface)).toEqual(before);
    });
    withSurface(saved!, (reopened) => {
      expect(placements(reopened)[2]!.marker).toBe(BULLET);
      expect(positions(reopened)).toEqual(before);
    });
  });

  test('a suggested switch keeps the item in place and records the old numbering', () => {
    withSurface(docx(LIST, numbered()), (surface) => {
      const before = positions(surface);
      surface.setAuthor('Reviewer');
      surface.setEditingMode('suggest');
      caretIn(surface, 2);
      expect(surface.toggleList('bullet')).toBe(true);
      expect(placements(surface)[2]!.marker).toBe(BULLET);
      expect(positions(surface)).toEqual(before);
      const document = strFromU8(unzipSync(surface.save())['word/document.xml']!);
      expect(document).toMatch(/<w:pPrChange[^>]*>.*<w:numId w:val="1"\/>/);
    });
  });

  test('a paragraph that was not a list item still gets the stock indents', () => {
    withSurface(docx(item('plain'), ''), (surface) => {
      caretIn(surface, 0);
      expect(surface.toggleList('bullet')).toBe(true);
      expect(numberingXml(surface.save())).toContain('<w:ind w:hanging="360" w:left="720"/>');
    });
  });
});
