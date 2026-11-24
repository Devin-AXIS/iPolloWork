// Paints a spaced table's own fill in its cell-spacing gaps, from layout-published regions.
//
// Each region is a row band less the cells inside it; the cells keep painting their own fill,
// or none. The band is one element under the rows, cut by an even-odd clip path, so the gaps
// fill and every unshaded cell keeps showing the page behind it.

import { tableSpacingShadingRegions } from '../layout/table-spacing-shading.ts';
import { resolveStrictHexFill } from '../layout/ooxml-shading.ts';
import { spacedTableFrameBorders } from '../layout/table-spacing-frame.ts';
import { applyCellBorders } from './semantic-paint-table-borders.ts';
import type { TableFragmentRecord } from '../layout/semantic-records.ts';

/** Class of a gap band: the leading layers of a table fragment, under its rows. */
export const TABLE_SPACING_SHADING_CLASS = 'docx-table-spacing-shading';

/** Class of a spaced table's frame: its outer borders, drawn around the fragment. */
export const TABLE_SPACING_FRAME_CLASS = 'docx-table-spacing-frame';

/** Each painted band's styles but its top, so a repaint that only moves it keeps the element. */
const bandStyles = new WeakMap<Element, string>();

/** Fixed-point numbers keep the clip path short and free of exponent notation. */
const px = (value: number): string => String(Math.round(value * 100) / 100);

/**
 * The gap bands of `fragment`, positioned in the fragment's own box, bottom layer first. A
 * band of `previous` (the fragment's earlier element) that paints the same is reused, so
 * typing in a cell does not rebuild the bands of every other row.
 */
export function paintTableSpacingShading(
  document: Document,
  fragment: TableFragmentRecord,
  scale: number,
  previous?: HTMLElement
): HTMLElement[] {
  // Keyed by everything but the top, so a row that grows only moves the bands below it.
  const reusable = new Map<string, HTMLElement[]>();
  for (const child of previous?.children ?? []) {
    if (!child.classList.contains(TABLE_SPACING_SHADING_CLASS)) break;
    const key = bandStyles.get(child);
    if (key === undefined) continue;
    const same = reusable.get(key);
    if (same) same.push(child as HTMLElement);
    else reusable.set(key, [child as HTMLElement]);
  }
  const bands: HTMLElement[] = [];
  for (const region of tableSpacingShadingRegions(fragment)) {
    // Validated at the sink again, like every other file-derived colour.
    if (resolveStrictHexFill(region.fill) === undefined) continue;
    const { box } = region;
    let clip = '';
    if (region.holes.length > 0) {
      let path = `M0 0H${px(box.width * scale)}V${px(box.height * scale)}H0Z`;
      for (const hole of region.holes) {
        const left = (hole.x - box.x) * scale;
        const top = (hole.y - box.y) * scale;
        path += `M${px(left)} ${px(top)}H${px(left + hole.width * scale)}`;
        path += `V${px(top + hole.height * scale)}H${px(left)}Z`;
      }
      clip = `path(evenodd, "${path}")`;
    }
    const left = `${(box.x - fragment.box.x) * scale}px`;
    const top = `${(box.y - fragment.box.y) * scale}px`;
    const width = `${box.width * scale}px`;
    const height = `${box.height * scale}px`;
    const key = [region.fill, left, width, height, clip].join('|');
    const kept = reusable.get(key)?.shift();
    if (kept) {
      if (kept.style.top !== top) kept.style.top = top;
      bands.push(kept);
      continue;
    }
    const band = document.createElement('div');
    band.className = TABLE_SPACING_SHADING_CLASS;
    // Selection-inert like the border overlay: no caret or range endpoint lands in it.
    band.setAttribute('aria-hidden', 'true');
    band.setAttribute('contenteditable', 'false');
    const style = band.style;
    style.position = 'absolute';
    style.left = left;
    style.top = top;
    style.width = width;
    style.height = height;
    style.backgroundColor = `#${region.fill}`;
    style.pointerEvents = 'none';
    if (clip) style.clipPath = clip;
    bandStyles.set(band, key);
    bands.push(band);
  }
  return bands;
}

/** Each painted frame's borders and size, so a repaint that changes neither keeps it. */
const frameKeys = new WeakMap<Element, string>();

/**
 * The layers a spaced table paints under its rows: the gap bands, then the frame its outer
 * borders draw around the fragment (`table-spacing-frame.ts`). Layers of `previous` that
 * paint the same are reused.
 */
export function paintTableSpacingLayers(
  document: Document,
  fragment: TableFragmentRecord,
  scale: number,
  previous?: HTMLElement
): HTMLElement[] {
  const layers = paintTableSpacingShading(document, fragment, scale, previous);
  const borders = spacedTableFrameBorders(fragment);
  if (!borders) return layers;
  const width = `${fragment.box.width * scale}px`;
  const height = `${fragment.box.height * scale}px`;
  const key = `${width}|${height}|${JSON.stringify(borders.strokes)}`;
  const kept = previousFrame(previous);
  if (kept && frameKeys.get(kept) === key) {
    layers.push(kept);
    return layers;
  }
  const frame = document.createElement('div');
  frame.className = TABLE_SPACING_FRAME_CLASS;
  // Selection-inert like the gap bands: no caret or range endpoint lands in it.
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('contenteditable', 'false');
  const style = frame.style;
  style.position = 'absolute';
  style.left = '0px';
  style.top = '0px';
  style.width = width;
  style.height = height;
  style.pointerEvents = 'none';
  applyCellBorders(document, frame, borders, scale);
  frameKeys.set(frame, key);
  layers.push(frame);
  return layers;
}

/** The frame among the leading layers of `previous`, which come first in it. */
function previousFrame(previous: HTMLElement | undefined): HTMLElement | undefined {
  for (const child of previous?.children ?? []) {
    if (child.classList.contains(TABLE_SPACING_FRAME_CLASS)) return child as HTMLElement;
    if (!child.classList.contains(TABLE_SPACING_SHADING_CLASS)) return undefined;
  }
  return undefined;
}
