import { describe, expect, test } from 'bun:test';
import {
  chartColorGrid,
  chartColorLabel,
  chartColorOfPick,
  chartColorPickOf,
  chartColorPicks,
  chartPaneCommand,
  chartPaneDraftContinues,
  chartPaneDraftKey,
  chartPickHex,
  chartRowFocusAfterRemove,
  chartThemeHexes,
  chartTitleCommand,
  chartTypeChangeNote,
  nextChartCategoryLabel,
  parseChartValue,
} from '../chart-pane.ts';
import type { ChartData, ChartFormat } from '../../contracts/chart.ts';

const DATA: ChartData = {
  kind: 'category',
  workbook: 'embedded',
  categories: [{ label: 'A' }, { label: 'B' }],
  series: [
    { name: 'S1', values: [1, 2] },
    { name: 'S2', values: [3, null] },
  ],
} as unknown as ChartData;

const FORMAT = {
  type: 'columnClustered',
  title: null,
  legend: 'right',
  dataLabels: false,
  axes: true,
  gridlines: true,
  axisTitles: { category: null, value: null },
  colorsBy: 'series',
  colors: [],
} as unknown as ChartFormat;

const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key}(${Object.values(params).join(',')})` : key;

describe('chart pane', () => {
  test('a typed value becomes one setChartData command, and bad text is refused', () => {
    const ok = chartPaneCommand('d1', DATA, { type: 'value', series: 1, category: 1, text: '4,5' });
    expect(ok.ok).toBe(true);
    if (ok.ok && ok.command.type === 'setChartData')
      expect(ok.command.data.series[1]!.values).toEqual([3, 4.5]);
    expect(
      chartPaneCommand('d1', DATA, { type: 'value', series: 0, category: 0, text: 'x' })
    ).toEqual({ ok: false, error: 'chart.data.fieldErrors.number' });
    expect(parseChartValue('')).toBeNull();
  });

  test('adds and removes keep the grid square and refuse the last row', () => {
    const added = chartPaneCommand('d1', DATA, { type: 'addCategory', label: 'C' });
    if (!added.ok || added.command.type !== 'setChartData') throw new Error('no command');
    expect(added.command.data.series.map((s) => s.values.length)).toEqual([3, 3]);
    const one = { ...DATA, categories: [{ label: 'A' }] } as ChartData;
    expect(chartPaneCommand('d1', one, { type: 'removeCategory', category: 0 }).ok).toBe(false);
  });

  test('a removed row hands the focus to the next row, or the new last one', () => {
    expect(chartRowFocusAfterRemove(0, 3)).toBe(0);
    expect(chartRowFocusAfterRemove(2, 3)).toBe(1);
  });

  test('scatter X values must be numbers and the next one counts up', () => {
    const xy = { ...DATA, kind: 'xy', categories: [{ label: '1' }, { label: '4' }] } as ChartData;
    expect(nextChartCategoryLabel(xy, 'fallback')).toBe('5');
    expect(chartPaneCommand('d1', xy, { type: 'label', category: 0, text: 'x' })).toEqual({
      ok: false,
      error: 'chart.data.fieldErrors.xNumber',
    });
  });

  test('field text survives an append but not a rename', () => {
    const before = chartPaneDraftKey('d1', DATA);
    const appended = chartPaneDraftKey('d1', {
      ...DATA,
      categories: [...DATA.categories, { label: 'C' }],
    });
    const renamed = chartPaneDraftKey('d1', {
      ...DATA,
      categories: [{ label: 'Z' }, { label: 'B' }],
    });
    expect(chartPaneDraftContinues(before, appended)).toBe(true);
    expect(chartPaneDraftContinues(before, renamed)).toBe(false);
  });

  test('an empty title turns the title off, and an unchanged one sends nothing', () => {
    expect(chartTitleCommand('d1', FORMAT, 'title', '  ')).toBeNull();
    expect(chartTitleCommand('d1', { ...FORMAT, title: 'T' }, 'title', '')).toEqual({
      type: 'setChartFormat',
      drawingNodeId: 'd1',
      format: { title: null },
    });
  });

  test('a type change that drops the axis titles says so', () => {
    const titled = { ...FORMAT, axisTitles: { category: 'X', value: null } } as ChartFormat;
    const pie = { ...FORMAT, type: 'pie', axes: null, axisTitles: null } as unknown as ChartFormat;
    expect(chartTypeChangeNote(titled, pie)).toBe('chart.format.typeChangeRemoved');
    expect(chartTypeChangeNote(FORMAT, pie)).toBeNull();
  });

  test('colors round-trip through picks and name themselves', () => {
    expect(chartColorOfPick(chartColorPickOf({ theme: 'accent1', shift: 40 }))).toEqual({
      theme: 'accent1',
      shift: 40,
    });
    expect(chartColorOfPick('auto')).toBeNull();
    expect(chartColorLabel('#7030A0', t)).toBe('colorPicker.colors.purple');
    expect(chartColorLabel('accent2:-25', t)).toBe(
      'chart.format.colorDarker(colorPicker.theme.accent2,25)'
    );
    expect(chartColorPicks('accent1')).not.toContain('#7030A0');
    expect(chartColorPicks('#7030A0')).toContain('#7030A0');
  });

  test('swatches paint the lumMod and lumOff that the chart part gets', () => {
    const hexes = chartThemeHexes(undefined);
    expect(chartPickHex('accent1', hexes)).toBe('#4472C4');
    // Lighter 80% of 4472C4 is DAE3F3 (lumMod 20%, lumOff 80%).
    expect(chartPickHex('accent1:80', hexes)).toBe('#DAE3F3');
    // Darker 50% of 4472C4 is 203864 (lumMod 50%).
    expect(chartPickHex('accent1:-50', hexes)).toBe('#203864');
    const grid = chartColorGrid(hexes);
    expect(grid.theme).toHaveLength(6);
    expect(grid.theme.every((row) => row.length === 10)).toBe(true);
  });

  test('file color text that is not six hex digits never reaches a style', () => {
    expect(chartPickHex('#12345G' as never, chartThemeHexes(undefined))).toBe('#000000');
    expect(chartThemeHexes([{ hex: 'url(x)' }])).toHaveLength(10);
    expect(chartThemeHexes(Array.from({ length: 10 }, () => ({ hex: 'red;x' })))[0]).toBe('FFFFFF');
  });
});
