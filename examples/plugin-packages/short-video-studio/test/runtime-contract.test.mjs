import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireRuntime } from '@ipollowork/ui/runtime-contract';

test('legacy consumers remain compatible; new components require actual capabilities', () => {
  const previous = globalThis.window;
  try {
    for (const version of ['1.0.0', '1.0.1', '1.1.0']) {
      globalThis.window = { ipolloworkUi: { version } };
      assert.equal(requireRuntime().version, version);
      assert.throws(() => requireRuntime(1, ['Select', 'Dialog', 'toast']), /缺少.*更新/);
    }
    const runtime = { version: '1.1.0', Select() {}, Dialog() {}, toast() {} };
    globalThis.window = { ipolloworkUi: runtime };
    assert.equal(requireRuntime(1, ['Select', 'Dialog', 'toast']), runtime);
    for (const incompatible of [undefined, { version: '2.0.0' }, { version: 'unknown' }]) {
      globalThis.window.ipolloworkUi = incompatible;
      assert.throws(() => requireRuntime(1, ['Select']), /不兼容.*更新/);
    }
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});
