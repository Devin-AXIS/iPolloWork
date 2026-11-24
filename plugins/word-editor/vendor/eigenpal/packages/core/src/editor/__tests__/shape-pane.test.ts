// The Format shape pane's headless half: the typed-text checks and commands (`shape-pane.ts`),
// the selected-shape read and edits (`selected-shape.ts`), the `image.formatShape` slot, and
// the pane bus that hands Format shape requests to the shape pane only.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { drawingNamed, gapY, mount, pressAt, pressOn } from './shape-selection-fixture.ts';
import {
  shapeColorPick,
  shapeFillSummary,
  shapeOutlineSummary,
  shapePaneColorHex,
  shapePaneCommand,
  shapeTransparencyText,
  shapeWidthText,
} from '../shape-pane.ts';
import { editSelectedShape, readSelectedShape } from '../selected-shape.ts';
import { chartThemeHexes } from '../chart-pane.ts';
import {
  chartPaneAvailable,
  listenPaneRequests,
  requestPane,
  takePaneRequest,
  takePaneRequestFor,
} from '../chart-chrome.ts';
import {
  openShapePane,
  paneTitleKey,
  selectionPane,
  shapePaneAvailable,
  sidePanelPane,
} from '../shape-chrome.ts';
import {
  runToolbarCommand,
  toolbarCommandState,
  commandForSlotValue,
} from '../toolbar-commands.ts';
import { formattingBarChromeGroups } from '../chrome-controls.ts';
import type { ShapeFormatState } from '../../store/package/shape-format.ts';

