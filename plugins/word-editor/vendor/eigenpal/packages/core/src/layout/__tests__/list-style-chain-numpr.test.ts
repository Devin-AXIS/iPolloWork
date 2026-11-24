// Style-chain `w:numPr` inheritance (§17.3.1.19): `w:ilvl` and `w:numId` inherit
// INDEPENDENTLY through `basedOn` and the direct `w:pPr`. Word's standard multilevel
// heading shape states the `w:num` once on Heading1 and only a level on Heading2–Heading9;
// reading each `w:numPr` node as a full replacement dropped the id at every level-only
// tier and unnumbered the whole chain. `w:numId w:val="0"` is the null definition
// (§17.9.18) — it switches numbering off at its tier even when a lower tier set one.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { createLayoutSession } from '../layout-session.ts';
import { buildNumberingIndex } from '../numbering-index.ts';
import { buildStyleCascadeTable, type StyleCascadeTable } from '../style-cascade.ts';
import {
  listFirstLineOffset,
  listMarkerBox,
  readNumPr,
  resolveStoryListItems,
  withNumberingStyleLinks,
} from '../list-resolve.ts';
import { paragraphFragmentsOf } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);

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

function paragraphsOf(part: OoxmlPart): OoxmlElement[] {
  const body = part.root.children.find(
    (child): child is OoxmlElement => child.kind !== 'textValue' && child.localName === 'body'
  )!;
  return body.children.filter((child): child is OoxmlElement => child.kind === 'paragraph');
}

/** The multilevel definition the chain numbers with: `1.`, `1.1`, `(a)`, `(i)`. */
const CHAIN_NUMBERING = `
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/>
      <w:lvlText w:val="%1."/><w:lvlJc w:val="left"/></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/>
      <w:lvlText w:val="%1.%2"/><w:lvlJc w:val="left"/></w:lvl>
    <w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/>
      <w:lvlText w:val="(%3)"/><w:lvlJc w:val="left"/></w:lvl>
    <w:lvl w:ilvl="3"><w:start w:val="1"/><w:numFmt w:val="lowerRoman"/>
      <w:lvlText w:val="(%4)"/><w:lvlJc w:val="left"/></w:lvl>
  </w:abstractNum>
  <w:num w:numId="12"><w:abstractNumId w:val="0"/></w:num>
`;

/** Heading1 names the num; the deeper headings state only a level; one style opts out. */
const CHAIN_STYLES = `
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:basedOn w:val="Normal"/>
    <w:pPr><w:numPr><w:numId w:val="12"/></w:numPr></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:basedOn w:val="Heading1"/>
    <w:pPr><w:numPr><w:ilvl w:val="1"/></w:numPr></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading3"><w:basedOn w:val="Heading2"/>
    <w:pPr><w:numPr><w:ilvl w:val="2"/></w:numPr></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="HeadingPara2"><w:basedOn w:val="Heading2"/>
    <w:pPr><w:numPr><w:numId w:val="0"/></w:numPr></w:pPr></w:style>
`;

const styled = (styleId: string, text: string, directPPr = '') =>
  `<w:p><w:pPr><w:pStyle w:val="${styleId}"/>${directPPr}</w:pPr>` +
  `<w:r><w:t>${text}</w:t></w:r></w:p>`;

function markersOf(part: OoxmlPart, cascade: StyleCascadeTable): (string | undefined)[] {
  const paragraphs = paragraphsOf(part);
  const items = resolveStoryListItems(paragraphs, numbering(CHAIN_NUMBERING), cascade);
  return paragraphs.map((paragraph) => items.get(paragraph.id)?.markerText);
}

describe('style-chain w:numPr inherits numId and ilvl independently', () => {
  test('level-only heading tiers keep the numId stated on the base heading', () => {
    const part = document(
      styled('Heading1', 'One') +
        styled('Heading2', 'One point one') +
        styled('Heading2', 'One point two') +
        styled('Heading3', 'Letter a') +
        styled('Heading1', 'Two') +
        styled('Heading2', 'Two point one')
    );
    expect(markersOf(part, styles(CHAIN_STYLES))).toEqual(['1.', '1.1', '1.2', '(a)', '2.', '2.1']);
  });

  test('w:numId w:val="0" at a style tier cancels the inherited numbering', () => {
    // The opted-out paragraph resolves to no numbering AND does not advance the counters:
    // the headings around it number as though it were plain text.
    const part = document(
      styled('Heading1', 'One') +
        styled('Heading2', 'One point one') +
        styled('HeadingPara2', 'Body text under the heading') +
        styled('Heading2', 'One point two')
    );
    expect(markersOf(part, styles(CHAIN_STYLES))).toEqual(['1.', '1.1', undefined, '1.2']);
  });

  test('a direct level-only w:numPr keeps the style numId and changes the level', () => {
    const part = document(
      styled('Heading1', 'One') +
        styled('Heading2', 'One point one') +
        styled('Heading2', 'Demoted to a letter', '<w:numPr><w:ilvl w:val="2"/></w:numPr>')
    );
    expect(markersOf(part, styles(CHAIN_STYLES))).toEqual(['1.', '1.1', '(a)']);
  });

  test('a direct valid numId re-enables numbering over a cancelling style tier', () => {
    // HeadingPara2 states numId 0; the paragraph's own tier re-states the id, and the
    // level it inherited through Heading2 (ilvl 1) still applies — per-field, both ways.
    const part = document(
      styled('Heading1', 'One') +
        styled('HeadingPara2', 'Renumbered', '<w:numPr><w:numId w:val="12"/></w:numPr>')
    );
    expect(markersOf(part, styles(CHAIN_STYLES))).toEqual(['1.', '1.1']);
  });

  test('an ilvl-only chain with no numId anywhere resolves to no numbering', () => {
    const cascade = styles(`
      <w:style w:type="paragraph" w:styleId="LevelOnly">
        <w:pPr><w:numPr><w:ilvl w:val="1"/></w:numPr></w:pPr></w:style>
    `);
    const part = document(styled('LevelOnly', 'No id below'));
    expect(markersOf(part, cascade)).toEqual([undefined]);
  });
});

