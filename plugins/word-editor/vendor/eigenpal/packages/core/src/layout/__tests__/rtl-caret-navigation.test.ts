import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { caretStops, moveCaret, documentOrder, wordBoundary } from '../semantic-interaction.ts';
const measurer = createFixedMeasurer(6, 14);
function layout(texts: string[], width = 120, rtl = true, merged = false) {
  const paragraphs = texts
    .map(
      (text, index) =>
        `<w:p><w:pPr>${rtl ? '<w:bidi/>' : ''}${merged && index === 0 ? '<w:rPr><w:del w:id="1" w:author="Reviewer"/></w:rPr>' : ''}</w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`
    )
    .join('');
  const part = readOoxmlPart(
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!part.ok) throw Error(part.reason);
  return layoutSemanticDocument(part.part, 0, {
    measurer,
    ...(merged ? { displayMode: 'proposed' as const } : {}),
    geometry: { width, height: 300, margin: { left: 0, right: 0, top: 0, bottom: 0 } },
  });
}
for (const explicit of [false, true]) {
  test(`RTL arrows move physically and Home/End reach visual edges (explicit=${explicit})`, () => {
    const doc = layout(['אבג']);
    const stops = caretStops(doc, measurer);
    const position = { paragraphId: documentOrder(doc)[0]!, offset: 1 };
    const options = {
      measurer,
      ...(explicit ? { stops: stops.map((stop) => ({ ...stop })) } : {}),
    };
    expect(moveCaret(doc, position, 'left', null, options)?.position.offset).toBe(2);
    expect(moveCaret(doc, position, 'right', null, options)?.position.offset).toBe(0);
    expect(moveCaret(doc, position, 'lineStart', null, options)?.position.offset).toBe(0);
    expect(moveCaret(doc, position, 'lineEnd', null, options)?.position.offset).toBe(3);
  });
  test(`mixed runs follow physical stops within the line (explicit=${explicit})`, () => {
    const doc = layout(['אבג ABC דהו']);
    const stops = caretStops(doc, measurer);
    const options = { measurer, ...(explicit ? { stops } : {}) };
    for (const stop of stops)
      for (const [command, sign] of [
        ['left', -1],
        ['right', 1],
        ['wordLeft', -1],
        ['wordRight', 1],
      ] as const) {
        const target = moveCaret(doc, stop.position, command, null, options)!.position;
        const next = stops.find(
          (s) =>
            s.position.paragraphId === target.paragraphId && s.position.offset === target.offset
        )!;
        expect((next.x - stop.x) * sign).toBeGreaterThanOrEqual(0);
      }
  });
  test(`RTL line and paragraph boundaries follow reading order (explicit=${explicit})`, () => {
    const doc = layout(['אבג דהו', 'זחט'], 24);
    const stops = caretStops(doc, measurer);
    const options = { measurer, ...(explicit ? { stops } : {}) };
    const firstId = documentOrder(doc)[0]!;
    const firstLine = stops.filter((s) => s.lineId === stops[0]!.lineId);
    const left = firstLine.reduce((a, b) => (a.x < b.x ? a : b));
    const next = moveCaret(doc, left.position, 'left', null, options)!.position;
    expect(
      stops.find(
        (s) => s.position.paragraphId === next.paragraphId && s.position.offset === next.offset
      )!.lineId
    ).not.toBe(left.lineId);
    expect(
      moveCaret(doc, { paragraphId: firstId, offset: 7 }, 'left', null, options)!.position
    ).toEqual({ paragraphId: documentOrder(doc)[1]!, offset: 0 });
    expect(
      moveCaret(doc, { paragraphId: documentOrder(doc)[1]!, offset: 0 }, 'right', null, options)!
        .position
    ).toEqual({ paragraphId: firstId, offset: 7 });
  });
  test(`RTL word arrows reverse logical direction without changing word deletion boundaries (explicit=${explicit})`, () => {
    const doc = layout(['אבג דהו']);
    const stops = caretStops(doc, measurer);
    const options = { measurer, ...(explicit ? { stops } : {}) };
    const position = { paragraphId: documentOrder(doc)[0]!, offset: 1 };
    expect(moveCaret(doc, position, 'wordLeft', null, options)?.position.offset).toBe(
      wordBoundary('אבג דהו', 1, 1)
    );
    expect(moveCaret(doc, position, 'wordRight', null, options)?.position.offset).toBe(
      wordBoundary('אבג דהו', 1, -1)
    );
    expect(wordBoundary('אבג דהו', 1, -1)).toBe(0);
  });
}

