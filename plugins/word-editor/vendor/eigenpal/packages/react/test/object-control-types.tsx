// Type checks of the shape and chart part API, compiled by `bun check` (see tsconfig.json):
// typed slot values with no casts, `toggle` only on toggle slots, section ids per pane, and
// every snippet of the object controls guide.

import { useState } from 'react';
import { runToolbarCommand, type ColorPick } from '@docx-editor.dev/core/editor';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';
import { DocxEditorPaneSections, useObjectControl } from '../src/editor/objects/index.ts';
import { DocxEditor, usePaneRequest } from '../src/index.ts';

export function TypedControls(): null {
  const width = useObjectControl('shape.outlineWidth');
  const labels = useObjectControl('chart.dataLabels');
  const legend = useObjectControl('chart.legend');
  const widthValue: number | null = width.value;
  const labelsValue: boolean | null = labels.value;
  width.execute(2.25);
  legend.execute('right', {});
  labels.toggle();
  // @ts-expect-error A value slot has no toggle.
  void width.toggle;
  // @ts-expect-error A legend position is not any text.
  legend.execute('middle');
  void widthValue;
  void labelsValue;
  return null;
}

export function TypedSections() {
  return (
    <>
      <DocxEditorPaneSections pane="shape" sections={['fill', 'outline']} />
      <DocxEditorPaneSections pane="chart" sections={['type', 'elements']} />
      {/* @ts-expect-error `elements` is a chart section, not a shape section. */}
      <DocxEditorPaneSections pane="shape" sections={['elements']} />
    </>
  );
}

export function ColorReads(): null {
  const fill = useObjectControl('shape.fill');
  // A colour slot reads back a grid pick or `none`, and still takes a colour name.
  const read: ColorPick | 'none' | null = fill.value;
  fill.execute('red');
  void read;
  return null;
}

// The snippets of `docs/site/content/guides/object-controls.mdx`, as written there. Keep them
// in step with the guide.

const FillIcon = (): null => null;

export function ShapeToolbar() {
  return (
    <div role="toolbar" aria-label="Shape">
      <DocxEditor.ShapeFill variant="compact" />
      <DocxEditor.ShapeOutlineDash variant="compact" />
    </div>
  );
}

export function EditorToolbar() {
  return (
    <DocxEditor.Toolbar>
      <DocxEditor.ShapeFill className="my-fill" icon={<FillIcon />} />
      <DocxEditor.ChartDataLabels asChild>
        <button type="button" className="my-toggle">
          Labels
        </button>
      </DocxEditor.ChartDataLabels>
      <DocxEditor.ShapeOutlineDash hidden />
    </DocxEditor.Toolbar>
  );
}

export function LegendButtons() {
  const legend = useObjectControl('chart.legend');
  return (
    <div role="group" aria-label={legend.label}>
      {legend.options.map((position) => (
        <button
          key={position}
          type="button"
          disabled={!legend.isEnabled}
          aria-pressed={legend.value === position}
          onClick={() => legend.execute(position)}
        >
          {position}
        </button>
      ))}
    </div>
  );
}

export function runDash(editor: Editor): void {
  const result = runToolbarCommand(editor, 'shape.outlineDash', 'dash');
  if (!result.ok) console.warn(result.reason);
}

export function ChartPopover() {
  const [open, setOpen] = useState(false);
  usePaneRequest(() => setOpen(true), { panes: ['chart'] });
  if (!open) return null;
  return (
    <div role="dialog" aria-label="Chart">
      <DocxEditor.PaneSections pane="chart" sections={['type', 'elements']} />
      <button type="button" onClick={() => setOpen(false)}>
        Close
      </button>
    </div>
  );
}

export function ChartDrawer() {
  return (
    <aside aria-label="Chart">
      <DocxEditor.ChartType />
      <DocxEditor.ChartTitle />
      <DocxEditor.ChartLegend />
      <DocxEditor.ChartDataLabels />
      <DocxEditor.ChartAxes />
      <DocxEditor.ChartGridlines />
      <DocxEditor.ChartCategoryAxisTitle />
      <DocxEditor.ChartValueAxisTitle />
      {/* index shows one series; omit it to show every series */}
      <DocxEditor.ChartSeriesColors index={0} />
      <DocxEditor.ChartData />
    </aside>
  );
}

export function OutlineColor() {
  const outline = useObjectControl('shape.outlineColor');
  return (
    <DocxEditor.ColorPicker.Root
      value={outline.value}
      disabled={!outline.isEnabled}
      onPick={(pick) => outline.execute(pick)}
    >
      <DocxEditor.ColorPicker.Trigger aria-label={outline.label} />
      <DocxEditor.ColorPicker.Content />
    </DocxEditor.ColorPicker.Root>
  );
}

export function FloatingFill({ floating }: { floating: HTMLElement | null }) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  void anchor;
  return (
    <DocxEditor.ColorPicker.Root value="accent1" onPick={(pick) => console.log(pick)}>
      <DocxEditor.ColorPicker.Trigger ref={setAnchor} aria-label="Fill" />
      {/* Position `floating` next to `anchor` with your popover library. */}
      <DocxEditor.ColorPicker.Content container={floating} />
    </DocxEditor.ColorPicker.Root>
  );
}
