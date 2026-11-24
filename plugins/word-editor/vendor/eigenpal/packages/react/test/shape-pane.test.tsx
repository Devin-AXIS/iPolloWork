// The Format shape pane: the shared markup of `shape-pane-markup.json` (the Vue pane renders it
// too), the side panel that swaps to it for a selected shape, the keyboard path through the
// color grid and the fields, Format shape from the toolbar slot and the context menu, a change
// from elsewhere that repaints the pane, and a deleted shape that empties it.

import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync, writeFileSync } from 'node:fs';
import { afterEach, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import {
  commandForSlotValue,
  runToolbarCommand,
  type DocxEditorInstance,
} from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorSidePanel } from '../src/editor/panes/SidePanel.tsx';
import { DocxEditorShapePane } from '../src/editor/shapes/ShapePane.tsx';
import { ContextMenu } from '../src/editor/contextmenu/index.ts';
import { DocxEditorToolbar } from '../src/editor/toolbar/DocxEditorToolbar.tsx';
import { DocxEditorChartPane } from '../src/editor/charts/ChartPane.tsx';
import {
  GROUP_DRAWING,
  SHAPE_PANE_CASES,
  SHAPE_PANE_MARKUP_PATH,
  normalizeShapePaneMarkup,
  selectParityShape,
  shapePaneDocx,
} from './shape-pane-parity.ts';

afterEach(() => cleanup());

async function flush(): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1)
    await act(async () => {
      await Promise.resolve();
    });
}

function mount(fill: string, panel: 'pane' | 'side') {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={shapePaneDocx(fill)}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      <DocxEditorViewport>
        <DocxEditorContent />
        <ContextMenu />
      </DocxEditorViewport>
      {panel === 'pane' ? <DocxEditorShapePane /> : <DocxEditorSidePanel onClose={() => {}} />}
    </DocxEditorRoot>
  );
  return { view, editor: () => instance! };
}

async function paneMarkup(fill: string | null): Promise<string> {
  const { view, editor } = mount(fill ?? SHAPE_PANE_CASES.solid, 'pane');
  await flush();
  if (fill) await act(async () => selectParityShape(editor()));
  await flush();
  const pane = view.container.querySelector('.docx-shape-pane');
  if (!pane) throw new Error('no pane');
  const html = normalizeShapePaneMarkup(pane.outerHTML);
  cleanup();
  return html;
}

test('the Format shape pane renders the shared markup for each fill and for no shape', async () => {
  const markup: Record<string, string> = { none: await paneMarkup(null) };
  for (const [name, fill] of Object.entries(SHAPE_PANE_CASES))
    markup[name] = await paneMarkup(fill);
  expect(markup.theme).toContain('Accent 1');
  // An RGB fill that paints Accent 1 is not named as a theme colour.
  expect(markup.solid).not.toContain('Accent 1');
  expect(markup.solid).toContain('#4472C4');
  expect(markup.gradient).toContain('Fill type: Gradient.');
  expect(markup.gradient).toContain('disabled');
  if (process.env.UPDATE_SHAPE_PANE_MARKUP === '1')
    writeFileSync(SHAPE_PANE_MARKUP_PATH, `${JSON.stringify(markup, null, 2)}\n`);
  expect(markup).toEqual(JSON.parse(readFileSync(SHAPE_PANE_MARKUP_PATH, 'utf8')));
});

const button = (root: HTMLElement, label: string): HTMLButtonElement => {
  const found = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('aria-label') === label || b.textContent === label
  );
  if (!found) throw new Error(`no button ${label}`);
  return found;
};
const input = (root: HTMLElement, label: string): HTMLInputElement =>
  root.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;

