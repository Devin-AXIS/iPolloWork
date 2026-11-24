import {
  collectReviewItems as engineCollectReviewItems,
  findNode,
  revisionItemsOf,
} from '@docx-editor.dev/core/store';
import type { EditorModule } from '../../contracts/modules.ts';
import type { AcceptedTextRange } from '../../contracts/editor.ts';
import { mountAnchorEditor } from './scroll-to-anchor-fixture.ts';

/** A review module, so suggesting mode is available. */
export function reviewModule(): EditorModule {
  return {
    id: 'review',
    review: {
      displayModes: ['all-markup', 'proposed', 'original'],
      collectReviewItems: engineCollectReviewItems,
      revisionItemsOfParagraph: (part, paragraphId) => {
        const paragraph = findNode(part, paragraphId);
        if (!paragraph || paragraph.kind !== 'paragraph') return [];
        return revisionItemsOf({ ...part, root: paragraph });
      },
    },
  };
}

/** An editor with an author and the review module. */
export function openReviewEditor(bytes: Uint8Array) {
  return mountAnchorEditor(bytes, { author: 'Grace Hopper', modules: [reviewModule()] });
}

/** A `replaceAcceptedText` command. */
export function fix(
  blockId: string,
  start: number,
  length: number,
  text: string,
  expectedText?: string
) {
  const match: AcceptedTextRange = {
    blockId,
    start,
    length,
    ...(expectedText === undefined ? {} : { expectedText }),
  };
  return { type: 'replaceAcceptedText' as const, match, text };
}
