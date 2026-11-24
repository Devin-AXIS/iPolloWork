import { expect, test } from 'bun:test';
import { EditorHistoryGroups } from '../editor-history-groups.ts';

function replacedOwner(end: boolean) {
  let current: object | null = { payload: new Uint8Array(1024) };
  const manager = new EditorHistoryGroups(
    () => current,
    () => {},
    () => ''
  );
  const handle = manager.begin();
  const oldOwner = new WeakRef(current);
  if (end) handle.end();
  current = {};
  return { manager, handle, oldOwner };
}

for (const end of [false, true]) {
  test(`${end ? 'ended' : 'expired'} handles do not retain the old document`, async () => {
    const state = replacedOwner(end);
    // WeakRef targets stay alive for the current job. Cross that boundary before GC.
    for (let i = 0; i < 3; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      Bun.gc(true);
    }
    expect(state.handle.state).toBe('closed');
    expect(state.oldOwner.deref()).toBeUndefined();
    expect(state.manager.begin().state).toBe('open');
  });
}
