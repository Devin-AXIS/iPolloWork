// A STUB review module for core's seam tests.
//
// Core tests exercise the seam's mechanics — display-mode gating, command
// enablement, chrome reasons — which depend on a review contribution being
// REGISTERED, not on what it derives. The real derivation lives in
// `@docx-editor.dev/pro` (a package core must not depend on, even in tests);
// its integration tests live there and use the real `reviewModule()`.

import type { EditorModule } from '../../contracts/modules.ts';

export function stubReviewModule(): EditorModule {
  return {
    id: 'review',
    review: {
      displayModes: ['all-markup', 'proposed', 'original'],
      collectReviewItems: () => [],
      revisionItemsOfParagraph: () => [],
    },
  };
}