test('the side panel swaps to the pane; keyboard picks, typed fields, undo, and a delete', async () => {
  const { view, editor } = mount(SHAPE_PANE_CASES.theme, 'side');
  await flush();
  const panel = view.container.querySelector<HTMLElement>('.docx-side-panel')!;
  expect(panel.getAttribute('data-pane')).toBe('chart');
  await act(async () => selectParityShape(editor()));
  await flush();
  expect(panel.getAttribute('data-pane')).toBe('shape');
  expect(panel.querySelector('.docx-side-panel__title')?.textContent).toBe('Format shape');

  // Format shape from the toolbar slot moves the focus to the first field.
  await act(async () => {
    expect(runToolbarCommand(editor(), 'image.formatShape')).toEqual({ ok: true, changed: false });
    await Promise.resolve();
  });
  await flush();
  const fillButton = panel.querySelector<HTMLButtonElement>('.docx-shape-pane__color-button')!;
  expect(document.activeElement).toBe(fillButton);
  expect(fillButton.textContent).toContain('Accent 1');

  // Keyboard: open the grid, the current color has the focus, Right moves, Enter picks.
  await act(async () => fillButton.click());
  await flush();
  const grid = panel.querySelector<HTMLElement>('.docx-chart-pane__grid')!;
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Accent 1');
  await act(async () => {
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
  });
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Accent 2');
  await act(async () => (document.activeElement as HTMLButtonElement).click());
  await flush();
  expect(grid.isConnected).toBe(false);
  expect(document.activeElement).toBe(fillButton);
  expect(editor().snapshot().image?.shapeFormat?.fill).toEqual({
    type: 'solid',
    color: 'ED7D31',
    transparency: 0.25,
    theme: { name: 'accent2', shift: 0 },
  });

  // Outline: 3pt blue from the hex field and the width field, each one undo step.
  const outlineButton = panel.querySelectorAll<HTMLButtonElement>(
    '.docx-color-picker__trigger'
  )[1]!;
  await act(async () => outlineButton.click());
  await flush();
  const outlineHex = panel.querySelector<HTMLInputElement>('.docx-color-picker__hex input')!;
  await act(async () => {
    fireEvent.change(outlineHex, { target: { value: '#0070C0' } });
    fireEvent.keyDown(outlineHex, { key: 'Enter' });
  });
  await flush();
  expect(document.activeElement).toBe(outlineButton);
  const width = input(panel, 'Width (pt)');
  await act(async () => {
    fireEvent.change(width, { target: { value: '3' } });
    fireEvent.keyDown(width, { key: 'Enter' });
  });
  await flush();
  expect(editor().snapshot().image?.shapeFormat?.outline).toEqual({
    visible: true,
    color: '0070C0',
    widthPt: 3,
    dash: 'solid',
  });
  expect(panel.querySelectorAll('.docx-shape-pane__color-button')[1]?.textContent).toBe('Blue');
  expect(width.value).toBe('3');

  // A typed value the pane cannot read stays in the field with its reason.
  await act(async () => {
    fireEvent.change(width, { target: { value: '0' } });
    fireEvent.keyDown(width, { key: 'Enter' });
  });
  expect(width.getAttribute('aria-invalid')).toBe('true');
  expect(panel.textContent).toContain('Type a width from 0.25 to 1584 points.');
  await act(async () => {
    fireEvent.keyDown(width, { key: 'Escape' });
  });

  // Undo returns the width; a change from elsewhere repaints the pane.
  await act(async () => {
    editor().exec({ type: 'undo' });
  });
  await flush();
  expect(input(panel, 'Width (pt)').value).toBe('1');
  await act(async () => {
    editor().exec({ type: 'setShapeFill', color: '00B050' });
  });
  await flush();
  expect(fillButton.getAttribute('data-color')).toBe('#00B050');
  expect(fillButton.textContent).toBe('Green');

  // No fill from the grid; the transparency field then says why it is off.
  await act(async () => fillButton.click());
  await flush();
  await act(async () => button(panel, 'No fill').click());
  await flush();
  expect(editor().snapshot().image?.shapeFormat?.fill.type).toBe('none');
  expect(input(panel, 'Transparency (%)').disabled).toBe(true);
  expect(panel.textContent).toContain('The shape has no solid fill. Pick a fill color first.');

  // The shape goes: the pane empties.
  await act(async () => {
    expect(editor().exec({ type: 'deleteImage' })).toMatchObject({ ok: true });
  });
  await flush();
  expect(panel.textContent).toContain('No shape selected');
});

test('the context menu shows Format shape for a selected shape and opens the pane', async () => {
  const { view, editor } = mount(SHAPE_PANE_CASES.solid, 'side');
  await flush();
  await act(async () => selectParityShape(editor()));
  await flush();
  const scroller = view.container.querySelector<HTMLElement>('.docx-editor__scroll-container')!;
  await act(async () => {
    fireEvent.contextMenu(scroller, { clientX: 120, clientY: 140, button: 2 });
  });
  const row = view.container.querySelector<HTMLElement>(
    '.docx-contextmenu [data-slot="image.formatShape"]'
  );
  expect(row?.textContent).toContain('Format shape');
  await act(async () => row!.click());
  await flush();
  const pane = view.container.querySelector('.docx-shape-pane')!;
  expect(pane.contains(document.activeElement)).toBe(true);
});

