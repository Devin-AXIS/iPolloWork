import {
  DEFAULT_REVISION_MARKUP,
  type ResolvedRevisionMarkup,
} from '../contracts/revision-markup.ts';
import type { RevisionAuthorFilter } from '../layout/revision-projection.ts';
import { findNode, parentNodeOf, type OoxmlPart } from '@docx-editor.dev/core/store';
import { markRemovedInMode } from '../layout/revision-visibility.ts';
import { mergedFlowBlocks } from '../layout/story-roots.ts';
import type { RevisionDisplayMode } from '../layout/revision-projection.ts';

/** Viewer settings participate in layout cache identity without changing the package. */
export function createSurfaceRevisionMarkup(
  initial: ResolvedRevisionMarkup | undefined,
  baseFilter: () => RevisionAuthorFilter | undefined,
  beforeChange: () => void,
  afterChange: () => void
) {
  let current = initial ?? DEFAULT_REVISION_MARKUP;
  let previousBase: RevisionAuthorFilter | undefined;
  let previousSettings: ResolvedRevisionMarkup | undefined;
  let cached: RevisionAuthorFilter | undefined;
  return {
    current: () => current,
    filter(): RevisionAuthorFilter {
      const base = baseFilter();
      if (!cached || base !== previousBase || current !== previousSettings) {
        previousBase = base;
        previousSettings = current;
        cached = {
          ...base,
          hiddenAuthors: base?.hiddenAuthors ?? new Set(),
          revisionMarkup: current,
          cacheKey: `${base?.cacheKey ?? ''}|markup:${JSON.stringify(current)}`,
        };
      }
      return cached;
    },
    set(next: ResolvedRevisionMarkup) {
      if (JSON.stringify(next) === JSON.stringify(current)) return;
      beforeChange();
      current = next;
      afterChange();
    },
  };
}

export function revisionFacingPages(settings: OoxmlPart | null): boolean {
  return (
    settings?.root.children.some(
      (node) =>
        node.kind !== 'textValue' &&
        (node.localName === 'mirrorMargins' || node.localName === 'evenAndOddHeaders') &&
        !node.attributes.some(
          (attribute) =>
            attribute.localName === 'val' && ['0', 'false', 'off'].includes(attribute.value)
        )
    ) ?? false
  );
}

/** Keep paragraph-mark editing aligned with revision paragraph joins. */
export function revisionParagraphMarkVisible(
  part: OoxmlPart,
  paragraphId: string,
  displayMode: RevisionDisplayMode,
  authorFilter: RevisionAuthorFilter
): boolean {
  const paragraph = findNode(part, paragraphId);
  if (paragraph?.kind !== 'paragraph') return false;
  if (!markRemovedInMode(paragraph, displayMode, authorFilter)) return true;
  const parent = parentNodeOf(part, paragraphId);
  if (!parent) return false;
  return mergedFlowBlocks(parent.children, displayMode, authorFilter).some(
    (block) => block.kind === 'paragraph' && block.id === paragraphId
  );
}
