// How Word's clipboard states list geometry and format, beyond the marker glyph:
// - a right-aligned number's `text-indent` is `-margin-left` for browsers, padded with nbsp,
//   while `mso-text-indent-alt` keeps the hang Word authored;
// - `@list` rules state each level's number position;
// - an all-default level gets no `@list` rule, and a `<li>` item may have no marker span.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { projectExternalHtml } from '../clipboard-html-read.ts';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { strFromU8 } from '../../store/package/zip.ts';

function project(html: string): { docXml: string; numberingXml: string } {
  const projected = projectExternalHtml(html);
  if (!projected.ok) throw new Error(`projection refused: ${projected.reason}`);
  const read = readOoxmlPackage(projected.fragmentBytes);
  if (!read.ok) throw new Error(`read-back refused: ${read.reason}`);
  const numbering = read.package.partBytes.get('/word/numbering.xml');
  return {
    docXml: serializeOoxmlPart(read.package.parts.get(read.package.mainDocumentPart)!),
    numberingXml: numbering ? strFromU8(numbering) : '',
  };
}

/** The `w:lvl` the paragraph holding `text` is numbered by. */
function levelOf({ docXml, numberingXml }: ReturnType<typeof project>, text: string): string {
  const paragraph = docXml.split('</w:p>').find((part) => part.includes(text)) ?? '';
  const ilvl = /<w:ilvl w:val="(\d)"\/>/.exec(paragraph)?.[1];
  const numId = /<w:numId w:val="(\d+)"\/>/.exec(paragraph)?.[1];
  const abstractId = new RegExp(
    `<w:num w:numId="${numId}"><w:abstractNumId w:val="(\\d+)"\\/>`
  ).exec(numberingXml)?.[1];
  const abstract = new RegExp(
    `<w:abstractNum w:abstractNumId="${abstractId}">.*?</w:abstractNum>`
  ).exec(numberingXml)?.[0];
  return new RegExp(`<w:lvl w:ilvl="${ilvl}">.*?</w:lvl>`).exec(abstract ?? '')?.[0] ?? '';
}

const wordHtml = (style: string, body: string): string =>
  `<html><head><style>${style}</style></head><body>${body}</body></html>`;

test('a right-aligned Word list number keeps the hanging from mso-text-indent-alt', () => {
  const { docXml } = project(
    '<p style="margin-left:72.0pt;text-indent:-18.0pt;mso-list:l0 level2 lfo2">' +
      '<span style="mso-list:Ignore">a.<span>&nbsp;&nbsp;</span></span>Nested</p>' +
      '<p style="margin-left:108.0pt;text-indent:-108.0pt;mso-text-indent-alt:-18.0pt;' +
      'mso-list:l0 level3 lfo3"><span style="mso-list:Ignore">' +
      '<span>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>i.' +
      '<span>&nbsp;&nbsp;</span></span>Indented</p>'
  );
  const roman = docXml.split('</w:p>').find((paragraph) => paragraph.includes('Indented'));
  expect(roman).toContain('w:left="2160"');
  expect(roman).toContain('w:hanging="360"');
  expect(roman).not.toContain('w:hanging="2160"');
  expect(docXml).not.toContain('>i.<');
  expect(docXml).not.toContain(' ');
});

test('a zero mso-text-indent-alt on a list item writes a zero first-line indent', () => {
  const { docXml } = project(
    '<p style="margin-left:36.0pt;text-indent:-36.0pt;mso-text-indent-alt:0cm;' +
      'mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">' +
      '<span>&nbsp;&nbsp;&nbsp;&nbsp;</span>1.' +
      '<span>&nbsp;</span></span>Flush</p>'
  );
  const item = docXml.split('</w:p>').find((paragraph) => paragraph.includes('Flush'));
  expect(item).toContain('w:left="720"');
  expect(item).toContain('w:firstLine="0"');
  expect(item).not.toContain('w:hanging=');
});

test('an unparseable mso-text-indent-alt falls back to text-indent', () => {
  const { docXml } = project(
    '<p style="margin-left:36.0pt;text-indent:-18.0pt;mso-text-indent-alt:auto">hang</p>'
  );
  expect(docXml).toContain('w:hanging="360"');
});

