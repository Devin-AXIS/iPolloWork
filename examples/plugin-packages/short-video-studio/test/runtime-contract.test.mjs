import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireRuntime } from '@ipollowork/ui/runtime-contract';
import { readFile } from 'node:fs/promises';

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
    assert.throws(() => requireRuntime(1, ['Select'], 3), /版本过旧.*更新/);
    globalThis.window.ipolloworkUi = { ...runtime, version: '1.3.0' };
    assert.equal(requireRuntime(1, ['Select'], 3).version, '1.3.0');
    globalThis.window.ipolloworkUi = { ...runtime, version: '1.invalid.0' };
    assert.throws(() => requireRuntime(1, ['Select'], 3), /版本过旧.*更新/);
    for (const incompatible of [undefined, { version: '2.0.0' }, { version: 'unknown' }]) {
      globalThis.window.ipolloworkUi = incompatible;
      assert.throws(() => requireRuntime(1, ['Select']), /不兼容.*更新/);
    }
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});

test('the entire workbench uses shared controls and checks every required capability', async () => {
  const source = await readFile(new URL('../src/ui.mjs', import.meta.url), 'utf8');
  const required = source.match(/requireRuntime\(1,\[([^\]]+)\],3\)/)?.[1];
  assert.ok(required, 'a runtime capability guard precedes bridge startup');
  const capabilities = new Set([...required.matchAll(/'([^']+)'/g)].map(match => match[1]));
  const used = new Set([...source.matchAll(/(?<!\/)\bui\.([A-Za-z]+)\b/g)].map(match => match[1]));
  used.delete('React');
  for (const name of used) assert.ok(capabilities.has(name), `missing runtime capability: ${name}`);
  assert.doesNotMatch(source, /<select\b|<option\b/, 'native select paths were removed, not hidden');
  assert.match(source, /data-ipw-control="button"/);
  assert.match(source, /element\.dataset\.ipwControl = element\.tagName/);
  assert.match(source, /h\(ui\.Checkbox/);
  assert.match(source, /h\(ui\.TabsTrigger/);
  assert.match(source, /h\(ui\.TabsContent/);
  assert.match(source, /'aria-controls': `view-panel-\$\{key\}`/);
  assert.match(source, /ui\?\.toast\.error/);
  assert.match(source, /h\(ui\.Empty/);
  assert.match(source, /h\(ui\.Alert/);
  assert.match(source, /'retry-save'/);
  assert.match(source, /class="size-4" width="16" height="16"/);
  assert.doesNotMatch(source, /showCloseButton: false/);
  const css = await readFile(new URL('../src/ui.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /(?:^|\})button(?:[.:\s,{])|\.tabs button|\.badge\{|dialog\{/);
  const harness = await readFile(new URL('../scripts/dev.mjs', import.meta.url), 'utf8');
  assert.match(harness, /html\.replace\('<head>', \(\) =>/,
    'inject runtime with a callback so React replacement tokens are kept literal');
});
