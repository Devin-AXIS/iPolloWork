import { finalizePageFieldProjection, withPageFieldSources } from './field-projection.ts';
import { remapPage } from './hf-layout.ts';
import type { LayoutSteps } from './layout-steps.ts';
import type { SectionLayoutResult } from './multi-section-layout.ts';
import type { PageRecord } from './semantic-records.ts';
import { SHEET_GUTTER_PT } from './section-page-furniture.ts';

/**
 * Re-report a section pass's completed pages as the document's: the sheets before the section,
 * then the section's pages so far, numbered and stacked as the final publish places them. A
 * host puts a paused pass back with `snapshotLayoutSession`, which covers the section sessions.
 */
export function* sectionProgress(
  steps: LayoutSteps<SectionLayoutResult>,
  before: readonly PageRecord[] | null,
  sheetY: number,
  displayedStart: number,
  format: string | undefined,
  revision: number
): LayoutSteps<SectionLayoutResult> {
  // Each completed page publishes once, here, without the shared publish memo: the final
  // publish knows the section's page count and must find the memo as the last pass left it.
  const published: PageRecord[] = [];
  const sources: PageRecord[] = [];
  let y = sheetY;
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
    const partial = next.value?.pages;
    if (!before || !partial) {
      yield undefined;
      continue;
    }
    let from = 0;
    while (from < sources.length && from < partial.length && sources[from] === partial[from]) {
      from += 1;
    }
    if (from === partial.length && from === sources.length) {
      yield undefined;
      continue;
    }
    published.length = from;
    sources.length = from;
    const last = published[from - 1];
    y = last ? last.box.y + last.box.height + SHEET_GUTTER_PT : sheetY;
    for (let offset = from; offset < partial.length; offset += 1) {
      const page = partial[offset]!;
      const remapped = remapPage(page, before.length + offset, y);
      const sheet = withPageFieldSources(
        [remapped],
        displayedStart + offset,
        partial.length,
        format
      )[0]!;
      published.push(sheet);
      sources.push(page);
      y = sheet.box.y + sheet.box.height + SHEET_GUTTER_PT;
    }
    yield {
      pages: [...before, ...published],
      finalize: (pages) => finalizePageFieldProjection({ revision, pages }),
    };
  }
}
