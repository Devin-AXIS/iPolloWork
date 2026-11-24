// `w:suff` (§17.9.30) — what sits between a marker and the text it numbers — and the case
// Word handles with the same mechanism: a marker WIDER than its hanging slot.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import { nextTabDestination, paragraphTabStops, tabStopsFingerprint } from '../paragraph-tabs.ts';
import { buildNumberingIndex } from '../numbering-index.ts';
import {
  listFirstLineOffset,
  resolveStoryListItems,
  type ResolvedListItem,
} from '../list-resolve.ts';
import { paragraphFragmentsOf } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

// Every glyph is 6pt wide, so a marker's width is its length × 6 — the arithmetic below is
// deliberately checkable by hand.
const measurer = createFixedMeasurer(6, 14);

function numbering(body: string) {
  const result = readOoxmlPart(`<w:numbering xmlns:w="${W}">${body}</w:numbering>`, {
    name: '/word/numbering.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return buildNumberingIndex(result.part.root);
}

function document(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const listParagraph = (text: string, numId: string, ilvl = '0') =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>` +
  `<w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;

// The marker is measured with the LEVEL's own `w:rPr` (these fixtures resolve without a
// style cascade, so the paragraph mark never reaches it). The 6pt measurer base describes an
// 11pt run, so the level authors `w:sz="22"`; the 10pt terminal fallback (see
// `DEFAULT_RUN_STYLE`) would make the `1.` marker 10.9pt wide instead of 12.
const LEVEL_SZ = '<w:rPr><w:sz w:val="22"/></w:rPr>';

/** A space suffix is 569/2048 em of the marker's 11pt size, whatever its face. */
const SPACE = (569 / 2048) * 11;

test('a legacy list tab positions the first line without becoming an ordinary text tab', () => {
  const body = listParagraph(Array(10).fill('aaaa').join(' '), '1').replace(
    '</w:pPr>',
    '<w:ind w:left="0" w:firstLine="720"/><w:tabs><w:tab w:val="num" w:pos="1080"/></w:tabs></w:pPr>'
  );
  const { item, part } = itemOf(body, flat('tab'));
  const paragraph = part.root.children[0]!.children[0]!;
  const tabs = paragraphTabStops(paragraph.children[0]);
  expect(listFirstLineOffset(item, measurer, tabs)).toBe(54);
  expect(nextTabDestination(tabs, 48, 175).positionPt).toBe(72);
  expect(tabStopsFingerprint(tabs)).not.toBe(
    tabStopsFingerprint({
      ...tabs,
      stops: [{ positionPt: 54, alignment: 'left' }],
    })
  );
  const options = {
    measurer,
    session: createLayoutSession(),
    listItems: new Map([[paragraph.id, item]]),
    geometry: { width: 215, height: 400, margin: { top: 20, right: 20, bottom: 20, left: 20 } },
  };
  const result = layoutSemanticDocument(part, 1, options);
  expect(layoutSemanticDocument(part, 1, options).pages).toEqual(result.pages);
  const fragment = paragraphFragmentsOf(result.pages[0]!)[0]!;
  expect(fragment.marker!.box.x).toBe(36);
  expect(fragment.lines).toHaveLength(2);
  expect(fragment.lines[0]!.spans[0]!.box.x).toBe(54);
  expect(fragment.lines[1]!.spans[0]!.box.x).toBe(0);
});

/** One resolved item for the single list paragraph in `body`. */
function itemOf(body: string, numberingXml: string): ResolvedItemAndPart {
  const part = document(body);
  const root = part.root!;
  const bodyElement = root.children.find((child) => child.localName === 'body')!;
  const index = numbering(numberingXml);
  const items = resolveStoryListItems(
    bodyElement.children.filter((child) => child.kind === 'paragraph'),
    index,
    undefined
  );
  return { item: [...items.values()][0]!, part, index };
}

interface ResolvedItemAndPart {
  readonly item: ResolvedListItem;
  readonly part: OoxmlPart;
  readonly index: ReturnType<typeof buildNumberingIndex>;
}

/** left 720tw = 36pt, no hanging — the compact shape `w:suff` exists for. */
const flat = (suff: string) => `
  <w:abstractNum w:abstractNumId="1">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:suff w:val="${suff}"/>
      <w:lvlText w:val="%1."/><w:lvlJc w:val="left"/>${LEVEL_SZ}
      <w:pPr><w:ind w:left="720"/></w:pPr></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
`;

describe('w:suff decides where the first line starts', () => {
  test('tab with a marker that fits keeps the text at the indent', () => {
    // left 36pt, hanging 18pt, marker `1.` is 12pt wide: it ends at 30pt, inside the slot.
    const { item } = itemOf(
      listParagraph('Fits', '1'),
      `
        <w:abstractNum w:abstractNumId="1">
          <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/>
            <w:lvlText w:val="%1."/><w:lvlJc w:val="left"/>${LEVEL_SZ}
            <w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
        </w:abstractNum>
        <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
      `
    );
    expect(item.suffix).toBe('tab');
    expect(listFirstLineOffset(item, measurer)).toBe(0);
  });

  test('space puts the text one space after the marker', () => {
    const { item } = itemOf(listParagraph('Compact', '1'), flat('space'));
    expect(item.suffix).toBe('space');
    // Marker ends at 36 + 12 = 48, plus the space suffix, past the 36pt indent.
    expect(listFirstLineOffset(item, measurer)).toBeCloseTo(12 + SPACE, 6);
  });

  test('nothing puts the text immediately after the marker', () => {
    const { item } = itemOf(listParagraph('Tight', '1'), flat('nothing'));
    expect(item.suffix).toBe('nothing');
    expect(listFirstLineOffset(item, measurer)).toBe(12);
  });

  test('a suffix space with a hanging indent pulls the text back left of the indent', () => {
    const { item } = itemOf(
      listParagraph('Hanging', '1'),
      `
        <w:abstractNum w:abstractNumId="1">
          <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:suff w:val="space"/>
            <w:lvlText w:val="•"/><w:lvlJc w:val="left"/>${LEVEL_SZ}
            <w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
        </w:abstractNum>
        <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
      `
    );
    // Marker starts at 18 and is 6pt wide, plus the space suffix: LEFT of the 36pt indent.
    expect(listFirstLineOffset(item, measurer)).toBeCloseTo(-12 + SPACE, 6);
  });
});

describe('a marker wider than its hanging slot', () => {
  const deep = `
    <w:abstractNum w:abstractNumId="1">
      <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>
        <w:lvlJc w:val="left"/>${LEVEL_SZ}<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
      <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1.%2."/>
        <w:lvlJc w:val="left"/>${LEVEL_SZ}<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
      <w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="decimal"/>
        <w:lvlText w:val="%1.%2.%3."/><w:lvlJc w:val="left"/>${LEVEL_SZ}
        <w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
    </w:abstractNum>
    <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
  `;

  test('the suffix tab advances the first line past it', () => {
    const { item } = itemOf(listParagraph('Deep', '1', '2'), deep);
    // `1.1.1.` is 36pt wide from 18pt, so it ends at 54 — 18pt past the 36pt indent. The
    // next default-interval stop (36pt grid) is 72, i.e. 36pt past the indent.
    expect(item.markerText).toBe('1.1.1.');
    expect(listFirstLineOffset(item, measurer)).toBe(36);
  });

  test('layout starts the first line after the marker, not under it', () => {
    const part = document(listParagraph('Deep', '1', '2'));
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      numberingIndex: numbering(deep),
    });
    const fragment = paragraphFragmentsOf(layout.pages[0]!)[0]!;
    const marker = fragment.marker!;
    const firstSpan = fragment.lines[0]!.spans[0]!;
    expect(marker.text).toBe('1.1.1.');
    expect(marker.box.x + marker.box.width).toBe(54);
    // The text used to start at the 36pt indent — underneath its own marker.
    expect(firstSpan.box.x).toBe(72);
    expect(firstSpan.box.x).toBeGreaterThanOrEqual(marker.box.x + marker.box.width);
  });

  test('an ordinary list is untouched: the text still starts at the indent', () => {
    const part = document(listParagraph('Plain', '1', '0'));
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      numberingIndex: numbering(deep),
    });
    const fragment = paragraphFragmentsOf(layout.pages[0]!)[0]!;
    expect(fragment.lines[0]!.spans[0]!.box.x).toBe(36);
  });

  test('an authored tab stop wins over the default interval', () => {
    const part = document(
      `<w:p><w:pPr><w:numPr><w:ilvl w:val="2"/><w:numId w:val="1"/></w:numPr>` +
        `<w:tabs><w:tab w:val="left" w:pos="1200"/></w:tabs></w:pPr>` +
        `<w:r><w:t>Deep</w:t></w:r></w:p>`
    );
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      numberingIndex: numbering(deep),
    });
    const fragment = paragraphFragmentsOf(layout.pages[0]!)[0]!;
    // 1200tw = 60pt, the first stop past the 54pt marker end.
    expect(fragment.lines[0]!.spans[0]!.box.x).toBe(60);
  });
});

