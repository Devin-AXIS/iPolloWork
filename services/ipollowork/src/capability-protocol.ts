/** Stable capability inputs and explicit provider request translation. */
import { z } from "zod";
import { ServiceError } from "./errors.js";

export const capabilityKinds = ["chat", "image", "video", "speech", "transcription", "embedding", "rerank"] as const;
export type CapabilityKind = typeof capabilityKinds[number];
const text = z.string().min(1).max(200000);
const media = z.string().max(20 * 1024 * 1024).refine(value => {
  if (/^data:(?:image|audio)\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/i.test(value)) return true;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; }
  catch { return false; }
}, "Use an HTTPS media URL or an image/audio data URI");
const imageList = z.array(media).max(8).optional();
const contentPart = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text }).strict(),
  z.object({ type: z.literal("image_url"), image_url: z.object({ url: media }).strict() }).strict(),
]);
const message = z.object({ role: z.enum(["system", "user", "assistant"]), content: z.union([text, z.array(contentPart).min(1).max(20)]) }).strict();
/** Inputs are provider-independent; model-specific limits are checked again by the execution gateway. */
export const capabilityInputs = {
  chat: z.object({ messages: z.array(message).min(1).max(200), maxTokens: z.number().int().positive().optional(), temperature: z.number().min(0).max(2).optional() }).strict(),
  image: z.object({ prompt: text, images: imageList, size: z.string().max(40).optional(), count: z.number().int().min(1).max(10).default(1) }).strict(),
  video: z.object({ prompt: text, image: media.optional(), duration: z.number().int().min(1).max(120), resolution: z.string().max(40).optional() }).strict(),
  speech: z.object({ text, voice: z.string().min(1).max(200), language: z.string().max(40).optional() }).strict(),
  transcription: z.object({ audio: media, language: z.string().max(40).optional() }).strict(),
  rerank: z.object({ query: text, documents: z.array(text).min(1).max(100), topN: z.number().int().min(1).max(100).optional() }).strict(),
  embedding: z.object({ texts: z.array(text).min(1).max(100), dimensions: z.number().int().positive().optional() }).strict(),
};
/** Explicit preset endpoint metadata; unknown models need an operator-declared path when routes are ambiguous. */
const presetPaths: Readonly<Record<string, string>> = {
  "qwen-image-3.0": "/api/v1/services/aigc/multimodal-generation/generation",
  "wan2.6-image": "/api/v1/services/aigc/multimodal-generation/generation",
  "wan2.6-t2i": "/api/v1/services/aigc/text2image/image-synthesis",
  "wan2.7-t2v": "/api/v1/services/aigc/video-generation/video-synthesis",
  "wan2.6-t2v": "/api/v1/services/aigc/video-generation/video-synthesis",
  "wan2.7-i2v": "/api/v1/services/aigc/image2video/video-synthesis",
  "wan2.6-i2v": "/api/v1/services/aigc/image2video/video-synthesis",
  "fun-asr": "/api/v1/services/audio/asr/transcription",
  "paraformer-v2": "/api/v1/services/audio/asr/transcription",
  "qwen3-asr-flash-filetrans": "/api/v1/services/audio/asr/transcription",
};
export interface CapabilityRoute { method: string; path: string; jobField?: string; async?: boolean; jobResultField?: string }
/** Resolve only configured routes; never synthesize an endpoint from a model name.
 * @param provider Configured provider identifier.
 * @param model Public model record with an optional operator-selected path.
 * @param routes Permitted service routes.
 * @returns A configured creation path, or undefined when selection is ambiguous.
 */
export function invocationPath(provider: string, model: { id: string; invocationPath?: string }, routes: readonly CapabilityRoute[]): string | undefined {
  const candidates = routes.filter(route => route.method === "POST" && !route.jobField && !route.path.includes(":id"));
  const explicit = model.invocationPath ?? (provider === "aliyun-bailian" ? presetPaths[model.id] : undefined);
  return explicit ? candidates.find(route => route.path === explicit)?.path : candidates.length === 1 ? candidates[0]!.path : undefined;
}
/** Translate a validated capability request without accepting a provider URL, key, or arbitrary path.
 * @param kind Discovered operation.
 * @param protocol Configured wire protocol.
 * @param path Selected configured creation path.
 * @param model Authorized model identifier.
 * @param raw Untrusted operation inputs.
 * @returns Provider request fields for the execution service.
 */
