// `w:numStyleLink` / `w:styleLink` indirection (ECMA-376 §17.9.21, §17.9.23).
//
// Word's built-in List Bullet / List Number styles are authored this way: the abstract
// definition a paragraph names carries NO `w:lvl` at all and delegates to a style, whose
// `w:numPr` names the `w:num` that owns the real levels. Without following the link the
// level resolves to nothing and the paragraph renders with no marker whatsoever.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { buildNumberingIndex, resolveNumberingStyleLinks } from '../numbering-index.ts';
import { buildStyleCascadeTable, type StyleCascadeTable } from '../style-cascade.ts';
import { resolveStoryListItems, withNumberingStyleLinks } from '../list-resolve.ts';
import { paragraphFragmentsOf } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const measurer = createFixedMeasurer(6, 14);

/** The shape Word writes for List Bullet: a delegating abstract + the style that owns it. */
const LINKED_NUMBERING = `
  <w:abstractNum w:abstractNumId="0">
    <w:multiLevelType w:val="singleLevel"/>
    <w:numStyleLink w:val="ListBullet"/>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="1">
    <w:styleLink w:val="ListBullet"/>
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/>
      <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
`;

const LINKED_STYLES = `
  <w:style w:type="paragraph" w:styleId="ListBullet">
    <w:name w:val="List Bullet"/>
    <w:pPr><w:numPr><w:numId w:val="2"/></w:numPr></w:pPr>
  </w:style>
`;

function numbering(body: string) {
  const result = readOoxmlPart(`<w:numbering xmlns:w="${W}">${body}</w:numbering>`, {
    name: '/word/numbering.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return buildNumberingIndex(result.part.root);
}

function styles(body: string): StyleCascadeTable {
  const result = readOoxmlPart(`<w:styles xmlns:w="${W}">${body}</w:styles>`, {
    name: '/word/styles.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return buildStyleCascadeTable(result.part.root);
}

function document(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const listParagraph = (text: string, numId: string) =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>` +
  `<w:r><w:t>${text}</w:t></w:r></w:p>`;

describe('w:numStyleLink delegation', () => {
  test('a delegating abstractNum still paints its bullet', () => {
    const part = document(listParagraph('Delegated bullet', '1'));
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      numberingIndex: numbering(LINKED_NUMBERING),
      styleCascade: styles(LINKED_STYLES),
    });
    const fragment = paragraphFragmentsOf(layout.pages[0]!)[0]!;
    expect(fragment.marker?.text).toBe('•');
    // The linked level owns the geometry too: left 720tw, hanging 360tw.
    expect(fragment.box.x).toBe(36);
    expect(fragment.marker!.box.x).toBe(18);
  });

  test('the linked level supplies numbering, not just a glyph', () => {
    const index = numbering(`
      <w:abstractNum w:abstractNumId="0"><w:numStyleLink w:val="ListNumber"/></w:abstractNum>
      <w:abstractNum w:abstractNumId="1">
        <w:styleLink w:val="ListNumber"/>
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>
          <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="360" w:hanging="360"/></w:pPr></w:lvl>
      </w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
      <w:num w:numId="6"><w:abstractNumId w:val="1"/></w:num>
    `);
    const cascade = styles(`
      <w:style w:type="paragraph" w:styleId="ListNumber">
        <w:pPr><w:numPr><w:numId w:val="6"/></w:numPr></w:pPr>
      </w:style>
    `);
    const part = document(listParagraph('One', '1') + listParagraph('Two', '1'));
    const body = part.root!.children.find((child) => child.localName === 'body')!;
    const items = resolveStoryListItems(
      body.children.filter((child) => child.kind === 'paragraph'),
      index,
      cascade
    );
    expect([...items.values()].map((item) => item.markerText)).toEqual(['1.', '2.']);
  });

  test('the link is followed through the style basedOn chain', () => {
    const index = numbering(LINKED_NUMBERING);
    const cascade = styles(`
      <w:style w:type="paragraph" w:styleId="ListBase">
        <w:pPr><w:numPr><w:numId w:val="2"/></w:numPr></w:pPr>
      </w:style>
      <w:style w:type="paragraph" w:styleId="ListBullet">
        <w:basedOn w:val="ListBase"/>
      </w:style>
    `);
    const linked = withNumberingStyleLinks(index, cascade);
    expect(linked.abstractNums.get('0')?.levels.get(0)?.lvlText).toBe('•');
  });

  test('a link cycle resolves inertly instead of spinning', () => {
    // The style points back at the num whose abstract does the delegating.
    const index = numbering(`
      <w:abstractNum w:abstractNumId="0"><w:numStyleLink w:val="Loop"/></w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
    `);
    const cascade = styles(`
      <w:style w:type="paragraph" w:styleId="Loop">
        <w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr>
      </w:style>
    `);
    const linked = withNumberingStyleLinks(index, cascade);
    expect(linked.abstractNums.get('0')?.levels.size).toBe(0);

    const part = document(listParagraph('No marker', '1'));
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      numberingIndex: index,
      styleCascade: cascade,
    });
    // Inert, not hung and not invented: the paragraph lays out as ordinary text.
    expect(paragraphFragmentsOf(layout.pages[0]!)[0]!.marker).toBeUndefined();
  });

  test('a two-hop chain still terminates', () => {
    const index = numbering(`
      <w:abstractNum w:abstractNumId="0"><w:numStyleLink w:val="A"/></w:abstractNum>
      <w:abstractNum w:abstractNumId="1"><w:numStyleLink w:val="B"/></w:abstractNum>
      <w:abstractNum w:abstractNumId="2">
        <w:styleLink w:val="B"/>
        <w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="▪"/><w:lvlJc w:val="left"/></w:lvl>
      </w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
      <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
      <w:num w:numId="3"><w:abstractNumId w:val="2"/></w:num>
    `);
    const cascade = styles(`
      <w:style w:type="paragraph" w:styleId="A">
        <w:pPr><w:numPr><w:numId w:val="2"/></w:numPr></w:pPr></w:style>
      <w:style w:type="paragraph" w:styleId="B">
        <w:pPr><w:numPr><w:numId w:val="3"/></w:numPr></w:pPr></w:style>
    `);
    expect(
      withNumberingStyleLinks(index, cascade).abstractNums.get('0')?.levels.get(0)?.lvlText
    ).toBe('▪');
  });

  test('resolution is identity-stable and idempotent', () => {
    const index = numbering(LINKED_NUMBERING);
    const cascade = styles(LINKED_STYLES);
    // Nothing to follow — the same index comes back, so layout caches stay valid.
    expect(withNumberingStyleLinks(index, undefined)).toBe(index);
    expect(resolveNumberingStyleLinks(index, () => undefined)).toBe(index);
    const once = withNumberingStyleLinks(index, cascade);
    expect(once).not.toBe(index);
    expect(withNumberingStyleLinks(once, cascade)).toBe(once);
  });
});
