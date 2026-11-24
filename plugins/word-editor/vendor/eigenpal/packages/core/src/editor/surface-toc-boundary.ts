import type { OoxmlPart } from '@docx-editor.dev/core/store';
import { selectionRects } from '../layout/selection-rects.ts';
import type { TextMeasurer } from '../layout/semantic-records.ts';
import { tocParagraphRanges } from './surface-toc-ranges.ts';
// TOC hover geometry for both authored content controls and plain complex fields.
import { contentControlsInLayout } from '../layout/semantic-interaction.ts';
import type { DetectedToc } from '../store/package/toc-detect.ts';
import { paragraphFragmentsOf } from '../layout/semantic-record-queries.ts';
import type { ContentControlBoundaryRecord, SemanticLayout } from '../layout/semantic-records.ts';
import { paragraphContentBounds } from '../layout/paragraph-content-bounds.ts';

export function tocBoundaryForLayout(
  toc: DetectedToc,
  currentLayout: SemanticLayout,
  part: OoxmlPart,
  measurer: TextMeasurer
): {
  readonly tocId: string;
  readonly boundary: ContentControlBoundaryRecord;
  readonly additional: boolean;
} | null {
  const existing = toc.contentControlId
    ? contentControlsInLayout(currentLayout).find((control) => control.id === toc.contentControlId)
    : undefined;
  const ranges = tocParagraphRanges(part).filter((range) => range.toc.id === toc.id);
  const partial = ranges.some((range) => range.start > 0 || range.end < range.length);
  if (existing && !partial) return { tocId: toc.id, boundary: existing, additional: false };

  const byParagraph = new Map(ranges.map((range) => [range.paragraphId, range]));
  const partialRects = ranges
    .filter((range) => range.start > 0 || range.end < range.length)
    .flatMap((range) =>
      selectionRects(
        currentLayout,
        {
          anchor: { paragraphId: range.paragraphId, offset: range.start },
          head: { paragraphId: range.paragraphId, offset: range.end },
        },
        [range.paragraphId],
        measurer
      )
    );
  const fragments = currentLayout.pages.flatMap((page) => {
    const boxes = paragraphFragmentsOf(page)
      .filter((fragment) => {
        const range = byParagraph.get(fragment.paragraphId);
        return range && range.start === 0 && range.end === range.length;
      })
      .map(paragraphContentBounds);
    boxes.push(...partialRects.filter((rect) => rect.pageIndex === page.index));
    if (boxes.length === 0) return [];
    const left = Math.min(...boxes.map((box) => box.x));
    const top = Math.min(...boxes.map((box) => box.y));
    const right = Math.max(...boxes.map((box) => box.x + box.width));
    const bottom = Math.max(...boxes.map((box) => box.y + box.height));
    return [
      {
        pageIndex: page.index,
        box: { x: left, y: top, width: right - left, height: bottom - top },
      },
    ];
  });
  if (fragments.length === 0) return null;
  return {
    tocId: toc.id,
    additional: true,
    boundary: {
      id: `toc:${toc.id}`,
      controlType: 'richText',
      lock: 'unlocked',
      effectiveLock: 'unlocked',
      placeholder: false,
      bound: false,
      nestingDepth: 0,
      level: 'block',
      fragments,
    },
  };
}
