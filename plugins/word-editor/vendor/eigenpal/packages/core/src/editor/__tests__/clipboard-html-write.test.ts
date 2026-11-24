// Interop HTML from a clipboard fragment package (rich-clipboard-fidelity task 3.2).
//
// Each test zips a hand-written miniature WordprocessingML package — the same entry
// shapes `clipboard-fragment-extract.ts` produces — and asserts on the emitted string.
// Pure strings end to end: no DOM on either side.

import { describe, expect, test } from 'bun:test';
import { writeZip, strToU8 } from '../../store/package/zip.ts';
import { MAX_INLINE_CONTAINER_DEPTH } from '../../store/package/ooxml-shared.ts';
import { interopHtmlFromFragment } from '../clipboard-html-write.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

interface FragmentInput {
  readonly body: string;
  readonly styles?: string;
  readonly numbering?: string;
  readonly footnotes?: string;
  readonly endnotes?: string;
  readonly footnotesRels?: string;
  readonly endnotesRels?: string;
  /** Extra `<Relationship .../>` rows for word/_rels/document.xml.rels. */
  readonly docRels?: string;
  /** Media entries by zip name, e.g. `word/media/image1.png`. */
  readonly media?: Readonly<Record<string, Uint8Array>>;
}

// Format defaults, pinned so the fixture does not take the application defaults for omitted docDefaults.
const FORMAT_DOC_DEFAULTS =
  '<w:docDefaults><w:rPrDefault><w:rPr><w:kern w:val="2"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>';

function fragment(input: FragmentInput): Uint8Array {
  const entries = new Map<string, Uint8Array>();
  const overrides = [
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
  ];
  let docRels = input.docRels ?? '';
  if (input.styles !== undefined) {
    entries.set('word/styles.xml', strToU8(`<w:styles xmlns:w="${W}">${input.styles}</w:styles>`));
    overrides.push(
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
    );
    docRels += `<Relationship Id="rId9001" Type="${R}/styles" Target="styles.xml"/>`;
  }
  if (input.numbering !== undefined) {
    entries.set(
      'word/numbering.xml',
      strToU8(`<w:numbering xmlns:w="${W}">${input.numbering}</w:numbering>`)
    );
    overrides.push(
      '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
    );
    docRels += `<Relationship Id="rId9002" Type="${R}/numbering" Target="numbering.xml"/>`;
  }
  for (const kind of ['footnotes', 'endnotes'] as const) {
    const xml = input[kind];
    if (xml === undefined) continue;
    entries.set(
      `word/${kind}.xml`,
      strToU8(`<w:${kind} xmlns:w="${W}" xmlns:r="${R}">${xml}</w:${kind}>`)
    );
    overrides.push(
      `<Override PartName="/word/${kind}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml"/>`
    );
    docRels += `<Relationship Id="rId-${kind}" Type="${R}/${kind}" Target="${kind}.xml"/>`;
    const rels = input[`${kind}Rels`];
    if (rels !== undefined) {
      entries.set(
        `word/_rels/${kind}.xml.rels`,
        strToU8(`<Relationships xmlns="${REL}">${rels}</Relationships>`)
      );
    }
  }
  for (const [name, bytes] of Object.entries(input.media ?? {})) entries.set(name, bytes);

  entries.set(
    '[Content_Types].xml',
    strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Default Extension="png" ContentType="image/png"/>' +
        '<Default Extension="bmp" ContentType="image/bmp"/>' +
        '<Default Extension="webp" ContentType="image/webp"/>' +
        '<Default Extension="svg" ContentType="image/svg+xml"/>' +
        '<Default Extension="tiff" ContentType="image/tiff"/>' +
        '<Default Extension="emf" ContentType="image/x-emf"/>' +
        '<Default Extension="wmf" ContentType="image/x-wmf"/>' +
        overrides.join('') +
        '</Types>'
    )
  );
  entries.set(
    '_rels/.rels',
    strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/>` +
        '</Relationships>'
    )
  );
  entries.set(
    'word/_rels/document.xml.rels',
    strToU8(`<Relationships xmlns="${REL}">${docRels}</Relationships>`)
  );
  entries.set(
    'word/document.xml',
    strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}">` +
        `<w:body>${input.body}</w:body></w:document>`
    )
  );
  return writeZip(entries);
}

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

