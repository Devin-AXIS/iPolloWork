// The shape and chart parts outside the packaged panes: a host toolbar with its own fill and
// chart title, a popover that answers a pane request with pane sections, the default toolbar's
// contextual groups, and the colour picker keyboard model.

import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { useState } from 'react';
import { afterEach, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { runToolbarCommand, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorToolbar } from '../src/editor/toolbar/DocxEditorToolbar.tsx';
import { usePaneRequest } from '../src/editor/panes/index.ts';
import {
  DocxEditorChartAxes,
  DocxEditorChartData,
  DocxEditorChartDataLabels,
  DocxEditorChartLegend,
  DocxEditorChartSeriesColors,
  DocxEditorChartTitle,
  DocxEditorChartType,
  DocxEditorPaneSections,
  DocxEditorShapeFill,
  DocxEditorShapeOutlineDash,
  DocxEditorShapeOutlineWidth,
} from '../src/editor/objects/index.ts';
import { SHAPE_PANE_CASES, selectParityShape, shapePaneDocx } from './shape-pane-parity.ts';
import { CHART_PANE_SOURCE, insertParityChart } from './chart-pane-parity.ts';

afterEach(() => cleanup());

async function flush(): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1)
    await act(async () => {
      await Promise.resolve();
    });
}

function mount(document: Uint8Array, children: React.ReactNode) {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={document}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      {children}
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  return { view, editor: () => instance! };
}

test('shape parts in a host toolbar: compact fill, dash, and width apply and follow the shape', async () => {
  const { view, editor } = mount(
    shapePaneDocx(SHAPE_PANE_CASES.theme),
    <div role="toolbar" aria-label="Host">
      <DocxEditorShapeFill variant="compact" />
      <DocxEditorShapeOutlineWidth variant="compact" />
      <DocxEditorShapeOutlineDash variant="compact" className="host-dash" />
    </div>
  );
  await flush();
  const bar = view.getByRole('toolbar', { name: 'Host' });
  const trigger = bar.querySelector<HTMLButtonElement>('.docx-color-picker__trigger')!;
  // Nothing selected: disabled, with the reason in the tooltip.
  expect(trigger.disabled).toBe(true);
  expect(bar.querySelector('[data-slot="shape.fill"]')?.getAttribute('title')).toBeTruthy();
  await act(async () => selectParityShape(editor()));
  await flush();
  expect(trigger.disabled).toBe(false);
  // The label is for screen readers only in a compact part.
  expect(bar.querySelector('[data-slot="shape.fill"] .docx-editor-sr-only')?.textContent).toBe(
    'Fill color'
  );
  // Keyboard: the grid opens on the current colour, Down moves a row, Escape returns focus.
  await act(async () => trigger.click());
  await flush();
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Accent 1');
  await act(async () => {
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
  });
  expect(document.activeElement?.getAttribute('data-pick')).toMatch(/^accent1:/);
  await act(async () => {
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  });
  expect(document.activeElement).toBe(trigger);
  await act(async () => trigger.click());
  await flush();
  await act(async () => bar.querySelector<HTMLButtonElement>('[data-pick="accent6"]')!.click());
  await flush();
  expect(editor().snapshot().image?.shapeFormat?.fill.theme).toEqual({
    name: 'accent6',
    shift: 0,
  });
  const dash = bar.querySelector<HTMLSelectElement>('.host-dash select')!;
  await act(async () => fireEvent.change(dash, { target: { value: 'dashDot' } }));
  await flush();
  expect(editor().snapshot().image?.shapeFormat?.outline.dash).toBe('dashDot');
  expect(dash.value).toBe('dashDot');
  const width = bar.querySelector<HTMLSelectElement>('[data-slot="shape.outlineWidth"] select')!;
  await act(async () => fireEvent.change(width, { target: { value: '6' } }));
  await flush();
  expect(editor().snapshot().image?.shapeFormat?.outline.widthPt).toBe(6);
  // A change from elsewhere repaints the parts.
  await act(async () => {
    runToolbarCommand(editor(), 'shape.outlineDash', 'solid');
  });
  await flush();
  expect(dash.value).toBe('solid');
});

function ChartPopover() {
  const [open, setOpen] = useState(false);
  usePaneRequest(() => setOpen(true), { panes: ['chart'] });
  return open ? (
    <div role="dialog" aria-label="Chart popover">
      <DocxEditorPaneSections pane="chart" sections={['type', 'elements']} />
    </div>
  ) : null;
}

