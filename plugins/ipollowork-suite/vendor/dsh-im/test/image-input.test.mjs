import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { imageInputLimits, DEFAULT_IMAGE_INPUT_SETTINGS, normalizeImageInputSettings } from '../src/channels/shared/image-input-policy.mjs';
import { ImageInputSettingsStore } from '../src/channels/shared/image-input-settings-store.mjs';
import { inboundImagesAsFiles, modelImageFromOriginal, imageContentFromStaged } from '../src/channels/shared/image-input.mjs';
import { stageInboundFiles } from '../src/channels/shared/inbound-file.mjs';
import { HarnessClient, HarnessRpcError } from '../src/channels/shared/harness-client.mjs';
import { TextHarnessBridge } from '../src/channels/shared/text-harness-bridge.mjs';
import { WecomAppBridge } from '../src/channels/wecom-app/wecom-app-bridge.mjs';
import { createImageInputRpcHandler, IMAGE_INPUT_ENDPOINTS } from '../plugin-src/host/image-input-rpc.mjs';

import { assertRestrictiveMode } from './support/filesystem.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const MB = 1024 * 1024;
async function temporary(t) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-image-input-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
function manifest(content) {
  const blocks = content.filter((part) => part.type === 'text' && part.text.includes('<dsh_im_files>'));
  assert.equal(blocks.length, 1);
  return JSON.parse(blocks[0].text.split('\n').find((line) => line.startsWith('{'))).files;
}
async function clientFixture(t, { onPrompt, policy, retention = 'persistent' } = {}) {
  const root = await temporary(t);
  const prompts = [];
  const staged = [];
  const client = new HarnessClient({
    baseUrl: 'http://127.0.0.1:3080', workspace: '/wrong-configured-workspace',
    imageInputPolicy: policy,
    fileIngressExecutor: async ({ workspace, files, signal }) => {
      assert.equal(workspace, root, 'use the resolved Session workspace');
      const batch = await stageInboundFiles({ files }, { workspace, signal, retention });
      staged.push(batch);
      return batch;
    },
  });
  client.ensureRunning = async () => true;
  client.watchInteractions = async (_sessionId, { signal, onOpen }) => {
    onOpen();
    await new Promise((resolve) => {
      if (signal.aborted) resolve();
      else signal.addEventListener('abort', resolve, { once: true });
    });
  };
  client.sessionExists = async () => true;
  client.createSession = async () => 'test-session';
  client.rpc = async (method, payload, _timeout, options) => {
    if (method === 'workspace.list') return { items: [], archivedSessionIds: [] };
    if (method === 'session.list') return { items: [{ sessionId: 'test-session', cwd: root }] };
    if (method === 'session.prompt') {
      prompts.push({ ...payload, rpcId: options.rpcId });
      await onPrompt?.(payload.content, prompts.length);
      return { accepted: true };
    }
    assert.equal(method, 'session.history');
    if (!prompts.length) return { events: [] };
    return { events: [
      { event: { seq: 1, type: 'turn/start', data: { turn: 1 } } },
      { event: { seq: 2, type: 'user/message', data: { turn: 1, source: { rpcId: prompts[0].rpcId } } } },
      { event: { seq: 3, type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: 'verified' }] } } } },
      { event: { seq: 4, type: 'turn/end', data: { turn: 1, reason: 'completed' } } },
    ] };
  };
  return { root, client, prompts, staged };
}

