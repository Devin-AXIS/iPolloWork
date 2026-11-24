// What the save/reopen oracle must NOTICE.
//
// The digest is the only oracle that can catch a serializer losing meaning: the
// fingerprint compares a tree against its own reopen, so content dropped identically on
// every pass fingerprints EQUAL. Every hole here was a document that could be gutted —
// its numbering, its borders, its tab stops, its paragraph marks, its whole table
// structure, its section setup, its style and numbering definitions — with the oracle
// reporting no difference at all.
//
// Each case is stated as two documents that MEAN different things. The digest must say so.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { readOoxmlPart, type OoxmlPart } from '../package/ooxml-tree.ts';
import { readOoxmlPackage, writeOoxmlPackage } from '../package/ooxml-package.ts';
import { diffSemanticDigests, semanticDigest } from '../package/ooxml-digest.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function load(body: string, root = 'document'): OoxmlPart {
  const xml =
    root === 'document'
      ? `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`
      : `<w:${root} xmlns:w="${W}" xmlns:r="${R}">${body}</w:${root}>`;
  const result = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

/** Every way the two documents differ, as the oracle reports it. */
function differences(before: OoxmlPart, after: OoxmlPart): string[] {
  return diffSemanticDigests(semanticDigest([before]), semanticDigest([after])).map(
    (difference) => difference.path
  );
}

function mustDiffer(before: OoxmlPart, after: OoxmlPart): void {
  expect(differences(before, after)).not.toEqual([]);
}

describe('a property that carries its meaning in CHILDREN', () => {
  test('w:numPr — the list a paragraph is in, and at what level', () => {
    const numbered = (numId: string, level: string) =>
      load(
        `<w:p><w:pPr><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>` +
          '<w:r><w:t>item</w:t></w:r></w:p>'
      );
    mustDiffer(numbered('3', '0'), numbered('99', '5'));
    // And losing the numbering entirely is the loudest case of all.
    mustDiffer(
      numbered('3', '0'),
      load('<w:p><w:pPr><w:numPr/></w:pPr><w:r><w:t>item</w:t></w:r></w:p>')
    );
  });

  test('w:pBdr — a paragraph border set reduced to an empty element', () => {
    const bordered =
      '<w:pBdr><w:top w:val="single" w:sz="4" w:color="FF0000"/>' +
      '<w:bottom w:val="double" w:sz="8" w:color="00FF00"/></w:pBdr>';
    mustDiffer(
      load(`<w:p><w:pPr>${bordered}</w:pPr><w:r><w:t>x</w:t></w:r></w:p>`),
      load('<w:p><w:pPr><w:pBdr/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>')
    );
  });

  test('w:tabs — the stops a paragraph declares', () => {
    mustDiffer(
      load(
        '<w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="9000" w:leader="dot"/></w:tabs></w:pPr>' +
          '<w:r><w:t>x</w:t></w:r></w:p>'
      ),
      load('<w:p><w:pPr><w:tabs/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>')
    );
  });

  test('the paragraph MARK — w:pPr/w:rPr, what the pilcrow and the list marker wear', () => {
    mustDiffer(
      load(
        '<w:p><w:pPr><w:rPr><w:b/><w:sz w:val="48"/></w:rPr></w:pPr><w:r><w:t>x</w:t></w:r></w:p>'
      ),
      load('<w:p><w:pPr><w:rPr/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>')
    );
  });

  test('a run property that nests — w:rFonts is flat, but w:eastAsianLayout is not', () => {
    mustDiffer(
      load(
        '<w:p><w:r><w:rPr><w:eastAsianLayout w:id="1" w:combine="1"/></w:rPr><w:t>x</w:t></w:r></w:p>'
      ),
      load('<w:p><w:r><w:rPr><w:eastAsianLayout/></w:rPr><w:t>x</w:t></w:r></w:p>')
    );
  });
});

describe('table structure and properties', () => {
  const TABLE =
    '<w:tbl><w:tblPr><w:tblStyle w:val="Grid"/><w:tblW w:w="5000" w:type="pct"/>' +
    '<w:tblBorders><w:top w:val="single" w:sz="4"/></w:tblBorders></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="4680"/><w:gridCol w:w="4680"/></w:tblGrid>' +
    '<w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/><w:shd w:fill="FFFF00"/></w:tcPr>' +
    '<w:p><w:r><w:t>one</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr>' +
    '<w:p><w:r><w:t>two</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';

  test('a table stripped of every property it declares', () => {
    const stripped =
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>one</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:p><w:r><w:t>two</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
    mustDiffer(load(TABLE), load(stripped));
  });

  test('a table FLATTENED into loose paragraphs', () => {
    // Same paragraphs, same text, in the same order — and no table at all. Harvesting
    // paragraphs out of the nesting made containment itself unobservable.
    const flattened = '<w:p><w:r><w:t>one</w:t></w:r></w:p><w:p><w:r><w:t>two</w:t></w:r></w:p>';
    mustDiffer(load(TABLE), load(flattened));
  });

  test('two cells merged into one row-spanning cell', () => {
    const oneCell =
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>one</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>two</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
    mustDiffer(
      load(
        '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>one</w:t></w:r></w:p></w:tc>' +
          '<w:tc><w:p><w:r><w:t>two</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
      ),
      load(oneCell)
    );
  });
});

