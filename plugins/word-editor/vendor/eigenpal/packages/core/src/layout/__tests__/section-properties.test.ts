// The page the document asks for (task 11.1 follow-through).
//
// Every value here comes from an attacker-controlled attribute, so the tests are as much
// about what is REFUSED as about what is read: a page size is a loop bound for pagination,
// and a document claiming a page a mile tall must not be able to make the engine try.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8, strFromU8, unzipSync } from 'fflate';
import {
  readOoxmlPackage,
  readOoxmlPart,
  writeOoxmlPackage,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import {
  DEFAULT_SECTION_PROPERTIES,
  enumerateDocumentSections,
  geometryOfSection,
  readSectionProperties,
  storyBlocks,
} from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const withSection = (sectPr: string) =>
  load(`<w:p><w:r><w:t>x</w:t></w:r></w:p><w:sectPr>${sectPr}</w:sectPr>`);

describe('a section is read from the document (task 11.1)', () => {
  test('a document with no sectPr gets Word’s defaults, not zero', () => {
    expect(readSectionProperties(load('<w:p/>'))).toEqual(DEFAULT_SECTION_PROPERTIES);
  });

  test('A4 is read as A4, so it does not paginate as Letter', () => {
    // The reason this matters: the page size decides where the lines and the pages break,
    // so getting it wrong is wrong before anything is painted.
    const section = readSectionProperties(withSection('<w:pgSz w:w="11906" w:h="16838"/>'));
    expect(section.pageSize).toEqual({ widthTwips: 11906, heightTwips: 16838 });
  });

  test('margins are read, including header, footer and gutter', () => {
    const section = readSectionProperties(
      withSection(
        '<w:pgMar w:top="720" w:right="1080" w:bottom="720" w:left="1080" ' +
          'w:header="360" w:footer="360" w:gutter="180"/>'
      )
    );
    expect(section.margins).toEqual({
      topTwips: 720,
      rightTwips: 1080,
      bottomTwips: 720,
      leftTwips: 1080,
      headerTwips: 360,
      footerTwips: 360,
      gutterTwips: 180,
    });
  });

  test('landscape and a title page are read', () => {
    const section = readSectionProperties(
      withSection('<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/><w:titlePg/>')
    );
    expect(section.landscape).toBe(true);
    expect(section.titlePage).toBe(true);
  });

  test('swapped dimensions without the attribute still read as landscape', () => {
    // Layout paginates against the dimensions, so a page wider than tall IS landscape
    // whatever `w:orient` says (or fails to say).
    const section = readSectionProperties(withSection('<w:pgSz w:w="15840" w:h="12240"/>'));
    expect(section.landscape).toBe(true);
  });

  test('columns are read, with a sane count', () => {
    const section = readSectionProperties(withSection('<w:cols w:num="3" w:space="540"/>'));
    expect(section.columns).toEqual({
      count: 3,
      gapTwips: 540,
      equalWidth: true,
      separator: false,
      definitions: [],
    });
  });

  test('a NEGATIVE margin is honoured, because content may bleed into it', () => {
    const section = readSectionProperties(withSection('<w:pgMar w:left="-720"/>'));
    expect(section.margins.leftTwips).toBe(-720);
  });
});

describe('hostile section values are refused, not honoured (task 11.1)', () => {
  test('an absurd page size falls back rather than becoming a pagination bound', () => {
    // A page size is a loop bound: honouring a million inches would paginate until memory
    // ran out.
    const section = readSectionProperties(withSection('<w:pgSz w:w="999999999" w:h="999999999"/>'));
    expect(section.pageSize).toEqual(DEFAULT_SECTION_PROPERTIES.pageSize);
  });

  test('a zero or negative page size falls back', () => {
    expect(readSectionProperties(withSection('<w:pgSz w:w="0" w:h="0"/>')).pageSize).toEqual(
      DEFAULT_SECTION_PROPERTIES.pageSize
    );
    expect(readSectionProperties(withSection('<w:pgSz w:w="-100" w:h="-100"/>')).pageSize).toEqual(
      DEFAULT_SECTION_PROPERTIES.pageSize
    );
  });

  test('a non-numeric value falls back rather than becoming NaN', () => {
    // NaN geometry produces NaN line positions, which paint as nothing and hit-test as
    // nowhere — a failure with no error attached to it.
    const section = readSectionProperties(withSection('<w:pgSz w:w="__proto__" w:h="abc"/>'));
    expect(section.pageSize).toEqual(DEFAULT_SECTION_PROPERTIES.pageSize);
    expect(Number.isFinite(section.margins.leftTwips)).toBe(true);
  });

  test('a hostile column count cannot divide the content width to nothing', () => {
    expect(readSectionProperties(withSection('<w:cols w:num="0"/>')).columns.count).toBe(1);
    expect(readSectionProperties(withSection('<w:cols w:num="99999"/>')).columns.count).toBe(12);
  });
});

describe('section properties become the geometry layout paginates against', () => {
  test('twips convert to points', () => {
    const geometry = geometryOfSection(DEFAULT_SECTION_PROPERTIES);
    expect(geometry).toEqual({
      width: 612,
      height: 792,
      margin: { top: 72, right: 72, bottom: 72, left: 72 },
      headerDistance: 36,
      footerDistance: 36,
    });
  });

  test('the gutter is added to the left margin, not taken out of the content', () => {
    // It is binding allowance on the inner edge. Folding it into the content width instead
    // would silently narrow every line without moving the text.
    const geometry = geometryOfSection({
      ...DEFAULT_SECTION_PROPERTIES,
      margins: { ...DEFAULT_SECTION_PROPERTIES.margins, gutterTwips: 720 },
    });
    expect(geometry.margin.left).toBe(108);
  });

  test('margins that swallow the page fall back rather than producing a zero content area', () => {
    // Paginating into a column of zero height never terminates.
    const geometry = geometryOfSection({
      ...DEFAULT_SECTION_PROPERTIES,
      margins: {
        ...DEFAULT_SECTION_PROPERTIES.margins,
        leftTwips: 20000,
        rightTwips: 20000,
      },
    });
    expect(geometry.width).toBe(612);
  });
});

describe('multi-section documents enumerate every sectPr', () => {
  test('a paragraph-level sectPr ends the preceding section; absent type is nextPage', () => {
    const part = load(
      '<w:p><w:r><w:t>cover</w:t></w:r></w:p>' +
        '<w:p><w:pPr><w:sectPr>' +
        '<w:pgMar w:top="2880" w:right="1440" w:bottom="1440" w:left="1440"/>' +
        '</w:sectPr></w:pPr></w:p>' +
        '<w:p><w:r><w:t>body</w:t></w:r></w:p>' +
        '<w:sectPr><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>'
    );
    const sections = enumerateDocumentSections(part);
    expect(sections).toHaveLength(2);
    expect(sections[0]!.properties.breakType).toBe('nextPage');
    expect(sections[0]!.properties.margins.topTwips).toBe(2880);
    expect(sections[0]!.blockEndExclusive - sections[0]!.blockStart).toBe(2);
    expect(sections[1]!.properties.margins.topTwips).toBe(1440);
    expect(sections[1]!.properties.breakType).toBe('nextPage');
  });

  test('an explicit continuous type is preserved', () => {
    const part = load(
      '<w:p><w:pPr><w:sectPr><w:type w:val="continuous"/></w:sectPr></w:pPr></w:p>' +
        '<w:sectPr><w:type w:val="nextPage"/></w:sectPr>'
    );
    const sections = enumerateDocumentSections(part);
    expect(sections[0]!.properties.breakType).toBe('continuous');
    expect(sections[1]!.properties.breakType).toBe('nextPage');
  });

  test('a trailing body-level sectPr after every block closed is an empty final section', () => {
    const part = load(
      '<w:p><w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr>' +
        '<w:r><w:t>only</w:t></w:r></w:p>' +
        '<w:sectPr><w:pgSz w:w="15840" w:h="12240"/><w:type w:val="nextPage"/></w:sectPr>'
    );
    const sections = enumerateDocumentSections(part);
    expect(sections).toHaveLength(2);
    expect(sections[0]!.blockEndExclusive - sections[0]!.blockStart).toBe(1);
    expect(sections[1]!.blockStart).toBe(sections[1]!.blockEndExclusive);
    expect(sections[1]!.properties.breakType).toBe('nextPage');
    expect(sections[1]!.properties.pageSize).toEqual({ widthTwips: 15840, heightTwips: 12240 });
  });
});

describe('titlePg on/off semantics', () => {
  test.each([
    ['omitted', '', false],
    ['empty element', '<w:titlePg/>', true],
    ['val=1', '<w:titlePg w:val="1"/>', true],
    ['val=true', '<w:titlePg w:val="true"/>', true],
    ['val=on', '<w:titlePg w:val="on"/>', true],
    ['val=0', '<w:titlePg w:val="0"/>', false],
    ['val=false', '<w:titlePg w:val="false"/>', false],
    ['val=off', '<w:titlePg w:val="off"/>', false],
  ] as const)('%s resolves titlePage=%s', (_label, titlePg, expected) => {
    const section = readSectionProperties(withSection(titlePg));
    expect(section.titlePage).toBe(expected);
  });

  test('titlePg does not inherit across adjacent sections', () => {
    const part = load(
      '<w:p><w:pPr><w:sectPr><w:titlePg/></w:sectPr></w:pPr><w:r><w:t>one</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>two</w:t></w:r></w:p>' +
        '<w:sectPr/>'
    );
    const sections = enumerateDocumentSections(part);
    expect(sections).toHaveLength(2);
    expect(sections[0]!.properties.titlePage).toBe(true);
    expect(sections[1]!.properties.titlePage).toBe(false);
  });

  test('titlePg turns on independently in a later section', () => {
    const part = load(
      '<w:p><w:pPr><w:sectPr/></w:pPr><w:r><w:t>one</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>two</w:t></w:r></w:p>' +
        '<w:sectPr><w:titlePg w:val="1"/></w:sectPr>'
    );
    const sections = enumerateDocumentSections(part);
    expect(sections[0]!.properties.titlePage).toBe(false);
    expect(sections[1]!.properties.titlePage).toBe(true);
  });

  test('explicit titlePg off in a later section does not inherit from the prior section', () => {
    const part = load(
      '<w:p><w:pPr><w:sectPr><w:titlePg/></w:sectPr></w:pPr><w:r><w:t>one</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>two</w:t></w:r></w:p>' +
        '<w:sectPr><w:titlePg w:val="0"/></w:sectPr>'
    );
    const sections = enumerateDocumentSections(part);
    expect(sections[0]!.properties.titlePage).toBe(true);
    expect(sections[1]!.properties.titlePage).toBe(false);
  });
});

describe('w:pgNumType authored vs default', () => {
  test('absent pgNumType leaves pageNumbering undefined', () => {
    const section = readSectionProperties(withSection('<w:pgSz w:w="12240" w:h="15840"/>'));
    expect(section.pageNumbering).toBeUndefined();
  });

  test('empty pgNumType reports no authored values', () => {
    const section = readSectionProperties(withSection('<w:pgNumType/>'));
    expect(section.pageNumbering).toEqual({});
  });

  test('start, fmt, chapStyle, and chapSep are read when authored', () => {
    const section = readSectionProperties(
      withSection(
        '<w:pgNumType w:start="3" w:fmt="lowerRoman" w:chapStyle="1" w:chapSep="period"/>'
      )
    );
    expect(section.pageNumbering).toEqual({
      start: 3,
      fmt: 'lowerRoman',
      chapStyle: 1,
      chapSep: 'period',
    });
  });

  test('hostile pgNumType attributes are dropped rather than invented', () => {
    const section = readSectionProperties(
      withSection(
        '<w:pgNumType w:start="-9" w:fmt="&lt;script&gt;" w:chapStyle="99" w:chapSep="boom"/>'
      )
    );
    expect(section.pageNumbering).toEqual({});
  });

  test('empty pgNumType round-trips as an empty element', () => {
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>x</w:t></w:r></w:p>` +
          `<w:sectPr><w:pgNumType/></w:sectPr></w:body></w:document>`
      ),
    });
    const loaded = readOoxmlPackage(bytes);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    expect(readSectionProperties(part).pageNumbering).toEqual({});
    const saved = writeOoxmlPackage(loaded.package);
    const reopened = unzipSync(saved);
    const xml = strFromU8(reopened['word/document.xml']!);
    expect(xml).toMatch(/<w:pgNumType\s*\/>/);
    expect(xml).not.toMatch(/<w:pgNumType[^>]+\w+=/);
  });
});

describe('section enumeration and story blocks are memoized per part identity', () => {
  test('the same part returns the same references; a different part does not', () => {
    const part = withSection('<w:pgSz w:w="11906" w:h="16838"/>');
    expect(storyBlocks(part)).toBe(storyBlocks(part));
    expect(enumerateDocumentSections(part)).toBe(enumerateDocumentSections(part));

    // Parts are immutable — an edit publishes a NEW part object, so a re-parse of the
    // same bytes stands in for one here.
    const editedTwin = withSection('<w:pgSz w:w="11906" w:h="16838"/>');
    expect(storyBlocks(editedTwin)).not.toBe(storyBlocks(part));
    expect(enumerateDocumentSections(editedTwin)).not.toBe(enumerateDocumentSections(part));
    expect(enumerateDocumentSections(editedTwin)).toEqual(enumerateDocumentSections(part));
  });

  test('display modes get distinct, individually stable entries', () => {
    const part = load(
      '<w:p><w:pPr><w:rPr><w:del w:id="1" w:author="a"/></w:rPr></w:pPr>' +
        '<w:del w:id="2" w:author="a"><w:r><w:delText>gone</w:delText></w:r></w:del></w:p>' +
        '<w:p><w:r><w:t>kept</w:t></w:r></w:p>'
    );
    const allMarkup = storyBlocks(part, 'all-markup');
    const proposed = storyBlocks(part, 'proposed');
    expect(allMarkup).not.toBe(proposed);
    // The proposed view drops the revision-deleted paragraph; the memo must not
    // leak one mode's filtering into the other.
    expect(proposed.length).toBeLessThan(allMarkup.length);
    expect(storyBlocks(part, 'all-markup')).toBe(allMarkup);
    expect(storyBlocks(part, 'proposed')).toBe(proposed);
  });
});
