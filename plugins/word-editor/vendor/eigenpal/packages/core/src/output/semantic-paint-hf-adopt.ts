// Repaint the header and footer layer of a retained sheet in place.
//
// A header or footer edit changes the furniture of every page that shows the story. Their
// body blocks, notes and drawings did not move, so the sheet keeps them and only the layer
// the header and footer paint is rebuilt: its behind-text drawings, bands, hover targets,
// page-relative in-front drawings and edit pills.

import type { PageRecord } from '../layout/semantic-records.ts';
import {
  paintHeaderFooterLayer,
  type HeaderFooterLayerPainter,
} from './semantic-paint-hf-layer.ts';

/** Whether a sheet child belongs to the header and footer layer, pills excluded. */
function inLayer(element: HTMLElement): boolean {
  const data = element.dataset;
  return (
    data.docxHfBehind !== undefined ||
    data.docxHfHover !== undefined ||
    data.docxHfFront !== undefined ||
    (data.docxHf !== undefined && !element.classList.contains('docx-hf--placeholder'))
  );
}

/**
 * Replace the header and footer layer on `sheet` with one painted from `page`. Returns false,
 * touching nothing, when the sheet does not hold a layer to replace where the new one goes.
 */
export function replaceHeaderFooterLayer(
  document: Document,
  sheet: HTMLElement,
  page: PageRecord,
  painter: HeaderFooterLayerPainter
): boolean {
  const layer: HTMLElement[] = [];
  const hints: HTMLElement[] = [];
  for (const child of sheet.children as HTMLCollectionOf<HTMLElement>) {
    if (child.dataset.docxHfHint !== undefined) hints.push(child);
    else if (inLayer(child)) layer.push(child);
  }
  if (layer.length === 0) return false;
  const scratch = document.createElement('div');
  const nextHints = paintHeaderFooterLayer(document, scratch, page, painter);
  // Pills go where the old ones were, over the body; with none there, no place is known.
  if (nextHints.length > 0 && hints.length === 0) return false;
  const anchor = layer[0]!;
  for (const element of [...scratch.children]) sheet.insertBefore(element, anchor);
  const hintAnchor = hints.at(-1)?.nextSibling ?? null;
  for (const hint of nextHints) sheet.insertBefore(hint, hintAnchor);
  for (const element of [...layer, ...hints]) element.remove();
  return true;
}
