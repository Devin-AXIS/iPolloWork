// A layout of the pages a body pass has completed so far, for a host that shows them before
// the pass ends (`layout-steps.ts`). It applies what the end of the pass applies to its pages:
// page-field sources and their projection, and list labels on reused records. It writes no
// session state, so the pass that reported the pages can still finish or be dropped.

import { finalizePageFieldProjection, withPageFieldSources } from './field-projection.ts';
import { relabelListMarkers } from './list-marker-reuse.ts';
import type { ResolvedListItem } from './list-resolve.ts';
import type { LayoutSteps } from './layout-steps.ts';
import type { PageRecord, SemanticLayout, TextMeasurer } from './semantic-records.ts';

export interface InterimLayoutInput {
  readonly revision: number;
  readonly numbering?: { readonly start?: number; readonly fmt?: string };
  readonly listItems?: ReadonlyMap<string, ResolvedListItem>;
  readonly measurer?: TextMeasurer;
}

/** `steps`, with every progress report able to build an interim layout of its pages. */
export function* withInterimLayout<T>(
  steps: LayoutSteps<T>,
  input: InterimLayoutInput
): LayoutSteps<T> {
  const finalize = (pages: readonly PageRecord[]): SemanticLayout =>
    relabelListMarkers(
      finalizePageFieldProjection({
        revision: input.revision,
        pages: withPageFieldSources(
          pages,
          input.numbering?.start ?? 1,
          pages.length,
          input.numbering?.fmt
        ),
      }),
      input.listItems,
      input.measurer
    );
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
    yield next.value ? { pages: next.value.pages, finalize } : undefined;
  }
}

/** `steps` with every interim layout it reports relabelled, as {@link withInterimLayout} does. */
export function* withRelabeledProgress<T>(
  steps: LayoutSteps<T>,
  listItems: InterimLayoutInput['listItems'],
  measurer: InterimLayoutInput['measurer']
): LayoutSteps<T> {
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
    const progress = next.value;
    const finalize = progress?.finalize;
    yield finalize
      ? {
          ...progress,
          finalize: (pages) => relabelListMarkers(finalize(pages), listItems, measurer),
        }
      : progress;
  }
}

/**
 * `steps` with every interim layout passed through `align` last, after note areas: section
 * vertical alignment, applied as the finished pass applies it. `align` moves only the pages
 * the pass completed; the pages after them come from the published layout, aligned already.
 */
export function* withAlignedProgress<T>(
  steps: LayoutSteps<T>,
  align: ((layout: SemanticLayout, completed: number) => SemanticLayout) | undefined
): LayoutSteps<T> {
  if (!align) return yield* steps;
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
    const progress = next.value;
    const finalize = progress?.finalize;
    const completed = progress?.pages.length ?? 0;
    yield finalize
      ? { ...progress, finalize: (pages) => align(finalize(pages), completed) }
      : progress;
  }
}
