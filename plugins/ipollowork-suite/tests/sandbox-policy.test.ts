/** Both backends use the same official permission and lifecycle pipeline. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { Context } from '@deepseek-ai/cordis';
import { ToolCallId } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy';
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit';
import { executeModelToolFixture } from '@deepseek-ai/dsh-tool-testkit';
import { applyWithFactory } from '../src/host/sandbox/tools.ts';
import type { RemoteSandbox } from '../src/host/sandbox/runtime.ts';

test('cloud tools reject read-only execution before allocation and unregister on unload', async () => {
  const ctx = new Context();
  const prior = process.env.IPOLLO_POLICY_TEST_KEY;
  process.env.IPOLLO_POLICY_TEST_KEY = 'test-only-secret';
  let creates = 0;
  try {
    await mountAgentLoopTestDependencies(ctx);
    await ctx.plugin(SandboxPolicy, { mode: 'read-only' });
    const harness = await mountAgentLoopTestHarness(ctx);
    const agent = await harness.create(SessionId('cloud-read-only'));
    const fiber = ctx.plugin({
      inject: ['tools', 'agents', 'sandboxPolicy'],
      apply(scope: Context) {
        applyWithFactory(scope, { endpoint: 'https://sandbox.example.com', image: 'test', apiKeyEnv: 'IPOLLO_POLICY_TEST_KEY' }, async (): Promise<RemoteSandbox> => {
          creates++;
          throw new Error('read-only must not allocate');
        });
      },
    });
    await fiber;
    const schemas = ctx.tools.schemas().filter(tool => tool.name.startsWith('sandbox_'));
    const path = new URL('./expected/sandbox-tools.schemas.json', import.meta.url);
    if (process.env.UPDATE_SANDBOX_SNAPSHOT === '1') await writeFile(path, JSON.stringify(schemas, null, 2) + '\n');
    assert.deepEqual(schemas, JSON.parse(await readFile(path, 'utf8')));
    for (const [name, args] of [
      ['sandbox_exec', { command: 'printf hello' }],
      ['sandbox_read_file', { path: '/tmp/file' }],
      ['sandbox_write_file', { path: '/tmp/file', text: 'hello' }],
      ['sandbox_release', {}],
    ] as const) {
      const result = await executeModelToolFixture(ctx, { agent, callId: ToolCallId(name), name, arguments: args, signal: new AbortController().signal });
      assert.equal(result.isError, true);
      assert.equal(result.error?.info?.code, 'SANDBOX_INPUT_INVALID');
    }
    assert.equal(creates, 0);
    await fiber.dispose();
    assert.equal(ctx.tools.schemas().some(tool => tool.name.startsWith('sandbox_')), false);
  } finally {
    await ctx.fiber.dispose();
    if (prior === undefined) delete process.env.IPOLLO_POLICY_TEST_KEY;
    else process.env.IPOLLO_POLICY_TEST_KEY = prior;
  }
});
