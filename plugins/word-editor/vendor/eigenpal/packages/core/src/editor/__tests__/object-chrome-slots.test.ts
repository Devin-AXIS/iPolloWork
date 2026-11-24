// The `shape.*` and `chart.*` slots: one command table, one enabled state, and one current value
// for every place a host renders them, and the pane sections that the packaged panes arrange.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { BODY, THEME_XML, gapY, mount, pressAt, saved } from './shape-selection-fixture.ts';
import {
  CHROME_GROUPS,
  chromeSlotId,
  formattingBarChromeGroups,
  type ChromeSlotId,
} from '../chrome-controls.ts';
import {
  chromeSlotIsToggle,
  commandForSlotValue,
  runToolbarCommand,
  toolbarCommandState,
} from '../toolbar-commands.ts';
import { PANE_SECTIONS, paneSlots } from '../pane-sections.ts';
import { isObjectChromeSlot, objectSlotValue } from '../object-chrome-slots.ts';
import type { SelectedImageState } from '../../contracts/editor-image-state.ts';

const objectSlots = (groupId: 'shape' | 'chart'): ChromeSlotId[] =>
  CHROME_GROUPS.filter((g) => g.id === groupId).flatMap((g) =>
    g.controls.map((c) => chromeSlotId(g, c))
  );

describe('object slot registry', () => {
  test('the shape and chart groups are contextual, and every slot sits in exactly one pane section', () => {
    for (const id of ['shape', 'chart'] as const) {
      const group = CHROME_GROUPS.find((g) => g.id === id);
      expect(group && 'contextual' in group && group.contextual).toBe(true);
    }
    expect([...paneSlots('shape')].sort()).toEqual([...objectSlots('shape')].sort());
    expect([...paneSlots('chart')].sort()).toEqual([...objectSlots('chart')].sort());
    expect(PANE_SECTIONS.shape.map((section) => section.id)).toEqual(['fill', 'outline']);
    for (const slot of [...objectSlots('shape'), ...objectSlots('chart')])
      expect(isObjectChromeSlot(slot)).toBe(true);
    expect(chromeSlotIsToggle('chart.dataLabels')).toBe(true);
    expect(chromeSlotIsToggle('chart.legend')).toBe(false);
  });

  test('the formatting bar appends the toolbar controls of a selected object only when asked', () => {
    const image = { id: 'd1' } as SelectedImageState;
    const ids = (options: Parameters<typeof formattingBarChromeGroups>[1]) =>
      formattingBarChromeGroups(image, options).map((g) => g.id);
    expect(ids({})).not.toContain('shape');
    expect(ids({ shapeControls: true })).toContain('shape');
    const chart = formattingBarChromeGroups(image, { chartControls: true }).find(
      (g) => g.id === 'chart'
    );
    // Pane-only controls stay out of the bar; a host still places them by slot.
    expect(chart?.controls.map((c) => c.id)).toEqual(['type', 'title', 'legend', 'dataLabels']);
    const shape = formattingBarChromeGroups(image, { shapeControls: true }).find(
      (g) => g.id === 'shape'
    );
    expect(shape?.controls.map((c) => c.id)).toEqual([
      'fill',
      'outlineColor',
      'outlineWidth',
      'outlineDash',
    ]);
  });

  test('commandForSlotValue builds each object command and refuses values a slot does not take', () => {
    expect(commandForSlotValue('shape.fill', 'accent1:40')).toEqual({
      type: 'setShapeFill',
      color: { theme: 'accent1', shift: 40 },
    });
    expect(commandForSlotValue('shape.fill', 'none')).toEqual({
      type: 'setShapeFill',
      visible: false,
    });
    expect(commandForSlotValue('shape.outlineDash', 'sysDot')).toEqual({
      type: 'setShapeOutline',
      visible: true,
      dash: 'sysDot',
    });
    expect(commandForSlotValue('shape.outlineDash', 'wavy')).toBeNull();
    expect(commandForSlotValue('shape.fill', 'not a colour')).toBeNull();
    expect(commandForSlotValue('chart.title', '  ')).toEqual({
      type: 'setChartFormat',
      format: { title: null },
    });
    expect(commandForSlotValue('chart.valueAxisTitle', 'Units')).toEqual({
      type: 'setChartFormat',
      format: { valueAxisTitle: 'Units' },
    });
    expect(commandForSlotValue('chart.seriesColor', { index: 1, color: 'auto' })).toEqual({
      type: 'setChartColor',
      index: 1,
      color: null,
    });
    expect(commandForSlotValue('chart.legend', 'middle')).toBeNull();
    expect(commandForSlotValue('chart.type', 'columnClustered')).toEqual({
      type: 'setChartType',
      chartType: 'columnClustered',
    });
  });
});

