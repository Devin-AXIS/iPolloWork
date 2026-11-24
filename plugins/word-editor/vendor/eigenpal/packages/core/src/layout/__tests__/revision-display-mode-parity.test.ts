// The store lane's `FormattingDisplayMode` and layout's `RevisionDisplayMode` are one union.
//
// The formatting walks live in `store` because the automation lane reaches them on a server
// with no layout at all, and `store` may import no other lane (see
// `packages/core/src/__tests__/core-lane-graph.ts`). So the display mode is spelled twice.
// Two spellings drift: a fourth mode added to layout and not to the store would silently
// fall through the walk's revision gate to the `proposed` arm, and a formatting write in
// that mode would reach the wrong halves with nothing failing.
//
// This test is in the LAYOUT lane because layout may import store; the reverse edge does not
// exist. It asserts nothing at runtime — the assignment is the assertion, and a mismatch is
// a typecheck failure.

import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_FORMATTING_DISPLAY_MODE,
  revisionReachedInMode,
  type FormattingDisplayMode,
} from '../../store/store/formattable-runs.ts';
import type { RevisionDisplayMode } from '../revision-projection.ts';

/** Every member of each union, so a widening on either side breaks the other assignment. */
const LAYOUT_MODES: readonly RevisionDisplayMode[] = ['all-markup', 'proposed', 'original'];
const STORE_MODES: readonly FormattingDisplayMode[] = ['all-markup', 'proposed', 'original'];

describe('display-mode union parity between the store and layout lanes', () => {
  test('each union assigns to the other', () => {
    const asStore: readonly FormattingDisplayMode[] = LAYOUT_MODES;
    const asLayout: readonly RevisionDisplayMode[] = STORE_MODES;
    expect(asStore).toEqual(asLayout);
  });

  test('the formatting default is the resolved view, not the markup one', () => {
    // A lane with no view — the headless automation host — must answer for the text that
    // survives, which is what a caller with no opinion means (#497 item 5).
    expect(DEFAULT_FORMATTING_DISPLAY_MODE).toBe('proposed');
  });

  test('every mode reaches exactly the halves it renders', () => {
    const reach = (mode: FormattingDisplayMode) =>
      (['revisionInsert', 'revisionMoveTo', 'revisionDelete', 'revisionMoveFrom'] as const).filter(
        (kind) => revisionReachedInMode(kind, mode)
      );
    expect(reach('all-markup')).toEqual([
      'revisionInsert',
      'revisionMoveTo',
      'revisionDelete',
      'revisionMoveFrom',
    ]);
    expect(reach('proposed')).toEqual(['revisionInsert', 'revisionMoveTo']);
    expect(reach('original')).toEqual(['revisionDelete', 'revisionMoveFrom']);
  });

  test('a non-revision kind is never a revision wrapper to reach into', () => {
    expect(revisionReachedInMode('run', 'all-markup')).toBe(false);
    expect(revisionReachedInMode('hyperlink', 'all-markup')).toBe(false);
  });
});