describe('readNumPr folds hostile tiers per field', () => {
  /** Each entry is one cascade tier's `w:pPr`, lowest precedence first. */
  function foldedNumPr(...tiers: string[]): { numId: string; ilvl: number } | null {
    const part = document(tiers.map((pPr) => `<w:p><w:pPr>${pPr}</w:pPr></w:p>`).join(''));
    const nodes = paragraphsOf(part).map((paragraph) =>
      paragraph.children.find((child) => child.kind === 'paragraphProperties')!
    );
    return readNumPr(nodes);
  }

  test('a later numId-only tier keeps the folded level', () => {
    expect(
      foldedNumPr(
        '<w:numPr><w:ilvl w:val="1"/><w:numId w:val="5"/></w:numPr>',
        '<w:numPr><w:numId w:val="7"/></w:numPr>'
      )
    ).toEqual({ numId: '7', ilvl: 1 });
  });

  test('an oversized numId cancels like numId 0', () => {
    const oversized = 'x'.repeat(65);
    expect(
      foldedNumPr(
        '<w:numPr><w:numId w:val="5"/></w:numPr>',
        `<w:numPr><w:numId w:val="${oversized}"/></w:numPr>`
      )
    ).toBeNull();
  });

  test('an out-of-range ilvl invalidates the tier', () => {
    expect(
      foldedNumPr(
        '<w:numPr><w:numId w:val="5"/></w:numPr>',
        '<w:numPr><w:ilvl w:val="9"/></w:numPr>'
      )
    ).toBeNull();
  });

  test('an unparseable ilvl reads as level 0, not as a cancellation', () => {
    expect(foldedNumPr('<w:numPr><w:ilvl w:val="abc"/><w:numId w:val="5"/></w:numPr>')).toEqual({
      numId: '5',
      ilvl: 0,
    });
  });

  test('a valid tier above a cancelled one re-enables', () => {
    expect(
      foldedNumPr(
        '<w:numPr><w:ilvl w:val="2"/><w:numId w:val="5"/></w:numPr>',
        '<w:numPr><w:numId w:val="0"/></w:numPr>',
        '<w:numPr><w:numId w:val="7"/></w:numPr>'
      )
    ).toEqual({ numId: '7', ilvl: 2 });
  });
});

describe('w:numStyleLink resolution matches the merged read', () => {
  const LINKED = `
    <w:abstractNum w:abstractNumId="0"><w:numStyleLink w:val="Leaf"/></w:abstractNum>
    <w:abstractNum w:abstractNumId="1">
      <w:styleLink w:val="Leaf"/>
      <w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/>
        <w:lvlJc w:val="left"/></w:lvl>
    </w:abstractNum>
    <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
    <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
  `;

  test('a level-only linked style walks basedOn for the numId', () => {
    const cascade = styles(`
      <w:style w:type="paragraph" w:styleId="Base">
        <w:pPr><w:numPr><w:numId w:val="2"/></w:numPr></w:pPr></w:style>
      <w:style w:type="paragraph" w:styleId="Leaf"><w:basedOn w:val="Base"/>
        <w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr></w:style>
    `);
    const linked = withNumberingStyleLinks(numbering(LINKED), cascade);
    expect(linked.abstractNums.get('0')?.levels.get(0)?.lvlText).toBe('•');
  });

  test('a linked style stating numId 0 resolves inertly, not through its base', () => {
    const cascade = styles(`
      <w:style w:type="paragraph" w:styleId="Base">
        <w:pPr><w:numPr><w:numId w:val="2"/></w:numPr></w:pPr></w:style>
      <w:style w:type="paragraph" w:styleId="Leaf"><w:basedOn w:val="Base"/>
        <w:pPr><w:numPr><w:numId w:val="0"/></w:numPr></w:pPr></w:style>
    `);
    const linked = withNumberingStyleLinks(numbering(LINKED), cascade);
    expect(linked.abstractNums.get('0')?.levels.size).toBe(0);
  });
});

