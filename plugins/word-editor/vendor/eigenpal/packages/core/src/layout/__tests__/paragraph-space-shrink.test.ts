import { expect, test } from 'bun:test';
import { loadBody } from './float-over-table-harness.ts';
import { createLayoutSession, layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf } from '../semantic-records.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import type { PendingLine } from '../pending-line.ts';
import type { TextMeasurer } from '../semantic-records.ts';
import { anyShrunk, shrunkBy } from './shrunk-space.ts';
const measurer: TextMeasurer = {
  measure(text, style) {
    return [...text].reduce(
      (n, c) => n + (c === ' ' ? 4 + (style.shaping?.wordSpacingPt ?? 0) : 10),
      0
    );
  },
  lineMetrics() {
    return { height: 14, baseline: 11 };
  },
};
const source = (alignment = 'both', text = 'aa bb cc dd', width = 66) =>
  loadBody(
    `<w:p><w:pPr><w:jc w:val="${alignment}"/></w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="${(width + 50) * 20}" w:h="6000"/><w:pgMar w:left="500" w:right="500" w:top="500" w:bottom="500"/></w:sectPr>`
  );
const content = (layout: ReturnType<typeof layoutSemanticDocument>) =>
  linesOf(layout).map((l) =>
    l.spans
      .map((s) => s.text)
      .join('')
      .trimEnd()
  );

test('modern justified flow compresses spaces, preserving letters and measurable span widths', () => {
  const result = layoutSemanticDocument(source(), 1, { measurer, compatibilityMode: 15 });
  expect(content(result)).toEqual(['aa bb cc', 'dd']);
  const spans = linesOf(result)[0]!.spans;
  expect(shrunkBy(spans, 0)).toBeCloseTo(1, 6);
  expect(shrunkBy(spans, 1)).toBeCloseTo(1, 6);
  for (const span of spans)
    expect(measurer.measure(span.text, span.style)).toBeCloseTo(span.box.width, 6);
  expect(spans[1]!.box.x).toBeCloseTo(spans[0]!.box.x + spans[0]!.box.width - 1, 6);
  expect(anyShrunk(linesOf(result)[1]!.spans)).toBe(false);
});

test('Cyrillic justified text compresses its spaces like Latin text', () => {
  const result = layoutSemanticDocument(source('both', 'аа бб вв гг'), 1, {
    measurer,
    compatibilityMode: 15,
  });
  expect(content(result)).toEqual(['аа бб вв', 'гг']);
  expect(shrunkBy(linesOf(result)[0]!.spans, 0)).toBeCloseTo(1, 6);
});

test('a space before a zero-width space lends its shrink like a plain space', () => {
  // U+200B takes no width, as in a shaped font.
  const zeroWidth: TextMeasurer = {
    ...measurer,
    measure: (text, style) => measurer.measure(text.replace(/\u200b/gu, ''), style),
  };
  const spaced = layoutSemanticDocument(source('both', 'aa \u200bbb \u200bcc \u200bdd'), 1, {
    measurer: zeroWidth,
    compatibilityMode: 15,
  });
  expect(content(spaced).map((line) => line.replace(/\u200b/gu, '').trimEnd())).toEqual([
    'aa bb cc',
    'dd',
  ]);
  expect(anyShrunk(linesOf(spaced)[0]!.spans)).toBe(true);
});

test('legacy, unspecified compatibility, and left alignment preserve existing wrapping', () => {
  for (const compatibilityMode of [undefined, 14])
    expect(content(layoutSemanticDocument(source(), 1, { measurer, compatibilityMode }))).toEqual([
      'aa bb',
      'cc dd',
    ]);
  expect(
    content(layoutSemanticDocument(source('left'), 1, { measurer, compatibilityMode: 15 }))
  ).toEqual(['aa bb', 'cc dd']);
});

test('compatibility changes invalidate retained paragraph layout', () => {
  const body = source(),
    session = createLayoutSession(),
    cache = createParagraphLayoutCache<readonly PendingLine[]>();
  const options = { measurer, session, cache, producer: 'space-test' };
  expect(content(layoutSemanticDocument(body, 1, { ...options, compatibilityMode: 14 }))).toEqual([
    'aa bb',
    'cc dd',
  ]);
  expect(content(layoutSemanticDocument(body, 2, { ...options, compatibilityMode: 15 }))).toEqual([
    'aa bb cc',
    'dd',
  ]);
  expect(content(layoutSemanticDocument(body, 3, { ...options, compatibilityMode: 14 }))).toEqual([
    'aa bb',
    'cc dd',
  ]);
});