describe('section properties', () => {
  const SECTION =
    '<w:sectPr><w:headerReference w:type="default" r:id="rId4"/>' +
    '<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>' +
    '<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/>' +
    '<w:cols w:num="2"/><w:titlePg/></w:sectPr>';

  test('the body-level section, dropped entirely', () => {
    mustDiffer(
      load(`<w:p><w:r><w:t>x</w:t></w:r></w:p>${SECTION}`),
      load('<w:p><w:r><w:t>x</w:t></w:r></w:p>')
    );
  });

  test('a mid-body section reduced to an empty element', () => {
    mustDiffer(
      load(`<w:p><w:pPr>${SECTION}</w:pPr><w:r><w:t>x</w:t></w:r></w:p>`),
      load('<w:p><w:pPr><w:sectPr/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>')
    );
  });
});

describe('the parts that are not stories', () => {
  test('numbering.xml — an abstractNum losing its levels', () => {
    const levels = (count: number) => {
      let xml = '<w:abstractNum w:abstractNumId="0">';
      for (let level = 0; level < count; level += 1) {
        xml +=
          `<w:lvl w:ilvl="${level}"><w:numFmt w:val="bullet"/>` +
          `<w:lvlText w:val="•"/><w:pPr><w:ind w:left="${720 * (level + 1)}"/></w:pPr></w:lvl>`;
      }
      return `${xml}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>`;
    };
    mustDiffer(load(levels(9), 'numbering'), load(levels(1), 'numbering'));
  });

  test('styles.xml — a style losing its table conditional formatting', () => {
    mustDiffer(
      load(
        '<w:style w:type="table" w:styleId="Grid"><w:name w:val="Table Grid"/>' +
          '<w:tblStylePr w:type="firstRow"><w:rPr><w:b/></w:rPr></w:tblStylePr></w:style>',
        'styles'
      ),
      load(
        '<w:style w:type="table" w:styleId="Grid"><w:name w:val="Table Grid"/></w:style>',
        'styles'
      )
    );
  });

  test('settings.xml — the default tab stop vanishing', () => {
    mustDiffer(
      load('<w:defaultTabStop w:val="720"/><w:evenAndOddHeaders/>', 'settings'),
      load('<w:evenAndOddHeaders/>', 'settings')
    );
  });
});

describe('the stricter oracle still passes a real save and reopen', () => {
  // The point of a tighter net is to catch a serializer that loses meaning. Pulling it
  // tight is only honest if the engine's own round trip goes through it — on real files,
  // every part of them, with nothing edited: whatever differs here IS a loss.
  const FIXTURES = [
    'comprehensive-word-element-test.docx',
    'block-sdt-comprehensive.docx',
    'editable-sample.docx',
  ] as const;

  for (const name of FIXTURES) {
    test(`${name}: every part digests identically after save and reopen`, () => {
      const bytes = new Uint8Array(
        readFileSync(new URL(`../../../../../e2e/fixtures/${name}`, import.meta.url))
      );
      const opened = readOoxmlPackage(bytes);
      if (!opened.ok) throw new Error(`${name}: ${opened.reason}`);
      const reopened = readOoxmlPackage(writeOoxmlPackage(opened.package));
      if (!reopened.ok) throw new Error(`${name}: reopen failed: ${reopened.reason}`);
      const differences = diffSemanticDigests(
        semanticDigest(opened.package.parts.values()),
        semanticDigest(reopened.package.parts.values())
      );
      expect(differences.slice(0, 5)).toEqual([]);
    });
  }
});

describe('w14 paragraph identity', () => {
  const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
  const identified = (paraId: string) =>
    load(
      `<w:p xmlns:w14="${W14}" w14:paraId="${paraId}" w14:textId="${paraId}"><w:r><w:t>x</w:t></w:r></w:p>`
    );

  test('w14:paraId — the identity the agent contract anchors on', () => {
    // Comment threading and DocAnchor addressing reference it; a serializer dropping or
    // rewriting it must be a difference.
    mustDiffer(identified('4C000001'), identified('4C000002'));
    mustDiffer(identified('4C000001'), load('<w:p><w:r><w:t>x</w:t></w:r></w:p>'));
    expect(differences(identified('4C000001'), identified('4C000002'))).toEqual([
      '/word/document.xml.p[0].paraId',
    ]);
    // Case is not meaning: matching is case-insensitive, so casing alone is no difference.
    expect(differences(identified('4c00aa01'), identified('4C00AA01'))).toEqual([]);
  });

  test('other paragraph attributes stay deliberately blind (rsid noise)', () => {
    const withRsid = load('<w:p w:rsidR="00AB12CD"><w:r><w:t>x</w:t></w:r></w:p>');
    const without = load('<w:p><w:r><w:t>x</w:t></w:r></w:p>');
    expect(differences(withRsid, without)).toEqual([]);
  });
});
