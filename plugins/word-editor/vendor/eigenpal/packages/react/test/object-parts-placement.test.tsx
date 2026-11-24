// Shape and chart parts placed by a host: the scope class outside every scoped element, the
// toolbar customization ladder (className, icon, asChild, a slot override, hidden, and
// preset={false}), the colour picker focus across a host render, the portal container, the
// typed `useObjectControl`, and one luminance model for every colour grid.

import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { useState, type ReactNode } from 'react';
import { afterEach, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import {
  colorPickHex,
  documentThemeHexes,
  type DocxEditorInstance,
} from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorToolbar } from '../src/editor/toolbar/DocxEditorToolbar.tsx';
import { ColorPicker } from '../src/editor/color/ColorPicker.tsx';
import {
  DocxEditorChartDataLabels,
  DocxEditorShapeFill,
  useObjectControl,
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

function mount(
  document: Uint8Array,
  children: ReactNode,
  colorMode: 'light' | 'dark' = 'light'
): { view: ReturnType<typeof render>; editor: () => DocxEditorInstance } {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={document}
      colorMode={colorMode}
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

test('a part outside every scoped element carries the scope class, with dark under a dark Root', async () => {
  for (const mode of ['light', 'dark'] as const) {
    const { view } = mount(
      shapePaneDocx(SHAPE_PANE_CASES.theme),
      <div data-testid="host">
        <DocxEditorShapeFill variant="compact" />
        <ColorPicker.Root value={null} onPick={() => {}}>
          <ColorPicker.Trigger />
        </ColorPicker.Root>
      </div>,
      mode
    );
    await flush();
    const host = view.getByTestId('host');
    const frame = host.querySelector('[data-slot="shape.fill"]')!;
    expect(frame.classList.contains('docx-editor')).toBe(true);
    expect(frame.classList.contains('dark')).toBe(mode === 'dark');
    // The picker inside the part takes the part's scope; a picker alone carries its own.
    expect(frame.querySelector('.docx-color-picker')!.classList.contains('docx-editor')).toBe(
      false
    );
    const alone = host.querySelector(':scope > .docx-color-picker')!;
    expect(alone.classList.contains('docx-editor')).toBe(true);
    cleanup();
  }
});

/** The shape.fill and chart.dataLabels nodes inside the default toolbar. */
const toolbarSlots = (root: HTMLElement, slot: string) => [
  ...root.querySelectorAll(`.docx-toolbar [data-slot="${slot}"]`),
];

let hostClicks = 0;
test('toolbar overrides of a shape part and a chart part: className, icon, asChild, hidden', async () => {
  const cases: readonly { name: string; shape: ReactNode; chart: ReactNode }[] = [
    {
      name: 'className',
      shape: <DocxEditorShapeFill className="mine" />,
      chart: <DocxEditorChartDataLabels className="mine" />,
    },
    {
      name: 'icon',
      shape: <DocxEditorShapeFill icon={<i className="host-icon" />} />,
      chart: <DocxEditorChartDataLabels icon={<i className="host-icon" />} />,
    },
    {
      name: 'asChild',
      shape: (
        <DocxEditorShapeFill asChild>
          <button type="button" className="host-button">
            Fill
          </button>
        </DocxEditorShapeFill>
      ),
      chart: (
        <DocxEditorChartDataLabels asChild>
          <button type="button" className="host-button" onClick={() => hostClicks++}>
            Labels
          </button>
        </DocxEditorChartDataLabels>
      ),
    },
    {
      name: 'hidden',
      shape: <DocxEditorShapeFill hidden />,
      chart: <DocxEditorChartDataLabels hidden />,
    },
  ];
  for (const { name, shape, chart } of cases) {
    const shapeView = mount(
      shapePaneDocx(SHAPE_PANE_CASES.solid),
      <DocxEditorToolbar overflow={false}>{shape}</DocxEditorToolbar>
    );
    await flush();
    await act(async () => selectParityShape(shapeView.editor()));
    await flush();
    const fills = toolbarSlots(shapeView.view.container, 'shape.fill');
    const chartView = mount(
      CHART_PANE_SOURCE,
      <DocxEditorToolbar overflow={false}>{chart}</DocxEditorToolbar>
    );
    await flush();
    await act(async () => insertParityChart(chartView.editor(), 'columnClustered'));
    await flush();
    const labels = toolbarSlots(chartView.view.container, 'chart.dataLabels');
    if (name === 'hidden') {
      expect(fills).toHaveLength(0);
      expect(labels).toHaveLength(0);
      cleanup();
      continue;
    }
    // The override replaces the slot in place: one control, rendered compact.
    expect(fills).toHaveLength(1);
    expect(labels).toHaveLength(1);
    for (const node of [fills[0]!, labels[0]!]) {
      expect(node.classList.contains('docx-object-control--compact')).toBe(true);
      if (name === 'className') expect(node.classList.contains('mine')).toBe(true);
      if (name === 'icon') expect(node.querySelector('.host-icon')).not.toBeNull();
    }
    if (name === 'asChild') {
      const fillButton = fills[0]!.querySelector<HTMLButtonElement>('.host-button')!;
      expect(fillButton.getAttribute('aria-haspopup')).toBe('true');
      await act(async () => fillButton.click());
      await flush();
      expect(fills[0]!.querySelector('[data-color-swatch]')).not.toBeNull();
      const labelButton = labels[0]!.querySelector<HTMLButtonElement>('.host-button')!;
      // The child keeps its own class once, and its own handler runs once per press.
      expect(labelButton.className.split(' ').filter((c) => c === 'host-button')).toHaveLength(1);
      expect(labelButton.getAttribute('aria-pressed')).toBe('false');
      await act(async () => labelButton.click());
      await flush();
      expect(labelButton.getAttribute('aria-pressed')).toBe('true');
      expect(hostClicks).toBe(1);
    }
    cleanup();
  }
});

test('preset={false} renders the parts verbatim, compact, with nothing else', async () => {
  const { view, editor } = mount(
    shapePaneDocx(SHAPE_PANE_CASES.solid),
    <DocxEditorToolbar preset={false}>
      <DocxEditorShapeFill />
      <DocxEditorChartDataLabels />
    </DocxEditorToolbar>
  );
  await flush();
  await act(async () => selectParityShape(editor()));
  await flush();
  const slots = [...view.container.querySelectorAll('.docx-toolbar [data-slot]')].map((n) =>
    n.getAttribute('data-slot')
  );
  expect(slots).toEqual(['shape.fill', 'chart.dataLabels']);
  const fill = view.container.querySelector('.docx-toolbar [data-slot="shape.fill"]')!;
  expect(fill.classList.contains('docx-object-control--compact')).toBe(true);
});

let bump: () => void = () => {};
function RerenderingHost() {
  const [count, setCount] = useState(0);
  bump = () => setCount((value) => value + 1);
  return (
    <div role="toolbar" aria-label="Host" data-count={count}>
      <DocxEditorShapeFill variant="compact" />
      {/* A host picker with an inline handler and theme list: new values on every render. */}
      <ColorPicker.Root
        className="host-picker"
        value="accent1"
        themeHexes={documentThemeHexes(undefined).slice()}
        onPick={(pick) => void pick}
      >
        <ColorPicker.Trigger />
        <ColorPicker.Content />
      </ColorPicker.Root>
    </div>
  );
}

test('the open grid keeps the focus in the hex field across an unrelated host render', async () => {
  const { view, editor } = mount(shapePaneDocx(SHAPE_PANE_CASES.theme), <RerenderingHost />);
  await flush();
  await act(async () => selectParityShape(editor()));
  await flush();
  const bar = view.getByRole('toolbar', { name: 'Host' });
  await act(async () =>
    bar.querySelector<HTMLButtonElement>('.docx-color-picker__trigger')!.click()
  );
  await flush();
  const hex = bar.querySelector<HTMLInputElement>('.docx-color-picker__hex input')!;
  hex.focus();
  await act(async () => {
    fireEvent.change(hex, { target: { value: '#12' } });
  });
  await act(async () => bump());
  await flush();
  expect(document.activeElement).toBe(hex);
  await act(async () => {
    fireEvent.keyDown(hex, { key: 'Escape' });
  });
  const host = bar.querySelector('.host-picker')!;
  await act(async () =>
    host.querySelector<HTMLButtonElement>('.docx-color-picker__trigger')!.click()
  );
  await flush();
  const hostHex = host.querySelector<HTMLInputElement>('.docx-color-picker__hex input')!;
  hostHex.focus();
  await act(async () => bump());
  await flush();
  expect(document.activeElement).toBe(hostHex);
});

test('Content renders in a host container through a portal, scoped, and the trigger forwards its ref', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const triggerRef: { current: HTMLButtonElement | null } = { current: null };
  const contentRef: { current: HTMLDivElement | null } = { current: null };
  const { view } = mount(
    shapePaneDocx(SHAPE_PANE_CASES.theme),
    <ColorPicker.Root value="accent1" onPick={() => {}}>
      <ColorPicker.Trigger ref={triggerRef} data-testid="trigger" />
      <ColorPicker.Content ref={contentRef} container={container} />
    </ColorPicker.Root>,
    'dark'
  );
  await flush();
  expect(triggerRef.current).toBe(view.getByTestId('trigger') as HTMLButtonElement);
  await act(async () => triggerRef.current!.click());
  await flush();
  const grid = container.querySelector<HTMLElement>('.docx-color-picker__content')!;
  expect(grid).not.toBeNull();
  expect(contentRef.current).toBe(grid as HTMLDivElement);
  expect(grid.classList.contains('docx-editor')).toBe(true);
  expect(grid.classList.contains('dark')).toBe(true);
  // The host places it: no popover position of its own.
  expect(grid.classList.contains('docx-chart-pane__grid')).toBe(false);
  // A press inside the portal does not close it.
  await act(async () => {
    fireEvent.pointerDown(grid.querySelector('[data-pick="accent2"]')!);
  });
  expect(container.querySelector('.docx-color-picker__content')).not.toBeNull();
  container.remove();
});

const seen: Record<string, unknown> = {};
function TypedReader() {
  const width = useObjectControl('shape.outlineWidth');
  const labels = useObjectControl('chart.dataLabels');
  const legend = useObjectControl('chart.legend');
  // No casts: the value types come from the slot.
  const widthValue: number | null = width.value;
  const labelsValue: boolean | null = labels.value;
  seen.width = widthValue;
  seen.labels = labelsValue;
  seen.legend = legend.value;
  seen.legendOptions = legend.options;
  seen.labelsToggle = typeof labels.toggle;
  seen.widthToggle = 'toggle' in width;
  return null;
}

test('useObjectControl gives a typed value per slot, the list options, and toggle only on toggles', async () => {
  const shape = mount(shapePaneDocx(SHAPE_PANE_CASES.solid), <TypedReader />);
  await flush();
  expect(seen.width).toBeNull();
  await act(async () => selectParityShape(shape.editor()));
  await flush();
  expect(typeof seen.width).toBe('number');
  expect(seen.widthToggle).toBe(false);
  cleanup();
  const chart = mount(CHART_PANE_SOURCE, <TypedReader />);
  await flush();
  expect(seen.labels).toBeNull();
  await act(async () => insertParityChart(chart.editor(), 'columnClustered'));
  await flush();
  expect(seen.labels).toBe(false);
  expect(seen.legend).toBe('bottom');
  expect(seen.legendOptions).toContain('right');
  expect(seen.labelsToggle).toBe('function');
});

test('the font colour grid paints each tint as the shared colour picker does', async () => {
  const { view, editor } = mount(
    shapePaneDocx(SHAPE_PANE_CASES.theme),
    <DocxEditorToolbar overflow={false} />
  );
  await flush();
  const font = view.container.querySelector('[data-slot="text.color"]')!;
  await act(async () => {
    (font.querySelector('.docx-toolbar__colorsplit-caret') as HTMLButtonElement).click();
  });
  await flush();
  const hexes = documentThemeHexes(editor().getDocumentThemeColors());
  const swatches = [
    ...font.querySelectorAll<HTMLButtonElement>('.docx-toolbar__swatch-grid--theme button'),
  ];
  // Row two, column four: Text 2, Lighter 80%.
  expect(swatches[10 + 3]!.getAttribute('data-value')).toBe(colorPickHex('tx2:80', hexes).slice(1));
  expect(swatches[10 + 4]!.getAttribute('data-value')).toBe(
    colorPickHex('accent1:80', hexes).slice(1)
  );
});
