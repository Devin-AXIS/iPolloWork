// `useSelectedChart`: a host's own chart pane, built only from the hook and placed in
// `DocxEditor.SidePanel`, reads the selected chart and edits it with the chart commands.
// The Vue twin is `packages/vue/test/use-selected-chart.test.ts`.

import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, expect, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import { openChartPaneFor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorSidePanel } from '../src/editor/panes/SidePanel.tsx';
import {
  useSelectedChart,
  type UseSelectedChartReturn,
} from '../src/editor/charts/useSelectedChart.ts';
import { CHART_PANE_SOURCE } from './chart-pane-parity.ts';

afterEach(() => cleanup());

let latest: UseSelectedChartReturn | null = null;

/** A host pane: the chart type and the first series name, from the hook alone. */
function MyChartPane() {
  const chart = useSelectedChart();
  latest = chart;
  if (!chart.chart) return <p className="my-pane">No chart</p>;
  return (
    <>
      <p className="my-pane">
        {chart.format?.type} {chart.data?.series[0]?.name}
      </p>
      <input aria-label="First value" className="my-field" />
    </>
  );
}

async function mount() {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={CHART_PANE_SOURCE}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
      <DocxEditorSidePanel>
        <MyChartPane />
      </DocxEditorSidePanel>
    </DocxEditorRoot>
  );
  for (let i = 0; i < 5; i += 1) await act(async () => Promise.resolve());
  return { view, editor: instance! };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await act(async () => Promise.resolve());
}

const pane = (view: ReturnType<typeof render>) =>
  view.container.querySelector('.my-pane')?.textContent ?? '';

test('a custom pane reads and edits the selected chart with the hook alone', async () => {
  const { view, editor } = await mount();
  expect(pane(view)).toBe('No chart');
  expect(latest!.canEditData).toBe(false);
  // The reasons are translated, as `useEditorCommand` translates its own.
  expect(latest!.dataDisabledReason).toBeTruthy();
  expect(latest!.dataDisabledReason).not.toContain('chart.errors');
  expect(latest!.execute({ type: 'setChartType', chartType: 'line' })).toMatchObject({
    ok: false,
    reason: 'chart.errors.noChart',
  });

  const paragraphId = editor.surface!.session.paragraphIds()[0]!;
  act(() => {
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 12 },
      head: { paragraphId, offset: 12 },
    });
    editor.exec({ type: 'insertChart', chartType: 'columnClustered' });
  });
  await settle();
  expect(pane(view)).toBe('columnClustered Series 1');
  expect(latest!.canEditData).toBe(true);
  expect(latest!.canEditFormat).toBe(true);

  act(() => {
    expect(latest!.execute({ type: 'setChartType', chartType: 'line' }).ok).toBe(true);
  });
  await settle();
  expect(pane(view)).toBe('line Series 1');

  const data = latest!.data!;
  act(() => {
    const result = latest!.execute({
      type: 'setChartData',
      data: { ...data, series: data.series.map((s, i) => (i ? s : { ...s, name: 'Sales' })) },
    });
    expect(result.ok).toBe(true);
  });
  await settle();
  expect(pane(view)).toBe('line Sales');

  // One checked cell edit, as the packaged pane makes it.
  act(() => {
    expect(latest!.editData({ type: 'seriesName', series: 0, text: 'Cost' }).ok).toBe(true);
  });
  await settle();
  expect(pane(view)).toBe('line Cost');
  expect(latest!.editData({ type: 'value', series: 0, category: 0, text: 'x' })).toMatchObject({
    ok: false,
    code: 'invalidArgs',
    reason: 'chart.data.fieldErrors.number',
  });
  act(() => {
    expect(latest!.editData({ type: 'value', series: 0, category: 0, text: '9' }).ok).toBe(true);
  });
  await settle();
  expect(latest!.data!.series[0]!.values[0]).toBe(9);

  act(() => {
    editor.exec({ type: 'undo' });
    editor.exec({ type: 'undo' });
    editor.exec({ type: 'undo' });
  });
  await settle();
  expect(pane(view)).toBe('line Series 1');
});

test('Edit chart moves the focus into a custom pane', async () => {
  const { view, editor } = await mount();
  const paragraphId = editor.surface!.session.paragraphIds()[0]!;
  act(() => {
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 12 },
      head: { paragraphId, offset: 12 },
    });
    editor.exec({ type: 'insertChart', chartType: 'pie' });
  });
  await settle();
  act(() => {
    expect(openChartPaneFor(editor, latest!.chart!.drawingNodeId)).toBe(true);
  });
  await settle();
  expect(document.activeElement).toBe(view.container.querySelector('.my-field'));
});

test('viewing mode turns the edits off and names the reason', async () => {
  const { editor } = await mount();
  const paragraphId = editor.surface!.session.paragraphIds()[0]!;
  act(() => {
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 12 },
      head: { paragraphId, offset: 12 },
    });
    editor.exec({ type: 'insertChart', chartType: 'pie' });
  });
  await settle();
  act(() => {
    editor.exec({ type: 'setEditingMode', mode: 'viewing' });
  });
  await settle();
  expect(latest!.chart).not.toBeNull();
  expect(latest!.canEditData).toBe(false);
  expect(latest!.canEditFormat).toBe(false);
  expect(latest!.dataDisabledReason).toBeTruthy();
  expect(latest!.dataDisabledReason).toBe(latest!.formatDisabledReason);
});