test("Word's mso-level-number-position sets each level's alignment", () => {
  const item = (ilvl: number, marker: string): string =>
    `<p style="mso-list:l0 level${ilvl} lfo1"><span style="mso-list:Ignore">${marker}</span>` +
    `item ${ilvl}</p>`;
  const projected = project(
    wordHtml(
      '@list l0:level1 {mso-level-number-position:right;}\n' +
        '@list l0:level2 {mso-level-number-format:roman-lower;mso-level-number-position:left;}\n' +
        '@list l0:level3 {mso-level-number-format:alpha-lower;mso-level-number-position:center;}',
      item(1, '10.') + item(2, 'i.') + item(3, 'a.')
    )
  );
  expect(levelOf(projected, 'item 1')).toContain('<w:numFmt w:val="decimal"/>');
  expect(levelOf(projected, 'item 1')).toContain('<w:lvlJc w:val="right"/>');
  expect(levelOf(projected, 'item 2')).toContain('<w:numFmt w:val="lowerRoman"/>');
  expect(levelOf(projected, 'item 2')).toContain('<w:lvlJc w:val="left"/>');
  expect(levelOf(projected, 'item 3')).toContain('<w:lvlJc w:val="center"/>');
});

test('a Word <li> with no level rule and no marker takes its list element format', () => {
  const li = (ilvl: number, text: string, nested = ''): string =>
    `<li style="mso-list:l1 level${ilvl} lfo13">${text}${nested}</li>`;
  const projected = project(
    wordHtml(
      '@list l1 {mso-list-id:1846162424;}\n@list l1:level2 {mso-level-number-format:alpha-lower;}',
      '<ol start=1 type=1>' +
        li(1, 'one', `<ol start=1 type=a>${li(2, 'nested')}</ol>`) +
        '</ol><ul>' +
        '<li style="mso-list:l2 level1 lfo14">bullet</li></ul>'
    )
  );
  expect(levelOf(projected, 'one')).toContain('<w:numFmt w:val="decimal"/>');
  expect(levelOf(projected, 'nested')).toContain('<w:numFmt w:val="lowerLetter"/>');
  expect(levelOf(projected, 'bullet')).toContain('<w:numFmt w:val="bullet"/>');
});

// Clipboard HTML states each level's text, marker format, and geometry in its `@list` rule. The marker
// span only shows the result, so the level comes from the rule.
const wordItem = (list: string, ilvl: number, marker: string, text: string): string =>
  `<p class=MsoNormal style="mso-list:${list} level${ilvl} lfo1">` +
  `<span style="mso-list:Ignore">${marker}<span>&nbsp;</span></span>${text}</p>`;

test("a level rule's mso-level-text becomes the level text", () => {
  const projected = project(
    wordHtml(
      '@list l0:level1 {mso-level-text:"%1\\)";}\n' +
        '@list l0:level2 {mso-level-number-format:alpha-lower;mso-level-text:"\\(%2\\)";}\n' +
        '@list l0:level3 {mso-level-text:"Art\\. %3\;\\\\";}',
      wordItem('l0', 1, '1)', 'one') +
        wordItem('l0', 2, '(a)', 'two') +
        wordItem('l0', 3, 'x', 'three')
    )
  );
  expect(levelOf(projected, 'one')).toContain('<w:lvlText w:val="%1)"/>');
  expect(levelOf(projected, 'two')).toContain('<w:lvlText w:val="(%2)"/>');
  // A quoted `;` does not end the declaration, and `\\` is one backslash.
  expect(levelOf(projected, 'three')).toContain('<w:lvlText w:val="Art. %3;\\"/>');
});

test('a level rule keeps the marker run format', () => {
  const projected = project(
    wordHtml(
      '@list l0:level1 {mso-level-text:"%1\\)";color:red;mso-ansi-font-weight:bold;}\n' +
        '@list l0:level2 {mso-level-number-format:roman-upper;mso-ansi-font-weight:normal;' +
        'mso-ansi-font-style:italic;mso-ansi-font-size:14.0pt;font-family:"Arial",sans-serif;' +
        'color:#0070C0;text-decoration:underline;text-underline:single;}',
      wordItem('l0', 1, '1)', 'red') + wordItem('l0', 2, 'I.', 'blue')
    )
  );
  expect(levelOf(projected, 'red')).toContain('<w:rPr><w:b/><w:color w:val="FF0000"/></w:rPr>');
  expect(levelOf(projected, 'blue')).toContain(
    '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b w:val="0"/><w:i/>' +
      '<w:color w:val="0070C0"/><w:sz w:val="28"/><w:u w:val="single"/></w:rPr>'
  );
});

