// One document carrying an IDENTICAL probe story in the body, a header, a footer, a footnote
// and an endnote.
//
// Identical is the whole point. The contract asks whether an operation behaves the same on the
// same paragraph, so any difference the fixture introduces is a difference the test would have
// to excuse. Every story gets the same content, in the same order, with the same direct
// formatting:
//
//   Alpha    centred, indented 720 twips, one bold run
//   Beta     no direct formatting
//   Gamma    a `w:numPr` list item on numId 1, decimal
//   Delta    a `w:numPr` list item on numId 2, bullet
//   Control  the one paragraph of a block content control
//
// Alpha exercises the cascade reads and Beta a plain baseline. Gamma and Delta are BOTH here
// because a single decimal item makes `list.bullet` pass vacuously: the button reads inactive
// in every story including the body, so a body-only marker read looks like agreement. Control
// is what the content-control resolution test hangs off, and what the sweep's `IN_CONTROL`
// probe puts the caret inside so the `contentControl.*` slots are compared LIVE rather than
// disabled in every story.

import { zipSync, strToU8 } from 'fflate';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

/** Relationship ids the fixture pins, so a test can name the story it wants to enter. */
export const HEADER_R_ID = 'rId10';
export const FOOTER_R_ID = 'rId11';
/** Scope ids for the one footnote and the one endnote. */
export const FOOTNOTE_SCOPE_ID = 'footnote:1';
export const ENDNOTE_SCOPE_ID = 'endnote:1';

/**
 * The probe paragraphs' text, in reading order.
 *
 * Tests locate probe paragraphs BY THIS TEXT rather than by index into the story's paragraph
 * list. Indexing broke the moment the fixture grew: a note part opens with two separator
 * paragraphs the body does not have, and the body ends with a note-reference paragraph the
 * others do not, so no single slice is right for all five stories.
 */
export const PROBE_TEXT = ['Alpha', 'Beta', 'Gamma', 'Delta'] as const;

/** The text inside the block content control every story carries. */
export const CONTROL_TEXT = 'Control';

/** Index into {@link PROBE_TEXT}, named so a test reads as its intent. */
export const PROBE = {
  /** Centred, indented, bold. The cascade reads. */
  formatted: 0,
  /** Plain. A baseline for writes that should not depend on formatting. */
  plain: 1,
  /** Decimal `w:numPr`. */
  numbered: 2,
  /** Bullet `w:numPr`. */
  bulleted: 3,
} as const;

const listItem = (text: string, numId: number) =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>` +
  `<w:r><w:t>${text}</w:t></w:r></w:p>`;

/** A block content control. `w:tag` names the story so a wrong-story resolve is legible. */
const contentControl = (tag: string) =>
  `<w:sdt><w:sdtPr><w:alias w:val="${tag}"/><w:tag w:val="${tag}"/>` +
  `<w:text/></w:sdtPr><w:sdtContent>` +
  `<w:p><w:r><w:t>${CONTROL_TEXT}</w:t></w:r></w:p>` +
  `</w:sdtContent></w:sdt>`;

/** The probe story. `tag` distinguishes only the content control, never the paragraphs. */
function probeStory(tag: string): string {
  return (
    `<w:p><w:pPr><w:jc w:val="center"/><w:ind w:left="720"/></w:pPr>` +
    `<w:r><w:rPr><w:b/></w:rPr><w:t>${PROBE_TEXT[0]}</w:t></w:r></w:p>` +
    `<w:p><w:r><w:t>${PROBE_TEXT[1]}</w:t></w:r></w:p>` +
    listItem(PROBE_TEXT[2], 1) +
    listItem(PROBE_TEXT[3], 2) +
    contentControl(tag)
  );
}

/** Every story carries a content control, so every one can be asked the same question. */
export const STORIES_WITH_CONTROL = ['body', 'header', 'footer', 'footnote', 'endnote'] as const;

/** `w:tag` of the content control in each story, so a resolve can be named in a failure. */
export const CONTROL_TAG = {
  body: 'BodyPick',
  header: 'HdrPick',
  footer: 'FtrPick',
  footnote: 'FnPick',
  endnote: 'EnPick',
} as const;

const NUMBERING =
  `<w:numbering xmlns:w="${W}">` +
  `<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0">` +
  `<w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>` +
  `<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>` +
  `<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0">` +
  `<w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="&#8226;"/>` +
  `<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>` +
  `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>` +
  `<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;

const STYLES =
  `<w:styles xmlns:w="${W}">` +
  `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>` +
  `<w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
  `</w:styles>`;

