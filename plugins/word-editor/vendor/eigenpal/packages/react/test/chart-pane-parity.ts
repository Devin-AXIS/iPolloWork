// Shared by the React and Vue Chart pane markup tests: the document, the charts each test
// inserts, and the normalizer. Both adapters must render the same normalized markup, which is
// kept in `chart-pane-markup.json`. Regenerate it from the React test with
// `UPDATE_CHART_PANE_MARKUP=1 bun test packages/react/test/chart-pane-markup.test.tsx`.

import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { differentialDocx } from './cross-adapter-shared.ts';

export const CHART_PANE_SOURCE = differentialDocx('<w:p><w:r><w:t>chart parity</w:t></w:r></w:p>');

export const CHART_PANE_CASES = ['columnClustered', 'pie', 'scatter'] as const;

export const CHART_PANE_MARKUP_PATH = new URL('./chart-pane-markup.json', import.meta.url);

/** Put the caret at the end of the first paragraph and insert a chart of `type`. */
export function insertParityChart(editor: DocxEditorInstance, type: string): void {
  const surface = editor.surface!;
  const paragraphId = surface.session.paragraphIds()[0]!;
  surface.setSelection({
    anchor: { paragraphId, offset: 12 },
    head: { paragraphId, offset: 12 },
  });
  const result = editor.exec({ type: 'insertChart', chartType: type as never });
  if (!result.ok) throw new Error(`insertChart refused: ${result.reason}`);
}

/**
 * The pane markup without what each framework spells its own way: generated ids and the
 * attributes that point at them, Vue scope attributes, and form state attributes (a field's
 * value is a DOM property in both adapters).
 */
export function normalizeChartPaneMarkup(html: string): string {
  return withoutComments(html)
    .replace(/\s(id|for|aria-describedby|aria-controls|value|checked|selected)="[^"]*"/g, '')
    .replace(/\sdata-v-[a-z0-9]+(="[^"]*")?/g, '')
    .replace(/>\s+</g, '><')
    .replace(/="(true|false)"/g, '="$1"')
    .trim();
}

/** Removes HTML comments, repeating until none remain so a removal cannot form a new one. */
function withoutComments(html: string): string {
  let previous: string;
  let current = html;
  do {
    previous = current;
    current = current.replace(/<!--[^]*?-->/g, '');
  } while (current !== previous);
  return current;
}