test('right and centered markers align around the authored first-line position', () => {
  for (const [indent, anchor, textStart] of [
    ['w:hanging="360"', 18, 36],
    ['w:firstLine="-360"', 18, 36],
    ['w:firstLine="360"', 54, 72],
  ] as const) {
    for (const alignment of ['left', 'center', 'right'] as const) {
      const xml = flat('tab')
        .replace('<w:lvlJc w:val="left"/>', `<w:lvlJc w:val="${alignment}"/>`)
        .replace('w:left="720"', `w:left="720" ${indent}`);
      const { part, index } = itemOf(listParagraph('Aligned list text', '1'), xml);
      const session = createLayoutSession();
      const options = { measurer, numberingIndex: index, session };
      for (let revision = 0; revision < 2; revision++) {
        const layout = layoutSemanticDocument(part, revision, options);
        expect(layout.pages).toEqual(
          layoutSemanticDocument(part, revision, { measurer, numberingIndex: index }).pages
        );
        const paragraph = paragraphFragmentsOf(layout.pages[0]!)[0]!;
        const marker = paragraph.marker!;
        expect(
          marker.box.x +
            marker.box.width * (alignment === 'right' ? 1 : alignment === 'center' ? 0.5 : 0)
        ).toBe(anchor);
        expect(paragraph.lines[0]!.spans[0]!.box.x).toBe(textStart);
      }
    }
  }
});