describe('interopHtmlFromFragment', () => {
  test('unreadable bytes produce the empty string', () => {
    expect(interopHtmlFromFragment(new Uint8Array([1, 2, 3, 4]))).toBe('');
  });

  test('omitted defaults copy as the application defaults; no styles part copies none', () => {
    const body = '<w:p><w:r><w:t>plain</w:t></w:r></w:p>';
    const styled = interopHtmlFromFragment(
      fragment({ body, styles: '<w:style w:type="paragraph" w:styleId="Body"/>' })
    );
    expect(styled).toContain('font-size:12pt');
    expect(styled).toContain('margin-bottom:8pt');
    const bare = interopHtmlFromFragment(fragment({ body }));
    expect(bare).not.toContain('font-size');
    expect(bare).not.toContain('margin-bottom');
  });

  test('the default character style adds nothing to a copied run', () => {
    const styles =
      FORMAT_DOC_DEFAULTS +
      '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont">' +
      '<w:rPr><w:color w:val="FF0000"/></w:rPr></w:style>' +
      '<w:style w:type="character" w:styleId="Strong"><w:basedOn w:val="DefaultParagraphFont"/>' +
      '<w:rPr><w:b/></w:rPr></w:style>';
    const run = (rPr: string) => `<w:r><w:rPr>${rPr}</w:rPr><w:t>x</w:t></w:r>`;
    const html = interopHtmlFromFragment(
      fragment({
        styles,
        body:
          `<w:p>${run('')}${run('<w:rStyle w:val="DefaultParagraphFont"/>')}` +
          `${run('<w:rStyle w:val="Strong"/>')}</w:p>`,
      })
    );
    expect(html).not.toContain('#ff0000');
    expect(html).toContain('font-weight:bold');
  });

  test('a formatted run carries its resolved inline CSS', () => {
    const html = interopHtmlFromFragment(
      fragment({
        body:
          '<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:rPr>' +
          '<w:rFonts w:eastAsia="微软雅黑"/><w:b/><w:i/>' +
          '<w:color w:val="FF0000"/><w:spacing w:val="30"/><w:sz w:val="28"/>' +
          '<w:u w:val="wave" w:color="00AAFF"/>' +
          '<w:rtl/><w:lang w:val="ar-SA"/>' +
          '</w:rPr><w:t>styled</w:t></w:r></w:p>',
      })
    );
    expect(html).toContain('font-weight:bold');
    expect(html).toContain('font-style:italic');
    expect(html).toContain('color:#ff0000');
    expect(html).toContain('font-size:14pt');
    expect(html).toContain('font-family:&quot;微软雅黑&quot;');
    expect(html).toContain('text-decoration:underline');
    expect(html).toContain('text-decoration-style:wavy');
    expect(html).toContain('text-decoration-color:#00aaff');
    expect(html).toContain('letter-spacing:1.5pt');
    expect(html).toContain('<p dir="rtl"');
    expect(html).toContain('lang="ar-SA" dir="rtl"');
    expect(html).toContain('>styled<');
  });

  test('an RTL paragraph copies its physical alignment and margins', () => {
    const html = interopHtmlFromFragment(
      fragment({
        body:
          '<w:p><w:pPr><w:bidi/><w:ind w:left="720" w:right="360"/><w:jc w:val="left"/></w:pPr>' +
          '<w:r><w:rPr><w:rtl/></w:rPr><w:t>rtl</w:t></w:r></w:p>' +
          '<w:p><w:pPr><w:ind w:left="720"/><w:jc w:val="left"/></w:pPr>' +
          '<w:r><w:t>ltr</w:t></w:r></w:p>',
      })
    );
    const [rtl, ltr] = html.split('</p>');
    // `w:jc="left"` in a bidi paragraph sits at the RIGHT margin, and `w:ind w:left` is its
    // leading (right) side.
    expect(rtl).toContain('text-align:right');
    expect(rtl).toContain('margin-right:36pt');
    expect(rtl).toContain('margin-left:18pt');
    expect(ltr).toContain('text-align:left');
    expect(ltr).toContain('margin-left:36pt');
  });

  test('inline run wrappers contribute their text in reading order', () => {
    const html = interopHtmlFromFragment(
      fragment({
        body:
          '<w:p><w:r><w:t xml:space="preserve">before </w:t></w:r>' +
          '<w:smartTag><w:r><w:t>smart</w:t></w:r></w:smartTag>' +
          '<w:customXml><w:r><w:t>custom</w:t></w:r></w:customXml>' +
          '<w:sdt><w:sdtContent><w:r><w:t>demoted</w:t></w:r></w:sdtContent><w:sdtPr/></w:sdt>' +
          '<w:dir><w:r><w:t>dir</w:t></w:r></w:dir>' +
          '<w:bdo><w:r><w:t>bdo</w:t></w:r></w:bdo>' +
          '<w:r><w:t xml:space="preserve"> after</w:t></w:r></w:p>',
      })
    );

    expect(html).toContain('before smartcustomdemoteddirbdo after');
  });

  test('an RTL run exports its complex-script font', () => {
    const html = interopHtmlFromFragment(
      fragment({
        body:
          '<w:p><w:r><w:rPr><w:rFonts w:ascii="Arial" w:cs="Amiri"/>' +
          '<w:rtl/></w:rPr><w:t>مرحبا</w:t></w:r></w:p>',
      })
    );
    expect(html).toContain('font-family:&quot;Amiri&quot;');
    expect(html).not.toContain('font-family:Arial');
  });

  test('a complex-script font remains the last fallback for an LTR run', () => {
    const html = interopHtmlFromFragment(
      fragment({
        body: '<w:p><w:r><w:rPr><w:rFonts w:cs="Amiri"/></w:rPr><w:t>text</w:t></w:r></w:p>',
      })
    );
    expect(html).toContain('font-family:&quot;Amiri&quot;');
  });

  test('an RTL run prefers complex-script size, bold, and italic properties', () => {
    const html = interopHtmlFromFragment(
      fragment({
        body:
          '<w:p><w:r><w:rPr><w:rtl/><w:sz w:val="20"/><w:szCs w:val="30"/>' +
          '<w:bCs/><w:iCs/></w:rPr><w:t>مرحبا</w:t></w:r></w:p>',
      })
    );
    expect(html).toContain('font-size:15pt');
    expect(html).toContain('font-weight:bold');
    expect(html).toContain('font-style:italic');
  });

  test('a style chain reaching Heading2 emits an h2 with the cascaded CSS', () => {
    const html = interopHtmlFromFragment(
      fragment({
        styles:
          '<w:style w:type="paragraph" w:styleId="Heading1">' +
          '<w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>' +
          '<w:style w:type="paragraph" w:styleId="Heading2">' +
          '<w:basedOn w:val="Heading1"/><w:name w:val="heading 2"/>' +
          '<w:pPr><w:outlineLvl w:val="1"/><w:spacing w:before="240"/><w:jc w:val="center"/></w:pPr>' +
          '</w:style>' +
          '<w:style w:type="paragraph" w:styleId="Fancy"><w:basedOn w:val="Heading2"/></w:style>',
        body: '<w:p><w:pPr><w:pStyle w:val="Fancy"/></w:pPr>' + '<w:r><w:t>Title</w:t></w:r></w:p>',
      })
    );
    expect(html).toContain('<h2');
    expect(html).toContain('</h2>');
    expect(html).toContain('margin-top:12pt');
    expect(html).toContain('text-align:center');
  });

  test('Word built-in paragraph styles emit their interop classes', () => {
    const html = interopHtmlFromFragment(
      fragment({
        styles:
          '<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
          '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/></w:style>' +
          '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style>' +
          '<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="Caption"/></w:style>' +
          '<w:style w:type="paragraph" w:styleId="Heading7"><w:name w:val="heading 7"/></w:style>',
        body:
          '<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t>normal</w:t></w:r></w:p>' +
          '<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>title</w:t></w:r></w:p>' +
          '<w:p><w:pPr><w:pStyle w:val="Caption"/></w:pPr><w:r><w:t>caption</w:t></w:r></w:p>' +
          '<w:p><w:pPr><w:pStyle w:val="Heading7"/></w:pPr><w:r><w:t>deep</w:t></w:r></w:p>',
      })
    );
    expect(html).toContain('<p class="MsoNormal"');
    expect(html).toContain('<p class="MsoTitle"');
    expect(html).toContain('<p class="MsoCaption"');
    expect(html).toContain('<p class="MsoHeading7"');
  });

  test('numbered and bulleted levels nest as ol/ul with list-style-type', () => {
    const item = (ilvl: number, text: string): string =>
      `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr>` +
      `<w:ilvl w:val="${ilvl}"/><w:numId w:val="5"/></w:numPr></w:pPr>` +
      `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
    const html = interopHtmlFromFragment(
      fragment({
        styles:
          FORMAT_DOC_DEFAULTS +
          '<w:style w:type="paragraph" w:styleId="ListParagraph">' +
          '<w:name w:val="List Paragraph"/></w:style>',
        numbering:
          '<w:abstractNum w:abstractNumId="0">' +
          '<w:lvl w:ilvl="0"><w:start w:val="5"/><w:numFmt w:val="decimal"/></w:lvl>' +
          '<w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl>' +
          '</w:abstractNum>' +
          '<w:num w:numId="5"><w:abstractNumId w:val="0"/>' +
          '<w:lvlOverride w:ilvl="0"><w:startOverride w:val="3"/></w:lvlOverride></w:num>',
        body:
          item(0, 'one') +
          item(1, 'sub') +
          item(0, 'two') +
          '<w:p><w:r><w:t>after</w:t></w:r></w:p>',
      })
    );
    expect(html).toContain('<ol start="3" style="list-style-type:decimal">');
    expect(html).toContain('<li class="MsoListParagraph"');
    expect(count(html, '<li')).toBe(3);
    // The bulleted level nests inside the ordered list and closes before "two".
    const ulOpen = html.indexOf('<ul>');
    const ulClose = html.indexOf('</ul>');
    expect(ulOpen).toBeGreaterThan(html.indexOf('one'));
    expect(ulOpen).toBeLessThan(html.indexOf('sub'));
    expect(ulClose).toBeGreaterThan(html.indexOf('sub'));
    expect(ulClose).toBeLessThan(html.indexOf('two'));
    // Lists close before the trailing plain paragraph.
    expect(html.indexOf('</ol>')).toBeLessThan(html.indexOf('after'));
    expect(html).toContain('<p>after</p>');
  });

  test('a list fragment starting below level zero opens one valid root list', () => {
    const item = (text: string): string =>
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="5"/>' +
      `</w:numPr></w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
    const html = interopHtmlFromFragment(
      fragment({
        numbering:
          '<w:abstractNum w:abstractNumId="0">' +
          '<w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl>' +
          '<w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl>' +
          '</w:abstractNum><w:num w:numId="5"><w:abstractNumId w:val="0"/></w:num>',
        body: item('sub one') + item('sub two'),
      })
    );
    expect(html).toBe('<ul><li>sub one</li><li>sub two</li></ul>');
  });

  test('a numbered heading keeps its semantic heading class', () => {
    const html = interopHtmlFromFragment(
      fragment({
        styles:
          '<w:style w:type="paragraph" w:styleId="Heading2">' +
          '<w:name w:val="heading 2"/></w:style>',
        numbering:
          '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0">' +
          '<w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>' +
          '<w:num w:numId="5"><w:abstractNumId w:val="0"/></w:num>',
        body:
          '<w:p><w:pPr><w:pStyle w:val="Heading2"/><w:numPr>' +
          '<w:ilvl w:val="0"/><w:numId w:val="5"/></w:numPr></w:pPr>' +
          '<w:r><w:t>Numbered heading</w:t></w:r></w:p>',
      })
    );
    expect(html).toContain('<li class="Heading2"');
  });

  test('a table emits colspan, rowspan, shading, and swallows vMerge continuations', () => {
    const cell = (props: string, text: string): string =>
      `<w:tc><w:tcPr>${props}</w:tcPr><w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p></w:tc>`;
    const html = interopHtmlFromFragment(
      fragment({
        body:
          '<w:tbl>' +
          '<w:tblPr><w:tblW w:w="4320" w:type="dxa"/><w:jc w:val="center"/>' +
          '<w:tblBorders><w:bottom w:val="single" w:color="112233"/>' +
          '<w:insideH w:val="dotted" w:color="445566"/></w:tblBorders></w:tblPr>' +
          `<w:tr><w:trPr><w:trHeight w:val="360" w:hRule="exact"/></w:trPr>${cell('<w:gridSpan w:val="999"/>', 'head')}</w:tr>` +
          `<w:tr>${cell('<w:vMerge w:val="restart"/><w:shd w:val="clear" w:fill="DDEEFF"/>', 'merged')}${cell('<w:vAlign w:val="center"/>', 'b1')}</w:tr>` +
          `<w:tr>${cell('<w:vMerge/>', '')}${cell('<w:tcW w:w="2400" w:type="dxa"/><w:tcMar><w:left w:w="120" w:type="dxa"/></w:tcMar>', 'b2')}</w:tr>` +
          '</w:tbl>',
      })
    );
    expect(html).toContain(
      '<table dir="ltr" align="center" style="border-collapse:collapse;width:216pt;margin-left:auto;margin-right:auto;'
    );
    expect(html).toContain('<tr style="height:18pt;mso-height-rule:exactly">');
    expect(html).toContain('colspan="63"');
    expect(html).toContain('rowspan="2"');
    // A missing w:sz defaults to the painter's 0.5pt hairline, not 1pt.
    expect(html).toMatch(/rowspan="2" style="[^"]*border-bottom:0\.5pt solid #112233/);
    expect(html).toContain('background-color:#ddeeff');
    expect(html).toContain('vertical-align:middle');
    expect(html).toContain('width:120pt');
    expect(html).toContain('padding-left:6pt');
    // The continuation cell is spanned, not emitted: 1 + 2 + 1 cells.
    expect(count(html, '<td')).toBe(4);
    expect(count(html, 'merged')).toBe(1);
  });

  test('a continuation below an unmerged cell starts its own merge and keeps its text', () => {
    const cell = (props: string, text: string): string =>
      `<w:tc><w:tcPr>${props}</w:tcPr><w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p></w:tc>`;
    const html = interopHtmlFromFragment(
      fragment({
        body:
          '<w:tbl>' +
          `<w:tr>${cell('', 'Party')}${cell('', 'Amount')}</w:tr>` +
          `<w:tr>${cell('<w:vMerge/>', 'Orphan')}${cell('', 'USD 300')}</w:tr>` +
          `<w:tr>${cell('<w:vMerge/>', '')}${cell('', 'USD 400')}</w:tr>` +
          '</w:tbl>',
      })
    );
    expect(html).toContain('Orphan');
    expect(html).toContain('rowspan="2"');
    expect(count(html, '<td')).toBe(5);
  });

  test('table borders resolve from tblBorders onto every cell', () => {
    const html = interopHtmlFromFragment(
      fragment({
        body:
          '<w:tbl><w:tblPr><w:tblBorders>' +
          '<w:top w:val="single" w:color="112233"/><w:left w:val="single"/>' +
          '<w:bottom w:val="none"/><w:right w:val="single" w:color="auto"/>' +
          '</w:tblBorders></w:tblPr>' +
          '<w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr>' +
          '</w:tbl>',
      })
    );
    // Width-less borders take the painter's 0.5pt default.
    expect(html).toContain('border-top:0.5pt solid #112233');
    expect(html).toContain('border-left:0.5pt solid #000000');
    expect(html).toContain('border-right:0.5pt solid #000000');
    expect(html).not.toContain('border-bottom');
  });

  test('table inside borders remain Word hints and interior cell edges', () => {
    const cell = (text: string): string =>
      `<w:tc><w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p></w:tc>`;
    const html = interopHtmlFromFragment(
      fragment({
        body:
          '<w:tbl><w:tblPr><w:tblBorders>' +
          '<w:insideH w:val="dotted" w:sz="4" w:color="112233"/>' +
          '<w:insideV w:val="dashed" w:sz="8" w:color="445566"/>' +
          '</w:tblBorders></w:tblPr>' +
          `<w:tr>${cell('a')}${cell('b')}</w:tr><w:tr>${cell('c')}${cell('d')}</w:tr>` +
          '</w:tbl>',
      })
    );
    expect(html).toContain('mso-border-insideh-alt:0.5pt dotted #112233');
    expect(html).toContain('mso-border-insidev-alt:1pt dashed #445566');
    expect(html).toContain('border-right:1pt dashed #445566');
    expect(html).toContain('border-bottom:0.5pt dotted #112233');
  });

  test('hyperlinks sanitize their targets; a refused scheme keeps the text only', () => {
    const html = interopHtmlFromFragment(
      fragment({
        docRels:
          `<Relationship Id="rId5" Type="${R}/hyperlink" Target="https://example.com/x" TargetMode="External"/>` +
          `<Relationship Id="rId6" Type="${R}/hyperlink" Target="javascript:alert(1)" TargetMode="External"/>` +
          `<Relationship Id="rId7" Type="${R}/hyperlink" Target="#_Ref1"/>`,
        body:
          '<w:p>' +
          '<w:bookmarkStart w:id="1" w:name="_Ref1"/>' +
          '<w:hyperlink r:id="rId5"><w:r><w:t>good</w:t></w:r></w:hyperlink>' +
          '<w:hyperlink r:id="rId6"><w:r><w:t>bad</w:t></w:r></w:hyperlink>' +
          '<w:hyperlink r:id="rId7"><w:r><w:t>related</w:t></w:r></w:hyperlink>' +
          '<w:hyperlink w:anchor="_Ref1"><w:r><w:t>internal</w:t></w:r></w:hyperlink>' +
          '<w:bookmarkEnd w:id="1"/>' +
          '</w:p>',
      })
    );
    expect(html).toContain('<a href="https://example.com/x">good</a>');
    expect(html).toContain('bad');
    expect(html).toContain('<a id="_Ref1"></a>');
    expect(html).toContain('<a href="#_Ref1">internal</a>');
    expect(html).toContain('<a href="#_Ref1">related</a>');
    expect(html).not.toContain('javascript:');
    expect(count(html, '<a ')).toBe(4);
  });

  test('an in-budget image inlines as a data: URI with px dimensions', () => {
    const bytes = strToU8('hello world!');
    const html = interopHtmlFromFragment(
      fragment({
        docRels: `<Relationship Id="rId7" Type="${R}/image" Target="media/image1.png"/>`,
        media: { 'word/media/image1.png': bytes },
        body:
          '<w:p><w:r><w:drawing><wp:inline>' +
          '<wp:extent cx="952500" cy="476250"/>' +
          `<a:graphic><a:graphicData uri="${PIC}">` +
          '<pic:pic><pic:blipFill><a:blip r:embed="rId7"/></pic:blipFill></pic:pic>' +
          '</a:graphicData></a:graphic>' +
          '</wp:inline></w:drawing></w:r></w:p>',
      })
    );
    expect(html).toContain('<img src="data:image/png;base64,aGVsbG8gd29ybGQh"');
    expect(html).toContain('width="100" height="50"');
  });

  test('WebP and BMP images inline with their declared MIME types', () => {
    for (const [extension, mime] of [
      ['webp', 'image/webp'],
      ['bmp', 'image/bmp'],
    ] as const) {
      const mediaName = `word/media/image1.${extension}`;
      const html = interopHtmlFromFragment(
        fragment({
          docRels: `<Relationship Id="rId7" Type="${R}/image" Target="media/image1.${extension}"/>`,
          media: { [mediaName]: strToU8('hello world!') },
          body:
            '<w:p><w:r><w:drawing><wp:inline>' +
            '<wp:extent cx="952500" cy="476250"/>' +
            `<a:graphic><a:graphicData uri="${PIC}">` +
            '<pic:pic><pic:blipFill><a:blip r:embed="rId7"/></pic:blipFill></pic:pic>' +
            '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>',
        })
      );
      expect(html).toContain(`<img src="data:${mime};base64,aGVsbG8gd29ybGQh"`);
    }
  });

  test('SVG and preserved images remain byte-faithful data URIs', () => {
    const images = [
      {
        extension: 'svg',
        mime: 'image/svg+xml',
        bytes: strToU8('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'),
      },
      {
        extension: 'emf',
        mime: 'image/x-emf',
        bytes: Uint8Array.from({ length: 44 }, (_, index) => (index === 0 ? 1 : 0)),
      },
    ] as const;
    for (const image of images) {
      const mediaName = `word/media/image1.${image.extension}`;
      const html = interopHtmlFromFragment(
        fragment({
          docRels: `<Relationship Id="rId7" Type="${R}/image" Target="media/image1.${image.extension}"/>`,
          media: { [mediaName]: image.bytes },
          body:
            '<w:p><w:r><w:drawing><wp:inline>' +
            '<wp:extent cx="952500" cy="476250"/>' +
            `<a:graphic><a:graphicData uri="${PIC}">` +
            '<pic:pic><pic:blipFill><a:blip r:embed="rId7"/></pic:blipFill></pic:pic>' +
            '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>',
        })
      );
      expect(html).toContain(`<img src="data:${image.mime};base64,`);
    }
  });

  test('an image over either budget is omitted', () => {
    const bytes = strToU8('hello world!');
    const input = fragment({
      docRels: `<Relationship Id="rId7" Type="${R}/image" Target="media/image1.png"/>`,
      media: { 'word/media/image1.png': bytes },
      body:
        '<w:p><w:r><w:drawing><wp:inline>' +
        '<wp:extent cx="952500" cy="476250"/>' +
        `<a:graphic><a:graphicData uri="${PIC}">` +
        '<pic:pic><pic:blipFill><a:blip r:embed="rId7"/></pic:blipFill></pic:pic>' +
        '</a:graphicData></a:graphic>' +
        '</wp:inline></w:drawing></w:r></w:p>',
    });
    expect(interopHtmlFromFragment(input, { maxImageBytes: 4 })).not.toContain('<img');
    expect(interopHtmlFromFragment(input, { maxTotalImageBytes: 4 })).not.toContain('<img');
    expect(interopHtmlFromFragment(input)).toContain('<img');
  });

  test('nested simple fields retain their cached results and formatting', () => {
    const html = interopHtmlFromFragment(
      fragment({
        body:
          '<w:p><w:r><w:t xml:space="preserve">before </w:t></w:r>' +
          '<w:fldSimple w:instr=" IF 1 = 1 &quot;yes&quot; &quot;no&quot; ">' +
          '<w:fldSimple w:instr=" REF bookmark ">' +
          '<w:r><w:rPr><w:b/></w:rPr><w:t>yes</w:t></w:r>' +
          '</w:fldSimple></w:fldSimple>' +
          '<w:r><w:t xml:space="preserve"> after</w:t></w:r></w:p>',
      })
    );

    expect(html).toContain('before ');
    expect(html).toContain('font-weight:bold');
    expect(html).toContain('>yes</span>');
    expect(html).toContain(' after');
    expect(html).not.toContain('REF bookmark');
    expect(html).not.toContain('IF 1');
  });

  test('nested simple fields still omit hidden, deleted, and unsupported content', () => {
    const html = interopHtmlFromFragment(
      fragment({
        body:
          '<w:p><w:fldSimple w:instr=" REF outer ">' +
          '<w:fldSimple w:instr=" REF inner ">' +
          '<w:r><w:t>visible</w:t></w:r>' +
          '<w:r><w:rPr><w:vanish/></w:rPr><w:t>hidden</w:t></w:r>' +
          '<w:del w:id="1" w:author="a"><w:r><w:delText>deleted</w:delText></w:r></w:del>' +
          '<w:moveFrom w:id="2" w:author="a"><w:r><w:t>moved</w:t></w:r></w:moveFrom>' +
          '<w:unknown><w:r><w:t>unsupported</w:t></w:r></w:unknown>' +
          '<x:fldSimple xmlns:x="urn:other"><w:r><w:t>foreign</w:t></w:r></x:fldSimple>' +
          '</w:fldSimple></w:fldSimple></w:p>',
      })
    );

    expect(html).toBe('<p>visible</p>');
  });

  test.each([MAX_INLINE_CONTAINER_DEPTH - 1, MAX_INLINE_CONTAINER_DEPTH])(
    'nested simple fields respect the inline depth limit at %i levels',
    (levels) => {
      let field = '<w:r><w:t>cached</w:t></w:r>';
      for (let depth = 0; depth < levels; depth += 1) {
        field = `<w:fldSimple w:instr=" REF bookmark ">${field}</w:fldSimple>`;
      }
      const html = interopHtmlFromFragment(
        fragment({ body: `<w:p>${field}<w:r><w:t>after</w:t></w:r></w:p>` })
      );

      expect(html).toBe(
        levels < MAX_INLINE_CONTAINER_DEPTH ? '<p>cachedafter</p>' : '<p>after</p>'
      );
    }
  );

  test('hidden runs, deletions, and field machinery never reach the HTML', () => {
    const html = interopHtmlFromFragment(
      fragment({
        body:
          '<w:p>' +
          '<w:r><w:rPr><w:vanish/></w:rPr><w:t>hidden</w:t></w:r>' +
          '<w:del w:id="1" w:author="a"><w:r><w:delText>gone</w:delText></w:r></w:del>' +
          '<w:ins w:id="2" w:author="a"><w:r><w:t>kept</w:t></w:r></w:ins>' +
          '<w:fldSimple w:instr=" PAGE "><w:r><w:t>7</w:t></w:r></w:fldSimple>' +
          '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
          '<w:r><w:instrText> DATE </w:instrText></w:r>' +
          '<w:r><w:fldChar w:fldCharType="separate"/><w:t>2026</w:t></w:r>' +
          '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
          '</w:p>',
      })
    );
    expect(html).not.toContain('hidden');
    expect(html).not.toContain('gone');
    expect(html).toContain('kept');
    expect(html).toContain('7');
    expect(html).toContain('2026');
    expect(html).not.toContain('DATE');
  });

  test.each(['sdt', 'fldSimple'])('the deleted-field probe charges nested %s depth', (wrapper) => {
    let deletedSeparate = '<w:r><w:fldChar w:fldCharType="separate"/></w:r>';
    for (let depth = 1; depth < MAX_INLINE_CONTAINER_DEPTH; depth += 1) {
      deletedSeparate =
        wrapper === 'sdt'
          ? `<w:sdt><w:sdtContent>${deletedSeparate}</w:sdtContent></w:sdt>`
          : `<w:fldSimple w:instr=" REF bookmark ">${deletedSeparate}</w:fldSimple>`;
    }
    const html = interopHtmlFromFragment(
      fragment({
        body:
          '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
          `<w:del w:id="1" w:author="a">${deletedSeparate}</w:del>` +
          '<w:r><w:t>INSTRUCTION</w:t></w:r>' +
          '<w:r><w:fldChar w:fldCharType="separate"/><w:t>RESULT</w:t></w:r>' +
          '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
      })
    );

    expect(html).not.toContain('INSTRUCTION');
    expect(html).toContain('RESULT');
  });

  test('paragraph flow controls, tabs, shading, and borders become Word-compatible CSS', () => {
    const html = interopHtmlFromFragment(
      fragment({
        body:
          '<w:p><w:pPr>' +
          '<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9026"/></w:tabs>' +
          '<w:pageBreakBefore/><w:keepNext/><w:keepLines/><w:widowControl/>' +
          '<w:spacing w:line="360" w:lineRule="exact"/>' +
          '<w:shd w:fill="DDEEFF"/>' +
          '<w:pBdr><w:bottom w:val="double" w:sz="12" w:color="112233"/></w:pBdr>' +
          '</w:pPr><w:r><w:t>flow</w:t></w:r></w:p>',
      })
    );
    expect(html).toContain('tab-stops:right dotted 451.3pt');
    expect(html).toContain('page-break-before:always');
    expect(html).toContain('page-break-after:avoid');
    expect(html).toContain('page-break-inside:avoid');
    expect(html).toContain('widows:2');
    expect(html).toContain('orphans:2');
    expect(html).toContain('line-height:18pt');
    expect(html).toContain('mso-line-height-rule:exactly');
    expect(html).toContain('background-color:#ddeeff');
    expect(html).toContain('border-bottom:1.5pt double #112233');
    expect(html).toContain('mso-border-bottom-alt:1.5pt double #112233');
  });

  test('tabs and typed page breaks map to Word-compatible HTML', () => {
    const html = interopHtmlFromFragment(
      fragment({
        footnotes:
          '<w:footnote w:id="3"><w:p><w:r><w:footnoteRef/><w:t>Foot body.</w:t></w:r>' +
          '<w:hyperlink r:id="rIdNote"><w:r><w:t>source</w:t></w:r></w:hyperlink>' +
          '</w:p></w:footnote>',
        footnotesRels:
          `<Relationship Id="rIdNote" Type="${R}/hyperlink" ` +
          'Target="https://notes.example/source" TargetMode="External"/>',
        endnotes:
          '<w:endnote w:id="2"><w:p><w:r><w:endnoteRef/>' +
          '<w:t>End body.</w:t></w:r></w:p></w:endnote>',
        body:
          '<w:p><w:r><w:t>a</w:t><w:tab/><w:t>b</w:t>' +
          '<w:ptab w:alignment="right" w:relativeTo="margin" w:leader="dot"/>' +
          '<w:ptab w:alignment="center" w:relativeTo="indent" w:leader="heavy"/>' +
          '<w:footnoteReference w:id="3"/><w:endnoteReference w:id="2"/>' +
          '<w:br w:type="page"/><w:t>c</w:t><w:br/><w:t>d</w:t></w:r></w:p>',
      })
    );
    expect(html).toContain('<span style="white-space:pre;mso-tab-count:1">\t</span>');
    expect(html).toContain('<w:PTab Alignment="RIGHT" RelativeTo="MARGIN" Leader="DOT"></w:PTab>');
    expect(html).toContain(
      '<w:PTab Alignment="CENTER" RelativeTo="INDENT" Leader="HEAVY"></w:PTab>'
    );
    expect(html).toContain('<br style="page-break-before:always">');
    expect(html).toContain('<br>');
    expect(html).toContain('<span class="MsoFootnoteReference">');
    expect(html).toContain('<span class="MsoEndnoteReference">');
    // The visible text shows the display ordinal, not the raw w:id; the id stays in
    // the machine-readable attributes.
    expect(html).toContain('mso-footnote-id:ftn3');
    expect(html).toContain('mso-endnote-id:edn2');
    expect(html).toContain('[1]');
    expect(html).not.toContain('[3]');
    expect(html).toContain('mso-element:footnote-list');
    expect(html).toContain('mso-element:endnote-list');
    expect(html).toContain('Foot body.');
    expect(html).toContain('End body.');
    expect(html).toContain('<a href="https://notes.example/source">source</a>');
  });

  test('hidden note citations in conditional table cells do not ship note bodies', () => {
    const html = interopHtmlFromFragment(
      fragment({
        styles:
          '<w:style w:type="table" w:styleId="HiddenFirst">' +
          '<w:tblStylePr w:type="firstRow"><w:rPr><w:vanish/></w:rPr></w:tblStylePr>' +
          '</w:style>',
        footnotes:
          '<w:footnote w:id="1"><w:p><w:r><w:footnoteRef/><w:t>Primary body.</w:t></w:r></w:p>' +
          '<w:tbl><w:tblPr><w:tblStyle w:val="HiddenFirst"/>' +
          '<w:tblLook w:firstRow="1"/></w:tblPr><w:tr><w:tc><w:p><w:r>' +
          '<w:footnoteReference w:id="2"/></w:r></w:p></w:tc></w:tr></w:tbl>' +
          '</w:footnote>' +
          '<w:footnote w:id="2"><w:p><w:r><w:footnoteRef/>' +
          '<w:t>Hidden target body.</w:t></w:r></w:p></w:footnote>',
        body: '<w:p><w:r><w:t>Body</w:t><w:footnoteReference w:id="1"/></w:r></w:p>',
      })
    );
    expect(html).toContain('Primary body.');
    expect(html).not.toContain('Hidden target body.');
    expect(html).not.toContain('mso-footnote-id:ftn2');
  });

  test('a table style fills its cells from its own tcPr, under the first row and the cell', () => {
    const cell = (text: string, shd = '') =>
      `<w:tc><w:tcPr>${shd}</w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
    const html = interopHtmlFromFragment(
      fragment({
        styles:
          '<w:style w:type="table" w:styleId="Shaded"><w:tcPr>' +
          '<w:shd w:val="clear" w:color="auto" w:fill="FFFF00"/></w:tcPr>' +
          '<w:tblStylePr w:type="firstRow"><w:tcPr>' +
          '<w:shd w:val="clear" w:color="auto" w:fill="0000FF"/></w:tcPr></w:tblStylePr>' +
          '</w:style>',
        body:
          '<w:tbl><w:tblPr><w:tblStyle w:val="Shaded"/><w:tblLook w:firstRow="1"/></w:tblPr>' +
          `<w:tr>${cell('head')}</w:tr><w:tr>${cell('body')}</w:tr>` +
          `<w:tr>${cell('cleared', '<w:shd w:val="clear" w:color="auto" w:fill="auto"/>')}</w:tr>` +
          '</w:tbl>',
      })
    );
    const cells = html.match(/<td[^>]*>/g) ?? [];
    expect(cells[0]).toContain('background-color:#0000ff');
    expect(cells[1]).toContain('background-color:#ffff00');
    // The cell's own auto fill paints no colour over the style's.
    expect(cells[2]).not.toContain('background-color');
  });

  test('copied table shading reads w:tblLook the way the page paints it', () => {
    // ECMA-376 Part 1 §17.4.55: no w:tblLook is 04A0 (header row, first column, row bands); a column band
    // paints over a row band.
    const cell = (text: string) => `<w:tc><w:tcPr/><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
    const condition = (type: string, fill: string) =>
      `<w:tblStylePr w:type="${type}"><w:tcPr>` +
      `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/></w:tcPr></w:tblStylePr>`;
    const styles =
      '<w:style w:type="table" w:styleId="Banded">' +
      condition('firstRow', '0000FF') +
      condition('band1Horz', '00FF00') +
      condition('band1Vert', 'FF0000') +
      '</w:style>';
    const row = `<w:tr>${cell('a')}${cell('b')}</w:tr>`;
    const cellsOf = (look: string) =>
      interopHtmlFromFragment(
        fragment({
          styles,
          body: `<w:tbl><w:tblPr><w:tblStyle w:val="Banded"/>${look}</w:tblPr>${row}${row}</w:tbl>`,
        })
      ).match(/<td[^>]*>/g) ?? [];
    const absent = cellsOf('');
    expect(absent[0]).toContain('background-color:#0000ff');
    expect(absent[2]).toContain('background-color:#00ff00');
    const bothBands = cellsOf(
      '<w:tblLook w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" ' +
        'w:noHBand="0" w:noVBand="0"/>'
    );
    expect(bothBands[2]).toContain('background-color:#ff0000');
  });

  test('a condition with an auto fill clears the style fill, and wholeTable paints none', () => {
    const cell = (text: string) => `<w:tc><w:tcPr/><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
    const html = interopHtmlFromFragment(
      fragment({
        styles:
          '<w:style w:type="table" w:styleId="Shaded"><w:tcPr>' +
          '<w:shd w:val="clear" w:color="auto" w:fill="FF0000"/></w:tcPr>' +
          '<w:tblStylePr w:type="wholeTable"><w:tcPr>' +
          '<w:shd w:val="clear" w:color="auto" w:fill="FFFF00"/></w:tcPr></w:tblStylePr>' +
          '<w:tblStylePr w:type="firstRow"><w:tcPr>' +
          '<w:shd w:val="clear" w:color="auto" w:fill="auto"/></w:tcPr></w:tblStylePr>' +
          '</w:style>',
        body:
          '<w:tbl><w:tblPr><w:tblStyle w:val="Shaded"/><w:tblLook w:firstRow="1"/></w:tblPr>' +
          `<w:tr>${cell('head')}</w:tr><w:tr>${cell('body')}</w:tr></w:tbl>`,
      })
    );
    const cells = html.match(/<td[^>]*>/g) ?? [];
    expect(cells[0]).not.toContain('background-color');
    expect(cells[1]).toContain('background-color:#ff0000');
  });

  test('pattern shading copies as the colour layout paints', () => {
    const html = interopHtmlFromFragment(
      fragment({
        body:
          '<w:p><w:pPr><w:shd w:val="pct50" w:color="FF0000" w:fill="FFFFFF"/></w:pPr>' +
          '<w:r><w:rPr><w:shd w:val="pct25" w:color="0000FF" w:fill="FFFFFF"/></w:rPr>' +
          '<w:t>x</w:t></w:r></w:p>' +
          '<w:tbl><w:tr><w:tc><w:tcPr><w:shd w:val="solid" w:color="auto" w:fill="FFFF00"/>' +
          '</w:tcPr><w:p><w:r><w:t>c</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
      })
    );
    expect(html).toMatch(/<p[^>]*background-color:#ff7f7f/);
    expect(html).toMatch(/<span[^>]*background-color:#bfbfff/);
    expect(html).toMatch(/<td[^>]*background-color:#000000/);
  });

  test('every text value is escaped, never markup', () => {
    const html = interopHtmlFromFragment(
      fragment({
        body: '<w:p><w:r><w:t>&lt;script&gt;alert("x")&lt;/script&gt;</w:t></w:r></w:p>',
      })
    );
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).not.toContain('<script');
  });

  test('docDefaults and the default paragraph style cascade under direct formatting', () => {
    const html = interopHtmlFromFragment(
      fragment({
        styles:
          '<w:docDefaults><w:rPrDefault><w:rPr>' +
          '<w:rFonts w:ascii="Arial"/><w:sz w:val="22"/>' +
          '</w:rPr></w:rPrDefault></w:docDefaults>' +
          '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">' +
          '<w:name w:val="Normal"/><w:rPr><w:color w:val="222222"/></w:rPr>' +
          '</w:style>',
        body:
          '<w:p><w:r><w:t>plain</w:t></w:r></w:p>' +
          '<w:p><w:r><w:rPr><w:sz w:val="40"/></w:rPr><w:t>big</w:t></w:r></w:p>',
      })
    );
    // The unstyled run resolves through docDefaults and the default style.
    expect(html).toContain('font-family:&quot;Arial&quot;');
    expect(html).toContain('font-size:11pt');
    expect(html).toContain('color:#222222');
    // Direct formatting wins over both.
    expect(html).toContain('font-size:20pt');
  });

  test('highlight wins over shading and toggles honour explicit off values', () => {
    const html = interopHtmlFromFragment(
      fragment({
        styles: '<w:style w:type="character" w:styleId="Loud"><w:rPr><w:b/></w:rPr></w:style>',
        body:
          '<w:p><w:r><w:rPr>' +
          '<w:rStyle w:val="Loud"/><w:b w:val="0"/>' +
          '<w:highlight w:val="yellow"/><w:shd w:val="clear" w:fill="00FF00"/>' +
          '<w:vertAlign w:val="superscript"/>' +
          '</w:rPr><w:t>note</w:t></w:r></w:p>',
      })
    );
    // The painter's own hex for the yellow highlighter, plus the machine-readable
    // mso-highlight name the read lane reconstructs w:highlight from.
    expect(html).toContain('background-color:#ffff00');
    expect(html).toContain('mso-highlight:yellow');
    expect(html).not.toContain('background-color:#00ff00');
    expect(html).not.toContain('font-weight:bold');
    expect(html).toContain('<sup>note</sup>');
  });
});
