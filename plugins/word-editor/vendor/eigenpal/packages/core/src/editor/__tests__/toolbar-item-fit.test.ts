import { describe, expect, test } from 'bun:test';
import {
  sameItemOverflow,
  toolbarItemKey,
  toolbarOverflowItems,
  toolbarShownCount,
  type ToolbarFitGroup,
  type ToolbarItemOverflow,
} from '../toolbar-item-fit.ts';

/** Every control 30 px wide, a 2 px gap, and a 14 px separator slot per group. */
const GROUPS: readonly ToolbarFitGroup[] = [
  { id: 'history', items: ['undo', 'redo'] },
  { id: 'text', items: ['bold', 'italic', 'underline', 'strike'] },
  { id: 'zoom', items: ['level'] },
];
const ORDER = ['zoom', 'text', 'history'];
const GAP = 2;
const SEPARATOR = 14;
const MORE = 34;

function fit(
  available: number,
  options: {
    previous?: ToolbarItemOverflow;
    widths?: Record<string, number>;
    fixed?: number;
  } = {}
): ToolbarItemOverflow {
  const itemWidths = new Map<string, number>();
  const groupBases = new Map<string, number>();
  for (const group of GROUPS) {
    groupBases.set(group.id, SEPARATOR);
    for (const item of group.items) {
      const key = toolbarItemKey(group.id, item);
      itemWidths.set(key, options.widths?.[`${group.id}.${item}`] ?? 30);
    }
  }
  return toolbarOverflowItems({
    available,
    groups: GROUPS,
    order: ORDER,
    itemWidths,
    groupBases,
    gap: GAP,
    fixed: options.fixed ?? 0,
    more: MORE,
    previous: options.previous,
  });
}

/** What the bar costs with these controls hidden: the inverse of the fit, for checks. */
function barWidth(overflow: ToolbarItemOverflow): number {
  let total = 0;
  for (const group of GROUPS) {
    const shown = toolbarShownCount(overflow, group.id, group.items.length);
    if (shown > 0) total += SEPARATOR + shown * 30 + (shown - 1) * GAP;
  }
  return overflow.size > 0 ? total + MORE : total;
}

// history 14+30+2+30 = 76, text 14+4*30+3*2 = 140, zoom 14+30 = 44: 260 in all.
const FULL = 260;

describe('toolbarOverflowItems', () => {
  test('all fit: nothing overflows', () => {
    expect(fit(FULL).size).toBe(0);
    expect(fit(1000).size).toBe(0);
  });

  test('an unmeasured bar overflows nothing', () => {
    expect(fit(0).size).toBe(0);
    expect(fit(-5).size).toBe(0);
  });

  test('the first group in the collapse order leaves, with its separator', () => {
    // 1 px short: zoom (one control) leaves, and the trigger takes its place.
    const overflow = fit(FULL - 1);
    expect([...overflow]).toEqual([['zoom', 1]]);
    expect(barWidth(overflow)).toBeLessThanOrEqual(FULL - 1);
  });

  test('a group that partly fits keeps a prefix and loses controls from its end', () => {
    // Without zoom and with the trigger: 76 + 140 + 34 = 250. 20 px short of that drops
    // one text control (32 px with its gap), not the whole text group.
    const overflow = fit(230);
    expect(overflow.get('zoom')).toBe(1);
    expect(overflow.get('text')).toBe(1);
    expect(overflow.has('history')).toBe(false);
    expect(toolbarShownCount(overflow, 'text', 4)).toBe(3);
    expect(barWidth(overflow)).toBeLessThanOrEqual(230);
    // The bar is filled: one more control would not fit.
    expect(barWidth(new Map([['zoom', 1]])) > 230).toBe(true);
  });

  test('the next group only starts once the previous one is empty', () => {
    // 76 + 34 = 110 leaves exactly room for history alone.
    const overflow = fit(110);
    expect(overflow.get('zoom')).toBe(1);
    expect(overflow.get('text')).toBe(4);
    expect(overflow.has('history')).toBe(false);
    // One px less and history gives up its last control only.
    const tighter = fit(109);
    expect(tighter.get('text')).toBe(4);
    expect(tighter.get('history')).toBe(1);
    expect(toolbarShownCount(tighter, 'history', 2)).toBe(1);
  });

  test('none fit: every group is in the menu, so no separator is left standing', () => {
    const overflow = fit(10);
    expect(overflow.get('zoom')).toBe(1);
    expect(overflow.get('text')).toBe(4);
    expect(overflow.get('history')).toBe(2);
    // Every group empty: no group draws, so no separator draws either.
    for (const group of GROUPS) {
      expect(toolbarShownCount(overflow, group.id, group.items.length)).toBe(0);
    }
  });

  test('an emptied group frees its separator slot, not only its controls', () => {
    // Text emptied frees 140 (4 controls, 3 gaps, and the 14 px separator). With zoom and
    // text gone, history fits at 76 + 34 = 110 exactly. Without the separator credit the fit
    // would have taken a history control as well.
    expect(fit(110).has('history')).toBe(false);
  });

  test('fixed width is charged before anything collapses', () => {
    expect(fit(FULL, { fixed: 1 }).get('zoom')).toBe(1);
  });

  test('wide controls collapse on their measured widths', () => {
    // A 100 px strike button: dropping it alone recovers the 20 px.
    const widths = { 'text.strike': 100 };
    const overflow = fit(FULL + 70 - 20, { widths });
    expect(overflow.get('zoom')).toBe(1);
    expect(overflow.get('text')).toBe(1);
  });

  test('controls come back only past the hysteresis slack', () => {
    const narrow = fit(230);
    expect(narrow.get('text')).toBe(1);
    // At 255 px the strict fit would bring a control back; without a previous answer it does.
    expect(sameItemOverflow(fit(255), narrow)).toBe(false);
    // With the previous answer, the slack holds the bar as it was at this width.
    expect(sameItemOverflow(fit(255, { previous: narrow }), narrow)).toBe(true);
    // Room for the control and the slack brings it back.
    const wide = fit(282 + 24, { previous: narrow });
    expect(wide.size).toBe(0);
  });

  test('growing the overflow is immediate', () => {
    const narrow = fit(230);
    const narrower = fit(190, { previous: narrow });
    expect(narrower.get('text')).toBeGreaterThan(1);
  });

  test('a previous answer that names a group which left keeps nothing hidden', () => {
    // A contextual table group was in the menu; the caret left the table, so it is gone.
    // With 8 px to spare nothing collapses, slack or not.
    const previous = new Map([
      ['table', 1],
      ['zoom', 1],
    ]);
    expect(fit(FULL + 8, { previous }).size).toBe(0);
  });

  test('the slack never hides more than the previous answer did', () => {
    // The previous answer hid one text control. At full width the strict fit hides nothing,
    // and the fit at width minus the slack would hide more than one control. The previous
    // answer no longer fits either (it needs the trigger), so the strict answer wins.
    const previous = new Map([['text', 1]]);
    expect(fit(FULL, { previous }).size).toBe(0);
  });
});

