import test from 'node:test';
import assert from 'node:assert/strict';
import { settingsSchema } from '../src/host/sandbox/common-config.ts';
import { SandboxRuntime, executeCommand, type RemoteSandbox, type SandboxFactory } from '../src/host/sandbox/runtime.ts';
import type { SandboxId } from '../src/host/sandbox/runtime.ts';

const settings = settingsSchema.parse({ endpoint: 'http://localhost:8080', image: 'test', maxOutputBytes: 1024 });
const signal = new AbortController().signal;
function fake(id: string): RemoteSandbox & { kills: number; closes: number } {
  return {
    id: id as SandboxId, kills: 0, closes: 0,
    commands: { async run(_command, _opts, handlers) { await handlers.onStdout?.({ text: 'hello', timestamp: 0 }); return { logs: { stdout: [], stderr: [] }, result: [], exitCode: 0 }; } },
    files: { async readBytes() { return Buffer.from('file'); }, async writeFiles() {} },
    async kill() { this.kills++; }, async close() { this.closes++; },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

test('lazy allocation, session isolation, reuse and release', async () => {
  const remotes: ReturnType<typeof fake>[] = [];
  const runtime = new SandboxRuntime(settings, 'test-key', async () => { const remote = fake(String(remotes.length)); remotes.push(remote); return remote; });
  assert.equal(remotes.length, 0);
  const a = await runtime.run('a', signal, async remote => remote.id);
  assert.equal(await runtime.run('a', signal, async remote => remote.id), a);
  assert.notEqual(await runtime.run('b', signal, async remote => remote.id), a);
  await runtime.release('a');
  assert.equal(remotes[0]?.kills, 1);
  assert.equal(remotes[0]?.closes, 1);
  await runtime.run('a', signal, async remote => remote.id);
  assert.equal(remotes.length, 3);
  await runtime.dispose();
  assert(remotes.every(remote => remote.kills === 1 && remote.closes === 1));
});

test('same-session calls serialize while pending creates count toward capacity', async () => {
  const gate = deferred<RemoteSandbox>();
  let creates = 0;
  const runtime = new SandboxRuntime({ ...settings, maxSandboxes: 1 }, 'key', async () => { creates++; return gate.promise; });
  const first = runtime.run('a', signal, async remote => remote.id);
  const second = runtime.run('a', signal, async remote => remote.id);
  await assert.rejects(runtime.run('b', signal, async () => {}), { code: 'SANDBOX_LIMIT' });
  assert.equal(creates, 1);
  gate.resolve(fake('a'));
  assert.equal(await first, await second);
  await runtime.dispose();
});

test('unload waits for creation, deletes late allocation and rejects new work', async () => {
  const gate = deferred<RemoteSandbox>();
  const started = deferred<void>();
  const runtime = new SandboxRuntime(settings, 'key', async () => { started.resolve(); return gate.promise; });
  const call = runtime.run('a', signal, async () => {});
  const rejected = assert.rejects(call, { name: 'AbortError' });
  await started.promise;
  let finished = false;
  const closing = runtime.dispose().then(() => { finished = true; });
  await assert.rejects(runtime.run('b', signal, async () => {}), { code: 'SANDBOX_CLOSED' });
  await Promise.resolve();
  assert.equal(finished, false);
  const remote = fake('late');
  gate.resolve(remote);
  await Promise.all([rejected, closing]);
  assert.equal(remote.kills, 1);
  assert.equal(remote.closes, 1);
});

test('cancellation quarantines and deletes a possibly running command before settling', async () => {
  const remote = fake('cancel');
  const started = deferred<void>();
  const controller = new AbortController();
  const runtime = new SandboxRuntime(settings, 'secret', async () => remote);
  const call = runtime.run('a', controller.signal, async (_remote, currentSignal) => {
    started.resolve();
    await new Promise<void>((_resolve, reject) => currentSignal.addEventListener('abort', () => reject(currentSignal.reason), { once: true }));
  });
  const rejected = assert.rejects(call, { name: 'AbortError' });
  await started.promise;
  controller.abort(new DOMException('Cancelled', 'AbortError'));
  await rejected;
  assert.equal(remote.kills, 1);
  assert.equal(remote.closes, 1);
  await runtime.dispose();
});

test('failed delete remains quarantined and is retried by explicit release', async () => {
  const remote = fake('failed');
  let fail = true;
  remote.kill = async () => { if (fail) throw new Error('sensitive provider response'); remote.kills++; };
  const runtime = new SandboxRuntime(settings, 'secret', async () => remote);
  await runtime.run('a', signal, async () => {});
  await assert.rejects(runtime.release('a'), { code: 'SANDBOX_RELEASE_FAILED' });
  await assert.rejects(runtime.run('a', signal, async () => {}), { code: 'SANDBOX_RELEASE_FAILED' });
  assert.equal(remote.closes, 1, 'failed deletion still closes the local transport');
  fail = false;
  await runtime.release('a');
  await runtime.dispose();
});

test('failed creation redacts provider secrets and permits later explicit retry', async () => {
  const create: SandboxFactory = async () => { throw new Error('token=secret'); };
  const runtime = new SandboxRuntime(settings, 'secret', create);
  await assert.rejects(runtime.run('a', signal, async () => {}), error => {
    assert(error instanceof Error);
    assert(!String(error).includes('token=secret'));
    assert.equal(error.cause, undefined);
    return true;
  });
  await runtime.dispose();
});

test('bounded streaming retains nonzero exit status and does not accumulate SDK logs', async () => {
  const remote = fake('output');
  remote.commands.run = async (_command, _opts, handlers) => {
    assert.equal(handlers.skipAccumulation, true);
    await handlers.onStdout?.({ text: 'x'.repeat(2000), timestamp: 0 });
    await handlers.onStderr?.({ text: 'error', timestamp: 0 });
    return { logs: { stdout: [], stderr: [] }, result: [], exitCode: 7 };
  };
  const result = await executeCommand(remote, 'test', settings, signal);
  assert.equal(Buffer.byteLength(result.stdout + result.stderr), 1024);
  assert.equal(result.exitCode, 7);
  assert.equal(result.truncated, true);
});

test('invalid deployment settings reject before network activity', () => {
  for (const input of [{ endpoint: 'file:///tmp' }, { maxSandboxes: 0 }, { commandTimeoutSeconds: 0 }, { image: '' }]) {
    assert.equal(settingsSchema.safeParse({ ...settings, ...input }).success, false);
  }
});

test('cancelling a file read closes the transport and drains the pending request before returning', async () => {
  const remote = fake('read');
  const started = deferred<void>();
  const settled = deferred<void>();
  const controller = new AbortController();
  remote.files.readBytes = async () => { started.resolve(); await settled.promise; throw new Error('transport closed'); };
  remote.close = async () => { remote.closes++; settled.resolve(); };
  const runtime = new SandboxRuntime(settings, 'secret', async () => remote);
  const read = runtime.run('a', controller.signal, resource => resource.files.readBytes('/tmp/file', { offset: 0, limit: 10 }));
  const rejected = assert.rejects(read, { name: 'AbortError' });
  await started.promise;
  controller.abort(new DOMException('Cancelled', 'AbortError'));
  await rejected;
  assert.equal(remote.kills, 1);
  assert.equal(remote.closes, 1);
  await runtime.dispose();
});
