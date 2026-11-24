// The bytes a "New document" gesture loads — Word's own blank template, not a bare shell.
//
// A minimal document.xml with no styles part falls to the FORMAT's defaults (10pt, no
// font authored anywhere), which is not what a user who pressed New expects: Word's
// blank template authors its defaults explicitly — Calibri at 11pt with the Normal
// style's paragraph spacing — in `w:docDefaults`. This template does the same, so the
// engine measures, paints and reports exactly what the toolbar shows, and the saved
// file opens in Word looking identical.
//
// The font family is authored DIRECTLY (`w:ascii="Calibri"`), not as a theme reference:
// no theme part ships here, and layout's theme-font resolution is a separate lane. The
// name is the Word name; rendering resolves through the host's font configuration
// (metric substitutes or real bytes) like any other document.
//
// The BUILT-IN STYLE GALLERY ships with the template for the same reason the defaults do.
// Word keeps Heading 1-9, Title, Subtitle, Quote, No Spacing and List Paragraph LATENT in
// a new document: `styles.xml` does not define them, and Word writes the definition the
// first time one is used. Nothing here can materialize a latent style, so a template that
// omits them gives a New document a style picker holding one entry, and no way to make a
// heading. Shipping the definitions is what fills the gallery.
//
// List Paragraph is the one with a visible second job: it carries `w:contextualSpacing`,
// which is what drops the 8pt gap BETWEEN consecutive list items while keeping it around
// the list. `toggleList` applies the style the way Word's list gesture does.

import { strToU8, zipSync } from 'fflate';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_DOCUMENT =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STYLES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

const CONTENT_TYPES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="${CT}">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
  `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
  `</Types>`;

const ROOT_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="${REL}">` +
  `<Relationship Id="rId1" Type="${OFFICE_DOCUMENT}" Target="word/document.xml"/>` +
  `</Relationships>`;