/**
 * The body carries the probe story plus the two note references that make the note stories
 * reachable. The references sit in their own trailing paragraph so they cannot perturb the
 * probe paragraphs the contract measures.
 */
const BODY =
  probeStory(CONTROL_TAG.body) +
  `<w:p><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr>` +
  `<w:footnoteReference w:id="1"/></w:r>` +
  `<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr>` +
  `<w:endnoteReference w:id="1"/></w:r></w:p>`;

const noteSeparators = (kind: 'footnote' | 'endnote') =>
  `<w:${kind} w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:${kind}>` +
  `<w:${kind} w:type="continuationSeparator" w:id="0">` +
  `<w:p><w:r><w:continuationSeparator/></w:r></w:p></w:${kind}>`;

function override(partName: string, kind: string): string {
  return (
    `<Override PartName="/word/${partName}" ContentType="application/vnd.openxmlformats-` +
    `officedocument.wordprocessingml.${kind}+xml"/>`
  );
}

/** The fixture bytes. Rebuilt per call so a test that edits one cannot leak into the next. */
export function storyParityDocx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-' +
        'officedocument.wordprocessingml.document.main+xml"/>' +
        override('header1.xml', 'header') +
        override('footer1.xml', 'footer') +
        override('footnotes.xml', 'footnotes') +
        override('endnotes.xml', 'endnotes') +
        override('numbering.xml', 'numbering') +
        override('styles.xml', 'styles') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/>` +
        `</Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="${HEADER_R_ID}" Type="${R}/header" Target="header1.xml"/>` +
        `<Relationship Id="${FOOTER_R_ID}" Type="${R}/footer" Target="footer1.xml"/>` +
        `<Relationship Id="rId20" Type="${R}/footnotes" Target="footnotes.xml"/>` +
        `<Relationship Id="rId21" Type="${R}/endnotes" Target="endnotes.xml"/>` +
        `<Relationship Id="rId22" Type="${R}/numbering" Target="numbering.xml"/>` +
        `<Relationship Id="rId23" Type="${R}/styles" Target="styles.xml"/>` +
        `</Relationships>`
    ),
    'word/numbering.xml': strToU8(NUMBERING),
    'word/styles.xml': strToU8(STYLES),
    'word/header1.xml': strToU8(`<w:hdr xmlns:w="${W}">${probeStory(CONTROL_TAG.header)}</w:hdr>`),
    'word/footer1.xml': strToU8(`<w:ftr xmlns:w="${W}">${probeStory(CONTROL_TAG.footer)}</w:ftr>`),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}">${noteSeparators('footnote')}` +
        `<w:footnote w:id="1">${probeStory(CONTROL_TAG.footnote)}</w:footnote></w:footnotes>`
    ),
    'word/endnotes.xml': strToU8(
      `<w:endnotes xmlns:w="${W}">${noteSeparators('endnote')}` +
        `<w:endnote w:id="1">${probeStory(CONTROL_TAG.endnote)}</w:endnote></w:endnotes>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${BODY}` +
        `<w:sectPr>` +
        `<w:headerReference w:type="default" r:id="${HEADER_R_ID}"/>` +
        `<w:footerReference w:type="default" r:id="${FOOTER_R_ID}"/>` +
        `</w:sectPr></w:body></w:document>`
    ),
  });
}