test('space floor and weighted expansion prevent greedy extra words', () => {
  expect(
    content(
      layoutSemanticDocument(source('both', 'aa bb cc dd', 65), 1, {
        measurer,
        compatibilityMode: 15,
      })
    )
  ).toEqual(['aa bb', 'cc dd']);
  const text = Array(10).fill('aa').join(' ') + ' b cc';
  const result = layoutSemanticDocument(source('both', text, 241), 1, {
    measurer,
    compatibilityMode: 15,
  });
  expect(content(result)[0]).toBe(Array(10).fill('aa').join(' '));
});

// A quoted bold term or a stray closing mark leaves its word split across source runs,
// so the overflow lands on a piece that continues the word instead of opening one.
const seamSource = (runs: readonly string[], boldIndex = -1, width = 66) =>
  loadBody(
    `<w:p><w:pPr><w:jc w:val="both"/></w:pPr>${runs
      .map(
        (text, index) =>
          `<w:r>${index === boldIndex ? '<w:rPr><w:b/></w:rPr>' : ''}` +
          `<w:t xml:space="preserve">${text}</w:t></w:r>`
      )
      .join('')}</w:p><w:sectPr><w:pgSz w:w="${(width + 50) * 20}" w:h="6000"/>` +
      `<w:pgMar w:left="500" w:right="500" w:top="500" w:bottom="500"/></w:sectPr>`
  );

test('a word split across source runs borrows the same inter-word space', () => {
  for (const [runs, boldIndex] of [
    [['aa bb c', 'c dd'], -1],
    [['aa bb ', 'c', 'c dd'], 1],
  ] as const) {
    const result = layoutSemanticDocument(seamSource(runs, boldIndex), 1, {
      measurer,
      compatibilityMode: 15,
    });
    expect(content(result)).toEqual(['aa bb cc', 'dd']);
    expect(shrunkBy(linesOf(result)[0]!.spans, 0)).toBeCloseTo(1, 6);
  }
  expect(
    content(
      layoutSemanticDocument(seamSource(['aa bb c', 'c dd']), 1, {
        measurer,
        compatibilityMode: 14,
      })
    )
  ).toEqual(['aa bb', 'cc dd']);
});

test('a seam does not lift the space floor for a split word', () => {
  expect(
    content(
      layoutSemanticDocument(seamSource(['aa bb c', 'c dd'], -1, 65), 1, {
        measurer,
        compatibilityMode: 15,
      })
    )
  ).toEqual(['aa bb', 'cc dd']);
});

// Modern justification is mode 15 and every newer mode. Gating on `=== 15` would put a
// document that declares 16 on the legacy path.
test('modes 16 and 17 justify exactly as mode 15 does', () => {
  const modern = content(layoutSemanticDocument(source(), 1, { measurer, compatibilityMode: 15 }));
  for (const compatibilityMode of [16, 17])
    expect(content(layoutSemanticDocument(source(), 1, { measurer, compatibilityMode }))).toEqual(
      modern
    );
});

// Producers often keep the space after a word in its own run (tracked edits, character
// spacing), and East Asian break rules split every word from its space. The word before
// that space is complete, so it borrows inter-word space like a same-run word.
test('a word whose space sits in the next run borrows inter-word space', () => {
  for (const runs of [
    ['aa bb cc', ' dd'],
    ['aa ', 'bb', ' ', 'cc', ' ', 'dd'],
  ]) {
    const result = layoutSemanticDocument(seamSource(runs), 1, {
      measurer,
      compatibilityMode: 15,
    });
    expect(content(result)).toEqual(['aa bb cc', 'dd']);
    const line = linesOf(result)[0]!;
    expect(line.spans.at(-1)!.box.x + line.spans.at(-1)!.box.width).toBeLessThanOrEqual(66.001);
    expect(anyShrunk(line.spans)).toBe(true);
    expect(
      content(layoutSemanticDocument(seamSource(runs), 1, { measurer, compatibilityMode: 14 }))
    ).toEqual(['aa bb', 'cc dd']);
  }
});

test('an East Asian language paragraph compresses Latin spaces the same way', () => {
  const body = loadBody(
    `<w:p><w:pPr><w:jc w:val="both"/></w:pPr><w:r><w:rPr><w:lang w:eastAsia="zh-CN"/></w:rPr>` +
      `<w:t>aa bb cc dd</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="2320" w:h="6000"/>` +
      `<w:pgMar w:left="500" w:right="500" w:top="500" w:bottom="500"/></w:sectPr>`
  );
  expect(content(layoutSemanticDocument(body, 1, { measurer, compatibilityMode: 15 }))).toEqual([
    'aa bb cc',
    'dd',
  ]);
});

