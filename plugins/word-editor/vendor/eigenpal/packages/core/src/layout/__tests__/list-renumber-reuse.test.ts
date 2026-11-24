// A list marker is DERIVED — from `numbering.xml` and the counter state, never from the
// paragraph — so a numbering change leaves every paragraph subtree byte-identical. The
// break-cache key and the prepared-block memo both carry `listItem.cacheToken`, which holds
// the marker TEXT (not its length), the resolved indent, and the marker FACE. A count-only
// producer used to hide those: same item count hashed the same, and `ii.` shared a slot
// with `vi.`.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { createLayoutSession, type LayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { resolveStoryListItems } from '../list-resolve.ts';
import { buildNumberingIndex } from '../numbering-index.ts';
import { paragraphFragmentsOf } from '../semantic-records.ts';
import type { TextMeasurer } from '../semantic-records.ts';
import type { ResolvedRunStyle } from '../run-style.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);

function load(xml: string, name: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const item = (text: string) =>
  '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
  `<w:r><w:t>${text}</w:t></w:r></w:p>`;

const document = (...texts: string[]) =>
  load(
    `<w:document xmlns:w="${W}"><w:body>${texts.map(item).join('')}</w:body></w:document>`,
    '/word/document.xml'
  );

/** `w:start` is the one Word writes when a list is told to begin elsewhere (§17.9.25). */
const numbering = (start: string, extras = '') =>
  load(
    `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0">` +
      `<w:start w:val="${start}"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>` +
      `${extras}</w:lvl></w:abstractNum>` +
      '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>',
    '/word/numbering.xml'
  );

function paragraphsOf(part: OoxmlPart): OoxmlElement[] {
  const body = part.root.children.find(
    (child): child is OoxmlElement => child.kind !== 'textValue' && child.localName === 'body'
  )!;
  return body.children.filter((child): child is OoxmlElement => child.kind === 'paragraph');
}

function layoutList(
  part: OoxmlPart,
  numberingPart: OoxmlPart,
  options: {
    session?: LayoutSession;
    cache?: ReturnType<typeof createParagraphLayoutCache>;
    measurer?: TextMeasurer;
    geometry?: {
      width: number;
      height: number;
      margin: { top: number; right: number; bottom: number; left: number };
    };
  } = {}
) {
  const listItems = resolveStoryListItems(
    paragraphsOf(part),
    buildNumberingIndex(numberingPart.root as OoxmlElement),
    undefined
  );
  return layoutSemanticDocument(part, 1, {
    measurer: options.measurer ?? measurer,
    listItems,
    ...(options.session ? { session: options.session } : {}),
    ...(options.cache ? { cache: options.cache } : {}),
    ...(options.geometry ? { geometry: options.geometry } : {}),
  });
}

function markersOf(
  part: OoxmlPart,
  start: string,
  session?: LayoutSession
): (string | undefined)[] {
  return layoutList(part, numbering(start), { session })
    .pages.flatMap((page) => page.fragments)
    .map((fragment) => (fragment.kind === 'paragraph' ? fragment.marker?.text : undefined));
}

describe('a renumbered list is re-placed, not reused', () => {
  test('a w:start change reaches an incremental pass', () => {
    const part = document('first', 'second');
    const session = createLayoutSession();
    expect(markersOf(part, '1', session)).toEqual(['1.', '2.']);
    expect(markersOf(part, '2', session)).toEqual(markersOf(part, '2'));
    expect(markersOf(part, '2')).toEqual(['2.', '3.']);
  });

  test('an unchanged list still reuses its pages', () => {
    // The flow key carries the marker text; it must not carry anything that varies per pass,
    // or every keystroke in a list document becomes a full pass.
    const part = document('first', 'second');
    const session = createLayoutSession();
    markersOf(part, '1', session);
    markersOf(part, '1', session);
    expect(session.stats.placed).toBe(0);
    expect(session.stats.reusedPages).toBeGreaterThan(0);
  });

  test('a level indent change with the same item count reaches geometry', () => {
    // The prepared-block memo used to validate width, producer and drawing token only. The
    // cached entry embeds indent, available width and the break-cache key — all three from
    // `listItem`, which those validators cannot see. A numbering-level `w:ind` change keeps
    // the marker text and the item count, so the producer that used to carry the count
    // stayed warm and the increment never moved the fragments.
    const part = document('first', 'second');
    const session = createLayoutSession();
    const hanging = '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>';
    const deep = '<w:pPr><w:ind w:left="2880" w:hanging="360"/></w:pPr>';
    const geometryOf = (leftTwips: '720' | '2880', nextSession?: LayoutSession) => {
      const extras = leftTwips === '720' ? hanging : deep;
      const layout = layoutList(part, numbering('1', extras), { session: nextSession });
      const fragments = paragraphFragmentsOf(layout.pages[0]!);
      return {
        placed: nextSession?.stats.placed,
        pages: layout.pages,
        items: fragments.map((fragment) => ({
          x: fragment.box.x,
          markerX: fragment.marker?.box.x,
          marker: fragment.marker?.text,
        })),
      };
    };

    const warm = geometryOf('720', session);
    expect(warm.items).toEqual([
      { x: 36, markerX: 18, marker: '1.' },
      { x: 36, markerX: 18, marker: '2.' },
    ]);

    const incremental = geometryOf('2880', session);
    const cold = geometryOf('2880');
    expect(incremental.items).toEqual(cold.items);
    expect(incremental.items).toEqual([
      { x: 144, markerX: 126, marker: '1.' },
      { x: 144, markerX: 126, marker: '2.' },
    ]);
    expect(incremental.placed).toBeGreaterThan(0);
    expect(incremental.pages[0]).not.toBe(warm.pages[0]);
  });

  test('same-length different-width markers bust the break cache', () => {
    // `cacheToken` used to key on `markerText.length`. A measurer where `i` is 1pt and `v`
    // is 30pt makes `ii.` and `vi.` the same length and different widths. Placement remaps
    // the first-span x from the live marker, so the stale read is the WRAP: the first line
    // was broken under the previous marker's width and kept one more word. Item 3 is the
    // control: `iv.` → `viii.` changes length, so even the old key moved.
    const letterWidths: TextMeasurer = {
      measure(text: string, _style: ResolvedRunStyle) {
        let width = 0;
        for (const ch of text) {
          if (ch === 'i') width += 1;
          else if (ch === 'v') width += 30;
          else width += 6;
        }
        return width;
      },
      lineMetrics() {
        return { height: 14, baseline: 11.2 };
      },
    };
    const lowerRoman = (start: string) =>
      load(
        `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0">` +
          `<w:start w:val="${start}"/><w:numFmt w:val="lowerRoman"/><w:lvlText w:val="%1."/>` +
          '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>' +
          '</w:lvl></w:abstractNum>' +
          '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>',
        '/word/numbering.xml'
      );
    // Each `xxxx ` is 30pt. Content is 180pt, indent 36pt, so the first line has 144pt
    // when the marker fits (`ii.`) and 108pt when `vi.` overflows to the next 36pt tab.
    const words = 'xxxx xxxx xxxx xxxx xxxx';
    const part = document(words, words, words);
    const session = createLayoutSession();
    const cache = createParagraphLayoutCache();
    const narrow = {
      width: 220,
      height: 400,
      margin: { top: 20, right: 20, bottom: 20, left: 20 },
    };
    const linesOf = (start: string, nextSession?: LayoutSession) => {
      const layout = layoutList(part, lowerRoman(start), {
        session: nextSession,
        ...(nextSession ? { cache } : {}),
        measurer: letterWidths,
        geometry: narrow,
      });
      return paragraphFragmentsOf(layout.pages[0]!).map((fragment) => ({
        marker: fragment.marker?.text,
        firstLine: fragment.lines[0]!.spans.map((span) => span.text).join(''),
      }));
    };

    const warm = linesOf('2', session);
    expect(warm.map((row) => row.marker)).toEqual(['ii.', 'iii.', 'iv.']);
    const incremental = linesOf('6', session);
    const cold = linesOf('6');
    expect(incremental.map((row) => row.marker)).toEqual(['vi.', 'vii.', 'viii.']);
    expect(incremental).toEqual(cold);
    expect(incremental[0]!.firstLine).not.toBe(warm[0]!.firstLine);
    expect(incremental[1]!.firstLine).not.toBe(warm[1]!.firstLine);
  });

  test('a marker face size change with the same text reaches the wrap', () => {
    // `cacheToken` held the marker glyphs and the indent, but `listFirstLineOffset`
    // measures with the level's `w:rPr`. A `w:sz` change keeps `1.` and the item count
    // and still moves the first-line width.
    const words = 'xxxx xxxx xxxx xxxx xxxx';
    const part = document(words, words);
    const session = createLayoutSession();
    const cache = createParagraphLayoutCache();
    const narrow = {
      width: 220,
      height: 400,
      margin: { top: 20, right: 20, bottom: 20, left: 20 },
    };
    const sized = (halfPoints: string) =>
      `<w:rPr><w:sz w:val="${halfPoints}"/></w:rPr>` +
      '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>';
    const linesOf = (halfPoints: string, nextSession?: LayoutSession) => {
      const layout = layoutList(part, numbering('1', sized(halfPoints)), {
        session: nextSession,
        ...(nextSession ? { cache } : {}),
        geometry: narrow,
      });
      return paragraphFragmentsOf(layout.pages[0]!).map((fragment) => ({
        marker: fragment.marker?.text,
        firstLine: fragment.lines[0]!.spans.map((span) => span.text).join(''),
      }));
    };

    const warm = linesOf('22', session);
    expect(warm.map((row) => row.marker)).toEqual(['1.', '2.']);
    const incremental = linesOf('72', session);
    const cold = linesOf('72');
    expect(incremental).toEqual(cold);
    expect(incremental[0]!.firstLine).not.toBe(warm[0]!.firstLine);
  });
});
