// Underline-to-margin headings authored with trailing spaces or an underscore tab leader.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { paintSemanticLayout } from '../../output/semantic-paint.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { layoutSemanticDocument, linesOf } from '../index.ts';
import { spanOffsetX } from '../semantic-hit-test.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const HEADING = '二、宣布开庭';
const FULL_WIDTH_FILL = '\u3000'.repeat(52);
const RUN_PROPS =
  '<w:rFonts w:ascii="SimSun" w:eastAsia="SimSun"/><w:sz w:val="36"/><w:b/><w:u w:val="single"/>';
const GEOMETRY = {
  width: 200,
  height: 400,
  margin: { top: 10, right: 10, bottom: 10, left: 10 },
};
const MEASURER = createFixedMeasurer(6, 20);

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function layoutOf(body: string) {
  return layoutSemanticDocument(load(body), 1, {
    measurer: MEASURER,
    geometry: GEOMETRY,
  });
}

describe('underline-to-margin headings', () => {
  test('trailing full-width spaces fill the remaining width without opening lines', () => {
    const layout = layoutOf(
      `<w:p><w:pPr><w:spacing w:line="560" w:lineRule="exact"/></w:pPr>` +
        `<w:r><w:rPr>${RUN_PROPS}</w:rPr><w:t>${HEADING}</w:t></w:r>` +
        `<w:r><w:rPr>${RUN_PROPS}</w:rPr><w:t xml:space="preserve">${FULL_WIDTH_FILL}</w:t></w:r>` +
        '</w:p>'
    );
    const lines = linesOf(layout);

    expect(lines).toHaveLength(1);
    expect(lines[0]!.spans.map((span) => span.text).join('')).toBe(HEADING + FULL_WIDTH_FILL);
    const fill = lines[0]!.spans.at(-1)!;
    expect(fill.box.x + fill.box.width).toBeCloseTo(180, 5);
    expect(spanOffsetX(fill, fill.range.end, MEASURER)).toBeCloseTo(180, 5);

    const container = document.createElement('div');
    paintSemanticLayout(container, layout, { scale: 1 });
    const paintedFill = [...container.querySelectorAll<HTMLElement>('[data-start]')].at(-1)!;
    expect(Number.parseFloat(paintedFill.style.width)).toBeCloseTo(fill.box.width, 5);
    expect(paintedFill.style.clipPath).toContain('-1em');
  });

  for (const alignment of ['center', 'right'] as const) {
    test(`${alignment}-aligned heading keeps its visible alignment and fills to the margin`, () => {
      const layout = layoutOf(
        `<w:p><w:pPr><w:jc w:val="${alignment}"/></w:pPr>` +
          `<w:r><w:rPr>${RUN_PROPS}</w:rPr><w:t>${HEADING}</w:t></w:r>` +
          `<w:r><w:rPr>${RUN_PROPS}</w:rPr><w:t xml:space="preserve">${FULL_WIDTH_FILL}</w:t></w:r>` +
          '</w:p>'
      );
      const line = linesOf(layout)[0]!;
      const heading = line.spans[0]!;
      const fill = line.spans.at(-1)!;
      const expectedX =
        alignment === 'center' ? (180 - heading.box.width) / 2 : 180 - heading.box.width;

      expect(heading.box.x).toBeCloseTo(expectedX, 5);
      expect(fill.box.x + fill.box.width).toBeCloseTo(180, 5);
    });

    test(`${alignment}-aligned fill remains terminal before a hard break`, () => {
      const paragraph =
        `<w:p><w:pPr><w:jc w:val="${alignment}"/></w:pPr>` +
        `<w:r><w:rPr>${RUN_PROPS}</w:rPr><w:t>${HEADING}</w:t></w:r>` +
        `<w:r><w:rPr>${RUN_PROPS}</w:rPr><w:t xml:space="preserve">${FULL_WIDTH_FILL}</w:t></w:r>` +
        '<w:r><w:br/></w:r></w:p>';
      const body = layoutOf(paragraph);
      const table = layoutOf(
        '<w:tbl><w:tblGrid><w:gridCol w:w="2880"/></w:tblGrid><w:tr><w:tc>' +
          paragraph +
          '</w:tc></w:tr></w:tbl><w:p/>'
      );

      for (const layout of [body, table]) {
        const line = linesOf(layout).find((candidate) =>
          candidate.spans.some((span) => span.text === '\n')
        )!;
        const heading = line.spans[0]!;
        const fill = line.spans.find((span) => span.lineEndWhitespace)!;
        const lineBreak = line.spans.at(-1)!;
        const rightEdge = line.box.x + line.box.width;
        const expectedLeading =
          alignment === 'center'
            ? (line.box.width - heading.box.width) / 2
            : line.box.width - heading.box.width;

        expect(heading.box.x - line.box.x).toBeCloseTo(expectedLeading, 5);
        expect(fill.box.x + fill.box.width).toBeCloseTo(rightEdge, 5);
        expect(lineBreak.box.x).toBeCloseTo(rightEdge, 5);
      }
    });
  }

  test('scaled wavy fill clips in an untransformed box without trimming vertical ink', () => {
    const scaledProps =
      '<w:rFonts w:ascii="SimSun" w:eastAsia="SimSun"/><w:sz w:val="36"/>' +
      '<w:b/><w:w w:val="200"/><w:u w:val="wave"/>';
    const layout = layoutOf(
      `<w:p><w:pPr><w:spacing w:line="360" w:lineRule="exact"/></w:pPr>` +
        `<w:r><w:rPr>${scaledProps}</w:rPr><w:t>${HEADING}</w:t></w:r>` +
        `<w:r><w:rPr>${scaledProps}</w:rPr><w:t xml:space="preserve">${FULL_WIDTH_FILL}</w:t></w:r>` +
        '</w:p>'
    );
    expect(linesOf(layout)).toHaveLength(1);

    const container = document.createElement('div');
    paintSemanticLayout(container, layout, { scale: 1 });
    const fill = [...container.querySelectorAll<HTMLElement>('[data-start]')].at(-1)!;
    const glyph = fill.querySelector<HTMLElement>('[data-docx-clipped-fill]')!;
    expect(fill.style.transform).toBe('');
    expect(fill.style.clipPath).toContain('-1em');
    expect(glyph.style.transform).toBe('scaleX(2)');
    expect(glyph.style.textDecorationStyle).toBe('wavy');
  });

  test('a long trailing ASCII-space run is handled in linear time', () => {
    const spaces = ' '.repeat(50_000);
    const part = load(
      `<w:p><w:r><w:t>x</w:t></w:r>` + `<w:r><w:t xml:space="preserve">${spaces}</w:t></w:r></w:p>`
    );
    const started = performance.now();
    const layout = layoutSemanticDocument(part, 1, { measurer: MEASURER, geometry: GEOMETRY });
    const elapsed = performance.now() - started;

    expect(linesOf(layout)).toHaveLength(1);
    expect(elapsed).toBeLessThan(2_000);
  });

  for (const [kind, wrapper, textElement, decoration] of [
    ['insert', 'ins', 't', 'underline'],
    ['delete', 'del', 'delText', 'line-through'],
  ] as const) {
    test(`scaled clipped ${kind} fill keeps its tracked-change decoration`, () => {
      const scaledProps =
        '<w:rFonts w:ascii="SimSun" w:eastAsia="SimSun"/><w:sz w:val="36"/>' + '<w:w w:val="200"/>';
      const layout = layoutSemanticDocument(
        load(
          `<w:p><w:r><w:rPr>${scaledProps}</w:rPr><w:t>${HEADING}</w:t></w:r>` +
            `<w:${wrapper} w:id="1" w:author="QA"><w:r><w:rPr>${scaledProps}</w:rPr>` +
            `<w:${textElement} xml:space="preserve">${FULL_WIDTH_FILL}</w:${textElement}>` +
            `</w:r></w:${wrapper}></w:p>`
        ),
        1,
        { measurer: MEASURER, geometry: GEOMETRY, displayMode: 'all-markup' }
      );
      const container = document.createElement('div');
      paintSemanticLayout(container, layout, { scale: 1 });
      const tracked = container.querySelector<HTMLElement>(`[data-revision-kind="${kind}"]`)!;
      const glyph = tracked.querySelector<HTMLElement>('[data-docx-clipped-fill]')!;

      expect(tracked.style.textDecorationLine).toBe('');
      expect(glyph.style.textDecorationLine).toBe(decoration);
    });
  }

  test('underscore tab leaders use the active paragraph font metrics', () => {
    const layout = layoutOf(
      `<w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="3600" w:leader="underscore"/></w:tabs>` +
        `<w:rPr>${RUN_PROPS}</w:rPr></w:pPr>` +
        `<w:r><w:rPr>${RUN_PROPS}</w:rPr><w:t>${HEADING}</w:t></w:r>` +
        `<w:r><w:rPr>${RUN_PROPS}</w:rPr><w:tab/></w:r></w:p>`
    );
    const lines = linesOf(layout);
    expect(lines).toHaveLength(1);
    const tab = lines[0]!.spans.find((span) => span.text === '\t')!;
    expect(tab.tabLeader).toBe('underscore');
    expect(tab.tabLeaderAdvancePt).toBe(MEASURER.measure('_', tab.style));

    const container = document.createElement('div');
    paintSemanticLayout(container, layout, { scale: 1 });
    const leader = container.querySelector<HTMLElement>('[data-docx-tab-leader]')!;
    const glyphs = leader.firstElementChild as HTMLElement;
    const tabRun = [...container.querySelectorAll<HTMLElement>('.layout-run-text')].find(
      (element) => element.textContent === '\t'
    )!;
    expect(glyphs.style.fontFamily).toContain('SimSun');
    expect(glyphs.style.fontSize).toBe('18px');
    expect(glyphs.style.fontWeight).toBe('bold');
    expect(tabRun.dataset.docxTabUnderline).toBeUndefined();
    expect(tabRun.style.borderBottomStyle).toBe('');
  });

  test('an opaque tab highlight does not hide the underscore leader', () => {
    const highlightedProps = `${RUN_PROPS}<w:highlight w:val="yellow"/>`;
    const layout = layoutOf(
      `<w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="3600" w:leader="underscore"/></w:tabs></w:pPr>` +
        `<w:r><w:rPr>${RUN_PROPS}</w:rPr><w:t>${HEADING}</w:t></w:r>` +
        `<w:r><w:rPr>${highlightedProps}</w:rPr><w:tab/></w:r></w:p>`
    );
    const container = document.createElement('div');
    paintSemanticLayout(container, layout, { scale: 1 });
    const leader = container.querySelector<HTMLElement>('[data-docx-tab-leader]')!;
    const tabRun = [...container.querySelectorAll<HTMLElement>('.layout-run-text')].find(
      (element) => element.textContent === '\t'
    )!;

    expect(tabRun.style.backgroundColor).not.toBe('');
    expect(tabRun.style.borderBottomStyle).toBe('');
    expect(leader.style.zIndex).toBe('1');
  });
});