// The paragraph's last word borrows space too: `paragraph-space-shrink-terminal.test.ts`.
test('a following run that continues the word gets no shrink', () => {
  expect(
    content(
      layoutSemanticDocument(seamSource(['aa bb cc', 'x dd']), 1, {
        measurer,
        compatibilityMode: 15,
      })
    )
  ).toEqual(['aa bb', 'ccx dd']);
});

// A double space split across runs: the word keeps its own space and the next run's
// space hangs after it. Both spaces hang, so the line still compresses to the measure.
test('a word with its own space and a hanging space run still compresses to the measure', () => {
  const result = layoutSemanticDocument(seamSource(['aa bb cc ', ' dd']), 1, {
    measurer,
    compatibilityMode: 15,
  });
  expect(content(result)).toEqual(['aa bb cc', 'dd']);
  const spans = linesOf(result)[0]!.spans;
  const cc = spans.find((s) => s.text.startsWith('cc'))!;
  expect(cc.box.x).toBeCloseTo(46, 6);
  expect(cc.box.x + measurer.measure('cc', cc.style)).toBeLessThanOrEqual(66.001);
  expect(shrunkBy(spans, spans.indexOf(cc))).toBe(0);
});

test('a hanging space run after a word with its own space does not shorten the stretch', () => {
  for (const compatibilityMode of [14, 15]) {
    const endOf = (runs: readonly string[]) => {
      const spans = linesOf(
        layoutSemanticDocument(seamSource(runs, -1, 72), 1, { measurer, compatibilityMode })
      )[0]!.spans;
      const cc = spans.find((s) => s.text.startsWith('cc'))!;
      return cc.box.x + measurer.measure('cc', cc.style);
    };
    expect(endOf(['aa bb cc ', ' dd'])).toBeCloseTo(endOf(['aa bb cc dd']), 6);
    expect(endOf(['aa bb cc ', '  dd'])).toBeCloseTo(endOf(['aa bb cc dd']), 6);
  }
});

test('a no-break space before a hanging space stays content in the stretch', () => {
  const lines = linesOf(
    layoutSemanticDocument(seamSource(['aa bb cc ', ' dd'], -1, 80), 1, {
      measurer,
      compatibilityMode: 15,
    })
  );
  expect(lines.length).toBe(2);
  const spans = lines[0]!.spans;
  const cc = spans.find((s) => s.text.startsWith('cc'))!;
  expect(cc.box.x + measurer.measure('cc ', cc.style) - spans[0]!.box.x).toBeCloseTo(80, 6);
});

// A field result is measured whole, so its leading space cannot hang at the line end.
// A word before it must not borrow space on the promise that the space will hang.
test('a space that opens a field result does not let the word before it compress', () => {
  const result = ' 1';
  for (const field of [
    `<w:fldSimple w:instr="PAGE"><w:r><w:t xml:space="preserve">${result}</w:t></w:r></w:fldSimple>`,
    `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> REF bm1 \\h </w:instrText></w:r>` +
      `<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t xml:space="preserve">${result}</w:t></w:r>` +
      `<w:r><w:fldChar w:fldCharType="end"/></w:r>`,
  ]) {
    const body = loadBody(
      `<w:p><w:pPr><w:jc w:val="both"/></w:pPr><w:r><w:t>aa bb cc</w:t></w:r>${field}` +
        `<w:r><w:t xml:space="preserve"> ee</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="2320" w:h="6000"/>` +
        `<w:pgMar w:left="500" w:right="500" w:top="500" w:bottom="500"/></w:sectPr>`
    );
    const lines = linesOf(layoutSemanticDocument(body, 1, { measurer, compatibilityMode: 15 }));
    const texts = lines.map((l) => l.spans.map((s) => s.text).join(''));
    expect(texts[0]!.trimEnd()).toBe('aa bb');
    for (const text of texts.slice(1)) expect(text.startsWith(' ')).toBe(false);
  }
});

