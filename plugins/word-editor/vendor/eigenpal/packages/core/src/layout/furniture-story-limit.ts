// A header or footer story holds at most half the sheet height. Its content is measured from its
// first line, so the header or footer distance (§17.6.11 `w:pgMar`) does not count. The first
// line that would end past the limit, and everything after it, is cut: it is not painted and
// takes no height, so the body starts below the last line that fits. Anchored objects keep
// their place, because they never size the story (`HeaderFooterStoryLayout.flowHeight`).
//
// Measured on sheets 841.9pt and 1000pt tall: a 345pt picture line under 76pt of text stays and a
// 350pt one goes (the story would reach 420.8pt and 425.8pt); 420pt stays and 430pt goes on the
// taller sheet. Margins and the header distance do not move the limit. Text after a cut line is
// cut too. Limit: a table that crosses the limit is cut whole, not row by row.

import type { HeaderFooterStoryLayout } from './hf-layout.ts';
import type { BlockFragmentRecord } from './semantic-records.ts';

const TOLERANCE_PT = 0.01;

/** The story height limit on a sheet `pageHeight` tall. */
export function furnitureStoryLimit(pageHeight: number): number {
  return pageHeight / 2;
}

/** The fragments that fit in `limit`, and whether anything was cut. */
function cutFragments(
  fragments: readonly BlockFragmentRecord[],
  limit: number
): { readonly kept: BlockFragmentRecord[]; readonly cut: boolean } {
  const kept: BlockFragmentRecord[] = [];
  let cut = false;
  for (const fragment of fragments) {
    if (fragment.kind === 'paragraph' && fragment.outOfFlow) {
      kept.push(fragment);
      continue;
    }
    if (cut) continue;
    if (fragment.kind === 'table') {
      if (fragment.box.y + fragment.box.height > limit + TOLERANCE_PT) cut = true;
      else kept.push(fragment);
      continue;
    }
    const lines = fragment.lines;
    let fits = 0;
    while (
      fits < lines.length &&
      lines[fits]!.box.y + lines[fits]!.box.height <= limit + TOLERANCE_PT
    )
      fits += 1;
    if (fits === lines.length) {
      kept.push(fragment);
      continue;
    }
    cut = true;
    if (fits === 0) continue;
    const last = lines[fits - 1]!.box;
    const { paragraphEnd: _end, ...rest } = fragment;
    kept.push({
      ...rest,
      lines: lines.slice(0, fits),
      box: { ...fragment.box, height: last.y + last.height - fragment.box.y },
    });
  }
  return { kept, cut };
}

/**
 * `story` cut to the height limit of a sheet `pageHeight` tall. A story within the limit is
 * returned as it is. The page-context layouts of a cut story are cut the same way.
 */
export function limitFurnitureStory(
  story: HeaderFooterStoryLayout,
  pageHeight: number
): HeaderFooterStoryLayout {
  const limit = furnitureStoryLimit(pageHeight);
  const withPageContext: HeaderFooterStoryLayout['withPageContext'] = (context) => {
    const next = story.withPageContext(context);
    return next === story ? limited : limitFurnitureStory(next, pageHeight);
  };
  if (story.flowHeight <= limit + TOLERANCE_PT) return story;
  const { kept, cut } = cutFragments(story.fragments, limit);
  let flowHeight = 0;
  for (const fragment of kept) {
    if (fragment.kind === 'paragraph' && fragment.outOfFlow) continue;
    flowHeight = Math.max(flowHeight, fragment.box.y + fragment.box.height);
  }
  const limited: HeaderFooterStoryLayout = {
    ...story,
    fragments: kept,
    flowHeight: cut ? flowHeight : Math.min(story.flowHeight, limit),
    withPageContext,
  };
  return limited;
}
