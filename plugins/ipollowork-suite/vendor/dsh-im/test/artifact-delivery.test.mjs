import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  OUTBOUND_ARTIFACT_TOOL,
  OutboundArtifactRegistry,
  createOutboundArtifactTool,
  materializeOutboundArtifact,
} from '../src/channels/shared/semantic/artifact.mjs';
import { deliverOutboundArtifacts } from '../src/channels/shared/semantic/artifact-delivery.mjs';
import { createDeliveryReceipt } from '../src/channels/shared/semantic/delivery.mjs';

let fixtureId = 0;

async function committedArtifact(t, fileName, content) {
  fixtureId += 1;
  const suffix = String(fixtureId);
  const workspace = await mkdtemp(join(tmpdir(), `dsh-im-delivery-${suffix}-`));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const registry = new OutboundArtifactRegistry({ uuid: () => `artifact-${suffix}` });
  t.after(() => registry.clear());
  const sessionId = `session-${suffix}`;
  const agent = {
    session: {
      header: { id: sessionId, cwd: workspace },
      events: [
        { type: 'turn/start', data: { turn: 1 } },
        { type: 'user/message', data: { turn: 1, source: { rpcId: `rpc-${suffix}` } } },
      ],
    },
  };
  t.after(registry.openConsumer(sessionId, `rpc-${suffix}`));
  for (const event of agent.session.events) {
    registry.observeSessionEvent(agent.session, event);
  }
  await writeFile(join(workspace, fileName), content);
  const tool = createOutboundArtifactTool({ registry });
  const execution = {
    name: OUTBOUND_ARTIFACT_TOOL,
    callId: `call-${suffix}`,
    rootCallId: `call-${suffix}`,
    token: Symbol(`call-${suffix}`),
    agent,
  };
  await tool.definition.execute({ path: fileName }, execution);
  tool.onResult(execution, { isError: false });
  return registry.take(sessionId, 1)[0];
}