test('the side panel follows mode changes, remembers the shape pane, and Escape returns focus', async () => {
  let closed = 0;
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={shapePaneDocx(SHAPE_PANE_CASES.theme)}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
      <DocxEditorSidePanel onClose={() => (closed += 1)} />
    </DocxEditorRoot>
  );
  await flush();
  const editor = instance!;
  await act(async () => selectParityShape(editor));
  await flush();
  const panel = view.container.querySelector<HTMLElement>('.docx-side-panel')!;
  const fillButton = () =>
    panel.querySelector<HTMLButtonElement>('.docx-shape-pane__color-button')!;
  expect(fillButton().disabled).toBe(false);
  // Viewing mode changes what `can` answers, not the drawing: the fields still follow it.
  await act(async () => {
    editor.exec(commandForSlotValue('review.editingMode', 'viewing')!);
  });
  await flush();
  expect(editor.snapshot().image).not.toBeNull();
  expect(fillButton().disabled).toBe(true);
  await act(async () => {
    editor.exec(commandForSlotValue('review.editingMode', 'editing')!);
  });
  await flush();
  expect(fillButton().disabled).toBe(false);
  // Escape closes the panel, gives the keyboard to the editor, and keeps the shape selected.
  await act(async () => {
    fireEvent.keyDown(fillButton(), { key: 'Escape' });
  });
  await flush();
  expect(closed).toBe(1);
  expect(view.container.querySelector('.docx-pages')!.contains(document.activeElement)).toBe(true);
  expect(editor.snapshot().image?.shapeFormat).not.toBeNull();
  // A caret in text keeps the shape pane: the panel does not fall back to the chart pane.
  await act(async () => {
    const paragraph = editor.surface!.session.paragraphIds()[0]!;
    editor.surface!.setSelection({
      anchor: { paragraphId: paragraph, offset: 1 },
      head: { paragraphId: paragraph, offset: 1 },
    });
  });
  await flush();
  expect(editor.snapshot().image).toBeNull();
  expect(panel.getAttribute('data-pane')).toBe('shape');
  expect(panel.textContent).toContain('No shape selected');
});

for (const only of ['chart', 'shape'] as const) {
  test(`with only the ${only} pane mounted, Format shape follows the shape pane alone`, async () => {
    let instance: DocxEditorInstance | null = null;
    const view = render(
      <DocxEditorRoot
        document={shapePaneDocx(SHAPE_PANE_CASES.solid)}
        onReady={(editor) => {
          instance = editor as DocxEditorInstance;
        }}
      >
        <DocxEditorToolbar overflow={false} />
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
        {only === 'chart' ? <DocxEditorChartPane /> : <DocxEditorShapePane />}
      </DocxEditorRoot>
    );
    await flush();
    await act(async () => selectParityShape(instance!));
    await flush();
    const formatShape = view.container.querySelector(
      '.docx-toolbar [data-slot="image.formatShape"]'
    );
    expect(formatShape !== null).toBe(only === 'shape');
  });
}

test('on a shape inside a group, the alt text button says why in the interface language', async () => {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={shapePaneDocx('', GROUP_DRAWING)}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      <DocxEditorToolbar overflow={false} />
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
      <DocxEditorShapePane />
    </DocxEditorRoot>
  );
  await flush();
  await act(async () => selectParityShape(instance!));
  await flush();
  const frame = view.container.querySelector<HTMLElement>('.docx-image-selection-overlay__frame')!;
  frame.getBoundingClientRect = () =>
    ({ left: 100, top: 100, width: 192, height: 48, right: 292, bottom: 148 }) as DOMRect;
  const at = { clientX: 120, clientY: 124, button: 0, pointerId: 1 };
  await act(async () => {
    frame.dispatchEvent(
      new PointerEvent('pointerdown', { ...at, bubbles: true, cancelable: true })
    );
    window.dispatchEvent(new PointerEvent('pointerup', { ...at, bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  await flush();
  expect(instance!.snapshot().image?.memberId).toBeString();
  const alt = view.container.querySelector<HTMLElement>(
    '.docx-toolbar [data-slot="image.altText"]'
  )!;
  expect(alt.getAttribute('title')).toBe(
    'A shape inside a group takes its wrap, alt text, and properties from the group. Press Escape to select the group.'
  );
});