test('settings validate all fields and serialize atomically without changing TTL settings', async (t) => {
  const root = await temporary(t);
  const path = join(root, 'image-input-settings.json');
  const store = new ImageInputSettingsStore(path);
  assert.deepEqual(await store.get(), DEFAULT_IMAGE_INPUT_SETTINGS);
  for (const invalid of [{}, null, { ...DEFAULT_IMAGE_INPUT_SETTINGS, maxImages: 0 },
    { ...DEFAULT_IMAGE_INPUT_SETTINGS, maxImageMb: 31 },
    { ...DEFAULT_IMAGE_INPUT_SETTINGS, maxTotalMb: 1 },
    { ...DEFAULT_IMAGE_INPUT_SETTINGS, maxDownloadMb: Infinity }]) {
    assert.equal(normalizeImageInputSettings(invalid), null);
  }
  const values = [6, 7, 8].map((maxImageMb) => ({ ...DEFAULT_IMAGE_INPUT_SETTINGS, maxImageMb }));
  await Promise.all(values.map((value) => store.set(value)));
  assert.deepEqual(await new ImageInputSettingsStore(path).get(), values[2]);
  assert.deepEqual(await readdir(root), ['image-input-settings.json']);
  await assertRestrictiveMode(path, 0o600);
  const handler = createImageInputRpcHandler(store);
  assert.equal((await handler(IMAGE_INPUT_ENDPOINTS.set, { ...values[2], secret: 'no' })).ok, false);
  assert.equal((await handler(IMAGE_INPUT_ENDPOINTS.get, {})).value.maxImageMb, 8);
  assert.equal((await handler(IMAGE_INPUT_ENDPOINTS.set, DEFAULT_IMAGE_INPUT_SETTINGS)).ok, true);
});

test('receipt checks declared size and count before downloads and actual bytes afterwards', async () => {
  const limits = imageInputLimits();
  let loads = 0;
  const source = { load: async () => { loads++; return PNG; } };
  assert.throws(() => inboundImagesAsFiles([source, { size: 31 * MB }], limits), /exceeds/);
  assert.throws(() => inboundImagesAsFiles(Array(21).fill(source), limits), /Too many/);
  assert.equal(loads, 0);
  const [file] = inboundImagesAsFiles([{ load: async ({ maxBytes }) => {
    assert.equal(maxBytes, 30 * MB); return Buffer.alloc(maxBytes + 1);
  } }], limits);
  await assert.rejects(file.load(), (error) => error.code === 'image-too-large' && error.userMessage.includes('30 MB'));
  const [invalid] = inboundImagesAsFiles([{ data: Buffer.from('not an image') }], limits);
  await assert.rejects(invalid.load(), { code: 'unsupported-image-type' });
});

test('large originals are compressed within the model budget without cropping', async () => {
  const data = await sharp(randomBytes(2100 * 1600 * 3), { raw: { width: 2100, height: 1600, channels: 3 } }).png().toBuffer();
  assert.ok(data.length > 5 * MB);
  const result = await modelImageFromOriginal(data, 'image/png', 5 * MB);
  assert.ok(result.data.length < 5 * MB);
  const metadata = await sharp(result.data).metadata();
  assert.equal(result.mediaType, 'image/jpeg');
  assert.equal(metadata.width, 2048);
  assert.ok(Math.abs(metadata.width / metadata.height - 2100 / 1600) < 0.002);
});

test('small native images pass through; transparent images keep alpha; animation is never flattened', async () => {
  assert.deepEqual((await modelImageFromOriginal(PNG, 'image/png', 5 * MB)).data, PNG);
  const alpha = await sharp({ create: { width: 2500, height: 1600, channels: 4,
    background: { r: 255, g: 0, b: 0, alpha: 0.5 } } }).png().toBuffer();
  const reduced = await modelImageFromOriginal(alpha, 'image/png', 5 * MB);
  assert.equal(reduced.mediaType, 'image/png');
  assert.equal((await sharp(reduced.data).metadata()).hasAlpha, true);
  const gif = await sharp({ create: { width: 10, height: 20, channels: 3, background: 'red', pageHeight: 10 } }).gif().toBuffer();
  assert.deepEqual((await modelImageFromOriginal(gif, 'image/gif', 5 * MB)).data, gif);
  assert.equal(await modelImageFromOriginal(gif, 'image/gif', 1), null);
  const frames = Buffer.alloc(10 * 20 * 3);
  for (let offset = 0; offset < frames.length; offset += 3) frames[offset + (offset < 10 * 10 * 3 ? 0 : 2)] = 255;
  const animated = await sharp(frames, { raw: { width: 10, height: 20, channels: 3, pageHeight: 10 } })
    .webp({ loop: 0, delay: [100, 100] }).toBuffer();
  assert.equal((await sharp(animated).metadata()).pages, 2);
  assert.deepEqual((await modelImageFromOriginal(animated, 'image/webp', 5 * MB)).data, animated);
  assert.equal(await modelImageFromOriginal(animated, 'image/webp', 1), null);
});

