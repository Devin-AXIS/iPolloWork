// voice-config.mjs — 飞书语音配置的纯数据归一化(浏览器安全,无 Node 内置模块)。
// 运行时转写/合成能力见 voice.mjs;此处只负责把每机器人配置校验为固定形状,
// 供 host 侧配置存储、RPC 校验与 client 侧设置页共用。
export const DEFAULT_VOICE_SECRET_REF = 'DASHSCOPE_API_KEY';
export const DEFAULT_ASR_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
export const DEFAULT_ASR_MODEL = 'qwen3-asr-flash';
export const DEFAULT_TTS_MODEL = 'qwen3-tts-flash';
export const DEFAULT_TTS_VOICE = 'Momo';
export const TTS_ENDPOINT = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
export const MAX_TTS_CHARS = 600;

function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * 归一化每机器人语音配置。语音是可选的渠道能力:关闭或配置不完整时返回 null,
 * 与未配置行为完全一致。secretRef 走插件凭据库(与飞书 app secret 相同的环境变量
 * 命名规范),密钥本身绝不进配置。
 */
export function normalizeFeishuVoiceConfig(value) {
  if (value == null || typeof value !== 'object' || value.enabled !== true) return null;
  const secretRef = cleanString(value.secretRef);
  if (!secretRef || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(secretRef)) return null;
  return Object.freeze({
    enabled: true,
    secretRef,
    asrModel: cleanString(value.asrModel) ?? DEFAULT_ASR_MODEL,
    ttsModel: cleanString(value.ttsModel) ?? DEFAULT_TTS_MODEL,
    ttsVoice: cleanString(value.ttsVoice) ?? DEFAULT_TTS_VOICE,
    asrBaseUrl: cleanString(value.asrBaseUrl) ?? DEFAULT_ASR_BASE_URL,
    ffmpeg: cleanString(value.ffmpeg),
  });
}
