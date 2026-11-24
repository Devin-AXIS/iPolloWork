// Which review writes a replica admits, and why the default is "none".
//
// Review writes reach the store directly instead of through `applyTreeOps`, and the ones that
// graft a package and swap the shell record no primitive effects — so they replicate as nothing
// and leave the peer a `commentReference` naming a comment it never received. The gate therefore
// FAILS CLOSED: an intent is admitted only once a two-replica test proves it arrives whole, and an
// unnamed intent is refused. `run` is never called for a refused write, which is what these
// assertions observe.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import type { EditorCollaborationSession } from '../../collaboration/index.ts';
import type { ReviewWriteIntent } from '../paginated-surface-contract.ts';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { stubCollaborationSession } from './collaboration-test-module.ts';
import { docx, paragraph } from './paginated-surface-fixtures.ts';

const opened: { surface: PaginatedSurface; container: HTMLElement }[] = [];

afterEach(() => {
  for (const item of opened.splice(0)) {
    item.surface.destroy();
    item.container.remove();
  }
});

function mount(
  withReplica: boolean,
  overrides: Partial<EditorCollaborationSession> = {}
): PaginatedSurface {
  const container = document.createElement('div');
  const result = mountPaginatedSurface(container, docx(paragraph('Alpha')), {
    scale: 1,
    ...(withReplica
      ? { collaborationModel: { session: stubCollaborationSession(overrides) } }
      : {}),
  });
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  opened.push({ surface: result.surface, container });
  return result.surface;
}

/** Whether the surface let the write run. */
function attempted(surface: PaginatedSurface, intent?: ReviewWriteIntent): boolean {
  let ran = false;
  surface.commitReviewOps(() => {
    ran = true;
    return { committed: true };
  }, intent);
  return ran;
}

// A Record over the union, not a plain array: adding an intent to `ReviewWriteIntent` without
// listing it here fails to COMPILE, so a new review write cannot reach a replica untested.
const INTENT_COVERAGE: Record<ReviewWriteIntent, true> = {
  'comment-add': true,
  'comment-delete': true,
  'comment-reply': true,
  'comment-resolve': true,
  'comment-edit': true,
  'package-scoped': true,
  'revision-resolve': true,
  'revision-attribution': true,
};

const ALL_INTENTS = Object.keys(INTENT_COVERAGE) as readonly ReviewWriteIntent[];

/** The intents a two-replica test proves arrive whole. */
const PROVEN: readonly ReviewWriteIntent[] = [
  'comment-add',
  'comment-delete',
  'comment-reply',
  'comment-resolve',
  'comment-edit',
  'package-scoped',
  'revision-resolve',
  'revision-attribution',
];

describe('review writes with a replica attached', () => {
  test('admits the writes a two-replica test proves arrive whole', () => {
    const surface = mount(true);
    for (const intent of PROVEN) {
      expect(attempted(surface, intent)).toBe(true);
    }
  });

  test('covers every intent the contract declares, so a new one cannot be forgotten here', () => {
    // Sorted equality, not a count: an intent added to the union without a proof and without a
    // line in this list would otherwise be admitted by `REPLICABLE_REVIEW_WRITES` silently.
    expect([...PROVEN].sort()).toEqual([...ALL_INTENTS].sort());
  });

  test('refuses an unnamed write, so a new call site cannot slip through', () => {
    expect(attempted(mount(true), undefined)).toBe(false);
  });
});

describe('review writes with a replica that is not ready', () => {
  // Readiness is asked in addition to the intent set: an admitted intent on a replica that
  // is not `ready` would commit locally and replicate nothing, which is the silent-divergence
  // failure the gate exists to prevent.
  test('refuses an admitted intent and records the gate reason', () => {
    const surface = mount(true, {
      status: () => 'disconnected',
      statusSnapshot: () =>
        Object.freeze({
          status: 'disconnected' as const,
          reason: undefined,
          lastFailure: undefined,
        }),
      gateOperations: () => 'collaboration-session-not-ready',
    });
    for (const intent of PROVEN) {
      expect(attempted(surface, intent)).toBe(false);
    }
    expect(surface.state().lastRejection).toBe('collaboration-session-not-ready');
  });
});

describe('review writes with no replica', () => {
  test('runs every write, named or not', () => {
    const surface = mount(false);
    for (const intent of ALL_INTENTS) {
      expect(attempted(surface, intent)).toBe(true);
    }
    expect(attempted(surface, undefined)).toBe(true);
  });
});