const DOCUMENT_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="${REL}">` +
  `<Relationship Id="rId1" Type="${STYLES_REL}" Target="styles.xml"/>` +
  `</Relationships>`;

// The headings state NO font, so they inherit Calibri from `w:docDefaults`.
//
// Word's own headings name the theme's MAJOR typeface, which the Office theme sets to
// Calibri Light, and a faithful template would say so. It does not, for a reason that is
// about this engine rather than about Word: no metric-compatible substitute for Calibri
// Light exists in `packages/fonts`, so a heading measures and paints in Calibri anyway,
// while the declared name lights the font-compatibility notice on a brand-new document —
// a fidelity warning about a face nothing on the page uses. A template that says Calibri
// says what it renders. Name Calibri Light here once the notice reports the families a
// document RENDERS rather than the families it declares.

/**
 * Heading 1-9 as Word's Office theme resolves them: the theme colors written out as the
 * hex Word paints (accent1 darker 25% and 50%, then near-black for the last pair), and
 * only Heading 1 opening with a full line of space above it.
 *
 * Literal hex, not `w:themeColor`, for the same reason the fonts are literal: no theme
 * part ships here, so a theme reference would resolve to nothing. The cost is that these
 * headings do not follow a theme the user picks after opening the file in Word. Write them
 * as theme references once this template carries a `theme1.xml`.
 *
 * Sizes are half-points, and a level with none inherits the 11pt run default — which is
 * what Word's Heading 4 to Heading 7 do.
 */
const HEADINGS = [
  { level: 1, before: 240, color: '2F5496', halfPoints: 32, italic: false },
  { level: 2, before: 40, color: '2F5496', halfPoints: 26, italic: false },
  { level: 3, before: 40, color: '1F3763', halfPoints: 24, italic: false },
  { level: 4, before: 40, color: '2F5496', halfPoints: null, italic: true },
  { level: 5, before: 40, color: '2F5496', halfPoints: null, italic: false },
  { level: 6, before: 40, color: '1F3763', halfPoints: null, italic: false },
  { level: 7, before: 40, color: '1F3763', halfPoints: null, italic: true },
  { level: 8, before: 40, color: '272727', halfPoints: 21, italic: false },
  { level: 9, before: 40, color: '272727', halfPoints: 21, italic: true },
] as const;

// `w:outlineLvl` is zero-based, so Heading 1 is level 0 — the value the navigation pane
// and a table of contents both read.
const headingStyle = (heading: (typeof HEADINGS)[number]): string =>
  `<w:style w:type="paragraph" w:styleId="Heading${heading.level}">` +
  `<w:name w:val="heading ${heading.level}"/>` +
  `<w:basedOn w:val="Normal"/><w:next w:val="Normal"/>` +
  `<w:uiPriority w:val="9"/><w:qFormat/>` +
  `<w:pPr><w:keepNext/><w:keepLines/>` +
  `<w:spacing w:before="${heading.before}" w:after="0"/>` +
  `<w:outlineLvl w:val="${heading.level - 1}"/></w:pPr>` +
  `<w:rPr>` +
  (heading.italic ? `<w:i/><w:iCs/>` : ``) +
  `<w:color w:val="${heading.color}"/>` +
  (heading.halfPoints === null
    ? ``
    : `<w:sz w:val="${heading.halfPoints}"/><w:szCs w:val="${heading.halfPoints}"/>`) +
  `</w:rPr></w:style>`;

// Word's blank-template defaults: Calibri 11pt run defaults, and the Normal paragraph
// rhythm (8pt space after, 1.08-line spacing) in the paragraph defaults — the values
// Word writes, so a save/reopen in Word shows the same text metrics. Then the built-in
// gallery, in Word's own order: Normal, the headings, the three defaults every part
// kind needs, and the styles the picker offers under them.
const STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:styles xmlns:w="${W}">` +
  `<w:docDefaults>` +
  `<w:rPrDefault><w:rPr>` +
  `<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/>` +
  `<w:sz w:val="22"/><w:szCs w:val="22"/>` +
  `</w:rPr></w:rPrDefault>` +
  `<w:pPrDefault><w:pPr>` +
  `<w:spacing w:after="160" w:line="259" w:lineRule="auto"/>` +
  `</w:pPr></w:pPrDefault>` +
  `</w:docDefaults>` +
  `<w:style w:type="paragraph" w:default="1" w:styleId="Normal">` +
  `<w:name w:val="Normal"/><w:qFormat/>` +
  `</w:style>` +
  HEADINGS.map(headingStyle).join('') +
  // The three default styles a Word part carries one of each: the character style every
  // run falls back to, the table style every table falls back to, and the numbering style
  // that means "no list". Word writes all three into every document it saves.
  `<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont">` +
  `<w:name w:val="Default Paragraph Font"/>` +
  `<w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/>` +
  `</w:style>` +
  `<w:style w:type="table" w:default="1" w:styleId="TableNormal">` +
  `<w:name w:val="Normal Table"/>` +
  `<w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/>` +
  `<w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar>` +
  `<w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/>` +
  `<w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/>` +
  `</w:tblCellMar></w:tblPr>` +
  `</w:style>` +
  `<w:style w:type="numbering" w:default="1" w:styleId="NoList">` +
  `<w:name w:val="No List"/>` +
  `<w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/>` +
  `</w:style>` +
  // Title sets its own line spacing rather than inheriting the 1.08 default, and states
  // the tight character spacing Word gives a 28pt title.
  `<w:style w:type="paragraph" w:styleId="Title">` +
  `<w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/>` +
  `<w:uiPriority w:val="10"/><w:qFormat/>` +
  `<w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/>` +
  `<w:contextualSpacing/></w:pPr>` +
  `<w:rPr><w:spacing w:val="-10"/><w:kern w:val="28"/>` +
  `<w:sz w:val="56"/><w:szCs w:val="56"/></w:rPr>` +
  `</w:style>` +
  // Subtitle states no spacing of its own: Word leaves it on the paragraph defaults, and
  // stating the same 8pt here would override a Normal the user later changes.
  `<w:style w:type="paragraph" w:styleId="Subtitle">` +
  `<w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/>` +
  `<w:uiPriority w:val="11"/><w:qFormat/>` +
  `<w:rPr><w:color w:val="5A5A5A"/><w:spacing w:val="15"/></w:rPr>` +
  `</w:style>` +
  // Quote is CENTRED and full width. The half-inch indent on both sides belongs to Intense
  // Quote, which also carries top and bottom borders and is not part of this gallery.
  `<w:style w:type="paragraph" w:styleId="Quote">` +
  `<w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/>` +
  `<w:uiPriority w:val="29"/><w:qFormat/>` +
  `<w:pPr><w:spacing w:before="160"/><w:jc w:val="center"/></w:pPr>` +
  `<w:rPr><w:i/><w:iCs/><w:color w:val="404040"/></w:rPr>` +
  `</w:style>` +
  // Caption gives pasted Word captions built-in 9pt italic metrics instead of Normal.
  `<w:style w:type="paragraph" w:styleId="Caption">` +
  `<w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/>` +
  `<w:uiPriority w:val="35"/><w:semiHidden/><w:unhideWhenUsed/>` +
  `<w:pPr><w:spacing w:after="0"/></w:pPr>` +
  `<w:rPr><w:i/><w:iCs/><w:color w:val="404040"/>` +
  `<w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>` +
  `</w:style>` +
  // No Spacing is the one style that does NOT build on Normal: its whole purpose is to
  // drop the defaults' space-after and 1.08 lines, which `w:basedOn` would reinstate.
  `<w:style w:type="paragraph" w:styleId="NoSpacing">` +
  `<w:name w:val="No Spacing"/><w:uiPriority w:val="1"/><w:qFormat/>` +
  `<w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>` +
  `</w:style>` +
  // `w:contextualSpacing` is the point of this one: it suppresses the 8pt before and
  // after BETWEEN neighbours of the same style, so a list closes up between its items and
  // still keeps its space against the paragraphs above and below it. The 0.5" indent is
  // the style's own; every list level states its own `w:ind`, which supersedes it.
  `<w:style w:type="paragraph" w:styleId="ListParagraph">` +
  `<w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/>` +
  `<w:uiPriority w:val="34"/><w:qFormat/>` +
  `<w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr>` +
  `</w:style>` +
  `</w:styles>`;