// A no-break space joins its neighbours into one word with width; it neither breaks nor hangs.
test('a final word that ends with a no-break space borrows inter-word space', () => {
  const layout = (text: string, compatibilityMode: number) =>
    content(layoutSemanticDocument(source('both', text, 76), 1, { measurer, compatibilityMode }));
  expect(layout('aa bb cc\u00a0', 15)).toEqual(['aa bb cc']);
  expect(layout('aa bb cc\u00a0', 14)).toEqual(['aa bb', 'cc']);
  // The shrink budget still bounds the whole word, including text after the no-break space.
  expect(layout('aa bb cc\u00a0dd', 15)).toEqual(['aa bb', 'cc\u00a0dd']);
});

// Screen paint applies `word-spacing` to U+00A0 too, so a span holding one lends no space.
test('a no-break space inside an earlier word lends no inter-word space', () => {
  const lines = linesOf(
    layoutSemanticDocument(source('both', 'a\u00a0a bb cc', 76), 1, {
      measurer,
      compatibilityMode: 15,
    })
  );
  expect(
    lines.map((line) =>
      line.spans
        .map((span) => span.text)
        .join('')
        .trimEnd()
    )
  ).toEqual(['a\u00a0a bb', 'cc']);
});

// Only the text after a line's last tab is justified, so only its spaces can shrink.
test('spaces after a tab borrow space, and the tab keeps its stop', () => {
  const layout = (text: string) =>
    linesOf(
      layoutSemanticDocument(source('both', text, 102), 1, { measurer, compatibilityMode: 15 })
    );
  // `aa` ends at 20, the tab reaches the 36pt default stop, and `bb cc dd` needs 68 more.
  const lines = layout('aa\tbb cc dd');
  expect(lines.map((line) => line.spans.map((span) => span.text).join(''))).toEqual([
    'aa\tbb cc dd',
  ]);
  const bb = lines[0]!.spans.find((span) => span.text.startsWith('bb'))!;
  expect(bb.box.x - lines[0]!.spans[0]!.box.x).toBeCloseTo(36, 6);
  // A space before the tab is not justified, so it cannot make the room.
  expect(
    layout('a a\tbb cc dd ee').map((line) => line.spans.map((span) => span.text).join(''))
  ).toHaveLength(2);
});

test('text after a center tab is placed against its stop, not compressed', () => {
  const body = loadBody(
    '<w:p><w:pPr><w:jc w:val="both"/><w:tabs><w:tab w:val="center" w:pos="1200"/></w:tabs></w:pPr>' +
      '<w:r><w:t xml:space="preserve">aa\tbb cc dd</w:t></w:r></w:p>' +
      '<w:sectPr><w:pgSz w:w="2840" w:h="6000"/>' +
      '<w:pgMar w:left="500" w:right="500" w:top="500" w:bottom="500"/></w:sectPr>'
  );
  // Centred at 60, `bb cc dd` would end at 94, past the 92pt measure.
  expect(
    content(layoutSemanticDocument(body, 1, { measurer, compatibilityMode: 15 }))
  ).toHaveLength(2);
});

const justifiedLines = (text: string, width: number) =>
  content(
    layoutSemanticDocument(source('both', text, width), 1, { measurer, compatibilityMode: 15 })
  );

test('a word joins the line when each space shrinks by at most half the stretch', () => {
  const words = (count: number) => Array(count).fill('aa').join(' ');
  // Each space would shrink by 0.22 of its width or stretch by 0.48: the word joins.
  expect(justifiedLines(`${words(13)} bbb cc`, 330.35)[0]).toBe(`${words(13)} bbb`);
  // Each space would shrink by 0.07 or stretch by only 0.12: the line stretches.
  expect(justifiedLines(`${words(18)} b cc`, 437.05)[0]).toBe(words(18));
});

test('a hyphen-break fragment borrows inter-word space', () => {
  expect(justifiedLines('aa aa aa aa aa-bb cc', 124)[0]).toBe('aa aa aa aa aa-');
});

test('a word with a currency sign lends its space', () => {
  // The fit needs all four spaces' shrink, including the one after `$a`.
  expect(justifiedLines('$a aa aa aa bb cc', 112)[0]).toBe('$a aa aa aa bb');
});

test('every space after the last word hangs on the shorter line', () => {
  // A run that opens with a space after a word that already has one, as around hidden
  // deleted text: both spaces hang on the shorter line, so ten words stretch nine gaps.
  const words = Array(10).fill('aa').join(' ');
  const result = layoutSemanticDocument(seamSource([`${words} `, ' bb cc'], -1, 254), 1, {
    measurer,
    compatibilityMode: 15,
  });
  expect(content(result)[0]).toBe(`${words}  bb`);
});