export function capabilityRequest(kind: CapabilityKind, protocol: string, path: string, model: string, raw: unknown): Record<string, unknown> {
  const input = capabilityInputs[kind].parse(raw);
  if (kind === "chat") {
    const value = capabilityInputs.chat.parse(input);
    return { model, messages: value.messages, stream: false, ...(value.maxTokens === undefined ? {} : { max_tokens: value.maxTokens }), ...(value.temperature === undefined ? {} : { temperature: value.temperature }) };
  }
  if (kind === "rerank") {
    const value = capabilityInputs.rerank.parse(input);
    if (protocol === "dashscope") return { model, input: { query: value.query, documents: value.documents }, parameters: { top_n: value.topN ?? value.documents.length } };
    return { model, query: value.query, documents: value.documents, top_n: value.topN ?? value.documents.length };
  }
  if (kind === "embedding") {
    const value = capabilityInputs.embedding.parse(input);
    return { model, input: protocol === "ark" && path.endsWith("/embeddings/multimodal") ? value.texts.map(text => ({ type: "text", text })) : value.texts, ...(value.dimensions === undefined ? {} : { dimensions: value.dimensions }) };
  }
  if (kind === "image") {
    const value = capabilityInputs.image.parse(input);
    if (protocol === "dashscope") {
      const parameters = { n: value.count, ...(value.size ? { size: value.size } : {}) };
      if (path.endsWith("multimodal-generation/generation")) return { model, input: { messages: [{ role: "user", content: [...(value.images ?? []).map(image => ({ image })), { text: value.prompt }] }] }, parameters };
      if (value.images?.length) throw new ServiceError("CAPABILITY_INPUT_UNSUPPORTED", 400, "该接口不支持参考图片，请选择支持图片输入的模型");
      return { model, input: { prompt: value.prompt }, parameters };
    }
    if (protocol === "openai" && value.images?.length) throw new ServiceError("CAPABILITY_INPUT_UNSUPPORTED", 400, "此图像接口不接受参考图片");
    if (protocol === "ark" || protocol === "openai") return { model, prompt: value.prompt, n: value.count, ...(value.size ? { size: value.size } : {}), ...(value.images?.length ? { image: value.images } : {}) };
  }
  if (kind === "video") {
    const value = capabilityInputs.video.parse(input);
    if (protocol === "dashscope") {
      if (path.includes("image2video") && !value.image) throw new ServiceError("CAPABILITY_IMAGE_REQUIRED", 400, "该模型需要参考图片");
      return { model, input: { prompt: value.prompt, ...(value.image ? { img_url: value.image } : {}) }, parameters: { duration: value.duration, ...(value.resolution ? { resolution: value.resolution } : {}) } };
    }
    if (protocol === "ark") return { model, content: [{ type: "text", text: value.prompt }, ...(value.image ? [{ type: "image_url", image_url: { url: value.image } }] : [])], duration: value.duration, ...(value.resolution ? { resolution: value.resolution } : {}) };
  }
  if (kind === "speech") {
    const value = capabilityInputs.speech.parse(input);
    if (protocol === "dashscope") return { model, input: { text: value.text, voice: value.voice, ...(value.language ? { language_type: value.language } : {}) } };
    if (protocol === "volcengine-speech") return { model, req_params: { text: value.text, speaker: value.voice } };
    if (protocol === "openai") return { model, input: value.text, voice: value.voice };
  }
  if (kind === "transcription") {
    const value = capabilityInputs.transcription.parse(input);
    if (protocol === "dashscope") return { model, input: { file_urls: [value.audio] }, parameters: value.language ? { language_hints: [value.language] } : {} };
    if (protocol === "volcengine-speech") return { model, audio: { url: value.audio }, request: { model_name: "bigmodel" } };
  }
  throw new ServiceError("CAPABILITY_PROTOCOL_UNSUPPORTED", 400, "此服务尚未配置统一调用协议");
}