describe('shape slots on a live editor', () => {
  test('state, value, and runs come from the selected shape; a dash saves as a:prstDash', async () => {
    const { editor, container } = await mount(BODY, undefined, undefined, THEME_XML);
    try {
      expect(toolbarCommandState(editor, 'shape.fill')).toMatchObject({
        enabled: false,
        disabledReason: 'this drawing has no fill or outline to set',
      });
      expect(runToolbarCommand(editor, 'shape.fill', 'accent1')).toMatchObject({
        ok: false,
        code: 'notFound',
      });
      pressAt(container, editor, 380, gapY(editor));
      expect(toolbarCommandState(editor, 'shape.outlineDash')).toMatchObject({
        enabled: true,
        value: 'solid',
      });
      expect(runToolbarCommand(editor, 'shape.fill', 'accent1')).toMatchObject({
        ok: true,
        changed: true,
      });
      expect(toolbarCommandState(editor, 'shape.fill').value).toBe('accent1');
      // The same pick again changes nothing and adds no undo step.
      expect(runToolbarCommand(editor, 'shape.fill', 'accent1')).toEqual({
        ok: true,
        changed: false,
      });
      expect(runToolbarCommand(editor, 'shape.outlineDash', 'dash')).toMatchObject({
        ok: true,
        changed: true,
      });
      expect(toolbarCommandState(editor, 'shape.outlineDash').value).toBe('dash');
      expect(await saved(editor)).toContain('<a:prstDash val="dash"/>');
      expect(runToolbarCommand(editor, 'shape.outlineWidth', 0.1)).toMatchObject({
        ok: false,
        reason: 'shape.pane.errors.width',
      });
      expect(runToolbarCommand(editor, 'shape.fill')).toMatchObject({
        ok: false,
        code: 'invalidArgs',
      });
      editor.exec({ type: 'undo' });
      expect(toolbarCommandState(editor, 'shape.outlineDash').value).toBe('solid');
      editor.exec({ type: 'setEditingMode', mode: 'viewing' });
      const viewing = toolbarCommandState(editor, 'shape.outlineColor');
      expect(viewing.enabled).toBe(false);
      expect(viewing.disabledReason).toBeTruthy();
      expect(runToolbarCommand(editor, 'shape.outlineColor', 'none')).toMatchObject({ ok: false });
    } finally {
      editor.destroy();
      container.remove();
    }
  });
});

describe('chart slots on a live editor', () => {
  test('a selected chart enables its slots; toggles flip, picks apply, and no axes refuse', async () => {
    const { editor, container } = await mount();
    try {
      expect(toolbarCommandState(editor, 'chart.title')).toMatchObject({
        enabled: false,
        disabledReason: 'chart.errors.noChart',
      });
      const surface = editor.surface!;
      const paragraphId = surface.session.paragraphIds()[0]!;
      surface.setSelection({
        anchor: { paragraphId, offset: 0 },
        head: { paragraphId, offset: 0 },
      });
      expect(editor.exec({ type: 'insertChart', chartType: 'columnClustered' })).toMatchObject({
        ok: true,
      });
      expect(editor.snapshot().chart).not.toBeNull();
      expect(toolbarCommandState(editor, 'chart.type')).toMatchObject({
        enabled: true,
        value: 'columnClustered',
      });
      expect(runToolbarCommand(editor, 'chart.title', 'Sales')).toMatchObject({ ok: true });
      expect(toolbarCommandState(editor, 'chart.title')).toMatchObject({
        value: 'Sales',
        active: true,
      });
      const labels = toolbarCommandState(editor, 'chart.dataLabels');
      expect(runToolbarCommand(editor, 'chart.dataLabels')).toMatchObject({ ok: true });
      expect(toolbarCommandState(editor, 'chart.dataLabels').active).toBe(!labels.active);
      expect(runToolbarCommand(editor, 'chart.legend', 'top')).toMatchObject({ ok: true });
      expect(toolbarCommandState(editor, 'chart.legend').value).toBe('top');
      expect(
        runToolbarCommand(editor, 'chart.seriesColor', { index: 0, color: 'accent2' })
      ).toMatchObject({ ok: true, changed: true });
      expect(
        runToolbarCommand(editor, 'chart.data', { type: 'addCategory', label: 'Extra' })
      ).toMatchObject({ ok: true });
      const data = editor.query({
        type: 'chartData',
        drawingNodeId: editor.snapshot().chart!.drawingNodeId,
      });
      expect(data.ok && data.data.categories.at(-1)?.label).toBe('Extra');
      expect(runToolbarCommand(editor, 'chart.type', 'pie')).toMatchObject({ ok: true });
      expect(toolbarCommandState(editor, 'chart.axes')).toMatchObject({
        enabled: false,
        disabledReason: 'chart.errors.noAxes',
      });
      expect(runToolbarCommand(editor, 'chart.gridlines', true)).toMatchObject({
        ok: false,
        reason: 'chart.errors.noAxes',
      });
    } finally {
      editor.destroy();
      container.remove();
    }
  });
});

test('a colour slot reads back a grid pick or none, never other text', () => {
  expect(objectSlotValue('shape.fill', 'accent1:40')).toBe('accent1:40');
  expect(objectSlotValue('shape.fill', '#4472C4')).toBe('#4472C4');
  expect(objectSlotValue('shape.outlineColor', 'none')).toBe('none');
  expect(objectSlotValue('shape.outlineColor', 'auto')).toBe('auto');
  expect(objectSlotValue('shape.fill', 'red')).toBeNull();
  expect(objectSlotValue('shape.fill', '4472C4')).toBeNull();
  expect(objectSlotValue('shape.fill', '')).toBeNull();
});
