import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { retainInboundMedia } from '../src/host/im-media.ts';
import { dingtalkInboundMessage } from '../vendor/dsh-im/src/channels/dingtalk/dingtalk-bridge.mjs';
import { wecomInboundMessage } from '../vendor/dsh-im/src/channels/wecom/wecom-bridge.mjs';
import { wecomAppInboundMessage } from '../vendor/dsh-im/src/channels/wecom-app/wecom-app-bridge.mjs';
import { parseWecomAppPlainMessage } from '../vendor/dsh-im/src/channels/wecom-app/wecom-app-api.mjs';
import { extractInboundMessage } from '../vendor/dsh-im/src/channels/feishu/message-utils.mjs';
import { appendInboundFilesToPrompt, stageInboundFiles } from '../vendor/dsh-im/src/channels/shared/inbound-file.mjs';

test('DingTalk audio keeps recognition and downloads its original only after admission', async () => {
  let downloads = 0;
  const message = dingtalkInboundMessage({ msgtype: 'audio', robotCode: 'robot', content: { downloadCode: 'voice-ref', recognition: '请总结会议' } }, {
    api: { downloadFile: async request => { downloads++; assert.equal(request.downloadCode, 'voice-ref'); return Buffer.from('audio'); } },
  });
  assert.equal(downloads, 0);
  assert.equal(message.content, '请总结会议');
  assert.equal(message.files[0].transcript, message.content);
  assert.deepEqual(await message.files[0].load(), Buffer.from('audio'));
  assert.equal(downloads, 1);
});

test('Feishu audio is a downloadable file without an external voice configuration', async () => {
  let downloads = 0;
  const message = extractInboundMessage({ message: { message_type: 'audio', message_id: 'msg', content: JSON.stringify({ file_key: 'audio-key' }) } }, {
    im: { v1: { messageResource: { get: async request => {
      downloads++; assert.deepEqual(request, { path: { message_id: 'msg', file_key: 'audio-key' }, params: { type: 'file' } });
      return { getReadableStream: () => Readable.from(Buffer.from('opus')) };
    } } } },
  });
  assert.equal(downloads, 0);
  assert.equal(message.files[0].mediaType, 'audio/ogg');
  const loaded = await message.files[0].load();
  assert.equal((await Array.fromAsync(loaded.stream)).map(buffer => buffer.toString()).join(''), 'opus');
});

test('WeCom preserves text-only voice callbacks and decrypts media when a URL is supplied', async () => {
  const text = wecomInboundMessage({ body: { msgtype: 'voice', voice: { content: '收到的转写' } } }, {});
  assert.equal(text.content, '收到的转写');
  assert.equal(text.files.length, 0);
  const media = wecomInboundMessage({ body: { msgtype: 'voice', voice: { url: 'https://media.example/voice', aeskey: 'key', content: '有原件' } } }, {
    downloadFile: async (url, key) => { assert.equal(key, 'key'); return { buffer: Buffer.from('voice') }; },
  });
  assert.equal(media.files[0].transcript, '有原件');
  assert.equal((await media.files[0].load()).data.toString(), 'voice');
});

test('WeCom application XML voice callbacks reach the same attachment pipeline', async () => {
  const parsed = parseWecomAppPlainMessage('<xml><MsgType><![CDATA[voice]]></MsgType><MediaId><![CDATA[media-1]]></MediaId><Format><![CDATA[amr]]></Format><Recognition><![CDATA[会议记录]]></Recognition></xml>');
  const message = wecomAppInboundMessage(parsed, { downloadMedia: async ({ mediaId }) => { assert.equal(mediaId, 'media-1'); return { data: Buffer.from('amr') }; } });
  assert.equal(message.content, '会议记录');
  assert.equal(message.files[0].mediaType, 'audio/amr');
  assert.equal((await message.files[0].load()).data.toString(), 'amr');
});

test('native receipts survive workspace cleanup; transcripts omit receipt identifiers from model text', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'ipollo-im-media-'));
  try {
    const stored = new Map();
    const upload = async ({ sessionId, name, data }) => {
      assert.equal(sessionId, 'session-1');
      stored.set(name, Buffer.concat(await Array.fromAsync(data)));
      return { receiptId: `receipt-${name}` };
    };
    const staged = await stageInboundFiles({ files: [{ name: 'voice.wav', mediaType: 'audio/wav', data: Buffer.from('wav') }] }, { workspace });
    const retained = await retainInboundMedia(staged, 'session-1', { upload, maxSpeechBytes: 100, transcribe: async bytes => { assert.equal(Buffer.from(bytes).toString(), 'wav'); return '转写成功'; } });
    const prompt = appendInboundFilesToPrompt('识别录音', retained);
    assert.equal(prompt.find(part => part.type === 'file').receiptId, 'receipt-voice.wav');
    assert.ok(prompt.at(-1).text.includes('转写成功'));
    assert.ok(!prompt.at(-1).text.includes('receipt-voice.wav'));
    await retained.cleanup();
    assert.equal(stored.get('voice.wav').toString(), 'wav');
    await assert.rejects(readFile(join(workspace, retained.files[0].path)), { code: 'ENOENT' });
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test('unavailable and failed speech recognition keep the recording without leaking diagnostics', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'ipollo-im-speech-'));
  try {
    const staged = await stageInboundFiles({ files: [{ name: 'voice.wav', mediaType: 'audio/wav', data: Buffer.from('wav') }] }, { workspace });
    const base = { upload: async () => ({ receiptId: 'receipt' }), maxSpeechBytes: 100 };
    assert.equal((await retainInboundMedia(staged, 's', base)).files[0].speech.status, 'unavailable');
    const failed = await retainInboundMedia(staged, 's', { ...base, transcribe: async () => { throw new Error('secret-provider-token'); } });
    assert.equal(failed.files[0].speech.status, 'failed');
    assert.ok(!JSON.stringify(failed).includes('secret-provider-token'));
    const supplied = { ...staged, files: staged.files.map(file => ({ ...file, transcript: '平台已经识别' })) };
    assert.equal((await retainInboundMedia(supplied, 's', { ...base, transcribe: async () => assert.fail('must not transcribe twice') })).files[0].speech.text, '平台已经识别');
    const abort = AbortSignal.abort(new Error('cancelled'));
    await assert.rejects(retainInboundMedia(staged, 's', base, abort), /cancelled/);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test('image content uses one native image while non-vision fallback retains the original file receipt', () => {
  const staged = { files: [{ name: 'image.png', path: 'image.png', mediaType: 'image/png', receiptId: 'image-receipt' }] };
  const vision = appendInboundFilesToPrompt([{ type: 'image', data: 'bytes', mediaType: 'image/png' }], staged);
  assert.equal(vision.filter(part => part.type === 'image').length, 1);
  assert.equal(vision.filter(part => part.type === 'file').length, 0);
  const fallback = appendInboundFilesToPrompt('Image needs a vision model', staged);
  assert.equal(fallback.find(part => part.type === 'file').receiptId, 'image-receipt');
});