// US Letter with one-inch margins — the geometry Word's own blank template carries.
const DOCUMENT =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:document xmlns:w="${W}">` +
  `<w:body>` +
  `<w:p/>` +
  `<w:sectPr>` +
  `<w:pgSz w:w="12240" w:h="15840"/>` +
  `<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>` +
  `</w:sectPr>` +
  `</w:body>` +
  `</w:document>`;

/**
 * How a blank document starts.
 *
 * @public
 */
export interface BlankDocumentOptions {
  /**
   * `'rtl'` starts the document right to left: its paragraphs (`w:bidi` in the paragraph
   * defaults) and its section (`w:sectPr/w:bidi`) read right to left, as a new document does
   * when a right-to-left editing language is the default. `'ltr'` is the default.
   */
  readonly direction?: 'ltr' | 'rtl';
  /**
   * The language of right-to-left and complex-script text, as a BCP 47 tag such as `ar-SA`
   * or `he-IL`, written as the run defaults' `w:lang/@w:bidi`. Layout follows it: European
   * digits in an Arabic-script language draw in the Latin face. A value that is not a
   * language tag is ignored.
   */
  readonly bidiLanguage?: string;
}

const LANGUAGE_TAG = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,4}$/;

/**
 * A blank document, freshly zipped per call (the caller may hand the
 * bytes to a loader that takes ownership). Calibri 11pt and Word's Normal paragraph
 * spacing are authored in `w:docDefaults`, Word's built-in style gallery in `styles.xml`,
 * and US Letter geometry in the section. Word opens the saved file.
 *
 * A right-to-left interface usually wants `{ direction: 'rtl', bidiLanguage: 'ar-SA' }` (or
 * the reader's own language), so the first paragraph is ready for right-to-left typing.
 *
 * @public
 */
export function blankDocumentBytes(options: BlankDocumentOptions = {}): Uint8Array {
  const rtl = options.direction === 'rtl';
  const language =
    options.bidiLanguage !== undefined && LANGUAGE_TAG.test(options.bidiLanguage)
      ? options.bidiLanguage
      : null;
  const styles = STYLES.replace(
    '<w:sz w:val="22"/><w:szCs w:val="22"/>',
    `<w:sz w:val="22"/><w:szCs w:val="22"/>${language ? `<w:lang w:bidi="${language}"/>` : ''}`
  ).replace('<w:pPrDefault><w:pPr>', `<w:pPrDefault><w:pPr>${rtl ? '<w:bidi/>' : ''}`);
  const document = rtl ? DOCUMENT.replace('</w:sectPr>', '<w:bidi/></w:sectPr>') : DOCUMENT;
  return zipSync({
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(ROOT_RELS),
    'word/_rels/document.xml.rels': strToU8(DOCUMENT_RELS),
    'word/document.xml': strToU8(document),
    'word/styles.xml': strToU8(styles),
  });
}
