import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { harnessConnection } from '../vendor/dsh-im/plugin-src/host/harness-connection.mjs';

test('IM resolves its shared identity through the current Cordis root symbol', async () => {
  const ctx = new Context();
  ctx.provide('connection', { createPeer: () => ({ dispose: async () => {} }) });
  ctx.provide('typertGateway', { invoke: async () => {}, stream: async function* () {} });
  let connected;
  try {
    await ctx.plugin({ inject: ['connection', 'typertGateway'], apply(scope) { connected = harnessConnection(scope); } });
    assert.equal(connected.interactionScope, ctx);
    assert.equal(typeof connected.apiProxy.sessions.create, 'function');
  } finally { await ctx.fiber.dispose(); }
});
