import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('suite uses the host DSH runtime instead of installing a second copy', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const ownsRuntime = name => name.startsWith('@deepseek-ai/');
  assert.deepEqual(Object.keys(manifest.dependencies).filter(ownsRuntime), []);
  for (const name of ['@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-experimental-liveshare', '@deepseek-ai/dsh-client-ui-settings-account']) {
    assert.equal(manifest.peerDependencies[name], '0.2.2-rc.3');
  }
});