const THEME = chartThemeHexes(undefined);
const SOLID: ShapeFormatState = {
  fill: { type: 'solid', color: '4472C4', transparency: 0.25 },
  outline: { visible: true, color: '000000', widthPt: 1 },
};
const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key}(${JSON.stringify(params)})` : key;

test('colors resolve from theme picks, hex text, and CSS names; bad text refuses', () => {
  expect(shapePaneColorHex('accent1', THEME)).toBe('4472C4');
  expect(shapePaneColorHex('accent1:40', THEME)).toMatch(/^[0-9A-F]{6}$/);
  expect(shapePaneColorHex('#0070c0', THEME)).toBe('0070C0');
  expect(shapePaneColorHex(' 0070C0 ', THEME)).toBe('0070C0');
  expect(shapePaneColorHex('teal', THEME)).toBe('008080');
  expect(shapePaneColorHex('accent9', THEME)).toBeNull();
  expect(shapePaneColorHex('#12345', THEME)).toBeNull();
  expect(shapePaneCommand(SOLID, { type: 'fillColor', color: 'nope' }, THEME)).toEqual({
    ok: false,
    error: 'shape.pane.errors.color',
  });
  // A theme pick sends a theme colour, so the shape keeps a theme reference.
  expect(shapePaneCommand(SOLID, { type: 'outlineColor', color: 'accent1' }, THEME)).toEqual({
    ok: true,
    command: { type: 'setShapeOutline', visible: true, color: { theme: 'accent1', shift: 0 } },
  });
  expect(shapePaneCommand(SOLID, { type: 'fillColor', color: 'accent2:-25' }, THEME)).toEqual({
    ok: true,
    command: { type: 'setShapeFill', color: { theme: 'accent2', shift: -25 } },
  });
  // A theme pick on an RGB fill of the same colour still writes the reference.
  expect(shapePaneCommand(SOLID, { type: 'fillColor', color: 'accent1' }, THEME)).toMatchObject({
    command: { color: { theme: 'accent1', shift: 0 } },
  });
});

test('a change to what the shape already shows sends nothing', () => {
  const run = (change: Parameters<typeof shapePaneCommand>[1], format = SOLID) =>
    shapePaneCommand(format, change, THEME);
  const none = { ok: true, command: null };
  expect(run({ type: 'fillColor', color: '#4472c4' })).toEqual(none);
  expect(run({ type: 'fillColor', color: '4472C4' })).toEqual(none);
  expect(run({ type: 'outlineColor', color: '#000000' })).toEqual(none);
  expect(run({ type: 'fillTransparency', text: '25' })).toEqual(none);
  expect(run({ type: 'outlineWidth', text: '1 pt' })).toEqual(none);
  const themed: ShapeFormatState = {
    ...SOLID,
    fill: { ...SOLID.fill, theme: { name: 'accent1', shift: 40 } },
  };
  expect(run({ type: 'fillColor', color: 'accent1:40' }, themed)).toEqual(none);
  expect(run({ type: 'fillColor', color: 'accent1' }, themed)).toMatchObject({
    command: { color: { theme: 'accent1', shift: 0 } },
  });
  // Typed RGB on a theme fill replaces the reference, even when it paints the same colour.
  expect(run({ type: 'fillColor', color: '#4472C4' }, themed)).toMatchObject({
    command: { color: '4472C4' },
  });
  const hidden: ShapeFormatState = {
    fill: { type: 'none', color: null, transparency: 0 },
    outline: { visible: false, color: null, widthPt: 1 },
  };
  expect(run({ type: 'noFill' }, hidden)).toEqual(none);
  expect(run({ type: 'noOutline' }, hidden)).toEqual(none);
  // A width on a hidden outline shows it, so it is not a no-op.
  expect(run({ type: 'outlineWidth', text: '1' }, hidden)).toMatchObject({
    command: { visible: true, widthPt: 1 },
  });
});

test('transparency and width check the typed number and its range', () => {
  const run = (change: Parameters<typeof shapePaneCommand>[1], format = SOLID) =>
    shapePaneCommand(format, change, THEME);
  expect(run({ type: 'fillTransparency', text: '40 %' })).toEqual({
    ok: true,
    command: { type: 'setShapeFill', transparency: 0.4 },
  });
  expect(run({ type: 'fillTransparency', text: '12,5' })).toMatchObject({ ok: true });
  for (const text of ['', '101', '-1', 'abc', '1e2'])
    expect(run({ type: 'fillTransparency', text })).toEqual({
      ok: false,
      error: 'shape.pane.errors.transparency',
    });
  expect(
    run(
      { type: 'fillTransparency', text: '10' },
      { ...SOLID, fill: { type: 'gradient', color: null, transparency: 0 } }
    )
  ).toEqual({ ok: false, error: 'shape.pane.errors.noSolidFill' });
  expect(run({ type: 'outlineWidth', text: '3 pt' })).toEqual({
    ok: true,
    command: { type: 'setShapeOutline', visible: true, widthPt: 3 },
  });
  for (const text of ['0.2', '1585', 'wide', ''])
    expect(run({ type: 'outlineWidth', text })).toEqual({
      ok: false,
      error: 'shape.pane.errors.width',
    });
  expect(run({ type: 'noFill' })).toEqual({
    ok: true,
    command: { type: 'setShapeFill', visible: false },
  });
  expect(run({ type: 'noOutline' })).toEqual({
    ok: true,
    command: { type: 'setShapeOutline', visible: false },
  });
});

test('field text and button summaries name what the shape has', () => {
  expect(shapeTransparencyText(SOLID.fill)).toBe('25');
  expect(shapeWidthText(2.25)).toBe('2.25');
  expect(shapeWidthText(null)).toBe('');
  // An RGB that matches a theme colour is not named as one; only a theme reference is.
  expect(shapeColorPick('4472C4', THEME)).toBe('#4472C4');
  expect(shapeColorPick('4472C4', THEME, { name: 'accent1', shift: 0 })).toBe('accent1');
  expect(shapeColorPick('8FAADC', THEME, { name: 'accent1', shift: 40 })).toBe('accent1:40');
  expect(shapeColorPick('123456', THEME)).toBe('#123456');
  expect(shapeFillSummary(SOLID.fill, THEME, t)).not.toBe('colorPicker.theme.accent1');
  expect(shapeFillSummary({ ...SOLID.fill, theme: { name: 'accent1', shift: 0 } }, THEME, t)).toBe(
    'colorPicker.theme.accent1'
  );
  expect(shapeFillSummary({ type: 'pattern', color: null, transparency: 0 }, THEME, t)).toBe(
    'shape.pane.fillTypes.pattern'
  );
  expect(shapeOutlineSummary({ visible: false, color: null, widthPt: 1 }, THEME, t)).toBe(
    'shape.pane.noOutline'
  );
  expect(shapeOutlineSummary({ visible: null, color: null, widthPt: null }, THEME, t)).toBe(
    'shape.pane.fillTypes.mixed'
  );
  expect(
    shapeOutlineSummary({ ...SOLID.outline, theme: { name: 'tx1', shift: 0 } }, THEME, t)
  ).toBe('colorPicker.theme.text1');
});

test('the selected shape reads, edits as one undo step, and refuses in viewing mode', async () => {
  const { editor, container } = await mount();
  try {
    expect(readSelectedShape(editor, editor.snapshot().image)).toMatchObject({
      drawingNodeId: null,
      canEditFill: false,
      fillDisabledReason: 'this drawing has no fill or outline to set',
    });
    pressAt(container, editor, 380, gapY(editor));
    const image = editor.snapshot().image;
    const view = readSelectedShape(editor, image);
    expect(view).toMatchObject({
      drawingNodeId: image?.id,
      canEditFill: true,
      canEditTransparency: true,
      canEditOutline: true,
      fillDisabledReason: null,
    });
    expect(editSelectedShape(editor, image, { type: 'fillColor', color: 'accent1' })).toMatchObject(
      { ok: true, changed: true }
    );
    expect(editor.snapshot().image?.shapeFormat?.fill.color).toBe('4472C4');
    const now = editor.snapshot().image;
    expect(editSelectedShape(editor, now, { type: 'outlineWidth', text: '3' })).toMatchObject({
      ok: true,
    });
    expect(editor.snapshot().image?.shapeFormat?.outline.widthPt).toBe(3);
    expect(editSelectedShape(editor, now, { type: 'outlineWidth', text: '0' })).toEqual({
      ok: false,
      code: 'invalidArgs',
      reason: 'shape.pane.errors.width',
    });
    expect(editor.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
    expect(editor.snapshot().image?.shapeFormat?.outline.widthPt).toBe(1);
    expect(editor.exec(commandForSlotValue('review.editingMode', 'viewing')!)).toMatchObject({
      ok: true,
    });
    const viewing = readSelectedShape(editor, editor.snapshot().image);
    expect(viewing).toMatchObject({
      canEditFill: false,
      canEditTransparency: false,
      canEditOutline: false,
      fillDisabledReason: 'the document is open for viewing',
      outlineDisabledReason: 'the document is open for viewing',
    });
    // Format shape follows `can`: nothing to change, so the slot is off with the same reason.
    expect(toolbarCommandState(editor, 'image.formatShape')).toMatchObject({
      enabled: false,
      disabledReason: 'the document is open for viewing',
    });
    expect(runToolbarCommand(editor, 'image.formatShape')).toMatchObject({ ok: false });
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('Format shape shows for a shape, opens the pane, and its request reaches the shape pane', async () => {
  const { editor, container } = await mount();
  try {
    expect(toolbarCommandState(editor, 'image.formatShape')).toMatchObject({ enabled: false });
    expect(runToolbarCommand(editor, 'image.formatShape')).toMatchObject({ ok: false });
    const group = drawingNamed(editor, 3);
    pressOn(container, editor, group);
    const image = editor.snapshot().image!;
    const groups = formattingBarChromeGroups(image, { shape: true });
    const imageGroup = groups.find((g) => g.id === 'image')!;
    expect(imageGroup.controls.map((c) => c.id)).toContain('formatShape');
    expect(imageGroup.controls.map((c) => c.id)).not.toContain('editChart');
    expect(
      formattingBarChromeGroups(image, {})
        .find((g) => g.id === 'image')!
        .controls.map((c) => c.id)
    ).not.toContain('formatShape');
    expect(toolbarCommandState(editor, 'image.formatShape')).toMatchObject({ enabled: true });
    // A listener for the Chart pane alone does not make Format shape available, and a request
    // that no listener takes is dropped rather than left for a later pane to steal.
    const chartHeard: string[] = [];
    const stopChart = listenPaneRequests(editor, (request) => chartHeard.push(request.pane));
    expect(chartPaneAvailable(editor)).toBe(true);
    expect(shapePaneAvailable(editor)).toBe(false);
    expect(requestPane(editor, 'shape')).toBe(false);
    expect(chartHeard).toEqual([]);
    expect(takePaneRequest(editor)).toBeNull();
    stopChart();
    const heard: string[] = [];
    const stop = listenPaneRequests(editor, (request) => heard.push(request.pane), {
      panes: ['chart', 'shape'],
    });
    expect(shapePaneAvailable(editor)).toBe(true);
    expect(runToolbarCommand(editor, 'image.formatShape')).toEqual({ ok: true, changed: false });
    expect(heard).toEqual(['shape']);
    // The Chart pane leaves a Format shape request for the shape pane.
    expect(takePaneRequestFor(editor, 'chart')).toBeNull();
    expect(takePaneRequestFor(editor, 'shape')).toEqual({ pane: 'shape', focus: true });
    expect(openShapePane(editor, 'another-id')).toBe(false);
    expect(openShapePane(editor, image.id)).toBe(true);
    expect(takePaneRequest(editor)).toEqual({ pane: 'shape', focus: true });
    requestPane(editor, 'chart', { focus: false });
    expect(takePaneRequestFor(editor, 'shape')).toBeNull();
    expect(takePaneRequestFor(editor, 'chart')).toEqual({ pane: 'chart', focus: false });
    stop();
    expect(selectionPane(editor.snapshot())).toBe('shape');
    expect(sidePanelPane({ chart: null, image: null }, 'chart')).toBe('chart');
    expect(sidePanelPane({ chart: null, image: null }, 'shape')).toBe('shape');
    expect(sidePanelPane(editor.snapshot(), 'chart')).toBe('shape');
    expect(paneTitleKey('shape')).toBe('shape.pane.title');
    expect(paneTitleKey('chart')).toBe('chart.pane.title');
  } finally {
    editor.destroy();
    container.remove();
  }
});
