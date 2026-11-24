// A filter that only carries viewer settings keeps every revision, so All Markup stays on the
// unfiltered path.

import { describe, expect, test } from 'bun:test';
import { DEFAULT_REVISION_MARKUP } from '../../contracts/revision-markup.ts';
import {
  projectedRevisions,
  revisionAuthorFilter,
  revisionFilterSelects,
  revisionsVisible,
  type RevisionAttribution,
  type RevisionAuthorFilter,
} from '../revision-projection.ts';

const settingsOnly: RevisionAuthorFilter = {
  hiddenAuthors: new Set(),
  revisionMarkup: DEFAULT_REVISION_MARKUP,
  cacheKey: '|markup:default',
};

const deletion: RevisionAttribution = { kind: 'delete', nodeId: 'n1', id: '1', author: 'Ada' };

describe('revisionFilterSelects', () => {
  test('only a filter that hides or excludes something selects', () => {
    expect(revisionFilterSelects(undefined)).toBe(false);
    expect(revisionFilterSelects(settingsOnly)).toBe(false);
    expect(revisionFilterSelects(revisionAuthorFilter(['Ada']))).toBe(true);
    expect(revisionFilterSelects({ ...settingsOnly, includes: () => true })).toBe(true);
    expect(revisionFilterSelects({ ...settingsOnly, includesNode: () => true })).toBe(true);
  });

  test('All Markup with a settings-only filter answers as with no filter', () => {
    const revisions = [deletion];
    expect(projectedRevisions(revisions, 'all-markup', settingsOnly)).toBe(revisions);
    expect(revisionsVisible(revisions, 'all-markup', settingsOnly)).toBe(true);
  });

  test('a hidden author still resolves in All Markup', () => {
    const hidden = revisionAuthorFilter(['Ada']);
    expect(revisionsVisible([deletion], 'all-markup', hidden)).toBe(false);
  });
});