test.each([true, false])(
  'arrows keep physical direction across mixed scripts with RTL base=%s',
  (rtl) => {
    for (const text of ['ABC אבג DEF', 'אבג ABC דהו', 'אבג', 'ABC']) {
      const doc = layout([text], 120, rtl);
      const stops = caretStops(doc, measurer);
      for (const stop of stops)
        for (const [command, sign] of [
          ['left', -1],
          ['right', 1],
          ['wordLeft', -1],
          ['wordRight', 1],
        ] as const) {
          const target = moveCaret(doc, stop.position, command, null, { measurer })!.position;
          const found = stops.find((next) => next.position.offset === target.offset)!;
          expect((found.x - stop.x) * sign).toBeGreaterThanOrEqual(0);
        }
    }
  }
);

test('cloned explicit stops resolve hidden RTL interiors toward the physical neighbour', () => {
  const doc = layout(['אבגדה']);
  const stops = caretStops(doc, measurer)
    .filter((stop) => stop.position.offset !== 2)
    .map((stop) => ({ ...stop }));
  const position = { paragraphId: documentOrder(doc)[0]!, offset: 2 };
  expect(moveCaret(doc, position, 'left', null, { stops, measurer })!.position.offset).toBe(3);
  expect(moveCaret(doc, position, 'right', null, { stops, measurer })!.position.offset).toBe(1);
});

test.each([false, true])(
  'empty RTL paragraphs cross boundaries in reading order (explicit=%s)',
  (explicit) => {
    const doc = layout(['אבג', '', 'דהו']);
    const order = documentOrder(doc);
    const position = { paragraphId: order[1]!, offset: 0 };
    const options = {
      measurer,
      ...(explicit ? { stops: caretStops(doc, measurer).map((stop) => ({ ...stop })) } : {}),
    };
    expect(moveCaret(doc, position, 'left', null, options)!.position).toEqual({
      paragraphId: order[2]!,
      offset: 0,
    });
    expect(moveCaret(doc, position, 'right', null, options)!.position).toEqual({
      paragraphId: order[0]!,
      offset: 3,
    });
  }
);

test.each(['אבג ABC', 'ABC אבג'])(
  'RTL Home/End go to the logical line edges in mixed text %s',
  (text) => {
    // Home and End are logical: the first and last character of the line in reading order,
    // wherever bidi reordering paints them.
    const doc = layout([text]);
    const stops = caretStops(doc, measurer);
    const position = stops[1]!.position;
    for (const options of [{ measurer }, { measurer, stops: stops.map((stop) => ({ ...stop })) }]) {
      expect(moveCaret(doc, position, 'lineStart', null, options)!.position.offset).toBe(0);
      expect(moveCaret(doc, position, 'lineEnd', null, options)!.position.offset).toBe(text.length);
    }
  }
);

test.each(['שָׁלוֹם', 'שָׁלָם', 'مَرْحَبًا', 'عَالَم'])(
  'word arrows consume marked graphemes as one word: %s',
  (word) => {
    const doc = layout([`${word} עולם`], 240);
    const stops = caretStops(doc, measurer);
    const paragraphId = documentOrder(doc)[0]!;
    for (const options of [{ measurer }, { measurer, stops }]) {
      expect(
        moveCaret(doc, { paragraphId, offset: 0 }, 'wordLeft', null, options)!.position.offset
      ).toBe(word.length);
      expect(
        moveCaret(doc, { paragraphId, offset: word.length }, 'wordRight', null, options)!.position
          .offset
      ).toBe(0);
    }
  }
);

test('merged members share physical navigation and preserve wrapped stop ownership', () => {
  for (const rtl of [true, false])
    for (const width of [55, 180])
      for (const words of [
        ['مرحبا', 'عالمعالم'],
        ['ABC אבג DEF', 'عالم XYZ عالم'],
        ['שָׁלוֹם עולם', 'مَرْحَبًا عَالَم'],
      ]) {
        const doc = layout(words, width, rtl, true);
        const stops = caretStops(doc, measurer);
        const cloned = stops.map((stop) => ({ ...stop }));
        expect(
          new Set(stops.map((stop) => `${stop.position.paragraphId}:${stop.position.offset}`)).size
        ).toBe(stops.length);
        for (const stop of stops)
          for (const command of [
            'left',
            'right',
            'wordLeft',
            'wordRight',
            'lineStart',
            'lineEnd',
          ] as const)
            expect(moveCaret(doc, stop.position, command, null, { measurer })?.position).toEqual(
              moveCaret(doc, stop.position, command, null, { measurer, stops: cloned })?.position
            );
      }
  const doc = layout(['مرحبا', 'عالمعالم'], 180, true, true);
  const order = documentOrder(doc);
  expect(
    moveCaret(doc, { paragraphId: order[0]!, offset: 0 }, 'right', null, { measurer })!.position
  ).toEqual({ paragraphId: order[0]!, offset: 0 });
  expect(
    moveCaret(doc, { paragraphId: order[0]!, offset: 5 }, 'left', null, { measurer })!.position
  ).toEqual({ paragraphId: order[1]!, offset: 0 });
});