describe('a positive-firstLine level places the marker after the text start', () => {
  // The standard legal-numbering shape: `w:ind w:left="0" w:firstLine="720"` plus a `num`
  // tab one grid stop further. The marker sits at 0.5" (36pt), the first-line text tabs to
  // 1" (72pt), and continuation lines return to the margin. `w:hanging` and a positive
  // `w:firstLine` are one mutually exclusive slot (§17.3.1.10, §17.3.1.12).
  const FIRSTLINE_NUMBERING = `
    <w:abstractNum w:abstractNumId="1">
      <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/>
        <w:lvlText w:val="%1."/><w:lvlJc w:val="left"/>
        <w:pPr><w:tabs><w:tab w:val="num" w:pos="1440"/></w:tabs>
          <w:ind w:left="0" w:firstLine="720"/></w:pPr></w:lvl>
    </w:abstractNum>
    <w:num w:numId="20"><w:abstractNumId w:val="1"/></w:num>
  `;
  const numbered = (text: string) =>
    '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="20"/></w:numPr></w:pPr>' +
    `<w:r><w:t>${text}</w:t></w:r></w:p>`;

  test('the marker box starts at left + firstLine and the suffix tab clears it', () => {
    const part = document(numbered('Section text'));
    const paragraphs = paragraphsOf(part);
    const items = resolveStoryListItems(paragraphs, numbering(FIRSTLINE_NUMBERING), undefined);
    const item = items.get(paragraphs[0]!.id)!;
    expect(item.indent).toEqual({ left: 0, right: 0, hanging: 0, firstLine: 36 });
    // `1.` at 6pt/char is 12pt wide; the marker starts at the 36pt first-line indent.
    const box = listMarkerBox(item, 12, 0, 14)!;
    expect(box.x).toBe(36);
    // Marker end 48pt → the next default half-inch stop, 72pt from the text start.
    expect(listFirstLineOffset(item, measurer)).toBe(72);
  });

  test('the first line tabs past the marker; continuation lines return to left', () => {
    const part = document(numbered('aaaa aaaa aaaa aaaa aaaa aaaa'));
    const items = resolveStoryListItems(paragraphsOf(part), numbering(FIRSTLINE_NUMBERING));
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      listItems: items,
      geometry: { width: 220, height: 400, margin: { top: 20, right: 20, bottom: 20, left: 20 } },
    });
    const fragment = paragraphFragmentsOf(layout.pages[0]!)[0]!;
    expect(fragment.marker?.text).toBe('1.');
    expect(fragment.marker?.box.x).toBe(36);
    expect(fragment.lines.length).toBeGreaterThan(1);
    expect(fragment.lines[0]!.contentX).toBe(72);
    expect(fragment.lines[1]!.contentX).toBe(0);
  });

  test('a hanging level keeps its old marker box', () => {
    const HANGING_NUMBERING = `
      <w:abstractNum w:abstractNumId="1">
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/>
          <w:lvlText w:val="%1."/><w:lvlJc w:val="left"/>
          <w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
      </w:abstractNum>
      <w:num w:numId="20"><w:abstractNumId w:val="1"/></w:num>
    `;
    const part = document(numbered('Hanging text'));
    const paragraphs = paragraphsOf(part);
    const items = resolveStoryListItems(paragraphs, numbering(HANGING_NUMBERING), undefined);
    const item = items.get(paragraphs[0]!.id)!;
    expect(item.indent).toEqual({ left: 36, right: 0, hanging: 18, firstLine: 0 });
    expect(listMarkerBox(item, 12, 0, 14)!.x).toBe(18);
    expect(listFirstLineOffset(item, measurer)).toBe(0);
  });
});

describe('a style-chain resolution change renumbers an incremental pass', () => {
  test('a changed heading level reaches the session path', () => {
    // The resolved marker feeds `cacheToken`, which the break cache and the prepared-block
    // memo key on — a cascade change must move the fragments, not serve the warm pages.
    const part = document(styled('Heading1', 'One') + styled('Heading2', 'Nested'));
    const level = (ilvl: string) =>
      styles(CHAIN_STYLES.replace('<w:ilvl w:val="1"/>', `<w:ilvl w:val="${ilvl}"/>`));
    const markers = (
      cascade: StyleCascadeTable,
      session?: ReturnType<typeof createLayoutSession>
    ) =>
      paragraphFragmentsOf(
        layoutSemanticDocument(part, 1, {
          measurer,
          numberingIndex: numbering(CHAIN_NUMBERING),
          styleCascade: cascade,
          ...(session ? { session } : {}),
        }).pages[0]!
      ).map((fragment) => fragment.marker?.text);

    const session = createLayoutSession();
    expect(markers(level('1'), session)).toEqual(['1.', '1.1']);
    const incremental = markers(level('2'), session);
    expect(incremental).toEqual(markers(level('2')));
    expect(incremental).toEqual(['1.', '(a)']);
  });
});