function rejected(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

async function assertReleased(artifact) {
  await assert.rejects(
    materializeOutboundArtifact(artifact),
    (error) => error?.code === 'artifact-invalid',
  );
}

test('non-image artifacts use the existing file sender once', async (t) => {
  const artifact = await committedArtifact(t, 'report.txt', 'report');
  const calls = [];

  const delivery = await deliverOutboundArtifacts({
    artifacts: [artifact],
    deliveryId: 'reply-1',
    channelKey: 'test',
    sendImage: async () => calls.push('image'),
    sendFile: async (file) => {
      calls.push(`file:${file.fileName}`);
      return { messageId: 'file-1' };
    },
  });

  assert.deepEqual(calls, ['file:report.txt']);
  assert.equal(delivery.receipt.presentation, 'test-file');
  assert.deepEqual(delivery.receipt.providerMessageIds, ['file-1']);
  assert.equal(delivery.artifactsSent, 1);
  assert.equal(delivery.artifactSendErrors, 0);
  await assertReleased(artifact);
});

test('image artifacts prefer the native image sender', async (t) => {
  const artifact = await committedArtifact(t, 'result.png', Buffer.from([1, 2, 3]));
  const calls = [];

  const delivery = await deliverOutboundArtifacts({
    artifacts: [artifact],
    channelKey: 'test',
    sendImage: async (file) => {
      calls.push(`image:${file.mediaType}`);
      return { id: 'image-1' };
    },
    sendFile: async () => calls.push('file'),
  });

  assert.deepEqual(calls, ['image:image/png']);
  assert.equal(delivery.receipt.presentation, 'test-image');
  assert.deepEqual(delivery.receipt.providerMessageIds, ['image-1']);
  await assertReleased(artifact);
});

test('an image uses file delivery when the channel has no image sender', async (t) => {
  const artifact = await committedArtifact(t, 'result.jpg', Buffer.from([1]));
  let fileCalls = 0;

  const delivery = await deliverOutboundArtifacts({
    artifacts: [artifact],
    channelKey: 'test',
    sendFile: async () => {
      fileCalls += 1;
      return { id: 'file-1' };
    },
  });

  assert.equal(fileCalls, 1);
  assert.equal(delivery.receipt.presentation, 'test-file');
  await assertReleased(artifact);
});

test('a definitive native-image rejection falls back to file delivery', async (t) => {
  const artifact = await committedArtifact(t, 'result.webp', Buffer.from([1]));
  const calls = [];

  const delivery = await deliverOutboundArtifacts({
    artifacts: [artifact],
    channelKey: 'test',
    sendImage: async () => {
      calls.push('image');
      throw rejected('artifact-provider-rejected');
    },
    sendFile: async () => {
      calls.push('file');
      return { id: 'file-after-image' };
    },
  });

  assert.deepEqual(calls, ['image', 'file']);
  assert.equal(delivery.receipt.presentation, 'test-file');
  assert.equal(delivery.artifactsSent, 1);
  assert.equal(delivery.artifactSendErrors, 0);
  await assertReleased(artifact);
});

test('a failed file fallback produces one failure receipt and one safe notice', async (t) => {
  const artifact = await committedArtifact(t, 'result.webp', Buffer.from([1]));
  const calls = [];
  const classifiedFailure = { referenceId: 'MF-ARTIFACT1' };

  const delivery = await deliverOutboundArtifacts({
    artifacts: [artifact],
    channelKey: 'test',
    sendImage: async () => {
      calls.push('image');
      throw rejected('artifact-provider-rejected');
    },
    sendFile: async () => {
      calls.push('file');
      throw rejected('artifact-provider-failed');
    },
    onFailure: (failedArtifact, error) => {
      calls.push('classify');
      assert.equal(failedArtifact, artifact);
      assert.equal(error.code, 'artifact-provider-failed');
      return classifiedFailure;
    },
    sendFailureNotice: async (failedArtifact, error, failure) => {
      calls.push('notice');
      assert.equal(failedArtifact, artifact);
      assert.equal(error.code, 'artifact-provider-failed');
      assert.equal(failure, classifiedFailure);
      return { messageId: 'notice-after-fallback' };
    },
  });

  assert.deepEqual(calls, ['image', 'file', 'classify', 'notice']);
  assert.deepEqual(delivery.receipt.providerMessageIds, ['notice-after-fallback']);
  assert.deepEqual(delivery.receipt.artifacts, [{
    artifactId: artifact.artifactId,
    outcome: 'failed',
    reason: 'artifact-provider-failed',
  }]);
  assert.equal(delivery.artifactsSent, 0);
  assert.equal(delivery.artifactSendErrors, 1);
  await assertReleased(artifact);
});

test('an uncertain native-image result never sends a duplicate file', async (t) => {
  const artifact = await committedArtifact(t, 'result.gif', Buffer.from([1]));
  let fileCalls = 0;
  let notices = 0;

  const delivery = await deliverOutboundArtifacts({
    artifacts: [artifact],
    channelKey: 'test',
    sendImage: async () => {
      throw rejected('artifact-delivery-uncertain');
    },
    sendFile: async () => {
      fileCalls += 1;
    },
    sendFailureNotice: async () => {
      notices += 1;
      return { messageId: 'notice-1' };
    },
  });

  assert.equal(fileCalls, 0);
  assert.equal(notices, 1);
  assert.deepEqual(delivery.receipt.artifacts, [{
    artifactId: artifact.artifactId,
    outcome: 'unknown',
    reason: 'artifact-delivery-uncertain',
  }]);
  assert.equal(delivery.userVisible, true);
  assert.equal(delivery.artifactSendErrors, 1);
  await assertReleased(artifact);
});

test('abort during native image delivery stops without fallback or notice', async (t) => {
  const artifact = await committedArtifact(t, 'result.png', Buffer.from([1]));
  const controller = new AbortController();
  let fileCalls = 0;
  let notices = 0;

  await assert.rejects(deliverOutboundArtifacts({
    artifacts: [artifact],
    channelKey: 'test',
    signal: controller.signal,
    sendImage: async () => {
      controller.abort();
      controller.signal.throwIfAborted();
    },
    sendFile: async () => {
      fileCalls += 1;
    },
    sendFailureNotice: async () => {
      notices += 1;
    },
  }), (error) => error?.name === 'AbortError');

  assert.equal(fileCalls, 0);
  assert.equal(notices, 0);
  await assertReleased(artifact);
});

test('a pre-aborted delivery releases every unprocessed artifact', async (t) => {
  const first = await committedArtifact(t, 'first.txt', 'first');
  const second = await committedArtifact(t, 'second.txt', 'second');
  const controller = new AbortController();
  controller.abort();
  let sends = 0;

  await assert.rejects(deliverOutboundArtifacts({
    artifacts: [first, second],
    channelKey: 'test',
    signal: controller.signal,
    sendFile: async () => { sends += 1; },
  }), (error) => error?.name === 'AbortError');

  assert.equal(sends, 0);
  await assertReleased(first);
  await assertReleased(second);
});

test('an abort while processing multiple artifacts releases the remaining artifacts', async (t) => {
  const first = await committedArtifact(t, 'first.txt', 'first');
  const second = await committedArtifact(t, 'second.txt', 'second');
  const controller = new AbortController();
  const calls = [];

  await assert.rejects(deliverOutboundArtifacts({
    artifacts: [first, second],
    channelKey: 'test',
    signal: controller.signal,
    sendFile: async (file) => {
      calls.push(file.fileName);
      controller.abort();
      return { id: 'provider-may-have-sent' };
    },
  }), (error) => error?.name === 'AbortError');

  assert.deepEqual(calls, ['first.txt']);
  await assertReleased(first);
  await assertReleased(second);
});

test('abort during a failure notice remains terminal and releases the artifact', async (t) => {
  const artifact = await committedArtifact(t, 'result.txt', 'result');
  const controller = new AbortController();

  await assert.rejects(deliverOutboundArtifacts({
    artifacts: [artifact],
    channelKey: 'test',
    signal: controller.signal,
    sendFile: async () => {
      throw rejected('artifact-provider-failed');
    },
    sendFailureNotice: async () => {
      controller.abort();
      return { messageId: 'must-not-be-receipted' };
    },
  }), (error) => error?.name === 'AbortError');

  await assertReleased(artifact);
});

test('mixed artifacts preserve order and merge existing receipt semantics', async (t) => {
  const image = await committedArtifact(t, 'first.png', Buffer.from([1]));
  const file = await committedArtifact(t, 'second.txt', 'two');
  const calls = [];
  const baseReceipt = createDeliveryReceipt({
    deliveryId: 'reply-mixed',
    presentation: 'test-text',
    providerMessageIds: ['text-1'],
  });

  const delivery = await deliverOutboundArtifacts({
    artifacts: [image, file],
    baseReceipt,
    deliveryId: 'reply-mixed',
    channelKey: 'test',
    sendImage: async (materialized) => {
      calls.push(materialized.fileName);
      return { id: 'image-1' };
    },
    sendFile: async (materialized) => {
      calls.push(materialized.fileName);
      return { id: 'file-1' };
    },
  });

  assert.deepEqual(calls, ['first.png', 'second.txt']);
  assert.equal(delivery.receipt.presentation, 'test-text-and-files');
  assert.deepEqual(delivery.receipt.providerMessageIds, ['text-1', 'image-1', 'file-1']);
  assert.deepEqual(delivery.receipt.artifacts.map(({ outcome }) => outcome), ['sent', 'sent']);
  assert.equal(delivery.artifactsSent, 2);
  await assertReleased(image);
  await assertReleased(file);
});

test('a definitively failed base delivery is not treated as user-visible', async () => {
  const delivery = await deliverOutboundArtifacts({
    baseReceipt: createDeliveryReceipt({
      deliveryId: 'failed-text',
      presentation: 'telegram-rich-final',
      deliveryOutcome: 'failed',
      reason: 'telegram-provider-rejected',
    }),
    channelKey: 'telegram',
  });

  assert.equal(delivery.userVisible, false);
});
