import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as plugin from '../service/dsh.mjs';

const runtime = process.env.DSH_RUNTIME_ROOT;
test('native DSH registries accept tools/skill and remove them when unmounted', { skip: !runtime }, async () => {
  const require = createRequire(resolve(runtime, 'package.json'));
  const load = name => import(pathToFileURL(require.resolve(name)).href);
  const { Context } = await load('@deepseek-ai/cordis');
  const { default: Tools } = await load('@deepseek-ai/dsh-tools');
  const { default: Skills } = await load('@deepseek-ai/dsh-skill');
  const { default: SystemPrompt } = await load('@deepseek-ai/dsh-system-prompt');
  const ctx = new Context();
  let key;
  ctx.provide('credentials', { resolve: async ref => {
    assert.equal(ref, 'TYPESAFE_API_KEY');
    return key ? { value: key, source: 'test' } : undefined;
  } });
  await ctx.plugin(SystemPrompt, {});
  await ctx.plugin(Tools, {});
  await ctx.plugin(Skills, {});
  const fetcher = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers.authorization, 'Bearer fixture-key');
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({ model: 'jev-test', answers: { x: { type: 'noul', noul: 0.9 } }, usage: { input_tokens: 10, output_tokens: 2 } });
  };
  try {
    const mount = await ctx.plugin(plugin);
    assert.equal(mount.state, 2, 'plugin must reach ACTIVE state');
    const names = ctx.tools.schemas().map(tool => tool.name);
    assert.deepEqual(names.filter(name => name.startsWith('jev_')).sort(), ['jev_check_connection', 'jev_evaluate', 'jev_status']);
    const status = await ctx.tools.get('jev_status').execute({}, { signal: new AbortController().signal });
    assert.equal(status.configured, false);
    assert.equal(status.remoteVerified, false);
    await assert.rejects(ctx.tools.get('jev_evaluate').execute({ state: 'test', questions: { x: { type: 'noul', instructions: 'Yes?' } } }, { signal: new AbortController().signal }), /配置 TypeSafe/);
    key = 'fixture-key';
    const answer = await ctx.tools.get('jev_evaluate').execute({ state: 'test', questions: { x: { type: 'noul', instructions: 'Yes?' } } }, { signal: new AbortController().signal });
    assert.equal(answer.answers.x.noul, 0.9);
    assert.ok((await ctx.skills.list()).some(skill => skill.name === 'jev-decision'));
    await mount.dispose();
    assert.equal(ctx.tools.schemas().filter(tool => tool.name.startsWith('jev_')).length, 0);
    assert.equal((await ctx.skills.list()).some(skill => skill.name === 'jev-decision'), false);
  } finally { globalThis.fetch = fetcher; await ctx.fiber.dispose(); }
});

test('native DSH CLI installs the tarball bundle and removes its configuration', { skip: !runtime || process.env.DSH_CLI_TEST !== '1', timeout: 30_000 }, async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'jev-dsh-cli-'));
  const cli = resolve(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js');
  const run = async args => (await promisify(execFile)(process.execPath, [cli, ...args], { env: { ...process.env, DSH_HOME: root }, timeout: 20_000 })).stdout;
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const archive = new URL(`../dist/${manifest.name}-${manifest.version}.tgz`, import.meta.url);
  try {
    await run(['plugin', '--profile', 'jev-test', 'add', fileURLToPath(archive)]);
    const config = await run(['--profile', 'jev-test', '--dump-config']);
    assert.match(config, /name: dsh-jev-decision-model/);
    await run(['plugin', '--profile', 'jev-test', 'remove', 'dsh-jev-decision-model']);
    assert.doesNotMatch(await run(['--profile', 'jev-test', '--dump-config']), /name: dsh-jev-decision-model/);
    const profile = JSON.parse(await readFile(resolve(root, 'profiles/jev-test/package.json'), 'utf8'));
    assert.ok(!profile.dependencies?.['dsh-jev-decision-model']);
    assert.deepEqual(profile.dsh.profile.bundles, ['@deepseek-ai/dsh-base']);
  } finally { await rm(root, { recursive: true, force: true }); }
});
