import { expect, test } from 'bun:test';
import { DEFAULT_RUN_STYLE } from '../run-style.ts';
import { createCjkOpticalFitter } from '../cjk-optical-fit.ts';
import { cjkParagraphBreaks } from '../cjk-paragraph-breaks.ts';
import { DEFAULT_CJK_TYPOGRAPHY } from '../cjk-typography.ts';
import type { FieldAwarePiece } from '../field-pieces.ts';
import type { PendingLine } from '../pending-line.ts';
import type { TextMeasurer } from '../semantic-records.ts';
// A prior supported printable ASCII opaque path must stay byte/advance intact.
test('plain ASCII mathematical tokens retain their existing external-outline seam instead of becoming new barriers', () => {
  for (const token of ['+', '=', '>=']) {
    const style = {
      ...DEFAULT_RUN_STYLE,
      fontFamily: 'EA',
      fontFamilyEastAsia: 'EA',
      fontSizePt: 12,
      kerningEnabled: true,
      kerningMinPt: 1,
    };
    const pid = 'synthetic-ascii-existing',
      texts = ['甲', '）', token, '乙'];
    let start = 0,
      x = 0,
      outlineCalls = 0;
    const pieces: FieldAwarePiece[] = texts.map((text) => {
      const from = start;
      start += text.length;
      return {
        text,
        start: from,
        end: start,
        props: [],
        style,
        ...(text === token ? {} : { fontSlot: 'eastAsia' as const }),
      };
    });
    const spans = pieces.slice(0, 3).map((p) => {
      const box = { x, y: 3, width: 12, height: 16 };
      x += 12;
      return {
        text: p.text,
        range: { paragraphId: pid, start: p.start, end: p.end },
        props: [],
        style,
        ...(p.fontSlot ? { fontSlot: p.fontSlot } : {}),
        box,
      };
    });
    const line: PendingLine = {
      spans,
      drawings: [],
      start: 0,
      end: pieces[2]!.end,
      width: 36,
      height: 16,
      baseline: 12,
      leading: 0,
      trailingSpacing: 0,
    };
    const m: TextMeasurer = {
      measure: (t) => t.length * 12,
      lineMetrics: () => ({ height: 16, baseline: 12 }),
      hasResolvedFont: () => true,
      inkBounds: (t) => (t === '）' ? { left: 2, right: 4 } : { left: 0.5, right: 11.5 }),
      textOutline: (t) => {
        expect(t).toBe(token);
        outlineCalls++;
        return { ink: { left: 0.5, right: 11.5 } } as never;
      },
    };
    const original = { ...spans[2]!, box: { ...spans[2]!.box } };
    const result = createCjkOpticalFitter(
      pieces,
      cjkParagraphBreaks(pieces, DEFAULT_CJK_TYPOGRAPHY),
      m,
      { hangingPunctuation: false, requireLocalQualification: true }
    )(
      line,
      3,
      '乙',
      { paragraphId: pid, start: pieces[3]!.start, end: pieces[3]!.end },
      12,
      36,
      46,
      true
    );
    expect(result).toBeDefined();
    expect(outlineCalls).toBe(1);
    expect(line.spans.find((s) => s.text === token)).toEqual({
      ...original,
      box: { ...original.box, x: 22 },
    });
    expect(line.spans[1]!.box.width).toBeCloseTo(10, 8);
    expect(line.width + result!.width).toBeCloseTo(46, 8);
  }
});