describe('toolbarOverflowItems with uneven controls', () => {
  /** One group, three controls, the middle one drawing nothing. */
  function fitOne(available: number, gaps?: ReadonlyMap<string, number>): ToolbarItemOverflow {
    const widths = new Map([
      [toolbarItemKey('g', 'a'), 30],
      [toolbarItemKey('g', 'empty'), 0],
      [toolbarItemKey('g', 'b'), 30],
    ]);
    return toolbarOverflowItems({
      available,
      groups: [{ id: 'g', items: ['a', 'empty', 'b'] }],
      order: ['g'],
      itemWidths: widths,
      groupBases: new Map([['g', 0]]),
      gap: 10,
      ...(gaps ? { groupGaps: gaps } : {}),
      fixed: 0,
      more: 20,
    });
  }

  test('a control that draws nothing takes no gap and is never hidden alone', () => {
    // a + b + one gap = 70 fits; the empty control adds nothing.
    expect(fitOne(70).size).toBe(0);
    // 1 px short: b leaves. The empty control stays, drawing nothing; it never costs a step.
    expect(fitOne(69).get('g')).toBe(1);
    // Hiding b frees its width and its gap: a alone plus the trigger is 50.
    expect(fitOne(50).get('g')).toBe(1);
  });

  test('a group whose remaining controls draw nothing leaves whole', () => {
    // [empty, b]: hiding b would leave only the empty control and its separator standing.
    const answer = toolbarOverflowItems({
      available: 40,
      groups: [{ id: 'g', items: ['empty', 'b'] }],
      order: ['g'],
      itemWidths: new Map([
        [toolbarItemKey('g', 'empty'), 0],
        [toolbarItemKey('g', 'b'), 40],
      ]),
      groupBases: new Map([['g', 14]]),
      gap: 2,
      fixed: 0,
      more: 20,
    });
    expect(answer.get('g')).toBe(2);
  });

  test("a group's own gap counts instead of the bar's", () => {
    // With a 2 px group gap, a + b cost 62, so 62 fits where the bar's 10 px gap would not.
    expect(fitOne(62, new Map([['g', 2]])).size).toBe(0);
    expect(fitOne(62).size).toBe(1);
  });
});

describe('sameItemOverflow', () => {
  test('compares counts per group', () => {
    expect(sameItemOverflow(new Map([['a', 1]]), new Map([['a', 1]]))).toBe(true);
    expect(sameItemOverflow(new Map([['a', 1]]), new Map([['a', 2]]))).toBe(false);
    expect(sameItemOverflow(new Map([['a', 1]]), new Map([['b', 1]]))).toBe(false);
    expect(sameItemOverflow(new Map(), new Map([['a', 1]]))).toBe(false);
  });
});
