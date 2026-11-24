// The Chart pane renders the shared markup of `chart-pane-markup.json`, which the Vue pane
// renders too (`packages/vue/test/chart-pane-markup.test.ts`).

import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync, writeFileSync } from 'node:fs';
import { afterEach, expect, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorChartPane } from '../src/editor/charts/ChartPane.tsx';
import {
  CHART_PANE_CASES,
  CHART_PANE_MARKUP_PATH,
  CHART_PANE_SOURCE,
  insertParityChart,
  normalizeChartPaneMarkup,
} from './chart-pane-parity.ts';

afterEach(() => cleanup());

async function flush(): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1)
    await act(async () => {
      await Promise.resolve();
    });
}

async function paneMarkup(type: string | null): Promise<string> {
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
      <DocxEditorChartPane />
    </DocxEditorRoot>
  );
  await flush();
  if (type) await act(async () => insertParityChart(instance!, type));
  await flush();
  const pane = view.container.querySelector('.docx-chart-pane');
  if (!pane) throw new Error('no pane');
  const html = normalizeChartPaneMarkup(pane.outerHTML);
  cleanup();
  return html;
}

test('the Chart pane renders the shared markup for each chart and for no chart', async () => {
  const markup: Record<string, string> = { none: await paneMarkup(null) };
  for (const type of CHART_PANE_CASES) markup[type] = await paneMarkup(type);
  expect(markup.columnClustered).toContain('docx-color-picker__trigger');
  expect(markup.pie).not.toContain('Category axis title');
  expect(markup.columnClustered).toContain('Category axis title');
  if (process.env.UPDATE_CHART_PANE_MARKUP === '1')
    writeFileSync(CHART_PANE_MARKUP_PATH, `${JSON.stringify(markup, null, 2)}\n`);
  expect(markup).toEqual(JSON.parse(readFileSync(CHART_PANE_MARKUP_PATH, 'utf8')));
});

test('the pane moves the focus to the next row after a remove and to a new row after an add', async () => {
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
      <DocxEditorChartPane />
    </DocxEditorRoot>
  );
  await flush();
  await act(async () => insertParityChart(instance!, 'columnClustered'));
  await flush();
  const buttons = () => [
    ...view.container.querySelectorAll<HTMLButtonElement>('.docx-chart-pane__list button'),
  ];
  await act(async () => buttons()[1]!.click());
  await flush();
  expect(document.activeElement?.getAttribute('data-row')).toBe('1');
  const add = [...view.container.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent === 'Add category'
  )!;
  await act(async () => add.click());
  await flush();
  expect(document.activeElement?.getAttribute('data-row')).toBe('3');
});
