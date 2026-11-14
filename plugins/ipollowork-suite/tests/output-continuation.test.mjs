/** Account-model truncation continues through the native inbox without replacing user input. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';

const bundle = await build({ entryPoints: ['src/host/output-continuation.ts'], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['@deepseek-ai/dsh-llm'] });
const module = { exports: {} };
runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: () => ({ createUserMessage: input => ({ id: 'continuation', ...input }) }) });

function fixture() {
  const listeners = new Map(), submitted = [], disposers = [];
  const agent = { inbox: { nextTurn: [], nextStep: [], splice: (_target, start, count) => agent.inbox.nextStep.splice(start, count) }, steer: message => { submitted.push(message); agent.inbox.nextStep.push(message); } };
  module.exports.mountOutputContinuation({ agents: { get: () => agent }, on: (name, callback) => listeners.set(name, callback), effect: setup => disposers.push(setup()) });
  const response = ({ provider = 'ipollo-bailian', finish = 'max-tokens', content = [] } = {}) => listeners.get('session/event')({ id: 'session' }, {
    type: 'assistant/message', data: { message: { source: { provider }, content }, stream: [{ type: 'chunk', chunk: { type: 'finish', reason: { kind: finish } } }] },
  });
  const stop = (aborted = false) => listeners.get('agent/turn-stopping')({ agent, signal: { aborted } });
  return { agent, submitted, response, stop, dispose: () => { disposers.forEach(dispose => dispose()); listeners.clear(); } };
}

test('a committed truncated response resumes once with recorded, non-user attribution', () => {
  const f = fixture(); f.response(); f.stop(); f.stop();
  assert.equal(f.submitted.length, 1);
  assert.equal(f.submitted[0].source.kind, 'ipollowork-output-continuation');
  assert.match(f.submitted[0].content[0].text, /saved state/);
  f.response({ finish: 'stop' }); f.stop();
  assert.equal(f.submitted.length, 1);
});

test('unloading removes only the unclaimed automatic continuation', () => {
  const f = fixture(); f.response(); f.stop();
  const human = { id: 'human', source: { kind: 'user' } };
  f.agent.inbox.nextStep.push(human);
  f.dispose();
  assert.deepEqual(f.agent.inbox.nextStep, [human]);
});

test('normal providers, unresolved tools, cancellation and queued human work are preserved', () => {
  for (const setup of [
    f => f.response({ provider: 'deepseek-official' }),
    f => f.response({ finish: 'stop' }),
    f => f.response({ content: [{ type: 'tool-call' }] }),
    f => { f.response(); f.agent.inbox.nextTurn.push({ id: 'human' }); },
    f => { f.response(); f.agent.inbox.nextStep.push({ id: 'human' }); },
  ]) { const f = fixture(); setup(f); f.stop(); assert.equal(f.submitted.length, 0); }
  const f = fixture(); f.response(); f.stop(true); assert.equal(f.submitted.length, 0);
});