test('a symbol-font bullet keeps its glyph and font', () => {
  const projected = project(
    wordHtml(
      '@list l0:level1 {mso-level-number-format:bullet;mso-level-text:;font-family:Wingdings;}\n' +
        '@list l0:level2 {mso-level-number-format:bullet;mso-level-text:●;' +
        'font-family:"Segoe UI Symbol",sans-serif;}',
      wordItem('l0', 1, 'Ø', 'arrow') + wordItem('l0', 2, '●', 'dot')
    )
  );
  const arrow = levelOf(projected, 'arrow');
  expect(arrow).toContain('<w:lvlText w:val=""/>');
  expect(arrow).toContain('<w:rFonts w:ascii="Wingdings" w:hAnsi="Wingdings"/>');
  const dot = levelOf(projected, 'dot');
  expect(dot).toContain('<w:lvlText w:val="●"/>');
  expect(dot).toContain('<w:rFonts w:ascii="Segoe UI Symbol" w:hAnsi="Segoe UI Symbol"/>');
});

test('a level rule sets the level indents and number tab stop', () => {
  const projected = project(
    wordHtml(
      '@list l0:level1 {margin-left:54.0pt;text-indent:-27.0pt;}\n' +
        '@list l0:level2 {mso-level-tab-stop:72.0pt;margin-left:90.0pt;text-indent:-36.0pt;}\n' +
        // The clipboard leaves out a margin-left of 36pt per level.
        '@list l0:level3 {mso-level-tab-stop:none;text-indent:0cm;}',
      '<ol><li style="mso-list:l0 level1 lfo1">first</li></ol>' +
        '<ol><li style="mso-list:l0 level2 lfo1">second</li></ol>' +
        '<ol><li style="mso-list:l0 level3 lfo1">third</li></ol>'
    )
  );
  expect(levelOf(projected, 'first')).toContain('<w:pPr><w:ind w:left="1080" w:hanging="540"/>');
  expect(levelOf(projected, 'second')).toContain(
    '<w:pPr><w:tabs><w:tab w:val="num" w:pos="1440"/></w:tabs><w:ind w:left="1800" w:hanging="720"/>'
  );
  expect(levelOf(projected, 'third')).toContain('<w:pPr><w:ind w:left="2160" w:firstLine="0"/>');
});

test('a level rule keeps a negative left indent', () => {
  const projected = project(
    wordHtml(
      '@list l0:level1 {margin-left:-18.0pt;text-indent:-18.0pt;}',
      '<ol><li style="mso-list:l0 level1 lfo1">outdented</li></ol>'
    )
  );
  expect(levelOf(projected, 'outdented')).toContain('<w:ind w:left="-360" w:hanging="360"/>');
});

test('a bullet glyph with no stated font gets no font of its own', () => {
  // The glyph then draws in the paragraph font, as the rule states nothing else.
  const projected = project(
    wordHtml(
      '@list l0:level1 {mso-level-number-format:bullet;mso-level-text:;text-indent:-18.0pt;}',
      '<ul><li style="mso-list:l0 level1 lfo1">plain</li></ul>'
    )
  );
  const level = levelOf(projected, 'plain');
  expect(level).toContain('<w:lvlText w:val=""/>');
  expect(level).not.toContain('<w:rPr>');
});

test('hostile level rules stay bounded and escaped', () => {
  const projected = project(
    wordHtml(
      `@list l0:level1 {mso-level-text:"${'%1'.repeat(40)}";margin-left:99999pt;}\n` +
        '@list l0:level2 {mso-level-text:"<b>&\\"%2\\0 \\1 ";text-indent:-99999pt;}',
      wordItem('l0', 1, '1.', 'long') + wordItem('l0', 2, '1.', 'markup')
    )
  );
  const long = levelOf(projected, 'long');
  // An over-long level text is not a marker; the level keeps the default.
  expect(long).toContain('<w:lvlText w:val="%1."/>');
  expect(long).toContain('w:left="31680"');
  const markup = levelOf(projected, 'markup');
  expect(markup).toContain('<w:lvlText w:val="&lt;b&gt;&amp;&quot;%2"/>');
  expect(markup).toContain('w:hanging="31680"');
});

test('a marker-free item with a level rule starts from the rule, not from its list element', () => {
  // Clipboard HTML that states a level rule numbers from `mso-level-start-at`, or from 1, and the
  // `<ol start>` around the item does not move it. The clipboard writes both from one level, so
  // they disagree only in HTML from elsewhere, and the rule is the level definition.
  const projected = project(
    wordHtml(
      '@list l0:level1 {mso-level-tab-stop:none;text-indent:-18.0pt;}\n' +
        '@list l1:level1 {mso-level-start-at:4;text-indent:-18.0pt;}',
      '<ol start=3 type=1><li style="mso-list:l0 level1 lfo1">plain</li></ol>' +
        '<ol start=2 type=1><li style="mso-list:l1 level1 lfo2">stated</li></ol>'
    )
  );
  expect(levelOf(projected, 'plain')).toContain('<w:start w:val="1"/>');
  expect(levelOf(projected, 'stated')).toContain('<w:start w:val="4"/>');
});