test('missing codec, failed codec and pixel overflow degrade to saved files', async () => {
  const noCodec = { sharpLoader: async () => null };
  assert.deepEqual(await modelImageFromOriginal(PNG, 'image/png', PNG.length, noCodec), { data: PNG, mediaType: 'image/png' });
  assert.equal(await modelImageFromOriginal(PNG, 'image/png', 1, noCodec), null);
  assert.equal(await modelImageFromOriginal(PNG, 'image/png', 5 * MB, {
    sharpLoader: async () => () => ({ metadata: async () => { throw new Error('codec failed'); } }),
  }), null);
  assert.equal(await modelImageFromOriginal(PNG, 'image/png', 5 * MB, {
    sharpLoader: async () => () => ({ metadata: async () => ({ width: 10000, height: 10000 }) }),
  }), null);
});

test('compression performs at most three passes and honours cancellation', async () => {
  let passes = 0;
  const codec = () => ({ metadata: async () => ({ width: 3000, height: 3000 }),
    rotate() { return this; }, resize() { return this; }, jpeg() { return this; },
    async toBuffer() { passes++; return Buffer.alloc(100); },
  });
  assert.equal(await modelImageFromOriginal(PNG, 'image/png', 1, { sharpLoader: async () => codec }), null);
  assert.equal(passes, 3);
  const controller = new AbortController();
  controller.abort(new Error('cancelled'));
  await assert.rejects(modelImageFromOriginal(PNG, 'image/png', 5 * MB, { signal: controller.signal }), /cancelled/);
});

test('aggregate budget keeps image numbering and originals for file-only images', async (t) => {
  const root = await temporary(t);
  const limits = { ...imageInputLimits(), maxImageBytes: PNG.length, maxTotalImageBytes: PNG.length };
  const batch = await stageInboundFiles({ files: inboundImagesAsFiles([{ name: 'one.png', data: PNG }, { name: 'two.png', data: PNG }], limits) }, { workspace: root });
  const content = await imageContentFromStaged(batch, limits);
  assert.equal(content.filter((part) => part.type === 'image').length, 1);
  assert.ok(content.some((part) => part.text?.includes('图片序号：2')));
  assert.deepEqual(await readFile(join(root, batch.files[1].path)), PNG);
});

test('Harness saves originals before model admission, preserves accompanying files and downloads only once', async (t) => {
  const large = Buffer.concat([PNG, Buffer.alloc(6 * MB)]);
  let loads = 0;
  const fixture = await clientFixture(t, { onPrompt: async (content) => {
    const files = manifest(content);
    assert.equal(files.length, 2);
    assert.deepEqual(await readFile(join(fixture.root, files[1].path)), large);
    assert.ok(Buffer.from(content.find((part) => part.type === 'image').data, 'base64').length <= 5 * MB);
  } });
  assert.equal(await fixture.client.ask('test-session', 'look', {
    images: [{ name: 'big.png', load: async ({ maxBytes }) => { loads++; assert.equal(maxBytes, 30 * MB); return large; } }],
    files: [{ name: 'note.txt', data: Buffer.from('notes') }],
  }), 'verified');
  assert.equal(loads, 1);
  assert.equal(fixture.prompts.length, 1);
});

for (const reason of ['MODEL_DOES_NOT_SUPPORT_IMAGES', 'IMAGE_TOO_LARGE', 'IMAGES_TOO_LARGE', 'TOO_MANY_IMAGES', 'IMAGE_TOO_MANY_PIXELS']) {
  test(`Host ${reason} retries once using already saved originals`, async (t) => {
    const fixture = await clientFixture(t, { onPrompt: (_content, attempt) => {
      if (attempt === 1) throw new HarnessRpcError('session.prompt', { code: 'attachment-error', details: { reason } });
    } });
    let loads = 0;
    await fixture.client.ask('test-session', 'caption', { images: [{ load: async () => { loads++; return PNG; } }] });
    assert.equal(loads, 1);
    assert.equal(fixture.staged.length, 1);
    assert.equal(fixture.prompts.length, 2);
    assert.equal(fixture.prompts[0].rpcId, fixture.prompts[1].rpcId);
    assert.equal(fixture.prompts[1].content.some((part) => part.type === 'image'), false);
    assert.deepEqual(manifest(fixture.prompts[0].content), manifest(fixture.prompts[1].content));
  });
}

