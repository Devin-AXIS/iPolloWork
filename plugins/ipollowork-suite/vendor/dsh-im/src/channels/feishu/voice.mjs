// voice.mjs — 飞书渠道语音能力运行时(渠道能力:语音输入与语音回复)
// 入站:音频消息 opus → ffmpeg 转 wav 16k → DashScope qwen3-asr-flash 转文字,
//       回流入正常文本流水线;转写失败走明确降级(保持原有"仅支持文字/图片/文件"提示)。
// 出站:同回合文字回复 → qwen3-tts-flash → ffmpeg 转 opus → 飞书音频消息,
//       优先回复原语音消息,reply 不可用时降级为普通音频消息。
// 凭据经插件凭据库(secretRef)在运行时注入;本模块不落盘、不把密钥写进日志。
// 配置归一化(浏览器安全)在 voice-config.mjs,供 client 侧设置页与 host 侧共用。
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_TTS_CHARS, TTS_ENDPOINT, normalizeFeishuVoiceConfig } from './voice-config.mjs';

function runFfmpeg(bin, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
    let err = '';
    p.stderr.on('data', (d) => { err += d; if (err.length > 2000) err = err.slice(-2000); });
    // 启动失败(未安装 ffmpeg、配置路径不存在或不可执行)时 spawn 触发
    // 'error' 事件而非 'close';不监听会让未处理的 ENOENT 异常击穿 Node 进程。
    // 这里改为正常 reject,由外层的转写/合成失败降级统一兜底。
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${err.slice(-300)}`))));
  });
}

async function readResourceToBuffer(resource) {
  if (typeof resource?.writeFile === 'function') {
    const path = join(tmpdir(), `dsh-voice-in-${randomUUID()}.opus`);
    await resource.writeFile(path);
    const buf = readFileSync(path);
    rmSync(path, { force: true });
    return buf;
  }
  if (resource?.getReadableStream) {
    const chunks = [];
    for await (const chunk of resource.getReadableStream()) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  throw new Error('消息资源无可用读取接口');
}

/**
 * 创建语音能力对象。settings 为 normalizeFeishuVoiceConfig 的产物,secret 为
 * 凭据库解析出的 DashScope api_key。两者任一缺失即返回 { enabled: false },
 * 桥接层据此完全跳过语音路径。
 */
export function createVoice({ settings, secret, logger } = {}) {
  const config = normalizeFeishuVoiceConfig(settings);
  const apiKey = typeof secret === 'string' && secret.trim() ? secret.trim() : null;
  if (!config || !apiKey) {
    if (config) logger?.warn?.('[dsh-feishu-voice] 语音凭据缺失,语音已禁用');
    return Object.freeze({ enabled: false });
  }
  const frozen = Object.freeze({
    apiKey,
    asrBaseUrl: config.asrBaseUrl,
    asrModel: config.asrModel,
    ttsModel: config.ttsModel,
    ttsVoice: config.ttsVoice,
    ffmpeg: config.ffmpeg ?? 'ffmpeg',
  });

  async function transcribeIncoming(event, client) {
    const fileKey = JSON.parse(event.message.content).file_key;
    if (!fileKey) return null;
    const resource = await client.im.v1.messageResource.get({
      params: { type: 'file' },
      path: { message_id: event.message.message_id, file_key: fileKey },
    });
    const opusBuf = await readResourceToBuffer(resource);
    const work = join(tmpdir(), `dsh-voice-${randomUUID()}`);
    mkdirSync(work, { recursive: true });
    try {
      const opusIn = join(work, 'in.opus');
      const wavIn = join(work, 'in.wav');
      writeFileSync(opusIn, opusBuf);
      await runFfmpeg(frozen.ffmpeg, ['-i', opusIn, '-ar', '16000', '-ac', '1', wavIn]);
      const b64 = readFileSync(wavIn).toString('base64');
      // qwen3-asr-flash 走 compatible-mode chat/completions + input_audio data URI
      const res = await fetch(`${frozen.asrBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${frozen.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: frozen.asrModel,
          messages: [{
            role: 'user',
            content: [{ type: 'input_audio', input_audio: { data: `data:audio/wav;base64,${b64}` } }],
          }],
        }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`dashscope ASR ${res.status}: ${text.slice(0, 200)}`);
      const j = JSON.parse(text);
      const out = j?.choices?.[0]?.message?.content;
      if (typeof out !== 'string' || !out.trim()) throw new Error('ASR 无文本输出');
      return out.trim();
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }

  async function synthesize(text) {
    const clean = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TTS_CHARS);
    if (!clean) return null;
    // qwen3-tts-flash 走 DashScope 原生 multimodal-generation 接口(compatible-mode 不支持 TTS)
    const res = await fetch(TTS_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${frozen.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: frozen.ttsModel, input: { text: clean, voice: frozen.ttsVoice } }),
    });
    const j = await res.json().catch(() => null);
    const url = j?.output?.audio?.url;
    if (!url) throw new Error(`TTS 无音频:${res.status} ${JSON.stringify(j ?? {}).slice(0, 160)}`);
    const aud = await fetch(url);
    if (!aud.ok) throw new Error(`TTS 音频下载 ${aud.status}`);
    const work = join(tmpdir(), `dsh-voice-${randomUUID()}`);
    mkdirSync(work, { recursive: true });
    try {
      const wavOut = join(work, 'out.wav');
      const opusOut = join(work, 'out.opus');
      writeFileSync(wavOut, Buffer.from(await aud.arrayBuffer()));
      await runFfmpeg(frozen.ffmpeg, ['-i', wavOut, '-c:a', 'libopus', '-b:a', '48k', opusOut]);
      return readFileSync(opusOut);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }

  return Object.freeze({ enabled: true, transcribeIncoming, synthesize });
}
