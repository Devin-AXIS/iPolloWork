import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { load } from 'js-yaml';

test('suite uses the host DSH runtime instead of installing a second copy', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const ownsRuntime = name => name.startsWith('@deepseek-ai/');
  assert.deepEqual(Object.keys(manifest.dependencies).filter(ownsRuntime), []);
  for (const name of ['@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-experimental-liveshare', '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-settings']) {
    assert.equal(manifest.peerDependencies[name], '0.2.2-rc.3');
  }
});

test('activation preserves the official plugin manager and its Remote definitions', async () => {
  const patch = load(await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8'));
  assert(!patch.some(entry => entry.id === 'plugin-manager'));
  const inserted = patch.flatMap(entry => entry.insert ?? []);
  assert(!inserted.some(entry => /plugin-manager/.test(entry.name)));
  assert.deepEqual(inserted.filter(entry => entry.name.startsWith('@ipollo/')).map(entry => entry.id), [
    'ipollowork-onboarding', 'ipollowork-suite', 'ipollowork-agents', 'ipollowork-im',
  ]);
});

test('the plugin title is iPolloWork in every packaged locale', async () => {
  for (const locale of ['en', 'zh']) {
    const data = JSON.parse(await readFile(new URL(`../locale/${locale}.json`, import.meta.url), 'utf8'));
    assert.equal(data.meta.title, 'iPolloWork');
  }
});
