// Copy, cut and paste of ONE selected chart. A chart is a set of package parts, not text, so
// the clipboard cannot carry it as an interop fragment. The copy keeps the chart in memory
// instead: the package as it was at the copy, and the chart drawing in it, under a random
// token. The clipboard gets the chart's name as plain text and an inert HTML element that
// names the token. A paste that brings the token back copies the chart into the document.
//
// Only the latest copy is kept, and only in this page: a token from an older copy, another
// page or another browser refuses rather than pasting something else. Any editor in the page
// can paste the copy, as the source package is plain data.

import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import type { OoxmlNode } from '../store/package/ooxml-tree.ts';
import { chartTargetIn, type ChartCopySource } from '../store/store/tree-package-charts.ts';
import { chartDrawingOf } from '../store/store/tree-op-chart-drawing.ts';
import { WP_NAMESPACE_URI } from '../store/package/ooxml-shared.ts';

/** The HTML attribute that names a copied chart on the clipboard. */
export const CHART_CLIPBOARD_ATTRIBUTE = 'data-docx-editor-chart';

/**
 * The engine's reason for a refused paste of a chart that is no longer in memory. Adapters
 * translate it through `DISABLED_REASON_KEYS` in `@docx-editor.dev/i18n`.
 */
export const CHART_CLIPBOARD_STALE_REASON =
  'the copied chart is no longer available; copy the chart again';

let latest: { readonly token: string; readonly source: ChartCopySource } | null = null;

function randomToken(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The `wp:docPr` name of a drawing, or the empty string. */
function drawingName(drawing: OoxmlNode): string {
  const stack: OoxmlNode[] = [drawing];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.kind === 'textValue') continue;
    if (node.namespaceUri === WP_NAMESPACE_URI && node.localName === 'docPr') {
      const name = node.attributes.find((a) => a.namespaceUri === '' && a.localName === 'name');
      return name?.value ?? '';
    }
    for (const kid of node.children) stack.push(kid);
  }
  return '';
}

/** The chart drawing `drawingNodeId` of `ownerPart` as a copy source, or null for another drawing. */
export function chartCopySourceOf(
  pkg: OoxmlPackage,
  ownerPart: string,
  drawingNodeId: string
): ChartCopySource | null {
  const part = pkg.parts.get(ownerPart);
  if (!part || !chartTargetIn(pkg, ownerPart, drawingNodeId)) return null;
  const chart = chartDrawingOf(part, drawingNodeId);
  if (!chart || chart.chartDrawing.kind !== 'drawing') return null;
  return { pkg, ownerPart, drawing: chart.chartDrawing };
}

/**
 * Keep `source` as the latest copied chart and return its clipboard flavours: the chart's name
 * as plain text, and an inert element that names the copy.
 */
export function chartClipboardFlavours(source: ChartCopySource): {
  readonly text: string;
  readonly html: string;
} {
  const token = randomToken();
  latest = { token, source };
  const text = drawingName(source.drawing);
  return {
    text,
    html: `<meta charset="utf-8"><span ${CHART_CLIPBOARD_ATTRIBUTE}="${token}">${escapeHtml(text)}</span>`,
  };
}

/** The copied chart token that `html` names, or null when it names none. */
export function chartClipboardToken(html: string | null): string | null {
  if (!html || !html.includes(CHART_CLIPBOARD_ATTRIBUTE)) return null;
  const match = /data-docx-editor-chart="([0-9a-f]{32})"/.exec(html);
  return match ? match[1]! : null;
}

/** The copied chart for `token`, or null when it is not the latest copy in this page. */
export function chartCopyFor(token: string): ChartCopySource | null {
  return latest && latest.token === token ? latest.source : null;
}

/** Forget the latest copy. For tests. */
export function resetChartClipboard(): void {
  latest = null;
}