test('chart parts in a host toolbar and a popover that answers the pane request', async () => {
  const { view, editor } = mount(
    CHART_PANE_SOURCE,
    <>
      <div role="toolbar" aria-label="Host">
        <DocxEditorChartType variant="compact" />
        <DocxEditorChartTitle variant="compact" />
        <DocxEditorChartLegend variant="compact" />
        <DocxEditorChartDataLabels variant="compact" />
      </div>
      <ChartPopover />
      <div data-testid="drawer">
        <DocxEditorChartAxes />
        <DocxEditorChartSeriesColors index={0} />
        <DocxEditorChartData />
      </div>
    </>
  );
  await flush();
  const bar = view.getByRole('toolbar', { name: 'Host' });
  const title = bar.querySelector<HTMLInputElement>('[data-slot="chart.title"] input')!;
  expect(title.disabled).toBe(true);
  await act(async () => insertParityChart(editor(), 'columnClustered'));
  await flush();
  expect(title.disabled).toBe(false);
  await act(async () => {
    fireEvent.change(title, { target: { value: 'Revenue' } });
    fireEvent.keyDown(title, { key: 'Enter' });
  });
  await flush();
  const id = editor().snapshot().chart!.drawingNodeId;
  const format = () => {
    const read = editor().query({ type: 'chartFormat', drawingNodeId: id });
    if (!read.ok) throw new Error(read.reason);
    return read.format;
  };
  expect(format().title).toBe('Revenue');
  const labels = bar.querySelector<HTMLButtonElement>('[data-slot="chart.dataLabels"] button')!;
  expect(labels.getAttribute('aria-pressed')).toBe('false');
  await act(async () => labels.click());
  await flush();
  expect(format().dataLabels).toBe(true);
  expect(labels.getAttribute('aria-pressed')).toBe('true');
  const type = bar.querySelector<HTMLSelectElement>('[data-slot="chart.type"] select')!;
  await act(async () => fireEvent.change(type, { target: { value: 'line' } }));
  await flush();
  expect(format().type).toBe('line');
  // Edit chart opens the host's popover, which renders pane sections.
  await act(async () => {
    expect(runToolbarCommand(editor(), 'image.editChart')).toEqual({ ok: true, changed: false });
  });
  await flush();
  const popover = view.getByRole('dialog', { name: 'Chart popover' });
  expect(popover.querySelector('[data-section="type"]')).not.toBeNull();
  expect(popover.querySelector('[data-section="data"]')).toBeNull();
  const legend = popover.querySelector<HTMLSelectElement>('[data-slot="chart.legend"] select')!;
  await act(async () => fireEvent.change(legend, { target: { value: 'left' } }));
  await flush();
  expect(format().legend).toBe('left');
  expect(bar.querySelector<HTMLSelectElement>('[data-slot="chart.legend"] select')!.value).toBe(
    'left'
  );
  // The drawer: one series colour and the data editor, outside any pane.
  const drawer = view.getByTestId('drawer');
  const colorTrigger = drawer.querySelector<HTMLButtonElement>('.docx-color-picker__trigger')!;
  await act(async () => colorTrigger.click());
  await flush();
  await act(async () => drawer.querySelector<HTMLButtonElement>('[data-pick="accent4"]')!.click());
  await flush();
  expect(format().colors[0]?.color).toEqual({ theme: 'accent4' });
  const add = [...drawer.querySelectorAll('button')].find((b) => b.textContent === 'Add category')!;
  await act(async () => add.click());
  await flush();
  const data = editor().query({ type: 'chartData', drawingNodeId: id });
  expect(data.ok && data.data.categories.length).toBe(5);
  // A pie chart has no axes: the axes part renders nothing.
  expect(drawer.querySelector('[data-slot="chart.axes"]')).not.toBeNull();
  await act(async () => {
    runToolbarCommand(editor(), 'chart.type', 'pie');
  });
  await flush();
  expect(drawer.querySelector('[data-slot="chart.axes"]')).toBeNull();
});

test('the default toolbar shows the contextual shape and chart groups for a selection', async () => {
  const { view, editor } = mount(
    shapePaneDocx(SHAPE_PANE_CASES.solid),
    <DocxEditorToolbar overflow={false} />
  );
  await flush();
  const slots = () =>
    [...view.container.querySelectorAll('.docx-toolbar [data-slot]')].map((n) =>
      n.getAttribute('data-slot')
    );
  expect(slots()).not.toContain('shape.fill');
  await act(async () => selectParityShape(editor()));
  await flush();
  expect(slots()).toEqual(
    expect.arrayContaining([
      'shape.fill',
      'shape.outlineColor',
      'shape.outlineWidth',
      'shape.outlineDash',
    ])
  );
  expect(slots()).not.toContain('shape.fillTransparency');
});