test('unknown network failure is never retried, and an admission retry cannot retry again', async (t) => {
  for (const [code, expected] of [['timeout', 1], ['attachment-error', 2]]) {
    const fixture = await clientFixture(t, { onPrompt: () => {
      throw new HarnessRpcError('session.prompt', { code, details: { reason: 'IMAGE_TOO_LARGE' } });
    } });
    await assert.rejects(fixture.client.ask('test-session', 'caption', { images: [{ data: PNG }] }), { code });
    assert.equal(fixture.prompts.length, expected);
    assert.equal(fixture.staged.length, 1);
  }
});

test('policy is captured on each ask and loader errors remain image diagnostics', async (t) => {
  let settings = DEFAULT_IMAGE_INPUT_SETTINGS;
  const { client, prompts } = await clientFixture(t, { policy: () => settings });
  settings = { ...settings, maxDownloadMb: 6 };
  await assert.rejects(client.ask('test-session', 'caption', { images: [{ size: 7 * MB }] }),
    (error) => error.userMessage.includes('6 MB'));
  await assert.rejects(client.ask('test-session', 'caption', { images: [{ load: async () => { throw new Error('private path'); } }] }),
    (error) => error.code === 'image-download-failed' && !error.userMessage.includes('private path'));
  assert.equal(prompts.length, 0);
});

for (const channel of ['slack', 'telegram', 'discord', 'whatsapp']) {
  test(`${channel} shared bridge passes images through real Harness staging and compression`, async (t) => {
    const { root, client, prompts } = await clientFixture(t);
    const seen = new Set();
    const sent = [];
    const image = Buffer.concat([PNG, Buffer.alloc(6 * MB)]);
    const bridge = new TextHarnessBridge({ descriptor: { key: channel, label: channel },
      bot: { sendText: async (_target, text) => sent.push(text) }, harness: client,
      state: { sessionFor: () => 'test-session', hasSeen: (id) => seen.has(id), markSeen: async (id) => seen.add(id), setSession: async () => {} },
    });
    await bridge.accept({ messageId: 'big-image', senderId: 'user', kind: 'direct', conversationId: 'user', content: 'look',
      images: [{ name: 'big.png', data: image }], replyTarget: {} });
    assert.deepEqual(sent, ['verified']);
    assert.equal(prompts.length, 1);
    const files = manifest(prompts[0].content);
    assert.deepEqual(await readFile(join(root, files[0].path)), image);
  });
}

test('WeCom app media downloads pass through real Harness staging and compression', async (t) => {
  const { root, client, prompts } = await clientFixture(t);
  const seen = new Set();
  const sent = [];
  const image = Buffer.concat([PNG, Buffer.alloc(6 * MB)]);
  let downloads = 0;
  const bridge = new WecomAppBridge({
    api: {
      downloadMedia: async ({ mediaId }) => {
        assert.equal(mediaId, 'media-image');
        downloads++;
        return { data: image, filename: 'big.png' };
      },
      sendText: async ({ content }) => { sent.push(content); return { message_id: 'out' }; },
    },
    harness: client,
    status: { messagesReceived: 0, messagesReplied: 0 },
    state: { sessionFor: () => 'test-session', hasSeen: (id) => seen.has(id), markSeen: async (id) => seen.add(id), setSession: async () => {} },
  });
  t.after(() => bridge.close());
  await bridge.accept({ msgid: 'big-image', msgtype: 'image', from: { userid: 'user' }, mediaId: 'media-image' });
  await bridge.waitForIdle();
  assert.deepEqual(sent, ['verified']);
  assert.equal(downloads, 1);
  assert.equal(prompts.length, 1);
  const content = prompts[0].content;
  assert.ok(Buffer.from(content.find((part) => part.type === 'image').data, 'base64').length <= 5 * MB);
  assert.deepEqual(await readFile(join(root, manifest(content)[0].path)), image);
});
