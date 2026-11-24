// The body pages of a published layout.
//
// A notes pass publishes the body with note-only overflow sheets inserted, and that published
// layout is what the session keeps as the previous pass. A body pass reuses previous pages by
// the count of body pages its checkpoints completed. Read against the published list, that
// count reached past a sheet the notes pass added, so a resumed pass took the sheet in as a
// body page and counted it in every page's section page count. A fresh pass never does.

import { remapPage } from './hf-layout.ts';
import type { PageRecord, SemanticLayout } from './semantic-records.ts';

const bodyLayouts = new WeakMap<SemanticLayout, SemanticLayout>();

/**
 * `layout` without its note-only overflow sheets. A page after a removed sheet takes the
 * index and position the sheets before it gave up.
 */
export function previousBodyLayout(layout: SemanticLayout | null): SemanticLayout | null {
  if (!layout) return layout;
  // Every body pass of every section asks; most layouts hold no note-only sheet.
  let notes = false;
  for (let at = 0; at < layout.pages.length && !notes; at += 1) {
    notes = layout.pages[at]!.noteStream !== undefined;
  }
  if (!notes) return layout;
  const cached = bodyLayouts.get(layout);
  if (cached) return cached;
  const pages: PageRecord[] = [];
  for (const page of layout.pages) {
    if (page.noteStream !== undefined) continue;
    const index = pages.length;
    pages.push(page.index === index ? page : remapPage(page, index, layout.pages[index]!.box.y));
  }
  const body: SemanticLayout = { ...layout, pages };
  bodyLayouts.set(layout, body);
  return body;
}
