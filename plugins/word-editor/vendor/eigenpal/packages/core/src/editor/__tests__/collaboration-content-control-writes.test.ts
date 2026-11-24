// Content-control commands go through the collaboration gate and carry the actor.
//
// `execContentControlCommand` and `execInsertContentControl` used to write
// `surface.session.applyTreeOps` directly — the RAW session. With a replica attached that
// skipped `gateOperations`, so a disconnected replica still committed the edit locally and
// never replicated it, and the transaction carried no actor, so two peers minting control
// ids could collide. These tests pin both halves of the fix: a not-ready gate refuses the
// command, and a ready one sees the ops and binds the actor onto the transaction.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import type { TreeDocOp, TreeModelChange } from '@docx-editor.dev/core/store';
import type { EditorCollaborationSession } from '../../collaboration/index.ts';
import { runContentControlCommand } from '../content-controls.ts';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { stubCollaborationSession } from './collaboration-test-module.ts';
import { docx, paragraph, putCaret } from './paginated-surface-fixtures.ts';

const opened: { surface: PaginatedSurface; container: HTMLElement }[] = [];

afterEach(() => {
  for (const item of opened.splice(0)) {
    item.surface.destroy();
    item.container.remove();
  }
});

/** A block plain-text control whose content is one paragraph reading `Enter name`. */
const PLAIN_TEXT_CONTROL =
  '<w:sdt><w:sdtPr><w:text/></w:sdtPr>' +
  `<w:sdtContent>${paragraph('Enter name')}</w:sdtContent></w:sdt>`;

function mount(body: string, overrides: Partial<EditorCollaborationSession>): PaginatedSurface {
  const container = document.createElement('div');
  const result = mountPaginatedSurface(container, docx(body), {
    scale: 1,
    collaborationModel: { session: stubCollaborationSession(overrides) },
  });
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  opened.push({ surface: result.surface, container });
  return result.surface;
}

const NOT_READY: Partial<EditorCollaborationSession> = {
  status: () => 'disconnected',
  statusSnapshot: () =>
    Object.freeze({ status: 'disconnected' as const, reason: undefined, lastFailure: undefined }),
  gateOperations: () => 'collaboration-session-not-ready',
};

describe('content-control commands while the replica is not ready', () => {
  test('insertContentControl is refused and commits nothing', () => {
    const surface = mount(paragraph('Alpha'), NOT_READY);
    putCaret(surface, 2);

    const result = runContentControlCommand(
      { type: 'insertContentControl', subtype: 'richText' },
      surface,
      'edit'
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('collaboration-session-not-ready');
    expect(surface.session.bodyText()).toBe('Alpha');
  });

  test('setContentControlValue is refused and commits nothing', () => {
    const surface = mount(PLAIN_TEXT_CONTROL, NOT_READY);
    putCaret(surface, 2);

    const result = runContentControlCommand(
      { type: 'setContentControlValue', value: 'Ada Lovelace' },
      surface,
      'edit'
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('collaboration-session-not-ready');
    expect(surface.session.bodyText()).toBe('Enter name');
  });
});

describe('content-control commands with a ready replica', () => {
  test('the gate sees the value op and the transaction carries the actor', () => {
    const gated: string[][] = [];
    const surface = mount(PLAIN_TEXT_CONTROL, {
      gateOperations: (ops: readonly TreeDocOp[]) => {
        gated.push(ops.map((op) => op.op));
        return null;
      },
    });
    const changes: TreeModelChange[] = [];
    const unsubscribe = surface.session.subscribe((change) => changes.push(change));
    putCaret(surface, 2);

    const result = runContentControlCommand(
      { type: 'setContentControlValue', value: 'Ada Lovelace' },
      surface,
      'edit'
    );
    unsubscribe();

    expect(result).toEqual({ ok: true, changed: true });
    expect(surface.session.bodyText()).toBe('Ada Lovelace');
    expect(gated).toEqual([['setContentControlValue']]);
    const change = changes.at(-1);
    expect(change?.actorId).toBe('stub-actor');
    expect(change?.operationId).toMatch(/^stub-actor:stub-session:browser:\d+$/);
  });

  test('the gate sees the insertion op and the transaction carries the actor', () => {
    const gated: string[][] = [];
    const surface = mount(paragraph('Alpha'), {
      gateOperations: (ops: readonly TreeDocOp[]) => {
        gated.push(ops.map((op) => op.op));
        return null;
      },
    });
    const changes: TreeModelChange[] = [];
    const unsubscribe = surface.session.subscribe((change) => changes.push(change));
    putCaret(surface, 2);

    const result = runContentControlCommand(
      { type: 'insertContentControl', subtype: 'richText' },
      surface,
      'edit'
    );
    unsubscribe();

    expect(result).toEqual({ ok: true, changed: true });
    expect(gated).toEqual([['insertContentControl']]);
    const change = changes.at(-1);
    expect(change?.actorId).toBe('stub-actor');
    expect(change?.operationId).toMatch(/^stub-actor:stub-session:browser:\d+$/);
  });
});
