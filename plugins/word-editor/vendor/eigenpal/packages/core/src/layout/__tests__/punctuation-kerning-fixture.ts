import { readFileSync } from 'node:fs';
import { strToU8, strFromU8, unzipSync, zipSync } from 'fflate';
import { openHeadlessDocument } from '../../store/headless-document-view.ts';
import { createDocumentStyleDependencies } from '../document-style-deps.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf, type TextMeasurer } from '../semantic-records.ts';

export const sample = '「あ」「い」、。（テ）」「、「';
export interface FixtureOptions {
  text?: string;
  available?: number;
  kern?: number;
  secondKern?: number;
  noPunctuation?: boolean | string;
  compression?: string;
  /** Writes `w:balanceSingleByteDoubleByteWidth` in `w:compat`. */
  balanceWidths?: boolean;
  /** Writes `w:useWord97LineBreakRules` in `w:compat`. */
  word97LineBreaks?: boolean;
  compatibility?: 14 | 15;
  defaultFace?: string | null;
  face?: string;
  secondFace?: string;
  split?: number;
  tracking?: number;
  bold?: boolean;
  italic?: boolean;
  underlineElsewhere?: boolean;
  language?: string;
  secondLanguage?: string;
  defaultLanguage?: string;
  lineStartRule?: { language: string; characters: string };
  /** Paragraph properties; the default is left aligned without hanging punctuation. */
  paragraphProperties?: string;
  /** The layout measurer; the default gives every character its font size. */
  measurer?: TextMeasurer;
  /** One `word/fontTable.xml` entry: the face and its `w:charset` value. */
  fontTableEntry?: { name: string; charset: string };
}
const fixturePath = new URL('./fixtures/yu-mincho-punctuation.docx', import.meta.url);
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const escape = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');

// Fixed advances isolate the layout policy. This does not assert installed font identity.
export const measurer: TextMeasurer = {
  measure: (text, style) => [...text].length * (style.fontSizePt + style.characterSpacingPt),
  lineMetrics: (style) => ({ height: style.fontSizePt * 1.2, baseline: style.fontSizePt }),
};

export function loadFixture(options: FixtureOptions = {}) {
  const entries = unzipSync(new Uint8Array(readFileSync(fixturePath)));
  const text = options.text ?? sample;
  const run = (content: string, second = false) => {
    const kern = second ? (options.secondKern ?? options.kern) : options.kern;
    const face = second
      ? (options.secondFace ?? options.face ?? 'Yu Mincho')
      : (options.face ?? 'Yu Mincho');
    const language = second ? (options.secondLanguage ?? options.language) : options.language;
    return (
      '<w:r><w:rPr>' +
      `<w:rFonts w:ascii="${escape(face)}" w:eastAsia="${escape(face)}"/><w:sz w:val="48"/>` +
      (kern === undefined ? '' : `<w:kern w:val="${kern}"/>`) +
      (options.tracking === undefined ? '' : `<w:spacing w:val="${options.tracking}"/>`) +
      (options.bold ? '<w:b/>' : '') +
      (options.italic ? '<w:i/>' : '') +
      (language ? `<w:lang w:eastAsia="${escape(language)}"/>` : '') +
      `</w:rPr><w:t xml:space="preserve">${escape(content)}</w:t></w:r>`
    );
  };
  const runs =
    options.split === undefined
      ? run(text)
      : run(text.slice(0, options.split)) + run(text.slice(options.split), true);
  entries['word/document.xml'] = strToU8(
    `<w:document xmlns:w="${W}"><w:body><w:p>` +
      `<w:pPr>${options.paragraphProperties ?? '<w:jc w:val="left"/><w:overflowPunct w:val="0"/>'}</w:pPr>` +
      runs +
      (options.underlineElsewhere
        ? '<w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>字</w:t></w:r>'
        : '') +
      '</w:p></w:body></w:document>'
  );
  const face = options.defaultFace === undefined ? 'Yu Mincho' : options.defaultFace;
  entries['word/styles.xml'] = strToU8(
    `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr>` +
      (face ? `<w:rFonts w:eastAsia="${escape(face)}"/>` : '') +
      (options.defaultLanguage ? `<w:lang w:eastAsia="${escape(options.defaultLanguage)}"/>` : '') +
      '</w:rPr></w:rPrDefault></w:docDefaults></w:styles>'
  );
  entries['word/settings.xml'] = strToU8(
    `<w:settings xmlns:w="${W}">` +
      (options.noPunctuation === undefined || options.noPunctuation === false
        ? ''
        : options.noPunctuation === true
          ? '<w:noPunctuationKerning/>'
          : `<w:noPunctuationKerning w:val="${options.noPunctuation}"/>`) +
      (options.compression ? `<w:characterSpacingControl w:val="${options.compression}"/>` : '') +
      (options.lineStartRule
        ? `<w:noLineBreaksBefore w:lang="${escape(options.lineStartRule.language)}" w:val="${escape(options.lineStartRule.characters)}"/>`
        : '') +
      `<w:compat>${options.balanceWidths ? '<w:balanceSingleByteDoubleByteWidth/>' : ''}${options.word97LineBreaks ? '<w:useWord97LineBreakRules/>' : ''}<w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="${options.compatibility ?? 15}"/></w:compat>` +
      '</w:settings>'
  );
  if (options.fontTableEntry) {
    const { name, charset } = options.fontTableEntry;
    entries['word/fontTable.xml'] = strToU8(
      `<w:fonts xmlns:w="${W}"><w:font w:name="${escape(name)}">` +
        `<w:charset w:val="${escape(charset)}"/></w:font></w:fonts>`
    );
    const add = (part: string, marker: string, xml: string) =>
      (entries[part] = strToU8(strFromU8(entries[part]!).replace(marker, xml + marker)));
    add(
      '[Content_Types].xml',
      '</Types>',
      '<Override PartName="/word/fontTable.xml" ContentType="application/' +
        'vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/>'
    );
    add(
      'word/_rels/document.xml.rels',
      '</Relationships>',
      '<Relationship Id="fonts" Type="http://schemas.openxmlformats.org/officeDocument/2006/' +
        'relationships/fontTable" Target="fontTable.xml"/>'
    );
  }
  const bytes = zipSync(entries);
  const opened = openHeadlessDocument(bytes);
  if (!opened.ok) throw new Error(opened.reason);
  const view = opened.view;
  const dependencies = createDocumentStyleDependencies(view);
  const pkg = view.currentPackage();
  const before = [...pkg.parts].map(([name, part]) => [name, JSON.stringify(part.root)]);
  const layout = layoutSemanticDocument(pkg.parts.get(pkg.mainDocumentPart)!, 0, {
    measurer: options.measurer ?? measurer,
    styleCascade: dependencies.styleCascade(),
    ...(options.compatibility === undefined ? {} : { compatibilityMode: options.compatibility }),
    geometry: {
      width: (options.available ?? 680) + 20,
      height: 500,
      margin: { top: 10, bottom: 10, left: 10, right: 10 },
    },
  });
  const lines = linesOf(layout);
  return {
    bytes,
    view,
    lines,
    layout,
    before,
    entries: Object.fromEntries(
      Object.entries(entries).map(([name, data]) => [name, strFromU8(data)])
    ),
    width: lines[0]!.spans.reduce((sum, span) => sum + span.box.width, 0),
  };
}
